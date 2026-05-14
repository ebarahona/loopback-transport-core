import {describe, it, expect} from 'vitest';
import {
  EventHandlerDiscoverer,
  eventHandler,
  messageHandler,
  MessageHandlerDiscoverer,
  payload,
} from '../../index';

describe('MessageHandlerDiscoverer', () => {
  const discoverer = new MessageHandlerDiscoverer();

  it('has stable id "message"', () => {
    expect(discoverer.id).toBe('message');
  });

  it('returns DiscoveredHandler[] for @messageHandler methods', () => {
    class OrderController {
      @messageHandler('order.get')
      async getOrder(@payload() _data: {id: string}): Promise<unknown> {
        return null;
      }
    }

    const found = discoverer.discover(OrderController);
    expect(found).toHaveLength(1);
    const [handler] = found;
    expect(handler!.kind).toBe('request');
    expect(handler!.methodName).toBe('getOrder');
    expect(handler!.pattern).toBe('order.get');
    expect(handler!.transport).toBe('*');
  });

  it('propagates transport name and extras into options', () => {
    class KafkaController {
      @messageHandler('order.create', {
        transport: 'kafka',
        extras: {topic: 'orders'},
      })
      async createOrder(@payload() _data: unknown): Promise<unknown> {
        return null;
      }
    }

    const [handler] = discoverer.discover(KafkaController);
    expect(handler!.transport).toBe('kafka');
    expect(handler!.options?.transport).toBe('kafka');
    expect(handler!.options?.extras).toEqual({topic: 'orders'});
  });

  it('returns [] for an undecorated controller', () => {
    class Plain {
      async noop(): Promise<void> {
        /* no-op */
      }
    }

    expect(discoverer.discover(Plain)).toEqual([]);
  });

  it('ignores @eventHandler metadata on the same class', () => {
    class Mixed {
      @messageHandler('cmd.run')
      async run(@payload() _data: unknown): Promise<unknown> {
        return null;
      }

      @eventHandler('event.happened')
      async onEvent(@payload() _data: unknown): Promise<void> {
        /* no-op */
      }
    }

    const found = discoverer.discover(Mixed);
    expect(found).toHaveLength(1);
    expect(found[0]!.methodName).toBe('run');
    expect(found[0]!.kind).toBe('request');
  });
});

describe('EventHandlerDiscoverer', () => {
  const discoverer = new EventHandlerDiscoverer();

  it('has stable id "event"', () => {
    expect(discoverer.id).toBe('event');
  });

  it('returns DiscoveredHandler[] for multiple @eventHandler methods', () => {
    class NotificationController {
      @eventHandler('order.placed')
      async onPlaced(@payload() _data: unknown): Promise<void> {
        /* no-op */
      }

      @eventHandler('order.shipped', {transport: 'rabbitmq'})
      async onShipped(@payload() _data: unknown): Promise<void> {
        /* no-op */
      }
    }

    const found = discoverer.discover(NotificationController);
    expect(found).toHaveLength(2);
    for (const handler of found) {
      expect(handler.kind).toBe('event');
    }
    const placed = found.find(h => h.methodName === 'onPlaced');
    const shipped = found.find(h => h.methodName === 'onShipped');
    expect(placed?.transport).toBe('*');
    expect(shipped?.transport).toBe('rabbitmq');
    expect(shipped?.options?.transport).toBe('rabbitmq');
  });

  it('returns [] for an undecorated controller', () => {
    class Plain {
      async noop(): Promise<void> {
        /* no-op */
      }
    }

    expect(discoverer.discover(Plain)).toEqual([]);
  });

  it('ignores @messageHandler metadata on the same class', () => {
    class Mixed {
      @messageHandler('cmd.run')
      async run(@payload() _data: unknown): Promise<unknown> {
        return null;
      }

      @eventHandler('event.happened')
      async onEvent(@payload() _data: unknown): Promise<void> {
        /* no-op */
      }
    }

    const found = discoverer.discover(Mixed);
    expect(found).toHaveLength(1);
    expect(found[0]!.methodName).toBe('onEvent');
    expect(found[0]!.kind).toBe('event');
  });
});
