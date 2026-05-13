/**
 * Serializes outgoing messages before sending to the broker.
 */
export interface Serializer<TInput = unknown, TOutput = unknown> {
  serialize(value: TInput): TOutput;
}

/**
 * Deserializes incoming messages received from the broker.
 */
export interface Deserializer<TInput = unknown, TOutput = unknown> {
  deserialize(value: TInput): TOutput | Promise<TOutput>;
}

/**
 * Default JSON serializer. Converts objects to JSON strings.
 */
export class JsonSerializer implements Serializer<unknown, string> {
  serialize(value: unknown): string {
    return JSON.stringify(value);
  }
}

/**
 * Default JSON deserializer. Parses JSON strings to objects.
 */
export class JsonDeserializer implements Deserializer<string | Buffer, unknown> {
  deserialize(value: string | Buffer): unknown {
    const str = typeof value === 'string' ? value : value.toString('utf-8');
    return JSON.parse(str);
  }
}
