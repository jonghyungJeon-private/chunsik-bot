# Sprint 3b Plan — Explicit Pull Request Creation Approval (GIT_PUSHED → CRITICAL PR-creation approval halt, NO PR creation)

- **Status:** APPROVED WITH CHANGES (all 16 required changes applied) → implementing.
- **Base:** `main @ 9bcee0b56a00c7431ea6a514c29de7bff314015e`
- **Validation runtime:** Node 22
- **ADR (proposed):** ADR-0049
- **Predecessors:** ADR-0048 (Sprint 3a — push execution + `GIT_PUSHED` + pushed fields, the state 3b starts from),
  ADR-0047 (Sprint 2z — the push-**approval** template mirrored here: CRITICAL request → `*_APPROVAL_PENDING`
  → decision → `*_APPROVED`, no mutation), ADR-0045 (Sprint 2x — commit-approval decision flow),
  ADR-0025 (CAP-004 Approval — `requestForRisk`/`get`/`decide`, RiskLevel), ADR-0023 (CAP-002 Git — read-only).

## 1. Goal

From a `GIT_PUSHED` anchor (Sprint 3a — the approved commit was pushed to the approved upstream), an explicit
PR-creation phrase ("PR 만들어줘" / "pull request 만들어줘" / "GitHub PR 열어줘" / "PR 생성해줘" / "open a PR" /
"create pull request" / "merge request 만들어줘") records a **CRITICAL Pull-Request-creation approval** —
verify the pushed context, derive a **deterministic PR target** (head = pushed branch, base = fixed product
policy `main`) and a **bounded deterministic title/body**, create one `RiskLevel.CRITICAL` ApprovalRequest,
re-anchor `PR_APPROVAL_PENDING`, and return `AWAITING_APPROVAL`. **No Pull Request is created.**

On "승인" the approval is **recorded only** → `PR_APPROVED`; **still no PR is created**. Actual PR creation is
a later sprint (3c+) and, per CA Constraint 1, belongs to a **future Repository-Hosting/GitHub capability**,
NOT to Git.

```text
GIT_PUSHED
→ explicit PR-creation request ("PR 만들어줘" / "open a PR" / …)
→ reject PR bundled with deploy/merge/release/force/… (Constraint 10)         → composePrUnsupportedCompanion
→ verify complete + safe pushed context (Constraint 9)                         → composePrApprovalUnavailable
→ derive prHeadBranch = pushedBranch (safe), prBaseBranch = "main" (policy)
→ reject head == base (Constraint / Q8)                                        → composePrHeadEqualsBaseUnavailable
→ derive deterministic bounded prTitle / prBody (Constraint 8)
→ approvals.requestForRisk(CRITICAL, buildPrApprovalReason)                     ← CAP-004
→ re-anchor PR_APPROVAL_PENDING (distinct prApprovalId + PR context; pushed/commit/workspace preserved)
→ AWAITING_APPROVAL
→ NO PR creation, NO GitHub API, NO deploy, NO merge

PR_APPROVAL_PENDING + "승인"      → approvals.decide → PR_APPROVED (record only)  → NO PR creation
PR_APPROVAL_PENDING + "거절"/"취소" → PR_APPROVED never set → GIT_PUSHED, clear PR fields, pushed context kept
```

This is **not** a PR-creation-execution sprint and **not** a deployment sprint. It adds only the approval gate.

## 2. Boundary & the most important rule

> **A Pull Request is a repository-hosting/platform mutation, not a local Git operation.** Sprint 3b adds an
> **approval gate only** — it performs **no** PR creation, **no** GitHub API call, and adds **no** provider/
> manager PR method. `PR_APPROVED` means the user granted permission to create a PR; it **never** means a PR
> was created, deployed, merged, released, or made production-ready.

**Approval-only discipline (Constraint 5/6).** No `PR_CREATED`/`PULL_REQUEST_CREATED` state. No
`GitManager.createPullRequest` / `GitProvider.createPullRequest` / `GitHubProvider`. No `gh pr create` / `hub`
/ `git request-pull` / `curl` / CommandExecution / runtime shell. The entire flow lives in
`ConversationRuntime` + `ApprovalManager` (CAP-004) + `ResponseComposer` + the apply-preview anchor.

**Explicitly out of scope (NOT implemented in 3b):** actual Pull Request creation · GitHub API mutation ·
`GitHubProvider`/`RepositoryHosting` capability · `GitManager.createPullRequest`/`GitProvider.createPullRequest`
· generic repository-hosting mutation · deployment · merge · auto-merge · force push · branch/upstream/tag/
release/issue creation · CommandExecution-based `gh`/`git` · runtime shell-out · automatic PR after push · PR
creation immediately after approval · PR from any state other than `GIT_PUSHED` · a `PR_CREATED` state ·
deploy/release/production readiness semantics · ExecutionOrchestrator change · WorkspaceWrite/Patch/CodeGeneration.

## 3. Architecture & reuse

- **Reuses the 2z push-approval template exactly (ADR-0047).** `handlePrApprovalTurn` mirrors
  `handlePushApprovalTurn` (verify context → derive target → `approvals.requestForRisk(CRITICAL, reason)` →
  re-anchor `*_APPROVAL_PENDING` → `AWAITING_APPROVAL`). `handlePrApprovalDecisionTurn` mirrors
  `handlePushApprovalDecisionTurn` (strict pending-context guard → `interpretDecision` → approve records only
  and re-anchors `PR_APPROVED`; deny/cancel reverts to `GIT_PUSHED` clearing ONLY PR fields). Reuses
  `ApprovalManager.requestForRisk`/`get`/`decide` + `decisionOf` + `RiskLevel.CRITICAL`.
- **Reuses the 3a pushed context + validators.** `isSafePushRemote`/`isSafePushBranch` (from
  `push-target.ts`) and `parsePushUpstream` re-validate the persisted pushed target before recording an
  approval. `MAX_GIT_REF_DISPLAY` bounds ref display.
