import type {Application} from '@loopback/core';
import type {Observable, Subscription} from 'rxjs';
import {
  ReplaySubject,
  isObservable,
  lastValueFrom,
  timeout,
  TimeoutError,
} from 'rxjs';
import debugFactory from 'debug';
import {TransportConfigError} from '../helpers/errors';
import type {
  IncomingEvent,
  IncomingRequest,
  MessageHandler,
  TransportServer,
  TransportStatus,
  WritePacket,
} from '../interfaces';
import {
  DESERIALIZER_TAG,
  SERIALIZER_TAG,
  TRANSPORT_NAME_TAG,
  TRANSPORT_SERVER_TAG,
} from '../keys';
import {
  type Deserializer,
  JsonDeserializer,
  JsonSerializer,
  type Serializer,
} from '../serializers';
import {normalizePattern} from '../utils';

/**
 * Result of handling a message. Separates "what was sent to the caller"
 * from "should the broker ack or nack this message".
 *
 * - `success`: Handler completed. Response was sent. Adapter should ack.
 * - `handler-error`: Handler threw or Observable errored. Error
 *   response was sent to the caller. Adapter should ack (the error was
 *   handled).
 * - `infrastructure-error`: No handler found, serialization failure, or
 *   other framework-level failure. Adapter should nack/dead-letter.
 *
 * @public
 */
export interface HandlerResult {
  readonly outcome: 'success' | 'handler-error' | 'infrastructure-error';
  readonly error?: unknown;
}

const debug = debugFactory('loopback:transport:server');

const DEFAULT_HANDLER_TIMEOUT_MS = 30_000;

/**
 * Abstract base class for transport servers.
 *
 * Manages the handler registry, message dispatching, and serialization.
 * Each transport (Kafka, RabbitMQ, gRPC, MQTT, NATS) extends this class
 * and implements `listen`/`close`/`unwrap`.
 *
 * Subclasses should:
 *
 * - Call `deserializer.deserialize()` on raw broker messages before
 *   passing them to `handleMessage()` / `handleEvent()`.
 * - Call `serializer.serialize()` on outbound responses.
 * - Call `setStatus('connected')` in `listen()` when ready.
 * - Call `setStatus('disconnected')` in `close()` when stopped.
 * - Call `dispose()` only when the server will never be restarted.
 *
 * @public
 */
export abstract class ServerBase implements TransportServer {
  protected readonly messageHandlers = new Map<string, MessageHandler[]>();
  private readonly statusSubject = new ReplaySubject<TransportStatus>(1);
  protected serializer: Serializer;
  protected deserializer: Deserializer;
  protected handlerTimeoutMs: number;

  readonly status$ = this.statusSubject.asObservable();

  constructor(options?: {
    serializer?: Serializer;
    deserializer?: Deserializer;
    handlerTimeoutMs?: number;
  }) {
    this.serializer = options?.serializer ?? new JsonSerializer();
    this.deserializer = options?.deserializer ?? new JsonDeserializer();
    this.handlerTimeoutMs =
      options?.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS;
  }

  /**
   * Resolve the serializer/deserializer pair for this server from the
   * app container, honoring transport-scoped \> generic \> subclass-default
   * precedence.
   *
   * Called by the transport lifecycle observer between
   * `bindToServers` and `listen()`. Plugins contribute tag-based
   * serializers via {@link SERIALIZER_TAG} / {@link DESERIALIZER_TAG};
   * subclass defaults set via the `protected serializer` /
   * `protected deserializer` fields are still honored when no tagged
   * binding matches.
   *
   * Resolution precedence (most specific wins):
   *
   * 1. Transport-scoped binding (tagged with `SERIALIZER_TAG` /
   *    `DESERIALIZER_TAG` AND `TRANSPORT_NAME_TAG` equal to this
   *    server's transport name).
   * 2. Generic binding (tagged with `SERIALIZER_TAG` /
   *    `DESERIALIZER_TAG` but no `TRANSPORT_NAME_TAG`).
   * 3. Subclass default — the existing `protected serializer` /
   *    `protected deserializer` field value.
   *
   * @public
   * @param app - The LoopBack application container to resolve
   *   serializer bindings from.
   */
  async resolveSerializer(app: Application): Promise<void> {
    const transportName = await this.findTransportName(app);

    const serializer = await this.lookupTaggedBinding<Serializer>(
      app,
      SERIALIZER_TAG,
      transportName,
    );
    if (serializer !== undefined) {
      this.serializer = serializer;
    }

    const deserializer = await this.lookupTaggedBinding<Deserializer>(
      app,
      DESERIALIZER_TAG,
      transportName,
    );
    if (deserializer !== undefined) {
      this.deserializer = deserializer;
    }
  }

