import {describe, it, expect, beforeEach} from 'vitest';
import {
  Application,
  Binding,
  BindingScope,
  type Constructor,
  MetadataInspector,
} from '@loopback/core';
import {MetadataAccessor, MethodDecoratorFactory} from '@loopback/metadata';
import {
  HANDLER_DISCOVERER_TAG,
  ServerBase,
  TransportBindings,
  TransportComponent,
  eventHandler,
  messageHandler,
  payload,
  registerServer,
  type DiscoveredHandler,
  type HandlerDiscoverer,
  type WritePacket,
} from '../../index';

// ---- Minimal in-memory server reused across tests ----

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

  async sendMessage(
    pattern: string,
    data: unknown,
    context?: unknown,
  ): Promise<WritePacket[]> {
    const responses: WritePacket[] = [];
    await this.handleMessage(
      {pattern, data, id: 'test-ds-1'},
      packet => responses.push(packet),
      context,
    );
    return responses;
  }
}

// ---- A plugin discoverer for the "by discoverer" test ----

interface CronJobMetadata {
  cron: string;
}

const CRON_JOB_METADATA = MetadataAccessor.create<
  CronJobMetadata,
  MethodDecorator
>('test:cron-job');

function cronJob(cron: string): MethodDecorator {
  return MethodDecoratorFactory.createDecorator<CronJobMetadata>(
    CRON_JOB_METADATA,
    {cron},
  );
}

class CronJobDiscoverer implements HandlerDiscoverer {
  readonly id = 'cron';

  discover(controllerClass: Constructor<unknown>): DiscoveredHandler[] {
    const methods = MetadataInspector.getAllMethodMetadata<CronJobMetadata>(
      CRON_JOB_METADATA.key,
      controllerClass.prototype,
    );
    if (!methods) return [];

    return Object.entries(methods).map(([methodName, m]) => ({
      pattern: m.cron,
      transport: 'cron',
      kind: 'event' as const,
      methodName,
    }));
  }
}

