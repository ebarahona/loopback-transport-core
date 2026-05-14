# Benchmarks

A [`tinybench`](https://github.com/tinylibs/tinybench) harness for the
hot-path operations that every transport adapter inherits from
`loopback-transport-core`. Boots a minimal LoopBack `Application` with
`TransportComponent` and a stub `TransportServer` — no real Kafka,
RabbitMQ, NATS, MQTT, or gRPC connection is opened.

## What it measures

| Case                                       | What it exercises                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `JsonSerializer.serialize`                 | Default serializer on a small typed payload (id + type + nested data + timestamp).                |
| `JsonDeserializer.deserialize`             | Default deserializer parsing a `Buffer` of the same payload.                                      |
| `normalizePattern` (5-key object)          | Deep-sorted JSON stringify of an object pattern, including key sort and JSON-validity checks.     |
| `HandlerRegistry.bindToServers` + dispatch | Round-trip: clear server handlers, rebind from the registry, look up the handler, invoke it once. |

The four cases share one `Application`, one `HandlerRegistry`, and one
stub server so the numbers reflect the cost of the core dispatch
surface — not bootstrap, not network I/O, not real broker latency.
Each case runs for ~1 s of warm-up plus ~1 s of measured samples;
tinybench reports mean, median, p75, p99, and samples taken.

## Running

```bash
npm run build   # bench imports from dist/, build first
npm run bench
```

Expect roughly 4 seconds end-to-end (no broker spin-up).

## Reading the output

`tinybench` prints a table of results. The columns to watch are:

- `ops/sec` — higher is better; this is the headline number.
- `Average Time (ns)` — useful for sub-microsecond cases like
  `normalizePattern` and the serializers.
- `Margin` — `±` jitter as a percent of the mean. Treat anything
  over `±5%` as noise-bound; re-run, close other processes, or
  increase `time:` in `bench/index.mjs`.
- `Samples` — too few samples (~20) means the case is slow or the
  measurement window is too short.

## HELP WANTED

This harness is **seeded, not validated**. Contributions welcome:

- **Comparison baseline.** A side-by-side run against vanilla
  [NestJS microservices](https://docs.nestjs.com/microservices/basics)
  using the same payload shape and the same dispatch surface (custom
  transport strategy + JSON serializer). The expectation is that this
  package is at least on par per-message-overhead, with upside from
  being framework-thin and LoopBack-native.
- **More serializer scenarios.** Benchmarks for msgpack, CBOR,
  protobuf, and Avro serializers once their packages land. Each
  serializer should expose the same `serialize` / `deserialize` shape
  and benchmark against `JsonSerializer` for the same payload.
- **Adapter-level throughput.** End-to-end ops/sec through the Kafka
  and RabbitMQ adapters (once they land in their own packages),
  measured against the broker's own client library at the same
  payload shape. The goal is to surface adapter overhead, not broker
  performance.
- **Fan-out under contention.** Multi-handler benchmarks: one event
  pattern, N handlers, measure dispatch throughput as N grows.
- **Historical tracking.** Publish a `bench/baseline.json` and a CI
  job that fails PRs which regress any case by more than a defined
  tolerance (e.g. 10%). We deliberately don't ship one today —
  environment variance would mislead. The right way is for a
  contributor to publish a baseline produced on a stable runner and
  document the methodology.

If you take any of these on, please open an issue first so we can
align on scope. See [HELP_WANTED.md](../HELP_WANTED.md) for the
full open list and contribution rules.
