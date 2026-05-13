import {MethodDecoratorFactory} from '@loopback/metadata';
import {
  EVENT_HANDLER_METADATA,
  EventHandlerMetadata,
  HandlerOptions,
} from './constants';
import {normalizePattern} from '../utils';

/**
 * Mark a controller method as a fire-and-forget event handler.
 *
 * The transport server dispatches matching events to this method.
 * No response is sent back to the emitter.
 *
 * Multiple event handlers can be registered for the same pattern.
 * They are chained and all execute.
 *
 * @param pattern - String or object pattern to match (e.g., 'order.placed' or {event: 'order.placed'})
 * @param options - Optional transport name and extras
 *
 * @example
 * ```typescript
 * // String pattern
 * @eventHandler('order.placed')
 * async handleOrder(@payload() data: OrderDto): Promise<void> { ... }
 *
 * // With transport and extras override
 * @eventHandler('payment.received', {
 *   transport: 'redis',
 *   extras: {mode: 'stream', consumerGroup: 'payment-workers'},
 * })
 * async handlePayment(@payload() data: PaymentDto): Promise<void> { ... }
 * ```
 */
export function eventHandler(
  pattern: string | Record<string, unknown>,
  options?: HandlerOptions,
): MethodDecorator {
  const serializedPattern = normalizePattern(pattern);

  return MethodDecoratorFactory.createDecorator<EventHandlerMetadata>(
    EVENT_HANDLER_METADATA,
    {
      pattern: serializedPattern,
      transport: options?.transport,
      extras: options?.extras,
    },
  );
}
