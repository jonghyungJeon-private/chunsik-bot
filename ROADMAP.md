# Quoky Platform — Roadmap

Lightweight, living roadmap: **direction and sequence only.** Rules live in
`ARCHITECTURE.md`, decisions in `DECISIONS.md`, present status in
`CURRENT_STATE.md`. This file does not duplicate them.

## Edition evolution

- **Personal Edition (now)** — local-first, single actor, Discord, CLI providers, SQLite.
- **Team Edition** — multi-actor; storage / queue / event transport swapped to networked implementations.
- **Hosted / SaaS Edition** — multi-tenant. Tenancy is a **v3** scope dimension layered onto Actor/Session; **not built now** and no multi-tenant abstractions are introduced early (YAGNI).

> An edition step changes **adapters / wiring / reserved seams — never Core contracts**
> (`ARCHITECTURE.md` §13). A forced Core-contract change requires an ADR first.

## Major milestones

- **M0 — Repository operating system** ✅ done (Sprint 0).
- **M1 — Walking skeleton:** one natural-language flow, end to end (Sprint 1a → 1b).
- **M2 — Memory & multi-provider:** ✅ done for the ratified scope — provider-neutral routing/Ollama,
  ContextBuilder ranking and bounded compression, durable memory, and read-only connectors. Codex remains deferred.
- **M3 — Personal Work OS foundations:** **active** — Resource identity, a read-only Work Surface, and the
  narrow CAP-011 Work Model follow the ratified M3 Architecture Rebaseline (ADR-0074/0075).

Current operational phase: **M3**. The `v1.0.0` source release is complete and closed at
`80bbc94de0493c24036197dabc2ff00dbcd20cbf`; tag creation/push is not an outstanding release task. M3 activation
does not claim Production Runtime readiness.

## Sprint roadmap