- **NO new capability (Q1).** No PR/GitHub/hosting surface exists anywhere in the repo today (verified: zero
  matches for `pullRequest`/`createPullRequest`/`GitHubProvider`/`RepositoryHosting`). PR creation is a
  hosting-platform boundary; for approval-only 3b **no provider is added**. A future Repository-Hosting
  capability (Sprint 3c+) will own actual PR creation.
- **`ConversationRuntime` composes it directly.** Two new anchor statuses (`PR_APPROVAL_PENDING`,
  `PR_APPROVED`) + five PR context fields; `interpretPrIntent` + `PR_CREATION_WORDS`/`PR_WORD`/
  `PR_FORBIDDEN_COMPANION`; `handlePrApprovalTurn` + `handlePrApprovalDecisionTurn` +
  `handlePrUnsupportedCompanionTurn` + `handlePrAlreadyApprovedTurn` + `logPrApprovalFailed`.
- **No Git dep change, no Core/Orchestrator contract change, no `app.module.ts` change.** No CommandExecution/
  shell; the runtime never shells out. `ExecutionOrchestrator` untouched (Q12).

## 4. Anchor state & context

Extend `ApplyPreviewAnchorStatus` after `GIT_PUSHED`:

```text
… | 'GIT_PUSHED'
  | 'PR_APPROVAL_PENDING'  // a CRITICAL PR-creation ApprovalRequest is pending decision. Intercepts every
                           //   turn like AWAITING_APPROVAL. NO PR created, and none is created even on approve.
  | 'PR_APPROVED';         // PR-creation approval granted (record only). NOT PR-created/deployed/merged/released.
```

**New `ApplyPreviewAnchor` fields (Q3 — DISTINCT from push/commit/apply approval ids):**

```ts
/** The pending/decided PR-creation ApprovalRequest id (Sprint 3b, ADR-0049) — DISTINCT from
 *  pushApprovalId/commitApprovalId/approvalId. Set at PR_APPROVAL_PENDING; preserved at PR_APPROVED;
 *  cleared on deny/cancel. */
prApprovalId?: Id;
/** Snapshot of `pushedCommitHash` at PR-approval time (Sprint 3b) — the pushed commit the PR is for. */
prPushedCommitHash?: string;
/** Deterministic PR head branch (Sprint 3b) — == the approved `pushedBranch` (safe/bounded). */
prHeadBranch?: string;
/** Deterministic PR base branch (Sprint 3b) — fixed product policy "main" (see Q6). */
prBaseBranch?: string;
/** Deterministic bounded PR title (Sprint 3b) — see Constraint 8. NOT a raw diff / file content. */
prTitle?: string;
/** (optional) Deterministic bounded PR body preview (Sprint 3b) — audit only; NOT sent anywhere in 3b. */
prBodyPreview?: string;
```

Set at `PR_APPROVAL_PENDING`; **preserved** at `PR_APPROVED`; **cleared** (revert to `GIT_PUSHED`) on deny/cancel.

**PR_APPROVED preserves the full audit context (Q3 / test 47–48):** `prApprovalId`, `prPushedCommitHash`,
`prHeadBranch`, `prBaseBranch`, `prTitle`, `prBodyPreview`, plus all 3a pushed context (`pushedCommitHash`,
`pushedRemote`, `pushedBranch`, `pushedUpstreamRef`, `pushApprovalId`, `pushCommitHash`, `pushRemote`,
`pushBranch`, `pushUpstreamRef`) and commit/workspace context (`commitApprovalId`, `commitHash`,
`committedFiles`, `workspaceRef`, `workspaceChangeRef`, `targetFiles`, `executionPlanRef`,
`postApplyValidationRef`, `instruction`).

State-by-state behavior for a PR-creation phrase (gated to `GIT_PUSHED` / `PR_APPROVAL_PENDING` / `PR_APPROVED`
only — Constraint 2; every other state keeps existing behavior and does **not** create a PR approval):

| Anchor state | PR-creation phrase | PR+forbidden companion | bare deploy phrase (no PR) |
|---|---|---|---|
| `GIT_PUSHED` | create CRITICAL PR approval (§5.5) → `PR_APPROVAL_PENDING` | `composePrUnsupportedCompanion`, no approval | `composePushPrDeployUnsupported` (deploy-only, §5.7) |
| `PR_APPROVAL_PENDING` | **decision flow** → ambiguous re-prompt (§5.6, mirrors 2z + 3a fix) | ambiguous re-prompt (no decide) | ambiguous re-prompt (no decide) |
| `PR_APPROVED` | `composePrAlreadyApproved` (approved, not created) — Q11 | `composePrUnsupportedCompanion` | `composePushPrDeployUnsupported` (deploy-only) |
| `WORKSPACE_APPLIED`/`COMMIT_*`/`GIT_COMMITTED`/`PUSH_APPROVAL_PENDING`/`PUSH_APPROVED`/no-anchor/other | **unchanged**; NO PR approval | unchanged | unchanged |

## 5. Detailed design

### 5.1 Intent detection (Sprint 3b) — split from the 3a `PR_DEPLOY_WORDS`

3a's `PR_DEPLOY_WORDS = /(\bpr\b|pull\s*request|풀\s*리퀘|배포|deploy)/i` currently routes **both** PR and deploy
phrases at `GIT_PUSHED` to `composePushPrDeployUnsupported` ("PR/deploy is a future sprint"). 3b **splits** it:
PR-creation becomes a supported approval flow; **deploy/merge/release stay unsupported**.

