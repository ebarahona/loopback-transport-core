import {MethodDecoratorFactory} from '@loopback/metadata';
import {MESSAGE_HANDLER_METADATA, MessageHandlerMetadata} from './constants';

/**
 * Mark a controller method as a request/response message handler.
 *
 * The transport server dispatches matching messages to this method
 * and returns the result to the caller.
 *
 * @param pattern - The message pattern to match (e.g., 'order.get')
 * @param options - Optional transport name and extras
 *
 * @example
 * ```typescript
 * class OrderController {
 *   @messageHandler('order.get')
 *   async getOrder(@payload() data: GetOrderReq): Promise<Order> {
 *     return this.orderService.findById(data.id);
 *   }
 * }
 * ```
 */
export function messageHandler(
  pattern: string,
  options?: {transport?: string; extras?: Record<string, unknown>},
): MethodDecorator {
  return MethodDecoratorFactory.createDecorator<MessageHandlerMetadata>(
    MESSAGE_HANDLER_METADATA.key,
    {
      pattern,
      transport: options?.transport,
      extras: options?.extras,
    },
  );
}
