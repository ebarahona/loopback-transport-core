import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {Application, Binding} from '@loopback/core';
import {
  ServerBase,
  TRANSPORT_NAME_TAG,
  TRANSPORT_SERVER_TAG,
  TransportBindings,
  TransportComponent,
  TransportConfigError,
  messageHandler,
  registerServer,
  type WritePacket,
} from '../../index';

// ---- Minimal stub server, mirroring custom-discoverer.spec / custom-serializer.spec ----

class TestServer extends ServerBase {
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
      {pattern, data, id: 'test-validation-1'},
      packet => responses.push(packet),
      context,
    );
    return responses;
  }
}

/**
 * Bind a `TestServer` instance without going through `registerServer` so
 * we can construct edge-case bindings (duplicate NAME tags, missing NAME
 * tag) that the helper does not allow.
 */
function bindRawServer(
  app: Application,
  bindingKey: string,
  instance: TestServer,
  opts: {name?: string} = {},
): void {
  const binding = Binding.bind<TestServer>(bindingKey)
    .to(instance)
    .tag(TRANSPORT_SERVER_TAG);
  if (opts.name !== undefined) {
    binding.tag({[TRANSPORT_NAME_TAG]: opts.name});
  }
  app.add(binding);
}

// ---- Controllers used by the test cases ----

class MixedTransportController {
  @messageHandler('orders.create', {transport: 'kafka'})
  async createOrder(data: unknown): Promise<unknown> {
    return data;
  }

  @messageHandler('users.create', {transport: 'mongo'})
  async createUser(data: unknown): Promise<unknown> {
    return data;
  }
}

class NoopController {
  @messageHandler('noop')
  async noop(data: unknown): Promise<unknown> {
    return data;
  }
}

class WildcardOnlyController {
  @messageHandler('x.y')
  async xy(data: unknown): Promise<unknown> {
    return data;
  }
}

class OrphanController {
  @messageHandler('lonely.handler')
  async lonely(data: unknown): Promise<unknown> {
    return data;
  }
}

// ---- Tests ----

describe('Boot-time binding validation guards (v1.1.1)', () => {
  let app: Application;

  beforeEach(() => {
    app = new Application();
    app.component(TransportComponent);
  });

  afterEach(async () => {
    // Best-effort teardown for tests that successfully start.
    try {
      await app.stop();
    } catch {
      /* swallow: the test may have failed to start, or already stopped */
    }
  });

  describe('Guard 1: handler references unknown transport', () => {
    it('throws TransportConfigError listing the orphan when STRICT_BINDING defaults to true', async () => {
      const kafka = new TestServer();
      registerServer(app, 'kafka', kafka);
      app.controller(MixedTransportController);

      let caught: unknown;
      try {
        await app.start();
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(TransportConfigError);
      const message = (caught as Error).message;
      expect(message).toContain('unknown transport');
      expect(message).toContain('mongo');
      expect(message).toContain('MixedTransportController');
      expect(message).toContain('users.create');
      expect(message).toContain('message');
      // Known-transport set must include the registered server's name.
      expect(message).toContain('kafka');
    });
  });

  describe('Guard 1 toggle: STRICT_BINDING=false', () => {
    it('downgrades the throw to a debug log and leaves the orphan unbound', async () => {
      const kafka = new TestServer();
      registerServer(app, 'kafka', kafka);
      app.controller(MixedTransportController);

      app.bind(TransportBindings.STRICT_BINDING).to(false);

      await expect(app.start()).resolves.toBeUndefined();

      // The orphan ('users.create' on 'mongo') exists in the registry
      // but is not bound to any server.
      const registry = await app.get(TransportBindings.HANDLER_REGISTRY);
      const handlers = registry.getHandlers();
      // Registry uses `transport::pattern` keys internally; mongo orphan
      // and kafka handler must both appear.
      const keys = Array.from(handlers.keys());
      expect(keys.some(k => k.includes('users.create'))).toBe(true);
      expect(keys.some(k => k.includes('orders.create'))).toBe(true);

      // Kafka server received its transport-scoped handler.
      expect(kafka.getHandlersByPattern('orders.create')).toBeDefined();
      // No mongo server was registered, so the orphan handler was not
      // bound anywhere.
      expect(kafka.getHandlersByPattern('users.create')).toBeUndefined();
    });
  });

  describe('Guard 3: duplicate NAME tags', () => {
    it('throws TransportConfigError naming the duplicated transport (STRICT_BINDING=true)', async () => {
      const a = new TestServer();
      const b = new TestServer();
      bindRawServer(app, 'transport.server.kafka.primary', a, {name: 'kafka'});
      bindRawServer(app, 'transport.server.kafka.secondary', b, {
        name: 'kafka',
      });
      app.controller(NoopController);

      let caught: unknown;
      try {
        await app.start();
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(TransportConfigError);
      const message = (caught as Error).message;
      expect(message).toContain('duplicate transport name');
      expect(message).toContain('kafka');
    });

    it('throws regardless of STRICT_BINDING value', async () => {
      const a = new TestServer();
      const b = new TestServer();
      bindRawServer(app, 'transport.server.kafka.primary', a, {name: 'kafka'});
      bindRawServer(app, 'transport.server.kafka.secondary', b, {
        name: 'kafka',
      });
      app.controller(NoopController);
      app.bind(TransportBindings.STRICT_BINDING).to(false);

      let caught: unknown;
      try {
        await app.start();
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(TransportConfigError);
      const message = (caught as Error).message;
      expect(message).toContain('duplicate transport name');
      expect(message).toContain('kafka');
    });
  });

  describe('Guard 4: TransportServer binding without NAME tag', () => {
    it('warns and does not throw; only wildcard handlers can target the server', async () => {
      const server = new TestServer();
      // SERVER tag only, no NAME tag.
      bindRawServer(app, 'transport.server.unnamed', server);
      app.controller(WildcardOnlyController);

      await expect(app.start()).resolves.toBeUndefined();

      // Wildcard handlers are not routed to NAME-less servers under the
      // v1.1.1 guards: the registry skips the server because it has no
      // NAME tag (only wildcard handlers can reach it, and the binding
      // loop short-circuits). The handler itself must still appear in
      // the registry.
      const registry = await app.get(TransportBindings.HANDLER_REGISTRY);
      const keys = Array.from(registry.getHandlers().keys());
      expect(keys.some(k => k.includes('x.y'))).toBe(true);
    });
  });

  describe('Guard 2: handlers exist but zero TransportServer bindings', () => {
    it('warns and does not throw; the handler is registered but unbound', async () => {
      // No transport server bound at all.
      app.controller(OrphanController);

      await expect(app.start()).resolves.toBeUndefined();

      const registry = await app.get(TransportBindings.HANDLER_REGISTRY);
      const keys = Array.from(registry.getHandlers().keys());
      expect(keys.some(k => k.includes('lonely.handler'))).toBe(true);
    });
  });
});
