# Capability — Workspace Write (CAP-006)

> V2 is capability-driven. Lightweight doc for the **Workspace Write** capability.
> Authority: `DECISIONS.md` (ADR-0027). Shared contract: `docs/execution-plan.md`.

## Purpose

Apply an **approved**, immutable `PatchSet` (CAP-005) to the workspace filesystem and
record **what happened** as a `WorkspaceChange` — the **Execution History** aggregate.
The first capability that mutates the filesystem.

```
Planning → Approval → Patch → [Workspace Write: apply PatchSet → WorkspaceChange] → Command Execution
```

> **Patch generates. Workspace Write applies.** Never merged.

## Responsibilities

- Own the **`WorkspaceChange`** aggregate (the only thing it mutates).
- `WorkspaceWriteManager.apply({ patchSet, approvalRef, workspaceRef })`:
  - Approval gate (Ref only): `status === APPROVED` **and** `approvalRef.executionPlanRef.id
    === patchSet.executionPlanRef.id`. No `ApprovalManager` query.
  - Idempotency (status-based): one `WorkspaceChange` per `PatchSet`; `APPLIED` → no-op.
  - **Best-effort**: attempt every operation, record a `FileChangeResult` per file, derive
    the final status.
- Delegate file application to the **`WorkspaceWriter`** port (atomic unit = file).
- Persist via `WorkspaceChangeRepository` / `SqliteWorkspaceChangeRepository` (migration v4).

## Out of Scope

- ❌ **Generating** patches (CAP-005), Approval (CAP-004), Planning (CAP-003).
- ❌ **Git / commit / repository mutation** (Repository-Independent), command execution (CAP-007), AI.
- ❌ Mutating `PatchSet` / `ExecutionPlan` / `ApprovalRequest` (references only).
- ❌ **Rollback** (future capability — may use the Git capability) and **Resume** (records
  only; no resume engine). `child_process`.

## Public API

- `WorkspaceWriteManager` (`apply`/`get`/`findByPatchSet`).
- Port `WorkspaceWriter` (`applyOperation(ref, op) → FileChangeResult`; token `WORKSPACE_WRITER`;
  adapter `LocalWorkspaceWriter` in `workspace-local`, `node:fs` + jsdiff `applyPatch`).
- Domain: `WorkspaceChange` (aggregate, **Execution History**; carries `patchHash` — the
  applied PatchSet's content revision), `WorkspaceChangeRef`, `WorkspaceChangeStatus`
  (`PENDING|APPLYING|APPLIED|PARTIALLY_APPLIED|FAILED`), `FileChangeResult`
  (`{ path, operation, status, message, durationMs }`), `ApplyInput`.
- **Patch revision contract:** `WorkspaceChange.patchHash` records exactly which PatchSet
  revision (content hash of its operations) was applied. Same revision re-run → idempotent;
  a different revision for the same PatchSet id is refused (no cross-revision reuse).
- **Atomic unit = file** (temp-write + rename / unlink); best-effort across files.

## Future Expansion

- **Rollback capability** (separate; may compose the Git capability) — `WorkspaceChange`
  records precise per-file state + `patchHash` as its input. Reserved: a `ROLLBACK_REQUIRED`
  status (added when Rollback lands — not now).
- **Resume** of an interrupted apply; `FileChangeResult` kept open for future
  `startedAt`/`finishedAt`.
- CAP-007 Command Execution may consume `WorkspaceChange` as Execution History.

## Boundaries (Aggregate Ownership Rule — ADR-0025)

- **Workspace Write owns `WorkspaceChange`.** References `PatchRef`/`executionPlanRef`/
  `approvalRef`/`WorkspaceRef`; mutates none of them. PatchSet is consumed immutably.
- Workspace Write ≠ Git ≠ Patch ≠ Approval ≠ Planning ≠ Command Execution ≠ AI Provider.

## Related ADRs

- **ADR-0027** — CAP-006 Workspace Write (primary; "apply, not generate").
- ADR-0026 (Patch) · ADR-0025 (Approval + Aggregate Ownership) · ADR-0022 (Workspace diff) ·
  ADR-0020 (SQLite migrations).
