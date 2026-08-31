# Chunsik — Current State

A snapshot of where the repository is **right now**. Updated as part of every
sprint's definition-of-done. It deliberately avoids duplicating `ARCHITECTURE.md`
(rules) or `ROADMAP.md` (direction); for the status of individual concepts see the
`[NOW]/[RESERVE]/[LATER]` labels in `ARCHITECTURE.md`.

- **Phase:** `M2 = COMPLETE_AND_ACCEPTED / CLOSED`; `QUIRKYBOT_DEV_V1 = MILESTONE_REACHED / CLOSED` with
  `QUIRKYBOT_DEV_V1_ACCEPTANCE_CRITERIA = MET`. Stage 2C Slice 3C was implemented in commit `683297f`, independently
  reviewed `PASS`, and closed the prior delegated offline implementation gap. Bounded Live UAT was `EXECUTED` and
  `PASS` at exact verified HEAD `715c407a52eee36a7717d1b4b6695b1469bb0a76`.
- **Active milestone:** `M3`. The M3 Architecture Rebaseline is `RATIFIED_WITH_CHANGES` through ADR-0074,
  ADR-0075, and the appended ADR-0032 amendment. M3A-1 implements `ResourceRef` plus the first read-only Jira/GitHub
  Personal Work Surface; Product Owner acceptance and independent review remain the next gate.
- **Version 1 source release:** `v1.0.0 = COMPLETE / CLOSED` at
  `80bbc94de0493c24036197dabc2ff00dbcd20cbf` (`origin/main` and `v1.0.0^{}`). Tag creation or push is not an
  outstanding release task. This source-release fact does not claim Production Runtime readiness.
- **Quoky operating state:** `QUOKY DEFAULT ORCHESTRATOR = APPROVED`; `QUOKY OPERATIONAL STATUS = NORMAL`;
  `QUOKY FEATURE FREEZE = YES`. Quoky is the normal development orchestrator again, while feature development of
  the Quoky control plane itself remains frozen.
- **Development governance:** `AUTONOMOUS_DEV_MODE = ENABLED`; Product Owner retains
  product/UAT/debug/high-risk authority; Architect AI owns task-level delegated local approval within an active
  milestone, Codex builds, and Claude independently reviews. Strict external/destructive/Runtime/application-Provider
  gates remain Human-only.
- **Development DB governance:** `AUTONOMOUS_DEV_DB = APPROVED`. When `QUOKY_RUNTIME_ENV=dev`, the configured target
  resolves exactly to repository `data/chunsik.db`, and no Production/shared DB is selected, create/open, WAL,
  migrations v1-v6, `PRAGMA user_version`, and bounded normal UAT persistence are delegated. The former
  `DB_MUTATION_NOT_AUTHORIZED` blocker is resolved for that exact development target only.
- **Offline checkpoint:** `STAGE_2B_OFFLINE_COMPLETION = COMPLETE_AND_ACCEPTED` and
  `STAGE_2B_OFFLINE_BLOCKERS = NONE`.
- **Blocked carryover:** XR-AX is optional for Stage 2B offline completion and is `BLOCKED_CARRYOVER`; XR
  filesystem provenance is a `STABLE_BLOCKER`;
  concrete 5C-EG enforcement is `BLOCKED_CARRYOVER`; 5C-EG-I1/I2/V/E are `NOT_ELIGIBLE`.
- **Accepted closeout surface:** ADR-0065 and ADR-0066 are ratified; F0-XR-FCI is
  `COMPLETE_AND_ACCEPTED`; F0-XR-FP is `COMPLETE_AND_ACCEPTED_WITH_CARRYOVER`; 5C-EG-F′ is `ACCEPTED`,
  its feasibility loop is `CLOSED`, and its result remains `NO_FEASIBLE_ARCHITECTURE_YET`.
- **DEV_V1 UAT risk decision:** `CONFIG_RESTRICTED_RISK_ACCEPTED = APPROVED_FOR_DEV_V1_UAT_ONLY` for the current local
  Darwin development host. The exception applies only with exact current-revision UAT authorization,
  `QUOKY_RUNTIME_ENV=dev`, primary `ollama-cli` / `llama3.1`, the approved development Discord bot/guild/channel,
  existing routing/egress/config restrictions, and bounded UAT scenarios. It is not Production-safe 5C-EG and does
  not authorize arbitrary Provider/network execution.
- **5B-2B-E close-out:** `CLOSED_WITH_GENERATION_BLOCKED`. Bounded preflight/inventory is `PASS_ACCEPTED`;
  generation remained unexecuted in that historical close-out, Provider execution count was `0`, and model pull
  count was `0`.
