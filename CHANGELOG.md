# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/). Commits follow
[Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Added — Sprint 2j · Execution Orchestrator (Application Layer — capability composition)

- **Phase 2 begins: the first Application-layer composition** (ADR-0031). Phase 1 (Capability Layer,
  CAP-001…009) is closed. **Not a new capability** — it composes the completed capabilities into one
  safe execution flow: `Intent Resolver → Execution Orchestrator → Capability Managers`. No
  Core-contract change, **no new aggregate/repository/migration**.
- **`ExecutionOrchestrator`** (`run`/`resume`) — composes Planning → AI Code Generation → Workspace
  diff → Approval → Patch → Workspace Write → Command Execution by **threading Refs**; calls each
  manager's public method only. **Capability managers stay mutually unaware**; only the orchestrator
  composes them. Provider selection stays with `ProviderSelector`.
- **Capability Selection** (`selectStages`) — the orchestrator's first responsibility: maps a
  request's `requiredCapabilities` to an **ordered subset** of stages (dynamic, not a fixed
  pipeline). Analyze-only → `[PLANNING]`; run-tests → `[PLANNING, APPROVAL, COMMAND_EXECUTION]`;
  code-change → the full chain.
- **Stateless / owns no aggregate** — `ExecutionPlan` is the correlation root (every downstream
  aggregate carries `executionPlanRef`); the orchestrator persists nothing and returns a transient
  `ExecutionOutcome` read-model (`COMPLETED | AWAITING_APPROVAL | DENIED | STOPPED_ON_FAILURE |
  CANCELLED`).
- **`ExecutionContext`** — a transient, per-invocation Application-layer context (not an aggregate,
  never persisted): `executionPlanRef`, `workspaceRef`, `projectId`, `requestedBy`, `selectedStages`,
  `logger`, `cancelToken?`.
- **Approval halt + resume** — halts at PENDING (`AWAITING_APPROVAL`); **never calls `decide`**.
  `resume(request, prior, cancelToken?)` re-reads the approval and, if APPROVED, reconstructs the
  proposal/diff from refs and continues; PENDING ⇒ re-halt; REJECTED ⇒ `DENIED`. Resume wiring is
  deferred.
- **Cancellation Contract** — cooperative `cancelToken` checked at each stage boundary (and during
  the approval wait): on signal, stop without calling the next capability → `CANCELLED`. **No
  compensation/rollback**; `CANCELLED` is Application-state only (no capability aggregate touched).
- **Failure rule** — a failed/thrown stage ⇒ `STOPPED_ON_FAILURE`; the next capability is not
  called. **No retry** (future Agent Runtime).
- **`IntentResolver`** — maps an execution-capability `Intent` to an `ExecutionRequest`, else `null`
  (chat/analysis stay on the existing fast path). Kept distinct from `IntentClassifier`.
- **Not implemented (CA-confirmed):** Workflow Engine · Conversation Runtime · Agent Runtime · Retry
  · Event Bus · Parallel Execution · Telemetry · Memory · Discord Integration. Not yet wired into
  `ChunsikCore`/composition root (standalone services; wiring is the future Conversation Runtime).
- Tests (+23): Capability Selection per intent; happy code-change/run-tests/analyze-only chains;
  HIGH-risk halt (Patch not called); resume APPROVED/REJECTED/PENDING; failure + thrown-error stops;
  cancellation between stages + during the approval wait; IntentResolver mapping — all with **fake
  managers**. Vitest 36 files / **233 tests**. Plan: `docs/plans/sprint-2j-execution-orchestrator-plan.md`.

### Added — Sprint 2i · CAP-009 Ollama AI Code Generation Provider (second adapter; suggest-only)

- **A second `AiProvider` for AI Code Generation (CAP-008) — not a new capability** (ADR-0030).
  Proof the AI Layer contract is provider-agnostic: Ollama authors a `CodeProposal` with **no Core
  change** — no new aggregate, manager, port, repository, or migration. The AI still only *proposes*.
- **`OllamaCliProvider.execute(AiRequest)` + `isAvailable()`** implemented behind the existing
  `AiProvider` port. **Suggest-only is honest for Ollama:** `ollama run <model>` is single-shot text
  generation (no tools/exec/file access/agent loop), so it satisfies the propose-only boundary by
  construction — unlike Codex (no deterministic suggest-only mode → stays NotImplemented/unavailable).
