import {describe, it, expect} from 'vitest';
import {ServerBase} from '../server';
import {MessageHandler} from '../interfaces';
import {Observable, of} from 'rxjs';

class TestServer extends ServerBase {
  async listen(): Promise<void> {}
  async close(): Promise<void> {}
  unwrap<T>(): T {
    return undefined as T;
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
      expect(server.getHandlerByPattern('order.get')).toBe(handler);
    });

    it('chains multiple event handlers on the same pattern', () => {
      const server = new TestServer();
      const handler1: MessageHandler = async () => 'first';
      handler1.isEventHandler = true;
      const handler2: MessageHandler = async () => 'second';
      handler2.isEventHandler = true;

      server.addHandler('order.placed', handler1);
      server.addHandler('order.placed', handler2);

      const registered = server.getHandlerByPattern('order.placed');
      expect(registered).toBe(handler1);
      expect(registered?.next).toBe(handler2);
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
    it('dispatches to the handler and responds', async () => {
      const server = new TestServer();
      const handler: MessageHandler = async (data: unknown) => ({
        id: (data as Record<string, unknown>).id,
        name: 'Test',
      });
      server.addHandler('order.get', handler);

      const responses: unknown[] = [];
      await (server as unknown as {
        handleMessage: Function;
      }).handleMessage(
        {pattern: 'order.get', data: {id: 1}, id: 'req-1'},
        (packet: unknown) => responses.push(packet),
      );

      expect(responses).toEqual([
        {response: {id: 1, name: 'Test'}, isDisposed: true},
      ]);
    });

    it('responds with error for unknown pattern', async () => {
      const server = new TestServer();
      const responses: unknown[] = [];
      await (server as unknown as {
        handleMessage: Function;
      }).handleMessage(
        {pattern: 'unknown', data: {}, id: 'req-1'},
        (packet: unknown) => responses.push(packet),
      );

      expect(responses).toEqual([
        {err: 'No handler for pattern: unknown', isDisposed: true},
      ]);
    });

    it('handles Observable return values', async () => {
      const server = new TestServer();
      const handler: MessageHandler = () => of('a', 'b', 'c');
      server.addHandler('stream', handler);

      const responses: unknown[] = [];
      await new Promise<void>(resolve => {
        (server as unknown as {handleMessage: Function}).handleMessage(
          {pattern: 'stream', data: {}, id: 'req-1'},
          (packet: {isDisposed?: boolean}) => {
            responses.push(packet);
            if (packet.isDisposed) resolve();
          },
        );
      });

      expect(responses).toEqual([
        {response: 'a'},
        {response: 'b'},
        {response: 'c'},
        {isDisposed: true},
      ]);
    });

    it('responds with error on handler throw', async () => {
      const server = new TestServer();
      const handler: MessageHandler = async () => {
        throw new Error('Handler failed');
      };
      server.addHandler('fail', handler);

      const responses: unknown[] = [];
      await (server as unknown as {
        handleMessage: Function;
      }).handleMessage(
        {pattern: 'fail', data: {}, id: 'req-1'},
        (packet: unknown) => responses.push(packet),
      );

      expect(responses).toEqual([
        {err: {message: 'Handler failed', name: 'Error'}, isDisposed: true},
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

      await (server as unknown as {
        handleEvent: Function;
      }).handleEvent({pattern: 'order.placed', data: {}});

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

      await (server as unknown as {
        handleEvent: Function;
      }).handleEvent({pattern: 'order.placed', data: {}});

      expect(calls).toEqual(['second']);
    });

    it('silently ignores events with no handler', async () => {
      const server = new TestServer();
      await expect(
        (server as unknown as {handleEvent: Function}).handleEvent({
          pattern: 'unknown',
          data: {},
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('normalizePattern', () => {
    it('passes strings through', () => {
      const server = new TestServer();
      const normalize = (server as unknown as {normalizePattern: Function})
        .normalizePattern;
      expect(normalize.call(server, 'order.get')).toBe('order.get');
    });

    it('sorts object keys and stringifies', () => {
      const server = new TestServer();
      const normalize = (server as unknown as {normalizePattern: Function})
        .normalizePattern;
      expect(normalize.call(server, {cmd: 'get', service: 'order'})).toBe(
        '{"cmd":"get","service":"order"}',
      );
      expect(normalize.call(server, {service: 'order', cmd: 'get'})).toBe(
        '{"cmd":"get","service":"order"}',
      );
    });

    it('deep sorts nested object keys', () => {
      const server = new TestServer();
      const normalize = (server as unknown as {normalizePattern: Function})
        .normalizePattern;
      expect(
        normalize.call(server, {
          meta: {version: 2, type: 'cmd'},
          action: 'get',
        }),
      ).toBe('{"action":"get","meta":{"type":"cmd","version":2}}');
    });
  });

  describe('error serialization', () => {
    it('serializes Error instances with name and message', async () => {
      const server = new TestServer();
      const handler: MessageHandler = async () => {
        throw new TypeError('Invalid input');
      };
      server.addHandler('fail', handler);

      const responses: WritePacket[] = [];
      await (server as unknown as {handleMessage: Function}).handleMessage(
        {pattern: 'fail', data: {}, id: 'req-1'},
        (packet: WritePacket) => responses.push(packet),
      );

      expect(responses[0].err).toEqual({
        message: 'Invalid input',
        name: 'TypeError',
      });
      expect(responses[0].isDisposed).toBe(true);
    });
  });

  describe('addHandler with normalized patterns', () => {
    it('normalizes patterns on registration and lookup', () => {
      const server = new TestServer();
      const handler: MessageHandler = async (data) => data;
      handler.isEventHandler = false;

      // Register with unsorted keys
      server.addHandler(
        server['normalizePattern']({service: 'order', cmd: 'get'}),
        handler,
      );

      // Lookup with different key order
      const found = server.getHandlerByPattern({cmd: 'get', service: 'order'});
      expect(found).toBe(handler);
    });
  });
});
