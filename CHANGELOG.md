# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/). Commits follow
[Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Added — Sprint 1c (harden CLI provider failure handling)

- Provider-agnostic failure taxonomy `AiFailureKind` (UNAVAILABLE, AUTH_REQUIRED,
  TIMEOUT, EXECUTION_FAILED, EMPTY_OUTPUT) and `AiProviderError(kind, message)`.
- `ClaudeCliProvider.execute` classifies failures (timeout / spawn-failure /
  auth-stderr / non-zero / empty stdout); stderr is secret-masked.
- Core maps the kind → a friendly Discord reply (`describeAiFailure` +
  `ResponseComposer.composeError`); the user is always answered.
- `TaskRun` records FAILED + `error` summary + `durationMs` (minimal usage tracking).
- ADR-0015: accept global `~/.claude` context in v1 (neutral cwd retained, no
  `--bare`); failure taxonomy, masking, and usage minimalism.
- Tests: failure-kind classification, `maskSecrets`, `describeAiFailure`
  (Vitest 6 files / 24 tests). Simulated failure smoke over all five kinds.

### Added — Sprint 1b-2 (Claude CLI execution)

- Real `ClaudeCliProvider.execute` / `isAvailable`: runs `claude -p` with the prompt
  on **stdin**, in a **neutral cwd**, with a **timeout**, capturing stdout/stderr
  (no `--bare`, OAuth CLI auth, no API path) — per ADR-0014.
- `renderPromptSpec` (provider-side `PromptSpec` → CLI text) and an injectable
  `CliRunner` (`defaultCliRunner`) + `maskSecrets` for redacting CLI output.
- Claude's response is stored as a `MARKDOWN_REPORT` artifact and replied to Discord;
  non-zero exit / timeout → `TaskRun` FAILED.
- `AI_PROVIDERS` now `[ClaudeCliProvider]` (placeholder retained but unused).
- Minimal Vitest suite (5 files / 15 tests): RiskPolicy, PromptComposer,
  ContextBuilder, CapabilityRouter, ClaudeCliProvider command construction.
  Test files excluded from the `tsc` build.

### Added — Sprint 1b-1 (core task pipeline)

- Discord inbound is now handled by `ChunsikCore.handleInboundMessage` (replacing
  the temporary echo): resolve Actor → open Session → classify → create Task →
  plan → ContextBuilder → PromptComposer → CapabilityRouter → provider → Artifact
  → reply.
- Minimal deterministic `IntentClassifier` (→ GENERAL_CHAT, requiresWork) and
  `Planner` (single step, risk via RiskPolicy).
- New domain contracts `PromptSpec` and `ContextBundle`; `ContextBuilder` (trivial)
  and `PromptComposer` (minimal, layered) application services (ADR-0014).
- `AiExecutionRequest.promptSpec?` added (additive); provider renders it.
- SQLite persistence implemented for `tasks`, `taskRuns`, `artifacts`, `memories`.
- `PlaceholderAiProvider` (app, Sprint 1b-1 only) returns a deterministic response
  via the router — **no AI call yet**; Sprint 1b-2 swaps in the Claude CLI.
- Component test: one inbound message flows Actor→Session→Task→TaskRun→Artifact→SQLite.

### Added — Sprint 1a (walking skeleton)

- Domain: `Actor` + `ExternalIdentity` (ADR-0009), `Session` + `SessionStatus`
  (ADR-0001). Reserved `MemoryScope.sessionId` and `Task.actorId`/`sessionId`.
- `StorageProvider` extended with `actors` + `sessions` repositories.
- Core services: `ActorManager`, `SessionManager`.
- `SqliteStorageProvider` (better-sqlite3) implementing the `actors`/`sessions`
  repositories; remaining repositories stay stubbed.
- `DiscordPlatformAdapter` (discord.js): inbound normalization, send, typing.
- Composition root wires a temporary echo flow: resolve Actor → open/touch
  Session → echo reply. (Sprint 1b replaces it with `ChunsikCore`.)
- `LocalQueueProvider`/`LocalVectorProvider` lifecycle methods made no-ops so the
  app boots; their real operations remain unimplemented.
- Walking-skeleton observability: a thin `Logger` seam (`@chunsik/core`) with a
  console-backed `ConsoleLogger` in the app; `[discord]`/`[chunsik]` namespaced,
  structured, no secrets/content logged. Replaceable by a future LoggerProvider.

### Added — Sprint 0 (repository operating system)

- Hexagonal **pnpm monorepo** scaffold: framework-agnostic core (domain, 7 ports,
  application services), one package per concrete provider (skeletons), and a
  NestJS composition root wiring ports → providers via injection tokens.
- AI-native documentation: `ARCHITECTURE.md` (constitution), `DECISIONS.md`
  (ADR-0001…0011), `AGENTS.md` (agent operating manual), `CLAUDE.md` (pointer).
- Repository operating model (ADR-0012, ADR-0013): role-based collaboration model,
  `ROADMAP.md`, `CURRENT_STATE.md`, `CHANGELOG.md`,
  `docs/templates/ADR_TEMPLATE.md`, and Conventional Commits as the repo standard.

### Notes

- No business logic implemented — clean architecture boundaries only.
- `pnpm typecheck` passes; Core cannot resolve adapter packages (boundary enforced).
