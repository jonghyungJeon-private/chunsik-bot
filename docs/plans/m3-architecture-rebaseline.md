# M3 Architecture Rebaseline — Post-v1 Personal Work OS

- **Status:** ✅ `RATIFIED_WITH_CHANGES` by Product Owner decision `911f2337`. **Not implemented.**
- **Analysed at:** local HEAD `03bfd291aba4e31b680a4338951f4780a3621b6c` (branch `main`)
- **Released v1.0.0 source:** `80bbc94de0493c24036197dabc2ff00dbcd20cbf` (= `origin/main` = `v1.0.0^{}`)
- **Method:** source-first inspection of `packages/core`, `packages/connector-*`,
  `packages/repository-hosting-github`, `apps/chunsik`, cross-checked against
  `ARCHITECTURE.md`, `DECISIONS.md` (73 ADRs), `CURRENT_STATE.md`, `ROADMAP.md`.
- **Scope:** architecture evidence + proposal only. No product source, `ARCHITECTURE.md`,
  `DECISIONS.md`, or ADR was modified.

### Ratification record

ADR-0074 and ADR-0075 are the canonical accepted decisions. They ratify `ResourceRef` as stable external-input
identity, the narrow CAP-011 `WorkItem` aggregate, and a non-authoritative Work Surface while preserving
Resource/Artifact separation and rejecting a universal graph, workflow engine, and event sourcing. The accepted
sequencing changes the proposal: **M3A-1 is `ResourceRef` plus a read-only Work Surface only; M3A-2 introduces the
`WorkItem` repository, additive migration, and persisted personal-work state.** ADR-0032's appended amendment freezes
the reduced `ConversationRuntime` boundary. Unratified recommendations elsewhere in this historical proposal remain
non-authoritative and require their own later ADRs; ADR-0076 through ADR-0081 have not been drafted.
Canonical operating state is now `QUOKY DEFAULT ORCHESTRATOR = APPROVED`,
`QUOKY OPERATIONAL STATUS = NORMAL`, and `QUOKY FEATURE FREEZE = YES`; older Quoky status observations below are
historical analysis, not current operating authority.

---

## 1. Current architecture — as implemented

### 1.1 Layout

Monorepo, 16 packages + 1 app. Core is ~48k LOC across 166 TS files in
`domain / application / ports / util`. Dependency direction is genuinely inward:
`packages/core` imports no adapter, and `apps/chunsik/src/app.module.ts` is the single
composition root permitted to import concrete providers (verified — the file states and
honours this).

### 1.2 Ports (16)

`ai-provider`, `command-runner`, `connector-provider`, `execution-planner`, `git-provider`,
`logger`, `platform-adapter`, `provider-selector`, `queue-provider`,
`repository-hosting-provider`, `storage-provider`, `vector-provider`, `workspace-provider`,
`workspace-writer`, plus `index`/`tokens`. No adapter type crosses a port boundary.

### 1.3 The Execution Ledger already exists

This is the single most important finding for M3. `StorageProvider` exposes 13 repositories,
and the CAP-003…CAP-008 aggregates form a **linked execution chain with first-class
cross-references already in the persistence contract**:

```
ExecutionPlan (CAP-003, in-memory)
  ← approvals.findByExecutionPlan          → ApprovalRequest   (CAP-004)
  ← patches.findByExecutionPlan            → PatchSet          (CAP-005)
  ← codeGenerations.findByExecutionPlan    → CodeGeneration    (CAP-008)
  ← commandExecutions.findByExecutionPlan  → CommandExecution  (CAP-007)
PatchSet
  ← workspaceChanges.findByPatchSet        → WorkspaceChange   (CAP-006)
WorkspaceChange
  ← commandExecutions.findByWorkspaceChange
CodeGeneration
  ← codeProposals.findByCodeGeneration     → CodeProposal
```

`ExecutionOrchestrator` runs 7 stages (`PLANNING → CODE_GENERATION → WORKSPACE_DIFF →
APPROVAL → PATCH → WORKSPACE_WRITE → COMMAND_EXECUTION`) and returns `ExecutionRefs`:

```ts
interface ExecutionRefs {
  executionPlanRef?; codeGenerationId?; codeProposalRef?; approvalRef?;
  patchSetId?; workspaceChangeId?; commandExecutionId?; workspaceRef?;
}
```

**`ExecutionRefs` is already a provenance spine.** It is returned per execution — but it is
never persisted as a first-class record.

### 1.4 Ref-based decoupling is real

`ExecutionPlanRef`, `ApprovalRef`, `WorkspaceRef`, `RepositoryRef`, `CodeProposalRef`,
`PullRequestRef` with pure derivation functions (`executionPlanRef()`, `approvalRef()`).
`ApprovalRef` deliberately carries its `ExecutionPlanRef` so a consumer can verify
referential integrity without loading the aggregate. The Aggregate Ownership Rule
(ADR-0025) is enforced in code, not just documented.

### 1.5 Identity

`Actor { id, displayName, identities: ExternalIdentity[], createdAt, metadata }` and
`ExternalIdentity { platform, externalId }` **already exist**, with
`ActorRepository.findByExternalIdentity(platform, externalId)`. v1 populates a single
Discord identity. This is a working multi-identity seam, not a stub.

### 1.6 Connectors and repository hosting

`ConnectorProvider { source, readOnly, isAvailable(), query() }` returning
`ConnectorItem { id, title, url?, summary?, raw? }`. Jira, Slack **and Confluence** adapters
are all implemented and registered config-gated in `apps/chunsik/src/connector-providers.ts`,
which degrades safely (a malformed connector config logs a warning and is skipped).

