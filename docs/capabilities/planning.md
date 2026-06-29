# Capability — Planning (CAP-003)

> V2 is capability-driven. Lightweight doc for the **Planning** capability.
> Authority: `DECISIONS.md` (ADR-0024). Shared contract: `docs/execution-plan.md`.

## Purpose

Produce a **deterministic `ExecutionPlan`** from a goal + read-only context, *before*
any approval or code change exists. Planning is the foundation every future execution
flow consumes:

```
Planning → ExecutionPlan → Approval (CAP-004) → Patch (CAP-005) → Workspace Write (CAP-006)
```

## Responsibilities

- Capture the **goal** and assemble an `ExecutionPlan`: `summary`, `steps`,
  `requiredCapabilities`, `requiredResources`, `estimatedChanges`, `overallRisk`,
  `approvalRequired`, `expectedArtifacts`, `status`.
- Derive risk/approval **deterministically** via the existing `RiskPolicy`.
- Emit one `ExecutionStep` per required capability (PENDING; per-step status reserved).
- Expose `ExecutionPlanRef { id, goal }` so other capabilities reference plans by ref.

## Out of Scope

- ❌ Execution of any kind: no file/git writes, no patch generation, no command execution.
- ❌ **AI** — Planning is deterministic; AI may *assist* later but never owns the plan.
- ❌ Approval / Patch / Workspace Write logic (downstream capabilities).
- ❌ Persistence (in-memory only; persistence begins at CAP-004 Approval).
- ❌ Orchestrator / Intent wiring; no user-facing flow.
- ❌ Importing other capability managers — context arrives via `PlanningRequest`.

## Public API

- `PlanningManager.plan(request) → ExecutionPlan`; `planRef(request) → ExecutionPlanRef`.
- Port `ExecutionPlanner` (strategy) — v2 impl `DeterministicPlanner`; token
  `EXECUTION_PLANNER`. Future: `AIPlanner`, `HybridPlanner`.
- Domain: `ExecutionPlan`, `ExecutionStep`, `EstimatedChanges`, `ExecutionPlanRef`,
  `PlanningRequest`, `ExecutionStatus` (see `docs/execution-plan.md`).

**Layering:** `PlanningManager` (App Service, thin) → `ExecutionPlanner` (Port) →
`DeterministicPlanner` (Strategy; pure, deterministic, AI-free). The Manager imports no
other capability manager.

## Future Expansion

- `AIPlanner` / `HybridPlanner` behind the same port (AI assists, never source of truth).
- Persistence of plans (with CAP-004 Approval); per-step approval/execution.
- Richer deterministic inference; `PlanningRef`/Ref-family alignment.

## Boundaries (capability independence)

- **Planning ≠ Approval ≠ Patch ≠ Execution.** Planning only *flags* `approvalRequired`.
- Composes via `PlanningRequest` inputs + `ExecutionPlanRef` — no manager-to-manager imports.

## Related ADRs

- **ADR-0024** — CAP-003 Planning (primary).
- ADR-0004 — Plan vs Workflow (the v1 `Plan` is distinct).
- ADR-0022 / ADR-0023 — Workspace / Git (read context sources, composed above Planning).
