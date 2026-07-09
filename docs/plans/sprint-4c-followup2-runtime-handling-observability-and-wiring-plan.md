# Sprint 4c-Follow-up-2 — CODE_IMPLEMENTATION Runtime Handling: Observability (Track B) + Wiring Fix (Track A) — PLAN-ONLY

> **PLAN-ONLY BOUNDARY.** This document is the only deliverable. It makes **no code change**, creates **no
> branch/commit/PR**, retries **no UAT**, mutates **no sandbox**, runs **no manual git/gh/GitHub API**, and changes
> **no GitHub App auth / token flow**. It records the read-only investigation and specifies a two-track fix for a
> **future, separately-approved** implementation. Product: **Quoky (formerly ChunsikBot V2)**.

- **Status:** PLAN-ONLY. **CA review: APPROVED WITH CHANGES (2026-07-09, round 1) — split folded in (§0.1); awaiting
  CA final review.** Implementation split: **Track B (observability) is the ONLY next authorized slice; Track A
  (wiring) is DEFERRED / NOT APPROVED** until Track B produces the exact stack evidence. No execution authorized here.
- **Base:** `main @ 6b46700e8e914b82e8f2cecc9d39ffe222f12718` (Sprint 4c-Follow-up Preview Intent Routing Fix,
  ADR-0062, merged & cleaned up). Node 22 baseline: `typecheck` 0 / **51 files · 1131 tests** green.
- **Trigger:** Gate 4B Scenario C attended window BLOCKED — the preview intent routing fix worked through
  classification, but CODE_IMPLEMENTATION runtime handling then threw `Cannot read properties of undefined
  (reading 'save')`. See `docs/plans/sprint-4c-gate4b-uat-result-record.md` and the CA runtime-handling direction.
- **Investigation method:** read-only source inspection only. No code/branch/commit/PR/sandbox/UAT/git action taken.

---

## 0.1 CA review outcome — APPROVED WITH CHANGES (2026-07-09, round 1)

CA approved the plan direction (Track B observability first; Track A wiring after the stack pinpoints the failing
`.save()`; the confirmed fake-orchestrator test gap). **Required change — the implementation is split; both tracks
are NOT approved at once:**

```text
- Track B (observability) is the ONLY next authorized implementation slice.
- Track A (wiring/dependency fix) is DEFERRED / NOT APPROVED until Track B provides the exact failing `.save()`
  file/function/line + undefined object; it then proceeds under a SEPARATE plan / review / approval.
- Any minimal reproduction run after Track B merges is DIAGNOSTIC-ONLY — it is NOT Gate 4B UAT and must not be
  recorded as a success path.
- If that reproduction could mutate the sandbox, CA approval is REQUIRED before running it (return to CA first).
```

Still NOT approved: Track A implementation · any `.save()` wiring fix · UAT retry · sandbox mutation · Gate 5 · Gate 6.

---

## 1. Problem statement

```text
- Gate 4B Scenario C is BLOCKED AFTER a successful CODE_IMPLEMENTATION classification.
- This is NOT a GitHub App auth failure (the App path was never reached).
- This is NOT the previous preview intent-routing failure (that is fixed — ADR-0062).
- A runtime exception occurred BEFORE any preview / approval / workspace mutation / git / push / PR.
- The exact failing `.save()` cannot be confirmed from the current logs (no stack trace).
```

---

## 2. Evidence

```text
Observed logs (secret-free, relayed):
  [chunsik] intent classified capability=CODE_IMPLEMENTATION requiresWork=true      (conversation-runtime.ts:1890)
  [chunsik] inbound handling failed error=Cannot read properties of undefined (reading 'save')  (apps/chunsik/src/main.ts:47)

Missing diagnostic data (why it is undiagnosable):
  - no stack trace          - no file/function/line      - no dependency/object name
  - no correlation id        - no structured stage         - capability/intent not attached to the error log
```
The catch at `apps/chunsik/src/main.ts:47` logs only `{ error: err instanceof Error ? err.message : String(err) }`
— it discards `error.name`, `error.stack`, and `error.cause`, and carries no stage/capability/intent/session context.
(The approval-handler catch at `main.ts:54` has the same shape.)

---

## 3. Root-cause status (NOT confirmed without a stack trace)

```text
- The exact `.save()` source is NOT confirmed.
- Most likely LOCUS: the REAL CODE_IMPLEMENTATION planning / approval / persistence chain
  (ExecutionOrchestrator → PlanningManager → ApprovalManager → storage), which is faked in the tests.
```