`RepositoryHostingProvider` is much richer than a connector: `repositoryExists`,
`branchExists`, `findOpenPullRequest`, `createPullRequest`, `getPullRequestStatus`,
`getMergePreflight`, `mergePullRequest`, `getRemoteBranchCommit`, `deleteRemoteBranch` —
i.e. GitHub is wired as an **approval-gated write capability** (CAP-010), not a read surface.

### 1.7 ConversationRuntime — the actual centre of gravity

| Metric | Value |
|---|---|
| `conversation-runtime.ts` | **5,240 lines / 284 KB** |
| its test file | **447 KB** |
| public methods | **1** (`handle(message)`) |
| injected collaborators (`ConversationRuntimeDeps`) | **32** |
| `response-composer.ts` | 105 KB |

`ConversationRuntimeDeps` injects: actors, sessions, memory, memoryWriter, classifier,
projects, analyzer, tasks, workspace, commandExecutions, command, contextBuilder,
promptComposer, promptRenderer, router, runtimeProviderRouting, artifacts, composer, risk,
intentResolver, orchestrator, approvals, approvalFlow, scopeClarificationFlow,
applyPreviewFlow, codeGeneration, patch, codeProposals, workspaceWrite, git,
repositoryHosting, logger.

The `git` and `repositoryHosting` members alone expose `commitFiles`,
`pushApprovedCommit`, `syncMain`, `deleteMergedLocalBranch`, `createPullRequest`,
`getPullRequestStatus`, `mergePullRequest`, `deleteRemoteBranch`. The doc comments record
sprint-by-sprint accretion (2q, 2r, 2s, 2t, 2u, 2v, 2w, 2y, 2z, 3a, 3d-D, 3e, 3g, 3h, 3i, 3j-B).

**Assessment:** the brief says ConversationRuntime is "at risk of becoming everything".
Source shows it **already is** the de facto owner of the entire local-git → PR → merge →
cleanup lifecycle, expressed as conversational state machine steps.

### 1.8 How long-running work state is actually carried

`StatelessApprovalFlow` / `StatelessApplyPreviewFlow` (ADR-0032) avoid a new aggregate by
storing the in-flight `{request, prior}` and `ApplyPreviewAnchor` as **untyped JSON blobs in
`Task.metadata`** under string keys (`conversationExecutionAnchor`, apply-preview anchor),
correlated through `Session.activeTaskId → Task.planId → approvals.findByExecutionPlan`.
Each flow **creates a new `Task` row** to hold its anchor.

This is a defensible v1 decision (no migration, referential integrity is checked). It is
also the exact structural limit M3 hits — see §2.1.

### 1.9 Doc ↔ source mismatches (reported, not fixed)

| # | Claim | Source reality |
|---|---|---|
| M1 | `ROADMAP.md`: MCP and Search are "absorbed by `ResourceResolver`", action "none" | **`ResourceResolver` does not exist.** 0 non-test occurrences. `ARCHITECTURE.md` §4 lists `ResourceRef` as `[RESERVE]` — it is unbuilt, so nothing absorbs MCP today |
| M2 | `ARCHITECTURE.md` §13: connectors evolve via `ResourceResolver` + `ActionProvider` | Implemented as `ConnectorProvider` (ratified later by ADR-0072). §13 row is superseded but still reads the old mechanism |
| M3 | ADR-0008 "**V1:** `AgentProfile` config type, consulted by Planner/Router" | **`AgentProfile` does not exist.** 0 non-test occurrences. The v1 half of ADR-0008 was never delivered |
| M4 | `connector-provider.port.ts`: "Jira and Slack … remain unwired; only Confluence remains unimplemented"; `connector-manager.ts`: "v1 ships ZERO connectors" | All three are implemented **and** wired config-gated. Both doc comments are stale |
| M5 | `ROADMAP.md`: "Connectors (read-only)" listed under **Future** | Shipped in v1 |

M1 and M3 matter for M3 planning: two seams the roadmap treats as *available* are in fact
*unwritten*. M4/M5 are stale comments with no design impact.

---

## 2. V1 → M3 pressure points

### 2.1 One active work item per session (hard blocker for M3A)

Work state is reachable only via `Session.activeTaskId` — a **single** pointer. Combined with
anchors in `Task.metadata`, the model can represent exactly one in-flight execution per
conversation. "Show me what I need to work on" is inherently **many concurrent items**
(N Jira issues + M PRs + K Slack threads). There is no query path for "all open work for this
actor" — `TaskRepository` offers only `listByContext(channelId, threadId?)`.

This is the single strongest architectural argument in this rebaseline.

### 2.2 Untyped work state

`Task.metadata: Record<string, unknown>` holds resumable execution state. Every new
long-running flow adds another magic key and another `Task` row, so one logical piece of work
already spans multiple `Task` rows. No schema, no validation, no migration story.

### 2.3 ConversationRuntime accretion is now the default growth path

With 32 collaborators and one entry point, the cheapest way to add any behaviour is another
`deps` member plus another branch in `handle()`. Adding Slack/Jira/GitHub read surfaces,
triggers, agents and receipts this way yields a ~10k-line class. Test cost is already
visible: 447 KB of tests for one file.

### 2.4 `Resource` is the missing half of a ratified invariant

`ARCHITECTURE.md` §4 states a **hard rule**: "`Resource` is an **input** the system reads;
`Artifact` is an **output** the system produces. They never merge." `Artifact` is fully
implemented with 8 kinds (including `JIRA_REPORT`, `SLACK_SUMMARY`, `CONFLUENCE_DRAFT`).
`Resource`/`ResourceRef` is **absent**. Today an external item exists only as a transient
`ConnectorItem` DTO or as `ExecutionPlan.requiredResources: string[]`.

