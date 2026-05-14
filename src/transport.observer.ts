import {
  type Application,
  CoreBindings,
  inject,
  lifeCycleObserver,
  LifeCycleObserver,
} from '@loopback/core';
import debugFactory from 'debug';
import type {HandlerDiscoverer, RegisteredHandler} from './discovery';
import type {
  DiscoveredDeserializer,
  DiscoveredSerializer,
} from './discovery/discovery.service';
import {TransportConfigError} from './helpers/errors';
import type {TransportServer} from './interfaces';
import {
  DESERIALIZER_TAG,
  HANDLER_DISCOVERER_TAG,
  SERIALIZER_TAG,
  TRANSPORT_NAME_TAG,
  TRANSPORT_SERVER_TAG,
  TransportBindings,
} from './keys';
import type {HandlerRegistry} from './registry';
import type {Deserializer, Serializer} from './serializers';

const debug = debugFactory('loopback:transport:booter');

/**
 * Booter lifecycle state. Tracked so start/stop are idempotent and
 * concurrent callers share a single in-flight promise.
 */
type BooterState = 'stopped' | 'starting' | 'started' | 'stopping';

/**
 * Recursively freeze a value and every nested object/array property.
 * File-private; used to harden the `RegisteredHandler` snapshot handed
 * to `DiscoveryService` so consumers cannot mutate registry state.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/**
 * Lifecycle observer that discovers transport handlers after boot and
 * starts/stops transport servers.
 *
 * Runs after all controllers are registered (boot phase complete).
 * Scans controllers for `@messageHandler` / `@eventHandler` metadata,
 * registers handlers with transport servers, then starts listeners.
 *
 * Boot sequence:
 *
 * 1. Discover handlers from every bound `HandlerDiscoverer`.
 * 2. Populate the `DiscoveryService` snapshot.
 * 3. Bind the handlers to their transport servers.
 * 4. Start servers sequentially.
 *
 * Startup behavior: sequential with deterministic rollback. Servers
 * start one at a time. If any fails, every server that has already
 * been started — including the failing one — is closed in reverse
 * order. No race between concurrent starts.
 *
 * Shutdown behavior: best-effort parallel. All servers stop
 * concurrently. Individual errors are logged but do not prevent other
 * servers from stopping.
 *
 * Restart safety: servers are cleared of handlers before rebinding to
 * prevent duplicate registration on stop/start cycles.
 *
 * Idempotency: `start()` and `stop()` are safe to call multiple times.
 * Concurrent calls share the same in-flight promise.
 *
 * @public
 */
@lifeCycleObserver('transport')
export class TransportBooter implements LifeCycleObserver {
  private state: BooterState = 'stopped';
  private startPromise: Promise<void> | undefined;
  private stopPromise: Promise<void> | undefined;

  constructor(
    @inject(CoreBindings.APPLICATION_INSTANCE)
    private readonly app: Application,
    @inject(TransportBindings.HANDLER_REGISTRY)
    private readonly registry: HandlerRegistry,
  ) {}

  /**
   * Start every registered transport server.
   *
   * Idempotent and concurrency-safe: a second concurrent call shares
   * the in-flight start promise, and calling `start()` on an already
   * started booter is a no-op.
   *
   * @public
   * @returns Resolves when every server has reported ready.
   * @throws TransportError When any server fails to start. All
   *   partially-started servers are closed before the original error
   *   is re-thrown.
   */
  async start(): Promise<void> {
    if (this.state === 'started') return;
    if (this.startPromise) return this.startPromise;

    this.state = 'starting';
    this.startPromise = this.doStart().finally(() => {
      this.startPromise = undefined;
    });
    try {
      await this.startPromise;
      this.state = 'started';
    } catch (err) {
      this.state = 'stopped';
      throw err;
    }
  }

  /**
   * Stop every registered transport server.
   *
   * Idempotent and concurrency-safe: a second concurrent call shares
   * the in-flight stop promise, and calling `stop()` on an already
   * stopped booter is a no-op.
   *
   * @public
   * @returns Resolves once every server has closed (or its close has
   *   been attempted).
   */
  async stop(): Promise<void> {
    if (this.state === 'stopped') return;
    if (this.stopPromise) return this.stopPromise;

    this.state = 'stopping';
    this.stopPromise = this.doStop().finally(() => {
      this.stopPromise = undefined;
    });
    try {
      await this.stopPromise;
    } finally {
      this.state = 'stopped';
    }
  }

