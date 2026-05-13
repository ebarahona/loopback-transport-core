import {
  Application,
  CoreBindings,
  inject,
  lifeCycleObserver,
  LifeCycleObserver,
} from '@loopback/core';
import debugFactory from 'debug';
import {HandlerRegistry} from './registry';
import {TransportBindings, TRANSPORT_SERVER_TAG, TRANSPORT_NAME_TAG} from './keys';
import {TransportServer} from './interfaces';

const debug = debugFactory('loopback:transport:booter');

/**
 * Lifecycle observer that discovers transport handlers after boot
 * and starts/stops transport servers.
 *
 * Runs after all controllers are registered (boot phase complete).
 * Scans controllers for @messageHandler/@eventHandler metadata,
 * registers handlers with transport servers, then starts listeners.
 *
 * Startup behavior: sequential with deterministic rollback.
 * Servers start one at a time. If any fails, all previously started
 * servers are rolled back. No race between concurrent starts.
 *
 * Shutdown behavior: best-effort parallel. All servers stop concurrently.
 * Individual errors are logged but don't prevent other servers from stopping.
 *
 * Restart safety: servers are cleared of handlers before rebinding
 * to prevent duplicate registration on stop/start cycles.
 */
@lifeCycleObserver('transport')
export class TransportBooter implements LifeCycleObserver {
  constructor(
    @inject(CoreBindings.APPLICATION_INSTANCE)
    private app: Application,
    @inject(TransportBindings.HANDLER_REGISTRY)
    private registry: HandlerRegistry,
  ) {}

  async start(): Promise<void> {
    debug('transport booter starting');

    // Discover handlers from controllers (idempotent: clears first)
    await this.registry.discoverHandlers(this.app);

    // Clear existing handlers from servers before rebinding
    const entries = await this.getServerEntries();
    for (const {server} of entries) {
      server.clearHandlers();
    }

    // Bind handlers to transport servers
    await this.registry.bindToServers(this.app);

    // Start servers sequentially for deterministic rollback
    const started: Array<{name: string; server: TransportServer}> = [];
    try {
      for (const {name, server} of entries) {
        await server.listen();
        started.push({name, server});
        debug('transport server [%s] started', name);
      }
    } catch (err) {
      debug('startup failed, rolling back %d started servers', started.length);
      for (const {name, server} of started.reverse()) {
        try {
          await server.close();
          debug('transport server [%s] rolled back', name);
        } catch (closeErr) {
          debug('transport server [%s] rollback failed: %O', name, closeErr);
        }
      }
      throw err;
    }

    debug(
      'transport booter started (%d handlers, %d servers)',
      this.registry.getHandlers().size,
      entries.length,
    );
  }

  async stop(): Promise<void> {
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
   * Resolve all registered transport servers with their names.
   */
  private async getServerEntries(): Promise<
    Array<{name: string; server: TransportServer}>
  > {
    const bindings = this.app.findByTag(TRANSPORT_SERVER_TAG);
    const entries: Array<{name: string; server: TransportServer}> = [];
    for (const binding of bindings) {
      const server = await this.app.get<TransportServer>(binding.key);
      const name = String(
        binding.tagMap?.[TRANSPORT_NAME_TAG] ?? binding.key,
      );
      entries.push({name, server});
    }
    return entries;
  }
}
