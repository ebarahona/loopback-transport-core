import {describe, it, expect} from 'vitest';
import {ServerBase, HandlerResult} from '../server';
import {
  MessageHandler,
  WritePacket,
  IncomingRequest,
  IncomingEvent,
} from '../interfaces';
import {of} from 'rxjs';

/**
 * Test subclass that exposes protected methods for testing.
 */
class TestServer extends ServerBase {
  async listen(): Promise<void> {
    this.setStatus('connected');
  }
  async close(): Promise<void> {
    this.setStatus('disconnected');
  }
  unwrap<T>(): T {
    return undefined as T;
  }

  // Expose protected methods for testing
  testHandleMessage(
    request: IncomingRequest,
    respond: (packet: WritePacket) => void,
    context?: unknown,
  ): Promise<HandlerResult> {
    return this.handleMessage(request, respond, context);
  }

  testHandleEvent(
    event: IncomingEvent,
    context?: unknown,
  ): Promise<void> {
    return this.handleEvent(event, context);
  }

  testNormalizePattern(pattern: string | Record<string, unknown>): string {
    return this.normalizePattern(pattern);
  }
}

describe('ServerBase', () => {
  describe('addHandler / getHandlers', () => {
    it('registers a message handler', () => {
      const server = new TestServer();
      const handler: MessageHandler = async (data) => data;
      handler.isEventHandler = false;
      server.addHandler('order.get', handler);
      expect(server.getHandlers().size).toBe(1);
      const handlers = server.getHandlersByPattern('order.get');
      expect(handlers).toHaveLength(1);
      expect(handlers![0]).toBe(handler);
    });

    it('stores multiple event handlers in an array without mutating handler objects', () => {
      const server = new TestServer();
      const handler1: MessageHandler = async () => 'first';
      handler1.isEventHandler = true;
      const handler2: MessageHandler = async () => 'second';
      handler2.isEventHandler = true;

      server.addHandler('order.placed', handler1);
      server.addHandler('order.placed', handler2);

      const handlers = server.getHandlersByPattern('order.placed');
      expect(handlers).toHaveLength(2);
      expect(handlers![0]).toBe(handler1);
      expect(handlers![1]).toBe(handler2);

      // Handler objects are not mutated (no .next chain)
      expect((handler1 as Record<string, unknown>).next).toBeUndefined();
      expect((handler2 as Record<string, unknown>).next).toBeUndefined();
    });

    it('throws on duplicate message handler for same pattern', () => {
      const server = new TestServer();
      const handler1: MessageHandler = async () => 'first';
      handler1.isEventHandler = false;
      const handler2: MessageHandler = async () => 'second';
      handler2.isEventHandler = false;

      server.addHandler('order.get', handler1);
      expect(() => server.addHandler('order.get', handler2)).toThrow(
        'Handler already registered for pattern: order.get',
      );
    });
  });

  describe('handleMessage', () => {
    it('dispatches to the handler and returns success', async () => {
      const server = new TestServer();
      const handler: MessageHandler = async (data: unknown) => ({
        id: (data as Record<string, unknown>).id,
        name: 'Test',
      });
      server.addHandler('order.get', handler);

      const responses: unknown[] = [];
      const result = await server.testHandleMessage(
        {pattern: 'order.get', data: {id: 1}, id: 'req-1'},
        (packet: unknown) => responses.push(packet),
      );

      expect(result.outcome).toBe('success');
      expect(responses).toEqual([
        {response: {id: 1, name: 'Test'}, isDisposed: true},
      ]);
    });

    it('returns infrastructure-error for unknown pattern', async () => {
      const server = new TestServer();
      const responses: unknown[] = [];
      const result = await server.testHandleMessage(
        {pattern: 'unknown', data: {}, id: 'req-1'},
        (packet: unknown) => responses.push(packet),
      );

      expect(result.outcome).toBe('infrastructure-error');
      expect(responses).toEqual([
        {err: 'No handler for pattern: unknown', isDisposed: true},
      ]);
    });

    it('handles Observable return values and awaits completion', async () => {
      const server = new TestServer();
      const handler: MessageHandler = () => of('a', 'b', 'c');
      server.addHandler('stream', handler);

      const responses: unknown[] = [];
      const result = await server.testHandleMessage(
        {pattern: 'stream', data: {}, id: 'req-1'},
        (packet: unknown) => responses.push(packet),
      );

      expect(result.outcome).toBe('success');
      expect(responses).toEqual([
        {response: 'a'},
        {response: 'b'},
        {response: 'c'},
        {isDisposed: true},
      ]);
    });

    it('returns handler-error on handler throw', async () => {
      const server = new TestServer();
      const handler: MessageHandler = async () => {
        throw new Error('Handler failed');
      };
      server.addHandler('fail', handler);

      const responses: unknown[] = [];
      const result = await server.testHandleMessage(
        {pattern: 'fail', data: {}, id: 'req-1'},
        (packet: unknown) => responses.push(packet),
      );

      expect(result.outcome).toBe('handler-error');
      expect(result.error).toBeInstanceOf(Error);
      expect(responses).toEqual([
        {err: 'Error: Handler failed', isDisposed: true},
      ]);
    });
  });

  describe('handleEvent', () => {
    it('dispatches to all chained handlers', async () => {
      const server = new TestServer();
      const calls: string[] = [];
      const handler1: MessageHandler = async () => {
        calls.push('first');
      };
      handler1.isEventHandler = true;
      const handler2: MessageHandler = async () => {
        calls.push('second');
      };
      handler2.isEventHandler = true;

      server.addHandler('order.placed', handler1);
      server.addHandler('order.placed', handler2);

      await server.testHandleEvent({pattern: 'order.placed', data: {}});

      expect(calls).toEqual(['first', 'second']);
    });

    it('continues chain even if one handler throws', async () => {
      const server = new TestServer();
      const calls: string[] = [];
      const handler1: MessageHandler = async () => {
        throw new Error('fail');
      };
      handler1.isEventHandler = true;
      const handler2: MessageHandler = async () => {
        calls.push('second');
      };
      handler2.isEventHandler = true;

      server.addHandler('order.placed', handler1);
      server.addHandler('order.placed', handler2);

      await server.testHandleEvent({pattern: 'order.placed', data: {}});

      expect(calls).toEqual(['second']);
    });

    it('silently ignores events with no handler', async () => {
      const server = new TestServer();
      await expect(
        server.testHandleEvent({pattern: 'unknown', data: {}}),
      ).resolves.toBeUndefined();
    });
  });

  describe('error serialization', () => {
    it('serializes Error instances as name: message string', async () => {
      const server = new TestServer();
      const handler: MessageHandler = async () => {
        throw new TypeError('Invalid input');
      };
      server.addHandler('fail', handler);

      const responses: WritePacket[] = [];
      const result = await server.testHandleMessage(
        {pattern: 'fail', data: {}, id: 'req-1'},
        (packet: WritePacket) => responses.push(packet),
      );

      expect(result.outcome).toBe('handler-error');
      expect(responses[0].err).toBe('TypeError: Invalid input');
      expect(responses[0].isDisposed).toBe(true);
    });
  });

  describe('mixed handler type protection', () => {
    it('throws when mixing @messageHandler and @eventHandler on same pattern', () => {
      const server = new TestServer();
      const msgHandler: MessageHandler = async () => 'result';
      msgHandler.isEventHandler = false;
      const evtHandler: MessageHandler = async () => {};
      evtHandler.isEventHandler = true;

      server.addHandler('order.update', msgHandler);
      expect(() => server.addHandler('order.update', evtHandler)).toThrow(
        'Cannot mix @messageHandler and @eventHandler',
      );
    });

    it('throws when adding @messageHandler after @eventHandler on same pattern', () => {
      const server = new TestServer();
      const evtHandler: MessageHandler = async () => {};
      evtHandler.isEventHandler = true;
      const msgHandler: MessageHandler = async () => 'result';
      msgHandler.isEventHandler = false;

      server.addHandler('order.update', evtHandler);
      expect(() => server.addHandler('order.update', msgHandler)).toThrow(
        'Cannot mix @messageHandler and @eventHandler',
      );
    });
  });

  describe('status lifecycle', () => {
    it('emits connected on listen', async () => {
      const server = new TestServer();
      const statuses: string[] = [];
      server.status$.subscribe(s => statuses.push(s));
      await server.listen();
      expect(statuses).toContain('connected');
    });

    it('emits disconnected on close without completing', async () => {
      const server = new TestServer();
      const statuses: string[] = [];
      let completed = false;
      server.status$.subscribe({
        next: s => statuses.push(s),
        complete: () => {
          completed = true;
        },
      });
      await server.listen();
      await server.close();
      expect(statuses).toContain('disconnected');
      expect(completed).toBe(false);
    });

    it('supports stop/start restart cycles', async () => {
      const server = new TestServer();
      const statuses: string[] = [];
      server.status$.subscribe(s => statuses.push(s));

      await server.listen();
      await server.close();
      await server.listen();
      await server.close();

      expect(statuses).toEqual([
        'connected',
        'disconnected',
        'connected',
        'disconnected',
      ]);
    });
  });

  describe('circular pattern detection', () => {
    it('throws on circular pattern object', () => {
      const server = new TestServer();
      const handler: MessageHandler = async () => {};
      const pattern: Record<string, unknown> = {a: 1};
      pattern.self = pattern;

      expect(() =>
        server.addHandler(
          server.testNormalizePattern(pattern),
          handler,
        ),
      ).toThrow('Circular reference');
    });
  });

  describe('addHandler with normalized patterns', () => {
    it('normalizes patterns on registration and lookup', () => {
      const server = new TestServer();
      const handler: MessageHandler = async (data) => data;
      handler.isEventHandler = false;

      // Register with unsorted keys
      server.addHandler(
        server.testNormalizePattern({service: 'order', cmd: 'get'}),
        handler,
      );

      // Lookup with different key order
      const found = server.getHandlersByPattern({cmd: 'get', service: 'order'});
      expect(found).toHaveLength(1);
      expect(found![0]).toBe(handler);
    });
  });
});
