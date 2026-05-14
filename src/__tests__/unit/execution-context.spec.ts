import {describe, it, expect} from 'vitest';
import {ExecutionContext} from '../../context';
import type {
  ControllerClass,
  EventContext,
  HandlerFunction,
  HttpContext,
  RpcContext,
} from '../../context';

const handler: HandlerFunction = () => {};
const TestController = class TestController {} as unknown as ControllerClass;

const httpCtx: HttpContext = {
  getRequest: <T = unknown>() =>
    ({method: 'GET', path: '/orders'}) as unknown as T,
  getResponse: <T = unknown>() => ({statusCode: 200}) as unknown as T,
};

const rpcCtx: RpcContext = {
  getData: <T = unknown>() => ({id: 1}) as unknown as T,
  getContext: <T = unknown>() => ({metadata: {}}) as unknown as T,
  getMethod: () => 'FindOne',
};

const eventCtx: EventContext = {
  getData: <T = unknown>() => ({orderId: 'abc'}) as unknown as T,
  getPattern: () => 'order.placed',
  getContext: <T = unknown>() =>
    ({topic: 'orders', partition: 0}) as unknown as T,
};

describe('ExecutionContext', () => {
  describe('factory methods', () => {
    it('creates HTTP context via forHttp', () => {
      const ctx = ExecutionContext.forHttp(
        [],
        handler,
        TestController,
        httpCtx,
      );
      expect(ctx.getType()).toBe('http');
    });

    it('creates RPC context via forRpc', () => {
      const ctx = ExecutionContext.forRpc([], handler, TestController, rpcCtx);
      expect(ctx.getType()).toBe('rpc');
    });

    it('creates event context via forEvent', () => {
      const ctx = ExecutionContext.forEvent(
        [],
        handler,
        TestController,
        eventCtx,
      );
      expect(ctx.getType()).toBe('event');
    });
  });

  describe('getClass and getHandler', () => {
    it('returns the controller class', () => {
      const ctx = ExecutionContext.forHttp(
        [],
        handler,
        TestController,
        httpCtx,
      );
      expect(ctx.getClass()).toBe(TestController);
    });

    it('returns the handler function', () => {
      const ctx = ExecutionContext.forHttp(
        [],
        handler,
        TestController,
        httpCtx,
      );
      expect(ctx.getHandler()).toBe(handler);
    });
  });

  describe('getArgs', () => {
    it('returns a copy of the arguments array', () => {
      const args = ['a', 1, true];
      const ctx = ExecutionContext.forHttp(
        args,
        handler,
        TestController,
        httpCtx,
      );
      const result = ctx.getArgs();
      expect(result).toEqual(args);
      expect(result).not.toBe(args);
    });

    it('returns argument by index', () => {
      const ctx = ExecutionContext.forHttp(
        ['a', 'b'],
        handler,
        TestController,
        httpCtx,
      );
      expect(ctx.getArgByIndex(1)).toBe('b');
    });

    it('args are not mutated by external changes', () => {
      const args = ['original'];
      const ctx = ExecutionContext.forHttp(
        args,
        handler,
        TestController,
        httpCtx,
      );
      args[0] = 'mutated';
      expect(ctx.getArgByIndex(0)).toBe('original');
    });
  });

  describe('switchToHttp', () => {
    it('returns HTTP context when type is http', () => {
      const ctx = ExecutionContext.forHttp(
        [],
        handler,
        TestController,
        httpCtx,
      );
      expect(ctx.switchToHttp().getRequest()).toEqual({
        method: 'GET',
        path: '/orders',
      });
    });

    it('throws when type is not http', () => {
      const ctx = ExecutionContext.forEvent(
        [],
        handler,
        TestController,
        eventCtx,
      );
      expect(() => ctx.switchToHttp()).toThrow(
        'Cannot switch to HTTP context: current transport type is "event"',
      );
    });
  });

  describe('switchToRpc', () => {
    it('returns RPC context when type is rpc', () => {
      const ctx = ExecutionContext.forRpc([], handler, TestController, rpcCtx);
      expect(ctx.switchToRpc().getMethod()).toBe('FindOne');
    });

    it('throws when type is not rpc', () => {
      const ctx = ExecutionContext.forHttp(
        [],
        handler,
        TestController,
        httpCtx,
      );
      expect(() => ctx.switchToRpc()).toThrow(
        'Cannot switch to RPC context: current transport type is "http"',
      );
    });
  });

  describe('switchToEvent', () => {
    it('returns event context when type is event', () => {
      const ctx = ExecutionContext.forEvent(
        [],
        handler,
        TestController,
        eventCtx,
      );
      expect(ctx.switchToEvent().getPattern()).toBe('order.placed');
      expect(ctx.switchToEvent().getData()).toEqual({orderId: 'abc'});
    });

    it('throws when type is not event', () => {
      const ctx = ExecutionContext.forHttp(
        [],
        handler,
        TestController,
        httpCtx,
      );
      expect(() => ctx.switchToEvent()).toThrow(
        'Cannot switch to event context: current transport type is "http"',
      );
    });
  });

  describe('immutability', () => {
    it('has no setter methods', () => {
      const ctx = ExecutionContext.forHttp(
        [],
        handler,
        TestController,
        httpCtx,
      );
      expect(
        (ctx as unknown as Record<string, unknown>).setHttpContext,
      ).toBeUndefined();
      expect(
        (ctx as unknown as Record<string, unknown>).setRpcContext,
      ).toBeUndefined();
      expect(
        (ctx as unknown as Record<string, unknown>).setEventContext,
      ).toBeUndefined();
    });
  });
});
