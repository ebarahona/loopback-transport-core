import type {Application} from '@loopback/core';
import type {Observable} from 'rxjs';
import type {MessageHandler} from './message-handler.interface';

/**
 * Transport connection status.
 *
 * @public
 */
export type TransportStatus =
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'error';

/**
 * Interface that all transport servers must implement. Each transport
 * (Kafka, RabbitMQ, gRPC, MQTT, NATS) provides a concrete
 * implementation.
 *
 * @public
 */
export interface TransportServer {
  /**
   * Start listening for messages.
   *
   * @returns Resolves once the server is ready to receive.
   */
  listen(): Promise<void>;

  /**
   * Stop listening and close connections.
   *
   * @returns Resolves once the server has been torn down.
   */
  close(): Promise<void>;

  /**
   * Observable stream of connection status changes.
   */
  readonly status$: Observable<TransportStatus>;

  /**
   * Access the underlying native client (e.g. a KafkaJS `Consumer`).
   *
   * @typeParam T - Caller-asserted native client shape.
   */
  unwrap<T>(): T;

  /**
   * Register a message handler for a pattern.
   */
  addHandler(pattern: string, handler: MessageHandler): void;

  /**
   * Get all registered handlers. Returns a read-only view. Each
   * pattern maps to an array of handlers (one for request/response,
   * potentially many for event fan-out).
   */
  getHandlers(): ReadonlyMap<string, readonly MessageHandler[]>;

  /**
   * Remove all registered handlers. Called before rebinding on
   * restart to prevent duplicate registration.
   */
  clearHandlers(): void;

  /**
   * Resolve the serializer/deserializer pair for this server from the app
   * container. Precedence is transport-scoped, then generic, then the
   * implementation default. Called by the transport lifecycle observer between
   * `bindToServers` and `listen()`. Plugins contribute tag-based serializers
   * via {@link SERIALIZER_TAG} / {@link DESERIALIZER_TAG}; implementation-level
   * defaults are honored when no tagged binding matches.
   *
   * Implementations that do not need tag-based serializer resolution
   * (servers that hardcode their codec) may provide a no-op implementation.
   * Subclasses of {@link ServerBase} inherit a default implementation.
   *
   * @public
   */
  resolveSerializer(app: Application): Promise<void>;
}
