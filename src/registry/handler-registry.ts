import {
  Application,
  BindingScope,
  Context,
  injectable,
  invokeMethod,
  type Constructor,
} from '@loopback/core';
import {randomUUID} from 'crypto';
import debugFactory from 'debug';
import {isObservable, Observable} from 'rxjs';
import type {
  DiscoveredHandler,
  HandlerDiscoverer,
  HandlerKind,
} from '../discovery';
import {HANDLER_KIND_EVENT} from '../discovery';
import type {HandlerOptions} from '../decorators';
import {TransportConfigError} from '../helpers/errors';
import type {MessageHandler, TransportServer} from '../interfaces';
import {
  HANDLER_DISCOVERER_TAG,
  TRANSPORT_NAME_TAG,
  TRANSPORT_SERVER_TAG,
  TransportBindings,
} from '../keys';
import {normalizePattern} from '../utils';

const debug = debugFactory('loopback:transport:registry');

/**
 * Separator for registry keys. Uses double colon to avoid collision
 * with colons that may appear inside JSON-stringified object patterns.
 */
const KEY_SEPARATOR = '::';

/**
 * Type-safe controller instance signature.
 */
type ControllerInstance = Record<string, (...args: unknown[]) => unknown>;

/**
 * Internal registry entry tracking both the runtime handler function
 * and the metadata required to construct a {@link RegisteredHandler}
 * view for cross-cutting wrappers and the {@link DiscoveryService}.
 *
 * @internal
 */
export interface RegistryEntry {
  /** Original (unnormalized) pattern as supplied by the discoverer. */
  readonly pattern: string | Record<string, unknown>;
  /** Transport server tag (`'*'` for wildcard). */
  readonly transport: string;
  /** Handler kind. */
  readonly kind: HandlerKind;
  /** Controller class that declared this handler. */
  readonly controllerClass: Constructor<unknown>;
  /** Method name on the controller prototype. */
  readonly methodName: string;
  /** Id of the discoverer that produced this entry. */
  readonly discovererId: string;
  /** Discoverer-specific handler options. */
  readonly options?: HandlerOptions;
  /**
   * Live handler function. Mutable so the lifecycle observer can swap
   * in the wrapped version between discovery and server-binding.
   */
  handler: MessageHandler;
}

/**
 * Discovers transport handlers from controllers via every bound
 * {@link HandlerDiscoverer} and registers them with the appropriate
 * transport server.
 *
 * The two built-in vocabularies (`@messageHandler` and `@eventHandler`)
 * are implemented as default discoverers bound by `TransportComponent`.
 * Plugins (gRPC, cron, WebSocket, etc.) contribute additional decorator
 * vocabularies by binding their own `HandlerDiscoverer` implementations
 * under `TransportBindings.tags.HANDLER_DISCOVERER`.
 *
 * This class does NOT run in the constructor. It is invoked by
 * `TransportBooter` after all controllers are registered.
 *
 * Handler invocations use per-message child contexts for concurrency
 * safety. The application context is never mutated per-message.
 *
 * Context lifetime extends until the handler result (including
 * Observable streams) fully completes, errors, or times out.
 *
 * @public
 */
@injectable({scope: BindingScope.SINGLETON})
export class HandlerRegistry {
  /**
   * Registry keyed by `transport::pattern` to support the same pattern
   * on different transports without collision. Each value is the chain
   * of entries for that pattern (multiple allowed for event fan-out).
   */
  private readonly entries = new Map<string, RegistryEntry[]>();
  private discovered = false;

