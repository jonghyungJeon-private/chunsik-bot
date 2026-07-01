# Chunsik — Current State

A snapshot of where the repository is **right now**. Updated as part of every
sprint's definition-of-done. It deliberately avoids duplicating `ARCHITECTURE.md`
(rules) or `ROADMAP.md` (direction); for the status of individual concepts see the
`[NOW]/[RESERVE]/[LATER]` labels in `ARCHITECTURE.md`.

- **Phase:** **Version 2, Phase 2 (Application Layer), Sprint 2l — Live Test Execution** (ADR-0033):
  the **first reachable execution Product slice**. **Phase 1 (CAP-001…009) closed; Sprint 2j Execution
  Orchestrator + Sprint 2k Conversation Runtime merged.** A user's "테스트 돌려줘" / "typecheck 돌려줘"
  now runs the allow-listed test command in the active project and reports the result naturally:
  `IntentClassifier → IntentResolver → ConversationRuntime → ExecutionOrchestrator → CommandExecution
  → ResponseComposer`. Classifier gains deterministic `RUN_TESTS` (+`raw.kind`, reusing
  `IntentType.RUN_TESTS`/`Capability.TEST_EXECUTION`); resolver owns the **fixed** command mapping
  (only `pnpm test`/`pnpm typecheck` ever produced); runtime resolves the active-project workspace
  via existing `WorkspaceManager.open` and frames the result by reading the `CommandExecution`
  (exit≠0 that **ran** = a test-failure *result*, not a system error). Risk MEDIUM, no approval halt.
  **Reuse only — no new capability/aggregate/repository/migration; no Core/Orchestrator contract
  change.** Implemented on a branch — **awaiting CA implementation review, no merge.**
- **Next:** Chief Architect implementation review of Sprint 2l; no merge until approved.
- **Build/Test (validation runtime: Node 22):** `pnpm typecheck` PASS (exit 0); `pnpm test` 37 files /
  255 tests PASS. (Under the `.nvmrc`-pinned Node 18, SQLite repo tests fail on a better-sqlite3 ABI
  mismatch — a Deferred (Environment) item; the suite is green on Node 22.)

## Implemented

- **Discord** — gateway adapter (`PlatformAdapter`): receive, typing indicator,
  chunked delivery of long replies (ADR-0016).
- **Claude CLI** — `ClaudeCliProvider` via `claude -p` (non-interactive, neutral cwd,
  timeout; ADR-0014), routed by Capability; product-grade failure handling (ADR-0015).
- **Session** — actor + session resolution; tasks/runs anchored to actor/session.
- **Short-term Memory** — SHORT_TERM conversation memory per session (cap 30, oldest
  pruned; current message excluded from recall; ADR-0017).
- **Project Registration** — "이 프로젝트 등록해줘: /path" → read-only scan → `Project`
  + PROJECT memory + bound `session.activeProjectId`; idempotent re-registration (ADR-0018).
- **Project Analysis** — gated, read-only analysis of allow-listed project metadata
  files → grounded structural answer, persisted as TOOL memory (ADR-0019).
- **CAP-001 Workspace (read-only)** — `resolve`/`readFile`/`listFiles`/`diff` on the
  workspace-local adapter; sandboxed `node:fs` (no git/child_process); diff = current
  file → proposed content (pre-approval seam). Not yet wired to a user-facing flow (ADR-0022).
- **CAP-002 Git (read-only)** — `isRepository`/`info`/`status` on the new `git-local`
  adapter via argument-array `spawn` (timeout, cwd=repo root, sanitized stderr); no writes,
  no worktree, no remote-URL exposure. Composes with Workspace via `rootPath` (ADR-0023).
- **CAP-003 Planning** — deterministic `ExecutionPlan` via `ExecutionPlanner` port +
  `DeterministicPlanner` + thin `PlanningManager` (reuses `RiskPolicy`). AI-free, no I/O,
  no persistence, not orchestrator-wired; the cross-capability execution contract (ADR-0024).
- **CAP-004 Approval** — `ApprovalRequest` aggregate + `ApprovalPolicy` + `ApprovalManager`
  + `SqliteApprovalRepository` (migration v2). Deterministic; references `ExecutionPlanRef`,
  never mutates `ExecutionPlan` (Aggregate Ownership Rule); first persisted V2 aggregate.
  Not UI/orchestrator-wired (ADR-0025).
