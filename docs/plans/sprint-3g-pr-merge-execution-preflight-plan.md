# Sprint 3g Plan — Pull Request Merge Execution Preflight (actual merge after `MERGE_APPROVED`, live-preflight-guarded)

- **Status:** APPROVED WITH CHANGES (all 5 CA plan-review changes applied) → implementing on branch
  `v2/pr-merge-execution`; PR to open for CA Implementation Review. Do not merge.
- **Base:** `main @ d6fe68e8f4dafd6eb02db90641c305572a46a9e9`
- **Validation runtime (for the FUTURE implementation):** Node 22 · `pnpm typecheck` · `pnpm test`
- **ADR (proposed):** ADR-0057 — Pull Request Merge Execution Preflight (added to `DECISIONS.md` at implementation
  time, not now).
- **Nature:** the **first remote repository-hosting mutation after PR creation** — executes an actual PR merge on
  the hosting provider, but **only** from a live `MERGE_APPROVED` anchor, **only** after a full live preflight
  re-validation, and **only** through a new `RepositoryHostingManager`/`RepositoryHostingProvider` merge method.
  Mirrors the Sprint 3d-D PR-creation-execution safety model (ADR-0054) exactly, applied to merge. **No deploy,
  no release, no branch deletion, no force merge, no auto-merge, no local git mutation.**
- **Predecessors (reused, not re-litigated):**
  - **ADR-0056** (Sprint 3f) — the `MERGE_APPROVED` anchor + `mergeApprovalId`/`mergeApprovalDecisionBy` this
    consumes as the sole trigger source and approval evidence.
  - **ADR-0054** (Sprint 3d-D) — the `PR_CREATED` causal chain (`repositoryIdentity`/`pullRequestRef`/
    `pullRequestNumber`/`Url`/`HeadBranch`/`BaseBranch`/`CommitHash`) and the **Blocked-vs-Unverified remote
    mutation safety rule** this extends.
  - **ADR-0055** (Sprint 3e) — the read-only, integrity-checked, point-in-time hosting read (`getPullRequestStatus`
    / `PullRequestStatusPreview`) whose contract the new preflight read mirrors.
  - **ADR-0052/0053** (Sprint 3d-B/3d-C) — the `RepositoryHostingProvider` port + `RepositoryHostingManager` +
    `GitHubRepositoryHostingProvider` this extends by one method pair.
  - **ADR-0025** (CAP-004 Approval) — `ApprovalManager.get`, `ApprovalStatus.APPROVED`, `RiskLevel.CRITICAL`.
  - **ADR-0023** (CAP-002) — Git stays local-only; PR merge is a **hosting** mutation, never a Git method.

---

## 0. CA plan-review disposition (APPROVED WITH CHANGES → all 5 applied)

