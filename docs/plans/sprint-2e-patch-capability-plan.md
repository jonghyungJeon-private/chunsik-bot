# Sprint 2e Implementation Plan — CAP-005 Patch Capability

- **Status:** 🟡 PLAN ONLY — awaiting Chief Architect review. No code, no commit, no
  prototype. No existing source file modified.
- **Capability:** **CAP-005 — Patch** (canonical roadmap: after Approval, before Workspace Write).
- **Date:** 2026-06-29
- **Process:** V2 architecture-first, Step 1 (Implementation Plan). Plan → review →
  approval → implementation. Do not bypass the planning gate.

---

## 1. Objective

Introduce **CAP-005 Patch**: turn an **approved** `ExecutionPlan` + a set of proposed file
changes (with their `WorkspaceDiff`) into a durable, reviewable, applyable **`PatchSet`**
aggregate. Patch **generates** patches; it does **not** apply them (Workspace Write, CAP-006,
applies). Patch never writes files or touches git.

```
Planning → ExecutionPlan → Approval → [Patch → PatchSet] → Workspace Write (applies) → Command Execution
```

## 2. Scope (proposed minimal safe scope)

- **`PatchSet` aggregate (Patch-owned)** of `PatchOperation`s, referencing the
  `ExecutionPlanRef` it implements and the `ApprovalRef` that authorized it.
- **`PatchManager.generate(input)`** — deterministic: **requires an APPROVED `ApprovalRef`**
  (else throws), builds `PatchOperation`s by merging `ProposedChange`s (path + newContent)
  with their `WorkspaceDiff` (CAP-001), and persists the `PatchSet`. Plus `get` /
  `findByExecutionPlan`.
- **Persistence:** `PatchRepository` port (`findByExecutionPlan`) + `SqlitePatchRepository`
  + **migration v3** (`patches` table) via the ADR-0020 runner.
- **Generation only.** No application, no file/git writes (Q — see §16; recommend Patch
  owns ONLY generation).
- Tests (domain + manager + repository + migration) + capability doc + ADR-0026.

## 3. Out of Scope (explicit)

- ❌ **Patch application** / file writes / git writes — that is CAP-006 Workspace Write.
- ❌ Mutating `ExecutionPlan` or `ApprovalRequest` (Aggregate Ownership Rule — references only).
- ❌ Generating the underlying diff (that is CAP-001 `WorkspaceManager.diff`; Patch
  consumes the resulting `WorkspaceDiff`).
- ❌ Producing the proposed changes (a future AI/coding step; Patch consumes `ProposedChange[]`).
- ❌ Command Execution, Codex/Ollama, AI/provider changes, Discord UI, orchestrator wiring.

## 4. Architecture Impact

- **Aggregate Ownership Rule (ADR-0025).** Patch owns `PatchSet`; it **references**
  `ExecutionPlanRef`/`ApprovalRef` and never mutates those aggregates.
- **Composition by inputs / Refs.** `PatchManager` imports **no** capability manager
  (no WorkspaceManager/ApprovalManager/PlanningManager). The caller composes: AI →
  `ProposedChange[]` → `WorkspaceManager.diff` → `WorkspaceDiff` → (verify approved) →
  `PatchManager.generate`. Patch imports only **domain types** (`ProposedChange`,
  `WorkspaceDiff`/`FileDiff`, `ExecutionPlanRef`, `ApprovalRef`, `DiffChangeKind`).
- **Deterministic + no I/O beyond persistence.** Generation is pure data assembly; the only
  side effect is persisting the `PatchSet` (SQLite). Core stays `child_process`-free.
- **Second persisted aggregate** — reuses the ADR-0020 migration runner (migration v3).

## 5. ADR Impact

- **New ADR-0026 — CAP-005 Patch Capability.** Records: `PatchSet` aggregate (Patch-owned)
  + `PatchOperation`/`PatchRef`/`PatchStatus`; **generation-only** (application is CAP-006);
  requires APPROVED approval to generate (risk/approval interaction); references but never
  mutates ExecutionPlan/ApprovalRequest; consumes `WorkspaceDiff`; persistence + migration v3.
- Reaffirms the Aggregate Ownership Rule (ADR-0025). (Outline in §18.)

## 6. Capability ID Usage

**CAP-005** referenced in ADR-0026, the Sprint 2e review, CHANGELOG, CURRENT_STATE,
`docs/capabilities/patch.md`, and this plan.

## 7. Files Likely to Be Modified / Created (plan-only — none touched yet)

**New:**
| Path | Purpose |
|---|---|
| `packages/core/src/domain/patch.ts` | `PatchSet`, `PatchOperation`, `PatchRef` (+ `patchRef`), `PatchGenerationInput`. |
| `packages/core/src/application/patch-manager.ts` | `PatchManager` (owns PatchSet; generation only). |
| `packages/core/src/application/patch-manager.test.ts` | Manager tests. |
| `packages/storage-sqlite/src/patch-repository.test.ts` | Repository + migration v3 tests. |
| `docs/capabilities/patch.md` | Capability doc. |

