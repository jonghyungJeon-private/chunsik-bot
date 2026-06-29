# Sprint 2e Review — CAP-005 Patch Capability

- **Process:** V2 architecture-first. Plan APPROVED WITH CHANGES → implemented the approved
  scope only → validated → this review. **No merge until approved.**
- **Commit message:** `feat(v2-patch): add patch generation capability`
- **Branch:** `v2/patch-capability` (off `main`).

## Objective

Introduce **CAP-005 Patch**: turn an approved plan's proposed changes into a durable,
reviewable, **immutable** `PatchSet`. **Patch generates; it never applies** — Workspace
Write (CAP-006) applies. A permanent architectural separation.

## Approved-change compliance (CA review)

| CA decision | Applied |
|---|---|
| Core — Patch represents modifications, never performs them; Workspace Write owns mutation | ✅ generation only; no fs/git writes (verified) |
| Q1 — generation only; never applies; never modifies files | ✅ `PatchManager.generate` only; no I/O beyond persistence |
| Q2 — `PatchStatus` = `GENERATED` only (no APPLIED/FAILED/EXECUTED) | ✅ single-value enum |
| Q3 — validate APPROVED `ApprovalRef`, but do NOT query `ApprovalManager` | ✅ deterministic check on the passed Ref; no manager import |
| Q4 — `changes` + `diff` received independently (not pre-merged) | ✅ separate inputs in `PatchGenerationInput`; merged inside the manager |
| Q5 — persist exactly id/executionPlanRef/approvalRef/operations/status/createdAt | ✅ `PatchSet` is immutable (no `updatedAt`/extra fields) |
| `PatchOperation` = path/operation(add/update/delete)/diff/metadata? | ✅ value object; `modify`→`update`; unified `diff`, no `newContent` |
| Aggregate Ownership | ✅ Patch owns `PatchSet`; references `ExecutionPlanRef`/`ApprovalRef`, never mutates |

Out-of-scope (none introduced): patch application, file writing, git apply/commit, workspace
mutation, execution, rollback, AI integration, command execution.

## Scope Implemented

- **Domain:** `PatchSet` (aggregate, immutable), `PatchOperation` (+ `PatchOperationKind`),
  `PatchRef` (+ `patchRef`), `PatchGenerationInput`; `PatchStatus` enum (`GENERATED`).
- **Manager:** `PatchManager` (`generate`/`get`/`findByExecutionPlan`) — owns the aggregate;
  validates APPROVED `ApprovalRef`; merges `changes`+`diff`; imports no capability manager.
- **Persistence:** `PatchRepository` port + `SqlitePatchRepository`; **migration v3**
  (`patches` table) via the ADR-0020 runner.
- **Wiring:** app.module binds `PatchManager`. Not orchestrator/Discord wired.

## Architecture Impact

- **Patch ≠ Workspace Write (permanent).** Patch produces an immutable `PatchSet`; Workspace
  Write will consume it exactly as produced (no regenerate/reinterpret).
- **Aggregate Ownership Rule (ADR-0025):** Patch owns `PatchSet`; reads ExecutionPlan/
  Approval via Refs; never mutates them (frozen-Ref test).
- Core stays provider-agnostic and `child_process`-free; Patch does no I/O beyond persistence.
- Third persisted V2 aggregate — reuses the migration runner (v3); no live behavior change.

## ADR Updates

- **ADR-0026 (Accepted)** — CAP-005 Patch: "generate, never apply"; the 5 decisions;
  `PatchOperation` shape; persistence + migration v3; aggregate ownership; immutability for
  downstream. CURRENT_STATE + CHANGELOG updated; capability doc added.

## Validation

- `pnpm typecheck` → **PASS (exit 0)**.
- `pnpm test` → **24 files / 127 tests PASS** (+9):
  - **PatchManager:** generates `GENERATED` PatchSet (one op per change); `modify`→`update`
    + unified diff carried; **requires APPROVED ApprovalRef** (rejects PENDING/REJECTED);
    diff/change mismatch throws; binary metadata; persistence (`get`/`findByExecutionPlan`);
    **never mutates Ref inputs** (frozen-Ref aggregate-ownership test).
  - **SqlitePatchRepository:** save/get round-trip, `findByExecutionPlan` (real DB; exercises
    migration v3).
  - **Migration v3:** `patches` table created; `LATEST_SCHEMA_VERSION === 3`; fresh + legacy.
- **Boundary/dependency:** PatchManager imports only domain + ports + util; no capability
  manager; core `child_process`-free; no adapter imports; no fs/git/exec in Patch.
- **No live Discord smoke** (per CA). **SQLite verification:** `patches` table + repo.

## Remaining Risks

- `PatchSet` carries unified diffs (not raw content); Workspace Write applies the diff —
  apply-time conflicts are a CAP-006 concern.
- v1 builds operations 1:1 from changes↔diff; multi-strategy generators are future work.

## Technical Debt

- **Future (own ADRs/slices):** CAP-006 Workspace Write (applies `PatchSet`); patch
  revisions / conflict detection; orchestrator wiring; the deferred items (ExecutionStatus
  cleanup, Aggregate Ownership Rule in ARCHITECTURE.md).

## Deliverables

`git status`, `git log --oneline -3`, `git show --stat --oneline HEAD`, `pnpm typecheck`,
`pnpm test` reported alongside this review.

**Awaiting Chief Architect review. No merge until approved.**