Without stable resource identity there is no way to say "this Jira issue is still assigned to
me", "this PR changed since I looked", or "this run read these three resources".

### 2.5 No persisted receipt

`ExecutionRefs` answers most provenance questions but is returned, anchored into
`Task.metadata`, and then lost. `actorId` lives on `Task`/`Session`, `providerId` on
`TaskRun` — neither is on the ledger. Resource reads are not recorded anywhere.

### 2.6 Agent identity has nowhere to live

`Capability` (10 values) maps intent → provider. There is no `AgentProfile`, so "who did this"
can only resolve to a provider id. The invariant *Agent ≠ Provider* is currently
unrepresentable, and `TaskRun.providerId` is explicitly "internal audit only — never shown".

### 2.7 GitHub is write-shaped, not read-shaped

For M3A we need "PRs/issues/reviews awaiting me". `RepositoryHostingProvider` has
`findOpenPullRequest` and `getPullRequestStatus` — both scoped to *one known branch pair for
one identity*, designed for the merge pipeline. There is no "list what involves me" read path.

---

## 3. Existing reusable seams — reuse, do not rebuild

| Seam | Status | M3 use |
|---|---|---|
| `Actor` + `ExternalIdentity[]` + `findByExternalIdentity` | ✅ built | identity mapping — **extend data, not shape** |
| `ConnectorProvider` + `ConnectorManager` | ✅ built, 3 adapters | M3A read surface + M3B MCP seam |
| Config-gated connector registration | ✅ built, degrades safely | availability model |
| Execution Ledger (CAP-003…008 + 13 repositories) | ✅ built | M3C provenance substrate |
| `ExecutionRefs` | ✅ built | receipt payload |
| Ref model + pure derivation | ✅ built | keeps capabilities decoupled |
| `ApprovalRequest` / `ApprovalRef` / `ApprovalPolicy` / `RiskPolicy` | ✅ built, plan-scoped | all M3 writes |
| `ExecutionOrchestrator` (7 stages, `ExecutionOutcome`) | ✅ built | execution spine |
| `WorkspaceProvider` (`WorkspaceRef`) | ✅ built | execution-environment evolution |
| `Artifact` (8 kinds) | ✅ built | outputs |
| Memory (6 types incl. `CONNECTOR`, `TOOL`) + `ContextBuilder` | ✅ built | context, unchanged authority |
| `StorageProvider` repository pattern | ✅ built | add repositories, don't reshape |

**Nothing in this list should be rebuilt for M3.**

---

## 4. Proposed M3 architecture

Add exactly **one** new layer concept — a *Work* capability that owns work identity and
correlation — and keep everything else where it is.

```
Discord   Slack   Jira   Confluence   GitHub   Figma   MCP tools
   │        └────────┬────────┴──────────┴────────┴──────┘
   │        Integration layer (adapters, config-gated, read-first)
   │        ConnectorProvider │ RepositoryHostingProvider │ McpToolProvider
   ▼                          ▼
PlatformAdapter        ┌──────────────────────────────┐
   │                   │  Application layer            │
   ▼                   │                               │
ConversationRuntime ──▶│  WorkManager (NEW, CAP-011)   │◀── WorkSurfaceQuery (read model)
(conversation entry)   │  ExecutionOrchestrator        │
                       │  Approval · Planning · Patch  │
                       │  Memory · ContextBuilder      │
                       └──────────────┬────────────────┘
                                      ▼
                       Domain: Actor · Session · Task · TaskRun
                               Project · Artifact · Approval
                               ResourceRef (NEW) · WorkItem (NEW)
                               ExecutionReceipt (NEW)
                                      ▼
                       Ports: StorageProvider · ConnectorProvider · …
```

**Dependency direction is unchanged (inward).** Integration adapters depend on Core ports;
Core depends on nothing outward. `ConversationRuntime` becomes a *consumer* of Work, not its
owner.

Three new domain concepts, one new capability, no rewrite:

1. **`ResourceRef`** — activates the already-ratified `[RESERVE]` slot (§4 of the constitution).
   Stable identity for an external input: `{ source, externalId, kind, url?, title?, digest? }`.
2. **`WorkItem`** — the typed replacement for `Task.metadata` anchors + `Session.activeTaskId`.
   Correlates an actor, an optional project, zero-or-more `ResourceRef`s, and the execution
   ledger. **Many per actor**, unlike today's single pointer.
3. **`ExecutionReceipt`** — persisted `ExecutionRefs` + actor + provider + resources read + approval.

---

## 5. Work Graph decision

### **Recommendation: HYBRID — one narrow new aggregate (`WorkItem`) + a read model (`WorkSurfaceQuery`). Name it "Work Model", not "Work Graph". No graph database. No event sourcing.**

**Why not a full new architectural centre.** Project, Task, TaskRun, Artifact, Approval,
PatchSet, WorkspaceChange, CommandExecution, CodeGeneration, CodeProposal already exist as
owned aggregates with repositories and cross-reference queries. A Work Graph capability that
"owns" them would violate the Aggregate Ownership Rule (ADR-0025) and reassign persistence
ownership — the most expensive change available, for no product gain.

**Why not a pure read model.** A read model cannot fix §2.1/§2.2. Something must durably hold
"this is a piece of work, it belongs to this actor, it relates to these resources, it has these
executions" — with many rows per actor and a typed schema. That is an aggregate.

**Split:**

