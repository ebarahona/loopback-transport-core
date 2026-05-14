/**
 * Typed error classes for the transport core.
 *
 * Each class extends `Error` and overrides `name` so consumers can match
 * failures either by `instanceof` or by `error.name`. Throw the most
 * specific subclass for the failure category — never raw `Error`.
 */

/**
 * General transport-level failure that does not match a more specific
 * category. Prefer one of the specific subclasses below when applicable.
 *
 * @public
 */
export class TransportError extends Error {
  override readonly name = 'TransportError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Configuration/registration error. Thrown when a binding, tag, or
 * registration is invalid — e.g. a transport server is registered
 * without the required transport-name tag, or a handler is registered
 * twice for the same pattern.
 *
 * @public
 */
export class TransportConfigError extends Error {
  override readonly name = 'TransportConfigError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Pattern validation error. Thrown when a pattern object contains a
 * value that cannot be normalized — non-JSON-serializable primitives,
 * non-plain objects, or circular references.
 *
 * @public
 */
export class TransportPatternError extends Error {
  override readonly name = 'TransportPatternError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Serialization or deserialization failure. Always wraps the original
 * cause via `ErrorOptions.cause` so consumers can inspect the underlying
 * runtime error (`SyntaxError`, `TypeError`, etc.).
 *
 * @public
 */
export class TransportSerializationError extends Error {
  override readonly name = 'TransportSerializationError';
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/**
 * Timeout error surfaced to handlers and callers when an Observable or
 * async operation does not settle within the configured budget.
 *
 * @public
 */
export class TransportTimeoutError extends Error {
  override readonly name = 'TransportTimeoutError';
  constructor(message: string) {
    super(message);
  }
}
