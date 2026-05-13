# @ebarahona/loopback-transport-core

Unified transport abstraction for LoopBack 4. Enables NestJS-style microservices with message handlers, event patterns, unified execution context, and client proxies.

This package is **transport core only** -- it provides the framework abstractions, not broker-specific implementations. Kafka, RabbitMQ, gRPC, MQTT, and NATS adapters are separate packages that extend `ServerBase` and `ClientProxy`.

```bash
npm install @ebarahona/loopback-transport-core
```

## What This Provides

| Export | Purpose |
|---|---|
| `TransportComponent` | LoopBack 4 component (registers registry + booter) |
| `@messageHandler(pattern)` | Request/response handler decorator |
| `@eventHandler(pattern)` | Fire-and-forget event handler decorator |
| `@payload()` | Injects the message data (transport invocation context, not HTTP) |
| `@transportCtx()` | Injects the broker-specific context (transport invocation context, not HTTP) |
| `ClientProxy` | Abstract client with `send()` (cold Observable) and `emit()` (Promise) |
| `ServerBase` | Abstract server with handler registry, dispatch, and structured results |
| `ExecutionContext` | Unified context across HTTP, RPC, and event transports |
| `HandlerResult` | Structured settlement result for adapter ack/nack decisions |
| `TransportBindings` | Typed binding keys and server registration helpers |
| `normalizePattern()` | Deterministic pattern key generation |
| `Serializer` / `Deserializer` | Pluggable serialization (JSON default) |
| `TransportServer` / `TransportClient` | Adapter interfaces |
| `TransportStatus` | Connection status type (`connected`, `disconnected`, `reconnecting`, `error`) |
| `ReadPacket` / `WritePacket` / `PacketId` | Request/response correlation types |

## Usage

### App Setup

```typescript
import {Application} from '@loopback/core';
import {TransportComponent, TransportBindings} from '@ebarahona/loopback-transport-core';

const app = new Application();
app.component(TransportComponent);
```

Works with `RestApplication` for hybrid HTTP + transport apps, or plain `Application` for transport-only microservices.

### Controller

Patterns can be strings or objects. Object patterns are normalized (deep key sort) so `{cmd: 'get', service: 'order'}` and `{service: 'order', cmd: 'get'}` match the same handler.

```typescript
import {messageHandler, eventHandler, payload, transportCtx} from '@ebarahona/loopback-transport-core';

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

Non-JSON values in object patterns (undefined, functions, symbols, NaN, Infinity, BigInt, Date, RegExp, Map, Set, class instances) throw at decoration time.

### Client (Producer)

```typescript
import {inject} from '@loopback/core';
import {lastValueFrom} from 'rxjs';
import {TransportBindings, TransportClient} from '@ebarahona/loopback-transport-core';

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

### Registering Transport Servers

Transport adapters register with typed helpers. Class and provider registrations use singleton scope so the same instance receives handlers and gets started.

```typescript
import {TransportBindings} from '@ebarahona/loopback-transport-core';

// Concrete instance (tests, simple cases)
TransportBindings.registerServer(app, 'kafka', kafkaServer);

// Class -- IoC container instantiates with full DI (recommended)
TransportBindings.registerServerClass(app, 'kafka', KafkaServer);

// Provider -- async factory with DI
TransportBindings.registerServerProvider(app, 'kafka', KafkaServerProvider);
```

### Unified Execution Context

`ExecutionContext` provides a NestJS-style context model that adapters or higher-level integrations can use across HTTP, RPC, and event transports:

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

Constructed via immutable factory methods (`forHttp`, `forRpc`, `forEvent`). `switchToX()` validates the context type before returning.

## Adapter Authors

### Extending ServerBase

```typescript
import {ServerBase} from '@ebarahona/loopback-transport-core';

class KafkaServer extends ServerBase {
  constructor() {
    super({handlerTimeoutMs: 10_000}); // default 30s
  }

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

  unwrap<T>(): T { return this.consumer as T; }
}
```

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

  unwrap<T>(): T { return this.producer as T; }

  protected publish(packet, callback): () => void {
    // Send request, register correlation callback
  }

  protected async dispatchEvent(packet): Promise<void> {
    // Fire-and-forget publish
  }
}
```

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

## Lifecycle Behavior

- **Startup**: The `TransportBooter` lifecycle observer discovers decorated handlers from controllers, binds them to registered servers, and starts servers sequentially. If any server fails to start, all previously started servers are rolled back.
- **Shutdown**: All servers stop in parallel (best-effort). Individual stop failures are logged but do not prevent other servers from stopping.
- **Restart**: Handlers are cleared from servers and rebound on each start. Status streams survive `close()` -- only `dispose()` completes them permanently.
- **Singleton scope**: `registerServerClass()` and `registerServerProvider()` bind in singleton scope so the same instance receives handlers and gets started.

## Transport Modules

Companion adapter packages, each implementing `TransportServer` and `TransportClient`:

| Package | Transport | Native Client |
|---|---|---|
| `@ebarahona/loopback-transport-kafka` | Apache Kafka | `kafkajs` |
| `@ebarahona/loopback-transport-rabbitmq` | RabbitMQ | `amqplib` |
| `@ebarahona/loopback-transport-grpc` | gRPC | `@grpc/grpc-js` |
| `@ebarahona/loopback-transport-mqtt` | MQTT | `mqtt` |
| `@ebarahona/loopback-transport-nats` | NATS | `nats` |

## Requirements

- Node.js >= 18
- LoopBack 4 application

Peer dependencies (`@loopback/core`, `@loopback/metadata`) are satisfied by any LoopBack 4 project. Runtime dependencies (`rxjs`, `debug`) are installed automatically.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