- **Invocation:** `ollama run <model>`, prompt on **stdin** (never argv), in a **neutral cwd**
  (`tmpdir()` — a local model never needs the repo and must not ingest it). Output masked.
- **Failure taxonomy (ADR-0015):** `TIMEOUT` / `UNAVAILABLE` (spawn failure) / `EXECUTION_FAILED`
  (non-zero) / `EMPTY_OUTPUT`. No `AUTH_REQUIRED` (Ollama is local/auth-free).
- **Selection:** advertises `CODE_IMPLEMENTATION` at **priority 40** (below Claude's 50) — Claude is
  preferred for code when available; Ollama is the local/offline fallback. Data-driven via
  `ProviderSelector`; Core never names `'ollama-cli'`.
- **Wiring:** `OllamaCliProvider` added to `AI_PROVIDERS` from the existing `OLLAMA_CLI_BIN`/
  `OLLAMA_MODEL` config. **`isAvailable()`-gated** — an environment without `ollama` is unaffected.
- **Runtime note (intentional):** Ollama's pre-existing `GENERAL_CHAT`/`SUMMARIZATION` priority (100
  > Claude 50) means that **where `ollama` is available, the live chat path now prefers Ollama**
  (local-first; Claude fallback). Pre-existing priorities left unchanged.
- **Unchanged:** `parseCodeProposal`, `CodeGenerationManager`, aggregates, `PromptRenderer`,
  `ProviderSelector`, migrations, and Codex (still NotImplemented).
- Tests (+10): `OllamaCliProvider` success → `MARKDOWN_REPORT`, `ollama run <model>` argv + stdin
  prompt + neutral cwd (workspace ignored) + no agent/exec flag, full failure taxonomy,
  `isAvailable` true/false, `CODE_IMPLEMENTATION` priority = 40 < Claude; Claude/chat regression
  green — Vitest 34 files / **210 tests**. Doc: `docs/capabilities/code-generation.md` (ADR-0030).

### Added — Sprint 2h · CAP-008 AI Code Generation Capability (Codex; propose, never apply)

- **First AI Layer capability.** Asks a code-capable `AiProvider` (Codex first) to author a code
  **proposal** for an `ExecutionPlan`. **The AI proposes; it does not decide, approve, apply, or
  execute** — never a source of truth.
- **Two owned aggregates (AI owns both):** `CodeGeneration` (run; `PENDING|GENERATING|SUCCEEDED|
  FAILED`, holds a `CodeProposalRef`) and `CodeProposal` (output; `ProposedChange[]` + providerId
  + usage? + artifacts?). AI never owns any downstream aggregate (AI-Layer Ownership Rule, ADR-0029).
- **`CodeGenerationManager.generate`** — `PromptComposer` → `PromptSpec` → **`PromptRenderer`** →
  **`AiRequest`** → (**`ProviderSelector`**) → `AiProvider.execute` → `parseCodeProposal` → persist.
  Exactly ONE generation per call (no retry). Failures classified (ADR-0015) and recorded as FAILED.
- **`AiProvider` port narrowed to `AiRequest`** (no `PromptSpec`): rendering moved from the CLI
  adapter (`renderPromptSpec`, deleted) to the core `PromptRenderer`; `ClaudeCliProvider` + the
  chat path updated. **`ProviderSelector`** extracts selection from `CapabilityRouter` (now its impl;
  `route`→`select`).
- **`CodexCliProvider.execute()` deferred — NotImplemented** (implementation-review MB-1): the
  Codex CLI has no deterministic suggest-only / no-tool / no-exec mode (`codex exec --sandbox
  read-only` is read-only *agent* execution, not proposal-only), so shipping it would cross the
  CAP-008 boundary. It is treated as unavailable (never selected); real Codex execution awaits a
  verified suggest-only contract (future PR). The capability runs on any suggest-only `AiProvider`.
- **No Workspace bypass** (implementation-review MB-2): the AI Code Generation `AiRequest` carries
  **no workspace cwd** — context flows only via `contextFiles`/`prompt`, so a provider cannot
  read/traverse the repo itself and bypass CAP-001 Workspace Read. `workspaceRef` is recorded on
  the aggregate (read-only reference) but never handed to the provider. Core stays
  HTTP/`child_process`-free.
