# Sprint 2d Review — CAP-004 Approval Capability

- **Process:** V2 architecture-first. Plan APPROVED WITH CHANGES → implemented the approved
  scope only → validated → this review. **No merge until approved.**
- **Commit message:** `feat(v2-approval): add approval request capability`
- **Branch:** `v2/approval-capability` (off `main`).

## Objective

Introduce **CAP-004 Approval**: the governance gate between an `ExecutionPlan` (CAP-003)
and any code-changing capability, and the **first persisted V2 aggregate**. Approval owns
`ApprovalRequest`, references `ExecutionPlan` (read-only), and **never mutates it**.

## Approved-change compliance (CA review)

| CA decision | Applied |
|---|---|
| Core — Approval must NOT mutate `ExecutionPlan`; aggregate ownership | ✅ Approval mutates only `ApprovalRequest`; references `executionPlanRef`; frozen-plan test proves no mutation |
| Q1 — approval state only on `ApprovalRequest`; no PLANNED→APPROVED on plan | ✅ `ExecutionPlan` untouched; state on `ApprovalRequest.status` |
| Q2 — ExecutionPlan-based; `executionPlanRef` primary; `taskId?` optional | ✅ aggregate is plan-first; `taskId?` optional compat only |
| Q3 — no `ExecutionStatus` cleanup in CAP-004 | ✅ not touched (recorded as follow-up) |
| Q4 — `ApprovalPolicy` minimal: requiresApproval/reason/riskLevel/requestedBy; reserve approverRole?/expiresAt?/policyVersion? | ✅ exactly; no role-auth/expiry |
| Q5 — no Discord UI / orchestrator wiring | ✅ domain+policy+manager+persistence only; dead V1 orchestrator branch neutralized |
| Q6 — record Aggregate Ownership Rule in ADR-0025 | ✅ verbatim statement in ADR-0025 |

Out-of-scope (none introduced): ExecutionPlan mutation, Discord UI, orchestrator wiring,
role-based auth, expiry, Patch, Workspace Write, Command Execution, git writes, AI changes.

## Scope Implemented

- **Domain:** `ApprovalRequest` aggregate (ExecutionPlan-based), `ApprovalDecision`,
  `ApprovalRef` (+ `approvalRef`), `ApprovalStatus` enum.
- **Policy:** `ApprovalPolicy.evaluate` (deterministic; reuses `RiskPolicy`).
- **Manager:** `ApprovalManager` (`requestFor`/`decide`/`get`/`isApproved`) — owns the
  aggregate; reads the plan; imports no other capability manager.
- **Persistence:** `ApprovalRepository` port (`findByExecutionPlan`) +
  `SqliteApprovalRepository`; **migration v2** (`approvals` table) via ADR-0020 runner; the
  generic `approvals` stub (+ `StubRepository`) removed.
- **Wiring:** app.module binds `ApprovalPolicy` + `ApprovalManager`. Orchestrator's dead V1
  approval branch neutralized to compile (un-wiring, not new wiring — Q5).

## Architecture Impact

- **Aggregate Ownership Rule enforced:** Approval owns `ApprovalRequest`; `ExecutionPlan`
  stays immutable (verified by a frozen-plan test).
- **First persisted V2 aggregate** — exercises the ADR-0020 migration runner for real
  (version 1 → 2; backward compatible).
- Core stays provider-agnostic and `child_process`-free; SQL stays in the adapter.
- No live behavior change (Approval is not orchestrator-wired); the only runtime effect is
  migration v2 running on init (additive, backward compatible).

## ADR Updates

- **ADR-0025 (Accepted)** — CAP-004 Approval, including the **Aggregate Ownership Rule**
  (required verbatim statement). Reconciles the V1 task-based `ApprovalRequest` to the V2
  plan-based aggregate. CURRENT_STATE + CHANGELOG updated; capability doc added.

## Validation

- `pnpm typecheck` → **PASS (exit 0)**.
- `pnpm test` → **22 files / 118 tests PASS** (+11):
  - **ApprovalPolicy:** requires approval for HIGH/CRITICAL; not for LOW/MEDIUM.
  - **ApprovalManager:** PENDING for HIGH plan; auto-APPROVED for LOW; `decide`
    approve/reject + fields; throws on missing/already-decided; `isApproved`; **NEVER
    mutates the ExecutionPlan** (frozen-plan test).
  - **SqliteApprovalRepository:** save/get round-trip, `findByExecutionPlan`, upsert —
    over a real DB (exercises migration v2).
  - **Migration v2:** `approvals` table created; `LATEST_SCHEMA_VERSION === 2`; legacy
    upgrade preserved (existing migration tests).
- **Boundary/dependency:** ApprovalManager/Policy import no other capability manager; core
  `child_process`-free; no adapter imports; `StubRepository` removed.
- **No live Discord smoke** (per CA). **SQLite verification:** new `approvals` table + repo.

## Remaining Risks

- Approval and plan state live in separate aggregates (by design) — consumers read both.
- Auto-approval when policy requires none is a deterministic convenience; a stricter
  always-PENDING mode is a future option.

## Technical Debt

- **Future (own ADRs/slices):** Discord approval UI + orchestrator wiring; approver roles /
  expiry / policy versioning; per-step approval; `ExecutionStatus` PLANNED-lifecycle
  alignment (Q3); Aggregate Ownership Rule in ARCHITECTURE.md.

## Deliverables

`git status`, `git log --oneline -3`, `git show --stat --oneline HEAD`, `pnpm typecheck`,
`pnpm test` reported alongside this review.

**Awaiting Chief Architect review. No merge until approved.**
