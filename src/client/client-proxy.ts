import {Observable, ReplaySubject, connectable, defer, mergeMap, Subject} from 'rxjs';
import {TransportClient, TransportStatus, WritePacket, ReadPacket, PacketId} from '../interfaces';

/**
 * Abstract base class for transport clients.
 *
 * Provides the send() / emit() contract with lazy connection,
 * request/response correlation via packet IDs, and status reporting.
 *
 * Each transport (Kafka, RabbitMQ, gRPC, MQTT, NATS) extends this
 * class and implements the abstract methods.
 */
export abstract class ClientProxy implements TransportClient {
  protected readonly routingMap = new Map<string, (packet: WritePacket) => void>();
  protected readonly statusSubject = new ReplaySubject<TransportStatus>(1);
  private connected = false;

  readonly status$ = this.statusSubject.asObservable();

  /**
   * Establish connection to the broker.
   * Implementations should be idempotent (safe to call multiple times).
   */
  abstract connect(): Promise<void>;

  /**
   * Close the connection.
   */
  abstract close(): Promise<void>;

  /**
   * Access the underlying native client.
   */
  abstract unwrap<T>(): T;

  /**
   * Send a message and register a callback for the correlated response.
   * Returns a teardown function to cancel the pending response.
   *
   * @param packet - The request packet with correlation ID
   * @param callback - Called when the response arrives
   * @returns Teardown function
   */
  protected abstract publish(
    packet: ReadPacket & PacketId,
    callback: (packet: WritePacket) => void,
  ): () => void;

  /**
   * Dispatch a fire-and-forget event.
   *
   * @param packet - The event packet (no correlation ID)
   */
  protected abstract dispatchEvent(packet: ReadPacket): Promise<void>;

  /**
   * Send a request and receive a response (request/response pattern).
   *
   * Returns a cold Observable: the message is sent only when subscribed.
   * The connection is established lazily on first subscription.
   */
  send<TResult = unknown, TInput = unknown>(
    pattern: string,
    data: TInput,
  ): Observable<TResult> {
    return defer(async () => this.ensureConnected()).pipe(
      mergeMap(
        () =>
          new Observable<TResult>(observer => {
            const packet = this.assignPacketId({pattern, data});
            const callback = this.createObserver<TResult>(observer);
            return this.publish(packet, callback);
          }),
      ),
    );
  }

  /**
   * Emit an event with no response expected (fire-and-forget pattern).
   *
   * Returns a hot Observable: the event is dispatched immediately
   * regardless of subscription.
   */
  emit<TInput = unknown>(
    pattern: string,
    data: TInput,
  ): Observable<void> {
    const source = defer(async () => this.ensureConnected()).pipe(
      mergeMap(() => this.dispatchEvent({pattern, data})),
    );
    const hot = connectable(source, {connector: () => new Subject()});
    hot.connect();
    return hot;
  }

  /**
   * Assign a unique correlation ID to a packet.
   */
  protected assignPacketId(packet: ReadPacket): ReadPacket & PacketId {
    const id = this.generateId();
    return {...packet, id};
  }

  /**
   * Create an Observer callback that maps WritePacket to Observable emissions.
   */
  protected createObserver<T>(
    observer: {
      next: (value: T) => void;
      error: (err: unknown) => void;
      complete: () => void;
    },
  ): (packet: WritePacket) => void {
    return ({err, response, isDisposed}: WritePacket) => {
      if (err) {
        return observer.error(err);
      }
      if (response !== undefined && isDisposed) {
        observer.next(response as T);
        return observer.complete();
      }
      if (isDisposed) {
        return observer.complete();
      }
      if (response !== undefined) {
        observer.next(response as T);
      }
    };
  }

  /**
   * Ensure the client is connected. Idempotent.
   */
  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.connect();
      this.connected = true;
    }
  }

  /**
   * Generate a unique ID for request/response correlation.
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}
