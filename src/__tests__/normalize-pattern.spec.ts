import {describe, it, expect} from 'vitest';
import {normalizePattern} from '../utils';

describe('normalizePattern', () => {
  it('passes strings through unchanged', () => {
    expect(normalizePattern('order.get')).toBe('order.get');
  });

  it('sorts object keys deterministically', () => {
    expect(normalizePattern({b: 2, a: 1})).toBe('{"a":1,"b":2}');
    expect(normalizePattern({a: 1, b: 2})).toBe('{"a":1,"b":2}');
  });

  it('deep sorts nested objects', () => {
    expect(
      normalizePattern({meta: {z: 1, a: 2}, cmd: 'get'}),
    ).toBe('{"cmd":"get","meta":{"a":2,"z":1}}');
  });

  it('handles arrays without sorting elements', () => {
    expect(normalizePattern({tags: [3, 1, 2]})).toBe('{"tags":[3,1,2]}');
  });

  it('handles null values', () => {
    expect(normalizePattern({a: null})).toBe('{"a":null}');
  });

  it('handles boolean and number values', () => {
    expect(normalizePattern({flag: true, count: 42})).toBe(
      '{"count":42,"flag":true}',
    );
  });

  // ---- Shared references (non-circular) ----

  it('allows shared object references across sibling branches', () => {
    const shared = {x: 1};
    expect(normalizePattern({a: shared, b: shared})).toBe(
      '{"a":{"x":1},"b":{"x":1}}',
    );
  });

  // ---- Circular references ----

  it('throws on circular reference', () => {
    const pattern: Record<string, unknown> = {a: 1};
    pattern.self = pattern;
    expect(() => normalizePattern(pattern)).toThrow('Circular reference');
  });

  // ---- Non-JSON-serializable values ----

  it('throws on undefined values', () => {
    expect(() => normalizePattern({a: undefined})).toThrow(
      'not JSON-serializable',
    );
  });

  it('throws on function values', () => {
    expect(() => normalizePattern({a: () => {}})).toThrow(
      'not JSON-serializable',
    );
  });

  it('throws on symbol values', () => {
    expect(() => normalizePattern({a: Symbol('test')})).toThrow(
      'not JSON-serializable',
    );
  });

  it('throws on NaN', () => {
    expect(() => normalizePattern({a: NaN})).toThrow('not JSON-serializable');
  });

  it('throws on Infinity', () => {
    expect(() => normalizePattern({a: Infinity})).toThrow(
      'not JSON-serializable',
    );
  });

  it('throws on -Infinity', () => {
    expect(() => normalizePattern({a: -Infinity})).toThrow(
      'not JSON-serializable',
    );
  });

  it('throws on BigInt', () => {
    expect(() => normalizePattern({a: BigInt(42)})).toThrow(
      'not JSON-serializable',
    );
  });

  it('throws on Date instances', () => {
    expect(() => normalizePattern({a: new Date()})).toThrow(
      'not a plain object',
    );
  });

  it('throws on RegExp instances', () => {
    expect(() => normalizePattern({a: /test/})).toThrow('not a plain object');
  });

  it('throws on Map instances', () => {
    expect(() => normalizePattern({a: new Map()})).toThrow(
      'not a plain object',
    );
  });

  it('throws on Set instances', () => {
    expect(() => normalizePattern({a: new Set()})).toThrow(
      'not a plain object',
    );
  });

  it('throws on class instances', () => {
    class Foo {
      x = 1;
    }
    expect(() => normalizePattern({a: new Foo()})).toThrow(
      'not a plain object',
    );
  });
});
