---
name: new-transport-adapter
description: Scaffold a new transport adapter (Kafka / RabbitMQ / MQTT / NATS / gRPC / Redis Pub-Sub / etc.) end-to-end on top of `ServerBase` and `ClientProxy`. Use when adding a concrete broker integration — generates the server class, client class, status/connection plumbing, status$ events, handler registration glue, and the integration test stub. Marks the new exports `@experimental`.
---

# new-transport-adapter

Scaffold a new transport adapter across the files where it must land: a `ServerBase` subclass, a `ClientProxy` subclass, a barrel re-export, and an integration test. Marks all new exports `@experimental`.

## Ask

Collect four answers from the contributor before writing anything:

1. **Adapter name** — `lowerCamelCase` for the export prefix (e.g. `kafka`, `rabbit`, `mqtt`, `nats`, `grpc`, `redis`).
2. **Display name** — for JSDoc and error messages (e.g. `Kafka`, `RabbitMQ`).
3. **Required runtime client library** — the npm package the adapter wraps (e.g. `kafkajs`, `amqplib`, `mqtt`, `nats`, `@grpc/grpc-js`, `ioredis`). It must be a `peerDependency`, not a runtime `dependency`.
4. **Connection model** — long-lived single-client (Kafka, NATS, MQTT, AMQP) or per-request (gRPC unary, HTTP). Drives whether the client needs a state machine or just creates streams on demand.

If any answer is missing, ask. Don't guess.

## Read

- `src/server/server-base.ts` — abstract `ServerBase` API the new server extends
- `src/client/client-proxy.ts` — abstract `ClientProxy` API the new client extends
- `src/interfaces/transport-server.interface.ts` and `src/interfaces/transport-client.interface.ts` — public-shape contracts
- `src/registry/handler-registry.ts` — how the adapter receives handlers
- `src/keys.ts` — binding patterns
- LoopBack's [`loopback-core` skill](https://github.com/loopbackio/loopback-next/tree/master/skills/loopback-core), specifically `references/extension-points.md` and `references/lifecycle-and-events.md` if relevant, before adding lifecycle hooks
- The existing integration test under `src/__tests__/integration/` for shape reference

## Edit

### 1. `src/adapters/<adapter-name>/server.ts` (new)

Define `<AdapterName>Server extends ServerBase`. Must implement (per `ServerBase` abstract API):

- `protected async startListening(): Promise<void>` — opens the broker connection, subscribes to topics from `this.handlers`, emits `'connected'` on `status$`. Wrap broker errors in `TransportError` per the [STYLE_GUIDE](../STYLE_GUIDE.md) §13.
- `protected async stopListening(): Promise<void>` — unsubscribes, closes the broker connection, emits `'disconnected'` on `status$`. Wrap cleanup in its own try/catch per STYLE_GUIDE §13.
- `unwrap<T>(): T` — returns the native broker client. Document the unwrap contract in JSDoc: returns `undefined` only before connection.
- `addHandler(handler: MessageHandler)` may need a broker-specific subscribe; if so, override and call `super.addHandler` first.

Mark the class `@experimental`. Add JSDoc `@throws TransportError` to every Promise-returning public method.

### 2. `src/adapters/<adapter-name>/client.ts` (new)

Define `<AdapterName>Client extends ClientProxy`. Must implement:

- `protected async connect(): Promise<void>` — opens broker connection, registers reply handler if request-response is supported.
- `protected async dispatchEvent(packet)` — fire-and-forget publish.
- `protected publish(packet, callback)` — request-response publish (use a correlation map keyed by `packet.id`).
- `unwrap<T>(): T` — returns the native broker client.

Mark `@experimental`. Document any limitations (e.g. "Kafka has no request-response primitive; this adapter uses a reply topic with `partitionKey === correlationId`").

### 3. `src/adapters/<adapter-name>/index.ts` (new)

Barrel re-export the two classes plus any adapter-specific options interface.

### 4. `src/adapters/index.ts` (new or amend)

Aggregate barrel. Used by package consumers via `@ebarahona/loopback-transport-core/adapters/<adapter-name>`.

### 5. `package.json`

- Add the runtime client library to `peerDependencies` with a bounded range (`>=X.0.0 <Y.0.0`).
- Add it as a `devDependency` so the integration test can install it.
- DO NOT add it to `dependencies`. Multiple-copy hazard.
- Add an entry to the `exports` map for `./adapters/<adapter-name>`.

### 6. `src/__tests__/integration/<adapter-name>.spec.ts` (new)

Boot a real or in-memory broker (use the library's testing helpers; if none, dispatch a small docker-compose'd broker via `mongodb-memory-server`-style test fixture). Register a handler, send a message via the matching client, assert the handler ran with the right payload + context. Tear down both client and server. Use `vitest`'s `describe`/`it`/`beforeAll`/`afterAll`.

If the adapter targets a broker that can't be sanely run in unit tests (e.g. a managed cloud service), put the test under `src/__tests__/integration/<adapter-name>.live.spec.ts` and add a guard at the top: `describe.skipIf(!process.env.LIVE_BROKER_URL)`.

### 7. README + AGENTS.md updates

Append the new adapter to the "Available adapters" table (or section) in `README.md`. Note it's `@experimental` until validated by a real consumer.

## Verify

```bash
npm run lint
npm run build
npm run test:integration -- adapters/<adapter-name>
```

The lint must exit 0; the build must compile; the new integration test must pass (or skip cleanly if the broker isn't available locally).

## Report

Output:

- Files created / modified, one line each.
- Next steps for the contributor: fill in the broker-specific connection logic, add `@throws` documentation, run the full test suite locally, and run `/pre-pr-check`.
- A reminder that the adapter is marked `@experimental` and stays that way until at least one real production consumer signs off in an issue.
