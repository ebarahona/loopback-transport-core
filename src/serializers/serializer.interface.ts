import {TransportSerializationError} from '../helpers/errors';

/**
 * Serializes outgoing messages before sending to the broker.
 *
 * Supports both sync and async implementations to allow for
 * compression, encryption, schema registry lookup, protobuf/avro
 * encoding, and streaming codecs.
 *
 * @public
 * @typeParam TInput - Type of values fed to the serializer.
 * @typeParam TOutput - Type of values produced by the serializer.
 */
export interface Serializer<TInput = unknown, TOutput = unknown> {
  serialize(value: TInput): TOutput | Promise<TOutput>;
}

/**
 * Deserializes incoming messages received from the broker.
 *
 * Supports async implementations for decompression, decryption, schema
 * registry lookup, and streaming codecs.
 *
 * @public
 * @typeParam TInput - Wire format consumed by the deserializer.
 * @typeParam TOutput - Decoded message shape.
 */
export interface Deserializer<TInput = unknown, TOutput = unknown> {
  deserialize(value: TInput): TOutput | Promise<TOutput>;
}

/**
 * Transport message envelope with metadata for tracing, correlation,
 * retries, and distributed context propagation.
 *
 * Transport adapters should serialize/deserialize this envelope rather
 * than raw payloads when full transport metadata is needed.
 *
 * @public
 * @typeParam T - The payload shape.
 */
export interface TransportPacket<T = unknown> {
  readonly pattern: string | Record<string, unknown>;
  readonly data: T;
  readonly headers?: Readonly<
    Record<string, string | Buffer | number | boolean>
  >;
  readonly correlationId?: string;
  readonly traceId?: string;
}

/**
 * Default JSON serializer. Converts objects to JSON strings.
 *
 * Wraps `JSON.stringify` errors into deterministic transport errors
 * instead of exposing raw runtime exceptions (circular refs, BigInt,
 * etc.).
 *
 * Input: any JSON-serializable value.
 * Output: JSON string (compatible with all text-based transports).
 *
 * Note: Buffer/Uint8Array output for binary transports requires a
 * custom serializer implementation.
 *
 * @public
 */
export class JsonSerializer implements Serializer<unknown, string> {
  /**
   * Serialize `value` to a JSON string.
   *
   * @public
   * @param value - Any JSON-serializable value.
   * @returns The serialized JSON payload.
   * @throws TransportSerializationError When the value contains
   *   circular references, BigInt, or otherwise cannot be encoded.
   *   The original error is attached via `cause`.
   */
  serialize(value: unknown): string {
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(value);
    } catch (err) {
      throw new TransportSerializationError(
        `Failed to serialize outgoing message: ${
          err instanceof Error ? err.message : String(err)
        }`,
        {cause: err},
      );
    }
    if (serialized === undefined) {
      throw new TransportSerializationError(
        'Failed to serialize outgoing message: value is not JSON-serializable',
      );
    }
    return serialized;
  }
}

/**
 * Default JSON deserializer. Parses JSON strings or Buffers to objects.
 *
 * Wraps `JSON.parse` errors into deterministic transport errors instead
 * of exposing raw `SyntaxError` from corrupted broker payloads.
 *
 * Input: string or `Buffer` (Node.js). For browser/WebSocket transports,
 * use string or `Uint8Array` with a custom deserializer.
 *
 * @public
 */
export class JsonDeserializer implements Deserializer<
  string | Buffer,
  unknown
> {
  /**
   * Decode a JSON payload from a string or `Buffer`.
   *
   * @public
   * @param value - The wire-format payload.
   * @returns The decoded JavaScript value.
   * @throws TransportSerializationError When the payload is not valid
   *   JSON. The original `SyntaxError` is attached via `cause`.
   */
  deserialize(value: string | Buffer): unknown {
    try {
      const str = typeof value === 'string' ? value : value.toString('utf-8');
      return JSON.parse(str);
    } catch (err) {
      throw new TransportSerializationError(
        `Failed to deserialize incoming message: ${
          err instanceof Error ? err.message : String(err)
        }`,
        {cause: err},
      );
    }
  }
}
