# Chunsik — Current State

A snapshot of where the repository is **right now**. Updated as part of every
sprint's definition-of-done. It deliberately avoids duplicating `ARCHITECTURE.md`
(rules) or `ROADMAP.md` (direction); for the status of individual concepts see the
`[NOW]/[RESERVE]/[LATER]` labels in `ARCHITECTURE.md`.

- **Phase:** Sprint 1a complete — walking skeleton (echo) wired end to end.
- **Next:** Sprint 1b (first cognitive flow) — awaiting go-ahead.

## What exists

- pnpm monorepo; **framework-agnostic core** (domain, ports, application services).
- NestJS composition root wiring ports → providers via injection tokens.
- **Implemented (Sprint 1a):**
  - Domain: `Actor` + `ExternalIdentity` (ADR-0009), `Session` + `SessionStatus`
    (ADR-0001); `MemoryScope.sessionId` and `Task.actorId`/`sessionId` reserved.
  - Core services: `ActorManager` (resolve/create), `SessionManager` (open/reuse/touch).
  - `SqliteStorageProvider` (better-sqlite3): real `actors` + `sessions` repositories.
  - `DiscordPlatformAdapter` (discord.js): receive → normalize, send, typing.
  - Inbound flow (composition root, temporary): resolve Actor → open/touch Session → **echo** reply.

## What is NOT implemented yet

- **Cognition:** `IntentClassifier.classify`, `Planner.plan`, all `AiProvider.execute` /
  `isAvailable` (Claude/Codex/Ollama), `ChunsikCore.handleApprovalDecision`.
- **Storage:** `tasks`, `taskRuns`, `memories`, `artifacts`, `projects`, `approvals`
  repositories remain stubbed (built in their sprint).
- **Platform:** `DiscordPlatformAdapter.requestApproval` (no approval UI in 1a).
- **Lifecycle no-ops:** `LocalQueueProvider` and `LocalVectorProvider` start/init are
  no-ops; their real operations are unimplemented.
- **Not yet introduced** (decisions recorded): `ContextBuilder`, `PromptComposer`,
  domain events / `EventBus`, `ResourceRef`/`ResourceResolver`, `Usage`/cost,
  `PolicyProvider`.

## Validation

- `pnpm typecheck` — passes (exit 0).
- Boundary enforced — Core cannot resolve adapter packages.
- Persistence smoke test (compiled output, no Discord): actor reuse, session reuse,
  thread-scoped session isolation, and durability across reconnects all verified.
- **Not yet validated live:** a real Discord round-trip (requires `DISCORD_BOT_TOKEN`
  and the privileged **Message Content Intent** enabled for the bot).
