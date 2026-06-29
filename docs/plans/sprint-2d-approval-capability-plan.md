# Sprint 2d Implementation Plan — CAP-004 Approval Capability

- **Status:** 🟡 PLAN ONLY — awaiting Chief Architect review. No code, no commit, no
  prototype. No existing source file modified.
- **Capability:** **CAP-004 — Approval** (canonical roadmap: after Planning, before Patch).
- **Date:** 2026-06-29
- **Process:** V2 architecture-first, Step 1 (Implementation Plan). Plan → review →
  approval → implementation. Do not bypass the planning gate.

---

## 1. Objective

Introduce **CAP-004 Approval**: the authorization gate between a deterministic
`ExecutionPlan` (CAP-003) and any code-changing capability (Patch → Workspace Write →
Command Execution). Approval decides whether a plan may proceed, records the human
decision, and is the **first persisted V2 aggregate**.

```
Planning → ExecutionPlan → [Approval] → Patch → Workspace Write → Command Execution
```

Approval **owns the `ApprovalRequest` aggregate**; it references the `ExecutionPlan`
(read-only) and **never mutates it** (Aggregate Ownership Rule).

## 2. Scope (proposed minimal safe scope)

- **Approval domain (aggregate `ApprovalRequest`)** keyed to an `ExecutionPlanRef`, with a
  lifecycle status; `ApprovalDecision` (input), `ApprovalRef`, `ApprovalStatus`.
- **`ApprovalPolicy`** — deterministic: given an `ExecutionPlan`, decide whether approval is
  required (reuses `RiskPolicy.requiresApproval` + `ExecutionPlan.approvalRequired`).
- **`ApprovalManager`** — owns the aggregate: `requestFor(plan)`, `decide(id, decision)`,
  `get(id)`, `isApproved(planRef)`. Persists via the StorageProvider `approvals` repo.
- **Persistence (first V2 aggregate):** implement `SqliteApprovalRepository` (replace the
  current `StubRepository`) + **migration v2** (new `approvals` table) via the ADR-0020
  migration runner. Backward compatible.
- Tests (domain + policy + manager + repository + migration) + capability doc + ADR-0025.

## 3. Out of Scope (explicit)

- ❌ Patch (CAP-005), Workspace Write (CAP-006), Command Execution (CAP-007), Codex/Ollama.
- ❌ **Mutating `ExecutionPlan`** — Approval references it; approval state lives on
  `ApprovalRequest` (see §16 / Q1).
- ❌ Discord approval **UI** + orchestrator/Intent wiring (`PlatformAdapter.requestApproval`,
  `onApprovalDecision`, `ChunsikCore.handleApprovalDecision`) — integration deferred (Q5).
  CAP-004 delivers the domain + policy + manager + persistence; decisions are fed
  programmatically via `ApprovalManager.decide`.
- ❌ AI / AiProvider changes. No new infrastructure beyond the SQLite `approvals` table.

## 4. Architecture Impact

- **Aggregate Ownership Rule applied (new CA principle).** Approval owns `ApprovalRequest`;
  it reads `ExecutionPlan`/`ExecutionPlanRef` but does not modify the plan.
- **First persisted V2 aggregate.** Uses the existing `StorageProvider.approvals` port
  (already typed `Repository<ApprovalRequest>`) — no new port; the SQLite adapter
  implements it + a migration (exercises ADR-0020 for real).
- **Deterministic policy** — `ApprovalPolicy` reuses `RiskPolicy`; no AI.
- **Ref-based composition** — downstream capabilities consume `ApprovalRef` /
  `ExecutionPlanRef`, not aggregate roots.
- Core stays provider-agnostic and `child_process`-free; SQL stays in the adapter.

## 5. ADR Impact

- **New ADR-0025 — CAP-004 Approval Capability.** Records: `ApprovalRequest` aggregate
  + lifecycle; Approval references but never mutates `ExecutionPlan` (Aggregate Ownership);
  approval state authoritative on `ApprovalRequest` (Q1); deterministic `ApprovalPolicy`;
  persistence + migration v2; integration deferred (Q5); relationships with ExecutionPlan/
  Patch/Workspace Write.
- **Reconcile the existing V1 `ApprovalRequest`** (task-based) with the V2 plan-based shape
  (§8 / Q2) — amend ADR-0010/ADR-0013 lineage as needed.
- Possibly **record the Aggregate Ownership Rule** in ARCHITECTURE.md here or defer to the
  CA's "future documentation refinement sprint" (Q6).
- (Outline in §18.)

## 6. Capability ID Usage

**CAP-004** referenced in ADR-0025, the Sprint 2d review, CHANGELOG, CURRENT_STATE,
`docs/capabilities/approval.md`, and this plan.

## 7. Files Likely to Be Modified / Created (plan-only — none touched yet)

**New:**
| Path | Purpose |
|---|---|
| `packages/core/src/application/approval-policy.ts` | `ApprovalPolicy` (deterministic). |
| `packages/core/src/application/approval-manager.ts` | `ApprovalManager` (owns the aggregate). |
| `packages/core/src/application/approval-*.test.ts` | Policy + manager tests. |
| `docs/capabilities/approval.md` | Capability doc. |

