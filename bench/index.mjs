/**
 * Benchmark harness for @ebarahona/loopback-transport-core.
 *
 * Boots a minimal LoopBack `Application` with `TransportComponent`,
 * registers a stub transport server, and measures the hot-path
 * operations that every transport adapter pays per message:
 *
 *   - JsonSerializer.serialize on a small typed payload
 *   - JsonDeserializer.deserialize on the corresponding buffer
 *   - normalizePattern on an object pattern (5 keys)
 *   - HandlerRegistry.bindToServers round-trip (stub server,
 *     register one handler, dispatch a message through it)
 *
 * No real Kafka/RabbitMQ/NATS/MQTT/gRPC adapter is exercised — those
 * live in separate packages and contribute their own benchmarks. The
 * goal here is to measure the per-message overhead of the core
 * (serializer + pattern normalization + handler dispatch) so adapter
 * authors can see what their own code adds on top.
 *
 * --------------------------------------------------------------
 * HELP WANTED
 * --------------------------------------------------------------
 * Numbers from this harness are MEANINGFUL ONLY RELATIVE TO EACH
 * OTHER on the same machine. We deliberately do NOT publish a
 * baseline JSON -- environment variance (CPU, RAM, OS, Node version,
 * laptop vs. CI runner) makes absolute numbers misleading.
 *
 * What we need from contributors:
 *   - Side-by-side comparison against vanilla NestJS microservices
 *     (same payload shape, same dispatch surface).
 *   - Additional serializer benchmarks: msgpack, CBOR, protobuf, avro.
 *   - Adapter-level throughput benchmarks once the Kafka and RabbitMQ
 *     adapters land in their own packages.
 *   - Multi-handler fan-out under contention (one pattern, many handlers).
 *
 * See HELP_WANTED.md for the full open list.
 * --------------------------------------------------------------
 *
 * Invocation:
 *   npm run build
 *   npm run bench
 */

import {Bench} from 'tinybench';
import {Application, BindingScope} from '@loopback/core';
import {Subject} from 'rxjs';
import {
  TransportComponent,
  TransportBindings,
  HandlerRegistry,
  JsonSerializer,
  JsonDeserializer,
  normalizePattern,
} from '../dist/index.js';

/**
 * Minimal stub TransportServer: implements just enough of the interface
 * for HandlerRegistry.bindToServers() to attach handlers and for us to
 * invoke them directly.
 */
class StubTransportServer {
  constructor() {
    this.handlers = new Map();
    this._statusSubject = new Subject();
    this.status$ = this._statusSubject.asObservable();
  }
  async listen() {}
  async close() {
    this._statusSubject.complete();
  }
  unwrap() {
    return this;
  }
  addHandler(pattern, handler) {
    const existing = this.handlers.get(pattern);
    if (existing) existing.push(handler);
    else this.handlers.set(pattern, [handler]);
  }
  getHandlers() {
    return this.handlers;
  }
  clearHandlers() {
    this.handlers.clear();
  }
}

const PATTERN_STRING = 'bench.dispatch';
const PATTERN_OBJECT = {
  cmd: 'process',
  service: 'orders',
  version: 'v1',
  region: 'us-east',
  shard: 7,
};
const SAMPLE_PAYLOAD = {
  id: 'evt-42',
  type: 'order.placed',
  data: {sku: 'SKU-123', qty: 3, total: 19.99},
  ts: 1715731200000,
};
const SAMPLE_PAYLOAD_JSON = JSON.stringify(SAMPLE_PAYLOAD);
const SAMPLE_PAYLOAD_BUFFER = Buffer.from(SAMPLE_PAYLOAD_JSON, 'utf-8');

async function main() {
  console.log('Booting minimal LoopBack Application + TransportComponent...');

  const app = new Application();
  app.component(TransportComponent);

  const stubServer = new StubTransportServer();
  TransportBindings.registerServer(app, 'stub', stubServer);

  // Register a single handler against a known pattern so the
  // round-trip benchmark has something to dispatch through.
  const registry = await app.get(TransportBindings.HANDLER_REGISTRY);
  // Bypass decorator discovery for the benchmark: inject a handler
  // directly so we measure dispatch cost, not metadata scanning.
  // We do this by reaching into the registry's internal map; the
  // bench is the only consumer that needs this level of access.
  const fakeHandler = async data => data;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registry['handlers'].set(`*::${normalizePattern(PATTERN_STRING)}`, [
    fakeHandler,
  ]);
  registry['discovered'] = true;

  const serializer = new JsonSerializer();
  const deserializer = new JsonDeserializer();

  const bench = new Bench({time: 1000, warmupTime: 1000});

  bench.add('JsonSerializer.serialize (small typed payload)', () => {
    serializer.serialize(SAMPLE_PAYLOAD);
  });

  bench.add('JsonDeserializer.deserialize (Buffer)', () => {
    deserializer.deserialize(SAMPLE_PAYLOAD_BUFFER);
  });

  bench.add('normalizePattern (5-key object)', () => {
    normalizePattern(PATTERN_OBJECT);
  });

  bench.add('HandlerRegistry.bindToServers + dispatch', async () => {
    stubServer.clearHandlers();
    await registry.bindToServers(app);
    const handlers = stubServer.handlers.get(PATTERN_STRING);
    if (handlers && handlers[0]) {
      await handlers[0](SAMPLE_PAYLOAD);
    }
  });

  console.log('Running benchmarks (this takes about 4 seconds)...');
  await bench.run();

  console.log('');
  console.log('--- Benchmark results ---');
  console.table(bench.table());

  await stubServer.close();
}

main().catch(err => {
  console.error('Benchmark harness crashed:', err);
  process.exitCode = 1;
});
