# Sprint 2f Review — CAP-006 Workspace Write Capability

- **Process:** V2 architecture-first. Planning APPROVED WITH CHANGES → plan updated with the
  CA's 5 changes → implemented the approved scope → validated → this review. **No merge until
  approved.**
- **Commit message:** `feat(v2-workspace-write): apply approved patch sets to the workspace`
- **Branch:** `v2/workspace-write-capability` (off `main`).

## Objective

Apply an **approved**, immutable `PatchSet` to the workspace filesystem and record the
outcome as a `WorkspaceChange` (Execution History). **Workspace Write applies; it never
generates** (Patch generates). First filesystem-mutating capability.

## CA Planning-review changes — all applied

| CA change | Applied |
|---|---|
| 1. Best-effort (NOT stop-on-first-failure) | ✅ every op attempted; per-file `FileChangeResult`; final status derived (test: writer called for all ops despite a failure) |
| 2. Idempotency by `WorkspaceChange.status` | ✅ one change per PatchSet; `APPLIED` → no-op; FAILED/PARTIALLY/APPLYING → re-attempt |
| 3. Status set PENDING/APPLYING/APPLIED/PARTIALLY_APPLIED/FAILED | ✅ exact enum |
| 4. Atomic unit = File | ✅ `LocalWorkspaceWriter` temp-write+rename / unlink per file; PatchSet not a transaction |
| 5. `FileChangeResult = { path, operation, status, message, durationMs }` | ✅ exact VO |

## CA Planning questions (Q1–Q10) — honored

- **Aggregate Ownership (Q1):** owns only `WorkspaceChange`; never mutates PatchSet/
  ExecutionPlan/ApprovalRequest (frozen-PatchSet test).
- **Apply Flow (Q2):** PatchSet → WorkspaceChange → WorkspaceWriter; writer never generates.
- **Approval (Q3):** Ref-only check (APPROVED + `executionPlanRef.id` match); no `ApprovalManager`.
- **Idempotency (Q4):** status-based (above).
- **Partial Failure (Q5):** best-effort → `PARTIALLY_APPLIED` with per-file results.
- **Rollback (Q6) / Resume (Q7):** **not** in CAP-006 (future capability / records only) — confirmed.
- **Repository Independence (Q8):** **no git, no commit, no child_process** in Workspace Write
  (the only `spawnSync` in `workspace-local` is the pre-existing CAP-001 `scanProject` probe).
- **Patch Contract (Q9):** PatchSet read-only & immutable.
- **Architecture Impact (Q10):** `WorkspaceChange` is the Execution-History start point CAP-007
  Command Execution may consume.

## Scope Implemented

- **Domain:** `WorkspaceChange`, `WorkspaceChangeRef` (+ `workspaceChangeRef`),
  `FileChangeResult`, `ApplyInput`; `WorkspaceChangeStatus` enum.
- **Core:** `WorkspaceWriteManager` (`apply`/`get`/`findByPatchSet`) — owns the aggregate;
  imports no capability manager; no git.
- **Port/Adapter:** `WorkspaceWriter` (`WORKSPACE_WRITER`) + `LocalWorkspaceWriter` in
  `workspace-local` (`node:fs` + jsdiff `applyPatch`, atomic per file, sandboxed).
- **Persistence:** `WorkspaceChangeRepository` + `SqliteWorkspaceChangeRepository` + migration v4.
- **Wiring:** app.module binds `WORKSPACE_WRITER` + `WorkspaceWriteManager`. Not orchestrator-wired.

## Architecture Impact

- Aggregate Ownership + Referential Integrity (ADR-0025) upheld; **Repository-Independent**.
- Core stays provider-agnostic and `child_process`-free; all fs in the adapter.
- 4th persisted aggregate — migration runner now at v4; no live behavior change.

## ADR Updates

- **ADR-0027 (Accepted)** — CAP-006 Workspace Write; the 5 Round-2 changes + Q1–Q10; "apply,
  not generate"; Rollback/Resume deferred. CURRENT_STATE + CHANGELOG updated; capability doc added.

## Validation

- `pnpm typecheck` → **PASS (exit 0)**.
- `pnpm test` → **27 files / 144 tests PASS** (+15):
  - **Manager:** APPLIED on full success; approval + plan-scope rejection; **best-effort**
    (all ops attempted) → PARTIALLY_APPLIED; all-fail → FAILED; **status-idempotency** (no-op,
    writer not called); **no PatchSet mutation** (frozen).
  - **Writer (real fs + jsdiff):** add (nested dir) / update / delete; **conflict → failed**
    (file unchanged); **binary → skipped**; **sandbox** rejects `../escape`.
  - **Repository:** round-trip + `findByPatchSet`; **migration v4** (`workspace_changes`).
- **Boundary/dependency:** WorkspaceWriteManager imports only domain/ports/util; no git/other
  manager; core `child_process`-free; writer uses `node:fs`+jsdiff only.
- **No live Discord smoke** (per CA). **SQLite verification:** `workspace_changes` + repo.

## Remaining Risks

- Multi-file apply is not atomic (file is the atomic unit); partial state recorded precisely
  for a future Rollback capability + the clean-tree precondition (composed via GitManager).
- Unified-diff apply conflicts surface as `failed` results (no force).

## Technical Debt

- **Future (own ADRs/slices):** Rollback capability (may use Git), Resume, CAP-007 Command
  Execution consuming `WorkspaceChange`; relocate the CAP-001 `scanProject` git probe to the
  Git capability (recorded since CAP-002).

## Deliverables

`git status`, `git log --oneline -3`, `git show --stat --oneline HEAD`, `pnpm typecheck`,
`pnpm test` reported alongside this review.

**Awaiting Chief Architect review. No merge until approved.**
