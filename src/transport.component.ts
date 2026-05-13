import {Binding, BindingScope, Component} from '@loopback/core';
import {HandlerRegistry} from './registry';
import {TransportBooter} from './transport-booter';
import {TransportBindings} from './keys';

/**
 * LoopBack 4 component that enables transport-agnostic microservices.
 *
 * Registers:
 * - HandlerRegistry (singleton): discovers and manages transport handlers
 * - TransportBooter (lifecycle observer): wires handlers to servers at boot
 *
 * The booter runs after all controllers are registered, scans for
 * @messageHandler/@eventHandler metadata, binds handlers to transport
 * servers, and starts/stops listeners with the application lifecycle.
 *
 * Usage:
 * ```typescript
 * const app = new Application();
 * app.component(TransportComponent);
 * ```
 */
export class TransportComponent implements Component {
  bindings: Binding[] = [
    Binding.bind(TransportBindings.HANDLER_REGISTRY)
      .toClass(HandlerRegistry)
      .inScope(BindingScope.SINGLETON),
  ];

  lifeCycleObservers = [TransportBooter];
}