- **CAP-005 Patch** — `PatchSet` aggregate (immutable) + `PatchManager.generate` (requires
  APPROVED approval) + `SqlitePatchRepository` (migration v3). **Generates, never applies**;
  `PatchOperation` carries unified diffs; references `ExecutionPlanRef`/`ApprovalRef` only.
  Workspace Write (CAP-006) will apply (ADR-0026).
- **CAP-006 Workspace Write** — `WorkspaceChange` (Execution History) aggregate +
  `WorkspaceWriteManager.apply` + `WorkspaceWriter`/`LocalWorkspaceWriter` (node:fs + jsdiff)
  + `SqliteWorkspaceChangeRepository` (migration v4). **Applies** an approved PatchSet
  (best-effort, atomic-per-file); approval Ref + plan-scope checked; no git; owns only
  `WorkspaceChange` (ADR-0027). First filesystem-mutating capability.
- **CAP-007 Command Execution** — `CommandExecution` (Execution History) aggregate +
  `CommandExecutionManager.run` + `CommandRunner`/`LocalCommandRunner` (new `command-local`;
  argv-array `spawnSync`, no shell, timeout, **minimal child env**, masked+capped output) +
  `SqliteCommandExecutionRepository` (migration v5). **Runs** a command behind four gates —
  **allow-list** (`pnpm`/`npm`/`node`), **dangerous-arg** (eval-style `node` flags refused),
  **risk** (CRITICAL/destructive refused), **approval** (HIGH → APPROVED + plan-scope; LOW/MEDIUM
  → none); persists `commandHash` identity. `runCommand` relocated off Workspace; core stays
  child_process-free; owns only `CommandExecution` (ADR-0028). Riskiest capability; the last
  Execution-Ledger aggregate.
- **CAP-008 AI Code Generation** — `CodeGeneration` (run) + `CodeProposal` (output) aggregates +
  `CodeGenerationManager.generate` (compose → `PromptRenderer` → `AiRequest` → `ProviderSelector`
  → `AiProvider.execute` → `parseCodeProposal`) + `CodexCliProvider` **suggest-only** + repos +
  migration v6. First AI Layer capability: **AI proposes only** (no decide/approve/apply/execute);
  reuses `AiProvider` (narrowed to `AiRequest`); core HTTP/child_process-free; owns `CodeGeneration`
  + `CodeProposal`, never downstream (ADR-0029). Not orchestrator-wired.
- **CAP-009 Ollama AI Code Generation Provider** — the **second `AiProvider` adapter** for CAP-008
  (not a new capability). `OllamaCliProvider.execute`/`isAvailable` implemented **suggest-only**
  (`ollama run <model>`, prompt on stdin, neutral cwd; single-shot text gen — no tools/exec/file
  access), advertises `CODE_IMPLEMENTATION` at priority 40 (below Claude 50, a local/offline
  fallback for code), wired into `AI_PROVIDERS` (`isAvailable()`-gated). Failure taxonomy reused
  (ADR-0015; no AUTH path). **No Core change**: no new aggregate/manager/port/repository/migration;
  `parseCodeProposal`/aggregates/`PromptRenderer`/`ProviderSelector` unchanged; Codex still
  NotImplemented. Demonstrates CAP-008 provider-independence (ADR-0030).
- **Phase 2 · Execution Orchestrator (Application Layer)** — `ExecutionOrchestrator`
  (`run`/`resume`) + `IntentResolver`: the first composition of CAP-001…009. **Capability
  Selection** → ordered stage subset (Planning → AI Code Gen → Workspace diff → Approval → Patch →
  Workspace Write → Command); **stateless** (no aggregate; `executionPlanRef` correlation root;
  transient `ExecutionOutcome`); **Ref-threaded**; **Approval halt + resume** (never `decide`);
  **Cancellation** (no rollback, Application-state only); **stop-on-failure, no retry**. Managers stay
  mutually unaware; provider selection stays with `ProviderSelector`. No Core change (ADR-0031).
- **Phase 2 · Conversation Runtime (Application Layer)** — `ConversationRuntime.handle(message) →
  TurnResult`: 춘식봇's conversation entry; **composes** the existing services into the full flow
  (chat · project-analysis · register · execution · approval-resume · failure/cancel). `ChunsikCore`
  is a **thin facade** delegating to it (one entry, no parallel paths). **Transient** `TurnResult`/
  `RuntimeTurnStatus` (no aggregate/table); **stateless approval halt→resume** with awaiting state
  derived from existing aggregates (`Session.activeTaskId → Task.planId → approvals.findByExecutionPlan
  → PENDING`); persists nothing; **no `Session` snapshot**. Decision interpreted only when pending
  (approve→decide+resume · deny→DENIED · cancel→CANCELLED · ambiguous→re-ask). Short-term memory only;
  `ResponseComposer.composeExecutionResult` added; orchestrator/intent-resolver now wired into the
  composition root. No Core change (ADR-0032).