| Concern | Verdict |
|---|---|
| Work identity, actor ownership, resource linkage, lifecycle | **`WorkItem` aggregate** (new, CAP-011) |
| "Show me what I need to work on" | **`WorkSurfaceQuery` read model** — composed above capability boundaries, rebuildable, never authoritative |
| Execution provenance | **existing Execution Ledger** + `ExecutionReceipt`. Not graph-owned |
| Plan/step decomposition | **stays `ExecutionPlan`** (CAP-003). Not graph-owned |
| Approval state | **stays `ApprovalRequest`** (CAP-004). Not graph-owned |
| Memory semantics | **stays Memory**, authoritative. Not graph-owned |
| Conversation state | **stays `Session`**. Not graph-owned |
| Inter-task orchestration (`Workflow`) | **still `[LATER]`** — do not build in M3 |

**Relationships needing first-class identity:** only `WorkItem ↔ ResourceRef` (many-to-many,
because one work item spans a Jira issue + a PR + a Slack thread) and
`WorkItem ↔ ExecutionReceipt` (one-to-many). Everything else stays a plain reference field.

**Naming:** "Work Graph" invites a graph engine nobody needs. Recommend **Work Model** for the
aggregate and **Work Surface** for the read model.

---

## 6. Concept-by-concept

| Concept | Status today | Owner | Identity | Kind | Persistence | Recommendation |
|---|---|---|---|---|---|---|
| **Project** | ✅ exists (`project.ts`) | Project | `Id` | Aggregate | `projects` | unchanged |
| **Task** | ✅ exists, rich | Task | `Id` | Aggregate | `tasks` | **unchanged.** Task stays *intra-conversation execution attempt*. Do not widen it into a work-tracking entity |
| **Run** | ✅ two forms: `TaskRun` (AI attempt) + CAP-006/007/008 ledger records | respective capabilities | `Id` | Aggregate | own repos | unchanged; unify only in the **read model** |
| **Resource** | ❌ **missing** (`[RESERVE]` in §4; transient `ConnectorItem` only) | **new: Work** | `{source, externalId}` composite | **Value Object** (`ResourceRef`) | denormalised on `WorkItem`; optional cache table later | **ADD.** Value object, not aggregate — external system remains authoritative |
| **Artifact** | ✅ exists, 8 kinds | Artifact | `Id` | Aggregate | `artifacts` | unchanged. **Never merge with Resource** (§4 hard rule) |
| **Decision** | ❌ missing as work concept (`Decision` in source = routing decision) | — | — | — | — | **DO NOT ADD in M3.** A Confluence/Jira decision is a `ResourceRef` with `kind: 'decision'`; an internal decision is an ADR (a repo file). Revisit only with demonstrated need |
| **Approval** | ✅ exists, plan-scoped, own aggregate | Approval | `Id` | Aggregate | `approvals` | unchanged. **Do not make it work-scoped** |
| **WorkItem** | ❌ missing | **new: Work (CAP-011)** | `Id` | **Aggregate** | new `workItems` repo + migration | **ADD** |
| **ExecutionReceipt** | ⚠️ partial (`ExecutionRefs`, unpersisted) | **new: Work** | `Id` | **Entity** under `WorkItem` | new `executionReceipts` repo | **ADD in M3C** |
| **AgentProfile** | ❌ missing (ADR-0008 v1 half undelivered) | Agent (M3D) | `Id` | **config Value Object** first | config file, then table | **ADD as config in M3D** |

**Allowed dependency direction:** `WorkManager` may hold `ResourceRef`s and receipt refs, and
may be *given* refs by composition. It must **not** query ApprovalManager, GitManager,
ConnectorManager or any other Manager directly — composition happens above capability
boundaries, per the existing invariant. `WorkSurfaceQuery` is a composition-layer read model
and may fan out over managers.

---

## 7. Identity mapping decision

### **Recommendation: EXTEND the existing `Actor` seam. No new identity aggregate. No Team permissions in M3.**

`Actor.identities: ExternalIdentity[]` and `findByExternalIdentity(platform, externalId)`
already implement exactly the required shape. Concretely:

1. **Canonical internal identity:** `Actor.id`. Unchanged, already referenced by Session/Task.
2. **`ExternalIdentity`:** keep `{ platform, externalId }`; add **optional**
   `displayName?`, `accountUrl?`, `verifiedAt?`. Additive, backward-compatible.
3. **Ownership:** `ActorManager` (Core) owns the mapping. Connectors never own identity.
4. **Lookup direction:** *inbound* `(platform, externalId) → Actor` for attribution;
   *outbound* `Actor → identities.find(platform)` to build per-connector queries
   (e.g. Jira `assignee = <externalId>`). Both directions are already possible.
5. **Connector responsibility:** report *its own* notion of "me" — add
   `ConnectorProvider.currentIdentity?(): Promise<ExternalIdentity | null>`, optional so
   existing adapters still compile. The connector never resolves an `Actor`.
6. **Outside Core:** tokens, OAuth, workspace/tenant ids, account metadata. Core sees only
   `{ platform, externalId }`.
7. **Personal → Team path:** already clean. Multi-actor = more `Actor` rows; authorization =
   the still-reserved `PolicyProvider` (ADR-0009). **Do not design it in M3.**

**Assumption flagged:** identity linking is *operator-configured* in M3 (config maps
`platform → externalId`). No auto-discovery, no identity-merge heuristics.

---

## 8. Agent profile / team foundation decision

### **Recommendation: deliver ADR-0008's undelivered v1 half — `AgentProfile` as CONFIG ONLY — and do it in M3D, not earlier.**

The invariant **Agent ≠ Provider** requires a name for the actor-like thing that is not a
provider id. Minimum M3 representation:

```ts
interface AgentProfile {            // configuration value object, NOT a service
  id: string;                       // stable, human-authored: "reviewer", "planner"
  role: string;
  capabilities: Capability[];       // reuses the existing enum
  promptTemplateRef?: string;       // reuses PromptComposer templates (ADR-0003)
  riskProfile: RiskLevel;           // reuses existing risk model
  allowedResources?: string[];      // matches ADR-0008 exactly
}
```

