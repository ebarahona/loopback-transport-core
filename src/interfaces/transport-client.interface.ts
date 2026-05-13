import {Observable} from 'rxjs';
import {TransportStatus} from './transport-server.interface';

/**
 * Interface that all transport clients must implement.
 * Used for sending messages to brokers (producer side).
 */
export interface TransportClient {
  /**
   * Establish connection to the broker.
   * Called lazily on first send/emit, or explicitly for eager connection.
   */
  connect(): Promise<void>;

  /**
   * Close the connection.
   */
  close(): Promise<void>;

  /**
   * Send a request and wait for a response (request/response pattern).
   * Returns a cold Observable: the message is sent when subscribed.
   *
   * @param pattern - String or object pattern to match on the server side
   * @param data - The message payload
   */
  send<TResult = unknown, TInput = unknown>(
    pattern: string | Record<string, unknown>,
    data: TInput,
  ): Observable<TResult>;

  /**
   * Emit an event with no response expected (fire-and-forget pattern).
   * Returns a Promise that resolves when the event is dispatched.
   *
   * @param pattern - String or object event pattern
   * @param data - The event payload
   */
  emit<TInput = unknown>(
    pattern: string | Record<string, unknown>,
    data: TInput,
  ): Promise<void>;

  /**
   * Observable stream of connection status changes.
   */
  readonly status$: Observable<TransportStatus>;

  /**
   * Access the underlying native client (e.g., KafkaJS Producer).
   */
  unwrap<T>(): T;
}
