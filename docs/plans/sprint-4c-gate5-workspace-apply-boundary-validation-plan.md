# Gate 5 — Workspace-Apply Boundary Validation Plan (PLAN ONLY)

**Status decision in force:** `GATE_5_PLAN_REQUEST_APPROVED` / `GATE_5_EXECUTION_NOT_APPROVED`.
This document is plan-only. No execution, no workspace apply, no branch/commit/push/PR, no sandbox
mutation, no Gate 6. Product `main = e6e1b93bb4406dab02eb6cba1d0556329b002def`; UAT sandbox baseline
`d837496fed10fab3da14aea2c4b2761afbbfbfe0` (must remain unchanged).

---

## 0. Grounding — what already exists (read-only findings)

| Concern | Current state (verified in code) |
|---|---|
| Sole file mutator | `WorkspaceWriteManager` (`workspace-write-manager.ts`) via `workspace-writer.port.ts`. |
| Patch / CodeGeneration | Representation/generation only — no filesystem mutation. |
| Separate apply approval | `StatelessApplyPreviewFlow` (`stateless-apply-preview-flow.ts`), anchor discriminator `code-preview-apply`, deliberately distinct from the plan/preview `ApprovalRequest` (which carries `planId`). No implicit carry-over. |
| Runtime wiring | `ConversationRuntime` depends on `ApplyPreviewFlow.findAnchor` (line ~1533) and `workspaceWrite.apply(ApplyInput): Promise<WorkspaceChange>` (line ~613); `WORKSPACE_APPLIED` = Sprint 2u / ADR-0042. Composed in `apps/chunsik/src/app.module.ts`. |
| Scenario C code-change diff preview | Ends read-only with footer `이 제안을 실제로 적용하는 기능은 아직 지원하지 않아요` (`response-composer.ts:569`). The **code-change diff-preview path does not offer apply**. |
| Existing apply tests | `stateless-apply-preview-flow.test.ts` (12), `workspace-write-manager.test.ts` (9), `workspace-manager.test.ts` (3) — all green. |

**Key consequence:** the wired, user-reachable apply boundary is the **patch-apply flow** (Sprint 2s→2u:
Explicit Preview Apply Approval → Approved Apply Context → PatchRef → WorkspaceWrite Apply). The
*code-change* (Scenario C) diff preview is intentionally read-only today. Gate 5 must therefore choose an
apply fixture appropriate to the **existing apply flow**, not assume Scenario C's preview is applied
(matching CA §1).

---

## 1. Purpose

Validate that the **real** workspace-apply boundary behaves exactly as designed:
a **separately-approved** apply mutates **exactly one intended file via `WorkspaceWrite` and nothing else** —
zero command execution, zero Git mutation, zero unintended file changes — and is **fully reversible** to a
captured baseline. Validation is primarily **deterministic Internal QA**; an attended live-apply UAT is a
thin confirmation on a disposable target.

---

## 2. Architecture invariants the plan preserves (CA §2)

- **Patch** — representation/generation only; never mutates the filesystem.
- **WorkspaceWrite** — the sole owner of file mutation; invoked exactly once, only after apply approval.
- **Approval** — apply authorization is explicit and separate; no carry-over from preview/plan approval
  (enforced by the distinct `code-preview-apply` anchor).
- **Command Execution** — separate capability; not triggered by apply. Expected invocation count: 0.
- **Git** — no commit/push/PR under Gate 5. Expected Git mutation count: 0.

---

## 3. Gate 5 questions (CA §3)

### Q1 — Apply target — **RECOMMEND: A. dedicated ephemeral temp repository**
- **A. Dedicated ephemeral temp repo — RECOMMENDED.** Disposable, isolated, zero blast radius; rollback can
  be a whole-directory discard in addition to git-level restore. Used for both Internal QA (created per test
  run) and, if an attended UAT is run, a purpose-made disposable repo registered as the bot's active project.
- **B. Existing UAT sandbox — REJECTED as the mutation target.** It has served as an *immutable baseline*
  (`d837496…`) across every prior gate; mutating it destroys that invariant and conflates read-only
  observation with mutation. It stays read-only in Gate 5.
- **C. Product repository — FORBIDDEN.** Unacceptable blast radius.

### Q2 — Apply fixture — **CORRECTED per `GATE_5_FIXTURE_SWITCH_APPROVED`: single `update` of an existing file**
- **Path:** `gate5/apply-smoke.txt` (an **existing**, committed file in the disposable apply repo — never product/core).
- **Baseline content (present + committed at baseline):**
  ```
  gate5 apply smoke
  marker: PENDING
  ```
