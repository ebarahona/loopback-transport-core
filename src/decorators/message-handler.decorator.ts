import {MethodDecoratorFactory} from '@loopback/metadata';
import {
  MESSAGE_HANDLER_METADATA,
  type HandlerOptions,
  type MessageHandlerMetadata,
} from './constants';
import {normalizePattern} from '../utils';

/**
 * Mark a controller method as a request/response message handler.
 *
 * The transport server dispatches matching messages to this method and
 * returns the result to the caller.
 *
 * @public
 * @param pattern - String or object pattern to match (e.g. `'order.get'`
 *   or `{cmd: 'order.get'}`).
 * @param options - Optional transport name and extras.
 * @returns A method decorator that stores the handler metadata.
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

  const metadata: MessageHandlerMetadata = {pattern: serializedPattern};
  if (options?.transport !== undefined) {
    metadata.transport = options.transport;
  }
  if (options?.extras !== undefined) {
    metadata.extras = options.extras;
  }

  return MethodDecoratorFactory.createDecorator<MessageHandlerMetadata>(
    MESSAGE_HANDLER_METADATA,
    metadata,
  );
}
