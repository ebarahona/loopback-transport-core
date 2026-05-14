import type {Constructor} from '@loopback/core';
import type {HandlerOptions} from '../decorators';
import type {MessageHandler} from '../interfaces';
import type {HandlerKind} from './handler-kind';

/**
 * Immutable view of a transport handler that was discovered at boot.
 * Returned by {@link DiscoveryService} for cross-cutting plugins
 * (metrics, tracing, audit, schema generation) to enumerate the
 * full handler graph without coupling to specific transports or
 * decorator vocabularies.
 *
 * @public
 */
export interface RegisteredHandler {
  /** Routing pattern (string or structured object). */
  readonly pattern: string | Record<string, unknown>;
  /** Transport server tag this handler is bound to. */
  readonly transport: string;
  /** Handler kind. */
  readonly kind: HandlerKind;
  /** Controller class that declared this handler. */
  readonly controllerClass: Constructor<unknown>;
  /** Method name on the controller prototype. */
  readonly methodName: string;
  /** Identifier of the {@link HandlerDiscoverer} that produced this entry. */
  readonly discovererId: string;
  /** Discoverer-specific handler options. */
  readonly options?: HandlerOptions;
  /**
   * Handler function as produced by the registry's `createHandler()`.
   * The LB4 interceptor chain (including any `@globalInterceptor`s) runs
   * at invocation time inside this function.
   */
  readonly invoke: MessageHandler;
}
