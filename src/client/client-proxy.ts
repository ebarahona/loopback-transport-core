import {randomUUID} from 'crypto';
import {Observable, ReplaySubject, defer, mergeMap} from 'rxjs';
import {TransportError} from '../helpers/errors';
import type {
  PacketId,
  ReadPacket,
  TransportClient,
  TransportStatus,
  WritePacket,
} from '../interfaces';
import {normalizePattern} from '../utils';

/**
 * Client lifecycle state.
 *
 * - `idle`: not connected, no pending connect.
 * - `connecting`: `connect()` in progress.
 * - `connected`: ready to publish.
 * - `closing`: `close()` in progress, reject new operations.
 */
type ClientState = 'idle' | 'connecting' | 'connected' | 'closing';

/**
 * Abstract base class for transport clients.
 *
 * ## Lifecycle contract
 *
 * - `send()`/`emit()` lazily connect on first use.
 * - Concurrent send/emit calls share one connect().
 * - `close()` transitions to 'closing', waits for any pending connect
 *   (bounded by `closeConnectTimeoutMs`, default 5s), calls `doClose()`,
 *   then transitions to 'idle'.
 * - If the pending connect does not settle within the timeout, close
 *   proceeds anyway. The adapter's `doClose()` must safely tear down
 *   partially opened native resources in this case.
 * - `send()`/`emit()` during 'closing' fail fast.
 * - After close, the next send/emit reconnects.
 * - A stale connect that resolves after close always rejects for its
 *   original caller, even if a newer connection is already healthy.
 * - State is always reset in finally — a failed `doClose()` does not
 *   leave the client stuck.
 *
 * ## Stale async detection
 *
 * A monotonic `epoch` counter increments on each `close()`. The connect
 * callback only transitions to `connected` if the epoch has not changed,
 * preventing a late-resolving connect from overriding a close that
 * happened while it was pending.
 *
 * The `connectionPromise` is only cleared by its own `.finally()`
 * callback if it is still the current promise, preventing a stale
 * promise from clobbering a newer one.
 *
 * @public
 */
export abstract class ClientProxy implements TransportClient {
  protected readonly statusSubject = new ReplaySubject<TransportStatus>(1);
  private state: ClientState = 'idle';
  private connectionPromise: Promise<void> | undefined;
  private connectionEpoch: number | undefined;
  private closePromise: Promise<void> | undefined;
  private epoch = 0;
  private readonly closeConnectTimeoutMs: number;

  readonly status$ = this.statusSubject.asObservable();

  constructor(options?: {closeConnectTimeoutMs?: number}) {
    this.closeConnectTimeoutMs = options?.closeConnectTimeoutMs ?? 5000;
  }

  /**
   * Establish connection to the broker. Implementations should be
   * idempotent (safe to call multiple times).
   *
   * @public
   */
  abstract connect(): Promise<void>;

  /**
   * Close the native connection. Implemented by transport adapters.
   * Called by the base `close()` template method after waiting for any
   * pending connect (bounded by `closeConnectTimeoutMs`). If the
   * timeout fires before connect settles, `doClose()` is still called —
   * adapters must handle partially opened native resources in that
   * case.
   */
  protected abstract doClose(): Promise<void>;

  /**
   * Close the connection and reset state.
   *
   * - If idle with no pending connect, returns immediately (no-op).
   * - If already closing, returns the existing close promise (dedupe).
   * - Otherwise:
   *   1. Increments epoch to invalidate any in-flight `connect()`.
   *   2. Transitions to `closing` so new send/emit fails fast.
   *   3. Waits for pending connect (bounded by `closeConnectTimeoutMs`).
   *   4. Calls `doClose()` for adapter-specific teardown.
   *   5. Resets to `idle` in finally (even if `doClose` throws).
   *
   * After close, the client is reusable: the next send/emit will
   * trigger a fresh `connect()`.
   *
   * @public
   * @throws TransportError When the adapter's `doClose()` rejects.
   *   State is still reset to `idle` so the client remains reusable.
   */
  async close(): Promise<void> {
    if (this.state === 'idle' && !this.connectionPromise) return;
    if (this.closePromise) return this.closePromise;

    this.closePromise = this.doCloseInternal().finally(() => {
      this.closePromise = undefined;
    });
    return this.closePromise;
  }

  private async doCloseInternal(): Promise<void> {
    this.epoch++;
    this.state = 'closing';
    // Wait for pending connect with timeout so close never hangs.
    await this.waitForPendingConnect();
    try {
      await this.doClose();
    } finally {
      this.state = 'idle';
      this.connectionPromise = undefined;
      this.connectionEpoch = undefined;
      this.statusSubject.next('disconnected');
    }
  }

  /**
   * Wait for a pending connect to settle, bounded by timeout. If
   * connect does not settle in time, proceed anyway — the epoch
   * invalidation ensures the stale connect result is ignored.
   */
  private async waitForPendingConnect(): Promise<void> {
    const pending = this.connectionPromise;
    if (!pending) return;

    await Promise.race([
      pending.catch(() => undefined),
      new Promise<void>(resolve =>
        setTimeout(resolve, this.closeConnectTimeoutMs),
      ),
    ]);
  }

  /**
   * Access the underlying native client.
   *
   * @public
   * @typeParam T - Caller-asserted shape of the native client.
   * @returns The native client cast to `T`.
   */
  abstract unwrap<T>(): T;