**Modified:**
| Path | Change |
|---|---|
| `packages/core/src/domain/approval.ts` | Evolve `ApprovalRequest` (link `ExecutionPlanRef` + status) + `ApprovalStatus` + `ApprovalRef` (Q2). |
| `packages/core/src/domain/enums.ts` | `ApprovalStatus` (and align `ExecutionStatus` PENDING→PLANNED — Q3). |
| `packages/core/src/application/index.ts` | Export Approval services. |
| `packages/storage-sqlite/src/index.ts` | `SqliteApprovalRepository` (replace stub). |
| `packages/storage-sqlite/src/migrations.ts` | **Migration v2:** `approvals` table. |
| `packages/storage-sqlite/src/migrations.test.ts` | Migration v2 + idempotency/upgrade tests. |
| `apps/chunsik/src/app.module.ts` | Wire `ApprovalPolicy` + `ApprovalManager`. |
| `DECISIONS.md` | ADR-0025. |
| `CURRENT_STATE.md`, `CHANGELOG.md` | CAP-004 status + entry. |

*No platform/orchestrator file changes in 2d (Q5).*

## 8. New / Evolved Domain Concepts

- **`ApprovalStatus`** (enum): `PENDING | APPROVED | REJECTED`.
- **`ApprovalRequest`** (aggregate) — evolve from the V1 task-based shape to reference a
  plan: `{ id; executionPlanId: Id; (executionPlanRef) ; overallRisk: RiskLevel; summary;
  status: ApprovalStatus; requestedAt; decidedAt?; decidedBy?; comment? }`. (Q2: keep
  `taskId?` optional for back-compat, or fully replace.)
- **`ApprovalDecision`** (input VO) — exists: `{ approvalId, approved, decidedBy,
  decidedAt, comment? }` (reused).
- **`ApprovalRef`** — `{ id; status }` (sibling of `WorkspaceRef`/`ExecutionPlanRef`).

## 9. Ports Affected

- **None new.** Reuses `StorageProvider.approvals: Repository<ApprovalRequest>` (existing
  port). `ApprovalManager`/`ApprovalPolicy` are core application services.
- (`PlatformAdapter.requestApproval`/`onApprovalDecision` remain stubs — integration deferred, Q5.)

## 10. Adapters Affected

- **`storage-sqlite`** — implement `SqliteApprovalRepository` (replace `StubRepository`) +
  migration v2 (`approvals` table: `id TEXT PK`, `data TEXT NOT NULL`, optional filter cols
  `execution_plan_id`, `status`). No other adapter changes.

## 11. Blast Radius

- **Compile-time:** evolving `ApprovalRequest` ripples to its (stubbed) consumers — the
  `approvals` repo type + orchestrator's stubbed approval path. Contained, typed.
- **Runtime:** Approval is not wired to a live user flow in 2d (Q5) → near-zero live impact.
  The new SQLite migration runs on init but is backward compatible (ADR-0020).
- **Data:** **new `approvals` table** (additive migration v2). No change to existing tables.
- Net: **Low–Medium** (first persistence + an aggregate evolution; no live caller).

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Aggregate-ownership vs ExecutionPlan.status transition (CA lifecycle says PLANNED→APPROVED) | **High (design)** | Q1: approval state authoritative on `ApprovalRequest`; Approval does NOT mutate `ExecutionPlan`. Resolve with CA before coding. |
| Evolving V1 task-based `ApprovalRequest` breaks the stubbed orchestrator path | Med | Keep `taskId?` optional / additive; the orchestrator approval path is a stub (not live). |
| First migration beyond baseline | Med | Migration v2 is additive (`CREATE TABLE IF NOT EXISTS approvals`); covered by migration tests incl. legacy upgrade. |
| Persisting sensitive decision data | Low | Store only ids/status/summary/decidedBy/comment — no secrets; summaries already sanitized upstream. |
| Scope creep into Discord UI / orchestrator | Med | Q5 defers integration; CAP-004 = domain+policy+manager+persistence only. |

## 13. Security Considerations

- Persistence stores ids, status, summary, decidedBy, comment — **no secrets, no tokens,
  no remote URLs**. Summaries originate from plans (already bounded/sanitized).
- SQL stays parameterized in the adapter (existing pattern); core `child_process`-free.
- Approval is the governance gate: no external write may proceed without an `APPROVED`
  `ApprovalRequest` — the security backbone for CAP-005/006/007.

## 14. Validation Strategy

- `pnpm typecheck`; `pnpm test`:
  - **ApprovalPolicy:** requires approval iff `plan.approvalRequired` / risk HIGH+CRITICAL.
  - **ApprovalManager:** `requestFor` creates a PENDING request linked to the plan; `decide`
    sets APPROVED/REJECTED + decision fields; `isApproved` reflects status; never touches
    `ExecutionPlan`.
  - **SqliteApprovalRepository:** save/get/list round-trips (real better-sqlite3, temp db).
  - **Migration v2:** fresh → v2; idempotent re-run; legacy(v1)→v2 upgrade preserves data.
  - **Boundary/dependency:** ApprovalManager imports no other capability manager; core
    `child_process`-free.
