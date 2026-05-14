import {describe, it, expect} from 'vitest';
import {JsonSerializer, JsonDeserializer} from '../../serializers';

describe('JsonSerializer', () => {
  it('serializes objects to JSON strings', () => {
    const serializer = new JsonSerializer();
    expect(serializer.serialize({id: 1, name: 'test'})).toBe(
      '{"id":1,"name":"test"}',
    );
  });

  it('serializes arrays', () => {
    const serializer = new JsonSerializer();
    expect(serializer.serialize([1, 2, 3])).toBe('[1,2,3]');
  });

  it('serializes primitives', () => {
    const serializer = new JsonSerializer();
    expect(serializer.serialize('hello')).toBe('"hello"');
    expect(serializer.serialize(42)).toBe('42');
    expect(serializer.serialize(null)).toBe('null');
  });

  it('wraps circular reference errors', () => {
    const serializer = new JsonSerializer();
    const circular: Record<string, unknown> = {a: 1};
    circular.self = circular;
    expect(() => serializer.serialize(circular)).toThrow(
      'Failed to serialize outgoing message',
    );
  });

  it('wraps BigInt errors', () => {
    const serializer = new JsonSerializer();
    expect(() =>
      serializer.serialize({value: BigInt(9007199254740991)}),
    ).toThrow('Failed to serialize outgoing message');
  });
});

describe('JsonDeserializer', () => {
  it('deserializes JSON strings to objects', () => {
    const deserializer = new JsonDeserializer();
    expect(deserializer.deserialize('{"id":1}')).toEqual({id: 1});
  });

  it('deserializes Buffer to objects', () => {
    const deserializer = new JsonDeserializer();
    const buffer = Buffer.from('{"id":1}', 'utf-8');
    expect(deserializer.deserialize(buffer)).toEqual({id: 1});
  });

  it('deserializes arrays', () => {
    const deserializer = new JsonDeserializer();
    expect(deserializer.deserialize('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('wraps corrupted payload errors', () => {
    const deserializer = new JsonDeserializer();
    expect(() => deserializer.deserialize('not valid json')).toThrow(
      'Failed to deserialize incoming message',
    );
  });

  it('wraps empty payload errors', () => {
    const deserializer = new JsonDeserializer();
    expect(() => deserializer.deserialize('')).toThrow(
      'Failed to deserialize incoming message',
    );
  });

  it('wraps corrupted Buffer errors', () => {
    const deserializer = new JsonDeserializer();
    const buffer = Buffer.from('}{broken', 'utf-8');
    expect(() => deserializer.deserialize(buffer)).toThrow(
      'Failed to deserialize incoming message',
    );
  });
});
