import {MethodDecoratorFactory} from '@loopback/metadata';
import {EVENT_HANDLER_METADATA, EventHandlerMetadata} from './constants';

/**
 * Mark a controller method as a fire-and-forget event handler.
 *
 * The transport server dispatches matching events to this method.
 * No response is sent back to the emitter.
 *
 * Multiple event handlers can be registered for the same pattern.
 * They are chained and all execute.
 *
 * @param pattern - The event pattern to match (e.g., 'order.placed')
 * @param options - Optional transport name and extras
 *
 * @example
 * ```typescript
 * class OrderController {
 *   @eventHandler('order.placed')
 *   async handleOrderPlaced(@payload() data: OrderDto): Promise<void> {
 *     await this.notificationService.send(data);
 *   }
 * }
 * ```
 */
export function eventHandler(
  pattern: string,
  options?: {transport?: string; extras?: Record<string, unknown>},
): MethodDecorator {
  return MethodDecoratorFactory.createDecorator<EventHandlerMetadata>(
    EVENT_HANDLER_METADATA.key,
    {
      pattern,
      transport: options?.transport,
      extras: options?.extras,
    },
  );
}