```ts
/** A PR-ish noun (Sprint 3b) — only ever consulted at GIT_PUSHED/PR_APPROVAL_PENDING/PR_APPROVED. A bare
 *  좋아/오케이/확인/진행해/다음 단계 never matches (Q4). */
const PR_WORD = /(\bpr\b|pull\s*request|풀\s*리퀘|merge\s*request|\bmr\b)/i;

/** Explicit PR-CREATION phrases (Sprint 3b, Q4 — CA #1/#2/#3) — a PR-ish noun REQUIRES a create/open verb;
 *  a bare "PR"/"GitHub PR"/"pull request"/"merge request" is NOT sufficient (CA #1). Covers Korean spacing/
 *  order incl. "깃허브 PR" (CA #2) and "merge request 만들어줘"/"create merge request" (CA #3). The create verb
 *  is MANDATORY for every form — the previous optional `github\s*pr\s*(열|만들|생성)?` is removed (CA #1). */
const PR_CREATION_WORDS =
  /((깃허브\s*)?(\bpr\b|pull\s*request|풀\s*리퀘|merge\s*request|\bmr\b)\s*(만들|생성|열|올려)|github\s*pr\s*(만들|생성|열|올려)|open\s+(a\s+)?(pr|pull\s*request|merge\s*request)|create\s+(a\s+)?(pr|pull\s*request|merge\s*request))/i;

/** Companions that must NOT ride along with a PR request (Sprint 3b, Constraint 10 / Q5) — only ever
 *  consulted when a PR word is present (2z CA #2 lesson). NOTE: `\bmerge\b(?!\s*request)` so the GitLab
 *  synonym "merge request" is a CREATE phrase, not a merge-companion; "auto merge"/"자동 머지"/"PR 만들고
 *  merge" are still caught. */
const PR_FORBIDDEN_COMPANION =
  /(배포|deploy|auto\s*-?\s*merge|자동\s*머지|\bmerge\b(?!\s*request)|머지|병합|릴리즈|release|--?force|강제|\bforce\b|(^|\s)-f(\s|$)|리셋|\breset\b|checkout|체크아웃|stash|스태시|rebase|리베이스|\btag\b|태그|브랜치\s*생성|create\s+branch)/i;
```

```ts
/** Explicit PR-creation intent (Sprint 3b, ADR-0049) — only consulted inside the GIT_PUSHED / PR_APPROVED
 *  routing guards (never global — mirrors the 2z/3a CA #1 boundary). Returns:
 *   - null → no PR word, OR a bare PR noun without a create/open verb (→ existing behavior);
 *   - 'pr-unsupported' → PR bundled with deploy/merge/release/force/reset/… ;
 *   - 'create' → an explicit PR-creation phrase. */
static interpretPrIntent(text: string): 'create' | 'pr-unsupported' | null {
  const t = text.trim().toLowerCase();
  if (!PR_WORD.test(t)) return null;                       // no PR word → not PR handling
  if (PR_FORBIDDEN_COMPANION.test(t)) return 'pr-unsupported';
  if (PR_CREATION_WORDS.test(t)) return 'create';
  return null;                                             // bare PR noun (no create verb) → not PR handling
}
```

Note: PR phrases carry **no** push word, so `interpretPushIntent`/`interpretPushExecutionIntent` return
`null` for them (no collision). A push+PR bundle ("push하고 PR") is still caught first by the 3a push-execution
companion guard → `composePushUnsupportedCompanion` (no mutation) — acceptable; documented in §5.7 routing.

### 5.2 Deterministic PR target (Constraint 7 / Q6 / Q7)

```ts
/** Fixed base-branch product policy for ChunsikBot V2 (Sprint 3b, Q6 — CA option C). RepositoryInfo exposes
 *  NO default-branch and no config default-branch source exists in the codebase (verified), so the base
 *  branch is a STATED PRODUCT POLICY, not an inferred/guessed value. Revisit if a safer configured
 *  default-branch source is added later. */
const PR_BASE_BRANCH_POLICY = 'main';
```

- **prBaseBranch** = `PR_BASE_BRANCH_POLICY` (`"main"`). Explicit policy, never inferred, never user-provided.
- **prHeadBranch** = `anchor.pushedBranch`, re-validated with `isSafePushBranch` (safe/bounded). Never
  user-provided; never the current local branch name (Q7).