| CA required change | Disposition | Where |
|---|---|---|
| 1. `MERGE_APPROVED + "머지해줘"/"이 PR 머지해줘"/"merge this PR"` must **execute** (not ask for a magic phrase); bare `머지`/`merge` noun, `머지 가능해?`, and status/check phrases still do not execute | Applied — `interpretMergeExecutionIntent` = merge word + NOT status/question + execution verb (incl. `해줘`); status/check → read-only path | §4.2, §4.9, §5 Q3 |
| 2. Already-merged idempotency must verify the **exact approved head** (provider/owner/repo/number/head/base + `headCommitHash == anchored pullRequestCommitHash`) before anchoring `PR_MERGED`; merged-but-different-head → Blocked/Stale, stays `MERGE_APPROVED` | Applied — manager integrity-checks the preflight result BEFORE the already-merged branch | §4.5, §4.7 |
| 3. Clarify `mergedAt` = runtime record/observe timestamp (not the provider's original merge time) | Applied — field comment reworded | §4.1 |
| 4. `composeMergeAlreadyApproved` used **only** for weak/incomplete merge mentions (`머지`/`merge`), saying approval is recorded + ask to merge explicitly | Applied — bare-mention route only | §4.8, §4.9 |
| 5. Add required tests 27–40 (trigger / already-merged integrity / PR_MERGED terminal / timestamp+evidence) | Applied — test list extended to 40 | §7 |

## 0.1 CA required design scope → where addressed

| CA direction (§6) | Addressed in |
|---|---|
| 6.1 New product state `PR_MERGED` (and what it does **not** mean) | §4.1 |
| 6.2 Runtime trigger only from `MERGE_APPROVED`; allowed/forbidden triggers | §4.2, §4.9 |
| 6.3 Required live preflight (16 checks) | §4.3 |
| 6.4 Conservative provider-independent mergeability model | §4.4 |
| 6.5 `RepositoryHosting*.mergePullRequest(input)`; manager consumes approval, provider never sees it | §4.5 |
| 6.6 GitHub adapter scope + constraints | §4.6 |
| 6.7 Failure semantics (known block vs unknown-after-mutation) | §4.7 |
| 6.8 Response composers + "merged ≠ deployed/released" wording invariant | §4.8 |
| 6.9 Out of scope (forbidden list) | §6 |
| 6.10 Required tests (26) | §7 |

---

## 1. Goal

From a live `MERGE_APPROVED` anchor, an explicit **merge-execution** phrase re-validates the approval and the
**live** hosting state, then — only if everything is safe and current — performs exactly one merge:

```text
MERGE_APPROVED
→ explicit merge EXECUTION phrase ("실제 머지해줘" / "이제 머지 실행해줘" / "승인된 PR 머지해줘" / "merge now" / "execute merge")
→ re-validate approval evidence (mergeApprovalId → approvals.get → APPROVED → executionPlanRef.id match)   ← CAP-004
→ re-validate anchored context (repositoryIdentity + pullRequestRef + number/url/head/base/commit)
→ live preflight read of the anchored PR IMMEDIATELY before mutation (open / not merged / not closed /
  head SHA == anchored commit / head+base branch match / mergeability == MERGEABLE)                        ← new read
→ if safe and current: RepositoryHostingManager.mergePullRequest(...) → single provider merge call          ← new mutation
→ re-anchor PR_MERGED (+ mergedAt, mergeExecutedBy, mergedHeadSha, mergeCommitHash?; full chain preserved)
→ response: merged — explicitly NOT deployed / released

Known pre-mutation block (any preflight failure)      → "머지하지 않았어요" (definitively not performed)
Unknown/generic failure AFTER the mutating call        → "머지 결과를 확인하지 못했어요, PR 상태를 확인해 주세요" (never "not merged")
Live PR already merged                                  → PR_MERGED (idempotent) + "이미 머지되어 있어요"
Hosting capability not configured                       → "머지 실행 기능이 설정되어 있지 않아요"
```

---

## 2. Boundary & the most important rule

> **A merge execution is a hosting-provider mutation of exactly ONE approved PR — and nothing else.** Sprint 3g
> performs a PR merge only from `MERGE_APPROVED`, only after a full live preflight, and only via the new
> `RepositoryHosting*.mergePullRequest` method. It performs **no** deploy/release/tag, **no** branch deletion,
> **no** force merge, **no** auto-merge enablement, **no** PR branch auto-update, **no** PR close/reopen without
> merge, **no** reviewer/label/assignee mutation, **no** check rerun / workflow dispatch, **no** local git
> mutation (pull/fetch/reset/post-merge main sync), **no** `CommandExecution`/shell, **no**
> `ExecutionOrchestrator`/`WorkspaceWrite`/`Patch`/`CodeGeneration` change. The hosting auth token stays
> adapter-local — it never enters core/domain/anchor/reason/response/logs. The runtime never claims
> deployed/released/production-ready, and never claims "not merged" after the mutating call has been attempted.

This is the standing remote-mutation safety policy (memory: `remote-mutation-safety-policy`) applied to merge:
an unknown post-attempt error defaults to **unverified**, never **not done**.

---

## 3. Architecture & reuse (source-verified)

- **Trigger is anchored to `MERGE_APPROVED` only** (`conversation-runtime.ts`, routing block currently at
  `if (applyAnchor?.status === 'MERGE_APPROVED')`, ~line 1351). A new `interpretMergeExecutionIntent` is consulted
  **only** in that block, **before** the existing 3f already-approved / companion routing. `PR_CREATED` and
  `MERGE_APPROVAL_PENDING` routing are unchanged, so `머지해줘` at those states still requests / re-prompts (§4.9).
- **Approval evidence is read, never re-requested.** 3g does **not** create a new `ApprovalRequest`; it re-reads
  the one recorded by 3f via `this.deps.approvals.get(anchor.mergeApprovalId)` and checks structured fields only
  (`status === ApprovalStatus.APPROVED`, `executionPlanRef.id === anchor.executionPlanRef.id`) — never parses the
  reason. Mirrors `handleMergeApprovalDecisionTurn` (~line 3388).
- **Reads/preserves the full causal chain.** `handleMergeExecutionTurn` reads exactly the fields
  `handleMergeApprovalTurn` requires (`pullRequestRef`, `repositoryIdentity`, `pullRequestNumber`/`Url`/
  `HeadBranch`/`BaseBranch`/`CommitHash`, `executionPlanRef`) and, on success, re-anchors `PR_MERGED` preserving
  all of them (spread `...anchor`), adding only the merge-result fields.
- **Manager access mirrors 3e.** The runtime reaches hosting **only** through `this.deps.repositoryHosting?.{identity, manager}`
  (never the provider/adapter), passes **no** token, and treats a missing binding as "not configured" (mirrors
  `handlePrStatusPreviewTurn`, ~line 3235).
- **New capability method pair mirrors `createPullRequest`.** `RepositoryHostingManager.mergePullRequest`
  owns approval-ref consumption + backstop validation + the live preflight + the single mutating call + result
  integrity; `RepositoryHostingProvider.mergePullRequest` owns the raw hosting call and takes **no** `ApprovalRef`
  (mirrors the port doc: "Approval gating is done by `RepositoryHostingManager`; this port takes no `ApprovalRef`").
- **New read method mirrors `getPullRequestStatus`** (integrity-checked, sanitized, bounded) but returns a
  purpose-built merge-preflight snapshot including normalized mergeability (§4.4/§4.5) — keeping the 3e read-only
  `PullRequestStatusPreview` type and its composer untouched.
- **Failure taxonomy reuses `RepositoryHostingBlockedError` / `RepositoryHostingUnverifiedError`** exactly as
  3d-D established them (see `repository-hosting-manager.ts` — Blocked = definitively no mutation happened;
  Unverified = the mutating call was attempted and the outcome is unknown).
- **`now()`** (already imported from `util/clock`) supplies `mergedAt`. Actor id supplies `mergeExecutedBy`.

---

## 4. Design

### 4.1 New product state + anchor fields (Q1/Q2)

`ApplyPreviewAnchorStatus` gains, after `MERGE_APPROVED`: **`PR_MERGED`**. No `DEPLOYED`/`RELEASED`/
`BRANCH_DELETED`/`MERGE_EXECUTION_PENDING` (execution needs no new approval — the 3f `MERGE_APPROVED` already
gates it).

```text
PR_MERGED  — the anchored PR was merged on the hosting provider DURING THIS RUN (or was observed already merged
             during this run's live preflight). Terminal for this chain.
```

`PR_MERGED` does **NOT** mean: deployed · released · production-ready · branch deleted · CI permanently verified ·
post-merge main synced locally.

New `ApplyPreviewAnchor` fields (all optional on the type; **required on `PR_MERGED`** as noted), distinct from the
merge-**approval** fields:

```text
mergedAt?: IsoTimestamp        // required on PR_MERGED; the RUNTIME record timestamp — time when ChunsikBot recorded
                               //   or OBSERVED the merge result during THIS run (now()), NOT the provider's original
                               //   merge time (which, on the already-merged path, may have happened earlier). (CA change 3)
mergeExecutedBy?: Id           // required on PR_MERGED; the actor who triggered execution
mergedHeadSha?: string         // required on PR_MERGED; the head SHA that was merged (== anchored pullRequestCommitHash)
mergeCommitHash?: string       // provider-reported merge commit SHA when the provider returns one; optional
```

`PR_MERGED` **preserves the full causal chain** (`...anchor`): workspace/execution-plan/push/commit context +
`repositoryIdentity`/`pullRequestRef`/`pullRequestNumber`/`Url`/`HeadBranch`/`BaseBranch`/`CommitHash`/`Reused` +
the 3f `mergeApprovalId`/`mergeApprovedAt`/`mergeApprovalDecisionBy`. It never clears the approval evidence.

### 4.2 Runtime trigger classifier (Q3 — CA change 1)

At `MERGE_APPROVED` the user has already passed the Sprint 3f CRITICAL merge-approval gate, so a **direct merge
imperative is a valid execution command** — the safety boundary is the state + approval revalidation + live
preflight, not a magic wording (CA change 1). Two deterministic classifiers, consulted **only** at
`MERGE_APPROVED`/`PR_MERGED`; the status/question guard always takes precedence over the execution verb:

```ts
const MERGE_WORD = /(머지|병합|\bmerge\b)/i;                                    // reused from 3f
// Status/question guard (= the 3f MERGE_QUESTION, verbatim): a merge STATUS/CHECK/POSSIBILITY phrase is read-only,
// never execution — checked BEFORE the execution verb so "머지 상태 확인해줘" (which also contains 해줘) never merges.
const MERGE_STATUS_WORD =
  /(가능|안전|괜찮|되나|되나요|통과|상태|확인|봐줘|봐|알려|체크|\bcheck\b|\bstatus\b|\bmergeable\b|can\s+i|is\s+it|\?)/i;
// Execution verb (CA change 1 recommended shape): a merge word + a request/execution verb IS execution at MERGE_APPROVED.
const MERGE_EXECUTION_VERB =
  /(해줘|해\s*줘|실제|실행|지금|승인된|\bnow\b|\bexecute\b|merge\s+this|\bapproved\b)/i;

// Execution intent — ONLY at MERGE_APPROVED. Status/question guard precedes the verb; a bare "머지"/"merge" noun
// (no verb) is NOT execution (→ composeMergeAlreadyApproved, §4.8).
static interpretMergeExecutionIntent(text): 'execute' | null {
  const t = text.trim().toLowerCase();
  if (!MERGE_WORD.test(t)) return null;
  if (MERGE_STATUS_WORD.test(t)) return null;        // "머지 상태 확인해줘"/"머지 가능해?"/"머지 체크해줘" → not execution
  if (MERGE_EXECUTION_VERB.test(t)) return 'execute'; // "머지해줘"/"이 PR 머지해줘"/"merge this PR"/"실제 머지해줘"/… → execute
  return null;                                        // bare "머지"/"merge" noun → not execution (already-approved reply)
}

// A merge STATUS/CHECK phrase → the read-only status path (so "머지 상태 확인해줘"/"머지 체크해줘" land on the 3e
// preview even though PR_STATUS_NOUN does not include "머지"). Consulted at MERGE_APPROVED/PR_MERGED.
static interpretMergeStatusIntent(text): boolean {
  const t = text.trim().toLowerCase();
  return MERGE_WORD.test(t) && MERGE_STATUS_WORD.test(t);
}
```

Trigger table at `MERGE_APPROVED` (CA change 1):

| phrase | result |
|---|---|
| `머지해줘` · `이 PR 머지해줘` · `merge this PR` | **execute** merge preflight |
| `실제 머지해줘` · `이제 머지 실행해줘` · `승인된 PR 머지해줘` · `merge now` · `execute merge` · `merge this approved PR` | **execute** merge preflight |
| bare `머지` · `merge` (noun, no verb) | no execution → `composeMergeAlreadyApproved` (ask to merge explicitly) |
| `머지 가능해?` | no execution |
| `머지 상태 확인해줘` · `merge status 확인해줘` · `머지 체크해줘` | status / read-only path |

### 4.3 Required live preflight — all 16 checks (§6.3)

Split across the runtime (anchor/approval evidence, checks 1–8) and the Manager (live hosting state, checks 9–16).
**Every** check that fails **before** the single mutating call is a `RepositoryHostingBlockedError` (definitively
"not merged"). No check is skipped; order is fixed.

Runtime `handleMergeExecutionTurn` (before any manager call) — any failure → `composeMergeExecutionPreflightBlocked`:

```text
1.  anchor.status === 'MERGE_APPROVED'
2.  anchor.mergeApprovalId present
3.  approvals.get(mergeApprovalId) returns a request
4.  request.status === ApprovalStatus.APPROVED
5.  request.executionPlanRef.id === anchor.executionPlanRef.id
6.  anchor.repositoryIdentity present AND matches deps.repositoryHosting.identity AND matches pullRequestRef identity
7.  anchor.pullRequestRef present
8.  anchor.pullRequestNumber / pullRequestUrl / pullRequestHeadBranch / pullRequestBaseBranch / pullRequestCommitHash present
```

Manager `mergePullRequest` (backstop validation, then the live read, then mutation) — checks 9–16, all
pre-mutation → `RepositoryHostingBlockedError`:

```text
    (backstop, mirrors createPullRequest) approvalRef.status === APPROVED; provider.kind === identity.provider;
    supported provider; safe owner/repo; safe head/base branch; head ≠ base; SHA-shaped expectedHeadSha.
9.  live hosting PR fetched IMMEDIATELY before mutation (new read; throws → Blocked "could not read live state")
10. live PR state === 'open'                       (state 'closed' → Blocked; 'merged' → already-merged path, §4.7)
11. live PR is NOT merged                           (covered by 10; 'merged' → already-merged, not a failure)
12. live PR is NOT closed                           (state 'closed' → Blocked)
13. live headCommitHash === anchored pullRequestCommitHash   (mismatch → Blocked, STALE_HEAD)
14. live headBranch === anchored head branch
15. live baseBranch === anchored base branch
16. mergeability === MERGEABLE                      (any other normalized value → Blocked, §4.4)
```

Checks 13–15 reuse the existing `getPullRequestStatus` integrity guards, which already throw on head/base/commit
mismatch — the Manager maps that throw to `Blocked` (STALE_HEAD). Only when all 16 pass is the single mutating
call made.

### 4.4 Mergeability policy + domain model (Q4)

A conservative, **provider-independent** normalized enum in `domain/repository-hosting.ts`:

```ts
export type PullRequestMergeability = 'MERGEABLE' | 'BLOCKED' | 'CONFLICTING' | 'UNKNOWN' | 'STALE_HEAD';
```

Policy (only `MERGEABLE` proceeds):

```text
- MERGEABLE   → proceed to the single mutating call.
- BLOCKED     → block  (branch protection / required checks / required reviews not satisfied).
- CONFLICTING → block  (merge conflict).
- UNKNOWN     → block  (provider could not determine mergeability — never merge on uncertainty).
- STALE_HEAD  → block  (live head SHA differs from the approved anchor, or PR is behind base).
- Never force-merge, never bypass branch protection, never auto-update the PR branch.
```

The **core domain never sees GitHub-specific payloads**. Mapping raw provider fields → the normalized enum lives
in the adapter (§4.6). Illustrative GitHub mapping (adapter-only, not core): `mergeable_state` `clean`→`MERGEABLE`,
`blocked`/`draft`→`BLOCKED`, `dirty`→`CONFLICTING`, `behind`→`STALE_HEAD`, `unknown`/null→`UNKNOWN`.

### 4.5 RepositoryHosting capability change (Q5)

One new method on each of the port and the manager, plus one new read used only by the merge preflight. Shapes
mirror `createPullRequest`/`getPullRequestStatus`.

**Manager (`RepositoryHostingManager`, consumes the approval; provider never sees it):**

```ts
async mergePullRequest(input: {
  identity: RepositoryIdentity;
  pullRequestRef: PullRequestRef;
  expectedHeadBranch: string;
  expectedBaseBranch: string;
  expectedHeadSha: string;        // == anchor.pullRequestCommitHash
  approvalRef: ApprovalRef;       // consumed & validated HERE; NEVER forwarded to the provider
}): Promise<PullRequestMergeResult>
```

**Provider port (`RepositoryHostingProvider`) — two new methods, NO `ApprovalRef` on either:**

```ts
// read-only, integrity-checked, bounded, sanitized — the immediate pre-mutation snapshot (mirrors getPullRequestStatus)
getMergePreflight(input: {
  identity: RepositoryIdentity;
  pullRequestRef: PullRequestRef;
  expectedHeadBranch: string;
  expectedBaseBranch: string;
  expectedCommitHash: string;
}): Promise<PullRequestMergePreflight>;

// the ONLY new mutating method — merges exactly one PR; receives hosting-safe refs + the expected head SHA only
mergePullRequest(input: {
  identity: RepositoryIdentity;
  pullRequestRef: PullRequestRef;
  expectedHeadSha: string;
}): Promise<PullRequestMergeResult>;
```

**New domain types:**

```ts
export interface PullRequestMergePreflight {
  ref: PullRequestRef;
  state: PullRequestState;              // reuse 3e's 'open'|'closed'|'merged'|'unknown'
  headBranch: string;
  baseBranch: string;
  headCommitHash: string;
  mergeability: PullRequestMergeability;
  observedAt: string;                   // adapter-generated at read time (never user-supplied) — mirrors 3e
}

export interface PullRequestMergeResult {
  provider: RepositoryHostingProviderKind;
  owner: string;
  repo: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  merged: true;                         // a returned result means the provider reported a merge
  mergedHeadSha: string;                // must equal expectedHeadSha (integrity-checked by the manager)
  mergeCommitHash?: string;             // provider-reported merge commit, when available
  alreadyMerged: boolean;               // MANAGER-owned: true when the live preflight already showed 'merged' (no new call)
}
```

Manager ordering (mirrors `createPullRequest`), with the CA change 2 exact-head verification applied **before**
the already-merged branch:

```text
1. backstop validation                     → all fail → Blocked (no read, no mutation)
2. getMergePreflight (live read)           → throws → Blocked ("could not read live state")
3. preflight-result INTEGRITY (ALWAYS, regardless of state) — ref provider/owner/repo/number match identity+ref,
   headBranch == expectedHeadBranch, baseBranch == expectedBaseBranch, headCommitHash == expectedHeadSha
                                            → any mismatch → Blocked (STALE/mismatched approval context)
4. branch on state:
   - state 'merged'  → the exact approved head is already merged (integrity in step 3 guaranteed head match)
                       → return { ...ref, merged:true, mergedHeadSha:preflight.headCommitHash, mergeCommitHash?, alreadyMerged:true }
                       → NO mutating call            (CA change 2: only reached when head SHA matches the approved anchor)
   - state 'closed'  → Blocked (closed, not merged)
   - state 'unknown' → Blocked
   - state 'open'    → continue
5. mergeability policy (open only)          → non-MERGEABLE → Blocked (§4.4)
6. SINGLE provider.mergePullRequest call    → throws → Unverified (may have merged)
7. merge-result integrity (merged===true, ref matches identity, mergedHeadSha == expectedHeadSha)
                                            → mismatch → Unverified
8. return { ...result, alreadyMerged:false }
```

Because step 3 runs for **every** state, a live PR that is already merged but at a **different** head SHA fails
integrity → **Blocked/Stale** and the runtime keeps `MERGE_APPROVED` — it never claims the approved head was
merged when a different head may have been (CA change 2).

### 4.6 GitHub adapter scope (§6.6)

`GitHubRepositoryHostingProvider` (adapter package `repository-hosting-github`) gains the two methods, planned
but implemented behind the manager preflight:

- `getMergePreflight` → **read-only** `GET /repos/{owner}/{repo}/pulls/{number}` (bounded, single request, no
  pagination/retry loop). Maps `state`/`merged` → `PullRequestState`; maps `mergeable`/`mergeable_state` →
  `PullRequestMergeability` (§4.4). `observedAt = new Date().toISOString()` adapter-side.
- `mergePullRequest` → **single mutating** `PUT /repos/{owner}/{repo}/pulls/{number}/merge` with body
  `{ sha: expectedHeadSha, merge_method: 'merge' }` — the `sha` guard makes the provider reject the merge if the
  head advanced (defense in depth behind the STALE_HEAD preflight).

Required adapter constraints (all enforced / asserted):

```text
- no ChatGPT/GitHub-connector usage in product runtime; built-in fetch only
- app-config token only; token NEVER enters core/domain/anchor/reason/response/logs
- send the expected head SHA (merge `sha` param) so the provider refuses a moved head
- merge_method 'merge' only — no force merge, no squash/rebase auto-selection surprises
- no branch deletion, no auto-merge enablement, no reviewer/label/assignee mutation
- github.com only (GitHub Enterprise deferred); sanitize all remote errors (no token / no raw payload)
```

### 4.7 Failure semantics (§6.7) — extends the 3d-D remote-mutation rule

```text
KNOWN pre-mutation block  → RepositoryHostingBlockedError → composeMergeExecutionPreflightBlocked
    (any of checks 1–16 fails, incl. mergeability BLOCKED/CONFLICTING/UNKNOWN/STALE_HEAD, PR closed, read failure
     before the mutating call). Safe to say: "머지하지 않았어요" — definitively not performed. Anchor stays MERGE_APPROVED.

UNKNOWN / generic failure AFTER the mutating call → RepositoryHostingUnverifiedError → composeMergeExecutionUnverified
    (provider.mergePullRequest threw, OR returned a result that failed integrity). The merge MAY have happened.
    MUST NOT claim "not merged"; say "머지 결과를 확인하지 못했어요 — PR 상태를 확인해 주세요." Anchor stays MERGE_APPROVED
    (NOT PR_MERGED — we do not assert a merge we could not verify).

LIVE ALREADY MERGED at the EXACT approved head (state 'merged' AND preflight integrity passed: same provider/owner/
    repo/number/head branch/base branch AND headCommitHash == anchored pullRequestCommitHash) → composeMergeExecutionAlreadyMerged
    + anchor PR_MERGED (idempotent, alreadyMerged=true); no new mutating call. This is the ONLY non-error path that
    anchors PR_MERGED without a mutating call this turn. Already merged at a DIFFERENT head → Blocked/Stale (above),
    stays MERGE_APPROVED (CA change 2).

NOT CONFIGURED (no deps.repositoryHosting.manager/identity) → composeMergeExecutionUnavailable; no state change.
```

This is the standing safety policy (memory `remote-mutation-safety-policy`): an unknown post-attempt error
defaults to **unverified**, never **not done**; the token stays adapter-local.

### 4.8 Response composers + wording invariant (§6.8)

New `ResponseComposer` methods (deterministic, bounded; PR URL bounded like 3e's `MAX_PR_URL_DISPLAY`):

```text
composeMergeExecutionPreflightBlocked   — "머지하지 않았어요" + the concrete safe reason (stale head / conflict /
                                          checks-or-reviews blocking / could-not-determine / PR closed). NEVER claims success.
composeMergeExecutionSucceeded          — "머지했어요" + owner/repo/#number/url + merged head SHA (+ merge commit if present).
                                          MUST say merged is NOT deploy/release.
composeMergeExecutionUnverified         — "머지 결과를 확인하지 못했어요, PR 상태를 확인해 주세요." NEVER "not merged", NEVER "merged".
composeMergeExecutionUnavailable        — "머지 실행 기능이 설정되어 있지 않아요." (no hosting binding).
composeMergeExecutionAlreadyMerged      — "이미 머지되어 있어요." + ref. NOT deploy/release.
composeMergeExecutionUnsupportedCompanion — MERGE_APPROVED/PR_MERGED + deploy/release/other companion → future step; no merge/deploy.
```

Re-word the 3f `composeMergeAlreadyApproved` and narrow its use (CA change 4): it is used **only** for a weak /
incomplete merge mention — a bare `머지` / `merge` noun with no execution verb — **not** for a direct merge command
(`머지해줘`/`이 PR 머지해줘`/… now execute). It must no longer say "actual merge is a future step" (merge execution now
exists); instead it says the approval is recorded and the user can ask to merge explicitly: "머지 승인은 기록돼
있어요. 머지하려면 '머지해줘'처럼 말씀해 주세요." No mutation.

**Required wording invariant (every success/already-merged path):** `Merged does not mean deployed or released.`
No composer ever says deployed / released / production-ready / branch-deleted / CI-permanently-verified.

### 4.9 Runtime routing (`MERGE_APPROVED` and `PR_MERGED`)

At `MERGE_APPROVED` (extends the existing block, ~line 1351), in order (status precedes execution precedes
already-approved precedes companion):

```text
1. interpretPrStatusIntent OR interpretMergeStatusIntent → handlePrStatusPreviewTurn   (3e read-only; keeps MERGE_APPROVED)
2. interpretMergeExecutionIntent === 'execute'           → handleMergeExecutionTurn     (NEW — live preflight → merge)
3. interpretMergeIntent === 'merge' (bare mention, no exec verb) → handleMergeAlreadyApprovedTurn (re-worded; NO mutation; CA change 4)
4. DEPLOY_ONLY_WORDS / PR_CREATED_COMPANION_WORDS        → handleMergeApprovedCompanionUnsupportedTurn — unchanged
```

Step 1 catches `머지 상태 확인해줘`/`머지 체크해줘` (via `interpretMergeStatusIntent`) and any PR/CI/check/review status
phrase (via `interpretPrStatusIntent`). Step 2 catches every CA-allowed direct merge command incl. `머지해줘`. Step 3
catches only a bare `머지`/`merge` noun (interpretMergeExecutionIntent returned null on the missing verb, and it is
not a status phrase). This guarantees CA change 1's trigger table exactly.

New `PR_MERGED` block (terminal):

```text
1. interpretPrStatusIntent OR interpretMergeStatusIntent → handlePrStatusPreviewTurn   (widen guard to accept PR_MERGED; read-only, keeps PR_MERGED)
2. interpretMergeExecutionIntent === 'execute' OR interpretMergeIntent === 'merge' (any merge phrase) → composeMergeExecutionAlreadyMerged (NO mutation)
3. DEPLOY_ONLY_WORDS / PR_CREATED_COMPANION_WORDS        → composeMergeExecutionUnsupportedCompanion (future step; no deploy)
```

`PR_CREATED` and `MERGE_APPROVAL_PENDING` routing are **unchanged**, guaranteeing the CA forbidden behaviors:
`PR_CREATED + 머지해줘` → **approval** (3f), `MERGE_APPROVAL_PENDING + 머지해줘` → **re-prompt** (3f),
`MERGE_APPROVED + 배포/릴리즈` → **unsupported companion**. `interpretMergeExecutionIntent` is never consulted
outside `MERGE_APPROVED`/`PR_MERGED`.

---

## 5. Required Architecture Questions — decisions

- **Q1 (new state)** — Add `PR_MERGED` only; **no** merge-execution approval state (the 3f `MERGE_APPROVED` gate
  is the approval; execution needs no second approval). `PR_MERGED` = "merged during this run," terminal, means
  none of deploy/release/branch-deletion/CI-permanent/main-sync (§4.1).
- **Q2 (anchor fields)** — `mergedAt` + `mergeExecutedBy` + `mergedHeadSha` required on `PR_MERGED`;
  `mergeCommitHash` optional (provider-dependent). Full chain + 3f approval evidence preserved (§4.1).
- **Q3 (trigger) — decided by CA change 1** — `interpretMergeExecutionIntent`, consulted **only** at
  `MERGE_APPROVED`/`PR_MERGED`, requires a merge word + a request/execution verb (`해줘`/`실행`/`실제`/`지금`/`승인된`/
  `now`/`execute`/`merge this`/`approved`), with the status/question guard taking precedence. **`머지해줘` (and
  `이 PR 머지해줘` / `merge this PR`) EXECUTE** — the user already passed the 3f CRITICAL gate, so a direct merge
  imperative is a valid execution command; the safety boundary is the state + approval revalidation + live
  preflight + expected head SHA + mergeability, not a magic wording. Only a bare `머지`/`merge` noun (no verb) or a
  status/question phrase does not execute.
- **Q4 (live preflight read)** — Add a dedicated read-only `getMergePreflight` returning
  `PullRequestMergePreflight` (incl. normalized `mergeability`), rather than extending the 3e
  `PullRequestStatusPreview`. Recommended so the read-only status type/composer (3e) stays pristine and the
  mutation-preflight has its own explicit contract. (Alternative considered: reuse `getPullRequestStatus` + add
  optional `mergeability?`. Recommendation: **dedicated method.**)
- **Q5 (capability shape)** — `RepositoryHostingManager.mergePullRequest` consumes/validates the `ApprovalRef`;
  `RepositoryHostingProvider.mergePullRequest`/`getMergePreflight` receive **only** hosting-safe refs + expected
  head SHA, never an `ApprovalRef`/`ApprovalRequest`. `PullRequestMergeResult.alreadyMerged` is **manager-owned**
  (mirrors the manager-owned `reused` on `PullRequestResult`) (§4.5).
- **Q6 (mergeability model)** — Normalized `MERGEABLE|BLOCKED|CONFLICTING|UNKNOWN|STALE_HEAD` in core; only
  `MERGEABLE` proceeds; raw→normalized mapping is adapter-only (no GitHub payload in core) (§4.4).
- **Q7 (failure semantics)** — Extend the 3d-D rule: any preflight failure = `Blocked` ("not merged"); any throw/
  integrity failure at-or-after the mutating call = `Unverified` ("could not verify — check PR status");
  live-already-merged = idempotent `PR_MERGED` (§4.7).
- **Q8 (perform any git/local action?)** — **No.** No local git pull/fetch/reset, no post-merge main sync, no
  branch deletion. Merge is a hosting mutation only. Local repo state is out of scope (§6).

---

## 6. Out of scope — explicitly forbidden (§6.9)

Sprint 3g's implementation must **not** add or perform any of:

```text
deploy · release · tag creation · branch deletion · auto-merge enablement · force merge ·
PR close/reopen without merge · reviewer/label/assignee mutation · check rerun · workflow dispatch ·
local git pull/fetch/reset · post-merge main sync · CommandExecution/shell · ExecutionOrchestrator changes ·
WorkspaceWrite/Patch/CodeGeneration changes
```

`GitProvider`/`GitManager` gain **no** method (Git stays local read-only + the approved commit path, ADR-0023/46).
No new approval risk beyond consuming the existing 3f `MERGE_APPROVED` evidence.

---

## 7. Required tests in the implementation (§6.10 — 26)

Runtime tests (`conversation-runtime.test.ts`) + Manager tests (`repository-hosting-manager.test.ts`, with a fake
provider) + adapter tests as applicable. Numbered to CA's list:

```text
1.  MERGE_APPROVED + explicit merge-execution phrase → live preflight runs (getMergePreflight called).
2.  PR_CREATED + merge phrase → requests approval (MERGE_APPROVAL_PENDING), does NOT merge (no mergePullRequest call).
3.  MERGE_APPROVAL_PENDING + merge phrase → re-prompt, does NOT merge.
4.  MERGE_APPROVED + deploy/release phrase → unsupported companion, does NOT merge.
5.  Missing mergeApprovalId → Blocked (preflight), no mutating call.
6.  approvals.get returns null → Blocked, no mutating call.
7.  ApprovalRequest.status !== APPROVED → Blocked, no mutating call.
8.  request.executionPlanRef.id !== anchor.executionPlanRef.id → Blocked.
9.  Missing pullRequestRef → Blocked.
10. repositoryIdentity mismatch (anchor vs resolved identity vs ref) → Blocked.
11. live PR state 'closed' → Blocked (not merged), no mutating call.
12. live PR state 'merged' → composeMergeExecutionAlreadyMerged + PR_MERGED (idempotent), no mutating call.
13. live headCommitHash != anchored commit → Blocked (STALE_HEAD), no mutating call.
14. live head/base branch mismatch → Blocked.
15. mergeability UNKNOWN → Blocked, no mutating call.
16. mergeability CONFLICTING → Blocked, no mutating call.
17. mergeability BLOCKED (branch protection/checks/reviews) → Blocked; response does NOT claim success.
18. all 16 pass → single provider.mergePullRequest call → anchor PR_MERGED (+ mergedAt/mergeExecutedBy/mergedHeadSha).
19. PR_MERGED preserves the full causal chain (identity/ref/number/url/head/base/commit + 3f approval evidence).
20. PR_MERGED success response says merged, explicitly NOT deploy/release (wording invariant).
21. provider.mergePullRequest throws AFTER attempt → Unverified; response NOT "not merged"; anchor stays MERGE_APPROVED.
22. known pre-mutation Blocked → response says "not performed"; anchor stays MERGE_APPROVED.
23. no CommandExecution/shell calls on any path.
24. no Git local mutation calls on any path (Git provider/manager untouched).
25. no deploy/release/reviewer/label/assignee/branch-deletion/auto-merge calls on any path.
26. token never appears in anchor / approval reason / response text / logs.
```

CA change 5 — additional required tests (27–40):

```text
# Runtime trigger (CA change 1)
27. MERGE_APPROVED + "머지해줘" → merge execution preflight runs.
28. MERGE_APPROVED + "이 PR 머지해줘" → merge execution preflight runs.
29. MERGE_APPROVED + "merge this PR" → merge execution preflight runs.
30. MERGE_APPROVED + bare "머지" → no execution; composeMergeAlreadyApproved (ask for explicit command).
31. MERGE_APPROVED + "머지 상태 확인해줘" → status/read-only path; no execution (no getMergePreflight/mergePullRequest).
32. MERGE_APPROVED + "머지 체크해줘" → status/read-only path; no execution.

# Already-merged integrity (CA change 2)
33. live already merged + same head/base/head SHA → PR_MERGED, alreadyMerged=true, no mutating call.
34. live already merged + different head SHA → Blocked/Stale, stays MERGE_APPROVED, no PR_MERGED.
35. live already merged + different base/head branch → Blocked, stays MERGE_APPROVED, no PR_MERGED.

# PR_MERGED terminal
36. PR_MERGED + merge phrase → composeMergeExecutionAlreadyMerged; no provider mutation.
37. PR_MERGED + status phrase → read-only status preview; keeps PR_MERGED.
38. PR_MERGED + deploy/release phrase → unsupported companion; no deploy/release, no merge.

# Timestamp / evidence (CA change 3)
39. PR_MERGED stores mergedAt as the runtime record timestamp (now()), independent of provider merge time.
40. PR_MERGED preserves mergeApprovalId, mergeApprovedAt, mergeApprovalDecisionBy (approval evidence intact).
```

Additional guard tests (enduring invariants): runtime never imports the hosting adapter; provider merge methods
never receive an `ApprovalRef`; `mergePullRequest` makes exactly ONE mutating call and only after all preflight
passes; `alreadyMerged` is manager-owned.

---

## 8. Validation & stop condition

- **Future implementation validation:** Node 22 · `pnpm typecheck` (exit 0) · `pnpm test` (full suite green).
- **This sprint (plan-only) stops here** — the plan document is the only deliverable. No implementation, no
  branch, no commit, no PR, per CA §5/§7.