**Path (verified):** `handle()` → `classify` (`:1890`) → `handleExecutionIntent` (`:1905`→def`:4484`) →
`resolveExecutionWorkspace` (needs active project + opened workspace) → target-file validation (`:4496`) → EITHER
no-path → `scopeClarificationFlow.anchor` (`:4512`) + a "which file?" reply, OR path → `runResolvedExecution`
(`:4527`) → `intentResolver.resolve` (`:4561`) → **`orchestrator.run`** (`:4572`) → on AWAITING_APPROVAL →
`approvalFlow.anchor` (`:4574`). **No `.save()` exists directly in `ConversationRuntime`.**

**Static candidate classification:**
```text
- ExecutionOrchestrator / PlanningManager path                              → LIKELY (locus)
    Only exercised live (tests fake the orchestrator — §4); the real planning/approval/persistence chain is where
    an undefined dependency would first surface. Exact undefined object within it is UNCONFIRMED without the stack.
- ApprovalManager → this.storage.approvals.save (approval-manager.ts:40,59)  → POSSIBLE
    Reached via orchestrator.run → approval.requestFor. But `storage.approvals` is TypeScript-guaranteed and
    `storage.init()` IS awaited (main.ts:60) before `platform.start()` (main.ts:63) — so a plain undefined-repo is
    unlikely; possible only via a DI/wiring subtlety.
- approvalFlow.anchor persistence (store.tasks/sessions.save)                 → LOWER-LIKELIHOOD
    Its stores were already exercised by the pre-classify approvalFlow.findPending (:1512) without throwing.
- scopeClarificationFlow.anchor persistence (store.tasks/sessions.save, :79-80) → ELIMINATED
    Same stores exercised by the pre-classify findPending/findAnchor (:1512/1521/1528) without throwing; and the
    no-path route returns a "which file?" reply, not the failing path.
```
**Discipline: do NOT declare a confirmed root cause until the stack trace (Track B) pinpoints it.**

---

## 4. Confirmed test gap

```text
- packages/core/src/application/conversation-runtime.test.ts injects a FAKE orchestrator (line 796).
- Therefore the REAL ExecutionOrchestrator → PlanningManager → ApprovalManager → persistence chain is NOT covered.
- This is exactly how 51 files / 1131 tests stayed green while the live runtime failed on the real chain.
```

---

## 5. Track B — Error observability fix (FIRST)

**Goal:** make `inbound handling failed` (and the approval catch) emit **secret-free structured diagnostics** rich
enough to name the failing `.save()` on the next run.