- **Composition:** `QUOKY_PROVIDER_ROUTING_MODE` is parsed exactly and defaults to `legacy`. The composition root
  injects the optional result of an app-private activation factory; legacy mode constructs no new routing Provider.
  Enabled mode remains startup-blocked before Provider construction because no 5C-EG enforcement exists.
- **UAT acceptance:** `QUIRKYBOT_DEV_V1_UAT = PASS_EXECUTED` at exact verified HEAD
  `715c407a52eee36a7717d1b4b6695b1469bb0a76`. The immediately-previous-user-turn recency grounding defect is
  `RESOLVED_ACCEPTED`; current-turn response behavior is `PASS`; Korean response behavior is `PASS`. No
  transcript/meta-analysis leakage and no internal provenance/epistemic metadata leakage were observed.
- **Nested-reference feedback `786b50ad`:** focused provider-boundary coverage confirms the prior User choice request,
  the Assistant selection `파스타가 좋을 것 같아`, and the final User subtype question reach the Ollama CLI input
  in that role-correct chronological order. The observation is classified as provider/model semantic quality, not
  a ContextBuilder or history-loss defect; no phrase-specific handling was introduced.
- **Bounded Provider diagnostics:** under explicit Product Owner approval, the provider recall comparison diagnostic
  executed generation through `ollama-cli` for `llama3.1` and `granite3.3`, and the `llama3.1` stochastic reliability
  diagnostic also executed in its explicitly approved bounded diagnostic scope. These executions were diagnostics
  only; they were not application Runtime execution, Discord connection/action, or Discord Live UAT, and the
  completed diagnostic tasks are not reopened.
- **Remaining Human-only boundaries:** Production/shared DB mutation or migration apply, non-disposable destructive
  DB work, Push, PR, Merge, Production/Release, destructive/unrelated cleanup, and any further Runtime
  start/stop/restart, Discord, or application Provider/network execution remain unapproved.
- **Historical Live UAT evidence:** bounded application Runtime / Discord Live UAT was `PASS_EXECUTED` at exact
  verified HEAD `715c407a52eee36a7717d1b4b6695b1469bb0a76`. ADR-0070 resolved the delegated development DB condition and ADR-0071
  resolved the DEV_V1 UAT live-activation architecture blocker through the bounded configuration-restricted risk
  exception. Production-grade 5C-EG remains `NO_FEASIBLE_ARCHITECTURE_YET / BLOCKED_CARRYOVER`, and
  Production/shared DB mutation remains a separate unapproved Strict boundary.
- **Execution facts:** the accepted Live UAT exercised the approved bounded application Runtime, Provider/network,
  and designated development Discord scope at HEAD `715c407`. The earlier diagnostic scopes also executed
  `llama3.1` and `granite3.3` generation through `ollama-cli`; those diagnostics remain separate from Live UAT.
- **Milestone transition:** `QUIRKYBOT_DEV_V1 = MILESTONE_REACHED / CLOSED` and
  `M2 = COMPLETE_AND_ACCEPTED / CLOSED`. M3 is active under the ratified rebaseline and normal delegated
  development governance; all Strict gates remain intact.

## Version 1 Source Release — Closed

- **Source identity:** `v1.0.0` resolves to `80bbc94de0493c24036197dabc2ff00dbcd20cbf`; the source release and its
  acceptance are complete and closed. Package metadata remains independently versioned at `0.1.0`.
- **No outstanding tag task:** creating, moving, deleting, or pushing a tag is neither pending nor part of M3. The
  existing tag must remain unchanged.
- **Historical acceptance:** the accepted Live UAT evidence remains the bounded `PASS_EXECUTED` run at
  `715c407a52eee36a7717d1b4b6695b1469bb0a76`. It is historical evidence and is not reopened by M3.
- **Carryovers:** Production-grade 5C-EG and other recorded blocked carryovers remain fail-closed where applicable;
  they do not reopen the completed source release and do not authorize Production activation.
- **Strict exclusions:** Push, PR, Merge, tag mutation/push, GitHub Release publication, Production activation,
  Runtime or Provider/network execution, Discord, Live UAT, secrets, destructive work, and Production/shared DB
  mutation each remain outside normal delegated local development.

## M3 Architecture Rebaseline

- **Status:** `RATIFIED_WITH_CHANGES` in ADR-0074, ADR-0075, and the appended ADR-0032 amendment.
- **M3A-1 boundary:** `ResourceRef` stable identity plus a read-only, non-authoritative Work Surface only. No
  `WorkItem` repository, persistence, schema, or migration belongs to M3A-1.
