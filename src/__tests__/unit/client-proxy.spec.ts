import {describe, it, expect} from 'vitest';
import {ClientProxy} from '../../client';
import type {PacketId, ReadPacket, WritePacket} from '../../interfaces';

/**
 * Test subclass that exposes controllable delays and failure modes.
 */
class TestClient extends ClientProxy {
  connectDelay = 0;
  closeDelay = 0;
  connectCalls = 0;
  closeCalls = 0;
  publishCalls = 0;
  dispatchCalls = 0;
  shouldFailConnect = false;
  shouldFailClose = false;

  constructor(options?: {closeConnectTimeoutMs?: number}) {
    super(options);
  }

  async connect(): Promise<void> {
    this.connectCalls++;
    if (this.connectDelay > 0) {
      await new Promise(r => setTimeout(r, this.connectDelay));
    }
    if (this.shouldFailConnect) {
      throw new Error('connect failed');
    }
  }

  protected async doClose(): Promise<void> {
    this.closeCalls++;
    if (this.closeDelay > 0) {
      await new Promise(r => setTimeout(r, this.closeDelay));
    }
    if (this.shouldFailClose) {
      throw new Error('close failed');
    }
  }

  unwrap<T>(): T {
    return undefined as T;
  }

  protected publish(
    _packet: ReadPacket & PacketId,
    callback: (packet: WritePacket) => void,
  ): () => void {
    this.publishCalls++;
    callback({response: 'ok', isDisposed: true});
    return () => {};
  }

  protected async dispatchEvent(_packet: ReadPacket): Promise<void> {
    this.dispatchCalls++;
  }
}

