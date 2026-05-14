import {MetadataAccessor} from '@loopback/metadata';

/**
 * Options for the `@messageHandler` and `@eventHandler` decorators.
 * Extracted as a named type for public API stability.
 *
 * @public
 */
export interface HandlerOptions {
  transport?: string;
  extras?: Readonly<Record<string, unknown>>;
}

/**
 * Metadata stored by `@messageHandler`.
 *
 * Pattern is stored as a normalized string via `normalizePattern()`.
 * Object patterns are deep-sorted by key and stringified so that the
 * same logical pattern always produces the same string key regardless
 * of property insertion order.
 *
 * @public
 */
export interface MessageHandlerMetadata {
  pattern: string;
  transport?: string;
  extras?: Readonly<Record<string, unknown>>;
}

/**
 * Metadata stored by `@eventHandler`.
 *
 * Pattern is stored as a normalized string via `normalizePattern()`.
 * Object patterns are deep-sorted by key and stringified.
 *
 * @public
 */
export interface EventHandlerMetadata {
  pattern: string;
  transport?: string;
  extras?: Readonly<Record<string, unknown>>;
}

/**
 * Metadata key for the `@messageHandler` decorator.
 *
 * @public
 */
export const MESSAGE_HANDLER_METADATA = MetadataAccessor.create<
  MessageHandlerMetadata,
  MethodDecorator
>('transport:message-handler');

/**
 * Metadata key for the `@eventHandler` decorator.
 *
 * @public
 */
export const EVENT_HANDLER_METADATA = MetadataAccessor.create<
  EventHandlerMetadata,
  MethodDecorator
>('transport:event-handler');
