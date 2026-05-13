/**
 * Serializes outgoing messages before sending to the broker.
 *
 * Supports both sync and async implementations to allow for
 * compression, encryption, schema registry lookup, protobuf/avro
 * encoding, and streaming codecs.
 */
export interface Serializer<TInput = unknown, TOutput = unknown> {
  serialize(value: TInput): TOutput | Promise<TOutput>;
}

/**
 * Deserializes incoming messages received from the broker.
 *
 * Supports async implementations for decompression, decryption,
 * schema registry lookup, and streaming codecs.
 */
export interface Deserializer<TInput = unknown, TOutput = unknown> {
  deserialize(value: TInput): TOutput | Promise<TOutput>;
}

/**
 * Transport message envelope with metadata for tracing,
 * correlation, retries, and distributed context propagation.
 *
 * Transport adapters should serialize/deserialize this envelope
 * rather than raw payloads when full transport metadata is needed.
 */
export interface TransportPacket<T = unknown> {
  readonly pattern: string | Record<string, unknown>;
  readonly data: T;
  readonly headers?: Readonly<Record<string, string | Buffer | number | boolean>>;
  readonly correlationId?: string;
  readonly traceId?: string;
}

/**
 * Default JSON serializer. Converts objects to JSON strings.
 *
 * Wraps JSON.stringify errors into deterministic transport errors
 * instead of exposing raw runtime exceptions (circular refs, BigInt, etc.).
 *
 * Input: any JSON-serializable value.
 * Output: JSON string (compatible with all text-based transports).
 *
 * Note: Buffer/Uint8Array output for binary transports requires
 * a custom serializer implementation.
 */
export class JsonSerializer implements Serializer<unknown, string> {
  serialize(value: unknown): string {
    try {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) {
        throw new Error('value is not JSON-serializable');
      }
      return serialized;
    } catch (err) {
      throw new Error(
        `Failed to serialize outgoing message: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

/**
 * Default JSON deserializer. Parses JSON strings or Buffers to objects.
 *
 * Wraps JSON.parse errors into deterministic transport errors
 * instead of exposing raw SyntaxError from corrupted broker payloads.
 *
 * Input: string or Buffer (Node.js). For browser/WebSocket transports,
 * use string or Uint8Array with a custom deserializer.
 */
export class JsonDeserializer
  implements Deserializer<string | Buffer, unknown>
{
  deserialize(value: string | Buffer): unknown {
    try {
      const str =
        typeof value === 'string' ? value : value.toString('utf-8');
      return JSON.parse(str);
    } catch (err) {
      throw new Error(
        `Failed to deserialize incoming message: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
