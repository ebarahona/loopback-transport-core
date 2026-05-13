/**
 * Normalize a pattern to a consistent string key.
 *
 * Strings pass through as-is. Objects are deep-sorted by key
 * and JSON-stringified for consistent lookup regardless of
 * property insertion order.
 *
 * Only JSON-compatible values are accepted: strings, finite numbers,
 * booleans, null, plain objects, and arrays. Non-JSON values
 * (undefined, functions, symbols, NaN, Infinity, BigInt, Date,
 * RegExp, Map, Set, class instances) are rejected deterministically.
 *
 * Shared (non-circular) object references are allowed. Only true
 * cycles throw.
 *
 * @throws Error on circular references, non-JSON values, or non-plain objects.
 */
export function normalizePattern(
  pattern: string | Record<string, unknown>,
): string {
  if (typeof pattern === 'string') return pattern;
  return stableStringify(pattern, new Set<object>());
}

function isPlainObject(obj: unknown): obj is Record<string, unknown> {
  if (typeof obj !== 'object' || obj === null) return false;
  const proto = Object.getPrototypeOf(obj);
  return proto === Object.prototype || proto === null;
}

function stableStringify(obj: unknown, seen: Set<object>): string {
  if (obj === null) return 'null';

  const type = typeof obj;

  if (type === 'string' || type === 'boolean') {
    return JSON.stringify(obj);
  }

  if (type === 'number') {
    const n = obj as number;
    if (!Number.isFinite(n)) {
      throw new Error(
        `Pattern contains ${String(n)}, which is not JSON-serializable`,
      );
    }
    return JSON.stringify(n);
  }

  if (
    type === 'undefined' ||
    type === 'function' ||
    type === 'symbol' ||
    type === 'bigint'
  ) {
    throw new Error(
      `Pattern contains ${type} value, which is not JSON-serializable`,
    );
  }

  // At this point, type === 'object' and obj !== null
  const o = obj as object;

  if (seen.has(o)) {
    throw new Error('Circular reference detected in pattern object');
  }

  if (Array.isArray(o)) {
    seen.add(o);
    const result =
      '[' + o.map(item => stableStringify(item, seen)).join(',') + ']';
    seen.delete(o);
    return result;
  }

  if (!isPlainObject(o)) {
    const name = o.constructor?.name ?? 'unknown';
    throw new Error(
      `Pattern contains ${name} instance, which is not a plain object`,
    );
  }

  seen.add(o);
  const keys = Object.keys(o).sort();
  const pairs = keys.map(
    key => `${JSON.stringify(key)}:${stableStringify(o[key], seen)}`,
  );
  const result = '{' + pairs.join(',') + '}';
  seen.delete(o);
  return result;
}