  /**
   * Scan all controllers in the application for transport decorators
   * and register the handlers.
   *
   * Discovers handlers by consulting every `HandlerDiscoverer` bound
   * under `TransportBindings.tags.HANDLER_DISCOVERER`, including the
   * built-in `MessageHandlerDiscoverer` and `EventHandlerDiscoverer`
   * registered by `TransportComponent`, plus any plugin-contributed
   * discoverers.
   *
   * Idempotent: clears previously discovered handlers before scanning.
   *
   * @public
   * @param app - The LoopBack application instance.
   * @returns Resolves once every controller has been scanned.
   * @throws TransportConfigError When the same pattern is targeted by
   *   both `@messageHandler` and `@eventHandler`, or by two
   *   `@messageHandler` declarations.
   */
  async discoverHandlers(app: Application): Promise<void> {
    this.entries.clear();
    this.discovered = false;

    const discovererBindings = app.findByTag(HANDLER_DISCOVERER_TAG);
    const discoverers: HandlerDiscoverer[] = [];
    for (const binding of discovererBindings) {
      discoverers.push(await app.get<HandlerDiscoverer>(binding.key));
    }

    const controllerBindings = app.findByTag('controller');
    debug(
      'scanning %d controllers with %d discoverers',
      controllerBindings.length,
      discoverers.length,
    );

    const perDiscovererCounts = new Map<string, number>();

    for (const binding of controllerBindings) {
      const controllerClass = binding.valueConstructor;
      if (!controllerClass) continue;

      const bindingKey = binding.key;
      for (const discoverer of discoverers) {
        const found = await discoverer.discover(controllerClass);
        if (found.length === 0) continue;
        perDiscovererCounts.set(
          discoverer.id,
          (perDiscovererCounts.get(discoverer.id) ?? 0) + found.length,
        );
        for (const item of found) {
          this.registerDiscovered(
            item,
            controllerClass,
            bindingKey,
            app,
            discoverer.id,
          );
        }
      }
    }

    this.discovered = true;

    if (debug.enabled) {
      for (const [id, count] of perDiscovererCounts) {
        debug('discoverer [%s] contributed %d handlers', id, count);
      }
      debug('discovered %d transport handlers total', this.entries.size);
    }
  }

