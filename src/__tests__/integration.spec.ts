import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {Application} from '@loopback/core';
import {
  TransportComponent,
  TransportBindings,
  ServerBase,
  HandlerResult,
  messageHandler,
  eventHandler,
  payload,
  transportCtx,
  WritePacket,
} from '../index';

// ---- Test transport server ----

class InMemoryServer extends ServerBase {
  started = false;

  async listen(): Promise<void> {
    this.started = true;
    this.setStatus('connected');
  }

  async close(): Promise<void> {
    this.started = false;
    this.setStatus('disconnected');
  }

  unwrap<T>(): T {
    return undefined as T;
  }

  // Expose protected methods for testing
  async sendMessage(
    pattern: string,
    data: unknown,
    context?: unknown,
  ): Promise<{responses: WritePacket[]; result: HandlerResult}> {
    const responses: WritePacket[] = [];
    const result = await this.handleMessage(
      {pattern, data, id: 'test-req-1'},
      (packet: WritePacket) => responses.push(packet),
      context,
    );
    return {responses, result};
  }

  async sendEvent(
    pattern: string,
    data: unknown,
    context?: unknown,
  ): Promise<void> {
    return this.handleEvent({pattern, data}, context);
  }
}

// ---- Test controllers ----

class OrderController {
  @messageHandler('order.get')
  async getOrder(@payload() data: {id: string}): Promise<{id: string; name: string}> {
    return {id: data.id, name: 'Test Order'};
  }

  @messageHandler({cmd: 'order.create', version: 2})
  async createOrder(@payload() _data: {name: string}): Promise<{created: boolean}> {
    return {created: true};
  }
}

class NotificationController {
  static calls: string[] = [];

  @eventHandler('order.placed')
  async onOrderPlaced(@payload() data: {orderId: string}): Promise<void> {
    NotificationController.calls.push(`placed:${data.orderId}`);
  }

  @eventHandler('order.placed')
  async onOrderPlacedAudit(@payload() data: {orderId: string}): Promise<void> {
    NotificationController.calls.push(`audit:${data.orderId}`);
  }
}

class ContextAwareController {
  @messageHandler('ctx.test')
  async handleWithContext(
    @payload() data: {value: string},
    @transportCtx() ctx: {broker: string},
  ): Promise<{value: string; broker: string}> {
    return {value: data.value, broker: ctx.broker};
  }
}

// ---- Integration tests ----

describe('Integration: full pipeline', () => {
  let app: Application;
  let server: InMemoryServer;

  beforeEach(async () => {
    NotificationController.calls = [];
    app = new Application();
    app.component(TransportComponent);

    server = new InMemoryServer();
    TransportBindings.registerServer(app, 'memory', server);
  });

  afterEach(async () => {
    if (server.started) {
      await app.stop();
    }
  });

  describe('decorator -> metadata -> discovery -> registry -> dispatch', () => {
    it('discovers @messageHandler and dispatches request/response', async () => {
      app.controller(OrderController);
      await app.start();

      expect(server.started).toBe(true);

      const {responses, result} = await server.sendMessage('order.get', {id: '123'});

      expect(result.outcome).toBe('success');
      expect(responses).toEqual([
        {response: {id: '123', name: 'Test Order'}, isDisposed: true},
      ]);
    });

    it('discovers @messageHandler with object pattern', async () => {
      app.controller(OrderController);
      await app.start();

      // Object pattern must match regardless of key order
      const {responses, result} = await server.sendMessage(
        '{"cmd":"order.create","version":2}',
        {name: 'New Order'},
      );

      expect(result.outcome).toBe('success');
      expect(responses).toEqual([
        {response: {created: true}, isDisposed: true},
      ]);
    });

    it('discovers @eventHandler and dispatches to all handlers', async () => {
      app.controller(NotificationController);
      await app.start();

      await server.sendEvent('order.placed', {orderId: 'abc'});

      expect(NotificationController.calls).toEqual([
        'placed:abc',
        'audit:abc',
      ]);
    });

  });

  describe('parameter injection', () => {
    it('@transportCtx() injects the transport context', async () => {
      app.controller(ContextAwareController);
      await app.start();

      const {responses, result} = await server.sendMessage(
        'ctx.test',
        {value: 'hello'},
        {broker: 'kafka'},
      );

      expect(result.outcome).toBe('success');
      expect(responses[0].response).toEqual({
        value: 'hello',
        broker: 'kafka',
      });
    });
  });

  describe('lifecycle', () => {
    it('starts and stops the transport server', async () => {
      app.controller(OrderController);

      expect(server.started).toBe(false);
      await app.start();
      expect(server.started).toBe(true);
      await app.stop();
      expect(server.started).toBe(false);
    });

    it('works with no controllers registered', async () => {
      await app.start();
      expect(server.started).toBe(true);

      const {result} = await server.sendMessage('anything', {});
      expect(result.outcome).toBe('infrastructure-error');

      await app.stop();
    });

    it('works with no transport servers registered', async () => {
      // Remove the server we added in beforeEach
      const freshApp = new Application();
      freshApp.component(TransportComponent);
      freshApp.controller(OrderController);

      // Should boot without errors even with no servers
      await freshApp.start();
      await freshApp.stop();
    });
  });

  describe('class-based server registration', () => {
    it('resolves the same singleton instance for handler binding and startup', async () => {
      const classApp = new Application();
      classApp.component(TransportComponent);
      classApp.controller(OrderController);
      TransportBindings.registerServerClass(classApp, 'memory', InMemoryServer);

      await classApp.start();

      // Resolve the server -- should be the same singleton that was started
      const resolved = await classApp.get<InMemoryServer>(
        TransportBindings.server('memory'),
      );
      expect(resolved.started).toBe(true);

      // Handlers should be bound to this instance
      const handlers = resolved.getHandlersByPattern('order.get');
      expect(handlers).toBeDefined();
      expect(handlers!.length).toBe(1);

      // Dispatch should work
      const {result} = await resolved.sendMessage('order.get', {id: '1'});
      expect(result.outcome).toBe('success');

      await classApp.stop();
    });
  });

  describe('multiple controllers', () => {
    it('discovers handlers from multiple controllers', async () => {
      app.controller(OrderController);
      app.controller(NotificationController);
      await app.start();

      // Request/response from OrderController
      const {result} = await server.sendMessage('order.get', {id: '1'});
      expect(result.outcome).toBe('success');

      // Event from NotificationController
      await server.sendEvent('order.placed', {orderId: '1'});
      expect(NotificationController.calls).toEqual(['placed:1', 'audit:1']);
    });
  });

  describe('handler registry state', () => {
    it('registry reports discovered handlers after start', async () => {
      app.controller(OrderController);
      await app.start();

      const registry = await app.get(TransportBindings.HANDLER_REGISTRY);
      expect(registry.isDiscovered()).toBe(true);
      expect(registry.getHandlers().size).toBeGreaterThan(0);
    });

    it('server has handlers bound after start', async () => {
      app.controller(OrderController);
      await app.start();

      const handlers = server.getHandlers();
      expect(handlers.size).toBeGreaterThan(0);
      expect(server.getHandlersByPattern('order.get')).toBeDefined();
    });
  });
});