- **No live Discord smoke** (integration deferred). **SQLite verification** of the new table.

## 15. Rollback Strategy

- Mostly additive (new services + new `approvals` table + repo impl). The aggregate
  evolution is the one shape change (additive/optional fields). **Rollback = `git revert`.**
  Migration v2 is forward-only but idempotent; a reverted build simply stops using the
  `approvals` table (the table can remain harmlessly, or a down-note is documented). No
  existing-table change → no data loss.

## 16. Relationships & Aggregate Ownership

- **ExecutionPlan (CAP-003):** Approval **reads** the plan / `ExecutionPlanRef` and creates
  an `ApprovalRequest` for it. Approval **does not mutate** `ExecutionPlan` (Planning owns
  it). Approval state is authoritative on `ApprovalRequest` (Q1).
- **Patch (CAP-005):** consumes an **APPROVED** `ApprovalRequest` (via `ApprovalRef`/
  `isApproved`) before generating a `PatchSet`. Approval is upstream of Patch.
- **Workspace Write (CAP-006):** only proceeds for an approved+patched plan. Approval is the
  gate.
- **Aggregate ownership:** Approval owns `ApprovalRequest`; Planning owns `ExecutionPlan`;
  Patch owns `PatchSet`; Workspace Write owns `WorkspaceChange`. Others reference/read/consume,
  never modify. Communication via Refs.

## 17. Open Questions for Chief Architect

1. **Approval vs ExecutionPlan.status (key).** Aggregate Ownership says only Planning may
   mutate `ExecutionPlan`, but the CAP-003 lifecycle note shows `PLANNED → APPROVED`.
   **Recommend:** Approval state lives **solely on `ApprovalRequest`**; `ExecutionPlan.status`
   stays `PLANNED` (immutable post-creation); downstream reads the `ApprovalRequest` to know
   approval. Confirm?
2. **ApprovalRequest shape.** Evolve the existing V1 task-based `ApprovalRequest` to a
   plan-based aggregate (keep `taskId?` optional), or define a new type and retire the V1 one?
3. **ExecutionStatus naming.** Apply the CA rec `PENDING → PLANNED` (+ lifecycle
   PLANNED/APPROVED/PATCH_GENERATED/READY_TO_EXECUTE/EXECUTED/FAILED) now in CAP-004, or in a
   doc-refinement sprint? (CAP-004 is the natural place since it introduces APPROVED.)
4. **ApprovalPolicy depth.** v1: deterministic require/not-require from risk. Reserve
   approver/role/expiry fields, or keep strictly boolean for now?
5. **Integration.** Recommend **no** Discord UI / orchestrator wiring in 2d (domain+manager+
   persistence only; decisions fed programmatically). Wire the live approval flow in a later
   integration slice?
6. **Aggregate Ownership Rule recording.** Record it in ARCHITECTURE.md as part of CAP-004,
   or defer to the dedicated doc-refinement sprint the CA mentioned?

---

## 18. Proposed ADR-0025 — outline

> **Title:** ADR-0025 — CAP-004 Approval Capability
> **Status:** (Proposed → Accepted on approval)

- **Context:** governance gate between ExecutionPlan and execution; first persisted V2 aggregate.
- **Decision:** `ApprovalRequest` aggregate (Approval-owned) keyed to `ExecutionPlanRef`;
  deterministic `ApprovalPolicy` (reuses RiskPolicy); `ApprovalManager`; SQLite persistence +
  migration v2; Approval references but never mutates `ExecutionPlan`; approval state on
  `ApprovalRequest`; integration deferred.
- **Consequences:** + governance backbone for all writes; first real use of the migration
  runner; − aggregate evolution + a second status concept (bounded by ownership rule).
- **Capability:** CAP-004. **Relates:** ADR-0024 (Planning), ADR-0020 (migrations), ADR-0010.

## 19. Proposed `docs/capabilities/approval.md` — outline

> Purpose · Responsibilities · Out of Scope · Public API (`ApprovalManager`,
> `ApprovalPolicy`, `ApprovalRequest`/`ApprovalRef`/`ApprovalStatus`) · Future Expansion
> (Discord UI wiring, approver roles, expiry) · Boundaries (Approval ≠ Planning ≠ Patch;
> owns `ApprovalRequest`) · Related ADRs (ADR-0025, ADR-0024, ADR-0020).

---

## Next Step

Per the V2 process: **stop here and wait for Chief Architect review.** On approval I will
implement only the approved scope (domain + `ApprovalPolicy` + `ApprovalManager` +
persistence/migration), validate, and produce the Sprint 2d review. No code, commit, or
prototype until then — and Q1/Q3 in particular should be settled first.
