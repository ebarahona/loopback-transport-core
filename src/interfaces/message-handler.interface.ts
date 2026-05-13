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
   * Next handler in the chain (for multiple event handlers on the same pattern).
   */
  next?: MessageHandler<TInput, TContext, TResult>;

  /**
   * True for @eventHandler, false for @messageHandler.
   */
  isEventHandler?: boolean;

  /**
   * Transport-specific metadata (e.g., QoS for MQTT, consumer group for Kafka).
   */
  extras?: Record<string, unknown>;
}
