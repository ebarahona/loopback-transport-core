import {MetadataAccessor} from '@loopback/metadata';

/**
 * Metadata key for @messageHandler decorator.
 */
export const MESSAGE_HANDLER_METADATA = MetadataAccessor.create<
  MessageHandlerMetadata,
  MethodDecorator
>('transport:message-handler');

/**
 * Metadata key for @eventHandler decorator.
 */
export const EVENT_HANDLER_METADATA = MetadataAccessor.create<
  EventHandlerMetadata,
  MethodDecorator
>('transport:event-handler');

/**
 * Metadata stored by @messageHandler.
 */
export interface MessageHandlerMetadata {
  pattern: string;
  transport?: string;
  extras?: Record<string, unknown>;
}

/**
 * Metadata stored by @eventHandler.
 */
export interface EventHandlerMetadata {
  pattern: string;
  transport?: string;
  extras?: Record<string, unknown>;
}
