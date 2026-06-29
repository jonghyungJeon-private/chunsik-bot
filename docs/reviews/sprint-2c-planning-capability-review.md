# Sprint 2c Review — CAP-003 Planning Capability

- **Process:** V2 architecture-first. Plan APPROVED WITH CHANGES (98/100) → implemented
  the approved scope only → validated → this review. **No merge until approved.**
- **Commit message:** `feat(v2-planning): introduce execution planning capability`
- **Branch:** `v2/planning-capability` (off `main`).

## Objective

Introduce **CAP-003 Planning**: a deterministic capability that produces the
cross-capability **`ExecutionPlan`** contract before any approval or code change exists.
Planning is the foundation Approval → Patch → Workspace Write consume.

## Approved-change compliance (CA review)

| CA required change | Applied |
|---|---|
| 1. `ExecutionPlanner` port → `DeterministicPlanner` (replaceable strategy, no God Object) | ✅ `PlanningManager → ExecutionPlanner (port) → DeterministicPlanner`; AIPlanner/Hybrid are future |
| 2. Expand `ExecutionPlan` shape (id/goal/summary/steps/requiredCapabilities/requiredResources/estimatedChanges/approvalRequired/overallRisk/expectedArtifacts/status) | ✅ exact shape (+ optional projectId/createdAt) |
| 3. `ExecutionStep` VO (id/title/description/capability/status) | ✅ added; per-step `status` reserved |
| 4. `ExecutionPlanRef` | ✅ `{ id, goal }` + `executionPlanRef()` helper |

| CA decision | Applied |
|---|---|
| Q1 Deterministic only (AI never source of truth) | ✅ `DeterministicPlanner`; no AI, no AiProvider change |
| Q2 Context via `PlanningRequest`; no capability-manager imports | ✅ `PlanningManager` imports only domain + the port (verified) |
| Q3 `ExecutionPlan` ≠ v1 `Plan` (don't merge) | ✅ distinct; v1 `Plan`/`Planner` untouched |
| Q4 No persistence (begins at Approval) | ✅ in-memory only |
| Q5 No orchestrator integration | ✅ domain + planner + contracts only |

Out-of-scope (none introduced): Approval, Patch, Workspace Write, Command Execution,
AI Planner, AI provider changes, persistence, orchestrator wiring.

## Scope Implemented

- **Domain:** `ExecutionPlan`, `ExecutionStep`, `EstimatedChanges`, `ExecutionPlanRef`
  (+ `executionPlanRef`), `PlanningRequest` (`domain/execution-plan.ts`); `ExecutionStatus`
  enum (`domain/enums.ts`).
- **Port:** `ExecutionPlanner` + `EXECUTION_PLANNER` token.
- **Strategy:** `DeterministicPlanner` — pure, deterministic; derives risk/approval from
  `RiskPolicy`, steps per capability, artifacts per capability, scope from resource count.
- **Service:** thin `PlanningManager` (validate goal + delegate; `planRef`).
- **Wiring:** app.module binds `EXECUTION_PLANNER → DeterministicPlanner` (inject `RiskPolicy`)
  + `PlanningManager`. No new package/port/adapter beyond the core port.

## Architecture Impact

- **Pure core capability** — no infrastructure, no port-adapter package, **no
  `child_process`/fs/DB**; core stays dependency-free and `child_process`-free (verified).
- **Capability independence** — `PlanningManager` imports no other capability manager;
  composition is by `PlanningRequest` inputs + `ExecutionPlanRef` (Ref model).
- **No live behavior change** — not orchestrator-wired; no DB/persistence; CAP-003 is the
  contract + producer for future capabilities.
- **`ExecutionPlan` is a project-wide contract** — documented capability-independently in
  `docs/execution-plan.md`.

## ADR Updates

- **ADR-0024 (Accepted)** — CAP-003 Planning: ExecutionPlanner-port strategy, deterministic
  ExecutionPlan contract, the 5 decisions, layering, distinct-from-v1-Plan. Roadmap note
  (Planning precedes Approval). Docs: `docs/capabilities/planning.md`, `docs/execution-plan.md`.
  CURRENT_STATE + CHANGELOG updated with CAP-IDs.

## Validation

- `pnpm typecheck` → **PASS (exit 0)**.
- `pnpm test` → **19 files / 107 tests PASS** (+11):
  - **DeterministicPlanner:** determinism (same request → same plan), overallRisk +
    approvalRequired via `RiskPolicy`, one PENDING step/capability, capability→artifact
    mapping, estimatedChanges scope + changed-lines passthrough, empty-request minimal plan.
  - **PlanningManager:** delegation, empty/whitespace-goal guard, `planRef`.
  - **ExecutionPlan domain:** `executionPlanRef`, `ExecutionStatus` lifecycle.
  - **RiskPolicy integration:** exercised via DeterministicPlanner tests.
- **Boundary/dependency:** PlanningManager imports only domain + port; DeterministicPlanner
  is pure core (no infra); core `child_process`-free; no adapter imports.
- **No live Discord smoke / no SQLite changes / no AI execution** (per CA).

## Remaining Risks

- v1 deterministic plans are only as rich as their inputs (`requiredCapabilities`/
  `requiredResources`); AI-assisted enrichment is a future strategy (never source of truth).
- Two plan concepts (`Plan` vs `ExecutionPlan`) — bounded by distinct lifecycle/consumers
  (Q3); a future ADR may unify.

## Technical Debt

- **Future (own ADRs):** `AIPlanner`/`HybridPlanner` behind the port; persistence (CAP-004);
  per-step approval/execution; orchestrator/Intent wiring; richer deterministic inference.

## Deliverables

`git status`, `git log --oneline -3`, `git show --stat --oneline HEAD`, `pnpm typecheck`,
`pnpm test` reported alongside this review.

**Awaiting Chief Architect review. No merge until approved.**