describe('DiscoveryService', () => {
  let app: Application;

  beforeEach(() => {
    app = new Application();
    app.component(TransportComponent);
  });

  it('getHandlers() returns empty when no controllers are registered', async () => {
    const memory = new InMemoryServer();
    registerServer(app, 'memory', memory);

    await app.start();
    try {
      const service = await app.get(TransportBindings.DISCOVERY_SERVICE);
      expect(service.getHandlers()).toEqual([]);
    } finally {
      await app.stop();
    }
  });

  it('getHandlers() returns every @messageHandler / @eventHandler', async () => {
    class OrderController {
      @messageHandler('order.get')
      async getOrder(@payload() _data: {id: string}): Promise<unknown> {
        return null;
      }

      @eventHandler('order.placed')
      async onPlaced(@payload() _data: unknown): Promise<void> {
        /* no-op */
      }
    }

    app.controller(OrderController);
    const memory = new InMemoryServer();
    registerServer(app, 'memory', memory);

    await app.start();
    try {
      const service = await app.get(TransportBindings.DISCOVERY_SERVICE);
      const all = service.getHandlers();
      expect(all).toHaveLength(2);

      const methodNames = all.map(h => h.methodName).sort();
      expect(methodNames).toEqual(['getOrder', 'onPlaced']);

      const get = all.find(h => h.methodName === 'getOrder');
      expect(get?.kind).toBe('request');
      expect(get?.controllerClass).toBe(OrderController);
      expect(get?.discovererId).toBe('message');
      expect(typeof get?.invoke).toBe('function');
    } finally {
      await app.stop();
    }
  });

  it('getHandlersForTransport() filters by transport tag', async () => {
    class MixedController {
      @messageHandler('order.create', {transport: 'kafka'})
      async createOrder(@payload() _d: unknown): Promise<unknown> {
        return null;
      }

      @messageHandler('order.get')
      async getOrder(@payload() _d: unknown): Promise<unknown> {
        return null;
      }
    }

    app.controller(MixedController);
    registerServer(app, 'kafka', new InMemoryServer());
    registerServer(app, 'memory', new InMemoryServer());

    await app.start();
    try {
      const service = await app.get(TransportBindings.DISCOVERY_SERVICE);
      const kafka = service.getHandlersForTransport('kafka');
      expect(kafka).toHaveLength(1);
      expect(kafka[0]!.methodName).toBe('createOrder');

      const wildcard = service.getHandlersForTransport('*');
      expect(wildcard).toHaveLength(1);
      expect(wildcard[0]!.methodName).toBe('getOrder');
    } finally {
      await app.stop();
    }
  });

  it('getHandlersByKind() filters by request/event', async () => {
    class MixedController {
      @messageHandler('cmd.run')
      async run(@payload() _d: unknown): Promise<unknown> {
        return null;
      }

      @eventHandler('event.a')
      async onA(@payload() _d: unknown): Promise<void> {
        /* no-op */
      }

      @eventHandler('event.b')
      async onB(@payload() _d: unknown): Promise<void> {
        /* no-op */
      }
    }

    app.controller(MixedController);
    registerServer(app, 'memory', new InMemoryServer());

    await app.start();
    try {
      const service = await app.get(TransportBindings.DISCOVERY_SERVICE);
      expect(service.getHandlersByKind('event')).toHaveLength(2);
      expect(service.getHandlersByKind('request')).toHaveLength(1);
      expect(service.getHandlersByKind('request')[0]!.methodName).toBe('run');
    } finally {
      await app.stop();
    }
  });

  it('getHandlersByDiscoverer() returns only handlers from the matching discoverer', async () => {
    class PaymentsController {
      @messageHandler('payment.charge')
      async charge(@payload() _d: unknown): Promise<unknown> {
        return null;
      }

      @cronJob('0 * * * *')
      async hourlySettle(): Promise<void> {
        /* no-op */
      }
    }

    app.add(
      Binding.bind('test.cron-discoverer')
        .toClass(CronJobDiscoverer)
        .tag(HANDLER_DISCOVERER_TAG)
        .inScope(BindingScope.SINGLETON),
    );
    app.controller(PaymentsController);
    registerServer(app, 'memory', new InMemoryServer());
    registerServer(app, 'cron', new InMemoryServer());

    await app.start();
    try {
      const service = await app.get(TransportBindings.DISCOVERY_SERVICE);

      const messageHandlers = service.getHandlersByDiscoverer('message');
      expect(messageHandlers).toHaveLength(1);
      expect(messageHandlers[0]!.methodName).toBe('charge');

      const cronHandlers = service.getHandlersByDiscoverer('cron');
      expect(cronHandlers).toHaveLength(1);
      expect(cronHandlers[0]!.methodName).toBe('hourlySettle');
      expect(cronHandlers[0]!.discovererId).toBe('cron');
    } finally {
      await app.stop();
    }
  });

  it('getDiscoverers() includes both defaults and plugin discoverers', async () => {
    app.add(
      Binding.bind('test.cron-discoverer')
        .toClass(CronJobDiscoverer)
        .tag(HANDLER_DISCOVERER_TAG)
        .inScope(BindingScope.SINGLETON),
    );
    registerServer(app, 'memory', new InMemoryServer());

    await app.start();
    try {
      const service = await app.get(TransportBindings.DISCOVERY_SERVICE);
      const ids = service
        .getDiscoverers()
        .map(d => d.id)
        .sort();
      expect(ids).toEqual(['cron', 'event', 'message']);
    } finally {
      await app.stop();
    }
  });

  it('getTransportServers() returns every bound transport server', async () => {
    registerServer(app, 'memory', new InMemoryServer());
    registerServer(app, 'kafka', new InMemoryServer());

    await app.start();
    try {
      const service = await app.get(TransportBindings.DISCOVERY_SERVICE);
      expect(service.getTransportServers()).toHaveLength(2);
    } finally {
      await app.stop();
    }
  });

  it('returns defensive copies — mutating results does not affect internal state', async () => {
    class C {
      @messageHandler('a')
      async a(@payload() _d: unknown): Promise<unknown> {
        return null;
      }
    }

    app.controller(C);
    registerServer(app, 'memory', new InMemoryServer());

    await app.start();
    try {
      const service = await app.get(TransportBindings.DISCOVERY_SERVICE);
      const snapshot = service.getHandlers();
      expect(snapshot).toHaveLength(1);
      expect(Object.isFrozen(snapshot)).toBe(true);

      // The frozen array cannot be mutated. The internal state must
      // remain a single-handler snapshot regardless.
      const mutable: unknown[] = snapshot as unknown as unknown[];
      expect(() => mutable.push(null)).toThrow();
      expect(service.getHandlers()).toHaveLength(1);
    } finally {
      await app.stop();
    }
  });
});