describe('ClientProxy', () => {
  // ---- Contract: lazy connection ----

  describe('lazy connection', () => {
    it('connects on first emit', async () => {
      const client = new TestClient();
      expect(client.connectCalls).toBe(0);
      await client.emit('test', {});
      expect(client.connectCalls).toBe(1);
      expect(client.dispatchCalls).toBe(1);
    });

    it('connects on first send subscription', async () => {
      const client = new TestClient();
      const result = await new Promise(resolve => {
        client.send('test', {}).subscribe(resolve);
      });
      expect(result).toBe('ok');
      expect(client.connectCalls).toBe(1);
      expect(client.publishCalls).toBe(1);
    });

    it('does not reconnect if already connected', async () => {
      const client = new TestClient();
      await client.emit('a', {});
      await client.emit('b', {});
      expect(client.connectCalls).toBe(1);
      expect(client.dispatchCalls).toBe(2);
    });
  });

  // ---- Contract: concurrent connect deduplication ----

  describe('concurrent connect deduplication', () => {
    it('shares one connect across concurrent emit calls', async () => {
      const client = new TestClient();
      client.connectDelay = 50;
      await Promise.all([
        client.emit('a', {}),
        client.emit('b', {}),
        client.emit('c', {}),
      ]);
      expect(client.connectCalls).toBe(1);
      expect(client.dispatchCalls).toBe(3);
    });
  });

  // ---- Contract: close then send reconnects ----

  describe('close then reconnect', () => {
    it('reconnects after close', async () => {
      const client = new TestClient();
      await client.emit('test', {});
      expect(client.connectCalls).toBe(1);

      await client.close();

      await client.emit('test', {});
      expect(client.connectCalls).toBe(2);
    });

    it('resets state even if doClose throws', async () => {
      const client = new TestClient();
      await client.emit('test', {});
      client.shouldFailClose = true;

      await expect(client.close()).rejects.toThrow('close failed');

      client.shouldFailClose = false;
      await client.emit('test', {});
      expect(client.connectCalls).toBe(2);
    });
  });

  // ---- Contract: close during pending connect prevents publish ----

  describe('close during pending connect', () => {
    it('rejects in-flight emit when close runs during connect', async () => {
      const client = new TestClient();
      client.connectDelay = 50;

      const emitPromise = client.emit('test', {});

      // Close while connect is in progress
      await new Promise(r => setTimeout(r, 10));
      await client.close();

      await expect(emitPromise).rejects.toThrow(
        'Client was closed during connection',
      );
      // Dispatch must not have been called
      expect(client.dispatchCalls).toBe(0);
    });
  });

  // ---- Contract: stale connect cannot set connected after close ----

  describe('stale connect after close', () => {
    it('old connect resolving after close does not set connected', async () => {
      const client = new TestClient();
      client.connectDelay = 50;

      // Start a connect
      const emitPromise = client.emit('test', {}).catch(() => {});

      // Close immediately -- increments generation
      await client.close();
      // Let the old connect resolve
      await emitPromise;

      // Next emit should trigger a fresh connect, not reuse stale state
      await client.emit('test2', {});
      expect(client.connectCalls).toBe(2);
    });
  });

  // ---- Contract: failed connect propagates ----

  describe('failed connect', () => {
    it('propagates connect error to emit', async () => {
      const client = new TestClient();
      client.shouldFailConnect = true;

      await expect(client.emit('test', {})).rejects.toThrow('connect failed');
      expect(client.dispatchCalls).toBe(0);
    });

    it('propagates connect error to send', async () => {
      const client = new TestClient();
      client.shouldFailConnect = true;

      await expect(
        new Promise((resolve, reject) => {
          client.send('test', {}).subscribe({next: resolve, error: reject});
        }),
      ).rejects.toThrow('connect failed');
      expect(client.publishCalls).toBe(0);
    });
  });

  // ---- Contract: emit/send during active close ----

  describe('emit/send during active close', () => {
    it('rejects emit while close is in progress', async () => {
      const client = new TestClient();
      await client.emit('setup', {});

      client.closeDelay = 50;
      const closePromise = client.close();

      await expect(client.emit('test', {})).rejects.toThrow(
        'Client is closing',
      );
      expect(client.dispatchCalls).toBe(1); // only the setup emit

      await closePromise;
    });

    it('rejects send subscription while close is in progress', async () => {
      const client = new TestClient();
      await client.emit('setup', {});

      client.closeDelay = 50;
      const closePromise = client.close();

      await expect(
        new Promise((resolve, reject) => {
          client.send('test', {}).subscribe({next: resolve, error: reject});
        }),
      ).rejects.toThrow('Client is closing');
      expect(client.publishCalls).toBe(0);

      await closePromise;
    });
  });

  // ---- Contract: idempotent close ----

  describe('idempotent close', () => {
    it('close on idle client is a no-op', async () => {
      const client = new TestClient();
      const statuses: string[] = [];
      client.status$.subscribe(s => statuses.push(s));

      await client.close();

      expect(client.closeCalls).toBe(0);
      expect(statuses).toEqual([]);
    });

    it('concurrent close calls deduplicate', async () => {
      const client = new TestClient();
      await client.emit('setup', {});
      client.closeDelay = 50;

      const [r1, r2] = await Promise.allSettled([
        client.close(),
        client.close(),
      ]);

      expect(r1.status).toBe('fulfilled');
      expect(r2.status).toBe('fulfilled');
      expect(client.closeCalls).toBe(1);
    });
  });

  // ---- Contract: close-then-immediate-emit race ----

  describe('close then immediate emit before stale connect settles', () => {
    it('does not clobber or duplicate connects', async () => {
      const client = new TestClient();
      client.connectDelay = 100;

      // Start slow connect
      const firstEmit = client.emit('first', {}).catch(() => {});

      // Close while first connect is pending
      await new Promise(r => setTimeout(r, 20));
      await client.close();

      // Immediately start a new emit (should trigger fresh connect)
      client.connectDelay = 0;
      await firstEmit;
      await client.emit('second', {});

      // First connect + second connect = 2 total
      expect(client.connectCalls).toBe(2);
      // Only the second dispatch should have succeeded
      expect(client.dispatchCalls).toBe(1);
    });
  });

  // ---- Contract: status stream ----

  describe('status stream', () => {
    it('emits connected on successful connect', async () => {
      const client = new TestClient();
      const statuses: string[] = [];
      client.status$.subscribe(s => statuses.push(s));

      await client.emit('test', {});

      expect(statuses).toContain('connected');
    });

    it('emits connected then disconnected through full lifecycle', async () => {
      const client = new TestClient();
      const statuses: string[] = [];
      client.status$.subscribe(s => statuses.push(s));

      await client.emit('test', {});
      await client.close();

      expect(statuses).toEqual(['connected', 'disconnected']);
    });

    it('emits disconnected even when doClose fails', async () => {
      const client = new TestClient();
      const statuses: string[] = [];
      client.status$.subscribe(s => statuses.push(s));

      await client.emit('test', {});
      client.shouldFailClose = true;
      await client.close().catch(() => {});

      expect(statuses).toContain('disconnected');
    });
  });

  // ---- Regression: stale connect after timed-out close ----

  describe('stale connect after close timeout', () => {
    it('rejects stale emit even after newer reconnect succeeds', async () => {
      const client = new TestClient({closeConnectTimeoutMs: 5});
      client.connectDelay = 100; // exceeds close timeout

      // Start first emit (will start slow connect)
      const firstEmit = client.emit('first', {});

      // Close returns before first connect resolves (timeout)
      await client.close();

      // Start second emit with fast connect
      client.connectDelay = 0;
      await client.emit('second', {});

      // First emit must reject
      await expect(firstEmit).rejects.toThrow(
        'Client was closed during connection',
      );

      // Only second dispatch went through
      expect(client.dispatchCalls).toBe(1);
    });

    it('calls doClose exactly once even when connect times out', async () => {
      const client = new TestClient({closeConnectTimeoutMs: 5});
      client.connectDelay = 100;

      const emitPromise = client.emit('test', {}).catch(() => {});

      // Close times out waiting for connect
      await client.close();

      // doClose was called exactly once
      expect(client.closeCalls).toBe(1);

      // Let stale connect settle
      await emitPromise;

      // Reconnect works cleanly
      client.connectDelay = 0;
      await client.emit('after', {});
      expect(client.dispatchCalls).toBe(1);
      expect(client.connectCalls).toBe(2);
    });
  });
});
