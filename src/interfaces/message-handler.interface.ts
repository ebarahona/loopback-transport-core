import {Observable} from 'rxjs';

/**
 * Function that handles an incoming message.
 */
export interface MessageHandler<
  TInput = unknown,
  TContext = unknown,
  TResult = unknown,
> {
  (data: TInput, ctx?: TContext):
    | Promise<TResult>
    | Promise<Observable<TResult>>
    | TResult
    | Observable<TResult>;

  /**
   * True for @eventHandler, false for @messageHandler.
   */
  isEventHandler?: boolean;

  /**
   * Target transport name (e.g., 'kafka', 'rabbitmq').
   * First-class property for routing, not buried in extras.
   */
  transport?: string;

  /**
   * Transport-specific metadata (e.g., QoS for MQTT, consumer group for Kafka).
   * Does not contain framework routing metadata (use transport field instead).
   */
  extras?: Readonly<Record<string, unknown>>;
}