- **M3A-1 implementation:** `WorkSurfaceQuery` resolves explicit Jira/GitHub identities from the current `Actor`,
  queries only read-only `ConnectorProvider` seams, normalizes connector items to `ResourceRef`-backed projection
  items, applies deterministic ordering, and reports complete/partial/unavailable source status. The natural
  personal-work intent is presented without AI execution. `ConversationRuntimeDeps` remains at its starting
  baseline of 31 by replacing the pre-existing unused `risk` dependency with the Work Surface service.
- **M3A-2 boundary:** narrow CAP-011 `WorkItem`, repository, forward-only additive migration, and persisted personal
  work state. `WorkItem` does not absorb Task, execution, Approval, Provider, arbitrary conversation, or workflow
  state.
- **Deferred:** `AgentProfile` remains deferred to M3D. MCP, handoff, trigger, receipt, Workflow, graph engine,
  universal event sourcing, and other later M3 decisions are not authorized by ADR-0074/0075.
- **Conversation boundary:** `ConversationRuntime` remains an entry point, owns no global/persistent work state, and
  its dependency surface must not grow beyond the previous accepted baseline for each completed M3 slice.

## Stage 2C — Slice 3C ExecutionPlan Integrity Binding Architecture

- **Status:** `STAGE_2C_PLAN_BINDING_ARCHITECTURE = EXECUTION_PLAN_REF_TYPED_INTEGRITY_EXTENSION` is `RATIFIED`;
  implementation is `COMPLETE_AND_REVIEWED` at commit `683297f`; Claude independent review is `PASS`. Slices 1, 2,
  and 3B are `COMPLETE_AND_ACCEPTED`; Slice 3A architecture is `RATIFIED`.
- **Core contract:** ADR-0068 defines a generic opaque `ExecutionPlanIntegrityRef { kind, contractVersion, digest }`
  for optional propagation through `PlanningRequest → ExecutionPlan → ExecutionPlanRef`. It identifies the exact
  plan's integrity; it is not an Approval subject, Stage 2C domain object, suitability profile, or Runtime authority.
- **Approval and persistence:** Approval remains strictly plan-scoped and its semantics are unchanged. The design
  adds no persistence, migration, capability, or aggregate. Content-addressing `ExecutionPlan.id` is rejected, and
  in-memory plan retention alone is insufficient across process/session loss.
- **Referential integrity:** Patch and Workspace boundaries must compare plan id plus integrity kind, contract
  version, and digest. Presence mismatch and any typed-integrity mismatch reject; two legacy refs that both omit
  integrity retain existing behavior.
- **Stage 2C binding:** the exact proposed source/config change must exist before plan creation. SHA-256 binds
  `applicationSubjectDigest` and `proposedChangeDigest` into `planIntegrityDigest`; existing non-cryptographic
  `contentHash` helpers are not eligible for this security boundary.
- **No-op and ownership:** `target === expected` is `VERIFIED_NOOP` and creates no plan, approval, patch, or write.
  The app layer derives and freshly revalidates binding facts; ApprovalManager stays generic, PatchManager only
  strengthens ref equality, and WorkspaceWriteManager remains the sole filesystem mutation owner.
- **Safety:** the M1 build/configuration-time model remains authoritative, M2 live Runtime mutation remains deferred,
  and the proposed change cannot expand egress scope or alter routing policy, Runtime wiring, or unrelated providers.

## Stage 2C — Slice 3B Profile Configuration Application Gate

- **Boundary:** pure app-private admission and deterministic projection only. It creates an application candidate,
  not an `ExecutionPlan`, `ApprovalRef`, Patch, mutation authorization, or Runtime object.
- **Configuration identity:** the gate recomputes the exact existing production Registry/policy/configuration
  identity from declarations. The expected result replaces only the ratified provider/model profile while retaining
  unrelated descriptors, policy, ordering semantics, enabled state, validation, and deadline configuration.
- **Safety:** the ratified profile is independently revalidated; the exact Stage 2B provider/model egress scope
  cannot expand; expiry is bounded to 24 hours and uses explicit canonical UTC inputs; malformed, expired,
  unsupported, mismatched, or stale third-state input fails closed.
- **Idempotency:** exact before-state yields `APPLY_REQUIRED`; exact derived after-state yields `VERIFIED_NOOP`;
  every other valid configuration identity is stale and rejected.
- **Provenance/mutation:** candidates bind `SELF_CONSISTENT_UNSIGNED` and `executionMutation = NONE`. No filesystem,
  Registry, policy, Runtime, Provider, process, network, persistence, or Approval mutation is performed.

## Stage 2C — Slice 3A Profile Configuration Application Architecture