  /**
   * Bind discovered handlers to the registered transport servers.
   *
   * Precedence rules:
   *
   * - Request handlers: transport-specific overrides wildcard (only one
   *   per pattern survives).
   * - Event handlers: both specific and wildcard run (fan-out).
   *
   * @public
   * @param app - The LoopBack application instance.
   * @returns Resolves once every handler has been bound.
   * @throws TransportConfigError When `discoverHandlers()` has not been
   *   called first, or when a transport server binding is missing the
   *   `TRANSPORT_NAME_TAG` tag.
   */
  async bindToServers(app: Application): Promise<void> {
    if (!this.discovered) {
      throw new TransportConfigError(
        'Cannot bind handlers to servers: discoverHandlers() has not been called.',
      );
    }

    const serverBindings = app.findByTag(TRANSPORT_SERVER_TAG);

    // Boot-time validation: surface misconfigurations loudly before any
    // handler is bound to a server. Four guards run here:
    //   1. Handlers referencing unknown transports.
    //   2. Handlers exist but no transport servers registered.
    //   3. Duplicate NAME tags across TransportServer bindings.
    //   4. TransportServer binding without a NAME tag.
    let strictBinding = true;
    if (app.isBound(TransportBindings.STRICT_BINDING)) {
      strictBinding = await app.get<boolean>(TransportBindings.STRICT_BINDING);
    }

    // Build the set of known transport names and detect duplicate NAME
    // tags (Guard 3) and missing NAME tags (Guard 4) in a single pass.
    const knownTransports = new Set<string>();
    const nameToBindingKeys = new Map<string, string[]>();
    for (const serverBinding of serverBindings) {
      const tag = serverBinding.tagMap?.[TRANSPORT_NAME_TAG];
      if (typeof tag !== 'string' || tag.length === 0) {
        debug(
          '%s is registered as a TransportServer but has no NAME tag; the server is skipped during binding and will not receive handlers (the lifecycle observer also skips it during startup)',
          String(serverBinding.key),
        );
        continue;
      }
      knownTransports.add(tag);
      const list = nameToBindingKeys.get(tag) ?? [];
      list.push(String(serverBinding.key));
      nameToBindingKeys.set(tag, list);
    }

    // Guard 3: duplicate NAME tags. Always throws regardless of strict mode.
    for (const [name, keys] of nameToBindingKeys) {
      if (keys.length > 1) {
        throw new TransportConfigError(
          `duplicate transport name "${name}": multiple TransportServer ` +
            `bindings tagged with the same NAME (${keys.join(', ')}). ` +
            'Each transport must have a unique name.',
        );
      }
    }

    // Guard 2: no transport servers but handlers exist. Always warns.
    if (serverBindings.length === 0 && this.entries.size > 0) {
      let handlerCount = 0;
      for (const chain of this.entries.values()) handlerCount += chain.length;
      debug(
        'no transport servers registered but %d handlers are bound; handlers will not receive events',
        handlerCount,
      );
    }

    // Guard 1: handlers referencing unknown transports.
    // Group orphaned entries by transport name for the error/log message.
    const orphansByTransport = new Map<
      string,
      Array<{
        controllerName: string;
        methodName: string;
        pattern: string;
        discovererId: string;
      }>
    >();
    for (const chain of this.entries.values()) {
      for (const entry of chain) {
        if (entry.transport === undefined || entry.transport === '*') continue;
        if (knownTransports.has(entry.transport)) continue;
        const list = orphansByTransport.get(entry.transport) ?? [];
        list.push({
          controllerName: entry.controllerClass.name,
          methodName: entry.methodName,
          pattern: normalizePattern(entry.pattern),
          discovererId: entry.discovererId,
        });
        orphansByTransport.set(entry.transport, list);
      }
    }

    if (orphansByTransport.size > 0) {
      const knownList =
        knownTransports.size === 0
          ? '(none)'
          : Array.from(knownTransports).join(', ');
      const summaryParts: string[] = [];
      for (const [name, list] of orphansByTransport) {
        summaryParts.push(`${name} (${list.length} handlers)`);
      }
      const detailLines: string[] = [];
      for (const [, list] of orphansByTransport) {
        for (const o of list) {
          detailLines.push(
            `    - ${o.controllerName}.${o.methodName} on pattern "${o.pattern}" (discoverer "${o.discovererId}")`,
          );
        }
      }
      const message =
        `handlers reference unknown transport(s): ${summaryParts.join(', ')}.\n` +
        `  Known transports: ${knownList}\n` +
        `  Orphaned handlers:\n${detailLines.join('\n')}`;

      if (strictBinding) {
        throw new TransportConfigError(message);
      }
      for (const [name, list] of orphansByTransport) {
        const perTransportDetails = list
          .map(
            o =>
              `    - ${o.controllerName}.${o.methodName} on pattern "${o.pattern}" (discoverer "${o.discovererId}")`,
          )
          .join('\n');
        debug(
          'handlers reference unknown transport "%s" (%d handlers).\n  Known transports: %s\n  Orphaned handlers:\n%s',
          name,
          list.length,
          knownList,
          perTransportDetails,
        );
      }
    }

    for (const serverBinding of serverBindings) {
      const tag = serverBinding.tagMap?.[TRANSPORT_NAME_TAG];
      if (typeof tag !== 'string' || tag.length === 0) {
        // Guard 4 already emitted a debug warning above; only wildcard
        // handlers can ever reach this server, so skip the routing loop.
        continue;
      }
      const transportName: string = tag;
      const server = await app.get<TransportServer>(serverBinding.key);

      // Collect handlers for this server.
      // Precedence rules differ by handler type:
      // - Request handlers: specific overrides wildcard (only one per pattern)
      // - Event handlers: both specific and wildcard run (fan-out)
      const boundRequestPatterns = new Set<string>();

      // First pass: transport-specific handlers
      for (const [registryKey, entryChain] of this.entries) {
        const first = entryChain[0];
        if (!first) continue;
        if (first.transport !== '*' && first.transport === transportName) {
          const pattern = this.extractPattern(registryKey);
          for (const entry of entryChain) {
            server.addHandler(pattern, entry.handler);
          }
          if (first.kind !== HANDLER_KIND_EVENT) {
            boundRequestPatterns.add(pattern);
          }
          debug(
            'bound handler [%s] to transport [%s] (specific)',
            pattern,
            transportName,
          );
        }
      }

      // Second pass: wildcard handlers
      // - Request handlers: skip if transport-specific already bound
      // - Event handlers: always bind (fan-out semantics)
      for (const [registryKey, entryChain] of this.entries) {
        const first = entryChain[0];
        if (!first) continue;
        if (first.transport === '*') {
          const pattern = this.extractPattern(registryKey);
          if (
            first.kind === HANDLER_KIND_EVENT ||
            !boundRequestPatterns.has(pattern)
          ) {
            for (const entry of entryChain) {
              server.addHandler(pattern, entry.handler);
            }
            debug(
              'bound handler [%s] to transport [%s] (wildcard)',
              pattern,
              transportName,
            );
          }
        }
      }
    }
  }

