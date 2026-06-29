# ExecutionPlan — Shared Execution Contract

> A **project-wide contract**, independent of any single capability. Produced by
> CAP-003 Planning and consumed across the V2 execution chain. Authority: ADR-0024.

## Why this exists

`ExecutionPlan` is no longer just a Planning concern — it is the shared, deterministic
contract that flows through the capability chain:

```
Planning (CAP-003)  →  ExecutionPlan  →  Approval (CAP-004)  →  Patch (CAP-005)  →  Workspace Write (CAP-006)
```

Each capability **reads** the plan (or a later, persisted/approved form of it) and adds
its own concern, without importing the others. Capabilities communicate through the
plan and its `ExecutionPlanRef`, not through direct dependencies.

## Shape

```text
ExecutionPlan
├── id: Id
├── goal: string
├── summary: string
├── steps: ExecutionStep[]
├── requiredCapabilities: Capability[]
├── requiredResources: string[]        // resource ids / target file paths
├── estimatedChanges: EstimatedChanges // { fileCount, estimatedChangedLines?, scope }
├── approvalRequired: boolean
├── overallRisk: RiskLevel
├── expectedArtifacts: ArtifactKind[]
├── status: ExecutionStatus
├── projectId?: Id
└── createdAt: IsoTimestamp

ExecutionStep
├── id: Id
├── title: string
├── description: string
├── capability: Capability
└── status: ExecutionStatus

ExecutionPlanRef        // lightweight handle other capabilities reference
├── id: Id
└── goal: string

ExecutionStatus = PENDING | APPROVED | REJECTED | EXECUTING | COMPLETED | FAILED
```

## Invariants

- **Deterministic.** The same `PlanningRequest` yields the same plan (modulo `id`/
  `createdAt`). AI may assist in the future but is **never** the source of truth.
- **Pure data.** No behavior lives on the plan; producers/consumers are services.
- **In-memory in CAP-003.** Persistence begins with CAP-004 Approval.
- **Distinct from the v1 `Plan`** (intra-task decomposition; ADR-0004). Not merged.
- **Ref-based composition.** Downstream capabilities reference plans via
  `ExecutionPlanRef`; they do not import the Planning capability.

## Lifecycle (reserved; transitions owned by later capabilities)

```
PENDING ──approve──▶ APPROVED ──run──▶ EXECUTING ──ok──▶ COMPLETED
   │                    │                                 
   └──reject──▶ REJECTED └────────────── fail ──────────▶ FAILED
```

CAP-003 Planning emits plans/steps as `PENDING`. Approval (CAP-004) sets APPROVED/REJECTED;
execution capabilities set EXECUTING/COMPLETED/FAILED.

## Related

- ADR-0024 (CAP-003 Planning) · `docs/capabilities/planning.md`
- ADR-0022 / ADR-0023 (Workspace / Git — read context folded into `PlanningRequest`).
