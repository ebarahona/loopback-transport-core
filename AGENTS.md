# AGENTS.md

This file is read by AI coding agents (Claude Code, Codex CLI, Gemini CLI,
Cursor, Cline, Continue, Aider, etc.) per the https://agents.md/
convention. It applies to every agent regardless of which tool the
contributor is using.

## Project at a glance

`@ebarahona/loopback-transport-core` is a unified transport abstraction
for LoopBack 4 covering Kafka, RabbitMQ, gRPC, MQTT, and NATS. It ships
NestJS-style `@messageHandler` and `@eventHandler` decorators, a
transport-agnostic `ExecutionContext`, a `ClientProxy` base for
producers, and a `ServerBase` for consumers. Built on RxJS, TypeScript-
first, driver-agnostic. Runtime: Node `>= 20.19.0`. License: MIT.
Repository: https://github.com/ebarahona/loopback-transport-core.

## Required reading

Read these in full before suggesting any change.

- [./STYLE_GUIDE.md](./STYLE_GUIDE.md): file naming, folder layout,
  binding keys, provider/component/lifecycle patterns, shared-resource
  ownership, stability tags, peer-dependency policy, test layout, JSDoc
  rules, error handling, config validation, type-system rules, commit
  format, release engineering.
- [./CONTRIBUTING.md](./CONTRIBUTING.md): local setup, the
  `lint && build && test` gate, git hook paths (lefthook vs `.githooks`),
  PR expectations, release-please flow, bug-report requirements.
- LoopBack's official [`loopback-core` skill](https://github.com/loopbackio/loopback-next/tree/master/skills/loopback-core) — upstream reference for IoC, dependency injection, extension points, interceptors, lifecycle observers, and components. Defer to this for framework patterns; STYLE_GUIDE.md only documents plugin-author conventions layered on top.
- [./README.md](./README.md): package surface, `TransportComponent`,
  decorators, `ExecutionContext`, `ServerBase` / `ClientProxy` extension
  points, supported peer-dependency ranges.

## Workflow expectations

1. Every commit uses Conventional Commits. Allowed types: `feat`, `fix`,
   `docs`, `chore`, `ci`, `build`, `deps`, `perf`, `refactor`, `revert`,
   `style`, `test`. release-please derives `CHANGELOG.md` and the version
   bump from these. Incorrect types silently break the release.
2. Every commit carries a DCO sign-off (`git commit -s`). PRs without
   `Signed-off-by:` fail CI.
3. `npm run lint && npm run build && npm test` must pass locally before
   you propose a commit. Do not propose a commit you have not verified.
4. Pre-commit hooks (lefthook by default, `.githooks` as the
   zero-dependency fallback) run the same checks. Never skip them with
   `--no-verify`. If a hook reformats files, re-stage the changes and
   propose the commit again. Do not amend silently.
5. Transport boundaries are never mocked. Integration tests use a real
   in-process adapter (or an ephemeral container for adapter-specific
   coverage) and live in `src/__tests__/integration/`. Any new behavior
   that touches `ServerBase` or `ClientProxy` ships with an integration
   test.
6. New public exports default to `@experimental` JSDoc until at least one
   real consumer has exercised the surface; promote to `@public` in a
   separate PR.

## Architecture rules

- Plugin-injection first: a new capability is a `Provider`, lifecycle
  observer, or service bound under a typed `BindingKey`; the transport
  core is not modified.
- Serializer pluggability: format-specific encoding goes behind the
  `Serializer` and `Deserializer` interfaces. The core ships a JSON
  default; adapters and applications swap in protobuf, Avro, MsgPack, or
  custom binary formats without touching `ServerBase` or `ClientProxy`.