**Modified:**
| Path | Change |
|---|---|
| `packages/core/src/domain/enums.ts` | `PatchStatus`. |
| `packages/core/src/domain/index.ts` | Export `patch`. |
| `packages/core/src/ports/storage-provider.port.ts` | `PatchRepository` + `patches` on StorageProvider. |
| `packages/core/src/application/index.ts` | Export `PatchManager`. |
| `packages/storage-sqlite/src/index.ts` | `SqlitePatchRepository` + wire in `init()`. |
| `packages/storage-sqlite/src/migrations.ts` | **Migration v3:** `patches` table. |
| `packages/storage-sqlite/src/migrations.test.ts` | Migration v3 assertions. |
| `apps/chunsik/src/app.module.ts` | Wire `PatchManager`. |
| `DECISIONS.md`, `CURRENT_STATE.md`, `CHANGELOG.md` | ADR-0026 + status. |

*No new package; no platform/orchestrator wiring.*

## 8. New Domain Concepts

- **`PatchStatus`** (enum): `GENERATED` (the only state Patch sets). Application/outcome state
  lives on CAP-006's `WorkspaceChange`, not here (Q1 — mirrors Approval/ExecutionPlan).
- **`PatchOperation`** — `{ path: string; operation: DiffChangeKind; newContent?: string;
  unifiedDiff: string; binary: boolean }`. Carries both what to write (`newContent`) and what
  it looks like (`unifiedDiff`, reused from CAP-001 `FileDiff`).
- **`PatchSet`** (aggregate) — `{ id; executionPlanRef: ExecutionPlanRef; approvalRef:
  ApprovalRef; operations: PatchOperation[]; estimatedChangedLines: number;
  status: PatchStatus; createdAt; updatedAt }`.
- **`PatchRef`** — `{ id; status: PatchStatus }` (sibling Ref).
- **`PatchGenerationInput`** — `{ executionPlanRef; approvalRef; changes: ProposedChange[];
  diff: WorkspaceDiff }`.

Reuses existing `DiffChangeKind`, `ProposedChange`, `WorkspaceDiff`/`FileDiff` (CAP-001),
`ExecutionPlanRef` (CAP-003), `ApprovalRef`/`ApprovalStatus` (CAP-004).

## 9. Ports Affected

- **`PatchRepository`** (new, on StorageProvider) — `Repository<PatchSet>` +
  `findByExecutionPlan(executionPlanId)`. No other new port (no infrastructure beyond persistence).

## 10. Adapters Affected

- **`storage-sqlite`** — `SqlitePatchRepository` + migration v3 (`patches` table:
  `id TEXT PK`, `execution_plan_id TEXT`, `status TEXT NOT NULL`, `data TEXT NOT NULL`).

## 11. Blast Radius

- **Compile-time:** additive — new domain module, manager, port method, repo impl, wiring.
  No change to existing capability signatures.
- **Runtime:** Patch is not orchestrator-wired → near-zero live impact; migration v3 runs on
  init (additive, backward compatible).
- **Data:** new `patches` table (migration v3). No change to existing tables.
- Net: **Low–Medium** (second persisted aggregate; no live caller).

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Patch drifting into application (file writes) | **High (boundary)** | Generation-only; `PatchManager` performs no fs/git I/O; application is CAP-006 (§16). |
| Generating a patch without approval | Med | `generate` **requires** `approvalRef.status === APPROVED`, else throws (deterministic, no import). |
| Mismatch between `changes` and `diff` inputs | Med | Validate every `ProposedChange` has a matching `FileDiff` (by path); reject otherwise. |
| Large patches / binary files | Low | Reuse CAP-001 size/binary flags from `WorkspaceDiff`; carry `binary`/`estimatedChangedLines`. |
| Mutating ExecutionPlan/ApprovalRequest | Med | References only (Refs); never loads/mutates those aggregates. |

## 13. Security Considerations

- No fs/git/child_process/network — generation is pure data assembly; only persistence I/O.
- `PatchOperation.newContent` may contain code — stored as data; no secrets are read/derived;
  no remote/credential surface. SQL stays parameterized in the adapter.
- Patch cannot apply anything — the dangerous step (writing) is gated downstream (CAP-006 +
  the approval Patch references).

## 14. Validation Strategy

- `pnpm typecheck`; `pnpm test`:
  - **PatchManager:** `generate` requires APPROVED approval (throws otherwise); builds one
    `PatchOperation` per change merged with its `FileDiff`; computes `estimatedChangedLines`;
    persists a `GENERATED` `PatchSet`; rejects change/diff path mismatch; **never mutates the
    ExecutionPlan/ApprovalRequest** (frozen-input test).
  - **SqlitePatchRepository:** save/get round-trip, `findByExecutionPlan` (real DB; exercises
    migration v3).
  - **Migration v3:** `patches` table created; `LATEST_SCHEMA_VERSION === 3`; legacy upgrade.
  - **Boundary/dependency:** PatchManager imports no capability manager; core `child_process`-free.
