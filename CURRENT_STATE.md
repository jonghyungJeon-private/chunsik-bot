# Chunsik — Current State

A snapshot of where the repository is **right now**. Updated as part of every
sprint's definition-of-done. It deliberately avoids duplicating `ARCHITECTURE.md`
(rules) or `ROADMAP.md` (direction); for the status of individual concepts see the
`[NOW]/[RESERVE]/[LATER]` labels in `ARCHITECTURE.md`.

- **Phase:** **Version 2, Phase 2 (Application Layer), Sprint 2m — Test Result Detail UX** (ADR-0034,
  CA-directed): existing `CommandExecution` facts (`command`, `args`, `exitCode`, `stdout`, `stderr`,
  `durationMs`) now reach the user, instead of bare pass/fail. **Sprint 2l (Live Test Execution,
  ADR-0033) and Sprint 2j/2k (Execution Orchestrator / Conversation Runtime) merged; Phase 1
  (CAP-001…009) closed.** `ConversationRuntime.frameTestResult` branches three ways
  (`SUCCEEDED`/`FAILED` ran → detail result; `TIMED_OUT` → distinct timeout reply; no
  `CommandExecution` → unchanged `composeCommandUnavailable`) and assembles a new Application-layer
  `TestResultDetail` DTO (not domain, not persisted); `ResponseComposer.composeTestResult` (signature
  changed) and the new `composeTestTimedOut` own all summarization (deterministic tail/char-capped
  excerpt, stdout-preferred with an omitted-stream notice when `stderr` also had output) and Korean
  wording. No second masking pass (adapter boundary, ADR-0028, already redacts/caps). **Reuse only —
  no new capability/aggregate/repository/migration/port; no Core/Orchestrator contract change.**
  Implemented on a branch — **awaiting CA implementation review, no merge.**
- **Next:** Independent Chief Architect review of Stage 2B Slice 3A. Slice 3B Gateway two-attempt orchestration,
  Runtime integration, and actual external Provider invocation remain unapproved.
- **Build/Test (Stage 2B Slice 3A remediation):** focused validation/planning suite 5 files / 46 tests PASS; shared
  Core regression 50 files / 1100 tests PASS; `pnpm typecheck` and `pnpm build` PASS. No external Provider, Runtime,
  network, or database execution was part of this slice.

## Stage 2A — Completed

- **Status:** **Completed** (`STAGE_2A = PASS`). Stage 2A established trustworthy Provider Evaluation
  Infrastructure; Provider routing and operational policy are explicitly deferred to Stage 2B.
- **Deliverables:** Evaluator v4, immutable Golden Corpus, post-push Binding ratification,
  deterministic Replay, pool-decoupled Benchmark Framework, Decision Engine, and Provider Ranking.
- **Evaluator:** `stage2a-semantic-checker-v4` is the production default. Historical Golden Corpus
  replay remains pinned to `stage2a-semantic-checker-v3`.
- **Golden Corpus:** Stable A1+A3 corpus — 224 records / 896 checks; combined digest
  `add786d6ebef4cb0158119783b2329f30a6c030ed37682c95d1071df7801e3b4`.
- **Provider Ranking:** Balanced Primary Candidate — `llama3.1:8b`; Semantic Candidate —
  `granite3.3:8b`; latency-only evidence — `llama3.2:3b`; `mistral:7b` deprioritized.
- **Prompt Root Cause:** **NOT ESTABLISHED**.
- **Stage 2B:** Architecture and Option B typed policy foundation are ratified in ADR-0064. Slice 1
  implements Provider-free deterministic selection. Slice 2 adds an immutable execution plan, executable-binding
  registry, isolated single-attempt gateway, and bounded audit. Runtime integration, actual external Provider
  execution, fallback/escalation orchestration, retry, timeout/deadline calculation, traffic policy, and
  dual-provider activation remain unapproved/unimplemented. Slice 3A adds only immutable validation/failure
  contracts, pure response validation, bounded output projection, and pre-fixed declarative branches.

