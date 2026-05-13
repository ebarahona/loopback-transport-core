import {Observable, ReplaySubject, isObservable, from, lastValueFrom} from 'rxjs';
import {
  TransportServer,
  TransportStatus,
  MessageHandler,
  WritePacket,
  IncomingRequest,
  IncomingEvent,
} from '../interfaces';
import {Serializer, Deserializer, JsonSerializer, JsonDeserializer} from '../serializers';

/**
 * Abstract base class for transport servers.
 *
 * Manages the handler registry, message dispatching, and serialization.
 * Each transport (Kafka, RabbitMQ, gRPC, MQTT, NATS) extends this
 * class and implements listen/close/unwrap.
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
   * For event handlers, multiple handlers on the same pattern are chained.
   */
  addHandler(pattern: string, handler: MessageHandler): void {
    const existing = this.messageHandlers.get(pattern);
    if (existing && handler.isEventHandler) {
      // Chain event handlers: append to the end of the linked list
      let current = existing;
      while (current.next) {
        current = current.next;
      }
      current.next = handler;
    } else {
      this.messageHandlers.set(pattern, handler);
    }
  }

  /**
   * Get all registered handlers.
   */
  getHandlers(): Map<string, MessageHandler> {
    return this.messageHandlers;
  }

  /**
   * Get a handler by pattern.
   */
  getHandlerByPattern(pattern: string): MessageHandler | undefined {
    return this.messageHandlers.get(pattern);
  }

  /**
   * Handle a request/response message.
   * Invokes the handler and calls respond() with each result value.
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
        obs.subscribe({
          next: value => respond({response: value}),
          error: err => respond({err, isDisposed: true}),
          complete: () => respond({isDisposed: true}),
        });
      } else {
        respond({response: result, isDisposed: true});
      }
    } catch (err) {
      respond({
        err: err instanceof Error ? err.message : String(err),
        isDisposed: true,
      });
    }
  }

  /**
   * Handle a fire-and-forget event.
   * Invokes all chained handlers for the pattern.
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
      } catch {
        // Event handlers are fire-and-forget: errors are logged, not propagated
      }
      handler = handler.next;
    }
  }

  /**
   * Normalize a pattern to a consistent string key.
   * Strings pass through. Objects are JSON-stringified with sorted keys.
   */
  protected normalizePattern(pattern: string | Record<string, unknown>): string {
    if (typeof pattern === 'string') return pattern;
    const sorted = Object.keys(pattern)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = pattern[key];
        return acc;
      }, {});
    return JSON.stringify(sorted);
  }
}