Routing becomes `Planner → AgentProfile → Capability → Provider` as ADR-0008 already
specifies — so `AiProvider`/`Capability` contracts do **not** change.

- **Needed earlier than M3D:** only that `ExecutionReceipt` carries an **optional**
  `agentProfileId?`. One nullable field in M3C avoids a receipt migration in M3D.
- **M3D:** project membership + assignment (`WorkItem.assignedAgentProfileId?`).
- **Deferred past M3:** delegation policy, autonomous loops, sub-agents, agent-to-agent
  negotiation, per-agent credentials. **Do not build a multi-agent runtime.**

---

## 9. Handoff decision

### **Recommendation: a bounded typed contract, but only in M3D. Not a prompt convention. Not a new aggregate.**

Model handoff as a **typed event appended to a `WorkItem`**, not as its own aggregate:

```ts
interface WorkHandoff {
  id: Id;
  workItemId: Id;                                     // the work being handed off
  from: { kind: 'human' | 'agent'; actorId?: Id; agentProfileId?: string };
  to:   { kind: 'human' | 'agent'; actorId?: Id; agentProfileId?: string };
  reason: string;
  resourceRefs: ResourceRef[];                        // what to read
  receiptIds: Id[];                                   // what already happened
  approvalRef?: ApprovalRef;                          // preserved, never re-derived
  createdAt: IsoTimestamp;
}
```

Answering the required questions: **what** is handed off = the `WorkItem` (never raw
conversation text); **source/target** = `Actor.id` or `AgentProfile.id` — never a provider id,
which is what enforces Agent ≠ Provider across a handoff; **state transferred** = resource
refs + receipt ids, by reference, so nothing is duplicated or re-summarised; **receipt** = the
`WorkHandoff` record itself; **approval state** = carried as `ApprovalRef`, which already
embeds its `ExecutionPlanRef` for integrity — a handoff can therefore **never launder an
approval onto a different plan**.

A free-form prompt convention is rejected: it cannot preserve approval integrity, and prompt
text is not queryable for "who handed me this and why".

---

## 10. Trigger decision

### **Recommendation: DEFINE the boundary now, BUILD nothing in M3 before M3E.**

Trigger belongs **outside Core**, as an inbound port symmetric to `PlatformAdapter`:

```
TriggerSource (port, M3E)  →  produces a WorkSignal  →  WorkManager
```

- A `Trigger` may reference: `ResourceRef`, `Actor.id`, `Project.id`, `AgentProfile.id`,
  and a `Capability`.
- A `Trigger` may **never** reference: a provider id, a `Session`, an `ExecutionPlan`, a
  workspace path, or any connector-specific payload type.
- A trigger firing produces a **work signal**, never a direct execution. It cannot bypass
  approval; the normal `RiskPolicy`/`ApprovalPolicy` path still applies.
- Scheduling, cron, backoff, dedupe, delivery guarantees are **adapter** concerns
  (`QueueProvider` already exists as the seam).

**Do not** add a scheduler, a `Trigger` table, or recurrence rules in M3A–M3D. The only M3C
obligation is that `WorkItem` records `origin: 'conversation' | 'connector' | 'trigger'`, so
trigger-originated work needs no migration later.

---

## 11. Receipt / provenance decision

### **Recommendation: bounded `ExecutionReceipt` projected from the existing Execution Ledger. Explicitly NOT event sourcing.**

Every required question is already answerable from existing state or from one small addition:

| Question | Source |
|---|---|
| who requested this? | `Task.actorId` / `Session.actorId` → **promote to receipt** |
| what task/run caused this? | `ExecutionRefs.executionPlanRef` + `taskId`/`taskRunId` ✅ |
| which resources were read? | ❌ **the one real gap** → `resourceRefs: ResourceRef[]` |
| which tool/provider executed? | `TaskRun.providerId`, `CodeGeneration` ✅ → promote |
| what changed? | `WorkspaceChange` + `PatchSet` ✅ |
| under which approval? | `ExecutionRefs.approvalRef` (plan-scoped) ✅ |
| what was the result? | `ExecutionOutcome.status` + `CommandExecution` ✅ |

```ts
interface ExecutionReceipt {
  id: Id;
  workItemId?: Id;
  actorId: Id;                        // who asked
  agentProfileId?: string;            // reserved in M3C for M3D
  capability: Capability;
  providerId?: string;                // audit only, per ADR-0015
  refs: ExecutionRefs;                // the EXISTING spine, persisted verbatim
  resourceRefs: ResourceRef[];        // NEW: what was read
  outcome: ExecutionOutcomeStatus;
  startedAt: IsoTimestamp;
  finishedAt?: IsoTimestamp;
}
```

**Why not event sourcing:** the ledger aggregates are already immutable-by-convention records
of what happened, with cross-reference queries in the persistence contract. Universal event
sourcing would duplicate them, force a rebuild-projection story, and reassign persistence
ownership across six capabilities — a huge change for information already retrievable.

Receipts are **append-only and derived**: they must be reconstructable from the ledger, so
they stay a rebuildable projection, consistent with the existing "derived data is rebuildable"
invariant.

---

## 12. MCP boundary decision

### **Recommendation: MCP is an ADAPTER behind a NEW narrow `ToolProvider` port. Do NOT extend `ConnectorProvider`. Core never imports MCP types.**

Note first that `ROADMAP.md`'s claim that MCP is "absorbed by `AiProvider` / `ResourceResolver`,
action: none" **cannot hold** — `ResourceResolver` does not exist (mismatch M1). This decision
supersedes that row.

