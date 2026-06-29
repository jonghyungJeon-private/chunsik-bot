# Sprint 2c Implementation Plan — CAP-003 Planning Capability

- **Status:** 🟡 PLAN ONLY — awaiting Chief Architect review. No code, no commit, no
  prototype. No existing source file modified.
- **Capability:** **CAP-003 — Planning** (revised roadmap: Planning now precedes Approval).
- **Date:** 2026-06-29
- **Process:** V2 architecture-first, Step 1 (Implementation Plan). Plan → review →
  approval → implementation. Do not bypass the planning gate.

---

## 1. Objective

Introduce **CAP-003 Planning**: produce a **deterministic, read-only `ExecutionPlan`**
domain object *before* any approval or code modification exists. Planning turns a goal
(+ read-only project/repo context) into a structured, reviewable blueprint that the
downstream capabilities consume:

```
Planning → ExecutionPlan → Approval (CAP-004) → Patch (CAP-005) → Workspace Write (CAP-006)
```

Planning **does not execute anything**: no file writes, no git writes, no patch
generation, no command execution, no approval. It produces only an `ExecutionPlan`.

## 2. Scope (proposed minimal safe scope)

- **New domain object `ExecutionPlan`** (+ supporting VOs) — the durable contract that
  Approval/Patch reference by `id`. It captures everything "Planning owns":
  goal, required capabilities, target files, risks, estimated impact, expected artifacts,
  approval requirement, high-level execution steps.
- **New core application service `PlanningManager`** — `plan(request): ExecutionPlan`.
  **Deterministic** assembly from a `PlanningRequest` + read-only context, reusing the
  existing **`RiskPolicy`** for risk/approval derivation. No AI in v1 (see Q1).
- **Composition by inputs:** `PlanningManager` receives the goal and any pre-gathered
  read-only context (candidate target files, git-clean flag) in the `PlanningRequest`. It
  does **not** import `WorkspaceManager`/`GitManager` (keeps the capability decoupled and
  independently testable). The caller composes CAP-001/CAP-002 reads into the request.
- **No new port / adapter** — Planning is pure computation over domain inputs; it touches
  no infrastructure (no fs, no git, no child_process, no DB).
- Tests (unit/component) + capability doc + ADR-0024.

## 3. Out of Scope (explicit)

- ❌ Execution of any kind: no file write/delete/rename, no git write, no patch
  generation/application, no command execution, no AI execution change.
- ❌ Approval logic (CAP-004) — Planning only *flags* `approvalRequired`; it does not
  authorize. Patch/Write logic (CAP-005/006).
- ❌ No new port/adapter; no orchestrator/Intent wiring change; no user-facing Discord flow.
- ❌ No persistence/SQLite change (whether `ExecutionPlan` is persisted is deferred — Q4).
- ❌ No AI provider in v1 (Q1); no Codex/Ollama; no connectors.
- ❌ No refactor of the existing v1 `Plan`/`Planner` (chat-task pipeline) — see §16.

## 4. Architecture Impact

- **Pure core capability.** New domain VOs + one application service (`PlanningManager`).
  No infrastructure, so **no port/adapter** and **no `child_process`/fs/DB** — core
  purity and dependency-freedom fully preserved.