- **Decision:** ADR-0067 selects M1 build/configuration-time application. M2 live Runtime Registry mutation is
  deferred; no new Core authorization aggregate, approval database, ApprovalRef, or ApprovalManager behavior is
  introduced.
- **Application gate:** the Slice 3B app-private `ProfileConfigurationApplicationGate` validates the ratified profile,
  exact current configuration identity, expected-result digest, application-contract version, bounded expiry, and
  Stage 2B egress compatibility before producing a deterministic application subject or real change plan/Patch.
- **Authority:** profile ratification and application-subject validity do not approve a configuration change. A
  real configuration-change `ExecutionPlan`/Patch must use the existing plan-scoped Approval boundary before its
  existing mutation owner may act.
- **Safety:** application cannot expand protected egress scope. Exact idempotent repetition may verify as a no-op;
  all mismatched, malformed, expired, unsupported, or unreadable state fails closed.
- **Provenance:** assurance is `SELF_CONSISTENT_UNSIGNED`; digest consistency is checked, but benchmark provenance
  authenticity is not cryptographically proven.
- **Implementation:** the Slice 3B application gate now implements admission and deterministic subject derivation.
  Plan/Patch creation, Workspace apply, Core/Approval changes, Runtime or ProviderRegistry mutation, and live
  activation remain outside the implemented boundary.

## Stage 2C — Slice 2 Static Suitability Profile Ratification

- **Boundary:** app-private offline tooling validates one Slice 1 candidate and one explicit approval binding; it
  does not query `ApprovalManager`, add a Core approval type, or update Registry, policy, production configuration,
  persistence, Runtime composition, or Provider activation.
- **Eligibility:** only an internally valid `ELIGIBLE` candidate with `RATIFICATION_REQUIRED`, `runtimeMutation =
  NONE`, and a disabled descriptor can be ratified. `INELIGIBLE`, `UNPROVEN`, malformed, stale, mismatched, or
  unsupported-version inputs reject fail-closed.
- **Binding:** ratification binds approval identity and authority to the exact candidate, benchmark evidence,
  descriptor configuration, Provider/model identity, and projection/ratification contract versions.
- **Output:** the approved static profile and nested descriptor are immutable and carry a deterministic approved
  profile digest. Ratification remains offline evidence processing; the approved descriptor stays disabled and is
  not a live activation or production-configuration mutation.
- **Approval authority constraint:** `SuitabilityRatificationApprovalBinding` is an independently supplied offline
  binding. `APPROVED` means that candidate identity and the supplied binding passed deterministic checks; operator
  authority, ApprovalManager decision, uniqueness, expiry, revocation, Runtime activation, and production
  authorization are not proven.
- **Application architecture:** ADR-0067 closes the v1 architecture question without treating the profile as
  execution authority: M1 application must create a real configuration-change plan/Patch that uses the existing
  plan-scoped Approval boundary. Slice 3B implements only the pre-plan application gate; ADR-0068 ratifies the Slice
  3C plan-integrity architecture, whose implementation remains not started.
- **Evidence authenticity:** candidate self-consistency is verified, but unkeyed candidate/evidence digests do not
  cryptographically prove benchmark provenance. Authoritative Runtime/audit use requires separate consideration of
  persisted evidence artifacts or authenticated/signature-backed provenance; this is not a Slice 2 blocker.

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
- **V1 correction:** commit `ff1a356` is the accepted Slice 1 remediation within projection/profile v1. It narrows
  eligibility by preserving observed hard-safety disqualifications as `INELIGIBLE` when scorecard evidence is
  missing; it is neither a new profile schema nor a broader eligibility semantic, so no version bump is required.

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
- **UAT workspace binding** — command execution derives `cwd` from the `rootPath` of the Project referenced by the
  current channel/thread Session's `activeProjectId`; runtime bootstrap does not replace that durable binding with
  its process cwd. Before a UAT command scenario, send `이 프로젝트 등록해줘: <repository-root>` in the same
  channel/thread and require the registration response to report the intended repository. This idempotent
  re-registration clears a stale session binding by rebinding it to the Project for that path; do not edit/delete
  SQLite rows manually. A registered path that no longer exists fails closed as workspace unavailable.
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

## M2 closure

- **Durable Memory Write Activation: COMPLETE_AND_ACCEPTED.** The Product Owner ratified the explicit-command-only
  architecture at HEAD `c6d89e02ae80b0b202a6646263baabf83437c8d8`; implementation commit
  `2fa59b713177bab22631b40e932fcd04ceff0aa0` received independent review `PASS`. The required `MemoryWriter`
  activation recognizes only `기억해:` / `기억해줘:` / case-insensitive `remember:` after pending-flow interception
  and before ordinary classification. `GENERAL_CHAT` success, Assistant `SHORT_TERM` recording, and Provider/LLM
  extraction remain non-triggers; ADR-0073 and existing persistence ownership remain unchanged.
