import {
  Application,
  CoreBindings,
  inject,
  lifeCycleObserver,
  LifeCycleObserver,
} from '@loopback/core';
import debugFactory from 'debug';
import {HandlerRegistry} from './registry';
import {TransportBindings} from './keys';
import {TransportServer} from './interfaces';

const debug = debugFactory('loopback:transport:booter');

/**
 * Lifecycle observer that discovers transport handlers after boot
 * and starts/stops transport servers.
 *
 * Runs after all controllers are registered (boot phase complete).
 * Scans controllers for @messageHandler/@eventHandler metadata,
 * registers handlers with transport servers, then starts listeners.
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

    // Discover handlers from controllers
    await this.registry.discoverHandlers(this.app);

    // Bind handlers to transport servers
    await this.registry.bindToServers(this.app);

    // Start all transport servers
    const serverBindings = this.app.findByTag('transport-server');
    for (const binding of serverBindings) {
      const server = await this.app.get<TransportServer>(binding.key);
      await server.listen();
      debug(
        'transport server [%s] started',
        binding.tagMap?.transport ?? binding.key,
      );
    }

    debug(
      'transport booter started (%d handlers, %d servers)',
      this.registry.getHandlers().size,
      serverBindings.length,
    );
  }

  async stop(): Promise<void> {
    debug('transport booter stopping');

    const serverBindings = this.app.findByTag('transport-server');
    for (const binding of serverBindings) {
      const server = await this.app.get<TransportServer>(binding.key);
      await server.close();
      debug(
        'transport server [%s] stopped',
        binding.tagMap?.transport ?? binding.key,
      );
    }

    debug('transport booter stopped');
  }
}