## Stage 2B — Slice 1 Provider Selection Foundation

- **Boundary:** Core Application policy service, not a Capability, Aggregate, Provider adapter, or Runtime path.
- **Input/output:** `RoutingContext + ProviderRegistrySnapshot + RoutingPolicyConfiguration →
  ProviderSelectionDecision`.
- **Registry:** descriptor-only, validated, immutable, stable provider ordering; transient availability is part
  of a snapshot but excluded from the registry configuration digest.
- **Policy:** bounded TypeScript enums/read-only configuration; predicate match → eligibility/exclusion →
  configured lexicographic ranking → stable provider-id tie-break. No weighted runtime score.
- **Evidence:** Stage 2A raw scores and Golden Corpus remain offline; Runtime profiles use bounded reliability,
  support, capacity, locality, latency, cost, concurrency, and availability classes only.
- **Execution:** zero Provider calls and zero ConversationRuntime/CodeGenerationManager integration in Slice 1.

## Stage 2B — Slice 2 Single-Attempt Provider Gateway

- **Boundary:** Core Application orchestration only; selection remains separate from execution through
  `ProviderSelectionDecision → ProviderExecutionPlan → ProviderRoutingGateway → AiProvider.execute()`.
- **Execution plan:** immutable one-provider order and attempt budget `1`, with bounded capability,
  validation-profile, policy/registry/combined configuration identities, and a deep-frozen executable-binding
  identity. Deadline is `null`; fallback and escalation eligibility are `false`.
- **Binding:** descriptor-snapshot-bound immutable executable registry; unknown/disabled descriptors, duplicate
  bindings, executable-id mismatch, and adapter/model mismatch fail before invocation. Canonical SHA-256 identity
  includes Provider, adapter, model, binding version, and descriptor profile version only.
- **Gateway:** validates the plan/request, registry, current binding digest, and executable identity boundaries,
  resolves only the selected binding, and invokes it exactly once. Provenance mismatch returns a bounded failure
  with attempt count `0`. No availability probe, retry, fallback, escalation, alternate Provider, timeout policy,
  or response validation.
- **Audit:** bounded success/failure facts only; no prompt, response, transcript, raw error, reasoning, credential,
  or environment values. Known Provider failure kinds are preserved; unknown failures are `EXECUTION_FAILED`.
- **Integration:** fake-Provider tests only. Zero ConversationRuntime/CodeGenerationManager/app/adapter/storage/DB
  integration and zero actual external Provider execution.

## Stage 2B — Slice 3A Validation and Branch Planning

- **Validation:** immutable three-profile registry and independent pure synchronous validator; prompt/context are
  input-only, while result contracts contain bounded reason codes, digest, byte count, and contract versions.
- **Failure policy:** versioned configuration/operational/validation/safety matrix. Safety is fail-closed;
  `EMPTY_OUTPUT` alone is an approved output-related fallback candidate. Producer-pending ownership remains
  explicit: Provider spawn belongs to a future adapter producer; containment/model-download detection to Runtime;
  structural-validation failure to a future validation profile/validator; and unresolved semantic/structural
  validation plus deadline exhaustion to future Gateway orchestration. None is an implemented defense in Slice 3A.
- **Plan:** primary plus optional pre-fixed operational fallback and stronger semantic escalation targets, all bound
  to eligible-set and executable-binding provenance. Maximum attempts `2`, maximum additional hops `1`, mutually
  exclusive execution branch, no same-provider retry, and no runtime policy reevaluation.
- **Execution boundary:** declarative only. The Slice 2 Gateway still calls only the primary once; it does not call
  the validator, fallback, or escalation. No state machine, Runtime/app/adapter/port/storage integration, actual
  Provider execution, network, or database work was added.

## Implemented

- **Stage 2B Slice 3A validation/planning contracts (ADR-0064)** — added validation profiles, deterministic Runtime
  response validation, bounded output projection, a versioned failure matrix, deadline class, target-purpose and
  branch contracts, candidate pre-fixation, and execution configuration/decision/plan identities while preserving
  the Gateway's one-invocation Slice 2 behavior.
