# Help Wanted

This project ships infrastructure for benchmarks but the baselines need
empirical tuning, and the concrete transport adapters live as separate
packages waiting for community contributions. Contributions here have
outsize value: they turn theoretical guarantees into measurable ones
and grow the supported transport matrix.

## Benchmarks

Directory: `bench/`

Current state:

- Scaffolded for the core abstractions
- No comparison baseline; no historical tracking

Needed:

- Serializer round-trips: JSON default versus protobuf, Avro, MsgPack,
  and a hand-rolled binary format. Vary payload size from 100 B to 1 MB
  and record encode / decode ns/op.
- Adapter throughput per second once concrete adapters land. Drive each
  adapter at a fixed publish rate against an in-process broker and
  record end-to-end latency percentiles.
- Comparison against NestJS microservices for the same message-shape
  workload. Use NestJS's built-in transports as the reference, not a
  hand-tuned fork.
- `HandlerRegistry.bindToServers` with realistic handler counts (10,
  100, 1000, 10000 handlers across multiple servers). Measure boot time
  and memory delta.
- A published baseline JSON in `bench/baseline.json` so PRs can detect
  regressions via CI.

## Transport adapters

The core ships abstractions only. Each concrete adapter is a separate
package extending `ServerBase` (consumer) and `ClientProxy` (producer).
The list below names the broker, the recommended native client, and the
expected extension shape. Contributions are welcome on any of them.

### `@ebarahona/loopback-transport-kafka` (Apache Kafka via `kafkajs`)

Extend `ServerBase` with a `listen()` that connects a `kafkajs` consumer,
subscribes to the registered topics, and runs `eachMessage` through
`handleMessage`. Extend `ClientProxy` with a `publish()` that produces
to a request topic and resolves on response-topic correlation. Expose
the native `Kafka` / `Consumer` / `Producer` via `unwrap<T>()`.

### `@ebarahona/loopback-transport-rabbitmq` (RabbitMQ via `amqplib`)

Extend `ServerBase` with a `listen()` that creates a channel, asserts a
work queue per pattern, and consumes with manual ack. Map
`HandlerResult.outcome` to `channel.ack` / `channel.nack` decisions.
Extend `ClientProxy` with a `publish()` that uses a reply-to queue and
correlation ID. Expose the native `Connection` / `Channel` via
`unwrap<T>()`.

### `@ebarahona/loopback-transport-mqtt` (MQTT via `mqtt`)

Extend `ServerBase` with a `listen()` that connects the `mqtt` client,
subscribes to the registered topic patterns (including wildcard
subscriptions), and handles QoS 0 / 1 / 2 settlement. Extend
`ClientProxy` with a `publish()` for `emit()` and a reply-topic
correlation for `send()`. Expose the native `MqttClient` via
`unwrap<T>()`.

### `@ebarahona/loopback-transport-nats` (NATS via `nats`)

Extend `ServerBase` with a `listen()` that connects the `nats` client
and runs a subscription per pattern; use NATS request-reply for
`@messageHandler` and core subscriptions for `@eventHandler`. Extend
`ClientProxy` with a `publish()` that uses `request()` for `send()` and
`publish()` for `emit()`. Expose the native `NatsConnection` via
`unwrap<T>()`.

### `@ebarahona/loopback-transport-grpc` (gRPC via `@grpc/grpc-js`)

Extend `ServerBase` with a `listen()` that constructs a `grpc.Server`,
maps registered patterns to service methods, and bridges unary / server-
streaming / client-streaming / bidi semantics into `handleMessage` and
`handleEvent`. Extend `ClientProxy` with a `publish()` that builds a
client per service and invokes the appropriate method. Expose the native
`Server` / `ServiceClient` via `unwrap<T>()`.

### `@ebarahona/loopback-transport-redis` (Redis Pub/Sub via `ioredis`)

Extend `ServerBase` with a `listen()` that uses an `ioredis` subscriber
client and pattern-subscribes to the registered channels. Extend
`ClientProxy` with a `publish()` that uses the publisher client; for
request-response, pair `PUBLISH` with a `SUBSCRIBE` on a reply channel.
Expose the native `Redis` instance via `unwrap<T>()`. Note that Redis
Pub/Sub does not persist messages; document the at-most-once delivery
contract explicitly.

## How to contribute

1. Pick one item from the lists above.
2. Open an issue describing your approach so we can align scope.
3. Submit a PR following [CONTRIBUTING.md](./CONTRIBUTING.md).
4. Performance PRs must include: methodology, raw numbers, hardware
   spec (CPU, RAM, Node version, OS), and at least 5 runs to demonstrate
   stability.

## Discovery extensions

- **First OpenTelemetry consumer of `DiscoveryService`**: register a `HandlerDiscoverer` (or a lifecycle observer that injects `DiscoveryService`) that emits a span per discovered handler at boot so operators can audit the registered handler graph in their tracing backend. Should demonstrate the cross-cutting consumer side of the v1.1 extension model without requiring transport-core changes.

- **Reference plugin `loopback-transport-grpc`**: small sibling package contributing a `@grpcRoute(service, method)` decorator + `GrpcRouteDiscoverer` + `GrpcServer extends ServerBase`. Validates the producer side of the extension model end-to-end against a real broker.

- **`HandlerKind` taxonomy proposals**: well-known kinds beyond `'request'` and `'event'` (e.g. `'cron'`, `'subscription'`, `'stream'`). Open a discussion if you want a kind added to the documented set; plugins can use any string today via the open `HandlerKind` type.
