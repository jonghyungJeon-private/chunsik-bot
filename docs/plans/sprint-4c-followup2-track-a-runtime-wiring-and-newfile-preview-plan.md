# Sprint 4c-Follow-up-2 — Track A — Runtime Storage-Wiring Fix (A1) + New-File Preview Handling (A2) — PLAN-ONLY

> **PLAN-ONLY BOUNDARY.** This document is the only deliverable. It makes **no code change**, creates **no
> branch/commit/PR**, retries **no UAT**, mutates **no sandbox**, runs **no manual git/gh/GitHub API**, and changes
> **no GitHub App auth / token flow**. It specifies the Track A fix for a **future, separately-approved**
> implementation. Product: **Quoky (formerly ChunsikBot V2)**.

- **Status:** PLAN-ONLY. **CA approved a Track A plan-only doc (2026-07-09); implementation NOT approved.** Awaiting
  CA review of this plan.
- **Base:** `main @ 3fe78a0358fa2723caa62cef5fd6f3e8deeb1122` (Track B observability merged, PR #41). Node 22
  baseline: `typecheck` 0 / **52 files · 1143 tests** green.
- **Trigger:** the Track B diagnostic reproduction captured the redacted stack for the Gate 4B Scenario C runtime
  crash. Predecessor: `docs/plans/sprint-4c-followup2-runtime-handling-observability-and-wiring-plan.md`
  (Track B, merged). Two distinct issues, per CA direction: **A1** wiring defect (the crash) and **A2** new-file
  preview handling (a separate behavior gap).

---

## 1. Problem statement

```text
A1 (the crash): a fresh CODE_IMPLEMENTATION request that reaches the scope-clarification path throws
    TypeError: Cannot read properties of undefined (reading 'save')
    at StatelessScopeClarificationFlow.anchor — this.store.tasks is undefined.
A2 (separate behavior): the diagnostic request asked to CREATE a new file (docs/uat/github-app-auth-smoke.md).
    Target validation only matches EXISTING files, so a create-new-file preview request falls into scope
    clarification instead of preview generation. This is NOT the crash; it is a distinct routing/behavior gap.
Neither is a GitHub App auth failure. Both surface only in the live runtime, not the current test suite.
```

---

## 2. Confirmed root cause (A1) — from the Track B diagnostic stack

Captured (secret-free): `errorName=TypeError`, `errorMessage=Cannot read properties of undefined (reading 'save')`,
`errorStack` top frame `StatelessScopeClarificationFlow.anchor (…/stateless-scope-clarification-flow.js:74:32)`.

```text
Failing source : packages/core/src/application/stateless-scope-clarification-flow.ts
Function       : StatelessScopeClarificationFlow.anchor
Source line    : 79 — await this.store.tasks.save(task)   (dist :74)
Undefined object: this.store.tasks  (the injected TaskRepository)

Mechanism (CONFIRMED): eager destructuring of not-yet-initialized storage repositories at composition time.
  1. app.module.ts builds the flow as: new StatelessScopeClarificationFlow({ sessions: storage.sessions,
     tasks: storage.tasks }) — reading the VALUES at construction time.
  2. The Nest ConversationRuntime factory runs during NestFactory.createApplicationContext(AppModule) (main.ts:35),
     which is BEFORE `await storage.init()` (main.ts:60).
  3. The sqlite StorageProvider declares `sessions!` / `tasks!` / `approvals!` (definite-assignment; undefined until
     init assigns them at index.ts:447-448).
  4. So the flow captures { sessions: undefined, tasks: undefined }. init() later populates storage.sessions/.tasks
     on the storage OBJECT, but the flow's captured snapshot is never updated.
  5. A fresh CODE_IMPLEMENTATION request with no existing target → scope-clarification path → anchor() →
     this.store.tasks.save(task) → undefined.save → TypeError.
```

**Why the current suite missed it (confirmed test gap):** the ConversationRuntime tests inject fake, fully-populated
flows/stores, so the pre-init ordering never manifests. **`SessionManager` is unaffected — VERIFIED:** it is wired
as `new SessionManager(storage)` (holds the live `StorageProvider` object) and dereferences `this.storage.sessions`
at **call time** (session-manager.ts:32/37/42), so it always sees the post-init repo. This is the proven-safe
pattern the flows should mirror.

**Affected flows (all three share the eager-destructure wiring; scope-clarification just surfaces first):**
`StatelessScopeClarificationFlow` (`{sessions,tasks}`) · `StatelessApprovalFlow` (`{sessions,tasks,approvals}`) ·
`StatelessApplyPreviewFlow` (`{sessions,tasks}`). Each: `constructor(private readonly store: XFlowStore)`, wired at
`app.module.ts:435/443/451` with an eagerly-destructured object.

---

## 3. A1 — fix strategy options (compared)

Judgment criteria (CA §6): preserves manager/capability independence · avoids the init-order footgun · minimizes
composition churn · keeps runtime behavior unchanged except fixing the crash · works for ALL affected flows.

```text
Option 1 [RECOMMENDED] — flows hold the live storage seam, dereference lazily (mirror SessionManager).
  Change: pass the live StorageProvider (or lazy repo accessors) to the flows instead of an eager
  { sessions: storage.sessions, tasks: storage.tasks } snapshot. The flow bodies ALREADY access this.store.tasks /
  this.store.sessions at CALL time, so once `this.store` is the live object, `this.store.tasks` resolves the
  post-init repo. To make intent explicit and prevent regression, narrow the flow store types to
  Pick<StorageProvider,'sessions'|'tasks'(|'approvals')> (or accept StorageProvider) so a pre-init snapshot cannot
  be passed.
  + preserves independence (flows still depend only on the storage repository seam)
  + structurally removes the footgun (no captured values; deref is always post-init)
  + minimal churn (~3 wiring lines in app.module + 3 flow constructor signatures; call sites unchanged)
  + behavior unchanged except the crash is fixed; works for all three flows uniformly
  + matches the already-proven SessionManager pattern
  − relies on the flow accessing repos at call time (it does today; a lint/test guard should lock this in)

Option 2 — construct the flows AFTER storage.init().
  + conceptually simple
  − fights Nest DI: the ConversationRuntime factory runs at context creation, before the explicit init() in
    bootstrap; reordering DI construction vs init is awkward and fragile
  − re-introducible footgun (any future construction move breaks it again); does not remove the root hazard
  − larger composition churn / ordering coupling

Option 3 — an "initialized storage facade" that guarantees repos exist before flow construction.
  + strongest invariant
  − heaviest churn; a new abstraction over StorageProvider; more surface than the defect warrants
```
**Recommendation: Option 1.** It removes the hazard structurally with the least churn and mirrors the proven
`SessionManager` wiring. The plan defers final selection to CA.

---

## 4. A2 — new-file preview handling (separate from A1)

```text
Current: handleExecutionIntent (conversation-runtime.ts:4496-4525) extracts target-path candidates from the message,
  calls workspace.list(workspaceRef, candidate), and only sets targetFiles when a returned hit normalizes to the
  candidate — i.e. ONLY existing files match. A new-file path → no match → scope clarification.
Goal: an EXPLICITLY-specified new file path in a preview/code-change request should reach planning/preview, not be
  bounced to scope clarification solely because the file does not exist yet.
```

**Proposed direction (for CA review — do not implement):**
```text
- Accept an explicitly-provided, path-safe, in-workspace file path as a valid target REFERENCE for planning/preview
  even if it does not yet exist (a "create new file" preview = a proposed create; diff against empty).
- Require the path to be explicit in the user request; keep scope clarification for ambiguous / missing paths.
- Do NOT broaden to arbitrary path creation without validation: enforce the existing path-safety
  (normalizeRelativePath, no `..` traversal, within workspace) and a bounded candidate count.
- Preserve ALL safety: preview generation performs NO workspace mutation; apply still requires the separate
  approval; no commit/push/PR. A2 changes ROUTING/target-resolution only, never the approval lifecycle.
Open design questions for CA:
  - how to distinguish "explicit new-file path" from a typo/ambiguous path (require an exact, well-formed relative
    path token? require a create verb + path?),
  - whether the preview renderer handles a target with no existing content (diff vs empty file),
  - interaction with ADR-0036 (validated target before Planning/Approval) — A2 widens "validated target" to include
    an explicit new path, without weakening the approval gate.
```

---

## 5. Tests required (in the eventual implementation)

### A1 tests
```text
- a real-composition test that represents the storage.init() ordering (flows constructed before init, exercised
  after init) and asserts flows do NOT hold undefined repositories
- StatelessScopeClarificationFlow.anchor persists task/session after init (no undefined .save())
- StatelessApprovalFlow persists its approval-anchor task/session after init
- StatelessApplyPreviewFlow persists its preview/apply anchor after init
- no regression to existing approval boundaries
```

### A2 tests
```text
- CODE_IMPLEMENTATION preview-only request with an EXPLICIT new file path → routes to planning/preview, NOT scope
  clarification
- the request stays planning/preview only: no workspace mutation, no git command, no approval/apply/commit/push/PR
  bypass
- an ambiguous/missing path STILL triggers scope clarification (unchanged)
- path-safety preserved (traversal / out-of-workspace paths rejected)
```

### Integration test (closes the confirmed test gap)
```text
- exercise the REAL ExecutionOrchestrator / PlanningManager / ApprovalManager path (not a fake orchestrator) for the
  live failure path: CODE_IMPLEMENTATION + explicit new file path + preview-only request
- assert the previous crash path (scope-clarification anchor persistence) no longer throws
```

---

## 6. Constraints (binding for the implementation)

```text
- no GitHub App auth / token-flow changes
- no approval-boundary relaxation; no automatic apply / commit / push / PR
- no sandbox mutation during implementation; no Gate 4B UAT retry in this plan
- no Gate 5 / Gate 6
- A1 and A2 stay logically separated (may be one PR with two clearly-scoped commits, or two PRs — CA's call at
  implementation-approval time)
```

---

## 7. Acceptance criteria (for the eventual Track A implementation)

```text
- the undefined `.save()` crash is fixed for ALL affected stateless flows (scope-clarification / approval / apply-preview)
- storage init-order is safe and deterministic; affected flows no longer capture undefined repositories
- SessionManager re-confirmed unaffected (or brought onto the same safe pattern if the fix generalizes)
- an explicit new-file preview request reaches planning/preview rather than scope clarification (A2)
- preview remains non-mutating; approval boundaries remain intact
- real-chain integration coverage added (no fake orchestrator for the live failure path)
- Node 22 `pnpm typecheck` exit 0; `pnpm test` green (≥ 52 files / 1143 baseline + new tests)
```

---

## 8. Sequencing

```text
1. plan-only (this document)
2. CA review / approval of Track A implementation scope (A1 required; A2 as scoped)
3. implement on a dedicated branch (Option 1 for A1 unless CA selects otherwise) + the §5 tests
4. validate on Node 22 (typecheck + test)
5. PR → CA implementation review → merge (normal gated steps)
6. ONLY after merge: a new attended Gate 4B Scenario C window (fresh §2 preflight, from the preview stage),
   with the smoke request now reaching preview instead of crashing
```

---

## 9. Stop condition (this document)

Plan-only. **This document is the sole deliverable.** No code change, no branch/commit/PR, no UAT retry, no sandbox
mutation, no App-auth change, no Gate 5/6. After writing this plan, **stop and request CA review.** Track A
implementation proceeds only under a separate CA approval, following §8.