| Sprint | Goal | Notes |
|---|---|---|
| **0** ✅ | Bootstrap the repository operating system | docs + collaboration model |
| **1a** | Walking skeleton: Discord adapter + minimal Session + SQLite persistence + **echo** reply | validates I/O + persistence + boundaries; **no cognition** |
| **1b** | Intent classification + Planner + ContextBuilder + PromptComposer + capability routing + Claude CLI execution | natural language only, no slash commands; provider chosen by **router**, never hardcoded |
| **M3A-1** | `ResourceRef` + read-only Work Surface | no WorkItem persistence or migration |
| **M3A-2** | CAP-011 WorkItem repository + additive migration + persisted personal-work state | ADR-0075 |
| **M3B** ✅ | ToolProvider and bounded MCP adapter foundations | ADR-0076/0077; no autonomous execution |
| **M3C** ✅ | CAP-013 command execution receipts | ADR-0078 |
| **M3D** ✅ | Immutable AgentProfile registry and durable WorkHandoff | ADR-0079/0080; no agent runtime |
| **M3E-1/2** ✅ | Trigger provenance, decisions and idempotent handoff production | ADR-0081/0082 |
| **M3E-3** ✅ | Read-only handoff consumption eligibility | ADR-0083 Ratified; delivered |
| **M3E-4** ✅ | Continuation admission and TaskRun correlation | ADR-0084 Ratified; delivered through PR #59; no run creation/execution |
| **M3E-5** ✅ | Atomic TaskRun start and attempt allocation | Delivered through PR #60 at `bef459aaf3a77549dd44760a21ea839073b0cb46`; ADR-0085 Ratified; schema v11; no continuation execution/runtime |
| **Product identity** | Quoky Platform source rename | Locally complete; independently reviewed; ADR-0086 Ratified; not yet delivered |
| **M3E-6A** | Continuation Execution Admission architecture | ADR-0087 Ratified by Chief Architect; independent exact-HEAD review PASS_WITH_NON_BLOCKING_FINDINGS; Option B over existing owners, exact TaskRun.id and effect-time revalidation; no new aggregate/repository/schema |
| **M3E-6B** ✅ | Read-only admission evaluation | Delivered through PR #67 at `c0c91f341cb5f300628b86506c84e329d4f14eac`; ADR-0087 Ratified; canonical STARTED conflict predicate; zero run mutation; guarded atomic start and bypass closure architected in M3E-6C |
| **M3E-6C** | Effect-time guarded continuation start architecture | ADR-0088 Ratified; independent review PASS_WITH_NON_BLOCKING_FINDINGS; guarded-start implementation NOT STARTED; Option B guarded start on existing TaskRun port; commit is the linearization point; at-most-one concurrent winner; bypass closure preserves terminal updates; no new aggregate/repository/schema; continuation Task RUNNING wiring required before activation; approval acquisition and start-time revalidation are distinct gates; receiver invocation not implemented; activation disabled |
| **M3E-6D** ✅ | Continuation Task lifecycle wiring | DELIVERED through PR #69 at `bab2e197151f9682298697be0cf5b18cb8f1e79b`; exact-bound Application preparation via existing TaskManager and ApprovalManager; production DI entry; no TaskRun; guarded start NOT IMPLEMENTED; receiver invocation NOT IMPLEMENTED; activation DISABLED |
| **M3E-6E** ✅ | Guarded atomic TaskRun start | DELIVERED through PR #70 at `c603f0923d20b463907b471f127f5f870225a4ac`; ADR-0088 sibling guardedStart; exact evaluated snapshots; single IMMEDIATE commit; six-process one-winner validation; ordinary-start/save bypass closure; no schema change; production trigger, profile config surface and receiver NOT IMPLEMENTED; activation DISABLED |
| **M3E-6F** ✅ | Activation readiness architecture | ADR-0089 **Ratified** (independent review PASS_WITH_NON_BLOCKING_FINDINGS); docs-only, architecture DECIDED; CONTINUATION_ACTIVATION_READY_TODAY = NO; ratified bound-run delete prohibition (resolveRun provenance + MAX(attempt)+1 ordinal identity), explicit bounded busy wait + typed storage contention, static AgentProfile config (no repository), narrow ContinuationExecutionService as coordinator and receiver-invocation owner with TaskManager terminalization; trigger, authorized Actor/Project scope, receiver capability set, post-wait live-plan source and operation-scoped Approval proof all UNRESOLVED; no prerequisite implemented; activation DISABLED; automatic retry NO; exactly-once external effects NO CLAIM |
| **M3E-6G** ✅ | TaskRun persistence safety | DELIVERED through PR #72 at `80b28ea8fa9746cd970d37f982510ba5be4ada37`; bound TaskRun delete prohibition (all statuses incl. terminal history) from persisted task_id + canonical binding in one IMMEDIATE transaction; explicit SQLite lock wait (5000 ms default, validated); typed `TASK_RUN_STORAGE_BUSY` distinct from `UNRESOLVED_STARTED_RUN`; CANCELED/revival coverage; unbound delete and missing-id no-op preserved; no schema/migration/status/repository; automatic Application retry NO; raw-SQL immunity NOT claimed; activation DISABLED |
| **M3E-6H** ✅ | Static AgentProfile configuration | DELIVERED through PR #73 at `dfb473d882d58805270425657498caebc837c80c`; `QUOKY_AGENT_PROFILES` parsed only in the existing typed app config into one immutable composition-time `AgentProfileRegistry`; hardcoded empty registry removed; strict unknown-field/duplicate-id/bounded failure, absent or `[]` keeps the empty fail-closed registry; no repository, schema, durable state or dynamic registration; profiles select no Provider and grant no capability, Tool or execution authority; Product trigger UNSELECTED, Product Decision gate NOT REACHED, receiver invocation NOT IMPLEMENTED, activation DISABLED |
| **M3E-6I-a** | Shared structural live-plan predicate | IMPLEMENTED LOCALLY / AWAITING REVIEW; one pure Core module owns the structural live-plan and plan-ref/integrity proof used by both `WorkHandoffContinuationService.prepare` and `ContinuationExecutionAdmissionService.evaluate`; gate-specific lifecycle, requester, exact-approval-id and approval-policy consistency semantics deliberately unchanged; live plan stays caller-owned with no persistence, cache or reconstruction; post-wait plan source and operation-scoped Approval proof remain UNRESOLVED; last slice before the **Product Decision gate**; activation DISABLED |
| **Product Decision gate → M3E-6L** | Remaining activation prerequisites | **Product Decision gate NEXT** (trigger, authorized Actor/Project scope, supported receiver capability set) → M3E-6I-b post-wait context contract → M3E-6J explicit caller preparation → M3E-6K receiver seam + exact-run terminalization → M3E-6L offline activation acceptance; 6J must not precede 6I-b; live activation needs separate strict approval |
| **Future** | Memory improvements · Codex · additional connectors | per ADR sequence |

## Deferred capabilities (YAGNI)

Reserve a seam **only when expensive to retrofit.** Most of these already map onto
**existing ports / ADRs** and need **no action now**:

| Capability | Absorbed by | Action now |
|---|---|---|
| Further MCP execution/integration | bounded `ToolProvider` adapter foundation exists | separate authorization; no autonomous loop |
| Plugin ecosystem | ADR-0007 (bundle of existing ports) | none |
| Multi-agent runtime | ADR-0008 (`AgentProfile` seam) | immutable profile/registry implemented in M3D; runtime remains deferred |
| Remote workspace | `WorkspaceProvider` (`kind: 'remote'`) | none |
| Local model manager | `AiProvider` availability/health | none |
| Multimodal | keep `Artifact`/`Resource` from assuming text-only | note only |
| Search | future bounded resource retrieval + `VectorProvider` | deferred; `ResourceResolver` is not implemented |
| Feedback learning, Feature registry, Scheduler, Notification | future additive services | none (no Core seam) |

## Non-goals (v1)

- Not a Discord bot framework — Discord is one adapter.
- No AI HTTP API (CLI only). No Postgres/Redis. No multi-tenancy.
- No slash-command UX. No autonomous agent loops, no dynamic plugin loading, no Workflow engine.
