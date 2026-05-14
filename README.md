# @ebarahona/loopback-transport-core

Unified transport abstraction for LoopBack 4. Enables NestJS-style microservices with message handlers, event patterns, unified execution context, and client proxies.

This package is **transport core only** -- it provides the framework abstractions, not broker-specific implementations. Kafka, RabbitMQ, gRPC, MQTT, and NATS adapters are separate packages that extend `ServerBase` and `ClientProxy`.

```bash
npm install @ebarahona/loopback-transport-core
```

> Part of the [`@ebarahona/loopback-*` plugin portfolio](https://github.com/ebarahona/loopback-plugins). See the [portfolio roadmap](https://github.com/ebarahona/loopback-plugins/blob/main/ROADMAP.md) for sibling plugins (`loopback-connector-mongodb`, planned `loopback-graphql`) and the shared infrastructure they use.

## What This Provides

| Export                                    | Purpose                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `TransportComponent`                      | LoopBack 4 component (registers registry + booter)                            |
| `@messageHandler(pattern)`                | Request/response handler decorator                                            |
| `@eventHandler(pattern)`                  | Fire-and-forget event handler decorator                                       |
| `@payload()`                              | Injects the message data (transport invocation context, not HTTP)             |
| `@transportCtx()`                         | Injects the broker-specific context (transport invocation context, not HTTP)  |
| `ClientProxy`                             | Abstract client with `send()` (cold Observable) and `emit()` (Promise)        |
| `ServerBase`                              | Abstract server with handler registry, dispatch, and structured results       |
| `ExecutionContext`                        | Unified context across HTTP, RPC, and event transports                        |
| `HandlerResult`                           | Structured settlement result for adapter ack/nack decisions                   |
| `TransportBindings`                       | Typed binding keys and server registration helpers                            |
| `DiscoveryService`                        | Read-only enumeration of every discovered handler (NestJS-style)              |
| `HandlerDiscoverer`                       | Plugin extension point for custom decorator vocabularies                      |
| `normalizePattern()`                      | Deterministic pattern key generation                                          |
| `Serializer` / `Deserializer`             | Pluggable serialization (JSON default)                                        |
| `TransportServer` / `TransportClient`     | Adapter interfaces                                                            |
| `TransportStatus`                         | Connection status type (`connected`, `disconnected`, `reconnecting`, `error`) |
| `ReadPacket` / `WritePacket` / `PacketId` | Request/response correlation types                                            |

## Usage

### App Setup

```typescript
import {Application} from '@loopback/core';
import {
  TransportComponent,
  TransportBindings,
} from '@ebarahona/loopback-transport-core';

const app = new Application();
app.component(TransportComponent);
```

Works with `RestApplication` for hybrid HTTP + transport apps, or plain `Application` for transport-only microservices.

### Controller

Patterns can be strings or objects. Object patterns are normalized (deep key sort) so `{cmd: 'get', service: 'order'}` and `{service: 'order', cmd: 'get'}` match the same handler.

<details>
<summary><b>Show example: controller with message and event handlers</b></summary>

```typescript
import {
  messageHandler,
  eventHandler,
  payload,
  transportCtx,
} from '@ebarahona/loopback-transport-core';

class OrderController {
  // String pattern -- request/response
  @messageHandler('order.get')
  async getOrder(@payload() data: {id: string}): Promise<Order> {
    return this.orderService.findById(data.id);
  }

  // Object pattern -- request/response
  @messageHandler({cmd: 'order.create', version: 2})
  async createOrder(@payload() data: CreateOrderDto): Promise<Order> {
    return this.orderService.create(data);
  }

  // Fire-and-forget event (multiple handlers allowed per pattern)
  @eventHandler('order.placed')
  async handleOrderPlaced(@payload() data: OrderDto): Promise<void> {
    await this.notificationService.send(data);
  }

  // Access broker-specific context
  @messageHandler('order.process')
  async processOrder(
    @payload() data: OrderDto,
    @transportCtx() ctx: KafkaContext,
  ): Promise<void> {
    const {topic, partition, offset} = ctx;
    // ...
  }
}
```

</details>

Non-JSON values in object patterns (undefined, functions, symbols, NaN, Infinity, BigInt, Date, RegExp, Map, Set, class instances) throw at decoration time.

### Client (Producer)

<details>
<summary><b>Show example: injecting a TransportClient and using send/emit</b></summary>

```typescript
import {inject} from '@loopback/core';
import {lastValueFrom} from 'rxjs';
import {
  TransportBindings,
  TransportClient,
} from '@ebarahona/loopback-transport-core';

class NotificationService {
  constructor(
    @inject(TransportBindings.client('kafka'))
    private kafka: TransportClient,
  ) {}

  // Fire-and-forget
  async notifyShipped(order: Order): Promise<void> {
    await this.kafka.emit('order.shipped', order);
  }

  // Request/response (object pattern)
  async getOrderStatus(id: string): Promise<OrderStatus> {
    return lastValueFrom(
      this.kafka.send<OrderStatus>({cmd: 'order.status'}, {id}),
    );
  }
}
```

</details>

### Registering Transport Servers

Transport adapters register with typed helpers. Class and provider registrations use singleton scope so the same instance receives handlers and gets started.

<details>
<summary><b>Show example: three server-registration shapes</b></summary>

```typescript
import {TransportBindings} from '@ebarahona/loopback-transport-core';

// Concrete instance (tests, simple cases)
TransportBindings.registerServer(app, 'kafka', kafkaServer);

// Class -- IoC container instantiates with full DI (recommended)
TransportBindings.registerServerClass(app, 'kafka', KafkaServer);

// Provider -- async factory with DI
TransportBindings.registerServerProvider(app, 'kafka', KafkaServerProvider);
```

</details>

### Unified Execution Context

`ExecutionContext` provides a NestJS-style context model that adapters or higher-level integrations can use across HTTP, RPC, and event transports:

<details>
<summary><b>Show example: building an event ExecutionContext</b></summary>

```typescript
const ctx = ExecutionContext.forEvent(args, handler, controllerClass, {
  getData: () => eventData,
  getPattern: () => 'order.placed',
  getContext: () => brokerContext,
});

const type = ctx.getType(); // 'http' | 'rpc' | 'event'
const event = ctx.switchToEvent();
const pattern = event.getPattern();
```

</details>

Constructed via immutable factory methods (`forHttp`, `forRpc`, `forEvent`). `switchToX()` validates the context type before returning.

## Adapter Authors

### Extending ServerBase

<details>
<summary><b>Show example: KafkaServer extending ServerBase</b></summary>

```typescript
import {ServerBase} from '@ebarahona/loopback-transport-core';

class KafkaServer extends ServerBase {
  async listen(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({topics: this.getTopics()});
    await this.consumer.run({
      eachMessage: async ({topic, partition, message}) => {
        const data = await this.deserializer.deserialize(message.value);
        const result = await this.handleMessage(
          {pattern: topic, data, id: message.key?.toString() ?? ''},
          packet => this.sendResponse(packet, topic, partition),
          {topic, partition, offset: message.offset},
        );
        // Use result.outcome for ack/nack
      },
    });
    this.setStatus('connected');
  }

  async close(): Promise<void> {
    await this.consumer.disconnect();
    this.setStatus('disconnected');
  }

  unwrap<T>(): T {
    return this.consumer as T;
  }
}
```

</details>

**What the base class handles:**

- Handler registration and lookup via `addHandler()` / `getHandlersByPattern()`
- `clearHandlers()` for restart/rebind safety (called by the booter)
- Message dispatch with `handleMessage()` returning structured `HandlerResult`
- Event fan-out with `handleEvent()` (all handlers for a pattern execute)
- Observable handler timeout (default 30s, configurable via `handlerTimeoutMs`)
- Status stream (`status$`) that survives restart cycles
- `dispose()` for permanent shutdown (completes the status stream)

**What adapters implement:**

- `listen()` -- connect to broker, start consuming, call `setStatus('connected')`
- `close()` -- disconnect from broker, call `setStatus('disconnected')`
- `unwrap<T>()` -- expose the native client

### Extending ClientProxy

<details>
<summary><b>Show example: KafkaClient extending ClientProxy</b></summary>

```typescript
import {ClientProxy} from '@ebarahona/loopback-transport-core';

class KafkaClient extends ClientProxy {
  async connect(): Promise<void> {
    await this.producer.connect();
  }

  protected async doClose(): Promise<void> {
    // Called by base close() -- must handle partially opened resources
    await this.producer.disconnect();
  }

  unwrap<T>(): T {
    return this.producer as T;
  }

  protected publish(packet, callback): () => void {
    // Send request, register correlation callback
  }

  protected async dispatchEvent(packet): Promise<void> {
    // Fire-and-forget publish
  }
}
```

</details>

**What the base class handles:**

- Lazy connection on first `send()` / `emit()`
- Concurrent connect deduplication
- Epoch-based stale connection detection (close during connect)
- Close idempotency and deduplication
- Bounded wait for pending connect during close (`closeConnectTimeoutMs`, default 5s)
- State machine: `idle` -> `connecting` -> `connected` -> `closing` -> `idle`
- Status stream (`status$`)

**What adapters implement:**

- `connect()` -- establish broker connection (idempotent)
- `doClose()` -- tear down native connection (may be called with partial connect)
- `unwrap<T>()` -- expose the native client
- `publish(packet, callback)` -- send request, return teardown function
- `dispatchEvent(packet)` -- fire-and-forget publish

### Handler Results

`handleMessage()` returns a structured `HandlerResult` for broker settlement:

<details>
<summary><b>Show example: dispatching on HandlerResult.outcome</b></summary>

```typescript
const result = await this.handleMessage(request, respond, context);

switch (result.outcome) {
  case 'success':
    // Handler completed normally. Ack.
    await channel.ack(msg);
    break;
  case 'handler-error':
    // Application error. Error response sent to caller. Ack.
    await channel.ack(msg);
    break;
  case 'infrastructure-error':
    // No handler, respond() failure, or framework error. Nack/dead-letter.
    await channel.nack(msg, false, false);
    break;
}
```

</details>

## Custom decorator vocabularies

Transport-core ships with two decorator vocabularies (`@messageHandler` and `@eventHandler`), but the discovery layer is open. Plugins (gRPC routes, cron schedules, WebSocket subscriptions, etc.) can contribute their own decorators by implementing `HandlerDiscoverer` and binding it under `HANDLER_DISCOVERER_TAG`. The handler registry consults every bound discoverer for every controller at boot, so the built-in decorators and any plugin decorators coexist without modifications to transport-core.

```typescript
import type {Constructor} from '@loopback/core';
import type {
  HandlerKind,
  HandlerOptions,
} from '@ebarahona/loopback-transport-core';

interface DiscoveredHandler {
  pattern: string | Record<string, unknown>;
  transport: string; // '*' for wildcard
  kind: HandlerKind; // open string type; see below
  methodName: string;
  options?: HandlerOptions;
}

interface HandlerDiscoverer {
  readonly id: string;
  discover(
    controllerClass: Constructor<unknown>,
  ): DiscoveredHandler[] | Promise<DiscoveredHandler[]>;
}
```

The `kind` field is an open string type (`HandlerKind = 'request' | 'event' | (string & {})`). The well-known constants `HANDLER_KIND_REQUEST` and `HANDLER_KIND_EVENT` are exported for the default decorators; plugins are free to declare additional kinds such as `'cron'`, `'subscription'`, or `'stream'` without waiting for a transport-core release.

A hypothetical `loopback-transport-grpc` plugin defining `@grpcRoute` would look like:

<details>
<summary><b>Show example: a plugin contributing its own decorator vocabulary</b></summary>

```typescript
import {
  Binding,
  BindingScope,
  Component,
  Constructor,
  MetadataInspector,
} from '@loopback/core';
import {MetadataAccessor, MethodDecoratorFactory} from '@loopback/metadata';
import {
  HANDLER_DISCOVERER_TAG,
  type DiscoveredHandler,
  type HandlerDiscoverer,
} from '@ebarahona/loopback-transport-core';

interface GrpcRouteMetadata {
  service: string;
  method: string;
}

const GRPC_ROUTE_METADATA = MetadataAccessor.create<
  GrpcRouteMetadata,
  MethodDecorator
>('grpc:route');

export function grpcRoute(service: string, method: string): MethodDecorator {
  return MethodDecoratorFactory.createDecorator<GrpcRouteMetadata>(
    GRPC_ROUTE_METADATA,
    {service, method},
  );
}

export class GrpcRouteDiscoverer implements HandlerDiscoverer {
  readonly id = 'grpc';

  discover(controllerClass: Constructor<unknown>): DiscoveredHandler[] {
    const methods = MetadataInspector.getAllMethodMetadata<GrpcRouteMetadata>(
      GRPC_ROUTE_METADATA.key,
      controllerClass.prototype,
    );
    if (!methods) return [];
    return Object.entries(methods).map(([methodName, m]) => ({
      pattern: `${m.service}/${m.method}`,
      transport: 'grpc',
      kind: 'request' as const,
      methodName,
    }));
  }
}

export class GrpcComponent implements Component {
  readonly bindings = [
    Binding.bind('grpc.discoverer')
      .toClass(GrpcRouteDiscoverer)
      .tag(HANDLER_DISCOVERER_TAG)
      .inScope(BindingScope.SINGLETON),
  ];
}
```

</details>

The built-in `@messageHandler` and `@eventHandler` are themselves implemented as default `HandlerDiscoverer` instances (`MessageHandlerDiscoverer`, `EventHandlerDiscoverer`) bound by `TransportComponent`, so plugin-supplied vocabularies operate on equal footing with the framework.

## Universal discovery

`DiscoveryService` is a read-only enumeration of every handler the application contains, regardless of which `HandlerDiscoverer` produced it or which transport server serves it. This mirrors the `DiscoveryService` exposed by NestJS's `@nestjs/core` package. Inject it from `TransportBindings.DISCOVERY_SERVICE` after boot to build cross-cutting integrations: schema export, audit registries, OpenAPI generation, observability boots.

Available methods:

- `getHandlers()`: every `RegisteredHandler` across every discoverer.
- `getHandlersForTransport(transport)`: handlers bound to a specific transport id.
- `getHandlersByKind(kind)`: filter by `'request'` or `'event'`.
- `getHandlersByDiscoverer(discovererId)`: handlers produced by one `HandlerDiscoverer`.
- `getDiscoverers()`: the live list of bound discoverers.
- `getTransportServers()`: every registered `TransportServer`.
- `getSerializers()`: every binding tagged with `SERIALIZER_TAG`.
- `getDeserializers()`: every binding tagged with `DESERIALIZER_TAG`.
- `getSerializerForTransport(transport)`: resolves the serializer for a transport using the same precedence as `ServerBase.resolveSerializer` (transport-scoped tag, then generic tag).
- `getDeserializerForTransport(transport)`: same precedence, applied to the inbound side.

<details>
<summary><b>Show example: a boot-time audit pass that catalogues every handler</b></summary>

```typescript
import {inject, lifeCycleObserver, LifeCycleObserver} from '@loopback/core';
import {
  DiscoveryService,
  TransportBindings,
} from '@ebarahona/loopback-transport-core';

@lifeCycleObserver()
export class HandlerAuditObserver implements LifeCycleObserver {
  constructor(
    @inject(TransportBindings.DISCOVERY_SERVICE)
    private readonly discovery: DiscoveryService,
  ) {}

  async start(): Promise<void> {
    for (const h of this.discovery.getHandlers()) {
      console.log(
        `[audit] ${h.discovererId} ${h.transport} ${h.kind} ` +
          `${h.controllerClass.name}.${h.methodName} pattern=${JSON.stringify(h.pattern)}`,
      );
    }
  }
}
```

</details>

## Boot-time validation

At application start, `HandlerRegistry.bindToServers` validates the
registered handlers and transport servers against four common
misconfigurations. The intent is to fail loud at boot rather than
silently drop events at runtime.

| Misconfiguration                                                  | Default behavior                                          | Configurable                                |
| ----------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------- |
| Handler references a transport name no `TransportServer` provides | Throws `TransportConfigError`                             | Yes, via `TransportBindings.STRICT_BINDING` |
| Two `TransportServer` bindings share the same `NAME` tag          | Throws `TransportConfigError`                             | No                                          |
| `TransportServer` is bound without a `NAME` tag                   | Debug log; server is skipped (no `listen()`, no handlers) | No                                          |
| Handlers exist but no `TransportServer` bindings are registered   | Debug log                                                 | No                                          |

The first guard is the loudest, because misnamed transports silently
drop events at runtime if not caught at boot. The error lists every
orphaned handler with its controller, method, pattern, and discoverer
id, plus the set of known transport names so misspellings are easy to
spot.

To suppress the throw (for example to register handlers before their
transport server is ready), set:

```typescript
app.bind(TransportBindings.STRICT_BINDING).to(false);
```

before calling `app.start()`. Orphaned handlers will then be logged
via `debug` instead of throwing.

## Cross-cutting concerns

Cross-cutting work (metrics, tracing, audit, authorization) goes through LoopBack 4's standard `@globalInterceptor` mechanism. Every transport handler runs through the same `invokeMethod` pipeline as HTTP controllers, so a single global interceptor instruments the whole application without per-decorator wiring or a separate wrapper extension point.

<details>
<summary><b>Show example: a global metrics interceptor timing every method invocation</b></summary>

```typescript
import {
  globalInterceptor,
  Interceptor,
  InvocationContext,
  Provider,
  ValueOrPromise,
} from '@loopback/core';

@globalInterceptor('metrics', {tags: {name: 'metrics'}})
export class MetricsInterceptor implements Provider<Interceptor> {
  value(): Interceptor {
    return async (invocationCtx: InvocationContext, next) => {
      const label = `${invocationCtx.targetClass.name}.${invocationCtx.methodName}`;
      const start = process.hrtime.bigint();
      try {
        return await next();
      } finally {
        const ns = Number(process.hrtime.bigint() - start);
        metrics.observe(label, ns / 1_000_000);
      }
    };
  }
}
```

</details>

If an interceptor needs handler metadata (pattern, transport, discovererId) at invocation time, inject `DiscoveryService` into the provider and look up the entry by `invocationCtx.targetClass` and `invocationCtx.methodName`.

## Lifecycle Behavior

- **Startup**: The `TransportBooter` lifecycle observer discovers decorated handlers from controllers, binds them to registered servers, and starts servers sequentially. If any server fails to start, all previously started servers are rolled back.
- **Shutdown**: All servers stop in parallel (best-effort). Individual stop failures are logged but do not prevent other servers from stopping.
- **Restart**: Handlers are cleared from servers and rebound on each start. Status streams survive `close()` -- only `dispose()` completes them permanently.
- **Singleton scope**: `registerServerClass()` and `registerServerProvider()` bind in singleton scope so the same instance receives handlers and gets started.

## Transport Modules

Companion adapter packages, each implementing `TransportServer` and `TransportClient`:

| Package                                  | Transport    | Native Client   |
| ---------------------------------------- | ------------ | --------------- |
| `@ebarahona/loopback-transport-kafka`    | Apache Kafka | `kafkajs`       |
| `@ebarahona/loopback-transport-rabbitmq` | RabbitMQ     | `amqplib`       |
| `@ebarahona/loopback-transport-grpc`     | gRPC         | `@grpc/grpc-js` |
| `@ebarahona/loopback-transport-mqtt`     | MQTT         | `mqtt`          |
| `@ebarahona/loopback-transport-nats`     | NATS         | `nats`          |

## Event envelopes

[CloudEvents 1.0](https://cloudevents.io) is a CNCF standard envelope format for event data. Knative, Dapr, Azure Event Grid, AWS EventBridge, NATS JetStream, and GCP Eventarc all speak CloudEvents natively. Binding `CloudEventsSerializer` / `CloudEventsDeserializer` into a transport adapter makes the adapter interoperable with that broader cloud-native event ecosystem.

The serializer is marked `@experimental` until validated by a real adapter. It plugs into the existing `Serializer` / `Deserializer` interface -- no architectural changes are required on the adapter side. Structured mode (the default) embeds attributes in the JSON payload and is broker-agnostic. Binary mode places attributes in transport headers and keeps the payload clean, suitable for Kafka, AMQP, and HTTP binary content mode.

The `cloudevents` SDK is a peer dependency; install it alongside transport-core when using these helpers.

<details>
<summary><b>Show example: binding CloudEventsSerializer into a transport adapter</b></summary>

```typescript
import {
  CloudEventsSerializer,
  CloudEventsDeserializer,
} from '@ebarahona/loopback-transport-core';

const serializer = new CloudEventsSerializer({
  source: '/orders',
  typePrefix: 'com.example.order',
  mode: 'structured', // or 'binary' for Kafka/AMQP/HTTP
});
const deserializer = new CloudEventsDeserializer();

// Adapter wires these into its consume/produce loop in place of the
// default JsonSerializer / JsonDeserializer.
class KafkaServerCE extends ServerBase {
  protected override serializer = serializer;
  protected override deserializer = deserializer;
  // ...
}
```

</details>

<details>
<summary><b>Show example: handler receiving a deserialized CloudEvent payload</b></summary>

```typescript
import {eventHandler, payload} from '@ebarahona/loopback-transport-core';

class OrderController {
  // CloudEvents `type` arrives as the handler's pattern, prefixed by
  // CloudEventsSerializerOptions.typePrefix. The packet's `data`
  // attribute is the CloudEvent `data` payload; `correlationId` is the
  // CloudEvent `id`.
  @eventHandler('com.example.order.placed')
  async onPlaced(@payload() data: OrderDto): Promise<void> {
    await this.notificationService.send(data);
  }
}
```

</details>

See https://cloudevents.io and the [CNCF JavaScript SDK](https://github.com/cloudevents/sdk-javascript) for protocol details.

Serializers and deserializers are tag-based extension points. Bind your implementation under `TransportBindings.tags.SERIALIZER` (or `DESERIALIZER` for the inbound side) to make it discoverable by every `ServerBase` instance at boot. Add `TransportBindings.tags.NAME` set to a transport tag (for example `'kafka'`) to scope a serializer to a single transport; without that tag the serializer is treated as generic and applies wherever no transport-scoped match exists. Subclass-level defaults set via the `protected serializer` field on a `ServerBase` subclass still work as the final fallback.

<details>
<summary><b>Show example: registering a MsgPack serializer via tag</b></summary>

```typescript
import {Binding, BindingScope, Component} from '@loopback/core';
import {
  DESERIALIZER_TAG,
  SERIALIZER_TAG,
  type Deserializer,
  type Serializer,
} from '@ebarahona/loopback-transport-core';
import {decode, encode} from '@msgpack/msgpack';

class MsgPackSerializer implements Serializer {
  serialize(value: unknown): Uint8Array {
    return encode(value);
  }
}

class MsgPackDeserializer implements Deserializer {
  deserialize(bytes: Uint8Array): unknown {
    return decode(bytes);
  }
}

export class MsgPackComponent implements Component {
  readonly bindings = [
    Binding.bind('serializers.msgpack')
      .toClass(MsgPackSerializer)
      .tag(SERIALIZER_TAG)
      .inScope(BindingScope.SINGLETON),
    Binding.bind('deserializers.msgpack')
      .toClass(MsgPackDeserializer)
      .tag(DESERIALIZER_TAG)
      .inScope(BindingScope.SINGLETON),
  ];
}
```

`app.component(MsgPackComponent)` and every `ServerBase` instance resolves to MsgPack at boot; no per-transport wiring required.

#### Scoping to a specific transport

If you need different codecs per transport (for example Avro on Kafka via a schema registry, JSON on Redis Pub/Sub for mixed consumers), add `TransportBindings.tags.NAME` to the binding to scope it to one transport. Resolution at boot is transport-scoped first, then generic, then the subclass-default `protected serializer` field.

```typescript
Binding.bind('serializers.avro-kafka')
  .toClass(AvroSerializer)
  .tag(SERIALIZER_TAG)
  .tag({[TransportBindings.tags.NAME]: 'kafka'})
  .inScope(BindingScope.SINGLETON);
```

</details>

#### Implementing TransportServer directly

`resolveSerializer(app: Application): Promise<void>` is a required member of the `TransportServer` interface. Subclasses of `ServerBase` inherit a default implementation that performs the tag-based resolution described above. Servers that implement `TransportServer` directly (without extending `ServerBase`) must define `resolveSerializer` themselves; a no-op is acceptable for servers that hardcode their codec.

## Reaching the native driver

This package exposes the transport surface via typed helpers, and the native broker client is one method call away through documented escape hatches. The goal is that users never need to leave LoopBack 4's DI surface to use a broker-specific feature -- everything the core does not abstract is reachable through `unwrap<T>()` on the registered `TransportServer` or `TransportClient`.

### Reaching the native server

`ServerBase` exposes the underlying broker consumer via `unwrap<T>()`. Adapter authors implement it; consumers call it after acquiring the server from the container.

```typescript
import {TransportBindings} from '@ebarahona/loopback-transport-core';

const server = await app.get(TransportBindings.server('kafka'));
const consumer = server.unwrap<Consumer>(); // kafkajs Consumer
consumer.on('consumer.crash', err => log.error(err));
```

### Reaching the native client

`ClientProxy` exposes the underlying broker producer via `unwrap<T>()`. The same pattern applies to every transport.

```typescript
const client = await app.get(TransportBindings.client('kafka'));
const producer = client.unwrap<Producer>(); // kafkajs Producer
await producer.send({topic: 'audit', messages: [{value: payload}]});
```

### Reaching the execution arguments

`ExecutionContext.getArgs<T>()` returns a copy of the handler arguments tuple, and `getArgByIndex<T>(i)` returns a single argument typed as `T`. Both methods cast through the supplied generic so adapters can recover the original tuple shape at the call site.

```typescript
const [data, ctx] = exec.getArgs<readonly [OrderDto, KafkaContext]>();
const handlerData = exec.getArgByIndex<OrderDto>(0);
```

These generic casts are marked `@experimental`; see [Known limitations](#known-limitations).

## Known limitations

These APIs are marked `@experimental` for the first release. They work but have documented edge cases pending follow-up work.

### Generic casts on `ExecutionContext` accessors

`ExecutionContext.getClass<T>()`, `getArgs<T>()`, and `getArgByIndex<T>()` accept a generic and return the underlying value cast to that generic without runtime validation. Misalignment between the caller's `T` and the actual handler shape produces a silent type-system lie, not a runtime error. Validate inputs at the boundary if the handler shape is not fixed by adapter convention. A future release will replace these with overloaded signatures keyed off the recorded handler metadata.

### `ClientProxy.assignPacketId` correlation IDs

The default `assignPacketId` uses `crypto.randomUUID()` for correlation IDs. The format is hardcoded; adapters that need a transport-specific ID shape (Kafka headers with binary keys, gRPC `request-id` semantics, MQTT 5 `Correlation Data` byte arrays) currently override the entire method to substitute their own generator. A future release will expose an injectable `IdGenerator` interface so adapters can swap the generator without overriding the protected method.

## Requirements

- Node.js >= 20.19.0
- LoopBack 4 application

Peer dependencies: `@loopback/core` (>=7.0.0 <8.0.0), `@loopback/metadata` (>=8.0.0 <9.0.0). Runtime dependencies: `rxjs` 7.x, `debug`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

The full API reference is published at https://ebarahona.github.io/loopback-transport-core (generated by TypeDoc on every release).

## License

MIT
