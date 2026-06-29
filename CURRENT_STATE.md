# Chunsik — Current State

A snapshot of where the repository is **right now**. Updated as part of every
sprint's definition-of-done. It deliberately avoids duplicating `ARCHITECTURE.md`
(rules) or `ROADMAP.md` (direction); for the status of individual concepts see the
`[NOW]/[RESERVE]/[LATER]` labels in `ARCHITECTURE.md`.

- **Phase:** Sprint 1b-1 complete — real `ChunsikCore` task pipeline wired with a
  deterministic placeholder AI provider (no AI call yet).
- **Next:** Sprint 1b-2 (Claude CLI execution) — awaiting go-ahead.

## What exists

- pnpm monorepo; **framework-agnostic core** (domain, ports, application services).
- NestJS composition root wiring ports → providers via injection tokens.
- **Pipeline (Sprint 1b-1):** Discord inbound → `ChunsikCore` → resolve Actor →
  open Session → `IntentClassifier` (minimal) → create Task → `Planner` (minimal)
  → `ContextBuilder` (trivial) → `PromptComposer` (minimal `PromptSpec`) →
  `CapabilityRouter` → AiProvider → Artifact → reply.
- **SQLite (better-sqlite3):** `actors`, `sessions`, `tasks`, `taskRuns`,
  `artifacts`, `memories` repositories implemented.
- **AI:** `PlaceholderAiProvider` (deterministic, no AI call). Real CLI providers
  remain stubbed until 1b-2.
- **Observability:** `Logger` seam + `ConsoleLogger` (`[discord]`/`[chunsik]`).

## What is NOT implemented yet

- **AI execution:** `ClaudeCliProvider`/`Codex`/`Ollama` `execute`/`isAvailable`
  still stubbed (Sprint 1b-2 implements Claude per ADR-0014).
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