- **Capability independence (compose, don't depend).** `PlanningManager` consumes a
  `PlanningRequest` (plain data) and emits an `ExecutionPlan` (plain data). It does not
  import other capability managers; CAP-001/CAP-002 read results enter as request inputs.
  `ExecutionPlan.id` is the reference downstream capabilities (Approval/Patch) consume —
  matching the CA Ref-family direction (capabilities communicate through domain refs).
- **Deterministic by design.** Same `PlanningRequest` → same `ExecutionPlan` (modulo id/
  timestamp injected via the shared `id`/`clock` utils), so it is fully unit-testable.
- **Reuses `RiskPolicy`** (existing) for per-capability risk + `requiresApproval` — no new
  risk model, no duplication.

## 5. ADR Impact

- **New ADR-0024 — CAP-003 Planning Capability.** Records: Planning precedes Approval;
  produces only `ExecutionPlan`; deterministic + read-only (no execution); composition by
  request inputs (no manager-to-manager imports); reuse of `RiskPolicy`; relationship to
  the existing v1 `Plan`/`Planner` (distinct — see §16); `ExecutionPlan` as the
  Approval/Patch contract. Cross-refs ADR-0004 (Plan vs Workflow), ADR-0022/0023.
- **Roadmap note** in DECISIONS/CURRENT_STATE: CAP-003 = Planning; Approval = CAP-004.
- (Outline in §18.)

## 6. Capability ID Usage

**CAP-003** referenced in ADR-0024, the Sprint 2c review, CHANGELOG, CURRENT_STATE,
`docs/capabilities/planning.md`, and this plan. Roadmap: CAP-001 Workspace ✅, CAP-002
Git ✅, **CAP-003 Planning**, CAP-004 Approval, CAP-005 Patch, CAP-006 Workspace Write, …

## 7. Files Likely to Be Modified / Created (plan-only — none touched yet)

**New:**
| Path | Purpose |
|---|---|
| `packages/core/src/domain/planning-execution.ts` | `ExecutionPlan`, `ExecutionStep`, `EstimatedImpact`, `PlanRisk`, `PlanningRequest`. |
| `packages/core/src/application/planning-manager.ts` | `PlanningManager.plan(request)` (deterministic). |
| `packages/core/src/application/planning-manager.test.ts` | Unit/component tests (determinism, risk/approval, impact). |
| `docs/capabilities/planning.md` | Capability doc (outline in §19). |

**Modified:**
| Path | Change |
|---|---|
| `packages/core/src/domain/index.ts` | Export the new domain module. |
| `packages/core/src/application/index.ts` | Export `PlanningManager`. |
| `apps/chunsik/src/app.module.ts` | Register `PlanningManager` (factory, inject `RiskPolicy`). |
| `DECISIONS.md` | Add ADR-0024 + roadmap note. |
| `CURRENT_STATE.md`, `CHANGELOG.md` | CAP-003 status + entry. |

*No new package; no port; no adapter; no tsconfig reference changes.*

## 8. New Domain Concepts

All pure, I/O-free value objects (reusing existing `Id`, `IsoTimestamp`, `Capability`,
`RiskLevel`, `ArtifactKind`):

- **`PlanningRequest`** — input: `{ goal: string; projectId?: Id; rootPath?: string;
  targetFiles?: string[]; requiredCapabilities?: Capability[]; gitClean?: boolean }`.
  (Read-only context — candidate files, git-clean — is gathered by the caller via
  CAP-001/CAP-002 and passed in.)
- **`ExecutionStep`** — `{ order: number; description: string; capability: Capability }`.
- **`EstimatedImpact`** — `{ fileCount: number; estimatedChangedLines?: number;
  scope: 'none' | 'local' | 'broad' }`.
- **`PlanRisk`** — `{ level: RiskLevel; reason: string }`.
- **`ExecutionPlan`** — `{ id: Id; goal: string; projectId?: Id;
  requiredCapabilities: Capability[]; targetFiles: string[]; risks: PlanRisk[];
  overallRisk: RiskLevel; estimatedImpact: EstimatedImpact;
  expectedArtifacts: ArtifactKind[]; approvalRequired: boolean; steps: ExecutionStep[];
  createdAt: IsoTimestamp }`.

`ExecutionPlan` is **distinct** from the existing `Plan`/`PlanStep` (§16).

## 9. Ports Affected

**None.** Planning is a pure core service; it introduces no port and no DI token. (If AI-
assisted planning is later approved, it would reuse the existing `AiProvider` port — Q1.)

## 10. Adapters Affected

**None.** No new package, no adapter, no infrastructure.

## 11. Blast Radius

- **Compile-time:** purely additive — new domain module + service + two barrel exports +
  one app-module provider. No signature changes to existing code.
- **Runtime:** **zero** live impact — `PlanningManager` is not wired into the orchestrator/
  any user flow in 2c (it is the contract + producer for future Approval/Patch).
- **Data:** none (no persistence in v1 — Q4).
- **Dependencies:** none added.
- Net: **Low** (additive pure-core capability, no live caller).

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Conflation with existing `Plan`/`Planner` (two decomposition models — ADR-0004 warning) | Med | Keep `ExecutionPlan` distinct and clearly scoped to the code-change chain; document the boundary (§16); do not touch the v1 `Planner`. |
| "Deterministic" vs needing AI for goal understanding | Med | v1 is deterministic assembly (heuristic capability inference + explicit inputs); AI-assisted enrichment is a future slice behind `AiProvider` (Q1). Flagged for CA. |
| Thin v1 plans (empty target files when none provided) | Low | Acceptable — the contract + deterministic core is the deliverable; richer inference (incl. AI) comes later. |
| Scope creep into Approval/execution | Med | `ExecutionPlan` is data only; `PlanningManager` performs no I/O — it physically cannot execute. |

## 13. Security Considerations

- **No I/O at all** — no fs, no git, no child_process, no network, no DB. Nothing to
  sandbox or sanitize; the capability cannot leak secrets or mutate anything.
- Inputs are plain data; if a caller passes file contents/paths, Planning only records
  metadata (paths, counts) — it does not read or embed secrets.
- Core stays dependency-free and `child_process`-free (unchanged).

## 14. Validation Strategy

- `pnpm typecheck` — exit 0.
- `pnpm test` (Vitest):
  - **Determinism:** identical `PlanningRequest` → identical `ExecutionPlan` (ignoring the
    injected `id`/`createdAt`).
  - **Risk/approval:** `overallRisk` = max of required-capability risks via `RiskPolicy`;
    `approvalRequired` = `RiskPolicy.requiresApproval(overallRisk)`.
  - **Estimated impact:** `fileCount`/`scope` derived from `targetFiles`.
  - **Expected artifacts:** derived from required capabilities (e.g. CODE_IMPLEMENTATION →
    CODE_DIFF/PATCH; TEST_EXECUTION → TEST_LOG).
  - **Steps:** one high-level step per required capability, ordered.
  - **No I/O:** assert the service has no fs/git/child_process dependency (boundary check).
- **No live smoke / no SQLite** (no infrastructure touched).
- Working tree status reported at the review step.

## 15. Rollback Strategy

- Purely **additive**: new domain module, new service, barrel exports, one app-module
  provider. **Rollback = `git revert`** the implementation commit. No data/schema/
  migration; no live caller depends on it → behavior-neutral rollback.

## 16. Relationship with Existing `Plan` / `Planner` (ADR-0004)

- The v1 **`Plan`/`PlanStep`** + **`Planner`** model the **chat-task pipeline**
  (intent → minimal single-step plan → AI execution) and are unchanged.
- **`ExecutionPlan`** is the **code-change blueprint** for the V2 capability chain
  (Planning → Approval → Patch → Write). Different lifecycle, different consumers.
- They are kept **distinct** (no merge) to honor ADR-0004's "avoid two overlapping
  decomposition models" — the v1 `Plan` is intra-chat-task; `ExecutionPlan` is the
  cross-capability code-change contract. A future ADR may unify them; not in 2c.

## 17. Relationship with Other Capabilities

- **CAP-001 Workspace / CAP-002 Git (read):** supply read-only context (candidate files,
  git-clean state) that the caller folds into the `PlanningRequest`. Planning imports
  neither manager — composition by data.
- **CAP-004 Approval:** consumes `ExecutionPlan` (by `id`/value); decides on
  `approvalRequired` + risk. Planning only *flags* the requirement.
- **CAP-005 Patch:** consumes `ExecutionPlan` to produce a concrete `WorkspaceDiff`
  (CAP-001) for the target files.
- **CAP-006 Workspace Write:** consumes the approved Patch. Planning is upstream of all
  execution.
- **Ref family (CA recommendation):** `ExecutionPlan.id` acts as Planning's domain
  reference; capabilities communicate through such refs, not by importing each other.

---

## 18. Proposed ADR-0024 — outline

> **Title:** ADR-0024 — CAP-003 Planning Capability (deterministic ExecutionPlan)
> **Status:** (Proposed → Accepted on approval) · **Date:** 2026-06-…

- **Context:** roadmap revised — Planning precedes Approval. A deterministic, reviewable
  blueprint must exist before approval/patch/write.
- **Decision:** new `ExecutionPlan` domain object + `PlanningManager` (deterministic, pure
  core, reuses `RiskPolicy`); **no execution, no I/O, no port/adapter**; composition by
  `PlanningRequest` inputs (no manager-to-manager imports); `ExecutionPlan` is the
  Approval/Patch contract; distinct from the v1 `Plan`/`Planner`.
- **Consequences:** + clean upstream contract for the code-change chain, pure & testable;
  − a second plan concept (bounded by §16); − v1 plans are thin until AI-assisted (future).
- **Capability:** CAP-003. **Relates:** ADR-0004, ADR-0022, ADR-0023.

## 19. Proposed `docs/capabilities/planning.md` — outline

> Sections (same template as workspace.md / git.md):
- **Purpose** — produce a deterministic `ExecutionPlan` before approval/code change.
- **Responsibilities** — goal capture, required-capability inference, target files, risks,
  estimated impact, expected artifacts, approval requirement, high-level steps.
- **Out of Scope** — execution, file/git writes, patch generation, approval, AI execution.
- **Public API** — `PlanningManager.plan(request)`; `ExecutionPlan` + supporting VOs.
- **Future Expansion** — AI-assisted planning (via `AiProvider`); persistence of plans;
  `PlanningRef`/Ref-family alignment.
- **Boundaries** — Planning ≠ Approval ≠ Patch ≠ Execution; composes via domain refs.
- **Related ADRs** — ADR-0024 (primary), ADR-0004, ADR-0022, ADR-0023.

---

## 20. Open Questions for Chief Architect

1. **Deterministic vs AI-assisted (v1).** Recommend **deterministic** v1 (heuristic
   capability inference + explicit inputs + `RiskPolicy`); AI-assisted goal→plan as a later
   slice behind the existing `AiProvider` (`ARCHITECTURE_PLANNING`/a new `PLANNING`
   capability). Acceptable?
2. **Composition shape.** Recommend `PlanningManager` receives read-only context **in the
   `PlanningRequest`** (no `WorkspaceManager`/`GitManager` imports). Or prefer injecting
   those managers for in-service context gathering?
3. **`ExecutionPlan` vs v1 `Plan`.** Recommend keeping them **distinct** (§16). Or signal
   intent to unify under `ExecutionPlan` later?
4. **Persistence.** Recommend **no persistence** in 2c (ExecutionPlan is produced and
   handed to the caller). Persist when Approval (CAP-004) needs to store/resume it?
5. **Capability/Intent wiring.** Recommend **no** orchestrator/Intent change in 2c (pure
   contract + producer). Wire a user-facing planning flow in a later capability?

---

## Next Step

Per the V2 process: **stop here and wait for Chief Architect review.** On approval I will
implement **only** the approved scope (deterministic `ExecutionPlan` + `PlanningManager`),
validate, and produce the Sprint 2c review. No code, commit, or prototype until then.