`ConnectorProvider` is deliberately read-only with a single `query()` and is the right seam for
M3A. MCP is fundamentally different: dynamic tool **discovery** plus **invocation** with
arbitrary schemas. Forcing it into `query()` would either turn `ConnectorQuery` into an untyped
RPC envelope or leak MCP schema types into Core.

**Separate the seams:**

```
Core ports (no external protocol types):
  ConnectorProvider   — read-only retrieval        → native Jira/Slack/Confluence
  ToolProvider (NEW)  — declared tools + invoke    → native tools │ McpToolProvider adapter
  RepositoryHostingProvider — approval-gated writes → GitHub
```

```ts
interface ToolDescriptor {
  id: string; title: string; description: string;
  mutating: boolean;                       // drives the approval gate
  riskLevel: RiskLevel;                    // reuses existing risk model
  inputSchemaRef?: string;                 // OPAQUE to Core — never a parsed MCP schema
}
interface ToolProvider {
  readonly source: string;
  isAvailable(): Promise<boolean>;
  listTools(): Promise<ToolDescriptor[]>;
  invoke(toolId: string, input: Metadata): Promise<{ artifacts?: Artifact[]; items?: ConnectorItem[] }>;
}
```

Requirements satisfied: Core depends only on `ToolDescriptor`/`Metadata`, never on MCP protocol
types (the MCP client library lives in `packages/tool-mcp`, imported only by the composition
root); native and MCP-backed tools fit the same narrow seam; `mutating: true` **must** route
through the existing `ApprovalPolicy`/`RiskPolicy` — no auto-invocation, matching the standing
connector rule; availability is explicit via `isAvailable()` + config-gated registration, reusing
the pattern that already degrades safely; and **tool availability ≠ agent identity** — an
`AgentProfile.allowedResources` may *restrict* which tools an agent may use, but a `ToolProvider`
never asserts identity.

**Current seams verdict: `ConnectorProvider` is sufficient for M3A as-is** (add only the optional
`currentIdentity?()`). MCP needs **separation**, not extension.

---

## 13. Execution environment decision

### **Recommendation: reuse `WorkspaceProvider`. Add nothing in M3. Explicitly reject cloud-computer-per-agent.**

`WorkspaceProvider` + `WorkspaceRef` already abstract the working directory, and
`ARCHITECTURE.md` §13 already ratifies the evolution axis "local clone → git worktrees,
sandboxes" through this port. `ROADMAP.md` also already reserves `kind: 'remote'`.

The required separation is a **naming and ownership** clarification, not new machinery:

| Concern | Owner | Notes |
|---|---|---|
| Agent identity | `AgentProfile` (M3D) | never an environment |
| Workspace lifecycle | `WorkspaceProvider` / `WorkspaceManager` | existing |
| Credentials | composition root + adapters | **never** Core, never `AgentProfile`; matches the existing rule that the runtime receives no token |
| Filesystem access | `WorkspaceWriter` (sole mutator) | existing |
| Execution policy | `RiskPolicy` + `ApprovalPolicy` | existing |
| Receipt/evidence | `ExecutionReceipt` (M3C) via `refs.workspaceRef` | existing ref |

Evolution path `local process → worktree → sandbox/container → remote` is a sequence of
`WorkspaceProvider` implementations, each justified by a concrete need. **Nothing to build in
M3.** One agent ≠ one machine; many `AgentProfile`s may share one workspace, and an
`AgentProfile` must never own credentials.

---

## 14. ConversationRuntime boundary after M3

**Should own:** inbound message handling; actor/session resolution; intent classification
dispatch; short-term conversational continuity; turn-level response composition; asking for
approval and reading a human decision *in conversation*; presenting work surfaces and receipts.

**Should move out:**

| Currently in ConversationRuntime | Move to |
|---|---|
| multi-turn execution anchors in `Task.metadata` | `WorkItem` (M3C) |
| `Session.activeTaskId` as the only work pointer | `WorkManager` queries |
| git commit/push/sync/branch-cleanup step sequencing | a Git **workflow** service under Work |
| PR create/status/merge/remote-cleanup sequencing | a Repository Hosting workflow service |
| apply-preview / scope-clarification anchor bookkeeping | `WorkItem` state |

**Must never enter:** work-item state ownership, agent-team state, scheduler/trigger state,
cross-project work state, long-running run state, receipt/provenance storage, MCP or connector
protocol knowledge.

**Concrete acceptance test for the rebaseline:** `ConversationRuntimeDeps` **must not grow**.
Each M3 slice should reduce it. If a slice adds a member, the boundary has been violated.

---

## 15. Proposed M3 sequencing

### **Recommendation: keep the M3A → M3E order, but move the `ResourceRef` + minimal `WorkItem` foundation OUT of M3C and INTO M3A. Split M3A into M3A-1/M3A-2.**

Rationale: M3A's product promise ("Show me what I need to work on") **cannot ship** on
`Session.activeTaskId` + `Task.metadata` (§2.1). It needs stable resource identity and a
many-per-actor container. Discovering that during M3C would force reworking everything M3A
built — the exact rework this rebaseline exists to avoid. Conversely, receipts and the full
provenance graph genuinely are not needed for a read-only surface.

| Slice | Content | Depends on | Ships |
|---|---|---|---|
| **M3A-1** | `ResourceRef` value object; minimal `WorkItem` (+repo/migration); `ConnectorProvider.currentIdentity?()`; `Actor.identities` config mapping; **`WorkSurfaceQuery` over Jira + GitHub only** | rebaseline ratified | **"Show me what I need to work on"** |
| **M3A-2** | Slack + Confluence into the surface; `assigned / waiting / changed` classification; Figma last | M3A-1 | richer surface |
| **M3B** | `ToolProvider` port + `McpToolProvider` adapter; approval-gated `mutating` tools | M3A-1 (`ResourceRef`) | first governed writes |
| **M3C** | `ExecutionReceipt` (+`resourceRefs`, +reserved `agentProfileId?`); full ledger projection; `WorkItem.origin` | M3A-1, M3B | provenance / "why did this happen" |
| **M3D** | `AgentProfile` config; assignment; `WorkHandoff`; delegation | M3C (receipts carry agent id) | persistent teammates |
| **M3E** | `TriggerSource` port; scheduler adapter; background runs; workspace evolution | M3C, M3D | proactive work |