  /**
   * Send a message and register a callback for the correlated response.
   * Returns a teardown function to cancel the pending response.
   */
  protected abstract publish(
    packet: ReadPacket & PacketId,
    callback: (packet: WritePacket) => void,
  ): () => void;

  /**
   * Dispatch a fire-and-forget event.
   */
  protected abstract dispatchEvent(packet: ReadPacket): Promise<void>;

  /**
   * Send a request and receive a response (request/response pattern).
   *
   * Returns a cold Observable: the message is sent only when subscribed.
   * The connection is established lazily on first subscription.
   *
   * @public
   * @typeParam TResult - Expected response shape.
   * @typeParam TInput - Caller-provided payload shape.
   * @param pattern - Pattern to match on the server side.
   * @param data - The message payload.
   * @returns A cold Observable that emits the response value(s).
   */
  send<TResult = unknown, TInput = unknown>(
    pattern: string | Record<string, unknown>,
    data: TInput,
  ): Observable<TResult> {
    const normalizedPattern = normalizePattern(pattern);
    return defer(async () => this.ensureConnected()).pipe(
      mergeMap(
        () =>
          new Observable<TResult>(observer => {
            const packet = this.assignPacketId({
              pattern: normalizedPattern,
              data,
            });
            const callback = this.createObserver<TResult>(observer);
            return this.publish(packet, callback);
          }),
      ),
    );
  }

  /**
   * Emit an event with no response expected (fire-and-forget pattern).
   *
   * Returns a Promise that resolves when the event is dispatched. The
   * connection is established lazily if not already connected.
   *
   * @public
   * @typeParam TInput - Caller-provided payload shape.
   * @param pattern - Event pattern.
   * @param data - The event payload.
   * @returns Resolves when the broker has accepted the event.
   * @throws TransportError When the client is closing or a concurrent
   *   close invalidated the pending connect.
   */
  async emit<TInput = unknown>(
    pattern: string | Record<string, unknown>,
    data: TInput,
  ): Promise<void> {
    const normalizedPattern = normalizePattern(pattern);
    await this.ensureConnected();
    await this.dispatchEvent({pattern: normalizedPattern, data});
  }

  /**
   * Assign a unique correlation ID to a packet. Uses
   * `crypto.randomUUID()` for distributed-system-safe IDs.
   */
  protected assignPacketId(packet: ReadPacket): ReadPacket & PacketId {
    return {...packet, id: randomUUID()};
  }

  /**
   * Create an Observer callback that maps `WritePacket` values to
   * Observable emissions.
   *
   * @typeParam T - Expected response type.
   */
  protected createObserver<T>(observer: {
    next: (value: T) => void;
    error: (err: unknown) => void;
    complete: () => void;
  }): (packet: WritePacket) => void {
    return (packet: WritePacket) => {
      if ('err' in packet && packet.err !== undefined) {
        return observer.error(packet.err);
      }
      if ('response' in packet) {
        observer.next(packet.response as T);
      }
      if (packet.isDisposed) {
        return observer.complete();
      }
    };
  }

  /**
   * Verify the client is in connected state. Throws if a concurrent
   * close prevented the transition.
   */
  private assertConnected(): void {
    if (this.state !== 'connected') {
      throw new TransportError('Client was closed during connection');
    }
  }

  /**
   * Ensure the client is connected. Concurrent calls share the same
   * connection promise to prevent duplicate connections.
   *
   * - `closing`: reject immediately.
   * - `connected`: return immediately.
   * - `connecting`: await the shared promise.
   * - `idle`: start connect, capture epoch, only transition to
   *   `connected` if epoch hasn't changed.
   *
   * After await, the caller validates that the epoch it waited on
   * still matches. A stale connect that was invalidated by close()
   * always rejects for its original caller, even if a newer connection
   * is already healthy.
   *
   * The connectionPromise/connectionEpoch are only cleared in
   * `.finally()` if the finishing promise is still the current one,
   * preventing a stale promise from clobbering a newer one.
   */
  private async ensureConnected(): Promise<void> {
    if (this.state === 'closing') {
      throw new TransportError('Client is closing');
    }
    if (this.state === 'connected') return;

    // Capture the epoch this caller will wait on.
    const awaitedEpoch = this.connectionEpoch ?? this.epoch;

    if (!this.connectionPromise) {
      const ep = this.epoch;
      this.connectionEpoch = ep;
      this.state = 'connecting';
      const promise: Promise<void> = this.connect()
        .then(() => {
          if (this.epoch === ep) {
            this.state = 'connected';
            this.statusSubject.next('connected');
          } else {
            throw new TransportError('Client was closed during connection');
          }
        })
        .catch(err => {
          if (this.epoch === ep) {
            this.state = 'idle';
          }
          throw err;
        })
        .finally(() => {
          if (this.connectionPromise === promise) {
            this.connectionPromise = undefined;
            this.connectionEpoch = undefined;
          }
        });
      this.connectionPromise = promise;
    }

    await this.connectionPromise;

    // Validate that this caller's epoch is still current.
    // A stale caller whose connect was invalidated must not proceed.
    if (this.epoch !== awaitedEpoch) {
      throw new TransportError('Client was closed during connection');
    }
    this.assertConnected();
  }
}