  private async doStart(): Promise<void> {
    debug('transport booter starting');

    // Discover handlers from controllers (idempotent: clears first).
    await this.registry.discoverHandlers(this.app);

    // Populate the universal DiscoveryService snapshot so cross-cutting
    // plugins can enumerate the discovered handler graph.
    await this.populateDiscoveryService();

    // Clear existing handlers from servers before rebinding so a
    // restart cycle does not double-register.
    const entries = await this.getServerEntries();
    for (const {server} of entries) {
      server.clearHandlers();
    }

    await this.registry.bindToServers(this.app);

    // Resolve each server's serializer/deserializer pair from
    // tag-based bindings (transport-scoped > generic > subclass
    // default). Runs after `bindToServers` and before `listen()` so
    // every adapter sees the final serializer choice in its
    // `listen()` implementation. `resolveSerializer` is a required
    // method on `TransportServer`; subclasses of `ServerBase` inherit
    // the default implementation.
    for (const {server} of entries) {
      await server.resolveSerializer(this.app);
    }

    // Start servers sequentially. Push BEFORE awaiting listen() so
    // rollback covers the failing server too — listen() may have
    // partially opened sockets/consumers before throwing.
    const started: TransportServer[] = [];
    for (const {name, server} of entries) {
      started.push(server);
      try {
        await server.listen();
        debug('transport server [%s] started', name);
      } catch (err) {
        debug(
          'startup failed at [%s], rolling back %d server(s)',
          name,
          started.length,
        );
        for (const s of [...started].reverse()) {
          try {
            await s.close();
          } catch (closeErr) {
            debug('rollback close failed: %O', closeErr);
          }
        }
        throw err;
      }
    }

    debug(
      'transport booter started (%d handlers, %d servers)',
      this.registry.getHandlers().size,
      entries.length,
    );
  }

  private async doStop(): Promise<void> {
    debug('transport booter stopping');

    const entries = await this.getServerEntries();
    const results = await Promise.allSettled(
      entries.map(async ({name, server}) => {
        await server.close();
        debug('transport server [%s] stopped', name);
      }),
    );

    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    if (failures.length > 0) {
      debug('%d transport server(s) failed to stop cleanly', failures.length);
      for (const failure of failures) {
        debug('transport server shutdown failure: %O', failure.reason);
      }
    }

    debug('transport booter stopped');
  }

  /**
   * Build the final `RegisteredHandler[]` snapshot from the registry
   * and hand it to the `DiscoveryService` along with the bound
   * discoverers and transport servers.
   *
   * `RegisteredHandler` entries and their `pattern` (when object-typed)
   * and `options` are deep-frozen before being handed to
   * `DiscoveryService` so consumers cannot mutate registry state.
   */
  private async populateDiscoveryService(): Promise<void> {
    const handlers: RegisteredHandler[] = [];
    for (const entry of this.registry._getEntries()) {
      const pattern =
        typeof entry.pattern === 'string'
          ? entry.pattern
          : deepFreeze({...entry.pattern});
      const options =
        entry.options === undefined
          ? undefined
          : deepFreeze({...entry.options});
      handlers.push(
        Object.freeze({
          pattern,
          transport: entry.transport,
          kind: entry.kind,
          controllerClass: entry.controllerClass,
          methodName: entry.methodName,
          discovererId: entry.discovererId,
          ...(options !== undefined ? {options} : {}),
          invoke: entry.handler,
        }),
      );
    }

    const discovererBindings = this.app.findByTag(HANDLER_DISCOVERER_TAG);
    const discoverers: HandlerDiscoverer[] = [];
    for (const binding of discovererBindings) {
      discoverers.push(await this.app.get<HandlerDiscoverer>(binding.key));
    }

    const servers: TransportServer[] = [];
    for (const binding of this.app.findByTag(TRANSPORT_SERVER_TAG)) {
      servers.push(await this.app.get<TransportServer>(binding.key));
    }

    const serializers: DiscoveredSerializer[] = [];
    for (const binding of this.app.findByTag(SERIALIZER_TAG)) {
      const instance = await this.app.get<Serializer>(binding.key);
      const transport = binding.tagMap?.[TRANSPORT_NAME_TAG];
      serializers.push({
        instance,
        transport:
          typeof transport === 'string' && transport.length > 0
            ? transport
            : undefined,
      });
    }

    const deserializers: DiscoveredDeserializer[] = [];
    for (const binding of this.app.findByTag(DESERIALIZER_TAG)) {
      const instance = await this.app.get<Deserializer>(binding.key);
      const transport = binding.tagMap?.[TRANSPORT_NAME_TAG];
      deserializers.push({
        instance,
        transport:
          typeof transport === 'string' && transport.length > 0
            ? transport
            : undefined,
      });
    }

    const service = await this.app.get(TransportBindings.DISCOVERY_SERVICE);
    service._populate(
      handlers,
      discoverers,
      servers,
      serializers,
      deserializers,
    );
  }

  /**
   * Resolve all registered transport servers with their names.
   *
   * @throws TransportConfigError When a binding is tagged as a
   *   transport server but missing the transport-name tag.
   */
  private async getServerEntries(): Promise<
    Array<{name: string; server: TransportServer}>
  > {
    const bindings = this.app.findByTag(TRANSPORT_SERVER_TAG);
    const entries: Array<{name: string; server: TransportServer}> = [];
    for (const binding of bindings) {
      const tag = binding.tagMap?.[TRANSPORT_NAME_TAG];
      if (typeof tag !== 'string' || tag.length === 0) {
        throw new TransportConfigError(
          `Transport server binding "${String(binding.key)}" is missing ` +
            `the "${TRANSPORT_NAME_TAG}" tag. Register the server through ` +
            'registerServer/registerServerClass/registerServerProvider so ' +
            'the booter can route handlers to the correct transport.',
        );
      }
      const server = await this.app.get<TransportServer>(binding.key);
      entries.push({name: tag, server});
    }
    return entries;
  }
}