  /**
   * Get all discovered handlers. The returned map is a defensive copy.
   *
   * @public
   * @returns A read-only snapshot of every registered pattern and its
   *   handler chain.
   */
  getHandlers(): ReadonlyMap<string, readonly MessageHandler[]> {
    const copy = new Map<string, readonly MessageHandler[]>();
    for (const [key, entries] of this.entries) {
      copy.set(
        key,
        entries.map(e => e.handler),
      );
    }
    return copy;
  }

  /**
   * Whether {@link discoverHandlers} has been run.
   *
   * @public
   */
  isDiscovered(): boolean {
    return this.discovered;
  }

  /** @internal Package-scoped accessor used by TransportObserver to build the DiscoveryService snapshot. */
  _getEntries(): IterableIterator<RegistryEntry> {
    return this.iterateEntries();
  }

  private *iterateEntries(): IterableIterator<RegistryEntry> {
    for (const chain of this.entries.values()) {
      for (const entry of chain) {
        yield entry;
      }
    }
  }

  /**
   * Build the registry key from transport and raw pattern.
   * Normalizes the pattern (sorts object keys) before keying.
   * Format: `transport::normalizedPattern` or `*::normalizedPattern`.
   */
  private buildKey(
    transport: string | undefined,
    pattern: string | Record<string, unknown>,
  ): string {
    return `${transport ?? '*'}${KEY_SEPARATOR}${normalizePattern(pattern)}`;
  }

  /**
   * Extract the pattern portion from a registry key.
   */
  private extractPattern(key: string): string {
    const separatorIndex = key.indexOf(KEY_SEPARATOR);
    return separatorIndex >= 0
      ? key.slice(separatorIndex + KEY_SEPARATOR.length)
      : key;
  }

  /**
   * Convert a `DiscoveredHandler` into a runtime `MessageHandler`,
   * applying validation rules (no mixed kinds per pattern, no duplicate
   * request handlers) before inserting into the registry.
   */
  private registerDiscovered(
    discovered: DiscoveredHandler,
    controllerClass: Constructor<unknown>,
    controllerBindingKey: string,
    app: Application,
    discovererId: string,
  ): void {
    const isEvent = discovered.kind === HANDLER_KIND_EVENT;
    const rawTransport = discovered.transport;
    const transportForKey = rawTransport === '*' ? undefined : rawTransport;
    const key = this.buildKey(transportForKey, discovered.pattern);
    const keyOrPattern = normalizePattern(discovered.pattern);
    const existing = this.entries.get(key);
    const firstExisting = existing?.[0];

    // Reject mixed handler types on the same pattern.
    if (firstExisting && firstExisting.kind !== discovered.kind) {
      throw new TransportConfigError(
        `Cannot mix handler kinds for pattern "${keyOrPattern}" on transport "${rawTransport}": ` +
          `existing kind "${firstExisting.kind}" from ` +
          `${firstExisting.controllerClass.name}.${firstExisting.methodName} ` +
          `(discoverer "${firstExisting.discovererId}") conflicts with ` +
          `new kind "${discovered.kind}" from ` +
          `${controllerClass.name}.${discovered.methodName} ` +
          `(discoverer "${discovererId}").`,
      );
    }

    // Reject duplicate request/response handlers.
    if (firstExisting && !isEvent) {
      throw new TransportConfigError(
        `Duplicate request handler for pattern "${keyOrPattern}" on transport "${rawTransport}": ` +
          `pattern is already bound to ` +
          `${firstExisting.controllerClass.name}.${firstExisting.methodName} ` +
          `contributed by discoverer "${firstExisting.discovererId}".`,
      );
    }

    const handler: MessageHandler = this.createHandler(
      controllerBindingKey,
      discovered.methodName,
      app,
    );
    handler.isEventHandler = isEvent;
    if (transportForKey !== undefined) {
      handler.transport = transportForKey;
    }
    if (discovered.options?.extras !== undefined) {
      handler.extras = discovered.options.extras;
    }

    const entry: RegistryEntry = {
      pattern: discovered.pattern,
      transport: rawTransport,
      kind: discovered.kind,
      controllerClass,
      methodName: discovered.methodName,
      discovererId,
      ...(discovered.options !== undefined
        ? {options: discovered.options}
        : {}),
      handler,
    };

    const decoratorLabel = `@${discovererId}Handler`;
    if (existing) {
      if (firstExisting && firstExisting.discovererId !== entry.discovererId) {
        debug(
          'event handler chain on pattern %s (transport %s) now spans discoverers: %s + %s',
          keyOrPattern,
          rawTransport,
          firstExisting.discovererId,
          entry.discovererId,
        );
      }
      existing.push(entry);
      debug(
        'chained %s [%s] on %s.%s',
        decoratorLabel,
        keyOrPattern,
        controllerClass.name,
        discovered.methodName,
      );
    } else {
      this.entries.set(key, [entry]);
      debug(
        'discovered %s [%s] on %s.%s',
        decoratorLabel,
        normalizePattern(discovered.pattern),
        controllerClass.name,
        discovered.methodName,
      );
    }
  }

