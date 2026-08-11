# Chunsik — Current State

A snapshot of where the repository is **right now**. Updated as part of every
sprint's definition-of-done. It deliberately avoids duplicating `ARCHITECTURE.md`
(rules) or `ROADMAP.md` (direction); for the status of individual concepts see the
`[NOW]/[RESERVE]/[LATER]` labels in `ARCHITECTURE.md`.

- **Phase:** **Stage 2C Slice 1 — Model Suitability Evidence Projection Implemented**. Accepted benchmark evidence
  can be deterministically projected into a bounded candidate static Provider profile without changing Core or
  mutating Runtime routing; every candidate remains behind explicit ratification.
- **Offline checkpoint:** `STAGE_2B_OFFLINE_COMPLETION = COMPLETE_AND_ACCEPTED` and
  `STAGE_2B_OFFLINE_BLOCKERS = NONE`.
- **Blocked carryover:** XR-AX is optional for Stage 2B offline completion and is `BLOCKED_CARRYOVER`; XR
  filesystem provenance is a `STABLE_BLOCKER`;
  concrete 5C-EG enforcement is `BLOCKED_CARRYOVER`; 5C-EG-I1/I2/V/E are `NOT_ELIGIBLE`.
- **Accepted closeout surface:** ADR-0065 and ADR-0066 are ratified; F0-XR-FCI is
  `COMPLETE_AND_ACCEPTED`; F0-XR-FP is `COMPLETE_AND_ACCEPTED_WITH_CARRYOVER`; 5C-EG-F′ is `ACCEPTED`,
  its feasibility loop is `CLOSED`, and its result remains `NO_FEASIBLE_ARCHITECTURE_YET`.
- **5B-2B-E close-out:** `CLOSED_WITH_GENERATION_BLOCKED`. Bounded preflight/inventory is `PASS_ACCEPTED`;
  actual generation is `NOT_EXECUTED`, Provider execution count is `0`, and model pull count is `0`.
- **Composition:** `QUOKY_PROVIDER_ROUTING_MODE` is parsed exactly and defaults to `legacy`. The composition root
  injects the optional result of an app-private activation factory; legacy mode constructs no new routing Provider.
  Enabled mode remains startup-blocked before Provider construction because no 5C-EG enforcement exists.
- **Approval boundary:** no Runtime, Discord, DB, or Provider activation is approved. Independently verifiable
  external-egress enforcement is an explicit activation dependency, not a hidden environmental assumption.
- **Live status:** Provider activation and Runtime/Discord/DB UAT remain `BLOCKED`. Offline completion is not
  external-egress proof, filesystem-provenance proof, live-activation readiness, or production readiness.
  Concrete 5C-EG or equivalently strong enforcement plus the required Strict approval remains mandatory for live
  activation.
- **Execution facts:** actual Provider execution = `0`; Runtime/Discord/DB execution = `0`.

## Stage 2C — Slice 1 Model Suitability Evidence Projection

- **Boundary:** app-private offline tooling consumes bounded Stage 2A campaign/decision evidence and produces an
  existing-Core-compatible `ProviderDescriptor` candidate. It does not update a Registry, policy, production
  configuration, Runtime collaborator, persistence, or Provider binding.
- **Suitability:** exact `ELIGIBLE | INELIGIBLE | UNPROVEN`; hard safety/containment/download failures cannot be
  offset by scores, while malformed, identity-mismatched, digest-mismatched, and stale bindings reject fail-closed.
- **Binding:** campaign/configuration/fingerprint, decision policy, Provider/adapter/model, descriptor configuration,
  prompt/scenario/evaluator versions, projection version, evidence digest, and candidate profile digest.