- **Phase 2 · Live Test Execution (Product slice)** — the first execution reachable from a real user
  message. "테스트 돌려줘" / "typecheck 돌려줘" → deterministic `RUN_TESTS` intent (+`raw.kind`,
  reusing `IntentType.RUN_TESTS`/`Capability.TEST_EXECUTION`) → resolver's **fixed** command mapping
  (only `pnpm test`/`pnpm typecheck`) → runtime resolves the active-project workspace via existing
  `WorkspaceManager.open` → `ExecutionOrchestrator` → `CommandExecution` → natural result. A command
  that **ran** with exit≠0 is a **test-failure result** (not a system error); couldn't-run
  (timeout/refusal/open-failure) is a system-failure reply. `ResponseComposer` gains
  `composeTestResult`/`composeNeedsProject`/`composeWorkspaceUnavailable`/`composeCommandUnavailable`.
  Risk MEDIUM, no approval halt. Reuse only — no new capability/aggregate/repository/migration, no
  Core/Orchestrator contract change (ADR-0033). *(awaiting CA implementation review)*

## Deferred

- **Codex** — `CodexCliProvider` not implemented (stub; no deterministic suggest-only mode).
- **Workflow** — multi-step planning/execution beyond a single Task is not built.
- **Agent Runtime** — no autonomous tool-using / coding agent.
- **Vector Search** — `VectorProvider` is a local stub; no embeddings/retrieval/semantic search.
- **Jira** — no connector.
- **Slack** — no connector (Discord is the only platform).
- **Confluence** — no connector.

## What exists (detail)

- pnpm monorepo; **framework-agnostic core** (domain, ports, application services).
- NestJS composition root wiring ports → providers via injection tokens.
- **Pipeline:** Discord inbound → `ChunsikCore` → resolve Actor → open Session →
  `IntentClassifier` → (REGISTER_PROJECT | PROJECT_ANALYSIS | CHAT) → Task →
  `Planner` → `ContextBuilder` → `PromptComposer` → `CapabilityRouter` → AiProvider →
  Artifact → reply.
- **SQLite (better-sqlite3):** `actors`, `sessions`, `tasks`, `taskRuns`, `artifacts`,
  `memories`, `projects` repositories implemented. Schema applied by a versioned,
  forward-only migration runner keyed on `PRAGMA user_version` (ADR-0020); WAL mode.
- **Project analysis (ADR-0019):** `ProjectAnalyzer.prepare` guards an active project,
  then `WorkspaceProvider.readProjectFiles` reads an allow-list (package.json,
  pnpm-workspace.yaml, README.md, ARCHITECTURE.md, DECISIONS.md, tsconfig*.json),
  8 KB/file cap, 2-level tree, excludes node_modules/dist/build/.git/coverage, and
  unconditionally skips `.env*`/secret-named files. `PromptComposer` renders it as a
  read-only section; the result is stored as a TOOL memory (`kind: 'analysis'`).
- **Observability:** `Logger` seam + `ConsoleLogger` (`[discord]`/`[chunsik]`).

## What is NOT implemented yet

- **AI execution:** only `CodexCliProvider` `execute`/`isAvailable` remain stubbed (no
  deterministic suggest-only mode → treated as unavailable). Claude + Ollama are implemented.
- **Storage:** all repositories implemented (`approvals` landed in CAP-004 / migration v2).
- **Platform:** `DiscordPlatformAdapter.requestApproval` (no approval UI yet); resume
  after approval is deferred (no current capability reaches the HIGH/CRITICAL path).
- **Deferred:** repository-wide indexing, vector/semantic search, Workflow engine,
  agent runtime, connectors (Jira/Slack/Confluence), AI HTTP API, PolicyProvider,
  `ContextBuilder` ranking/compression, PROJECT/TOOL memory retention.

## Validation

- `pnpm typecheck` — passes (exit 0). `pnpm test` — 37 files / 255 tests pass (validation runtime: Node 22).
- Boundary enforced — Core cannot resolve adapter packages.
- **Live (Sprint 1g):** real `node dist/main.js` Discord round-trip — register a
  project, then a structure question routed to PROJECT_ANALYSIS, read real files,
  returned a grounded answer (7 ports, package→port map, tech stack), persisted as
  TOOL memory; secrets never read. Requires `DISCORD_BOT_TOKEN` + Message Content Intent.