**Concrete dependencies (not elegance):** receipts are meaningless without resource identity, so
M3C **must** follow `ResourceRef`. Handoff transfers receipt ids, so M3D **must** follow M3C.
Triggers create work for agents, so M3E **must** follow M3D. MCP writes need approval + resource
identity but not receipts, so M3B can precede M3C. GitHub-before-Slack in M3A-1 because
`RepositoryHostingProvider` is already wired and authenticated, whereas Slack needs the new
`currentIdentity` path — fastest independently verifiable value first.

---

## 16. ADR surface

**New ADRs required (do not write yet — next number is ADR-0074):**

| Proposed | Subject | Why an ADR |
|---|---|---|
| ADR-0074 | `ResourceRef` activation (`[RESERVE]` → `[NOW]`) | changes the ratified §4 concept map |
| ADR-0075 | CAP-011 Work Model (`WorkItem` aggregate + ownership) | **new capability + aggregate boundary + persistence ownership + migration** |
| ADR-0076 | Work Surface read model (composition, non-authoritative, rebuildable) | new composition rule |
| ADR-0077 | `ExecutionReceipt` provenance; event sourcing explicitly rejected | persistence ownership + rejects an alternative |
| ADR-0078 | `ToolProvider` port + MCP adapter boundary | **new Core port**; supersedes the ROADMAP MCP row |
| ADR-0079 | `AgentProfile` config activation (completes ADR-0008 v1) | amends a ratified ADR |
| ADR-0080 | `WorkHandoff` typed contract | new cross-capability contract |
| ADR-0081 | `TriggerSource` boundary (definition only, no implementation) | reserves a seam |

**Existing ADRs needing amendment:**

| ADR | Amendment |
|---|---|
| ADR-0008 | v1 `AgentProfile` half was never delivered; restate as M3D |
| ADR-0009 | `ExternalIdentity` gains optional fields; multi-platform mapping becomes active |
| ADR-0032 | Conversation Runtime no longer owns multi-turn work anchors; `Task.metadata` anchors superseded by `WorkItem` |
| ADR-0072 | connector seam extended with optional `currentIdentity?()`; note `ToolProvider` is a *separate* seam |
| ADR-0024/0025 | confirm (no change) that Planning still owns `ExecutionPlan` and Approval still owns `ApprovalRequest` — Work owns neither |

**Implementation-local (no ADR):** `WorkSurfaceQuery` ranking/sort order, connector query
strings, surface presentation/formatting, per-connector pagination, caching TTLs.

**Also needs correcting (documentation only, outside this task):** mismatches M1, M2, M4, M5 in §1.9.

---

## 17. Migration / compatibility

No rewrite. Every v1 concept survives unchanged.

1. **Additive schema only.** New tables `work_items`, `execution_receipts`
   (+ optional `resource_refs` cache). No column dropped, no existing table reshaped.
2. **`Task` keeps its meaning.** Task remains the intra-conversation execution attempt.
   `WorkItem` is the durable, many-per-actor container. `WorkItem.taskIds: Id[]` links them.
3. **Anchor migration is lazy, not a data migration.** Existing
   `Task.metadata.conversationExecutionAnchor` blobs keep working; `ApprovalFlow` reads
   `WorkItem` first and falls back to the anchor. New work writes `WorkItem` only. Old
   in-flight conversations are unaffected.
4. **`Session.activeTaskId` stays** as a legitimate conversation pointer (ADR-0032) — it simply
   stops being the *only* way to find work.
5. **Receipts are backfillable** from the existing ledger — no data loss, and the projection is
   rebuildable.
6. **Connectors unchanged.** `currentIdentity?()` is optional; existing adapters compile untouched.
7. **Personal → Team.** Multi-actor = more `Actor` rows; `WorkItem.actorId` is present from day
   one; authorization arrives via the reserved `PolicyProvider`. **No Core replacement.**

---

## 18. Risks / overengineering traps — do NOT build in M3

| # | Trap | Why not |
|---|---|---|
| 1 | Graph database / generic graph abstraction | zero demonstrated need; two typed relations suffice |
| 2 | Universal event sourcing | ledger already answers the questions; would reassign ownership across 6 capabilities |
| 3 | `Workflow` engine | still `[LATER]`; `WorkItem` is not a workflow |
| 4 | `Decision` as an aggregate | a `ResourceRef` with `kind: 'decision'`, or an ADR file |
| 5 | Full multi-agent runtime | ADR-0008 defers it; M3D is config + assignment only |
| 6 | Scheduler in M3A–M3D | boundary defined, implementation M3E |
| 7 | Cloud-computer-per-agent | rejected; `WorkspaceProvider` implementations only |
| 8 | Team permissions / `PolicyProvider` | brief says not yet; keep the seam reserved |
| 9 | MCP types in Core | hard boundary; adapter package only |
| 10 | Connector **write** paths without approval | contradicts ADR-0072 and the risk model |
| 11 | Waiting for all 6 connectors before shipping value | M3A-1 ships on Jira + GitHub alone |
| 12 | Merging `Resource` and `Artifact` | **violates a §4 hard rule** |
| 13 | Making `Approval` work-scoped | breaks plan-scoped integrity that `ApprovalRef` enforces |
| 14 | Adding to `ConversationRuntimeDeps` | it must shrink, not grow (§14) |
| 15 | Solving the multi-turn relational-continuity carryover here | separate reliability carryover; needs deterministic semantic grounding tests, not an architecture change |

