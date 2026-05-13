import {
  Binding,
  BindingScope,
  Component,
  Constructor,
  LifeCycleObserver,
} from '@loopback/core';
import {TransportBindings} from './keys';
import {HandlerRegistry} from './registry';
import {TransportBooter} from './transport-booter';

/**
 * LoopBack 4 component that enables transport-agnostic microservices.
 *
 * Registers the core transport extension points:
 * - HandlerRegistry (singleton): discovers and manages transport handlers
 * - TransportBooter (lifecycle observer): wires handlers to servers at boot
 *
 * The component intentionally stays thin. Discovery, validation,
 * server binding, and listener lifecycle management live in the
 * TransportBooter/HandlerRegistry layer so the component remains a
 * stable package boundary for transport adapters.
 *
 * Usage:
 * ```typescript
 * const app = new Application();
 * app.component(TransportComponent);
 * ```
 *
 * Transport adapters can build on top of this component by contributing
 * server bindings and configuration under TransportBindings.
 */
export class TransportComponent implements Component {
  readonly bindings: Binding<unknown>[] = [
    Binding.bind(TransportBindings.HANDLER_REGISTRY)
      .toClass(HandlerRegistry)
      .inScope(BindingScope.SINGLETON),
  ];

  readonly lifeCycleObservers: Constructor<LifeCycleObserver>[] = [
    TransportBooter,
  ];
}
