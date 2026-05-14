import type {Observable} from 'rxjs';
import type {TransportStatus} from './transport-server.interface';

/**
 * Interface that all transport clients must implement. Used for
 * sending messages to brokers (producer side).
 *
 * @public
 */
export interface TransportClient {
  /**
   * Establish connection to the broker. Called lazily on first
   * send/emit, or explicitly for eager connection.
   *
   * @returns Resolves when the connection is healthy.
   */
  connect(): Promise<void>;

  /**
   * Close the connection.
   *
   * @returns Resolves once the connection has been torn down.
   */
  close(): Promise<void>;

  /**
   * Send a request and wait for a response (request/response
   * pattern). Returns a cold Observable: the message is sent when
   * subscribed.
   *
   * @typeParam TResult - Expected response shape.
   * @typeParam TInput - Caller-provided payload shape.
   * @param pattern - String or object pattern to match on the server side.
   * @param data - The message payload.
   */
  send<TResult = unknown, TInput = unknown>(
    pattern: string | Record<string, unknown>,
    data: TInput,
  ): Observable<TResult>;

  /**
   * Emit an event with no response expected (fire-and-forget pattern).
   * Returns a Promise that resolves when the event is dispatched.
   *
   * @typeParam TInput - Caller-provided payload shape.
   * @param pattern - String or object event pattern.
   * @param data - The event payload.
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
   * Access the underlying native client (e.g. a KafkaJS `Producer`).
   *
   * @typeParam T - Caller-asserted native client shape.
   */
  unwrap<T>(): T;
}