- **Provider-agnostic proposal parsing** (`parseCodeProposal`): one fenced ```json envelope →
  `ProposedChange[]`; malformed → FAILED. Identical for Codex and Ollama (CAP-009 parity).
- **Persistence:** `CodeGenerationRepository`/`CodeProposalRepository` + Sqlite + **migration v6**
  (`code_generations`, `code_proposals`).
- **Not implemented (CA Non-blocking):** `generationHash`, `providerVersion`/`modelVersion`,
  Proposal Lifecycle, Prompt Version, Provider Cost, Token Usage, Provider Capability, Failure-
  Taxonomy extension; tool-calling, conversation state, generation retry, streaming.
- Tests (+21): `parseCodeProposal`, `PromptRenderer`, `CodeGenerationManager` (success/parse-fail/
  provider-error/identity-of-AiRequest/no-workspace-bypass/history), `CodexCliProvider`
  (execute+isAvailable → NotImplemented / unavailable), Sqlite code-gen/proposal round-trip,
  migration v6 — Vitest 34 files / 200 tests. Capability doc `docs/capabilities/code-generation.md`.

### Added — Sprint 2g · CAP-007 Command Execution Capability (run, gated)

- **`CommandExecution`** aggregate (Command-Execution-owned) — the **Execution History** of
  running one command: `{ executionPlanRef, approvalRef?, workspaceRef, workspaceChangeRef?,
  command, args, commandHash, status, exitCode?, stdout, stderr, durationMs, riskLevel }`.
  `CommandExecutionStatus = PENDING|RUNNING|SUCCEEDED|FAILED|TIMED_OUT`. The last aggregate of
  the Execution Ledger (`… → WorkspaceChange → CommandExecution`).
- **Command identity (CAP-007 review, MB-1):** `commandHash` = deterministic content hash of
  `command` + `args` (pure `contentHash`, no `node:crypto`) — basis for audit / duplicate
  detection / resume / a future retry.
- **`CommandExecutionManager.run`** — three deterministic gates BEFORE the runner: **(1)
  allow-list** (`pnpm`/`npm`/`node` only, exact match, fails closed — MB-3); **(2) risk**
  (`RiskPolicy.assessCommand`; CRITICAL/destructive → refused regardless of approval — MB-2);
  **(3) approval (Ref only)** (HIGH → APPROVED + plan-scope match; LOW/MEDIUM → none — MB-2).
  Then runs and records (SUCCEEDED/FAILED/TIMED_OUT).
- **`CommandRunner`** port + **`LocalCommandRunner`** adapter (new `@chunsik/command-local`;
  `node:child_process` argv-array `spawnSync`, **`shell:false`, required timeout, cwd =
  workspace root, minimal env by default, masked + size-capped output**). **Core stays
  `child_process`-free.**
- **Execution-security (CAP-007 implementation review):** (a) **minimal child env** — the
  runner never passes the full parent `process.env` to a child by default (only PATH/HOME;
  explicit env overrides); (b) **dangerous-arg-aware allow-list** — eval-style `node` flags
  (`-e`/`--eval`/`-p`/`--print`, incl. `=value`/short clusters) are refused so a command-name
  allow-list cannot be bypassed into arbitrary code execution.
- **`runCommand` relocated** off `WorkspaceProvider` → the `CommandRunner` port (mirrors the
  CAP-002 `gitStatus` move). Workspace ≠ Command Execution.
- **Persistence:** `CommandExecutionRepository` (`findByExecutionPlan`/`findByWorkspaceChange`)
  + `SqliteCommandExecutionRepository` + **SQLite migration v5** (`command_executions`) via the
  ADR-0020 runner. References plan/approval/workspace/change — mutates none (Aggregate Ownership).
- **Not in scope (CA-confirmed):** retry (Execution Orchestrator), streaming output,
  background/long-lived processes, ExitCode-as-VO, AI command generation, orchestrator/Discord
  wiring (ADR-0028).
- Tests (+33): CommandExecutionManager (allow-list, dangerous-arg/eval-flag refusal, CRITICAL
  refusal, HIGH-approval + plan-scope, MEDIUM no-approval, status mapping, identity, no-mutation),
  LocalCommandRunner (argv-array, minimal-env/no-parent-env-leak, masking/cap incl. ReDoS-safe,
  real node exec, timeout), SqliteCommandExecutionRepository, migration v5 — Vitest 30 files /
  179 tests. Capability doc `docs/capabilities/command-execution.md`.

### Added — Sprint 2f · CAP-006 Workspace Write Capability (apply, never generate)

- **`WorkspaceChange`** aggregate (Workspace-Write-owned) — the **Execution History** of
  applying a `PatchSet`: `{ patchRef, patchHash, executionPlanRef, approvalRef, workspaceRef,
  status, results: FileChangeResult[] }`. `WorkspaceChangeStatus = PENDING|APPLYING|APPLIED|
  PARTIALLY_APPLIED|FAILED`; `FileChangeResult = { path, operation, status, message, durationMs }`.
- **Patch revision contract (CAP-006 review):** `WorkspaceChange.patchHash` persists the
  applied PatchSet's content revision; the same revision re-run is idempotent, a different
  revision for the same PatchSet id is refused (no cross-revision reuse).
- **`WorkspaceWriteManager.apply`** — approval gate (Ref only: APPROVED + plan-scope match;
  no `ApprovalManager` query), **status-based idempotency** (one change per PatchSet; APPLIED
  → no-op), **best-effort** apply (every op attempted, all results recorded), final status derived.
- **`WorkspaceWriter`** port + **`LocalWorkspaceWriter`** adapter (`node:fs` + jsdiff
  `applyPatch`; **atomic unit = file** via temp-write+rename / unlink; sandboxed; binary →
  skipped; conflict → failed). **No git, no child_process, no commit** (Repository-Independent).
- **Persistence:** `WorkspaceChangeRepository` + `SqliteWorkspaceChangeRepository` + **SQLite
  migration v4** (`workspace_changes`) via the ADR-0020 runner. References the immutable
  `PatchSet`/`ExecutionPlan`/`ApprovalRequest` — mutates none of them (Aggregate Ownership).
- **Not in scope (CA-confirmed):** Rollback (future capability), Resume (records only), git
  recovery, command execution, AI integration, orchestrator/Discord wiring (ADR-0027).
- Tests (+15): WorkspaceWriteManager (approval+plan-scope, idempotency, best-effort
  partial/all-fail, no-PatchSet-mutation), LocalWorkspaceWriter (add/update/delete/conflict/
  binary/sandbox over real fs+jsdiff), SqliteWorkspaceChangeRepository, migration v4 — Vitest
  27 files / 144 tests. Capability doc `docs/capabilities/workspace-write.md`.

### Added — Sprint 2e · CAP-005 Patch Capability (generate, never apply)

- **`PatchSet`** aggregate (Patch-owned, **immutable**) of `PatchOperation`s
  (`{ path, operation: add/update/delete, diff, metadata? }`), with `PatchRef` and
  `PatchStatus` (**`GENERATED` only**). References `ExecutionPlanRef` + `ApprovalRef`; never
  mutates them (Aggregate Ownership Rule).
- **`PatchManager.generate`** — deterministic; **requires an APPROVED `ApprovalRef` scoped to
  the same ExecutionPlan** (`ApprovalRef` is now plan-scoped: `{ id, status, executionPlanRef }`;
  referential integrity — an approval from a different plan is rejected) — no `ApprovalManager`
  query; merges `changes: ProposedChange[]` with their `diff: WorkspaceDiff` (supplied
  independently) into operations; persists a `GENERATED` `PatchSet`.
- **Patch generates, never applies** (Workspace Write, CAP-006, applies) — a permanent
  architectural separation (ADR-0026). No file/git writes; no I/O beyond persistence.
- **Persistence:** `PatchRepository` port (`findByExecutionPlan`) + `SqlitePatchRepository`
  + **SQLite migration v3** (`patches` table) via the ADR-0020 runner.
- **Not in scope:** patch application, file writes, git apply/commit, workspace mutation,
  execution, rollback, AI integration, command execution, orchestrator/Discord wiring.
- Tests (+9): PatchManager (generation, modify→update mapping, APPROVED-ref enforcement,
  diff-mismatch, binary metadata, persistence, no-Ref-mutation), SqlitePatchRepository,
  migration v3 — Vitest 24 files / 127 tests. Capability doc `docs/capabilities/patch.md`.

### Added — Sprint 2d · CAP-004 Approval Capability (first persisted aggregate)

- **`ApprovalRequest`** aggregate (Approval-owned), ExecutionPlan-based: references
  `executionPlanRef`, with `ApprovalStatus` (PENDING/APPROVED/REJECTED), `ApprovalRef`,
  and `ApprovalDecision`. **Approval never mutates `ExecutionPlan`** (Aggregate Ownership
  Rule, ADR-0025); approval state lives only on `ApprovalRequest`.
- **`ApprovalPolicy`** (deterministic; reuses `RiskPolicy`) + **`ApprovalManager`**
  (`requestFor`/`decide`/`get`/`isApproved`; auto-approves when no approval is required).
- **Persistence (first V2 aggregate):** `ApprovalRepository` port (`findByExecutionPlan`) +
  `SqliteApprovalRepository`, created by **SQLite migration v2** (`approvals` table) via the
  ADR-0020 runner. The generic `approvals` stub repository is removed.
- **Aggregate Ownership Rule** recorded in ADR-0025: each capability owns exactly one
  aggregate; only the owner mutates it; others reference/read/consume.
- **Not in scope:** ExecutionPlan mutation, Discord approval UI, orchestrator wiring,
  role-based authorization, expiry enforcement, Patch/Workspace Write (ADR-0025).
- Tests (+11): ApprovalPolicy, ApprovalManager (incl. a no-ExecutionPlan-mutation test),
  SqliteApprovalRepository round-trip, migration v2 — Vitest 22 files / 118 tests.
  Capability doc `docs/capabilities/approval.md`.

### Added — Sprint 2c · CAP-003 Planning Capability (deterministic ExecutionPlan)

- New cross-capability execution contract **`ExecutionPlan`** (+ `ExecutionStep`,
  `EstimatedChanges`, `ExecutionPlanRef`, `PlanningRequest`, `ExecutionStatus`) — the
  blueprint consumed by Approval → Patch → Workspace Write. See `docs/execution-plan.md`.
- **`ExecutionPlanner`** port (`EXECUTION_PLANNER`) with the v2 strategy
  **`DeterministicPlanner`** (pure, deterministic, **AI-free**; reuses `RiskPolicy` for
  `overallRisk`/`approvalRequired`). Thin **`PlanningManager`** delegates to the port and
  imports no other capability manager (context arrives via `PlanningRequest`).
- **Decisions (ADR-0024):** deterministic only (AI may assist later, never the source of
  truth); distinct from the v1 `Plan`; **no persistence** (in-memory; begins at Approval);
  **no orchestrator wiring**; Planning precedes Approval in the roadmap.
- Tests (+11): DeterministicPlanner (determinism, risk/approval, steps, artifacts, scope,
  empty request), PlanningManager (delegation, empty-goal guard, planRef), ExecutionPlan
  domain — Vitest 19 files / 107 tests. Capability doc `docs/capabilities/planning.md`.

### Added — Sprint 2b · CAP-002 Git Capability (read-only)

- New **`GitProvider`** port (+ `GIT_PROVIDER` token), **`@chunsik/git-local`** adapter
  (`LocalGitProvider`), and **`GitManager`** core service: read-only `isRepository`,
  `info` (`RepositoryInfo`: branch/HEAD/detached), `status` (`GitStatus`).
- Git runs **adapter-only** via argument-array `spawn` (no shell string, no `shell:true`),
  with a timeout, cwd = repository root, and **sanitized stderr**. **Core stays
  `child_process`-free** and provider-agnostic. Composes with Workspace via `rootPath`.
- **Git ≠ Workspace:** the `gitStatus` stub is removed from `WorkspaceProvider`; `GitStatus`
  moves to `domain/git.ts`; `WorkspaceManager.ensureSafe/status` → `GitManager`.
- **Not in scope:** no commit/checkout/branch/merge/reset/stash/push/pull/fetch/tag, no
  worktree, **no remote-URL exposure** (credential safety), no Approval/Patch (ADR-0023).
- Tests (+15): non-repo, detached HEAD, dirty/clean, untracked/staged, argument-array spawn,
  timeout/spawn-failure, no-remote-URL, porcelain/stderr parsers — Vitest 16 files / 96 tests.

### Added — Sprint 2a · CAP-001 Workspace Capability (read-only)

- Read-only Workspace foundation (ADR-0022): `resolve`/`readFile`/`listFiles`/`diff` on the
  `workspace-local` adapter; `node:fs` only; diff = current file → proposed content
  (pre-approval seam). `WorkspacePolicy`, `WorkspaceDiff.estimatedChangedLines`. Core
  dependency-free (jsdiff is adapter-only). Capability docs under `docs/capabilities/`.

### Added — Sprint 1g (gated project analysis)

- New `PROJECT_ANALYSIS` intent + capability: a structure/analysis question
  ("이 프로젝트가 어떤 구조인지 설명해줘") classifies deterministically (analysis verb ×
  project/structure noun, either order; KO + EN) and runs as a LOW-risk Task.
- `ProjectAnalyzer.prepare(session)` guards an active, resolvable project (else a
  friendly "register first"), then performs a **read-only, size-limited** readout via
  `WorkspaceProvider.readProjectFiles`: an **allow-list of project metadata files**
  (package.json, pnpm-workspace.yaml, README.md, ARCHITECTURE.md, DECISIONS.md,
  tsconfig*.json), 8 KB/file cap (`truncated` flagged), a 2-level tree
  (root + apps/ + packages/), excluding node_modules/dist/build/.git/coverage.
- **Secrets are never read** (`.env*` and secret/token/key/credential/password names
  are skipped unconditionally); no shell/git commands run during analysis.
- `PromptComposer.compose(task, bundle, readout?)` renders the readout as a read-only
  section and instructs the model to summarize only from the shown files/tree.
  The analysis result is persisted as a `TOOL` memory (`kind: 'analysis'`) for reuse.
- Re-registering the same local path is now idempotent (one `Project` per normalized
  rootPath; the session is rebound).
- **Not in scope (ADR-0019 non-goals):** repository indexing, vector search, semantic
  code search — repository-wide indexing remains deferred.
- Tests: ProjectAnalyzer guard, intent classification (KO/EN, both orders),
  readProjectFiles (allow-list / secret-skip / 8 KB cap / 2-level tree) — Vitest
  12 files / 62 tests. Live smoke: a structure question answered from real
  ARCHITECTURE.md/DECISIONS.md/package.json (7 ports, package→port map, tech stack).
  ADR-0019 (Gated Project Analysis).

### Added — Sprint 1f (local project registration)

- Natural-language project registration: "이 프로젝트 등록해줘: /path" →
  `REGISTER_PROJECT` intent → `ProjectManager` (deterministic command). Read-only
  scan via `WorkspaceProvider.scanProject` (name, git branch / 'unknown', package
  manager, top-level file tree excluding node_modules/dist/build/.git/coverage).
- Persists a `Project` (SQLite `projects`) + a PROJECT memory summary scoped by
  `projectId`; binds `session.activeProjectId`. Non-existent path → friendly failure.
- `ContextBuilder` includes the active project's PROJECT memory; `PromptComposer`
  renders it and instructs the model to answer from the provided context (no file/tool
  access). Workspace prep gated to filesystem capabilities (chat doesn't resolve a workspace).
- ADR-0017 addendum: SHORT_TERM memory capped at 30/session (oldest pruned); the
  current inbound message is excluded from recent context. ADR-0018 (registration policy).
- Tests: project registration, scanProject (invalid/non-git/exclusion), memory pruning,
  context exclusion/project (Vitest 10 files / 51 tests). Live smoke: register + a
  follow-up that explained the structure from the injected project memory.

### Added — Sprint 1e (short-term conversation memory)

- Inbound user messages and assistant responses are stored as SHORT_TERM memory,
  scoped by `sessionId` (role in metadata; no provider id stored).
- `ContextBuilder` includes the recent N=10 same-session turns (simply truncated at
  400 chars); `PromptComposer` renders them into the conversation/context layer, so a
  follow-up can reference the previous turn.
- SQLite `memories.session_id` column (+ defensive migration); session-scoped retrieval.
- Chunk numbering `(i/N)` for multi-message replies; partial-send-failure notice
  ("답변 일부를 전송하지 못했어요.") via `deliverWithNotice` (one attempt, no resend).
- ADR-0017 (conversation memory policy). Tests: memory persistence + session recall +
  delivery numbering/notice (Vitest 8 files / 41 tests). Live smoke: a 2-turn chat where
  the follow-up shortened the prior answer.

### Added — Sprint 1d (harden Discord response delivery)

- Long responses are chunked under Discord's 2000-char limit (`DISCORD_SAFE_LIMIT`
  = 1900; newline/space boundaries, hard-cut for over-long tokens) and sent
  sequentially in order.
- Send-failure handling: stop on first chunk failure (partial delivery reported +
  masked log), no resend (no duplicates); rate-limit backoff delegated to discord.js.
- Typing indicator refreshes every ~8s during long runs (cleared on reply / safety
  cap), fixing the gap where "is typing…" expired after ~10s on ~50–70s runs.
- `ResponseComposer` trims output + non-empty fallback. File-attachment for very
  long responses is a documented seam only (deferred). ADR-0016.
- Tests: `delivery.test.ts` (chunking boundaries/hard-cut/ordered send/stop-on-
  failure). Vitest 7 files / 32 tests. Live smoke: 5351-char answer → 3 chunks.

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