---

## 19. First implementation slice (recommendation only — do NOT implement)

### **M3A-1 — Personal Work Surface (read-only, Jira + GitHub)**

**Goal.** In Discord, "what do I need to work on?" returns one ranked list combining Jira
issues assigned to the actor and GitHub PRs awaiting them — read-only, no writes, no agents.

**Scope (in).** `ResourceRef` value object; minimal `WorkItem` aggregate + `WorkItemRepository`
+ one additive migration; `ConnectorProvider.currentIdentity?()` (optional); `Actor.identities`
config mapping for jira/github; `WorkSurfaceQuery` composition service; a read-only
`listMyWork(identity)` read path on repository hosting; one new intent/capability route to
present the surface.

**Scope (out).** Slack, Confluence, Figma; any write; MCP; receipts; `AgentProfile`; handoff;
triggers; scheduler; ranking sophistication beyond a documented deterministic order.

**Reused (not rebuilt).** `Actor` + `ExternalIdentity` + `findByExternalIdentity`;
`ConnectorProvider` + `ConnectorManager` + Jira adapter; `RepositoryHostingProvider` +
`GitHubAppAuth`; config-gated registration incl. safe degradation; `StorageProvider` repository
pattern; `Artifact` for rendering; `RiskPolicy` (read-only ⇒ LOW, no approval);
`ResponseComposer`; Memory (`CONNECTOR` type) for surface caching if useful.

**New.** `domain/resource.ts` (`ResourceRef`); `domain/work-item.ts` (`WorkItem`);
`ports` addition to `StorageProvider` (`workItems`); `application/work-manager.ts` (CAP-011);
`application/work-surface-query.ts` (read model); one migration; `listMyWork` read method on
the repository-hosting port.

**Validation.** Unit: `ResourceRef` identity/equality; `WorkItem` lifecycle; identity mapping
resolution both directions; deterministic ranking. Integration: two fake connectors →
one merged surface; a connector that is unavailable degrades to a partial surface with an
explicit note (never a silent empty list); an unmapped identity yields a clear
actionable message rather than an empty result. Boundary: no MCP/Discord/SQLite type in Core;
`ConversationRuntimeDeps` member count **unchanged or lower**; `Resource` and `Artifact`
remain distinct. Migration: forward-only, additive, existing rows untouched. Live UAT only
after Chief Architect review, under existing approval boundaries.

**Architecture review points.** (1) after `ResourceRef`/`WorkItem` domain types, before
persistence; (2) after the migration, before wiring; (3) after `WorkSurfaceQuery`, before the
conversation entry point; (4) final — confirm `ConversationRuntimeDeps` did not grow.

**Why this slice.** Smallest change delivering the stated near-term value, it activates a
ratified reserved seam rather than inventing a concept, and it puts the one structure
(`WorkItem`) that everything later depends on in place before anything is built on top of the
single-active-task limitation.

---

## 20. Chief Architect decisions required

Each item below is `CHIEF_ARCHITECT_DECISION_REQUIRED`.

| # | Decision | Recommendation | Touches |
|---|---|---|---|
| D1 | Introduce CAP-011 Work Model with `WorkItem` as a new aggregate | **APPROVE** | capability boundary, persistence ownership, migration |
| D2 | Activate `ResourceRef` `[RESERVE]` → `[NOW]` | **APPROVE** | ratified concept map |
| D3 | Work Model = **HYBRID** (narrow aggregate + read model); reject Work Graph as a new centre; rename to Work Model / Work Surface | **APPROVE** | architecture centre |
| D4 | Reject universal event sourcing; adopt `ExecutionReceipt` projected from the existing ledger | **APPROVE** | provenance model |
| D5 | Extend `ExternalIdentity` with optional fields + optional `ConnectorProvider.currentIdentity?()` | **APPROVE** | public port contract (additive) |
| D6 | New `ToolProvider` Core port; MCP strictly an adapter; supersede the ROADMAP MCP row | **APPROVE** | new Core port |
| D7 | `AgentProfile` as **config only** in M3D, completing ADR-0008's v1 half | **APPROVE** | amends ADR-0008 |
| D8 | `WorkHandoff` as a typed record carrying `ApprovalRef` (not prompt text) | **APPROVE**, M3D | cross-capability contract |
| D9 | `TriggerSource` boundary defined now, implemented in M3E | **APPROVE** definition only | reserved seam |
| D10 | Execution environment = `WorkspaceProvider` implementations only; reject computer-per-agent | **APPROVE** | rejects an alternative |
| D11 | Move `ResourceRef` + minimal `WorkItem` from M3C into M3A-1; split M3A | **APPROVE** | sequencing |
| D12 | ConversationRuntime boundary frozen; `ConversationRuntimeDeps` must not grow | **APPROVE** | amends ADR-0032 |
| D13 | Do **not** introduce a `Decision` aggregate in M3 | **APPROVE** (defer) | scope control |
| D14 | Correct doc↔source mismatches M1–M5 as a separate documentation task | **APPROVE** | doc integrity |
| D15 | Authorize ADR-0074…0081 to be drafted | **decision needed** — none drafted in this task | ADR surface |

**Not blocking this rebaseline:** production-grade 5C-EG remains `BLOCKED_CARRYOVER`; no
proposal here depends on production routing activation. Quoky remains DEGRADED and
feature-frozen; no proposal here depends on Quoky internals. The multi-turn relational-continuity
weakness stays a separate reliability carryover.
