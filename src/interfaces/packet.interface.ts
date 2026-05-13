/**
 * Unique identifier for correlating request/response messages.
 */
export interface PacketId {
  id: string;
}

/**
 * Inbound message envelope. Used for both requests and events.
 * Events omit the id field.
 */
export interface ReadPacket<T = unknown> {
  pattern: string;
  data: T;
}

/**
 * Outbound response envelope. Sent back for request/response patterns.
 */
export interface WritePacket<T = unknown> {
  err?: Error | string | Record<string, unknown>;
  response?: T;
  isDisposed?: boolean;
}

/**
 * A request with a correlation ID for response matching.
 */
export type OutgoingRequest = ReadPacket & PacketId;

/**
 * An event with no correlation ID (fire-and-forget).
 */
export type OutgoingEvent = ReadPacket;

/**
 * Server receives a request with correlation ID.
 */
export type IncomingRequest = ReadPacket & PacketId;

/**
 * Server receives an event (no correlation).
 */
export type IncomingEvent = ReadPacket;

/**
 * Response correlated to a request by ID.
 */
export type IncomingResponse = WritePacket & PacketId;