  /**
   * Find the transport name tag for this server instance by scanning
   * `TRANSPORT_SERVER_TAG` bindings and matching the resolved instance
   * against `this`. Returns `undefined` if the server is not bound (in
   * tests, or before the booter wires servers up), in which case
   * `resolveSerializer` falls back to generic-only matching.
   */
  private async findTransportName(
    app: Application,
  ): Promise<string | undefined> {
    for (const binding of app.findByTag(TRANSPORT_SERVER_TAG)) {
      const instance = await app.get<TransportServer>(binding.key);
      if (instance === this) {
        const tag = binding.tagMap?.[TRANSPORT_NAME_TAG];
        return typeof tag === 'string' && tag.length > 0 ? tag : undefined;
      }
    }
    return undefined;
  }

  /**
   * Resolve a tagged binding, preferring transport-scoped over generic.
   * Returns `undefined` if no tagged binding exists.
   */
  private async lookupTaggedBinding<T>(
    app: Application,
    tag: string,
    transportName: string | undefined,
  ): Promise<T | undefined> {
    const candidates = app.findByTag(tag);

    if (transportName !== undefined) {
      for (const binding of candidates) {
        if (binding.tagMap?.[TRANSPORT_NAME_TAG] === transportName) {
          return app.get<T>(binding.key);
        }
      }
    }

    for (const binding of candidates) {
      if (binding.tagMap?.[TRANSPORT_NAME_TAG] === undefined) {
        return app.get<T>(binding.key);
      }
    }

    return undefined;
  }

  /**
   * Start listening for messages from the broker. Subclasses should
   * call `setStatus('connected')` when ready.
   *
   * @public
   */
  abstract listen(): Promise<void>;

  /**
   * Stop listening and close connections. Subclasses should call
   * `setStatus('disconnected')` when stopped. Call `dispose()` only
   * when the server will never be restarted.
   *
   * @public
   */
  abstract close(): Promise<void>;

  /**
   * Access the underlying native server/consumer.
   *
   * @public
   * @typeParam T - Caller-asserted native server shape.
   */
  abstract unwrap<T>(): T;

  /**
   * Emit a status change. Called by transport adapters in `listen()`
   * and `close()`.
   */
  protected setStatus(status: TransportStatus): void {
    this.statusSubject.next(status);
  }

  /**
   * Permanently complete the status stream. After this call, no
   * further status emissions are possible and the server instance
   * cannot restart. Existing subscribers receive the complete
   * notification.
   *
   * Call only when the server is being permanently disposed. Normal
   * `close()` should call `setStatus('disconnected')`, NOT `dispose()`.
   */
  protected dispose(): void {
    this.statusSubject.next('disconnected');
    this.statusSubject.complete();
  }

