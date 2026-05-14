import {describe, it, expect, beforeEach} from 'vitest';
import {Application, Binding, BindingScope} from '@loopback/core';
import {
  CloudEventsSerializer,
  DESERIALIZER_TAG,
  SERIALIZER_TAG,
  ServerBase,
  TRANSPORT_NAME_TAG,
  TransportBindings,
  TransportComponent,
  registerServer,
  type Deserializer,
  type Serializer,
} from '../../index';

// ---- Fake plugin-supplied codecs ----

/**
 * Hypothetical MessagePack serializer contributed by a plugin via
 * the {@link SERIALIZER_TAG} extension point. The body of `serialize`
 * is a stand-in; the test only cares about the resolved identity.
 */
class MsgPackSerializer implements Serializer<unknown, Buffer> {
  readonly id = 'msgpack-serializer';

  serialize(value: unknown): Buffer {
    return Buffer.from(JSON.stringify(value));
  }
}

class MsgPackDeserializer implements Deserializer<Buffer, unknown> {
  readonly id = 'msgpack-deserializer';

  deserialize(value: Buffer): unknown {
    return JSON.parse(value.toString('utf-8'));
  }
}

/**
 * Hypothetical Avro serializer scoped to the `'kafka'` transport.
 * A plugin contributing this would tag its binding with both
 * `SERIALIZER_TAG` and `TRANSPORT_NAME_TAG: 'kafka'`.
 */
class AvroKafkaSerializer implements Serializer<unknown, Buffer> {
  readonly id = 'avro-kafka-serializer';

  serialize(value: unknown): Buffer {
    return Buffer.from(JSON.stringify(value));
  }
}

class AvroKafkaDeserializer implements Deserializer<Buffer, unknown> {
  readonly id = 'avro-kafka-deserializer';

  deserialize(value: Buffer): unknown {
    return JSON.parse(value.toString('utf-8'));
  }
}

// ---- Minimal in-memory server (kept identical to other integration tests) ----

class InMemoryServer extends ServerBase {
  started = false;

  async listen(): Promise<void> {
    this.started = true;
    this.setStatus('connected');
  }

  async close(): Promise<void> {
    this.started = false;
    this.setStatus('disconnected');
  }

  unwrap<T>(): T {
    return undefined as T;
  }

  // Expose the protected fields so the test can assert the resolved
  // identity without poking the underlying `serializer` slot directly.
  getResolvedSerializer(): Serializer {
    return this.serializer;
  }

  getResolvedDeserializer(): Deserializer {
    return this.deserializer;
  }
}

/**
 * Subclass with a non-default subclass-level serializer (CloudEvents).
 * Used to assert the fallback case: when no tagged binding exists,
 * the subclass's `protected serializer` field is preserved.
 */
class CloudEventsServer extends ServerBase {
  started = false;

  constructor() {
    super({
      serializer: new CloudEventsSerializer({
        source: 'urn:test:cloudevents',
        typePrefix: 'com.example.test',
      }),
    });
  }

  async listen(): Promise<void> {
    this.started = true;
    this.setStatus('connected');
  }

  async close(): Promise<void> {
    this.started = false;
    this.setStatus('disconnected');
  }

  unwrap<T>(): T {
    return undefined as T;
  }

  getResolvedSerializer(): Serializer {
    return this.serializer;
  }
}

// ---- Tests ----