- **Stage 2B Single-Attempt Provider Gateway (ADR-0064 Slice 2)** — added immutable execution planning,
  descriptor-bound executable bindings, canonical binding identity, selection/binding provenance validation, one
  selected Provider/one attempt gateway orchestration, discriminated outcomes, and bounded execution audit.
  Multi-provider fallback/escalation and all Runtime integration remain deferred.
- **Stage 2B Provider Selection Foundation (ADR-0064)** — added bounded routing signals and branded configuration
  identifiers; immutable, descriptor-only Provider Registry snapshots; static Capability/Operational Profiles;
  fail-fast typed policy validation; eligibility/exclusion; deterministic routing-class/reliability/latency/cost
  ranking; explicit selected/no-eligible/no-policy decisions; and canonical SHA-256 registry/policy/combined
  configuration identities. Concrete adapters/models appear only in future composition configuration, never Core
  policy logic. No AiProvider binding/invocation, fallback, escalation, retry, deadline, response validation,
  Runtime integration, TaskRun audit, storage, or DB change.
- **Stage 2A semantic checker v4 promotion** — the independently ratified Candidate v4 is now the
  default evaluator for new `provider:semantic` and Provider Benchmark invocations under the explicit
  contract `stage2a-semantic-checker-v4`. Historical Golden Corpus replay remains explicitly pinned to
  `stage2a-semantic-checker-v3`; the immutable v4-candidate transition identity is retained only for the
  approved 25/25 transition overlay. Frozen A1+A3 replay remains deterministic with 224 records / 896 check
  instances, Critical Recall 5/5 (100%), and zero confirmed FP/FN. The new default execution path binds the
  evaluator router and v4 implementation source/dist modules. Post-push v4 bindings at the synchronized main
  revision are ratified; prior v3, pre-push v4, and earlier-HEAD execution bindings remain historical.
- **Stage 2A Provider Benchmark framework (Plan v2.1 + pool decoupling)** — the offline planner and evidence
  aggregator consume strict repository-owned or absolute-path Pool Configuration instead of owning a fixed
  model count. The immutable legacy 10-model pool remains the default; a production 18GiB four-model pool is
  available explicitly. Deterministic configuration digests and full campaign fingerprints prevent evidence
  mixing; exact model/scenario coverage controls completion; objective Engine reporting is separated from
  advancement/Champion publication policy. Existing `provider:semantic` remains the sole bound Provider
  execution harness. Prompt, Evaluator, Scenario, Binding, Failure Taxonomy, Scorecard weights, Winner Rule,
  and A1/A2 schedules are unchanged; legacy evidence remains readable but unidentified/provisional.
- **GitHub App Authentication (Sprint 4b, ADR-0061)** — repository auth for RepositoryHosting REST (CAP-010) and
  local `git push`/`clone` (CAP-002) uses short-lived GitHub App installation tokens minted at execution from an
  adapter-local App private key. New `@quoky/github-app-auth` (App JWT via `node:crypto`, installation resolution,
  token mint + in-memory cache); the RepositoryHosting adapter takes an `auth` source (github-app | dev-only PAT);
  a composition-root `GitHubAppGitProvider` decorator feeds the token to git via a one-shot `GIT_ASKPASS` (token
  only in the child env; never in argv/URL/.git/config/logs/anchors/Discord). `LocalGitProvider` + the `GitProvider`
  port are unchanged; no new capability. New env `QUOKY_GITHUB_APP_*` / `QUOKY_GITHUB_OWNER` / `QUOKY_GITHUB_REPO` /
  `QUOKY_RUNTIME_ENV`; legacy `CHUNSIK_GITHUB_OWNER`/`_REPO` fallback; `CHUNSIK_GITHUB_TOKEN` dev-only PAT. Awaiting
  CA implementation review (PR).
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
