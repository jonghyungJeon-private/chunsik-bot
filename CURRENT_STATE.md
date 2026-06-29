# Chunsik — Current State

A snapshot of where the repository is **right now**. Updated as part of every
sprint's definition-of-done. It deliberately avoids duplicating `ARCHITECTURE.md`
(rules) or `ROADMAP.md` (direction); for the status of individual concepts see the
`[NOW]/[RESERVE]/[LATER]` labels in `ARCHITECTURE.md`.

- **Phase:** Sprint 1e complete — short-term conversation memory: user + assistant
  turns are stored per session and the recent turns are fed into the next prompt, so
  follow-ups ("방금 답변 줄여줘") work. Plus chunk numbering + partial-send notice.
- **Next:** TBD (e.g., memory retention/pruning, project/long-term memory, Codex/Ollama).

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
  sequentially with `(i/N)` numbering; send-failure stop (no duplicates) + one-shot
  partial-failure notice; typing indicator refreshed during long runs; file-attachment
  is a deferred seam.
- **Conversation memory (ADR-0017):** user + assistant turns stored as SHORT_TERM,
  session-scoped; `ContextBuilder` feeds recent N=10 (truncated) turns into the prompt.
  No vector/long-term/summarization.
- **Tests:** Vitest (8 files / 41 tests) — RiskPolicy, PromptComposer, ContextBuilder
  (session recall), CapabilityRouter, ClaudeCliProvider (incl. failure kinds),
  describeAiFailure, maskSecrets, delivery (chunking/numbering/notice), MemoryManager.
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