- **Slice 5: COMPLETE_AND_ACCEPTED.** ADR-0073 durable recall now has its bounded Core retrieval and lifecycle
  plumbing, and the production composition root wires `DefaultMemoryRetriever` to the existing SQLite-owned memory
  repository through `ContextBuilder`. Durable recall remains separate from the exact `SHORT_TERM` transcript and
  degrades to empty on repository/retrieval failure without displacing transcript or active-project background.
  Together with the accepted explicit-command write activation, both durable recall (Slice 5) and durable write are
  complete. Vector/schema/index work remains deferred and is not part of the ratified M2 scope.
- **Acceptance:** the completed M2 gap assessment and ContextBuilder deterministic ranking slice at commit `8fb8e4b`
  are `COMPLETE / REVIEW PASS` and accepted as the first M2 implementation slice. ContextBuilder token estimation at
  commit `9ef5e7c` is also `COMPLETE / REVIEW PASS`.
- **Overall M2: COMPLETE_AND_ACCEPTED / CLOSED.** Existing provider-neutral seams, multi-provider routing,
  ContextBuilder, PromptComposer, durable recall and explicit-command durable writes, and the Jira, Slack, and
  Confluence read-only connectors are complete for the currently ratified M2 scope. The connector adapters are
  configuration-gated in the composition root.
- **ContextBuilder: COMPLETE for the ratified M2 scope.** It has optional deterministic relevance selection with configurable
  character/token budgets, recency scoring, role weights, bounded keyword-overlap semantic relevance, configurable
  normalized recency/relevance blending, opt-in deterministic lowest-score-first tail compression with a configurable
  per-entry character floor, active-project-first background allocation, and preserved ADR-0063
  provenance/epistemic labels. Selected transcript entries are rendered in their original chronological order to
  preserve PromptComposer's continuity contract. The composition root now supplies explicit GENERAL_CHAT ranking,
  relevance, token-budget, and compression configuration to ConversationRuntime's ContextBuilder. Omitting all Core
  configuration preserves flat N=10 retrieval.
- **PromptComposer: COMPLETE for the ratified M2 scope.** Structured Task/context layering and ADR-0063 authority,
  provenance, and epistemic rendering are implemented; this slice requires no provider-specific prompt shaping.
- **Provider routing: COMPLETE for the ratified M2 scope.** Capability/policy/availability-driven routing and stable
  provider selection exist without Core branching on provider ids.
- **Ollama adapter: COMPLETE; Codex adapter: MISSING.** Ollama implements suggest-only execution and availability;
  Codex remains an explicitly unavailable `NotImplementedError` stub.
- **Jira, Slack, and Confluence connector adapters: COMPLETE (wired).**
  `@chunsik/connector-jira`, `@chunsik/connector-slack`, and `@chunsik/connector-confluence` implement the ADR-0072
  read-only `ConnectorProvider` boundary and are registered by the composition root when their required environment
  configuration is complete. Missing or partial configuration leaves the corresponding connector unregistered.
- **Read-only connector seam: COMPLETE for the ratified M2 scope.** `ConnectorProvider`, `ConnectorManager`, concrete adapter
  packages, and configuration-gated composition-root injection are wired. The registered connector list contains the
  configured Jira, Slack, and Confluence adapters.

## Deferred

- **Codex** — `CodexCliProvider` not implemented (stub; no deterministic suggest-only mode).
- **Workflow** — multi-step planning/execution beyond a single Task is not built.
- **Agent Runtime** — no autonomous tool-using / coding agent.
- **Vector Search** — `VectorProvider` is a local stub; no embeddings/retrieval/semantic search.

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
  agent runtime, AI HTTP API, PolicyProvider,
  PROJECT/TOOL memory retention.

## Validation

- Current release validation on Node `v22.22.1`: `pnpm typecheck` — PASS (exit 0); `pnpm test` — PASS,
  `119` files / `2653` tests.
- Boundary enforced — Core cannot resolve adapter packages.
- **Live (Sprint 1g):** real `node dist/main.js` Discord round-trip — register a
  project, then a structure question routed to PROJECT_ANALYSIS, read real files,
  returned a grounded answer (7 ports, package→port map, tech stack), persisted as
  TOOL memory; secrets never read. Requires `DISCORD_BOT_TOKEN` + Message Content Intent.
