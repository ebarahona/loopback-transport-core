/**
 * Unique identifier for correlating request/response messages.
 *
 * @public
 */
export interface PacketId {
  id: string;
}

/**
 * Inbound message envelope. Used for both requests and events. Events
 * omit the `id` field.
 *
 * @public
 * @typeParam T - Payload shape.
 */
export interface ReadPacket<T = unknown> {
  pattern: string;
  data: T;
}

/**
 * Outbound response envelope. Sent back for request/response patterns.
 *
 * @public
 * @typeParam T - Response value shape.
 */
export interface WritePacket<T = unknown> {
  err?: Error | string | Record<string, unknown>;
  response?: T;
  isDisposed?: boolean;
}

/**
 * A request with a correlation ID for response matching.
 *
 * @public
 */
export type OutgoingRequest = ReadPacket & PacketId;

/**
 * An event with no correlation ID (fire-and-forget).
 *
 * @public
 */
export type OutgoingEvent = ReadPacket;

/**
 * Server receives a request with correlation ID.
 *
 * @public
 */
export type IncomingRequest = ReadPacket & PacketId;

/**
 * Server receives an event (no correlation).
 *
 * @public
 */
export type IncomingEvent = ReadPacket;

/**
 * Response correlated to a request by ID.
 *
 * @public
 */
export type IncomingResponse = WritePacket & PacketId;