- **No live smoke** (not wired). **SQLite verification** of the `patches` table.

## 15. Rollback Strategy

- Additive (new domain + manager + `patches` table + repo impl). **Rollback = `git revert`.**
  Migration v3 is forward-only but idempotent; a reverted build stops using `patches`. No
  existing-table change → no data loss.

## 16. Determinations the CA asked for

- **Patch owns only GENERATION, not application (recommended).** Application = CAP-006
  Workspace Write (owns `WorkspaceChange`, performs writes behind the clean-tree guard +
  approval). Keeps Patch ≠ Workspace Write and matches the roadmap.
- **Relationship with `ExecutionPlan`:** `PatchSet` references `executionPlanRef`; reads,
  never mutates (Planning owns it).
- **Relationship with `ApprovalRequest`:** generation **requires** an APPROVED `ApprovalRef`;
  `PatchSet` records it. Patch never mutates the approval.
- **Relationship with `WorkspaceDiff`:** Patch **consumes** a `WorkspaceDiff` (CAP-001) as the
  diff source; it does not recompute diffs. `PatchOperation` merges the `FileDiff` with the
  `ProposedChange`'s `newContent`.
- **Persistence:** second persisted aggregate — `PatchRepository` + `SqlitePatchRepository` +
  migration v3 (ADR-0020 runner).
- **Risk & approval interaction:** generation is no-write ⇒ LOW risk; it is gated on the
  approval it references. The HIGH-risk action (applying) is CAP-006, gated by the same approval.
- **Boundaries with Workspace Write:** Patch produces `PatchSet` (data); Workspace Write
  consumes `PatchRef`/`PatchSet` (reads) and performs the writes (owns `WorkspaceChange`).
  Neither mutates the other's aggregate.

## 17. Aggregate Ownership

Patch owns `PatchSet`. References `ExecutionPlanRef` + `ApprovalRef` (read-only). Owners:
Planning→ExecutionPlan, Approval→ApprovalRequest, **Patch→PatchSet**, Workspace
Write→WorkspaceChange, Command Execution→CommandExecution.

## 18. Open Questions for Chief Architect

1. **Generation-only (confirm).** Patch owns only patch generation; application is CAP-006.
   (Recommended.)
2. **`PatchStatus` set.** v1 `GENERATED` only (application/outcome state lives on
   `WorkspaceChange`, mirroring the Approval/ExecutionPlan ownership decision). Reserve more?
3. **Approval enforcement in Patch.** `generate` rejects a non-APPROVED `ApprovalRef`
   (deterministic check on the passed Ref, no ApprovalManager import). Acceptable, or should
   enforcement live entirely in the composing layer?
4. **Input shape.** Patch consumes `{ changes: ProposedChange[], diff: WorkspaceDiff }` and
   merges them, or should it consume a single pre-merged structure prepared by the caller?
5. **Persistence fields / migration v3** — confirm the `patches` columns
   (`id`, `execution_plan_id`, `status`, `data`).

---

## 19. Proposed ADR-0026 — outline

> **Title:** ADR-0026 — CAP-005 Patch Capability (generate, not apply)
> **Status:** (Proposed → Accepted on approval)

- **Context:** the approved plan must become a concrete, reviewable, applyable patch before
  any write; that unit is the `PatchSet`.
- **Decision:** `PatchSet` aggregate (Patch-owned); generation-only; requires APPROVED
  approval; consumes `WorkspaceDiff`; references ExecutionPlan/Approval (no mutation);
  persistence + migration v3. Application is CAP-006.
- **Consequences:** + clean Patch/Write separation; reuses Workspace diff + the migration
  runner; − a third status concept (bounded by ownership: outcome lives on `WorkspaceChange`).
- **Capability:** CAP-005. **Relates:** ADR-0022 (WorkspaceDiff), ADR-0024 (Plan), ADR-0025
  (Approval + Aggregate Ownership), ADR-0020 (migrations).

## 20. Proposed `docs/capabilities/patch.md` — outline

> Purpose · Responsibilities · Out of Scope (no application) · Public API (`PatchManager`,
> `PatchSet`/`PatchOperation`/`PatchRef`/`PatchStatus`) · Future Expansion (patch revisions,
> conflict detection) · Boundaries (Patch ≠ Workspace Write; owns `PatchSet`) · Related ADRs.

---

## Next Step

Per the V2 process: **stop here and wait for Chief Architect review.** On approval I will
implement only the approved scope (domain + `PatchManager` + persistence/migration v3),
validate, and produce the Sprint 2e review. No code, commit, or prototype until then.
