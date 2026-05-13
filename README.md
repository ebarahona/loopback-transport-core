# @ebarahona/loopback-transport-core

Unified transport abstraction for LoopBack 4. Enables NestJS-style microservices with message handlers, event patterns, unified execution context, and client proxies.

Install only what you need:

```bash
npm install @ebarahona/loopback-transport-core              # always
npm install @ebarahona/loopback-transport-kafka              # if using Kafka
npm install @ebarahona/loopback-transport-rabbitmq           # if using RabbitMQ
npm install @ebarahona/loopback-transport-grpc               # if using gRPC
```

## What This Provides

- **`@messageHandler(pattern)`** decorator for request/response patterns
- **`@eventHandler(pattern)`** decorator for fire-and-forget events
- **`@payload()`** and **`@transportCtx()`** parameter decorators
- **`ClientProxy`** base class with `send()` (cold Observable) and `emit()` (hot Observable)
- **`ServerBase`** base class with handler registry, message dispatch, and event chaining
- **`ExecutionContext`** unified across HTTP, RPC, and event transports
- **`Serializer`** / **`Deserializer`** interfaces with JSON defaults
- **Packet types** (`ReadPacket`, `WritePacket`, `PacketId`) for request/response correlation

## Usage

### Hybrid App (HTTP + Kafka)

```typescript
import {RestApplication} from '@loopback/rest';
import {TransportComponent, TransportBindings} from '@ebarahona/loopback-transport-core';

const app = new RestApplication();
app.component(TransportComponent);
app.configure(TransportBindings.config('kafka')).to({
  client: {brokers: ['localhost:9092']},
  consumer: {groupId: 'my-service'},
});
```

### Microservice Only (No HTTP)

```typescript
import {Application} from '@loopback/core';
import {TransportComponent, TransportBindings} from '@ebarahona/loopback-transport-core';

const app = new Application();
app.component(TransportComponent);
app.configure(TransportBindings.config('kafka')).to({
  client: {brokers: ['localhost:9092']},
  consumer: {groupId: 'order-worker'},
});
```

### Controller

```typescript
import {messageHandler, eventHandler, payload, transportCtx} from '@ebarahona/loopback-transport-core';

class OrderController {
  @messageHandler('order.get')
  async getOrder(@payload() data: {id: string}): Promise<Order> {
    return this.orderService.findById(data.id);
  }

  @eventHandler('order.placed')
  async handleOrderPlaced(@payload() data: OrderDto): Promise<void> {
    await this.notificationService.send(data);
  }
}
```

### Client (Producer)

```typescript
import {inject} from '@loopback/core';
import {TransportBindings, TransportClient} from '@ebarahona/loopback-transport-core';

class NotificationService {
  constructor(
    @inject(TransportBindings.client('kafka'))
    private kafka: TransportClient,
  ) {}

  async notifyShipped(order: Order): Promise<void> {
    this.kafka.emit('order.shipped', order);
  }

  async getOrderStatus(id: string): Promise<OrderStatus> {
    return lastValueFrom(
      this.kafka.send<OrderStatus>('order.status', {id}),
    );
  }
}
```

### Unified Execution Context

Interceptors work across HTTP and all transports:

```typescript
class LoggingInterceptor {
  intercept(ctx: ExecutionContext, next: () => Promise<unknown>) {
    const type = ctx.getType(); // 'http' | 'rpc' | 'event'

    if (type === 'http') {
      const req = ctx.switchToHttp().getRequest();
    } else if (type === 'event') {
      const pattern = ctx.switchToEvent().getPattern();
    } else if (type === 'rpc') {
      const method = ctx.switchToRpc().getMethod();
    }

    return next();
  }
}
```

## Transport Modules

Each transport module implements `TransportServer` and `TransportClient`:

| Package | Transport | Native Client |
|---|---|---|
| `@ebarahona/loopback-transport-kafka` | Apache Kafka | `kafkajs` |
| `@ebarahona/loopback-transport-rabbitmq` | RabbitMQ | `amqplib` |
| `@ebarahona/loopback-transport-grpc` | gRPC | `@grpc/grpc-js` |
| `@ebarahona/loopback-transport-mqtt` | MQTT | `mqtt` |
| `@ebarahona/loopback-transport-nats` | NATS | `nats` |

## Requirements

- Node.js >= 18
- LoopBack 4 (`@loopback/core` >= 7.0.0)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