  /**
   * Register a handler for a message pattern.
   *
   * For request/response handlers (`@messageHandler`): duplicate
   * patterns throw an error. Only one handler per pattern is allowed.
   *
   * For event handlers (`@eventHandler`): multiple handlers on the
   * same pattern are stored in an array and all execute.
   *
   * Mixing `@messageHandler` and `@eventHandler` on the same pattern
   * throws.
   *
   * Handlers are never mutated. Each server owns its own handler
   * array, so the same handler object can be safely shared across
   * servers.
   *
   * @public
   * @param pattern - The message pattern (already normalized by the registry).
   * @param handler - The handler to register.
   * @throws TransportConfigError When a request handler is duplicated
   *   or a request/event mix is attempted on the same pattern.
   */
  addHandler(pattern: string, handler: MessageHandler): void {
    const normalized = this.normalizePattern(pattern);
    const existing = this.messageHandlers.get(normalized);

    if (existing) {
      const first = existing[0];
      // Reject mixed handler types on the same pattern.
      if (first && first.isEventHandler !== handler.isEventHandler) {
        throw new TransportConfigError(
          `Cannot mix @messageHandler and @eventHandler for pattern: ${normalized}. ` +
            'A pattern must be exclusively request/response or event, not both.',
        );
      }

      // Reject duplicate request/response handlers.
      if (!handler.isEventHandler) {
        throw new TransportConfigError(
          `Handler already registered for pattern: ${normalized}. ` +
            'Only one @messageHandler per pattern is allowed. ' +
            'Use @eventHandler for multiple handlers on the same pattern.',
        );
      }

      // Append event handler to the array.
      existing.push(handler);
      return;
    }

    this.messageHandlers.set(normalized, [handler]);
  }

  /**
   * Get all registered handlers. Returns a defensive copy.
   *
   * @public
   */
  getHandlers(): ReadonlyMap<string, readonly MessageHandler[]> {
    const copy = new Map<string, readonly MessageHandler[]>();
    for (const [key, handlers] of this.messageHandlers) {
      copy.set(key, [...handlers]);
    }
    return copy;
  }

  /**
   * Remove all registered handlers. Called before rebinding on
   * restart to prevent duplicate registration.
   *
   * @public
   */
  clearHandlers(): void {
    this.messageHandlers.clear();
  }

  /**
   * Get handlers by pattern. Normalizes the pattern before lookup.
   * Returns a defensive copy for external consumers.
   *
   * @public
   */
  getHandlersByPattern(
    pattern: string | Record<string, unknown>,
  ): readonly MessageHandler[] | undefined {
    const handlers = this.lookupHandlers(pattern);
    return handlers ? [...handlers] : undefined;
  }

  /**
   * Internal handler lookup. Returns the live array for dispatch
   * performance.
   */
  private lookupHandlers(
    pattern: string | Record<string, unknown>,
  ): MessageHandler[] | undefined {
    return this.messageHandlers.get(this.normalizePattern(pattern));
  }

  /**
   * Handle a request/response message.
   *
   * Invokes the handler and calls `respond()` with each result value.
   * Observable subscriptions are tracked and cleaned up on completion,
   * error, or timeout.
   *
   * Returns a {@link HandlerResult} that separates response semantics
   * from broker settlement semantics:
   *
   * - `success`: Handler completed normally. Ack the message.
   * - `handler-error`: Handler threw or Observable errored. The error
   *   response was already sent to the caller. Ack the message — the
   *   error was handled as an application-level response.
   * - `infrastructure-error`: No handler found or framework failure.
   *   Nack/dead-letter the message.
   *
   * Observable handlers that do not complete within
   * `handlerTimeoutMs` are terminated with a timeout error
   * (`handler-error`).
   *
   * If `respond()` throws (adapter publication failure), the error is
   * caught and returned as `infrastructure-error`.
   */
  protected async handleMessage(
    request: IncomingRequest,
    respond: (packet: WritePacket) => void,
    context?: unknown,
  ): Promise<HandlerResult> {
    // Wrap respond to catch adapter publication failures.
    const safeRespond = (packet: WritePacket): void => {
      try {
        respond(packet);
      } catch (err) {
        debug('respond() failed for pattern [%s]: %O', request.pattern, err);
        throw err;
      }
    };

    try {
      return await this.executeHandler(request, safeRespond, context);
    } catch (err) {
      return {outcome: 'infrastructure-error', error: err};
    }
  }