- **Applied content (single `update` op):**
  ```
  gate5 apply smoke
  marker: quoky-gate5-workspace-apply
  ```
- **Expected diff (single `update`, one hunk):**
  ```diff
  Index: gate5/apply-smoke.txt
  ===================================================================
  --- gate5/apply-smoke.txt
  +++ gate5/apply-smoke.txt
  @@ -1,2 +1,2 @@
   gate5 apply smoke
  -marker: PENDING
  +marker: quoky-gate5-workspace-apply
  ```
- **Justification:** the existing patch-apply flow is single-`update`-op only (`conversation-runtime.ts:2423-2425`);
  a one-line marker update to a committed file is deterministic, byte-verifiable, and rolls back to the exact
  baseline blob. (The earlier new-file/add fixture was rejected pre-`WorkspaceWrite` — see the CA Review Update.)

### Q3 — Approval sequence (no approval reused across boundaries)
```
1. preview request        (operator → bot)   : request an apply-capable preview of the fixture
2. plan approval          (operator: 승인)     : authorizes preview generation only
3. preview                (bot)               : complete PreviewArtifact, read-only, not applied
4. separate apply request (operator)          : an explicit, new "apply" request
5. separate apply approval(operator: 승인)     : a DISTINCT apply ApprovalRequest (code-preview-apply anchor)
6. apply result           (bot)               : WORKSPACE_APPLIED — exactly one WorkspaceWrite
```
Step 2's approval never authorizes step 6; step 5 is a fresh HIGH-risk apply approval.

### Q4 — Mutation boundaries
- **Allowed:** mutation of **one file only** (`gate5/apply-smoke.txt`), a **new file**, inside the ephemeral
  apply repo, via `WorkspaceWrite`.
- **Forbidden:** any other file; branch creation; index/staging; commit; push; PR; command/test execution.
- Default assumption adopted verbatim: **file mutation only — no staging, no commit, no push, no PR.**

### Q5 — Rollback
- **Pre-apply baseline capture:** record the ephemeral repo `git rev-parse HEAD` + `git status --porcelain`
  (clean) + confirm `gate5/apply-smoke.txt` absent.
- **Rollback method:** `git -C <repo> checkout -- .` + `git -C <repo> clean -fd` (removes the new untracked
  file); for a disposable temp repo, also acceptable to discard the entire directory.
- **Rollback verification:** HEAD == captured baseline, tree clean, `gate5/apply-smoke.txt` absent again.
- **Partial-apply failure handling:** if `WorkspaceWrite` reports a non-`APPLIED` / partial outcome, STOP,
  run rollback, verify baseline restored, and record `GATE_5_FAILED` (see §7).

### Q6 — Post-apply verification
- Target file exists / changed exactly as expected (byte-exact content match to Q2).
- Exact content fidelity (no truncation, no extra/mangled lines; diff equals Q2 expected diff).
- No unrelated file changes (`git status` shows only `gate5/apply-smoke.txt`).
- Workspace status captured before/after.
- Command/test execution count == 0; Git mutation count == 0.
- Apply outcome/result object == `WORKSPACE_APPLIED` (`WorkspaceChange`), `WorkspaceWrite` invocation == 1.

### Q7 — Safety / immediate-stop conditions
Stop immediately (and roll back) on any of: target path mismatch; unexpected extra file changes; any command
execution; any Git action; partial apply; rollback failure; UAT-sandbox baseline mismatch
(`d837496…` must never change).

---

## 4. Internal QA (CA §4) — before any attended apply UAT

Layers: **Unit → Integration → State-machine → Final isolated E2E.** All use an **ephemeral repository**,
**recording WorkspaceWrite / command / Git ports**, and a **QA transport** — never live Discord, never the
UAT sandbox.

- **Unit:** `WorkspaceWriteManager` writes exactly the intended path/content; rejects out-of-scope paths;
  is a pure single-file mutation. `StatelessApplyPreviewFlow` anchors/resolves only its own
  `code-preview-apply` anchor and never an approval-anchor Task (`planId` present).
- **Integration:** apply ApprovalRequest is a distinct record from the plan/preview approval; resuming an
  apply approval invokes `workspaceWrite.apply` once and returns `WORKSPACE_APPLIED`.
- **State-machine:** two-approval sequence (Q3). Assert preview approval alone does **not** trigger any
  `WorkspaceWrite`; only the separate apply approval does.
