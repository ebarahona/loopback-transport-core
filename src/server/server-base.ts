import {Observable, ReplaySubject, Subscription, isObservable, lastValueFrom} from 'rxjs';
import debugFactory from 'debug';
import {
  TransportServer,
  TransportStatus,
  MessageHandler,
  WritePacket,
  IncomingRequest,
  IncomingEvent,
} from '../interfaces';
import {Serializer, Deserializer, JsonSerializer, JsonDeserializer} from '../serializers';

const debug = debugFactory('loopback:transport:server');

/**
 * Abstract base class for transport servers.
 *
 * Manages the handler registry, message dispatching, and serialization.
 * Each transport (Kafka, RabbitMQ, gRPC, MQTT, NATS) extends this
 * class and implements listen/close/unwrap.
 *
 * Subclasses should call deserializer.deserialize() on raw broker
 * messages before passing them to handleMessage()/handleEvent(),
 * and serializer.serialize() on outbound responses.
 */
export abstract class ServerBase implements TransportServer {
  protected readonly messageHandlers = new Map<string, MessageHandler>();
  protected readonly statusSubject = new ReplaySubject<TransportStatus>(1);
  protected serializer: Serializer;
  protected deserializer: Deserializer;

  readonly status$ = this.statusSubject.asObservable();

  constructor(
    serializer?: Serializer,
    deserializer?: Deserializer,
  ) {
    this.serializer = serializer ?? new JsonSerializer();
    this.deserializer = deserializer ?? new JsonDeserializer();
  }

  /**
   * Start listening for messages from the broker.
   */
  abstract listen(): Promise<void>;

  /**
   * Stop listening and close connections.
   */
  abstract close(): Promise<void>;

  /**
   * Access the underlying native server/consumer.
   */
  abstract unwrap<T>(): T;

  /**
   * Register a handler for a message pattern.
   *
   * For request/response handlers (@messageHandler): duplicate patterns
   * throw an error. Only one handler per pattern is allowed.
   *
   * For event handlers (@eventHandler): multiple handlers on the same
   * pattern are chained and all execute.
   */
  addHandler(pattern: string, handler: MessageHandler): void {
    const normalized = this.normalizePattern(pattern);
    const existing = this.messageHandlers.get(normalized);

    if (existing && !handler.isEventHandler) {
      throw new Error(
        `Handler already registered for pattern: ${normalized}. ` +
        'Only one @messageHandler per pattern is allowed. ' +
        'Use @eventHandler for multiple handlers on the same pattern.',
      );
    }

    if (existing && handler.isEventHandler) {
      // Chain event handlers: append to the end of the linked list
      let current = existing;
      while (current.next) {
        current = current.next;
      }
      current.next = handler;
      return;
    }

    this.messageHandlers.set(normalized, handler);
  }

  /**
   * Get all registered handlers.
   */
  getHandlers(): Map<string, MessageHandler> {
    return this.messageHandlers;
  }

  /**
   * Get a handler by pattern. Normalizes the pattern before lookup.
   */
  getHandlerByPattern(
    pattern: string | Record<string, unknown>,
  ): MessageHandler | undefined {
    return this.messageHandlers.get(this.normalizePattern(pattern));
  }

  /**
   * Handle a request/response message.
   * Invokes the handler and calls respond() with each result value.
   * Observable subscriptions are tracked and cleaned up on completion or error.
   */
  protected async handleMessage(
    request: IncomingRequest,
    respond: (packet: WritePacket) => void,
    context?: unknown,
  ): Promise<void> {
    const handler = this.getHandlerByPattern(request.pattern);
    if (!handler) {
      respond({err: `No handler for pattern: ${request.pattern}`, isDisposed: true});
      return;
    }

    try {
      const result = await handler(request.data, context);
      if (isObservable(result)) {
        const obs = result as Observable<unknown>;
        let subscription: Subscription | undefined;
        subscription = obs.subscribe({
          next: value => respond({response: value}),
          error: err => {
            respond({
              err: this.serializeError(err),
              isDisposed: true,
            });
            subscription?.unsubscribe();
          },
          complete: () => {
            respond({isDisposed: true});
            subscription?.unsubscribe();
          },
        });
      } else {
        respond({response: result, isDisposed: true});
      }
    } catch (err) {
      respond({
        err: this.serializeError(err),
        isDisposed: true,
      });
    }
  }

  /**
   * Handle a fire-and-forget event.
   * Invokes all chained handlers for the pattern.
   * Errors are logged but not propagated (fire-and-forget semantics).
   */
  protected async handleEvent(
    event: IncomingEvent,
    context?: unknown,
  ): Promise<void> {
    let handler = this.getHandlerByPattern(event.pattern);
    if (!handler) return;

    while (handler) {
      try {
        const result = await handler(event.data, context);
        if (isObservable(result)) {
          await lastValueFrom(result as Observable<unknown>, {defaultValue: undefined});
        }
      } catch (err) {
        debug(
          'event handler failed for pattern [%s]: %O',
          event.pattern,
          err,
        );
      }
      handler = handler.next;
    }
  }

  /**
   * Normalize a pattern to a consistent string key.
   * Strings pass through. Objects are deep-sorted and JSON-stringified.
   */
  protected normalizePattern(
    pattern: string | Record<string, unknown>,
  ): string {
    if (typeof pattern === 'string') return pattern;
    return stableStringify(pattern);
  }

  /**
   * Serialize an error for transport. Extracts message from Error instances.
   */
  private serializeError(err: unknown): string | Record<string, unknown> {
    if (err instanceof Error) {
      return {message: err.message, name: err.name};
    }
    if (typeof err === 'string') return err;
    return String(err);
  }
}

/**
 * Stable JSON stringify with recursively sorted keys.
 * Ensures consistent pattern normalization regardless of key insertion order.
 */
function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(
    key => `${JSON.stringify(key)}:${stableStringify((obj as Record<string, unknown>)[key])}`,
  );
  return '{' + pairs.join(',') + '}';
}