  /**
   * Create a handler function that invokes the controller method
   * through LoopBack's native invocation pipeline.
   *
   * Each invocation creates a uniquely named child Context from the
   * application context. Per-message bindings (payload, transport
   * context) are scoped to the child context and cannot collide with
   * concurrent messages.
   *
   * The child context lifetime extends until the handler result fully
   * resolves. For Observable results, the context stays open until the
   * Observable completes, errors, or times out.
   */
  private createHandler(
    controllerBindingKey: string,
    methodName: string,
    app: Application,
  ): MessageHandler {
    const handler: MessageHandler = async (
      data: unknown,
      context?: unknown,
    ) => {
      const invocationCtx = new Context(
        app,
        `transport-invocation-${randomUUID()}`,
      );

      // Idempotent cleanup guard: Context.close() is synchronous but
      // may be reached from multiple paths (error + teardown) for
      // Observables.
      let closed = false;
      const cleanup = (): void => {
        if (!closed) {
          closed = true;
          invocationCtx.close();
        }
      };

      try {
        invocationCtx.bind(TransportBindings.CURRENT_PAYLOAD).to(data);
        invocationCtx.bind(TransportBindings.CURRENT_CONTEXT).to(context);

        const controller =
          await invocationCtx.get<ControllerInstance>(controllerBindingKey);

        const method = controller[methodName];
        if (typeof method !== 'function') {
          throw new TransportConfigError(
            `Transport handler method "${methodName}" not found on controller "${controllerBindingKey}"`,
          );
        }

        // Invoke through LoopBack's method invocation pipeline so we
        // honour parameter injection, interceptors, and other framework
        // invocation semantics.
        const result = await invokeMethod(
          controller,
          methodName,
          invocationCtx,
          [data, context],
        );

        // For Observable results, defer context cleanup until stream completes.
        if (isObservable(result)) {
          const obs = result as Observable<unknown>;
          return new Observable(subscriber => {
            const subscription = obs.subscribe({
              next: value => subscriber.next(value),
              error: err => {
                subscriber.error(err);
                cleanup();
              },
              complete: () => {
                subscriber.complete();
                cleanup();
              },
            });
            return () => {
              subscription.unsubscribe();
              cleanup();
            };
          });
        }

        // For non-Observable results, close context immediately.
        cleanup();
        return result;
      } catch (err) {
        cleanup();
        throw err;
      }
    };
    return handler;
  }
}
