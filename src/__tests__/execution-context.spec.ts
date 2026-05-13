import {describe, it, expect} from 'vitest';
import {ExecutionContext} from '../context';

describe('ExecutionContext', () => {
  const handler = () => {};
  class TestController {}

  describe('getType', () => {
    it('returns http for HTTP context', () => {
      const ctx = new ExecutionContext('http', [], handler, TestController);
      expect(ctx.getType()).toBe('http');
    });

    it('returns rpc for RPC context', () => {
      const ctx = new ExecutionContext('rpc', [], handler, TestController);
      expect(ctx.getType()).toBe('rpc');
    });

    it('returns event for event context', () => {
      const ctx = new ExecutionContext('event', [], handler, TestController);
      expect(ctx.getType()).toBe('event');
    });
  });

  describe('getClass and getHandler', () => {
    it('returns the controller class', () => {
      const ctx = new ExecutionContext('http', [], handler, TestController);
      expect(ctx.getClass()).toBe(TestController);
    });

    it('returns the handler function', () => {
      const ctx = new ExecutionContext('http', [], handler, TestController);
      expect(ctx.getHandler()).toBe(handler);
    });
  });

  describe('getArgs', () => {
    it('returns the arguments array', () => {
      const args = ['a', 1, true];
      const ctx = new ExecutionContext('http', args, handler, TestController);
      expect(ctx.getArgs()).toEqual(args);
    });

    it('returns argument by index', () => {
      const ctx = new ExecutionContext('http', ['a', 'b'], handler, TestController);
      expect(ctx.getArgByIndex(1)).toBe('b');
    });
  });

  describe('switchToHttp', () => {
    it('returns HTTP context when set', () => {
      const ctx = new ExecutionContext('http', [], handler, TestController);
      const httpCtx = {
        getRequest: () => ({method: 'GET'}),
        getResponse: () => ({statusCode: 200}),
      };
      ctx.setHttpContext(httpCtx);
      expect(ctx.switchToHttp().getRequest()).toEqual({method: 'GET'});
    });

    it('throws when HTTP context is not set', () => {
      const ctx = new ExecutionContext('event', [], handler, TestController);
      expect(() => ctx.switchToHttp()).toThrow('Cannot switch to HTTP context');
    });
  });

  describe('switchToRpc', () => {
    it('returns RPC context when set', () => {
      const ctx = new ExecutionContext('rpc', [], handler, TestController);
      const rpcCtx = {
        getData: () => ({id: 1}),
        getContext: () => ({}),
        getMethod: () => 'FindOne',
      };
      ctx.setRpcContext(rpcCtx);
      expect(ctx.switchToRpc().getMethod()).toBe('FindOne');
    });

    it('throws when RPC context is not set', () => {
      const ctx = new ExecutionContext('http', [], handler, TestController);
      expect(() => ctx.switchToRpc()).toThrow('Cannot switch to RPC context');
    });
  });

  describe('switchToEvent', () => {
    it('returns event context when set', () => {
      const ctx = new ExecutionContext('event', [], handler, TestController);
      const eventCtx = {
        getData: () => ({orderId: 'abc'}),
        getPattern: () => 'order.placed',
        getContext: () => ({}),
      };
      ctx.setEventContext(eventCtx);
      expect(ctx.switchToEvent().getPattern()).toBe('order.placed');
      expect(ctx.switchToEvent().getData()).toEqual({orderId: 'abc'});
    });

    it('throws when event context is not set', () => {
      const ctx = new ExecutionContext('http', [], handler, TestController);
      expect(() => ctx.switchToEvent()).toThrow('Cannot switch to event context');
    });
  });
});