- **Ratification:** output is always `RATIFICATION_REQUIRED` with `runtimeMutation = NONE`. Evidence changes create
  another candidate and never alter routing automatically; its descriptor remains disabled until a separately
  approved composition profile is created.

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
- **Stage 2B:** Architecture and Option B typed policy foundation are ratified in ADR-0064. Slices 1–4 implement
  deterministic selection, immutable planning/binding, bounded two-attempt Gateway orchestration, response
  validation, audit, and private simulation. Slice 5A adds the offline Core Runtime integration seam for only
  TaskRun-backed `GENERAL_CHAT`; real app composition and external Provider execution remain deferred.

## Stage 2B — Slice 4 Deterministic Routing Selection Simulation

- **Boundary:** independent `selection/` subtree in the existing private validation package. Replay stops at
  `RoutingPolicyEngine → ProviderSelectionDecision`; execution planning, Gateway, validation, bindings, Runtime,
  adapters, and production dependency wiring are absent.
- **Fixtures:** five strict, statically registered JSON scenarios with independent schema/compiler/digest versions
  and immutable fixture/corpus SHA-256 identities.
- **Projection:** exact decision facts plus `matchedPolicyId` and the configured ranking dimension/direction vector;
  no scores or execution facts.
- **Determinism:** every fixture replays twice. The current multi-provider Golden fixtures exercise Provider
  registration-order permutation. Policy declaration-order permutation remains implemented but is not independently
  exercised by the single-policy corpus; policy-order independence is owned by Core normalization and regression.
  Coverage includes policy match/absence, eligibility/no-eligible, disabled/unavailable filtering,
  preference/ranking, stable ordering, and one Authority × Safety × Ranking cross-scenario. Provider invocations
  remain zero.

## Stage 2B — Slice 5A Offline Runtime Integration Seam

- **Boundary:** optional Core Application collaborator plus `ConversationRuntime` integration for only
  TaskRun-backed `GENERAL_CHAT` work turns. The app composition root is intentionally unchanged.
- **Context/profile:** exact static enum mapping from existing Runtime facts; `GENERAL_CHAT` validation profile is
  fixed upstream. There is no message reclassification, Provider/model branch, evidence lookup, clock/random use,
  or I/O in the mapping.
- **Availability/execution:** each configured executable Provider is probed at most once per request, producing one
  immutable snapshot consumed by Registry → Policy → Planner → Gateway. Gateway never re-probes availability.
- **Lifecycle/audit:** accepted bounded output persists artifacts and completes TaskRun/Task. Human review reuses
  `NEEDS_REVIEW`; rejected, safety, configuration, and execution failures reuse `FAILED`. Every outcome persists
  bounded `routingAudit`; only accepted output records its actual Provider on `TaskRun.providerId`.
- **Rollout:** once this seam handles a request, no legacy selection fallback or shadow comparison occurs.
  Project Analysis, Code Generation, no-work chat, and other Capabilities remain legacy. Tests use fake Providers;
  Slice 5B-1 now supplies unwired production descriptors/policies/bindings; app activation, Runtime/Discord, and
  external execution remain deferred.

## Stage 2B — Slice 5B-1 Provider Identity and Static Routing Configuration

- **Identity:** `providerId` identifies a configured executable instance, `adapterId` the adapter family, and
  `modelId` the exact opaque model binding. Ollama accepts an additive explicit instance id while its legacy
  constructor still yields `ollama-cli`.
- **Configuration:** the unwired composition-root factory contains exactly `ollama-cli:llama3.1:8b` and
  `ollama-cli:granite3.3:8b`, GENERAL_CHAT-only BALANCED → SEMANTIC_HIGH routing, existing GENERAL_CHAT validation,
  and the existing STANDARD deadline. Unratified operational dimensions are equal conservative values.
- **Provenance:** each descriptor carries an immutable canonical SHA-256 binding over the ratified Stage 2A
  campaign, checker, corpus, model, instance, and candidate-role facts under `stage2b-provider-provenance-v1`.
- **Boundary:** the factory performs construction validation without availability probes or execution and is not
  imported by `app.module.ts`. Readiness/model installation are **NOT VERIFIED**; 5B-2 execution and 5C activation/UAT
  remain separately approved work.

