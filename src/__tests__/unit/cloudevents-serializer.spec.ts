import {describe, it, expect} from 'vitest';
import {
  CloudEventsDeserializer,
  CloudEventsSerializer,
} from '../../serializers';
import {TransportSerializationError} from '../../helpers/errors';

const baseOptions = {
  source: '/orders',
  typePrefix: 'com.example.order',
};

describe('CloudEventsSerializer (structured mode)', () => {
  it('round-trips a TransportPacket preserving pattern and data', () => {
    const serializer = new CloudEventsSerializer(baseOptions);
    const deserializer = new CloudEventsDeserializer();
    const buf = serializer.serialize({pattern: 'placed', data: {id: 7}});
    const out = deserializer.deserialize(buf);
    expect(out.pattern).toBe('com.example.order.placed');
    expect(out.data).toEqual({id: 7});
  });
});

describe('CloudEventsSerializer (binary mode)', () => {
  it('round-trips a TransportPacket preserving pattern and data', () => {
    const serializer = new CloudEventsSerializer({
      ...baseOptions,
      mode: 'binary',
    });
    const deserializer = new CloudEventsDeserializer();
    const buf = serializer.serialize({pattern: 'placed', data: {id: 7}});
    const out = deserializer.deserialize(buf);
    expect(out.pattern).toBe('com.example.order.placed');
    expect(out.data).toEqual({id: 7});
  });
});

describe('CloudEventsSerializer (id generation)', () => {
  it('generates a UUID by default', () => {
    const serializer = new CloudEventsSerializer(baseOptions);
    const deserializer = new CloudEventsDeserializer();
    const out = deserializer.deserialize(
      serializer.serialize({pattern: 'placed', data: {}}),
    );
    expect(out.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('uses a custom idGenerator when supplied', () => {
    const serializer = new CloudEventsSerializer({
      ...baseOptions,
      idGenerator: () => 'custom-id-42',
    });
    const deserializer = new CloudEventsDeserializer();
    const out = deserializer.deserialize(
      serializer.serialize({pattern: 'placed', data: {}}),
    );
    expect(out.correlationId).toBe('custom-id-42');
  });
});

describe('CloudEventsSerializer (attributes)', () => {
  it('prefixes the packet pattern with typePrefix in the CE type', () => {
    const serializer = new CloudEventsSerializer({
      source: '/orders',
      typePrefix: 'com.example',
    });
    const deserializer = new CloudEventsDeserializer();
    const out = deserializer.deserialize(
      serializer.serialize({pattern: 'order.placed', data: {}}),
    );
    expect(out.pattern).toBe('com.example.order.placed');
  });

  it('writes options.source into the envelope', () => {
    const serializer = new CloudEventsSerializer(baseOptions);
    const buf = serializer.serialize({pattern: 'placed', data: {id: 1}});
    // Structured-mode body holds the CE JSON; source must round-trip.
    const envelope = JSON.parse(buf.toString('utf-8')) as {body: string};
    const ce = JSON.parse(envelope.body) as {source: string};
    expect(ce.source).toBe('/orders');
  });
});

describe('CloudEventsDeserializer (error wrapping)', () => {
  it('wraps malformed input in TransportSerializationError', () => {
    const deserializer = new CloudEventsDeserializer();
    expect(() =>
      deserializer.deserialize(Buffer.from('not valid json', 'utf-8')),
    ).toThrow(TransportSerializationError);
  });
});