- Handler discovery is pluggable. The default `MessageHandlerDiscoverer` and `EventHandlerDiscoverer` (registered by `TransportComponent` under `TransportBindings.tags.HANDLER_DISCOVERER`) scan controllers for `@messageHandler` and `@eventHandler` metadata at boot. Plugins may register additional `HandlerDiscoverer` implementations under the same tag to contribute custom decorator vocabularies (for example `@grpcRoute`, `@changeStream`, `@cronJob`) without modifying transport-core. The boot-time snapshot is exposed read-only via `DiscoveryService` (`TransportBindings.DISCOVERY_SERVICE`) for cross-cutting consumers (metrics, tracing, audit, schema generation).
- Three orthogonal extension axes are tag-based: `TRANSPORT_SERVER_TAG` for transports, `HANDLER_DISCOVERER_TAG` for decorator vocabularies, and `SERIALIZER_TAG` / `DESERIALIZER_TAG` for envelope codecs. Plugins self-register under the appropriate tag and transport-core resolves them at boot without knowing the plugin exists. Cross-cutting concerns (metrics, tracing, audit) continue to flow through LoopBack 4's `@globalInterceptor` mechanism.
  - `resolveSerializer(app)` is a required method on the `TransportServer` interface. The lifecycle observer calls it directly between `bindToServers` and `listen()`. `ServerBase` provides a default implementation that performs tag-based serializer resolution (transport-scoped > generic > implementation default); custom `TransportServer` implementations that do not extend `ServerBase` must provide their own, a no-op is fine for servers that hardcode their codec.
- `ExecutionContext` is transport-agnostic. Adapters construct it via
  the immutable factory methods (`forHttp`, `forRpc`, `forEvent`) and
  pass it to handlers; consumers `switchToHttp` / `switchToRpc` /
  `switchToEvent` to reach transport-specific accessors. The base class
  never assumes a specific transport.
- Every binding flows through `TransportBindings.*` namespace constants
  declared in `src/keys.ts` with `BindingKey.create<T>(...)`; raw string
  binding keys are forbidden.
- I/O start/stop runs inside a `@lifeCycleObserver` class; both
  `start()` and `stop()` are idempotent and safe to call after a failed
  `start()`. `ClientProxy` enforces this through its `idle ->
connecting -> connected -> closing -> idle` state machine.
- Shared resources track ownership through a `readonly owns<Resource>`
  boolean set once in the constructor; `stop()` / `close()` is the only
  call site that consults it.
- TypeScript is strict and `any` is banned; an `as unknown as { ... }`
  cast into framework internals must carry a `// Why:` comment and a
  regression test that fails when the internal field is renamed.

## Claude Code users

Skills live at `.claude/skills/`. Invoke each as a slash command.

- `/lb4-plugin-review`: comprehensive PR review covering architecture,
  public API, tests.
- `/lb4-style-check`: mechanical compliance scan against STYLE_GUIDE.md.
- `/transport-adapter-review`: `ServerBase` / `ClientProxy` extension
  pitfalls for adapter authors.
- `/lb4-public-api-audit`: public API surface diff and stability-tag
  check.
- `/new-transport-feature`: scaffold a new transport capability with
  binding, provider, and integration test.
- `/pre-pr-check`: full readiness gate before opening a PR.
- `/conventional-commit`: author a Conventional Commits message from
  the staged diff.

## Other tool users (Codex, Gemini, Cursor, Cline, Continue, Aider)

The skill files at `.claude/skills/<name>/SKILL.md` are plain Markdown.
Open the one matching your task and follow the instructions inside; the
workflow is identical regardless of how you invoke it.

If your tool has its own per-project config (Cursor's `.cursor/rules/`,
Cline's `.clinerules`, Continue's `.continuerules`, Aider's
`.aider.conf.yml`), point it at this file and [./STYLE_GUIDE.md](./STYLE_GUIDE.md)
so the conventions apply automatically on every turn.

## What NOT to do

- Don't add `any` or `@ts-ignore` to silence a type error. Fix the
  underlying type.
- Don't modify global git config (`--global`); scope any required
  override to this repo with `--local`.
- Don't bypass pre-commit hooks with `--no-verify`.
- Don't hand-write `CHANGELOG.md` entries; release-please owns the file.
- Don't bump `package.json` `version` manually; release-please owns it.
- Don't introduce transport mocks in tests; use a real adapter against a
  real broker (or its in-process equivalent).
- Don't add a default export anywhere in the package.
- Don't add files outside the folder structure documented in
  [./STYLE_GUIDE.md](./STYLE_GUIDE.md) § Folder structure.

## Communicating with the maintainer

- Bug reports:
  https://github.com/ebarahona/loopback-transport-core/issues
  (template: `.github/ISSUE_TEMPLATE/bug_report.yml`).
- Feature requests: same URL
  (template: `.github/ISSUE_TEMPLATE/feature_request.yml`).
- Security issues:
  https://github.com/ebarahona/loopback-transport-core/security/advisories/new.
  See [./SECURITY.md](./SECURITY.md).
- Code of conduct: [./CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
  (Contributor Covenant 2.1).
