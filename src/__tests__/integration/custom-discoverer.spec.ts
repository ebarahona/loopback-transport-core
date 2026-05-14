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
  HandlerRegistry,
  ServerBase,
  TransportBindings,
  TransportComponent,
  registerServer,
  type DiscoveredHandler,
  type HandlerDiscoverer,
  type WritePacket,
} from '../../index';

// ---- A hypothetical third-party decorator vocabulary ----

/**
 * Metadata produced by a fake `@grpcRoute(service, method)` decorator.
 * Lives entirely outside transport-core; the registry never imports it.
 */
interface GrpcRouteMetadata {
  service: string;
  method: string;
}

const GRPC_ROUTE_METADATA = MetadataAccessor.create<
  GrpcRouteMetadata,
  MethodDecorator
>('test:grpc-route');

function grpcRoute(service: string, method: string): MethodDecorator {
  return MethodDecoratorFactory.createDecorator<GrpcRouteMetadata>(
    GRPC_ROUTE_METADATA,
    {service, method},
  );
}

/**
 * Plugin-side `HandlerDiscoverer` for the fake decorator. This is the
 * pattern a future `loopback-transport-grpc` package would use.
 */
class GrpcRouteDiscoverer implements HandlerDiscoverer {
  readonly id = 'grpc';

  discover(controllerClass: Constructor<unknown>): DiscoveredHandler[] {
    const methods = MetadataInspector.getAllMethodMetadata<GrpcRouteMetadata>(
      GRPC_ROUTE_METADATA.key,
      controllerClass.prototype,
    );
    if (!methods) return [];

    const handlers: DiscoveredHandler[] = [];
    for (const [methodName, metadata] of Object.entries(methods)) {
      handlers.push({
        pattern: `${metadata.service}/${metadata.method}`,
        transport: 'grpc',
        kind: 'request',
        methodName,
      });
    }
    return handlers;
  }
}

// ---- A minimal in-memory server for the integration ----

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
      {pattern, data, id: 'test-grpc-1'},
      packet => responses.push(packet),
      context,
    );
    return responses;
  }
}

// ---- The controller under test ----

class GreeterController {
  @grpcRoute('Greeter', 'Hello')
  async hello(data: {name: string}): Promise<{greeting: string}> {
    return {greeting: `hello, ${data.name}`};
  }
}

// ---- Test ----

describe('HandlerDiscoverer extension point: third-party plugin', () => {
  let app: Application;

  beforeEach(() => {
    app = new Application();
    app.component(TransportComponent);
  });

  it('discovers handlers contributed by a custom HandlerDiscoverer', async () => {
    // Bind a plugin-supplied discoverer under the HANDLER_DISCOVERER_TAG.
    app.add(
      Binding.bind('transport.discoverer.grpc')
        .toClass(GrpcRouteDiscoverer)
        .tag(HANDLER_DISCOVERER_TAG)
        .inScope(BindingScope.SINGLETON),
    );
    app.controller(GreeterController);

    const grpcServer = new InMemoryServer();
    registerServer(app, 'grpc', grpcServer);

    const registry = await app.get(TransportBindings.HANDLER_REGISTRY);
    await (registry as HandlerRegistry).discoverHandlers(app);

    const handlers = registry.getHandlers();
    // The grpc handler should be registered with transport "grpc".
    expect(handlers.has('grpc::Greeter/Hello')).toBe(true);
  });

  it('routes plugin-discovered handlers end-to-end through the booter', async () => {
    app.add(
      Binding.bind('transport.discoverer.grpc')
        .toClass(GrpcRouteDiscoverer)
        .tag(HANDLER_DISCOVERER_TAG)
        .inScope(BindingScope.SINGLETON),
    );
    app.controller(GreeterController);

    const grpcServer = new InMemoryServer();
    registerServer(app, 'grpc', grpcServer);

    await app.start();
    try {
      expect(grpcServer.started).toBe(true);
      const bound = grpcServer.getHandlersByPattern('Greeter/Hello');
      expect(bound).toBeDefined();
      expect(bound!.length).toBe(1);

      const responses = await grpcServer.sendMessage('Greeter/Hello', {
        name: 'world',
      });
      expect(responses[0]?.response).toEqual({greeting: 'hello, world'});
    } finally {
      await app.stop();
    }
  });

  it('built-in @messageHandler and @eventHandler discoverers still work alongside plugin discoverers', async () => {
    const {messageHandler} = await import('../../decorators');

    class EchoController {
      @messageHandler('echo')
      async echo(data: {value: string}): Promise<{value: string}> {
        return {value: data.value};
      }
    }

    app.add(
      Binding.bind('transport.discoverer.grpc')
        .toClass(GrpcRouteDiscoverer)
        .tag(HANDLER_DISCOVERER_TAG)
        .inScope(BindingScope.SINGLETON),
    );
    app.controller(GreeterController);
    app.controller(EchoController);

    const memory = new InMemoryServer();
    registerServer(app, 'memory', memory);
    const grpc = new InMemoryServer();
    registerServer(app, 'grpc', grpc);

    await app.start();
    try {
      // Built-in vocabulary bound to the wildcard 'memory' transport.
      const echoResponses = await memory.sendMessage('echo', {value: 'hi'});
      expect(echoResponses[0]?.response).toEqual({value: 'hi'});

      // Plugin vocabulary bound to the 'grpc' transport.
      const grpcResponses = await grpc.sendMessage('Greeter/Hello', {
        name: 'plugin',
      });
      expect(grpcResponses[0]?.response).toEqual({
        greeting: 'hello, plugin',
      });
    } finally {
      await app.stop();
    }
  });
});
