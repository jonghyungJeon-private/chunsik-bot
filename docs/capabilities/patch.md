# Capability — Patch (CAP-005)

> V2 is capability-driven. Lightweight doc for the **Patch** capability.
> Authority: `DECISIONS.md` (ADR-0026). Shared contract: `docs/execution-plan.md`.

## Purpose

Turn an **approved** `ExecutionPlan`'s proposed changes into a durable, reviewable,
**immutable** `PatchSet` — the unit Workspace Write later applies.

```
Planning → Approval → [Patch → PatchSet] → Workspace Write (applies) → Command Execution
```

> **Patch generates. Workspace Write applies.** These must never be merged.

## Responsibilities

- Own the **`PatchSet`** aggregate (`PatchOperation[]`, immutable after creation).
- `PatchManager.generate(input)` — requires an **APPROVED** `ApprovalRef`; merges
  `changes: ProposedChange[]` with their `diff: WorkspaceDiff` (received independently) into
  `PatchOperation`s; persists a `GENERATED` `PatchSet`. Plus `get` / `findByExecutionPlan`.
- Persist via `PatchRepository` / `SqlitePatchRepository` (migration v3).

## Out of Scope

- ❌ **Applying** patches, writing files, `git apply`/`commit`, workspace mutation, rollback.
- ❌ Owning filesystem / repository / execution / approval.
- ❌ Mutating `ExecutionPlan` or `ApprovalRequest` (references only).
- ❌ Querying `ApprovalManager` (approval validated on the passed `ApprovalRef`).
- ❌ Generating the diff (CAP-001) or the proposed changes (a future AI step); AI/provider
  integration; command execution.

## Public API

- `PatchManager` (`generate`/`get`/`findByExecutionPlan`).
- Domain: `PatchSet` (aggregate), `PatchOperation` (`{ path, operation: add/update/delete,
  diff, metadata? }`), `PatchRef`, `PatchStatus` (`GENERATED` only), `PatchGenerationInput`.
- Port: `PatchRepository` (`findByExecutionPlan`) → `SqlitePatchRepository`.
- **Persisted fields:** id (PatchRef), executionPlanRef, approvalRef, operations[], status,
  createdAt — nothing more (`PatchSet` is immutable).

## Future Expansion

- Patch revisions / supersession; conflict detection; richer `metadata`.
- (Application is **not** here — it is CAP-006 Workspace Write.)

## Boundaries (Aggregate Ownership Rule — ADR-0025)

- **Patch owns `PatchSet`.** It references `ExecutionPlanRef` + `ApprovalRef` and must not
  mutate those aggregates. Workspace Write consumes the `PatchSet` as an **immutable** input
  and must never regenerate or reinterpret it.
- Patch ≠ Workspace Write ≠ Approval ≠ Planning. Compose via Refs.

## Related ADRs

- **ADR-0026** — CAP-005 Patch (primary; "generate, never apply").
- ADR-0022 (WorkspaceDiff) · ADR-0024 (ExecutionPlan) · ADR-0025 (Approval + Aggregate
  Ownership) · ADR-0020 (SQLite migrations).
