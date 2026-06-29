# Chunsik — Current State

A snapshot of where the repository is **right now**. Updated as part of every
sprint's definition-of-done. It deliberately avoids duplicating `ARCHITECTURE.md`
(rules) or `ROADMAP.md` (direction); for the status of individual concepts see the
`[NOW]/[RESERVE]/[LATER]` labels in `ARCHITECTURE.md`.

- **Phase:** Sprint 1d complete — Discord response delivery hardened: long answers
  are chunked under the 2000-char limit and sent sequentially, send failures are
  handled gracefully (no duplicates), and the typing indicator stays alive during
  long runs.
- **Next:** TBD (e.g., file-attachment delivery, Codex/Ollama + fallback, RetryPolicy).

## What exists

- pnpm monorepo; **framework-agnostic core** (domain, ports, application services).
- NestJS composition root wiring ports → providers via injection tokens.
- **Pipeline (Sprint 1b-1):** Discord inbound → `ChunsikCore` → resolve Actor →
  open Session → `IntentClassifier` (minimal) → create Task → `Planner` (minimal)
  → `ContextBuilder` (trivial) → `PromptComposer` (minimal `PromptSpec`) →
  `CapabilityRouter` → AiProvider → Artifact → reply.
- **SQLite (better-sqlite3):** `actors`, `sessions`, `tasks`, `taskRuns`,
  `artifacts`, `memories` repositories implemented.
- **AI:** `ClaudeCliProvider` executes via `claude -p` (stdin, neutral cwd, timeout;
  ADR-0014). Codex/Ollama remain stubbed. `PlaceholderAiProvider` retained but unused.
- **Failure handling (ADR-0015):** classified `AiFailureKind`; failures → friendly
  Discord reply + `TaskRun` FAILED with error summary + `durationMs`; stderr masked.
- **Discord delivery (ADR-0016):** long replies chunked under 2000 chars + sent
  sequentially; send-failure stop (no duplicates); typing indicator refreshed during
  long runs; file-attachment is a deferred seam.
- **Tests:** Vitest (7 files / 32 tests) — RiskPolicy, PromptComposer, ContextBuilder,
  CapabilityRouter, ClaudeCliProvider (incl. failure kinds), describeAiFailure,
  maskSecrets, delivery chunking/send-failure.
- **Observability:** `Logger` seam + `ConsoleLogger` (`[discord]`/`[chunsik]`).

## What is NOT implemented yet

- **AI execution:** `CodexCliProvider`/`OllamaCliProvider` `execute`/`isAvailable`
  still stubbed (Claude is implemented). Streaming/long-reply chunking not done.
- **Storage:** `projects`, `approvals` repositories remain stubbed.
- **Platform:** `DiscordPlatformAdapter.requestApproval` (no approval UI yet).
- **Deferred:** Workflow engine, agent runtime, plugins, connectors, AI HTTP API,
  PolicyProvider, `ContextBuilder` ranking/compression, per-provider prompt rendering.

## Validation

- `pnpm typecheck` — passes (exit 0).
- Boundary enforced — Core cannot resolve adapter packages.
- Component test (Nest context + placeholder + real SQLite): one inbound message
  flows Actor→Session→Task→TaskRun(SUCCEEDED)→Artifact→SQLite; actor/session reuse
  verified across messages.
- **Not yet validated live this sprint:** a real Discord round-trip through the new
  pipeline (optional; 1a already proved Discord transport). Requires
  `DISCORD_BOT_TOKEN` + Message Content Intent.
