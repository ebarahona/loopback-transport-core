import type {Constructor} from '@loopback/core';
import type {HandlerOptions} from '../decorators';
import type {HandlerKind} from './handler-kind';

/**
 * Metadata describing a single discovered transport handler. Returned by
 * {@link HandlerDiscoverer} implementations and consumed by `HandlerRegistry`.
 *
 * @public
 */
export interface DiscoveredHandler {
  /** Routing pattern; string for simple matches, object for structured matchers. */
  pattern: string | Record<string, unknown>;
  /** Tag of the transport server this handler is for, or `'*'` for wildcard. */
  transport: string;
  /** `'request'` = single-response handler; `'event'` = fire-and-forget, chainable. Plugins may use any string for custom kinds. */
  kind: HandlerKind;
  /** Name of the method on the controller prototype to invoke. */
  methodName: string;
  /** Discoverer-specific options forwarded to the registry / server. */
  options?: HandlerOptions;
}

/**
 * Contributes a decorator vocabulary to the transport-core handler registry.
 * Implementations are bound with the `TransportBindings.tags.HANDLER_DISCOVERER`
 * tag and consulted on every controller class at boot.
 *
 * The two built-in discoverers (`MessageHandlerDiscoverer` and
 * `EventHandlerDiscoverer`) are registered automatically by
 * `TransportComponent`. Plugins (gRPC routes, cron schedules, WebSocket
 * subscriptions, etc.) can bind additional implementations under the same
 * tag without modifying transport-core.
 *
 * @public
 */
export interface HandlerDiscoverer {
  /** Stable identifier for logging / debugging (e.g. `'message'`, `'event'`, `'grpc'`). */
  readonly id: string;
  /**
   * Read decorator metadata from a controller class and return its handlers.
   *
   * Implementations may return synchronously (`DiscoveredHandler[]`) or
   * asynchronously (`Promise<DiscoveredHandler[]>`) to support metadata
   * sources that require I/O (e.g. loading schemas from disk, querying a
   * service registry). The registry awaits the result transparently, so
   * both forms are equivalent from the caller's perspective.
   */
  discover(
    controllerClass: Constructor<unknown>,
  ): DiscoveredHandler[] | Promise<DiscoveredHandler[]>;
}