```text
Enrich apps/chunsik/src/main.ts inbound catch (line 47) + approval catch (line 54) to log:
  - error.name
  - error.message
  - error.stack           (operator/development logs)
  - error.cause           (if available)
  - stage                 (inbound | classify | resolve | orchestrate | compose | persist)
  - capability            (if known)
  - intent type           (if known)
  - session id / message id / correlation id  (if available)
```
Additionally, propose threading a lightweight **stage/correlation context** through `ConversationRuntime.handle`
(and adjacent layers) so the emitted `stage`/`capability`/`intent`/`session id` are accurate rather than guessed —
without changing behavior or approval boundaries. Prefer a minimal, additive approach (e.g., wrap the handler body
so the outer catch has the turn's context) over invasive signature changes.

### 5.1 Secret redaction requirements (MANDATORY)

```text
NEVER logged (redacted before emit):
  - private key content            - GitHub App JWT             - installation access token
  - Authorization header value      - x-access-token             - GIT_APP_TOKEN
  - inline env secret               - QUOKY_GITHUB_APP_PRIVATE_KEY  - raw token-bearing remote URL
Redaction policy to implement:
  - token-like values redacted            - Authorization-like headers redacted
  - PEM/private-key blocks redacted        - x-access-token-bearing URLs redacted
  - env secret values redacted
Note: error.stack must be redaction-passed too (a stack frame or message could embed a token/URL).
```

---

## 6. Track A — Runtime wiring / dependency fix — **DEFERRED / NOT APPROVED** (after Track B stack evidence)

> **Track A is NOT authorized by this plan.** It is deferred until Track B is merged and a diagnostic reproduction
> yields the exact stack. Track A then proceeds only under a **separate CA plan / review / approval**. It is
> documented here only so the sequencing and regression-test intent are on record.

**Goal (future):** ensure CODE_IMPLEMENTATION handling no longer throws an undefined `.save()` — by fixing the
runtime composition / dependency wiring **based on the exact cause the stack reveals**, not on a guess.

```text
- ONLY after the Track B observability patch is merged, run a MINIMAL reproduction to capture the stack.
  · The reproduction is DIAGNOSTIC-ONLY — it is NOT Gate 4B UAT and must not be recorded as a success path.
  · It must NOT mutate the sandbox. If any reproduction step could mutate the sandbox, STOP and get CA approval
    FIRST (return to CA before running it).
  · Record the stack trace secret-free.
- From the stack: identify the exact `.save()` file/function/line, the undefined object, and the missing
  provider/adapter/store.
- THEN write a separate Track A plan for CA review; fix the runtime composition / wiring for exactly that cause.
  No speculative wiring changes before the exact cause is known and separately approved.
```

### 6.1 Regression test plan (close the test gap)

```text
- Add an integration test that exercises the REAL ExecutionOrchestrator / PlanningManager / ApprovalManager path
  for a CODE_IMPLEMENTATION planningOnly turn (NOT a fake orchestrator).
- Assert: a preview/code-change request classified to CODE_IMPLEMENTATION drives the real orchestrator path, a
  planningOnly approval + its persistence `.save()` target exists (no undefined dependency), AWAITING_APPROVAL is
  produced, and NO workspace mutation / NO git command occurs.
- Keep the existing fake-orchestrator tests; this adds real-chain coverage, it does not replace them.
```

---

## 7. Constraints (binding for the future implementation)

```text
- no GitHub App auth / token-flow changes
- no approval-boundary relaxation
- no apply / commit / push / PR automation
- no UAT retry in this plan or in Track B/A implementation
- no sandbox mutation
- no manual git / gh / GitHub API
- no Gate 5 / Gate 6
```

---

## 8. Acceptance criteria

### 8.1 Track B (this slice — authorized next)
```text
- inbound runtime errors include safe structured diagnostics
- error.name logged; error.message logged; error.stack available in operator/dev logs; error.cause logged if present
- stage / capability / intent / session id / message id / correlation id included when available
- all secrets redacted (per §5.1), including within error.stack
- runtime behavior preserved; approval boundaries unchanged; GitHub App auth / token-flow unchanged
- NEW tests cover: the structured error serializer; redaction of token-like values; redaction of Authorization
  headers; redaction of x-access-token URLs; redaction of PEM / private-key blocks; stack redaction
- Node 22 typecheck exit 0; pnpm test green — existing 51 files / 1131 baseline stays green (+ the new tests)
```

### 8.2 Track A (DEFERRED — for the separate, later slice; NOT part of this authorization)
```text
- the undefined `.save()` source is identified from the Track B stack (exact file/function/line + undefined object)
- CODE_IMPLEMENTATION planningOnly path gains ≥1 REAL-orchestrator integration test (test gap closed)
- the wiring fix is separately CA-reviewed; Node 22 typecheck 0 / tests green
```

---

## 9. Sequencing

```text
1. plan-only (this document)
2. CA final review
3. implement Track B (observability) ONLY — secret-free structured logging   [the only authorized next slice]
4. PR → CA review → merge
5. run a DIAGNOSTIC-ONLY minimal reproduction to obtain the stack (secret-free); NOT Gate 4B UAT, NOT a success path.
   If it could mutate the sandbox → STOP and get CA approval FIRST.
6. with the exact stack in hand → write a SEPARATE Track A plan → CA review/approval → implement the wiring fix +
   the real-orchestrator regression test.   [Track A is NOT approved until here]
7. ONLY after both tracks are resolved: reopen Gate 4B Scenario C in a new attended window (fresh §2 preflight,
   from the preview stage).
```

---

## 10. Forbidden now (this plan-only step)

```text
- code change · branch creation · commit · PR · UAT retry · sandbox mutation · manual git/gh/GitHub API ·
  Gate 5 / Gate 6 · token/private key/JWT/Authorization-header output
```

---

## 11. Stop condition (this document)

Plan-only. **This document is the sole deliverable.** No implementation, no branch/commit/PR, no UAT retry, no
sandbox mutation, no App-auth change. After writing this plan, **stop and request CA review.** Implementation of
Track B (then Track A) proceeds only under separate CA approval, following §9.