- **head == base guard (Q8 / CA #10):** if `prHeadBranch === prBaseBranch` → **no approval**,
  `composePrHeadEqualsBaseUnavailable`. This is a real case in this repo — prior sprints pushed directly to
  `origin/main`, so `pushedBranch === "main"` will often equal the base. **CA #10: word it as a product/base
  policy limitation, NOT a Git error and NOT a PR-creation attempt** — e.g. "현재 push된 브랜치가 PR base(main)와
  같아서, 이 정책으로는 PR 생성을 준비할 수 없어요." Do not imply a Git failure or that PR creation was attempted.

### 5.3 Deterministic bounded PR title / body (Constraint 8)

**Finding (source-verified):** `proposedCommitMessage` is set to `undefined` when the anchor becomes
`GIT_COMMITTED` (2y, conversation-runtime.ts:2050), so the **commit message is NOT available at
`GIT_PUSHED`**. The only preserved, human-meaningful field is `instruction` (the original request, restated in
every approval `reason` already). Therefore:

```ts
const MAX_PR_TITLE = 100; // bounded PR subject
/** Deterministic bounded PR title (Sprint 3b, CA #4) — a sanitized single line of the preserved
 *  `instruction`: (1) strip control characters, (2) remove backticks, (3) remove leading markdown heading
 *  markers ("#", ">"), (4) collapse all whitespace to single spaces, (5) trim, (6) cap at MAX_PR_TITLE.
 *  If the result is empty/blank → the fixed fallback "Apply approved changes". No raw diff, no file content.
 *  Reason (CA #4): `instruction` is user-originated and may carry newlines/markdown/prompt-like text. */
function derivePrTitle(instruction?: string): string { … } // fallback: 'Apply approved changes'
```

- **prTitle** = `derivePrTitle(anchor.instruction)`.
- **prBody / prBodyPreview** (deterministic, bounded via a body cap + `clampToMessageBudget`; audit-stored as
  `prBodyPreview` — CA #16 keep + bound + preserve at PR_APPROVED): states it is **generated by ChunsikBot**,
  the pushed commit short hash, `head → base` branches, and the **COUNT** of `committedFiles` only — **CA #5:
  NO committed file paths in `prBodyPreview` for Sprint 3b, only the count** (paths reveal internal structure
  and are unnecessary for an approval-only gate) — plus explicit "배포하지 않았어요 / PR은 아직 생성되지 않았고
  승인만 기록해요". **No** raw diff, **no** file content/paths, **no** secrets. In 3b nothing leaves the system —
  title/body are only surfaced in the local approval message + stored on the anchor; a future PR-creation
  sprint must re-review secret-scrubbing before sending them to a hosting API.

### 5.4 Approval reason (mirrors `buildPushApprovalReason`, CAP-004)

```ts
/** Bounded CRITICAL PR-creation approval reason (Sprint 3b, ADR-0049). No diff/file content; no validation/
 *  test context. Includes pushed commit, head/base, permission-only, not-created-in-3b, future-step. */
function buildPrApprovalReason(input: {
  pushedCommitHash: string; headBranch: string; baseBranch: string; title: string;
}): string {
  return [
    'operation: pull request creation approval planning',
    `pushed commit: ${input.pushedCommitHash}`,
    `head: ${boundGitRef(input.headBranch)}`,
    `base: ${boundGitRef(input.baseBranch)}`,
    `title: ${input.title.slice(0, MAX_PR_TITLE)}`,
    'risk: CRITICAL',
    'no pull request has been created',       // CA #6 explicit
    'no deployment has been performed',        // CA #6 explicit
    'no merge has been performed',             // CA #6 explicit
    'this approval records permission only',
    'actual PR creation is NOT performed in Sprint 3b',
    'future execution requires a separate repository-hosting step',  // CA #6/#12 explicit
    'creating a PR mutates shared collaboration state (CI, notifications, reviews, branch protections, automations)',
    'approval is based on the pushed context currently recorded by ChunsikBot; it does not verify the branch on the hosting provider and does not guarantee a PR can be created', // CA #12 wording discipline
  ].join('\n');
}
```
(Reason covers tests 58–65 + CA #6/#12.)

### 5.5 `handlePrApprovalTurn` (GIT_PUSHED → CRITICAL PR approval; NO PR creation)

```ts
// 1. anchor.status === 'GIT_PUSHED' AND complete/safe pushed context (Constraint 9): pushedCommitHash
//    SHA-shaped AND == pushCommitHash == commitHash; isSafePushRemote(pushedRemote); isSafePushBranch
//    (pushedBranch); parsePushUpstream(pushedUpstreamRef) parses AND parsed.remote == pushedRemote AND
//    parsed.branch == pushedBranch; workspaceRef; executionPlanRef. Else composePrApprovalUnavailable
//    (no approval). logPrApprovalFailed never throws (2x lesson — optional field access).
// 2. prHeadBranch = pushedBranch; prBaseBranch = PR_BASE_BRANCH_POLICY.
// 3. (Q8) prHeadBranch === prBaseBranch → composePrHeadEqualsBaseUnavailable (no approval).
// 4. prTitle = derivePrTitle(anchor.instruction); prBody/prBodyPreview = deterministic bounded body.
// 5. approvals.requestForRisk({ executionPlanRef, riskLevel: CRITICAL, reason: buildPrApprovalReason(...),
//    requestedBy: actor.id }).  ← the ONLY external effect; NO PR creation, NO GitHub API.
// 6. re-anchor PR_APPROVAL_PENDING preserving ALL pushed/commit/workspace context, adding prApprovalId +
//    prPushedCommitHash + prHeadBranch + prBaseBranch + prTitle + prBodyPreview.
// 7. composePrApprovalRequested(ctx, { pushedCommitHash, headBranch, baseBranch, title }) → AWAITING_APPROVAL.
```

**No read-only Git call is required (Constraint 9 note).** The pushed context on the anchor is the
authoritative source; 3b re-validates the persisted target strings (not a fresh `git.info`/`git.status`).
An OPTIONAL read-only inspection may be added later if a stronger head/branch check is wanted, but the plan
does **not** require the local branch to equal the PR head (the pushed branch is the approved head).

### 5.6 `handlePrApprovalDecisionTurn` (PR_APPROVAL_PENDING — decision only; NO PR creation)

Mirrors `handlePushApprovalDecisionTurn` (intercepts every turn like the other `*_PENDING` states):

```ts
// 0. Strict pending-context guard (test 46): status === 'PR_APPROVAL_PENDING' AND prApprovalId,
//    prPushedCommitHash, prHeadBranch, prBaseBranch, prTitle, workspaceRef, executionPlanRef all present —
//    else composePrApprovalUnavailable, NO decide.
// 1. (Sprint 3a fix, carried forward) a PR-creation / PR+forbidden phrase (interpretPrIntent(text) !== null)
//    is a premature PR request while PENDING, NOT a clean approve → classify ambiguous → re-prompt
//    (composeApprovalNotice on the live request), preserve context, NO decide (test 41).
//    decision = interpretPrIntent(text) !== null ? 'ambiguous' : interpretDecision(text).
// 2. ambiguous → re-prompt, preserve context, no decide/re-anchor.
// 3. verify the referenced ApprovalRequest: exists, PENDING, executionPlanRef matches (test 42) — else
//    composePrApprovalUnavailable, NO decide.
// 4. approvals.decide(prApprovalId, decisionOf(...)).
//    deny/cancel → re-anchor GIT_PUSHED, clear ONLY PR fields (prApprovalId/prPushedCommitHash/prHeadBranch/
//      prBaseBranch/prTitle/prBodyPreview = undefined), preserve pushed/commit/workspace context →
//      composePrApprovalDenied / composePrApprovalCancelled (tests 44–45). NO PR creation.
//    approve → re-anchor PR_APPROVED (record only), preserve ALL context (tests 43, 47–48) →
//      composePrApprovalRecorded. NO PR creation.
```

### 5.7 Routing (inside the existing `GIT_PUSHED` guard; new `PR_APPROVAL_PENDING`/`PR_APPROVED` guards)

`PR_APPROVAL_PENDING` intercepts every turn (added next to the other `*_APPROVAL_PENDING` guards, before the
apply-preview state routing):

```ts
if (applyAnchor?.status === 'PR_APPROVAL_PENDING') {
  return this.handlePrApprovalDecisionTurn(message, session, actor, applyAnchor);
}
```

`GIT_PUSHED` guard — PR-creation checked AFTER the 3a push-execution guards (a push+PR bundle is caught first
as a push companion), and the 3a bare-deploy fallback is **narrowed to deploy-only**:

```ts
if (applyAnchor?.status === 'GIT_PUSHED') {
  const exKind = ConversationRuntime.interpretPushExecutionIntent(message.text);   // 3a (unchanged)
  if (exKind === 'push-unsupported') return this.handlePushUnsupportedCompanionTurn(message, session);
  if (exKind === 'execute')          return this.handlePushAlreadyPushedTurn(message, session, applyAnchor);
  const prKind = ConversationRuntime.interpretPrIntent(message.text);              // 3b (NEW)
  if (prKind === 'pr-unsupported')   return this.handlePrUnsupportedCompanionTurn(message, session);
  if (prKind === 'create')           return this.handlePrApprovalTurn(message, session, actor, applyAnchor);
  if (DEPLOY_ONLY_WORDS.test(message.text)) return this.handlePushPrDeployUnsupportedTurn(message, session); // deploy-only now
  if (ConversationRuntime.interpretPushIntent(message.text) === 'push')
    return this.handlePushAlreadyPushedTurn(message, session, applyAnchor);        // 3a (unchanged)
}
if (applyAnchor?.status === 'PR_APPROVED') {
  const prKind = ConversationRuntime.interpretPrIntent(message.text);
  if (prKind === 'pr-unsupported')   return this.handlePrUnsupportedCompanionTurn(message, session); // CA #9: before create
  if (prKind === 'create')           return this.handlePrAlreadyApprovedTurn(message, session);      // Q11
  if (DEPLOY_ONLY_WORDS.test(message.text)) return this.handlePrApprovedDeployUnsupportedTurn(message, session); // CA #8: PR-specific wording
}
```

**CA #8 — state-appropriate deploy-only wording.** A bare deploy phrase (배포/deploy, no PR) uses a
**state-specific** composer, NOT one shared string: at `GIT_PUSHED` → `composePushPrDeployUnsupported`
("이미 로컬 커밋은 원격에 push된 상태예요. 배포는 아직 지원하지 않아요."); at `PR_APPROVED` →
`composePrApprovedDeployUnsupported` ("PR 생성 승인은 기록되어 있지만, 배포는 아직 지원하지 않아요. PR은 아직
만들지 않았고 배포도 하지 않았어요.").

**3a supersession (required change + test update).** In 3a, `GIT_PUSHED` + a PR phrase → `composePushPrDeployUnsupported`
("PR 생성/배포는 아직 지원하지 않아요"). 3b changes this: a PR-creation phrase now creates a PR approval, so:
- `PR_DEPLOY_WORDS` (3a) is replaced by `DEPLOY_ONLY_WORDS = /(배포|deploy)/i` for the bare-deploy fallback.
- `composePushPrDeployUnsupported` wording drops "PR 생성" → **deploy-only**: "이미 로컬 커밋은 원격에 push된
  상태예요. 배포는 아직 지원하지 않아요."
- 3a runtime test **104** ("GIT_PUSHED + PR phrase → future sprint") is **updated** to "GIT_PUSHED + PR phrase
  → CRITICAL PR approval". 3a test **105** (deploy phrase → future sprint) is kept (deploy-only).
This is a clean, ADR-documented supersession of ADR-0048's GIT_PUSHED PR-phrase behavior.

### 5.8 `ResponseComposer` methods (approval-only; no PR/deploy/merge/readiness overclaim)

```ts
composePrApprovalRequested(ctx, { pushedCommitHash, headBranch, baseBranch, title }): OutboundMessage;
// "PR 생성 승인을 요청했어요. 대상: <head> → <base> (커밋 <shortHash>). 승인해도 이번 단계에서는 PR을 만들지 않아요.
//  진행하려면 \"승인\", 원치 않으면 \"거절\"." — bounded refs, short hash, title shown bounded.
composePrApprovalRecorded(ctx): OutboundMessage;   // "PR 생성 승인은 기록했어요. 아직 PR은 만들지 않았어요. (실제 PR 생성은 이후 단계에서 진행돼요)"
composePrApprovalDenied(ctx): OutboundMessage;     // "PR 생성 승인을 거절했어요. 커밋은 원격에 push된 그대로예요. PR은 만들지 않았어요."
composePrApprovalCancelled(ctx): OutboundMessage;  // "PR 생성 승인을 취소했어요. 커밋은 원격에 push된 그대로예요. PR은 만들지 않았어요."
composePrApprovalUnavailable(ctx): OutboundMessage;// "지금은 PR 생성 승인을 준비할 수 없어요. 먼저 push를 완료(GIT_PUSHED)한 뒤에 요청해 주세요. PR은 만들지 않았어요."
composePrHeadEqualsBaseUnavailable(ctx): OutboundMessage; // "push된 브랜치가 base(main)와 같아서 PR을 만들 수 없어요. PR 승인은 만들지 않았어요."
composePrAlreadyApproved(ctx): OutboundMessage;    // "PR 생성 승인은 이미 기록돼 있어요. 아직 PR은 만들지 않았어요. 다시 승인하지 않았어요."
composePrUnsupportedCompanion(ctx): OutboundMessage; // "PR 생성 요청에 배포/merge/release 같은 작업은 함께 처리하지 않아요. PR 승인도, 배포/merge도 하지 않았어요."
composePrApprovedDeployUnsupported(ctx): OutboundMessage; // (CA #8) PR_APPROVED + deploy: "PR 생성 승인은 기록되어 있지만, 배포는 아직 지원하지 않아요. PR은 아직 만들지 않았고 배포도 하지 않았어요."
// UPDATED: composePushPrDeployUnsupported → deploy-only wording at GIT_PUSHED (drop "PR 생성").
```
(Composer tests 101–109. All avoid claiming PR-created / deployed / merged / released / production-ready, and
never claim the branch is verified on a hosting provider or that a PR can definitely be created — CA #12.)

## 6. Required Architecture Questions — decisions

- **Q1 (PR in Git?)** No. PR creation is a repository-hosting/platform mutation; no hosting surface exists
  today. 3b adds an **approval gate only** with **no provider/manager PR method**. Actual creation → future
  Repository-Hosting/GitHub capability (Sprint 3c+).
- **Q2 (states)** Add `PR_APPROVAL_PENDING`, `PR_APPROVED`. No `PR_CREATED`.
- **Q3 (context)** `prApprovalId`, `prPushedCommitHash`, `prHeadBranch`, `prBaseBranch`, `prTitle` (+ optional
  `prBodyPreview`), distinct from push/commit/apply ids.
- **Q4 (triggers)** `PR_CREATION_WORDS` (§5.1). A bare 좋아/오케이/확인/진행해/다음 단계 never matches.
- **Q5 (rejections)** `PR_FORBIDDEN_COMPANION` (§5.1): PR + deploy/merge/release/auto-merge/force/reset/… →
  `pr-unsupported`.
- **Q6 (base)** Fixed product policy `main` (CA option C) — RepositoryInfo has no default-branch and no config
  source exists; stated as policy, not inference.
- **Q7 (head)** `pushedBranch`, re-validated safe. Not user-provided.
- **Q8 (head == base)** No approval; `composePrHeadEqualsBaseUnavailable`.
- **Q9 (incomplete/unsafe pushed context)** Safe failure; `composePrApprovalUnavailable`; no approval.
- **Q10 (after approve)** `PR_APPROVED`; no PR creation; reply says permission recorded only + future step.
- **Q11 (PR again after PR_APPROVED)** `composePrAlreadyApproved`; no PR creation.
- **Q12 (Orchestrator)** No change.
- **Q13 (no side effects)** Tests prove no GitHub API / no GitManager/GitProvider PR method / no
  CommandExecution / no runtime shell / no WorkspaceWrite/Patch/CodeGeneration/Orchestrator / no deploy /
  no merge / no branch/release creation.
- **Risk (Constraint 4)** `RiskLevel.CRITICAL` (default kept) — PR creation mutates shared collaboration
  state (CI, notifications, reviews, branch protections, automations, deploy pipelines).

## 7. Case matrix

| Case | State / detection | Result |
|---|---|---|
| 1–4. GIT_PUSHED + "PR 만들어줘"/"pull request 만들어줘"/"GitHub PR 열어줘"/"open a PR" | `create` | CRITICAL PR approval → `PR_APPROVAL_PENDING`, `AWAITING_APPROVAL`, NO PR |
| 5. ambiguous / bare PR noun (no verb) at GIT_PUSHED | null | no PR approval (existing behavior) |
| 6. no anchor + PR phrase | not 3b | existing behavior; no PR approval |
| 7–9. WORKSPACE_APPLIED / GIT_COMMITTED / PUSH_APPROVED + PR phrase | not GIT_PUSHED | existing behavior; no PR approval |
| 10. PR_APPROVED + PR phrase | `create` | `composePrAlreadyApproved`, no PR |
| 11–14. PR + deploy / merge / release / auto-merge | `pr-unsupported` | `composePrUnsupportedCompanion`, no approval |
| 15–18. missing/invalid pushedCommitHash / != pushCommitHash / != commitHash | guard | `composePrApprovalUnavailable`, no approval |
| 19–24. missing/unsafe pushedBranch / pushedRemote / missing/malformed pushedUpstreamRef | guard | `composePrApprovalUnavailable`, no approval |
| 25. parsed upstream branch != pushedBranch | guard | `composePrApprovalUnavailable`, no approval |
| 26. missing workspaceRef/executionPlanRef | guard | `composePrApprovalUnavailable`, no approval |
| 27–28. base policy explicit / head == pushedBranch | derivation | base = "main"; head = pushedBranch |
| 29. head == base | guard (Q8) | `composePrHeadEqualsBaseUnavailable`, no approval |
| 30–34. deterministic bounded title/body; no raw diff / file content; body says no deploy | derivation | prTitle/prBody bounded & safe |
| 35–40. reason includes pushedCommitHash / head+base / permission-only / not-in-3b / future-step / CRITICAL | reason/risk | `buildPrApprovalReason`, `RiskLevel.CRITICAL` |
| 41. PR_APPROVAL_PENDING + ambiguous/PR phrase | decision | re-prompt, preserve context, no decide |
| 42. PR_APPROVAL_PENDING + "승인" (missing/not-PENDING/plan-mismatch) | verify | no decide, `composePrApprovalUnavailable` |
| 43. PR_APPROVAL_PENDING + "승인" | approve | `PR_APPROVED` only, no PR |
| 44–45. PR_APPROVAL_PENDING + "거절"/"취소" | deny/cancel | `GIT_PUSHED`, clear PR fields, pushed context kept, no PR |
| 46. PR_APPROVAL_PENDING malformed context | guard | safe failure, no decide |
| 47–48. PR_APPROVED preserves PR + pushed/commit/workspace context | success | context preserved |
| 49–50. PR_APPROVED + PR phrase / ambiguous | already/ignore | already approved / no PR |
| 51–63. no side effects | tests | no GitHub API / PR method / CommandExecution / shell / WorkspaceWrite / Patch / CodeGeneration / Orchestrator / deploy / merge / branch / release |
| 64–69. composer wording | composer | approval-only, no PR/deploy/merge/release/readiness overclaim |

## 8. Required tests (Node 22) — CA's full list (111 items)

**`conversation-runtime.test.ts`** — creation + gating (1–19): 1–9. GIT_PUSHED + "PR 만들어줘" / "pull request
만들어줘" / "GitHub PR 열어줘" / "open a PR" / "깃허브 PR 만들어줘" / "PR 열어줘" / "pull request 생성해줘" /
"merge request 만들어줘" / "create merge request" → **one** CRITICAL PR `requestForRisk`, `PR_APPROVAL_PENDING`,
`AWAITING_APPROVAL`, no PR. 10–13. GIT_PUSHED + bare "PR" / "GitHub PR" / "pull request" / "merge request" →
**no** PR approval (CA #1/#3 — noun without verb). 14. ambiguous phrases → no PR approval. 15. no anchor + PR
phrase → no PR approval. 16. WORKSPACE_APPLIED + PR phrase → no PR approval. 17. GIT_COMMITTED + PR phrase →
no PR approval. 18. PUSH_APPROVED + PR phrase → no PR approval. 19. PR_APPROVED + PR phrase → already
approved, not created.

Unsupported companions (20–27): 20. PR and deploy. 21. PR and merge. 22. PR and release. 23. auto-merge. 24.
PR and force. 25. PR and reset/checkout/stash/rebase/tag/branch-creation → reject, no approval. 26. PR_APPROVED
+ PR and deploy → unsupported companion, no PR (CA #9). 27. PR_APPROVED + PR and merge → unsupported companion,
no PR (CA #9).

Context/verification (28–40): 28. missing pushedCommitHash. 29. invalid pushedCommitHash. 30. pushedCommitHash
!= pushCommitHash. 31. pushedCommitHash != commitHash. 32. missing pushedBranch. 33. unsafe pushedBranch. 34.
missing pushedRemote. 35. unsafe pushedRemote. 36. missing pushedUpstreamRef. 37. malformed pushedUpstreamRef.
38. parsed upstream branch != pushedBranch. 39. parsed upstream remote != pushedRemote. 40. missing
workspaceRef/executionPlanRef → all safe failure, no approval.

Target / title / body / reason / risk (41–65): 41. base policy explicit "main". 42. head == pushedBranch. 43.
prBaseBranch == "main". 44. reason base == "main". 45. head == base → no approval. 46. head == base response
says policy/base limitation and no PR approval (CA #10). 47. title deterministic + bounded. 48. title strips
control chars. 49. title collapses newlines/whitespace. 50. title removes markdown heading/backticks (CA #4).
51. blank title → "Apply approved changes". 52. body deterministic + bounded. 53. body contains committedFiles
count. 54. body does NOT contain committed file paths (CA #5). 55. title/body no raw diff. 56. title/body no
file content. 57. body says no deployment. 58. reason includes pushedCommitHash. 59. reason includes head/base.
60. reason includes permission-only. 61. reason includes "PR not created in Sprint 3b". 62. reason includes
future repository-hosting step. 63. reason includes no deployment (CA #6). 64. reason includes no merge (CA
#6). 65. risk is CRITICAL.

Decision flow (66–80): 66. PR_APPROVAL_PENDING + ambiguous → re-prompt, preserve context. 67. + "PR 만들어줘" →
re-prompt, no decide (CA #7). 68. + "PR 만들고 배포" → re-prompt, no decide (CA #7). 69. + "PR 만들고 merge" →
re-prompt, no decide (CA #7). 70. + "배포해줘" → re-prompt, no decide (CA #7). 71. + "승인" verifies request
exists/PENDING/plan (CA #14). 72. + "승인" → PR_APPROVED only, no PR. 73. + "거절" → GIT_PUSHED, clear PR
fields, no PR. 74. + "취소" → GIT_PUSHED, clear PR fields, no PR. 75. malformed pending context → safe failure,
no decide. 76. PR_APPROVED preserves prApprovalId/prPushedCommitHash/prHeadBranch/prBaseBranch/prTitle/
prBodyPreview (CA #16). 77. PR_APPROVED preserves pushed/commit/workspace context. 78. PR_APPROVED + PR phrase
→ already approved, not created. 79. PR_APPROVED + ambiguous → no PR. 80. PR_APPROVED + deploy phrase → PR
approval recorded / PR not created / deployment not done (CA #8).

Deny/cancel field clearing (81–84): 81. deny clears ONLY PR fields. 82. cancel clears ONLY PR fields. 83.
deny/cancel preserve pushed fields. 84. deny/cancel preserve commit/workspace fields (CA #15).

No side effects (85–100): 85. no GitHub API mutation. 86. no GitHubProvider. 87. no RepositoryHosting. 88. no
`createPullRequest`. 89. no `GitManager.createPullRequest`. 90. no `GitProvider.createPullRequest`. 91. no
`command.run`. 92. no runtime shell. 93. no `workspaceWrite.apply`. 94. no `patch.*`. 95. no
`codeGeneration.*`. 96. no `orchestrator.run/.resume`. 97. no deploy. 98. no merge. 99. no branch creation.
100. no release creation. (Assert on the deps' call spies — no PR/hosting dep exists at all — CA #13.)

Composer (101–109): 101. requested says approval only / no PR created. 102. recorded says no PR created. 103.
deny/cancel says pushed commit remains + no PR created. 104. unavailable does not imply PR created. 105.
already-approved says not created. 106. unsupported-companion says no deploy/merge/release. 107. deploy-only
at GIT_PUSHED says pushed state exists + deployment not done (CA #8). 108. deploy-only at PR_APPROVED says PR
approval recorded / PR not created / deployment not done (CA #8). 109. no response says PR created / deployed /
merged / released / production-ready — and requested/reason never claim the branch is verified on a hosting
provider or that a PR can definitely be created (CA #12).

3a supersession: update the 3a runtime test that expected "GIT_PUSHED + PR phrase → future sprint" → now
"GIT_PUSHED + PR phrase → CRITICAL PR approval"; keep the 3a "deploy phrase → deploy-only unsupported" test.

**Node 22:** 110. `pnpm typecheck` green. 111. `pnpm test` green.

## 9. Architecture Impact / Reuse

- **Reuses, unchanged:** the 2z approval template (`requestForRisk`/`get`/`decide`/`decisionOf`/
  `RiskLevel.CRITICAL`, `handlePushApprovalTurn`/`handlePushApprovalDecisionTurn` structure), the 3a pushed
  context + `isSafePushRemote`/`isSafePushBranch`/`parsePushUpstream`, `boundGitRef`/`MAX_GIT_REF_DISPLAY`,
  `clampToMessageBudget`, `interpretDecision`/`APPROVE_WORDS`/`DENY_WORDS`/`CANCEL_WORDS`.
- **Adds:** anchor statuses `PR_APPROVAL_PENDING`/`PR_APPROVED` + 5 (+1 optional) PR fields;
  `PR_WORD`/`PR_CREATION_WORDS`/`PR_FORBIDDEN_COMPANION`/`DEPLOY_ONLY_WORDS`/`PR_BASE_BRANCH_POLICY`/
  `MAX_PR_TITLE`; `interpretPrIntent`; `derivePrTitle` + body builder; `buildPrApprovalReason`;
  `handlePrApprovalTurn` + `handlePrApprovalDecisionTurn` + `handlePrUnsupportedCompanionTurn` +
  `handlePrAlreadyApprovedTurn` + `logPrApprovalFailed`; 7 `ResponseComposer` methods.
- **Changes (supersession):** replace 3a `PR_DEPLOY_WORDS` with `DEPLOY_ONLY_WORDS`; narrow
  `composePushPrDeployUnsupported` to deploy-only; update 3a test 104.
- **Does NOT change:** Git capability (no PR/hosting method), Execution Orchestrator, Core/Orchestrator
  contract, `app.module.ts`, WorkspaceWrite/Patch/CodeGeneration/CommandExecution; no GitHub API, no PR
  creation, no deploy/merge.

## 10. ADR-0049 (proposed) — Explicit Pull Request Creation Approval

- **Status:** Proposed (v2, Phase 3, Sprint 3b — Product Construction).
- **Decision:** From `GIT_PUSHED`, an explicit PR-creation phrase records a **CRITICAL** Pull-Request-creation
  `ApprovalRequest` — verify the persisted pushed context is complete + safe (`pushedCommitHash` SHA-shaped
  and == `pushCommitHash` == `commitHash`; safe `pushedRemote`/`pushedBranch`; `pushedUpstreamRef` parses and
  its `remote`/`branch` match); derive a **deterministic PR target** (head = `pushedBranch`; base = the fixed
  product policy `main`, since no default-branch source exists in the codebase — a stated policy, not
  inference) and a **deterministic bounded** title (sanitized `instruction`, since the commit message is
  cleared at `GIT_COMMITTED`; fallback "Apply approved changes") + body (generated-by-ChunsikBot, short hash,
  head→base, committed-file count; **no** raw diff/file content/secrets); reject `head == base`; create one
  `RiskLevel.CRITICAL` approval; re-anchor `PR_APPROVAL_PENDING` (distinct `prApprovalId` + PR context;
  pushed/commit/workspace context preserved); return `AWAITING_APPROVAL`. On "승인" → **record only** →
  `PR_APPROVED` (context preserved). On "거절"/"취소" → revert to `GIT_PUSHED`, clear ONLY PR fields, preserve
  pushed context. **No Pull Request is created, no GitHub API is called, no provider/manager PR method is
  added, no deploy/merge/branch/release, no CommandExecution/shell, no ExecutionOrchestrator change.**
  `PR_APPROVED` means permission was granted — **never** PR-created/deployed/merged/released/production-ready.
  PR creation is a repository-hosting/platform mutation and belongs to a **future Repository-Hosting/GitHub
  capability**, not Git. **Supersedes ADR-0048's `GIT_PUSHED` PR-phrase behavior only** (a PR phrase now
  creates an approval; deploy-only phrases remain unsupported/future).
- **No fresh Git read in 3b (CA #12).** 3b uses the `GIT_PUSHED` anchor as the source of truth because this
  sprint only **records** PR approval — no remote/hosting mutation occurs, so there is nothing to re-validate
  against a live read yet. Actual PR-creation **execution** (a future sprint) MUST re-validate hosting/branch
  state before mutating. Accordingly, 3b wording is disciplined: the approval is "based on the pushed context
  currently recorded by ChunsikBot" and "actual PR creation will require a future execution step"; it **never**
  claims the branch still exists on the remote, the hosting default branch was verified, or that a PR can
  definitely be created.
- **Trigger discipline (CA #1/#3):** a bare PR-ish noun ("PR"/"GitHub PR"/"pull request"/"merge request") is
  **not** sufficient — an explicit create/open verb is required. "merge request" is a PR synonym (needs a verb),
  distinct from a bundled "merge" companion (rejected). **Title (CA #4):** sanitized `instruction` (strip
  control chars, remove backticks + leading markdown heading markers, collapse whitespace, bound to
  `MAX_PR_TITLE`), fallback "Apply approved changes". **Body (CA #5):** committed-file **count only, no file
  paths**, no raw diff, no file content. **Base (CA #6/#11):** single named constant `PR_BASE_BRANCH_POLICY =
  "main"` — product policy for ChunsikBot V2, not inferred from `RepositoryInfo`, not user-provided.
- **Not implemented:** actual PR creation, GitHub API mutation, `GitHubProvider`/hosting capability,
  `GitManager`/`GitProvider` PR method, deployment, merge/auto-merge, force push, branch/upstream/tag/release/
  issue creation, a `PR_CREATED` state, deploy/release/production readiness semantics.
- **Relations:** ADR-0048 (provides `GIT_PUSHED` + pushed context; PR-phrase behavior superseded), ADR-0047
  (2z push-approval template mirrored), ADR-0045 (2x commit-approval decision flow), ADR-0025 (CAP-004
  Approval — CRITICAL), ADR-0023 (CAP-002 Git — read-only reuse only). Supersedes nothing wholesale.

## 11. Implementation sequence (after CA plan approval)

1. Apply plan changes (this document). 2. Author ADR-0049 in `DECISIONS.md`. 3. Implement minimal approved
scope (anchor states/fields, intents, target/title/body derivation, handlers, composer, reason builder;
supersede 3a PR-phrase routing). 4. Add/update tests (111 items + 3a PR-phrase test update). 5. Validate on Node 22
(typecheck exit 0 + test green). 6. Open PR for Chief Architect Implementation Review. **No PR creation, no
GitHub API, no deploy/merge, no branch/release creation.**

## 12. Stop condition (this sprint)

Plan-only. **Do not implement. Do not create a branch. Do not commit. Do not open a PR.** This document is
left on the working tree (untracked) for Chief Architect Review.