- **Final isolated E2E** (through the real runtime/application boundary), must verify:
  ```
  preview approval  != apply approval        (distinct ApprovalRequests / anchors)
  workspace writer invocation count == 1      ONLY after apply approval (0 before)
  command executor invocation count == 0
  git mutation count == 0
  only the intended file changed
  rollback returns the workspace to baseline
  ```
  Harness: ephemeral temp git repo + recording ports (workspace writer / command / git) + deterministic
  code/patch substitute + QA transport adapter (same shape as the F5/F6 final E2E).

**Internal QA gate:** `INTERNAL_QA_RESULT=PASS` and `GATE5_FINAL_E2E=PASS` are prerequisites for any attended
apply UAT, verified by an independent QA subagent that inspects the code and attempts to falsify.

---

## 5. Required plan output (CA §5)

```
GATE_5_PLAN_STATUS:
READY (pending CA answers to OPEN_QUESTIONS before execution)

RECOMMENDED_TARGET:
A dedicated ephemeral/disposable temp git repository (NOT product, NOT the existing read-only UAT sandbox)

APPLY_FIXTURE:
- path:    gate5/apply-smoke.txt   (new file)
- content: "gate5 apply smoke\nmarker: quoky-gate5-workspace-apply\n"
- expected diff: new-file add @@ -0,0 +1,2 @@ (see Q2)

APPROVAL_FLOW:
preview request → plan approval(승인) → preview → SEPARATE apply request → SEPARATE apply approval(승인) → apply result
(no approval reused across boundaries; apply = distinct code-preview-apply anchor)

MUTATION_SCOPE:
- allowed:   one new file (gate5/apply-smoke.txt) via WorkspaceWrite, in the ephemeral apply repo
- forbidden: any other file, staging, commit, push, PR, command/test execution, sandbox mutation

ROLLBACK:
- baseline:     ephemeral repo HEAD + clean tree + fixture absent (captured pre-apply)
- method:       git checkout -- . && git clean -fd  (or discard the temp repo)
- verification: HEAD == baseline, tree clean, fixture absent

INTERNAL_QA:
- required tests: Unit (WorkspaceWrite, ApplyPreviewFlow) / Integration / State-machine / Final isolated E2E
- final E2E assertions: preview-approval != apply-approval; WorkspaceWrite==1 only post-apply-approval;
  command==0; git==0; only intended file changed; rollback restores baseline

ATTENDED_UAT:
- preflight:  fresh post-build runtime; env/auth prod shape; ephemeral apply repo registered as active project;
              apply repo + UAT sandbox baselines captured; read-only
- execution:  the Q3 six-step sequence, recorder-only (operator sends messages; Claude never sends 승인)
- evidence:   apply result object, WorkspaceWrite==1, command==0, git==0, byte-exact fixture, rollback verified,
              UAT sandbox still d837496 unchanged

STOP_CONDITIONS:
- target mismatch / extra file changes / command execution / git action / partial apply / rollback failure /
  UAT-sandbox baseline mismatch / any preview-approval-triggered mutation

OPEN_QUESTIONS:
- OQ1: Scope — is Gate 5 validating the ALREADY-WIRED patch-apply flow, or must the CODE-CHANGE (Scenario C)
  diff-preview path also gain apply exposure? The code-change preview currently ends read-only
  ("적용 기능 미지원", response-composer.ts:569). If apply-for-code-change is required, that is a PREREQUISITE
  implementation sub-gate (plan-first, CA-gated), not part of this validation.
- OQ2: For the attended live UAT, confirm the ephemeral apply repo is registered as the bot's active project
  (operator setup) so the existing UAT sandbox baseline d837496 is never the mutation target.
- OQ3: Is an attended live-apply UAT required at all, or is the deterministic Internal QA final E2E sufficient
  for Gate 5 sign-off (attended UAT deferred until code-change apply exposure exists)?
- OQ4: Confirm Git remains entirely out of scope for Gate 5 (file mutation only), per §2/§Q4 default.
```

---

## 6. Still forbidden under this approval (CA §6)

No Gate 5 execution, no workspace apply, no sandbox mutation, no branch creation, no commit, no push, no PR,
no live Discord apply test, no Gate 6.

## 7. Stop condition

After delivering this plan: **stop** and wait for CA review + a separate implementation/execution approval.
`GATE_5_FAILED` / `GATE_5_BLOCKED` classifications apply only during a future approved execution, per Q5/Q7.

---

# CA Review Update — decisions incorporated + FIXTURE BLOCKER

