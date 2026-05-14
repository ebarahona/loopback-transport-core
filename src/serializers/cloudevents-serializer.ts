import {randomUUID} from 'crypto';
import {CloudEvent, HTTP} from 'cloudevents';
import {TransportSerializationError} from '../helpers/errors';
import {normalizePattern} from '../utils';
import type {
  Deserializer,
  Serializer,
  TransportPacket,
} from './serializer.interface';

/**
 * Options for {@link CloudEventsSerializer} / {@link CloudEventsDeserializer}.
 *
 * @experimental
 */
export interface CloudEventsSerializerOptions {
  /**
   * The event source URI (RFC 3986). Required.
   *
   * @example `/orders`
   * @example `urn:example:com:orders`
   */
  source: string;
  /**
   * The CloudEvents `type` attribute prefix. The packet's pattern is
   * appended, separated by a dot.
   *
   * @example `com.example.order` with pattern `placed` becomes
   *   `com.example.order.placed`.
   */
  typePrefix: string;
  /**
   * Encoding mode. `binary` puts the CloudEvents attributes in transport
   * headers (suitable for Kafka, AMQP, HTTP binary content mode);
   * `structured` embeds the attributes in the JSON payload itself
   * (broker-agnostic, the default).
   *
   * @defaultValue `structured`
   */
  mode?: 'binary' | 'structured';
  /**
   * Optional generator for the CloudEvents `id` attribute.
   *
   * @defaultValue `crypto.randomUUID()`
   */
  idGenerator?: () => string;
  /**
   * Optional generator for the CloudEvents `time` attribute.
   *
   * @defaultValue `new Date().toISOString()`
   */
  timeGenerator?: () => string;
}

/**
 * Wire envelope shared by structured and binary modes. Captures the
 * `{headers, body}` shape produced by the CloudEvents HTTP binding so a
 * single `Buffer` payload can round-trip without losing attributes.
 *
 * Adapters that expose native transport headers (Kafka, AMQP, HTTP) can
 * lift `envelope.headers` onto the wire metadata and emit just
 * `envelope.body` to keep the payload clean — see {@link
 * CloudEventsDeserializer.deserialize} for the inverse.
 *
 * @internal
 */
interface CloudEventsEnvelope {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

function patternToString(pattern: string | Record<string, unknown>): string {
  return typeof pattern === 'string' ? pattern : normalizePattern(pattern);
}

/**
 * Serializes a {@link TransportPacket} into a CloudEvents 1.0 envelope
 * encoded as a JSON `Buffer`.
 *
 * The packet's `pattern` becomes `${typePrefix}.${pattern}` in the
 * CloudEvents `type` attribute. The packet's `correlationId` (if
 * present) becomes the CloudEvents `id`; otherwise a UUID is generated.
 *
 * Structured mode (default) embeds attributes in the JSON payload and
 * is broker-agnostic. Binary mode places attributes in transport
 * headers and keeps the payload clean; over a Buffer-only wire the
 * `{headers, body}` envelope is JSON-encoded so the inverse
 * deserializer can recover the attributes.
 *
 * Underlying SDK errors are wrapped in {@link
 * TransportSerializationError} via `cause`.
 *
 * @experimental
 */
export class CloudEventsSerializer implements Serializer<
  TransportPacket,
  Buffer
> {
  private readonly mode: 'binary' | 'structured';
  private readonly idGenerator: () => string;
  private readonly timeGenerator: () => string;

  constructor(private readonly options: CloudEventsSerializerOptions) {
    this.mode = options.mode ?? 'structured';
    this.idGenerator = options.idGenerator ?? (() => randomUUID());
    this.timeGenerator =
      options.timeGenerator ?? (() => new Date().toISOString());
  }

  /**
   * Encode a {@link TransportPacket} as a CloudEvents 1.0 JSON envelope.
   *
   * @param packet - The transport packet to encode.
   * @returns The serialized envelope as a UTF-8 `Buffer`.
   * @throws {@link TransportSerializationError} When the CloudEvents
   *   SDK rejects the event (invalid attributes, non-serializable
   *   payload, etc.). The original error is attached via `cause`.
   */
  serialize(packet: TransportPacket): Buffer {
    try {
      const event = new CloudEvent({
        id: packet.correlationId ?? this.idGenerator(),
        type: `${this.options.typePrefix}.${patternToString(packet.pattern)}`,
        source: this.options.source,
        time: this.timeGenerator(),
        data: packet.data,
      });
      const message =
        this.mode === 'binary' ? HTTP.binary(event) : HTTP.structured(event);
      const envelope: CloudEventsEnvelope = {
        headers: message.headers as Record<
          string,
          string | string[] | undefined
        >,
        body:
          typeof message.body === 'string'
            ? message.body
            : Buffer.isBuffer(message.body)
              ? message.body.toString('utf-8')
              : message.body,
      };
      return Buffer.from(JSON.stringify(envelope), 'utf-8');
    } catch (err) {
      throw new TransportSerializationError(
        `Failed to serialize CloudEvent: ${
          err instanceof Error ? err.message : String(err)
        }`,
        {cause: err},
      );
    }
  }
}

/**
 * Deserializes a CloudEvents 1.0 JSON envelope (as produced by
 * {@link CloudEventsSerializer}) back into a {@link TransportPacket}.
 *
 * Supports both `binary` and `structured` encodings — the mode is
 * detected from the envelope's content-type header by the CloudEvents
 * SDK. The CloudEvent `type` attribute is restored as the packet's
 * `pattern` and the CloudEvent `id` becomes the packet's
 * `correlationId`.
 *
 * Underlying SDK errors are wrapped in {@link
 * TransportSerializationError} via `cause`.
 *
 * @experimental
 */
export class CloudEventsDeserializer implements Deserializer<
  Buffer,
  TransportPacket
> {
  /**
   * Decode a CloudEvents 1.0 JSON envelope.
   *
   * @param buf - The wire-format envelope.
   * @returns The decoded {@link TransportPacket}.
   * @throws {@link TransportSerializationError} When the envelope is
   *   malformed, not a CloudEvent, or fails schema validation. The
   *   original error is attached via `cause`.
   */
  deserialize(buf: Buffer): TransportPacket {
    try {
      const envelope = JSON.parse(buf.toString('utf-8')) as CloudEventsEnvelope;
      if (
        envelope === null ||
        typeof envelope !== 'object' ||
        typeof envelope.headers !== 'object' ||
        envelope.headers === null
      ) {
        throw new Error('envelope must be a {headers, body} object');
      }
      const event = HTTP.toEvent(envelope);
      // toEvent returns CloudEventV1<unknown> | CloudEventV1<unknown>[].
      // Batch mode is not produced by this serializer; reject it
      // rather than silently dropping all but the first event.
      if (Array.isArray(event)) {
        throw new Error('batch CloudEvents are not supported');
      }
      return {
        pattern: event.type,
        data: event.data,
        correlationId: event.id,
      };
    } catch (err) {
      throw new TransportSerializationError(
        `Failed to deserialize CloudEvent: ${
          err instanceof Error ? err.message : String(err)
        }`,
        {cause: err},
      );
    }
  }
}
