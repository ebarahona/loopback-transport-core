import {BindingScope, injectable} from '@loopback/core';
import type {TransportServer} from '../interfaces';
import type {Deserializer, Serializer} from '../serializers';
import type {HandlerDiscoverer} from './handler-discoverer';
import type {HandlerKind} from './handler-kind';
import type {RegisteredHandler} from './registered-handler';

/**
 * Internal record describing a tag-discovered serializer binding. The
 * `transport` field is `undefined` for generic bindings (no
 * `TRANSPORT_NAME_TAG`) and the transport name string for
 * transport-scoped bindings.
 *
 * @internal
 */
export interface DiscoveredSerializer {
  readonly instance: Serializer;
  readonly transport: string | undefined;
}

/**
 * Internal record describing a tag-discovered deserializer binding.
 * See {@link DiscoveredSerializer}.
 *
 * @internal
 */
export interface DiscoveredDeserializer {
  readonly instance: Deserializer;
  readonly transport: string | undefined;
}

/**
 * Universal discovery service for the transport-core handler graph.
 *
 * Bound at `TransportBindings.DISCOVERY_SERVICE` and populated by the
 * transport lifecycle observer after discovery and wrapping complete.
 * Cross-cutting plugins inject this service to enumerate every handler
 * the application contains, regardless of which {@link HandlerDiscoverer}
 * found it or which {@link TransportServer} will serve it.
 *
 * Equivalent in concept to NestJS's `DiscoveryService` from
 * `@nestjs/core`.
 *
 * The service stores an immutable snapshot. Every accessor returns a
 * defensive copy so callers cannot mutate internal state.
 *
 * @public
 */
@injectable({scope: BindingScope.SINGLETON})
export class DiscoveryService {
  private handlers: readonly RegisteredHandler[] = Object.freeze([]);
  private discoverers: readonly HandlerDiscoverer[] = Object.freeze([]);
  private servers: readonly TransportServer[] = Object.freeze([]);
  private serializerEntries: ReadonlyArray<DiscoveredSerializer> =
    Object.freeze([]);
  private deserializerEntries: ReadonlyArray<DiscoveredDeserializer> =
    Object.freeze([]);

  /**
   * Every handler discovered at boot.
   *
   * @public
   * @returns Frozen, defensively-copied snapshot of all registered
   *   handlers.
   */
  getHandlers(): readonly RegisteredHandler[] {
    return Object.freeze(this.handlers.slice());
  }

  /**
   * Handlers bound to a specific transport server (e.g. `'kafka'`,
   * `'redis-pubsub'`).
   *
   * @public
   * @param transport - Transport server tag.
   */
  getHandlersForTransport(transport: string): readonly RegisteredHandler[] {
    return Object.freeze(this.handlers.filter(h => h.transport === transport));
  }

  /**
   * Handlers of a given kind.
   *
   * @public
   * @param kind - `'request'` or `'event'`.
   */
  getHandlersByKind(kind: HandlerKind): readonly RegisteredHandler[] {
    return Object.freeze(this.handlers.filter(h => h.kind === kind));
  }

  /**
   * Handlers produced by a specific discoverer (by
   * `HandlerDiscoverer.id`).
   *
   * @public
   * @param discovererId - Stable id of the discoverer (e.g. `'message'`).
   */
  getHandlersByDiscoverer(discovererId: string): readonly RegisteredHandler[] {
    return Object.freeze(
      this.handlers.filter(h => h.discovererId === discovererId),
    );
  }

  /**
   * All bound `HandlerDiscoverer` instances (default + plugin-contributed).
   *
   * @public
   */
  getDiscoverers(): readonly HandlerDiscoverer[] {
    return Object.freeze(this.discoverers.slice());
  }

  /**
   * All bound `TransportServer` instances.
   *
   * @public
   */
  getTransportServers(): readonly TransportServer[] {
    return Object.freeze(this.servers.slice());
  }

  /**
   * All bound `Serializer` instances discovered by tag at boot.
   *
   * Includes both generic and transport-scoped bindings. Use
   * {@link getSerializerForTransport} to resolve which serializer a
   * specific transport server would use.
   *
   * @public
   */
  getSerializers(): readonly Serializer[] {
    return Object.freeze(this.serializerEntries.map(entry => entry.instance));
  }

  /**
   * All bound `Deserializer` instances discovered by tag at boot.
   *
   * Includes both generic and transport-scoped bindings. Use
   * {@link getDeserializerForTransport} to resolve which deserializer
   * a specific transport server would use.
   *
   * @public
   */
  getDeserializers(): readonly Deserializer[] {
    return Object.freeze(this.deserializerEntries.map(entry => entry.instance));
  }

  /**
   * Resolve the serializer that would be used by a server with the
   * given transport name, applying the same transport-scoped \> generic
   * precedence as `ServerBase.resolveSerializer`.
   *
   * Returns `undefined` if no tagged binding exists, in which case the
   * subclass default on the server would be used.
   *
   * @public
   * @param transport - Transport name tag (e.g. `'kafka'`).
   */
  getSerializerForTransport(transport: string): Serializer | undefined {
    const scoped = this.serializerEntries.find(
      entry => entry.transport === transport,
    );
    if (scoped !== undefined) return scoped.instance;
    const generic = this.serializerEntries.find(
      entry => entry.transport === undefined,
    );
    return generic?.instance;
  }

  /**
   * Resolve the deserializer that would be used by a server with the
   * given transport name. See {@link getSerializerForTransport} for
   * precedence rules.
   *
   * @public
   * @param transport - Transport name tag (e.g. `'kafka'`).
   */
  getDeserializerForTransport(transport: string): Deserializer | undefined {
    const scoped = this.deserializerEntries.find(
      entry => entry.transport === transport,
    );
    if (scoped !== undefined) return scoped.instance;
    const generic = this.deserializerEntries.find(
      entry => entry.transport === undefined,
    );
    return generic?.instance;
  }

  /**
   * Replace the service's internal snapshot. Called by the transport
   * lifecycle observer after discovery and handler wrapping complete.
   *
   * @internal Package-internal contract between the lifecycle observer
   *   and the service. Not part of the consumer-facing API.
   */
  _populate(
    handlers: readonly RegisteredHandler[],
    discoverers: readonly HandlerDiscoverer[],
    servers: readonly TransportServer[],
    serializers: readonly DiscoveredSerializer[] = [],
    deserializers: readonly DiscoveredDeserializer[] = [],
  ): void {
    this.handlers = Object.freeze(handlers.slice());
    this.discoverers = Object.freeze(discoverers.slice());
    this.servers = Object.freeze(servers.slice());
    this.serializerEntries = Object.freeze(
      serializers.map(entry => Object.freeze({...entry})),
    );
    this.deserializerEntries = Object.freeze(
      deserializers.map(entry => Object.freeze({...entry})),
    );
  }
}