Applying `GATE_5_PLAN_APPROVED_WITH_CHANGES` / `GATE_5_INTERNAL_QA_IMPLEMENTATION_APPROVED`
/ `LIVE_GATE_5_EXECUTION_NOT_APPROVED`.

## Decisions locked in
- **OQ1** — Validate the **existing patch-apply flow** only. No apply exposure for the Scenario C
  code-change preview (its `적용 기능 미지원` footer stays correct). Any code-change apply = separate plan.
- **OQ2** — Live target = a **dedicated disposable Gate 5 repo** (operator-registered active project). Never
  product, never `quoky-uat-sandbox` (immutable read-only ref `d837496…`).
- **OQ3** — Attended live apply UAT is **required** (Internal QA is a prerequisite, not sufficient).
- **OQ4** — Git is **out of scope**: bot-side staging/commit/push/PR/branch counts must all be 0. Operator-side
  repo setup / baseline capture / rollback are administrative and reported separately.
- Rollback (CA §3): bot never runs rollback; delete only `gate5/apply-smoke.txt` then verify HEAD/clean/absent;
  broad `git clean -fd` only under the four guards; whole-repo discard acceptable post-evidence.

## ⛔ BLOCKER — approved fixture is incompatible with the approved scope

The existing patch-apply flow (Sprint 2u, ADR-0042) that OQ1 scopes Gate 5 to is **single-`update`-op only**.
The runtime guard at `packages/core/src/application/conversation-runtime.ts:2423-2425` rejects any apply whose
PatchSet is not exactly one operation with `operation === 'update'`:

```
patchSet.operations.length !== 1 || … || op.operation !== 'update'  →  reply "apply failed", NO WorkspaceWrite
```

Existing test `conversation-runtime.test.ts:2829` ("op is add (CA 24)") already asserts an `add` op →
`workspaceApply == 0`. The fs writer (`packages/workspace-local/src/index.ts`) applies `update` ops via
`applyPatch` (unified diff) against **existing** file content.

**Consequence:** the CA-approved fixture `gate5/apply-smoke.txt` **"absent at baseline"** is a new-file `add`.
Under the approved scope it would be **rejected before `WorkspaceWrite`**, so the mandatory §7 assertion
`apply approval → WorkspaceWrite == 1` **cannot pass** with that fixture. Applying a *new* file would require a
production change (extend patch-apply to accept `add`, or add apply to the code-change path) — both explicitly
**out of scope** (OQ1 + §6 "no production behavior changes").

### Recommended resolution (fixture change — needs CA confirmation)
Use a single **`update` to an existing** disposable file:
- **Baseline (operator-seeded, committed):** `gate5/apply-smoke.txt` =
  ```
  gate5 apply smoke
  marker: PENDING
  ```
- **Applied (single `update` op / unified diff):** marker line → `marker: quoky-gate5-workspace-apply`
- Post-apply: file present, byte-exact updated content, only this file changed.
- Rollback: restore the one file to the baseline blob; verify HEAD unchanged, tree clean, marker back to `PENDING`.
This keeps the file **present** at baseline (contradicts "absent at baseline") but is the only shape compatible
with the update-only flow. **CA must confirm** the fixture switch (new-file→existing-file-update) before the
final E2E + live UAT are built, since the fixture drives every §7 content/rollback assertion.

## Existing coverage already satisfies most §7 boundary assertions (Sprint 2u)
| §7 assertion | Existing evidence |
|---|---|
| apply approval → WorkspaceWrite == 1 | `conversation-runtime.test.ts` CA 1 (2746) |
| apply result == WORKSPACE_APPLIED | CA 2 (2755) |
| command executor == 0 / test runner == 0 | CA 42 (2925) |
| Git ports == 0 | CA 43 (2926-2927) + OQ4 (no git-mutation call on apply path) |
| apply request before approval → WorkspaceWrite == 0 | CA 11/13 (2781), CA 32-34 (2879) |
| non-clean/invalid → no WorkspaceWrite | CA 15-31 (2807-2876) |

**Remaining NEW Gate-5-specific work (blocked on the fixture decision):** a cohesive final isolated E2E on an
ephemeral repo with the concrete fixture asserting **only-that-file** + **byte-exact content** + **rollback
restores baseline**, plus the independent-QA completion record. These three depend on the concrete fixture.

## Status
```
GATE5_INTERNAL_QA_STATUS: BLOCKED
Reason: approved new-file fixture is incompatible with the approved (update-only) patch-apply scope.
Awaiting CA confirmation of the update-to-existing-file fixture before building the final E2E + rollback QA.
```