  /**
   * Core handler execution. Separated from `handleMessage` so that
   * `respond()` failures bubble up and are caught by the outer
   * wrapper.
   */
  private async executeHandler(
    request: IncomingRequest,
    respond: (packet: WritePacket) => void,
    context?: unknown,
  ): Promise<HandlerResult> {
    const handlers = this.lookupHandlers(request.pattern);
    if (!handlers || handlers.length === 0) {
      const err = `No handler for pattern: ${request.pattern}`;
      respond({err: this.serializeError(err), isDisposed: true});
      return {outcome: 'infrastructure-error', error: new Error(err)};
    }

    const handler = handlers[0];
    if (!handler) {
      const err = `No handler for pattern: ${request.pattern}`;
      respond({err: this.serializeError(err), isDisposed: true});
      return {outcome: 'infrastructure-error', error: new Error(err)};
    }

    let result: unknown;
    try {
      result = await handler(request.data, context);
    } catch (err) {
      respond({err: this.serializeError(err), isDisposed: true});
      return {outcome: 'handler-error', error: err};
    }

    if (isObservable(result)) {
      const obs = (result as Observable<unknown>).pipe(
        timeout(this.handlerTimeoutMs),
      );
      return new Promise<HandlerResult>(resolve => {
        let settled = false;
        const settle = (settledResult: HandlerResult): void => {
          if (settled) return;
          settled = true;
          subscription?.unsubscribe();
          resolve(settledResult);
        };

        let subscription: Subscription | undefined;
        subscription = obs.subscribe({
          next: value => {
            if (settled) return;
            try {
              respond({response: value});
            } catch (respondErr) {
              settle({outcome: 'infrastructure-error', error: respondErr});
            }
          },
          error: err => {
            if (settled) return;
            if (err instanceof TimeoutError) {
              debug(
                'handler timeout after %dms for pattern [%s]',
                this.handlerTimeoutMs,
                request.pattern,
              );
            }
            try {
              respond({err: this.serializeError(err), isDisposed: true});
            } catch (respondErr) {
              settle({outcome: 'infrastructure-error', error: respondErr});
              return;
            }
            settle({outcome: 'handler-error', error: err});
          },
          complete: () => {
            if (settled) return;
            try {
              respond({isDisposed: true});
            } catch (respondErr) {
              settle({outcome: 'infrastructure-error', error: respondErr});
              return;
            }
            settle({outcome: 'success'});
          },
        });
      });
    }

    respond({response: result, isDisposed: true});
    return {outcome: 'success'};
  }

  /**
   * Handle a fire-and-forget event.
   *
   * Invokes all chained handlers for the pattern. Errors are logged
   * but not propagated (fire-and-forget semantics).
   *
   * Observable event handlers that do not complete within
   * `handlerTimeoutMs` are terminated and logged.
   */
  protected async handleEvent(
    event: IncomingEvent,
    context?: unknown,
  ): Promise<void> {
    const handlers = this.lookupHandlers(event.pattern);
    if (!handlers || handlers.length === 0) return;

    for (const handler of handlers) {
      try {
        const result = await handler(event.data, context);
        if (isObservable(result)) {
          const obs = (result as Observable<unknown>).pipe(
            timeout(this.handlerTimeoutMs),
          );
          await lastValueFrom(obs, {defaultValue: undefined});
        }
      } catch (err) {
        if (err instanceof TimeoutError) {
          debug(
            'event handler timeout after %dms for pattern [%s]',
            this.handlerTimeoutMs,
            event.pattern,
          );
        } else {
          debug(
            'event handler failed for pattern [%s]: %O',
            event.pattern,
            err,
          );
        }
      }
    }
  }

  /**
   * Normalize a pattern to a consistent string key. Delegates to the
   * shared `normalizePattern` utility.
   */
  protected normalizePattern(
    pattern: string | Record<string, unknown>,
  ): string {
    return normalizePattern(pattern);
  }

  /**
   * Serialize an error to a string for transport.
   */
  private serializeError(err: unknown): string {
    if (err instanceof TimeoutError) return 'Handler timeout';
    if (err instanceof Error) return `${err.name}: ${err.message}`;
    if (typeof err === 'string') return err;
    return String(err);
  }
}