## Stage 2B — Slice 5B-2A-I Ollama Preflight Contracts and Runner

- **Boundary:** composition-root-private and unwired; no Core API, Capability, Aggregate, Runtime, app-module, or
  persistence change.
- **Contracts:** independent v1 identities for preflight result, executable identity, command policy, and inventory
  parser; exact required tags are `llama3.1:8b` and `granite3.3:8b`.
- **Containment:** absolute realpath/digest revalidation, exact `--version`/`list` argv, loopback-only endpoint,
  runner-owned exact isolated environment, hard promise-settlement deadline, bounded timeout/output/rows, zero
  retry, download-marker observation, and maximum two non-generation commands.
- **Execution:** actual executable/version/inventory are **NOT VERIFIED**; Ollama process, daemon/network access,
  inventory read, and Provider generation were **NOT EXECUTED** and remain 5B-2A-E/5B-2B gates.

## Stage 2B — Slice 5B-2A-E0 Honest Egress and Execution Composition

- **Egress:** `OS_DENIED_VERIFIED` requires an independently successful verifier and projects isolation true.
  `CONFIG_RESTRICTED_RISK_ACCEPTED` projects isolation false and does not technically deny external egress.
- **Current OS-denial mode:** the verified-mode contract exists, but no concrete OS-denial verifier is composed in
  the current entrypoint. Therefore `OS_DENIED_VERIFIED` currently blocks and is not executable, while
  `CONFIG_RESTRICTED_RISK_ACCEPTED` is the currently executable mode and neither technically denies nor proves
  denial of external egress.
- **Composition:** strict explicit inputs, concrete bounded filesystem/sandbox/spawn adapters, existing preflight,
  one bounded console projection, and exit codes 0/2/3/4/5 remain app-private and absent from `app.module.ts`.
- **Projection write failure:** each invocation attempts structured projection emission at most once. If the first
  write fails, no projection is successfully emitted, no fallback projection is attempted, and the entrypoint
  terminates through the unexpected-failure exit path (5), never the configuration-error path.
- **Boundary:** actual executable/version/inventory are **NOT VERIFIED**; Ollama process, daemon/network access,
  inventory read, Provider generation, persistence, and DB work were **NOT EXECUTED**.

## Stage 2B — Slice 5B-2B-I Primary-Only Provider Generation Harness

- **Composition:** exact `ollama-cli:llama3.1:8b` validation-only descriptor/binding through the real Registry →
  Policy → Decision → Planner → Gateway chain; immutable primary count 1, fallback/escalation/retry 0.
- **Environment:** caller-approved absolute executable and explicit `127.0.0.1` endpoint; runner-owned HOME/TMPDIR,
  bounded locale/color/cloud variables, no inherited PATH, parent HOME, proxy, credential, or loader variables.
- **Acquisition:** `DENIED_VERIFIED` requires an independent verifier. The risk-accepted mode projects technical
  prevention false and requires exact preflight presence, bounded case-insensitive pull-marker observation, and an
  unchanged postflight inventory fingerprint. Observation is not proof that no earlier bytes were transferred.
- **Evidence hardening:** invocation count is observed per runner request; a second request is recorded but never
  delegated. Download, timeout, and structured overflow facts survive later terminal failures. Both adapter and
  runner independently require exact IPv4 loopback, while invalid acquisition input projects null.
- **Output disclosure:** only the exact success token may be projected. Case/punctuation/prose mismatches expose
  bounded byte count and SHA-256 only; overflow exposes neither literal output nor a digest.
- **Boundary:** fake seams only. Actual generation, Ollama/process/network/inventory execution, external-egress
  denial, Runtime, Discord, persistence, and DB work were **NOT EXECUTED**.

## Stage 2B — Slice 5B-2B-E Re-entry Gate Close-Out