describe('Serializer/Deserializer extension point: tag-based pluggability', () => {
  let app: Application;

  beforeEach(() => {
    app = new Application();
    app.component(TransportComponent);
  });

  it('picks a generic tagged serializer over the subclass default', async () => {
    const generic = new MsgPackSerializer();
    const genericDe = new MsgPackDeserializer();

    app.add(
      Binding.bind('transport.serializer.msgpack')
        .to(generic)
        .tag(SERIALIZER_TAG)
        .inScope(BindingScope.SINGLETON),
    );
    app.add(
      Binding.bind('transport.deserializer.msgpack')
        .to(genericDe)
        .tag(DESERIALIZER_TAG)
        .inScope(BindingScope.SINGLETON),
    );

    const server = new InMemoryServer();
    registerServer(app, 'memory', server);

    await app.start();
    try {
      expect(server.getResolvedSerializer()).toBe(generic);
      expect(server.getResolvedDeserializer()).toBe(genericDe);

      const service = await app.get(TransportBindings.DISCOVERY_SERVICE);
      expect(service.getSerializers()).toHaveLength(1);
      expect(service.getDeserializers()).toHaveLength(1);
      expect(service.getSerializerForTransport('memory')).toBe(generic);
      expect(service.getDeserializerForTransport('memory')).toBe(genericDe);
    } finally {
      await app.stop();
    }
  });

  it('prefers transport-scoped binding over generic binding', async () => {
    const generic = new MsgPackSerializer();
    const genericDe = new MsgPackDeserializer();
    const kafkaScoped = new AvroKafkaSerializer();
    const kafkaScopedDe = new AvroKafkaDeserializer();

    // Generic binding — applies to every transport without a scoped match.
    app.add(
      Binding.bind('transport.serializer.msgpack')
        .to(generic)
        .tag(SERIALIZER_TAG)
        .inScope(BindingScope.SINGLETON),
    );
    app.add(
      Binding.bind('transport.deserializer.msgpack')
        .to(genericDe)
        .tag(DESERIALIZER_TAG)
        .inScope(BindingScope.SINGLETON),
    );

    // Kafka-scoped binding — only applies to the 'kafka' transport.
    app.add(
      Binding.bind('transport.serializer.avro.kafka')
        .to(kafkaScoped)
        .tag(SERIALIZER_TAG)
        .tag({[TRANSPORT_NAME_TAG]: 'kafka'})
        .inScope(BindingScope.SINGLETON),
    );
    app.add(
      Binding.bind('transport.deserializer.avro.kafka')
        .to(kafkaScopedDe)
        .tag(DESERIALIZER_TAG)
        .tag({[TRANSPORT_NAME_TAG]: 'kafka'})
        .inScope(BindingScope.SINGLETON),
    );

    const kafkaServer = new InMemoryServer();
    const otherServer = new InMemoryServer();
    registerServer(app, 'kafka', kafkaServer);
    registerServer(app, 'other', otherServer);

    await app.start();
    try {
      // Kafka picks the kafka-scoped binding.
      expect(kafkaServer.getResolvedSerializer()).toBe(kafkaScoped);
      expect(kafkaServer.getResolvedDeserializer()).toBe(kafkaScopedDe);

      // The other server falls back to the generic binding.
      expect(otherServer.getResolvedSerializer()).toBe(generic);
      expect(otherServer.getResolvedDeserializer()).toBe(genericDe);

      // DiscoveryService returns the same answer as the server.
      const service = await app.get(TransportBindings.DISCOVERY_SERVICE);
      expect(service.getSerializerForTransport('kafka')).toBe(kafkaScoped);
      expect(service.getDeserializerForTransport('kafka')).toBe(kafkaScopedDe);
      expect(service.getSerializerForTransport('other')).toBe(generic);
      expect(service.getDeserializerForTransport('other')).toBe(genericDe);

      // Enumerations include every tagged binding.
      expect(service.getSerializers()).toHaveLength(2);
      expect(service.getDeserializers()).toHaveLength(2);
    } finally {
      await app.stop();
    }
  });

  it('falls back to the subclass default when no tagged binding exists', async () => {
    const server = new CloudEventsServer();
    registerServer(app, 'memory', server);

    await app.start();
    try {
      // Subclass default — set via `super({serializer: ...})` — must be
      // preserved when no tagged binding matches.
      expect(server.getResolvedSerializer()).toBeInstanceOf(
        CloudEventsSerializer,
      );

      const service = await app.get(TransportBindings.DISCOVERY_SERVICE);
      expect(service.getSerializers()).toHaveLength(0);
      expect(service.getDeserializers()).toHaveLength(0);
      // No tagged binding -> DiscoveryService reports `undefined` so
      // callers know to consult the server's subclass default.
      expect(service.getSerializerForTransport('memory')).toBeUndefined();
      expect(service.getDeserializerForTransport('memory')).toBeUndefined();
    } finally {
      await app.stop();
    }
  });

  it('DiscoveryService.getSerializerForTransport agrees with ServerBase.resolveSerializer', async () => {
    const generic = new MsgPackSerializer();
    const kafkaScoped = new AvroKafkaSerializer();

    app.add(
      Binding.bind('transport.serializer.msgpack')
        .to(generic)
        .tag(SERIALIZER_TAG)
        .inScope(BindingScope.SINGLETON),
    );
    app.add(
      Binding.bind('transport.serializer.avro.kafka')
        .to(kafkaScoped)
        .tag(SERIALIZER_TAG)
        .tag({[TRANSPORT_NAME_TAG]: 'kafka'})
        .inScope(BindingScope.SINGLETON),
    );

    const kafkaServer = new InMemoryServer();
    const rabbitServer = new InMemoryServer();
    registerServer(app, 'kafka', kafkaServer);
    registerServer(app, 'rabbitmq', rabbitServer);

    await app.start();
    try {
      const service = await app.get(TransportBindings.DISCOVERY_SERVICE);
      expect(service.getSerializerForTransport('kafka')).toBe(
        kafkaServer.getResolvedSerializer(),
      );
      expect(service.getSerializerForTransport('rabbitmq')).toBe(
        rabbitServer.getResolvedSerializer(),
      );
    } finally {
      await app.stop();
    }
  });
});
