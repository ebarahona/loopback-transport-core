import {Observable} from 'rxjs';
import {MessageHandler} from './message-handler.interface';

/**
 * Transport connection status.
 */
export type TransportStatus =
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'error';

/**
 * Interface that all transport servers must implement.
 * Each transport (Kafka, RabbitMQ, gRPC, MQTT, NATS) provides
 * a concrete implementation.
 */
export interface TransportServer {
  /**
   * Start listening for messages.
   */
  listen(): Promise<void>;

  /**
   * Stop listening and close connections.
   */
  close(): Promise<void>;

  /**
   * Observable stream of connection status changes.
   */
  readonly status$: Observable<TransportStatus>;

  /**
   * Access the underlying native client (e.g., KafkaJS Consumer).
   */
  unwrap<T>(): T;

  /**
   * Register a message handler for a pattern.
   */
  addHandler(pattern: string, handler: MessageHandler): void;

  /**
   * Get all registered handlers.
   */
  getHandlers(): Map<string, MessageHandler>;
}
