import {MethodDecoratorFactory} from '@loopback/metadata';
import {
  MESSAGE_HANDLER_METADATA,
  MessageHandlerMetadata,
  HandlerOptions,
} from './constants';
import {normalizePattern} from '../utils';

/**
 * Mark a controller method as a request/response message handler.
 *
 * The transport server dispatches matching messages to this method
 * and returns the result to the caller.
 *
 * @param pattern - String or object pattern to match (e.g., 'order.get' or {cmd: 'order.get'})
 * @param options - Optional transport name and extras
 *
 * @example
 * ```typescript
 * // String pattern
 * @messageHandler('order.get')
 * async getOrder(@payload() data: GetOrderReq): Promise<Order> { ... }
 *
 * // Object pattern
 * @messageHandler({cmd: 'order.get', version: 2})
 * async getOrderV2(@payload() data: GetOrderReq): Promise<Order> { ... }
 *
 * // With transport targeting
 * @messageHandler('order.get', {transport: 'kafka'})
 * async getOrder(@payload() data: GetOrderReq): Promise<Order> { ... }
 * ```
 */
export function messageHandler(
  pattern: string | Record<string, unknown>,
  options?: HandlerOptions,
): MethodDecorator {
  const serializedPattern = normalizePattern(pattern);

  return MethodDecoratorFactory.createDecorator<MessageHandlerMetadata>(
    MESSAGE_HANDLER_METADATA,
    {
      pattern: serializedPattern,
      transport: options?.transport,
      extras: options?.extras,
    },
  );
}
