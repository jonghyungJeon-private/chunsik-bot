# Capability — Approval (CAP-004)

> V2 is capability-driven. Lightweight doc for the **Approval** capability.
> Authority: `DECISIONS.md` (ADR-0025). Shared contract: `docs/execution-plan.md`.

## Purpose

The **governance gate** between a deterministic `ExecutionPlan` (CAP-003) and any
code-changing capability. Approval decides whether a plan may proceed and records the
human decision — the first **persisted** V2 aggregate.

```
Planning → ExecutionPlan → [Approval] → Patch → Workspace Write → Command Execution
```

## Responsibilities

- Own the **`ApprovalRequest`** aggregate (the only thing Approval mutates).
- `ApprovalPolicy.evaluate(plan, requestedBy)` — deterministic require/not-require
  (reuses `RiskPolicy`; HIGH/CRITICAL ⇒ approval).
- `ApprovalManager`: `requestFor(plan, requestedBy)` (auto-APPROVED when none needed, else
  PENDING), `decide(id, decision)`, `get(id)`, `isApproved(executionPlanId)`.
- Persist via `ApprovalRepository` / `SqliteApprovalRepository` (migration v2).

## Out of Scope

- ❌ **Mutating `ExecutionPlan`** — Approval references it (`executionPlanRef`) and never
  modifies it. Approval state lives only on `ApprovalRequest`.
- ❌ Role-based authorization, expiry enforcement (reserved fields only).
- ❌ Discord approval UI / orchestrator wiring / live approval flow (deferred).
- ❌ Patch, Workspace Write, Command Execution, AI/provider changes, git writes.

## Public API

- `ApprovalManager` (`requestFor`/`decide`/`get`/`isApproved`) · `ApprovalPolicy`
  (`evaluate`).
- Domain: `ApprovalRequest` (aggregate), `ApprovalDecision` (input), `ApprovalRef`,
  `ApprovalStatus` (PENDING/APPROVED/REJECTED).
- Port: `ApprovalRepository` (`findByExecutionPlan`) → `SqliteApprovalRepository`.
- **Persisted fields:** id, executionPlanRef, status, riskLevel, reason, requestedBy,
  decision?, decidedBy?, decidedAt?, comment?, createdAt, updatedAt (taskId? optional v1 compat).

## Future Expansion

- Discord approval UI + orchestrator wiring (live approval flow).
- Approver roles / expiry / policy versioning (reserved fields).
- Per-step approval (each `ExecutionStep` has its own status).

## Boundaries (Aggregate Ownership Rule — ADR-0025)

> Each capability owns exactly one aggregate. Only the owner may mutate it; others
> reference/read/consume but never modify.

- **Approval owns `ApprovalRequest`.** It references `ExecutionPlanRef` and must **not**
  mutate `ExecutionPlan` (owned by Planning).
- Approval ≠ Planning ≠ Patch ≠ Workspace Write. Compose via Refs.

## Related ADRs

- **ADR-0025** — CAP-004 Approval (primary; includes the Aggregate Ownership Rule).
- ADR-0024 — Planning / ExecutionPlan. ADR-0020 — SQLite migration runner. ADR-0010.