- **Gate:** `CLOSED_WITH_GENERATION_BLOCKED`. E1 implementation was accepted and pushed. The bounded preflight and
  inventory attempt passed with Ollama `0.32.5`; exact required tags `llama3.1:8b` and `granite3.3:8b` were present.
- **Execution facts:** only the authorized `--version` and `list` child commands ran (count `2`). Provider execution,
  generation-harness invocation, retry, fallback, escalation, model pull, and daemon lifecycle mutation were all `0`.
- **Generation block:** actual generation was intentionally not executed because independently verified,
  attempt-scoped external-egress denial was unavailable. Client-only restrictions do not constrain the already
  running Ollama daemon; configuration and observation are not technical denial.
- **Identity boundary:** the consumed executable identity approval is retained as attempt evidence only, never as a
  standing execution approval or production default.
- **Next boundary:** production activation remains default-off and unwired. External-egress enforcement is separate
  architecture work and must precede any successful live activation or Provider execution approval.

## Stage 2B — Slice 3C Deterministic Validation Harness

- **Boundary:** private test-only workspace package depending one-way on Core; it is absent from the production
  TypeScript reference graph and must never be imported by apps, Runtime, adapters, or production packages.
- **Fixtures:** strict JSON schema, explicit static registry, immutable fixture versions, and retained per-fixture
  plus corpus SHA-256 identities under an independent Harness digest version. There is no filesystem discovery or
  evidence lookup.
- **Replay:** real Core planner, validator, and Gateway contracts run against scripted in-memory Providers and an
  injected monotonic clock. Selection policy is not simulated or reevaluated. External Provider execution is zero.
- **Golden contract:** exact comparisons use the Harness-owned `CanonicalAuditProjection`, so unrelated future
  product-audit fields do not silently redefine the corpus. Every fixture is replayed twice from a fresh graph.
- **Coverage:** primary acceptance, operational fallback, semantic escalation, safety fail-closed, post-validation
  deadline failure, maximum-transition fallback, binding provenance, attempt bounds, and failure-matrix accounting.
  Slice 3C remediation explicitly partitions every failure code into active golden coverage, bounded active waiver,
  or producer-pending status and adds terminal `SEMANTIC_VALIDATION_UNRESOLVED` golden replay coverage.

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

## Stage 2B — Slice 3B Bounded Two-Attempt Gateway

- **State ownership:** the Gateway orchestrates a separate pure state reducer with an explicit seven-transition
  upper bound and READY-to-terminal zero-attempt deadline checkpoints.
- **Execution:** primary followed by at most one pre-fixed operational fallback or stronger semantic escalation;
  maximum attempts `2`, additional hops `1`, retry and same-provider retry prohibited.
- **Deadline:** versioned policy plus injected monotonic clock; execution and validation share one non-resetting
  deadline, and caller timeout is capped by remaining Provider budget.
- **Terminal/audit:** six explicit terminal statuses, first-class `humanReviewRequired`, bounded accepted output,
  and audit v2 with at most two attempts, seven transitions, deadline-policy identity, and no raw content.
- **Review remediation:** failure matrix v4 makes semantic-unresolved production active while structural-unresolved
  remains pending; restored provenance/error regression contracts and rechecks binding identity before attempt 2.
- **Boundary:** fake-Provider tests only. No ConversationRuntime, CodeGenerationManager, app, adapter, port,
  persistence, Discord, network, database, or actual external Provider execution integration.

## Implemented

- **Stage 2B Slice 5A offline Runtime integration (ADR-0064)** — added deterministic bounded Runtime-context
  mapping, one-probe immutable availability snapshots, the existing selection/plan/Gateway composition, existing
  lifecycle terminal mapping, bounded TaskRun `routingAudit`, safe terminal replies, and fail-closed no-legacy
  fallback behavior. Production Provider/app activation remains absent.
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
  Core/Orchestrator contract change (ADR-0033).

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
