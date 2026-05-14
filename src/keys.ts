import {BindingKey} from '@loopback/core';
import type {DiscoveryService} from './discovery';
import type {TransportClient, TransportServer} from './interfaces';
import type {HandlerRegistry} from './registry';

/**
 * Tag attached to every transport server binding so the booter can
 * discover servers via `app.findByTag(TRANSPORT_SERVER_TAG)`.
 *
 * Equivalent to `TransportBindings.tags.SERVER` — both forms are
 * supported.
 *
 * @public
 */
export const TRANSPORT_SERVER_TAG = 'transport-server';

/**
 * Tag key carrying the transport name (e.g. `'kafka'`, `'rabbitmq'`)
 * on a transport server binding. The booter reads this to route
 * transport-specific handlers.
 *
 * Equivalent to `TransportBindings.tags.NAME` — both forms are
 * supported.
 *
 * @public
 */
export const TRANSPORT_NAME_TAG = 'transport';

/**
 * Tag attached to every `HandlerDiscoverer` binding so the handler
 * registry can discover them via
 * `app.findByTag(HANDLER_DISCOVERER_TAG)`.
 *
 * Equivalent to `TransportBindings.tags.HANDLER_DISCOVERER` — both
 * forms are supported.
 *
 * @public
 */
export const HANDLER_DISCOVERER_TAG = 'transport-handler-discoverer';

/**
 * Tag identifying bindings that contribute a
 * {@link Serializer | `Serializer`} to the transport layer.
 *
 * Combine with {@link TRANSPORT_NAME_TAG} (set to a transport name
 * string such as `'kafka'`) to scope the serializer to a specific
 * transport. Bindings tagged with `SERIALIZER_TAG` but without a
 * `TRANSPORT_NAME_TAG` tag are treated as generic and apply to any
 * transport that does not have a transport-scoped match.
 *
 * Resolution precedence at boot (most specific wins):
 *
 * 1. Transport-scoped binding (`SERIALIZER_TAG` + matching
 *    `TRANSPORT_NAME_TAG`).
 * 2. Generic binding (`SERIALIZER_TAG` only).
 * 3. Subclass default set via the `protected serializer` field on
 *    `ServerBase`.
 *
 * Equivalent to `TransportBindings.tags.SERIALIZER` — both forms are
 * supported.
 *
 * @public
 */
export const SERIALIZER_TAG = 'transport-serializer';

/**
 * Tag identifying bindings that contribute a
 * {@link Deserializer | `Deserializer`} to the transport layer.
 *
 * See {@link SERIALIZER_TAG} for scoping rules and resolution
 * precedence.
 *
 * Equivalent to `TransportBindings.tags.DESERIALIZER` — both forms are
 * supported.
 *
 * @public
 */
export const DESERIALIZER_TAG = 'transport-deserializer';

/**
 * Binding keys and tag constants for the transport core.
 *
 * Registration helpers (`registerServer`, `registerServerClass`,
 * `registerServerProvider`) live in `helpers/register-server.ts` and
 * are exported from the package root.
 *
 * @public
 */
export namespace TransportBindings {
  /**
   * Tag values used by transport server bindings. Prefer these typed
   * accessors over the raw string exports.
   *
   * @public
   */
  export namespace tags {
    /**
     * Tag attached to every transport server binding.
     */
    export const SERVER = TRANSPORT_SERVER_TAG;

    /**
     * Tag key holding the transport name on a server binding.
     */
    export const NAME = TRANSPORT_NAME_TAG;

    /**
     * Tag attached to every `HandlerDiscoverer` binding. Plugins that
     * contribute a custom decorator vocabulary bind their discoverer
     * under this tag so the handler registry consults it during boot.
     */
    export const HANDLER_DISCOVERER = HANDLER_DISCOVERER_TAG;

    /**
     * Tag attached to every `Serializer` binding. Plugins contribute a
     * tag-based serializer via this tag; combine with {@link NAME} to
     * scope the serializer to a specific transport. See
     * {@link SERIALIZER_TAG} for resolution precedence.
     */
    export const SERIALIZER = SERIALIZER_TAG;

    /**
     * Tag attached to every `Deserializer` binding. See
     * {@link DESERIALIZER_TAG} for resolution precedence.
     */
    export const DESERIALIZER = DESERIALIZER_TAG;
  }

  /**
   * Binding key for the singleton handler registry that owns the
   * mapping between message patterns and controller method handlers.
   */
  export const HANDLER_REGISTRY = BindingKey.create<HandlerRegistry>(
    'transport.handler-registry',
  );

  /**
   * Binding key for the singleton {@link DiscoveryService}. Populated
   * by the transport lifecycle observer after discovery and wrapping
   * complete. Cross-cutting plugins inject this service to enumerate
   * every handler the application contains.
   */
  export const DISCOVERY_SERVICE = BindingKey.create<DiscoveryService>(
    'transport.discovery-service',
  );

  /**
   * Binding key for the current message payload. The handler registry
   * binds this per-message inside the invocation child context.
   */
  export const CURRENT_PAYLOAD = BindingKey.create<unknown>(
    'transport.current.payload',
  );

  /**
   * Binding key for the transport-specific context object passed to the
   * handler (Kafka context, RabbitMQ context, etc.). The handler
   * registry binds this per-message inside the invocation child context.
   */
  export const CURRENT_CONTEXT = BindingKey.create<unknown>(
    'transport.current.context',
  );

  /**
   * Controls whether boot-time binding validation throws on misconfigurations
   * (handler references unknown transport) or emits debug logs instead.
   *
   * Default: `true` (throw). Set to `false` via
   * `app.bind(TransportBindings.STRICT_BINDING).to(false)` before `app.start()`
   * if you need to register handlers ahead of their transport servers.
   *
   * @public
   */
  export const STRICT_BINDING = BindingKey.create<boolean>(
    'transport.strict-binding',
  );

  /**
   * Binding key prefix for transport configurations.
   */
  export const CONFIG_PREFIX = 'transport.config';

  /**
   * Binding key prefix for transport clients.
   */
  export const CLIENT_PREFIX = 'transport.client';

  /**
   * Binding key prefix for transport servers.
   */
  export const SERVER_PREFIX = 'transport.server';

  /**
   * Get a binding key for a specific transport's configuration.
   *
   * @param transport - Transport name (e.g. `'kafka'`).
   * @returns The typed binding key.
   */
  export function config(
    transport: string,
  ): BindingKey<Record<string, unknown>> {
    return BindingKey.create(`${CONFIG_PREFIX}.${transport}`);
  }

  /**
   * Get a binding key for a specific transport's client.
   *
   * @param transport - Transport name (e.g. `'kafka'`).
   * @returns The typed binding key.
   */
  export function client(transport: string): BindingKey<TransportClient> {
    return BindingKey.create(`${CLIENT_PREFIX}.${transport}`);
  }

  /**
   * Get a binding key for a specific transport's server.
   *
   * @param transport - Transport name (e.g. `'kafka'`).
   * @returns The typed binding key.
   */
  export function server(transport: string): BindingKey<TransportServer> {
    return BindingKey.create(`${SERVER_PREFIX}.${transport}`);
  }
}
