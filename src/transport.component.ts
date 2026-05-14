import type {Component, Constructor, LifeCycleObserver} from '@loopback/core';
import {Binding, BindingScope} from '@loopback/core';
import {
  DiscoveryService,
  EventHandlerDiscoverer,
  MessageHandlerDiscoverer,
} from './discovery';
import {TransportBindings} from './keys';
import {HandlerRegistry} from './registry';
import {TransportBooter} from './transport.observer';

/**
 * LoopBack 4 component that enables transport-agnostic microservices.
 *
 * Registers the core transport extension points:
 *
 * - `HandlerRegistry` (singleton): discovers and manages transport handlers.
 * - `MessageHandlerDiscoverer` and `EventHandlerDiscoverer` (singletons):
 *   default `HandlerDiscoverer` implementations tagged with
 *   `TransportBindings.tags.HANDLER_DISCOVERER`. Plugins contributing a
 *   custom decorator vocabulary bind their own discoverer under the
 *   same tag.
 * - `DiscoveryService` (singleton): universal read-only enumeration of
 *   every discovered handler. Populated by `TransportBooter` after
 *   discovery and wrapping complete.
 * - `TransportBooter` (lifecycle observer): wires handlers to servers at boot.
 *
 * The component intentionally stays thin. Discovery, validation, server
 * binding, and listener lifecycle management live in the
 * `TransportBooter` / `HandlerRegistry` layer so the component remains
 * a stable package boundary for transport adapters.
 *
 * Usage:
 *
 * ```typescript
 * const app = new Application();
 * app.component(TransportComponent);
 * ```
 *
 * Transport adapters can build on top of this component by contributing
 * server bindings and configuration under `TransportBindings`.
 *
 * @public
 */
export class TransportComponent implements Component {
  readonly bindings: Binding<unknown>[] = [
    Binding.bind(TransportBindings.HANDLER_REGISTRY)
      .toClass(HandlerRegistry)
      .inScope(BindingScope.SINGLETON),
    Binding.bind(TransportBindings.DISCOVERY_SERVICE)
      .toClass(DiscoveryService)
      .inScope(BindingScope.SINGLETON),
    Binding.bind('transport.discoverer.message')
      .toClass(MessageHandlerDiscoverer)
      .tag(TransportBindings.tags.HANDLER_DISCOVERER)
      .inScope(BindingScope.SINGLETON),
    Binding.bind('transport.discoverer.event')
      .toClass(EventHandlerDiscoverer)
      .tag(TransportBindings.tags.HANDLER_DISCOVERER)
      .inScope(BindingScope.SINGLETON),
    Binding.bind(TransportBindings.STRICT_BINDING).to(true),
  ];

  readonly lifeCycleObservers: Constructor<LifeCycleObserver>[] = [
    TransportBooter,
  ];
}
