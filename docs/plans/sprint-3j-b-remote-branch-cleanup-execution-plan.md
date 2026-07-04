# Sprint 3j-B Plan — Remote Branch Cleanup Execution (RepositoryHosting-owned GitHub refs DELETE of exactly ONE merged PR head branch, from REMOTE_BRANCH_CLEANUP_APPROVED → REMOTE_BRANCH_CLEANED)

- **Status:** APPROVED WITH CHANGES (CA plan review) → all 6 required changes + tests 25–34 applied below;
  implementing on branch `v2/remote-branch-cleanup-execution`; PR for CA Implementation Review; do not merge.
- **Base:** `main @ f31f77fb03933e54f538da5052ec6b8de5d41f9d`
- **Validation runtime (for the FUTURE implementation):** Node 22 · `pnpm typecheck` (exit 0) · `pnpm test` (full suite green).
- **ADR:** **ADR-0060 — Remote Branch Cleanup** (the governing ADR already records the whole design; 3j-A implemented
  the approval half, **3j-B implements the execution half**). At 3j-B implementation time ADR-0060's status/notes are
  updated to "fully implemented (3j-A approval + 3j-B execution)". **No new ADR number is introduced** (CA: one ADR).
- **Nature:** the **execution half** of ADR-0060. From a live `REMOTE_BRANCH_CLEANUP_APPROVED` anchor, an explicit
  execution command deletes **exactly ONE remote branch — the anchored completed PR head branch** — via the
  **RepositoryHosting capability** (CAP-010), after re-reading the 3j-A CRITICAL approval + a strict live preflight +
  a read-immediately-before-delete SHA verification, then a single GitHub Git-refs `DELETE`. **It does not re-open any
  approval design; 3j-A's approval gate is consumed, not changed.**
- **Predecessors (reused, not re-litigated):**
  - **ADR-0060 / Sprint 3j-A** — the `REMOTE_BRANCH_CLEANUP_APPROVED` anchor + the four `remoteBranchCleanupApproval*`
    fields + the `interpretRemoteBranchCleanupExecutionIntent` classifier + `cleanedRemoteBranch` (false → set here).
  - **ADR-0057 / Sprint 3g** — the CRITICAL-approval → execution turn pattern (re-read the ApprovalRef via structured
    fields; single mutating call; phase-aware Blocked-vs-Unverified), applied here to remote branch deletion.
  - **ADR-0054/0053/0052** — the RepositoryHosting split (manager owns approval/ordering/integrity; provider owns
    bounded GitHub REST, adapter-local token, no shell) + the `RepositoryHostingBlockedError`/`UnverifiedError`
    safety taxonomy (mirrored as remote-branch-cleanup errors).
  - **ADR-0023** — Git is a **local repository** capability that never handles a remote URL/credentials → **why
    remote deletion is RepositoryHosting-owned and `git push --delete` is forbidden.**

---

## 0. CA 3j-B direction → where answered

| CA 3j-B requirement | Answered in |
|---|---|
| Product goal / target flow | §1, §4.6 |
| Ownership (RepositoryHosting; forbid git push --delete / Git method / shell) | §4.5, §5, §6 |
| Required remote preflight (13 live checks) | §4.3 |
| Already-absent = idempotent success | §4.3 (check 11), §4.7 |
| GitHub CAS limitation (no atomic SHA-conditional delete) + read-before-delete | §4.4 |
| Failure semantics (Blocked vs Unverified; no blanket-convert) + new errors | §4.7 |
| Provider API (`getRemoteBranchCommit`, `deleteRemoteBranch`; no ApprovalRef; manager consumes approval; runtime→manager only; token adapter-local) | §4.5 |
| State `REMOTE_BRANCH_CLEANED` + required fields + preserved chain | §4.1 |
| Out of scope | §6 |
| Required tests (24 + 25–34) | §7 |

---

## 0.1 CA plan-review disposition (APPROVED WITH CHANGES → all applied)

| CA required change | Disposition | Where |
|---|---|---|
| 1. Execution intent distinguishes re-request vs execute; route execution FIRST at APPROVED; classifier rejects bulk/wildcard/main/default | Applied — `interpretRemoteBranchCleanupExecutionIntent` hardened; routing order execution → remote → status → merge → deploy | §4.2, §4.6, §7 (25–28) |
| 2. Expected commit = `anchor.mergedHeadSha` ONLY; no `pullRequestCommitHash` fallback; absent/non-SHA → Block | Applied | §4.3 (check 10), §7 (29) |
| 3. Runtime preflight re-checks the local-cleanup chain (`branchCleanupMode==='local'`, `cleanedBranch===pullRequestHeadBranch`, `cleanedRemoteBranch===false`, `cleanedLocalBranch` boolean) | Applied | §4.3 (checks 11–14), §7 (30) |
| 4. Runtime preflight requires COMPLETE 3j-A approval evidence (id + requestedAt + approvedAt + decisionBy present) beyond the fetched status | Applied | §4.3 (checks 4–5), §7 (31) |
| 5. GitHub ref path handling tested with slash-containing branch names; exact URL asserted; no wildcard/pattern/bulk/default endpoint | Applied — per-segment encoding of `heads/<branch>` (slash preserved) | §4.9, §7 (32) |
| 6. Typed-error export location chosen (Option B: `domain/repository-hosting.ts`, re-exported from core) so manager + adapter + runtime share them; no blanket-convert | Applied | §4.5, §7 (14–17) |
| Add tests 25–34 | Applied | §7 |

---

## 1. Goal

```text
REMOTE_BRANCH_CLEANUP_APPROVED
→ explicit remote cleanup EXECUTION command ("원격 브랜치 삭제 실행해줘" / "지금 원격 브랜치 삭제해줘" / "execute remote branch
  cleanup" / "proceed") — interpretRemoteBranchCleanupExecutionIntent (added in 3j-A)
→ re-read the 3j-A CRITICAL approval (status === APPROVED, executionPlanRef matches) via STRUCTURED fields only
→ re-validate the anchored remote target (identity + pullRequestRef + branch == pullRequestHeadBranch == pushedBranch,
  != main/default, safe name, expected head commit present)
→ RepositoryHostingManager.deleteRemoteBranch:
     live PR-still-merged/attributable read (getMergePreflight) → not merged / mismatch → Blocked
     live remote branch read (getRemoteBranchCommit): absent → idempotent success; SHA != expected → Blocked
     SINGLE provider.deleteRemoteBranch (read-immediately-before-delete → verify SHA == expected → GitHub refs DELETE)
→ REMOTE_BRANCH_CLEANED (+ remoteBranchCleanupMode 'remote', cleanedRemoteBranchName, remoteBranchDeletedCommit,
   remoteBranchCleanedAt/By, remoteBranchCleanupProvider 'github', cleanedRemoteBranch=true)
→ respond: which REMOTE branch was deleted; local branch / main / deploy / release / tag NOT touched

Known pre-delete failure (approval/preflight/SHA-mismatch/not-merged) → "원격 브랜치를 삭제하지 않았어요" (definitely not deleted)
Unknown failure AT/AFTER the DELETE attempt                          → "삭제 결과를 확인하지 못했어요" (never "not deleted")
Remote branch already absent                                         → REMOTE_BRANCH_CLEANED (idempotent) + "이미 없어요" (cleanedRemoteBranch=false)
Hosting not configured (no identity / no manager / no token)         → unavailable; anchor stays REMOTE_BRANCH_CLEANUP_APPROVED
```

---

## 2. Boundary & the most important rule

> **A remote branch cleanup execution deletes exactly ONE remote branch — the anchored, already-merged PR head branch
> — and nothing else, and ONLY from a live `REMOTE_BRANCH_CLEANUP_APPROVED` anchor + an explicit execution command +
> a full live preflight.** Sprint 3j-B performs **no** deletion of the default/`main` branch, **no** arbitrary/
> user-named branch, **no** bulk/wildcard/pattern, **no** force behavior, **no** `git push --delete` (Git stays
> local-only, ADR-0023), **no** local branch deletion (that was 3i), **no** deploy/release/tag, **no** PR/reviewer/
> label/assignee mutation, **no** workflow dispatch / check rerun, **no** shell/`CommandExecution`. It runs through
> the **RepositoryHosting capability** (`RepositoryHostingProvider`/`RepositoryHostingManager`), adapter-side, a
> single bounded GitHub REST `DELETE`. `REMOTE_BRANCH_CLEANED` means only: the completed PR's REMOTE head ref was
> deleted (or was already absent) this run — it does **not** mean deployed / released / tagged / production-ready /
> local-branch-deleted-this-run / all-branches-cleaned / repository-fully-cleaned. GitHub's refs API has **no atomic
> SHA-conditional delete** (§4.4), so correctness comes from a read-immediately-before-delete + explicit SHA verify;
> an ambiguous failure at/after the DELETE is **Unverified**, never "not deleted".

---

## 3. Architecture & reuse (source-verified)

- **Entry is `REMOTE_BRANCH_CLEANUP_APPROVED` only** (`conversation-runtime.ts`; the 3j-A approved block). 3j-B routes
  the execute branch (now checked FIRST, CA change 1) to the NEW `handleRemoteBranchCleanupExecutionTurn` (replacing
  the 3j-A `handleRemoteBranchCleanupExecutionUnavailableTurn`); `interpretRemoteBranchCleanupExecutionIntent` (3j-A)
  is hardened (bulk/main guard, §4.2). Every other approved-state route (re-request → already-approved; status →
  read-only preview; deploy → companion) is unchanged.
- **Target is the ANCHORED PR head branch** (`anchor.pullRequestHeadBranch`, cross-checked against `pushedBranch`) —
  **never user-supplied** (mirrors 3e/3g/3i/3j-A). The execution phrase carries no branch name.
- **Approval is CONSUMED, not re-created** — the manager re-reads the 3j-A `remoteBranchCleanupApprovalId`
  ApprovalRequest via STRUCTURED fields only (`status === APPROVED`, `executionPlanRef.id` match); it never re-opens
  the approval flow and never parses the reason. Mirrors `handleMergeExecutionTurn` (3g).
- **Ownership = RepositoryHosting** — two new provider methods (`getRemoteBranchCommit` read, `deleteRemoteBranch`
  mutate) + `RepositoryHostingManager.deleteRemoteBranch`. The runtime calls the **manager only**, never the provider,
  and receives **no token** (mirrors merge execution). **Git gains nothing.**
- **PR-still-merged re-read reuses the existing `getMergePreflight`** (single bounded GET; normalized `state`) — no
  new read method for that; only the two CA-specified methods are added.
- **Failure taxonomy reuses the ADR-0054 phase-aware rule** — KNOWN pre-delete → *Blocked* ("not deleted"); any
  failure at/after the single DELETE → *Unverified*. The manager does **not** blanket-convert provider `Blocked`.
- **`now()`** supplies `remoteBranchCleanedAt`; actor id supplies `remoteBranchCleanedBy`.

---

## 4. Design

### 4.1 New product state + anchor fields (State)

`ApplyPreviewAnchorStatus` gains, after `REMOTE_BRANCH_CLEANUP_APPROVED`: **`REMOTE_BRANCH_CLEANED`** (terminal).

```text
REMOTE_BRANCH_CLEANED — the completed PR's REMOTE head ref was deleted (or was already absent) DURING THIS RUN
                        (Sprint 3j-B, ADR-0060). Terminal. NOT deployed/released/tagged/production-ready/
                        local-branch-deleted-this-run/all-branches-cleaned/repository-fully-cleaned.
```

New `ApplyPreviewAnchor` fields (required on `REMOTE_BRANCH_CLEANED`; the `cleanedRemoteBranch` boolean already exists
from 3i/3j-A and is **set here**):

```text
remoteBranchCleanupMode?: 'remote'    // REQUIRED at REMOTE_BRANCH_CLEANED
cleanedRemoteBranchName?: string      // REQUIRED; == anchored PR head branch
remoteBranchCleanedAt?: IsoTimestamp  // REQUIRED; RUNTIME record timestamp (now())
remoteBranchCleanedBy?: Id            // REQUIRED; the actor who executed cleanup
remoteBranchCleanupProvider?: 'github'// REQUIRED; the hosting provider (RepositoryIdentity.provider)
remoteBranchDeletedCommit?: string    // the SHA the remote branch pointed at (== expected head), when deleted
cleanedRemoteBranch?: boolean         // REUSED: true when a remote ref was deleted this run; false when already absent
```

`REMOTE_BRANCH_CLEANED` **preserves the full prior chain** (`...anchor`): `repositoryIdentity`, `pullRequestRef`,
`pullRequestHeadBranch`, `pushedBranch`, `mergedHeadSha`, `mergeCommitHash`, `syncedMainCommit`, `mainSyncBranch`,
`branchCleanupMode`, `cleanedBranch`, `cleanedLocalBranch`, and the 3j-A approval evidence
(`remoteBranchCleanupApprovalId`, `remoteBranchCleanupApprovedAt`, `remoteBranchCleanupApprovalDecisionBy`). It clears
none of them.

### 4.2 Trigger — execution vs re-request (CA change 1)

`interpretRemoteBranchCleanupExecutionIntent` (added in 3j-A) is **hardened** and consulted **FIRST** at
`REMOTE_BRANCH_CLEANUP_APPROVED` (before the re-request classifier) so an execution phrase can never be swallowed by
the "already approved" route:

```ts
// A pure execute verb, MINUS bulk/wildcard/main/default (CA change 1). Only consulted at REMOTE_BRANCH_CLEANUP_APPROVED.
const REMOTE_CLEANUP_EXECUTE_VERB = /(실행|진행|지금|승인된|\bexecute\b|\bproceed\b|\bnow\b|go\s*ahead)/i;   // (from 3j-A)
static interpretRemoteBranchCleanupExecutionIntent(text: string): 'execute' | null {
  const t = text.trim().toLowerCase();
  if (CLEANUP_BULK.test(t) || CLEANUP_MAIN_TARGET.test(t)) return null; // bulk/wildcard/main/default → never execute (CA change 1)
  if (REMOTE_CLEANUP_EXECUTE_VERB.test(t)) return 'execute';
  return null;
}
```

Behavior (CA change 1):

```text
APPROVED + "원격 브랜치 삭제해줘"       → interpretRemoteBranchCleanupExecutionIntent null (no execute verb) → re-request → already approved
APPROVED + "원격 브랜치 삭제 실행해줘"   → 'execute' (실행) → execution
APPROVED + "지금 원격 브랜치 삭제해줘"   → 'execute' (지금) → execution
APPROVED + "execute remote branch cleanup" → 'execute' → execution
APPROVED + "proceed"                  → 'execute' → execution
APPROVED + "원격 브랜치 다/전부/모두/main/default 삭제 실행해줘" → null (bulk/main guard) → no execute, no delete
```

A re-request (`interpretRemoteBranchCleanupIntent === 'remote'`) is checked SECOND → already-approved (no re-request,
no second CRITICAL approval). The execution target is always the anchored PR head branch (never user-supplied).
**No approval-flow re-design; only the execute classifier is hardened + routed first.**

### 4.3 Required live remote preflight — 17 checks

Split across the runtime (approval/anchor/local-cleanup evidence, all pre-mutation → *Blocked*) and the
RepositoryHosting Manager (live reads, then the single DELETE). Ordered; every failure **before** the DELETE is
*Blocked* ("not deleted").

Runtime `handleRemoteBranchCleanupExecutionTurn` (before any manager call). Check 1 → `composeRemoteBranchCleanupExecutionUnavailable`
(not-configured; anchor unchanged); checks 2–14 → `composeRemoteBranchCleanupExecutionBlocked`:

```text
1.  identity + manager configured (deps.repositoryHosting.identity && .manager) — else Unavailable (anchor unchanged)
2.  anchor.status === 'REMOTE_BRANCH_CLEANUP_APPROVED'
3.  anchor.executionPlanRef present
4.  COMPLETE 3j-A approval evidence present (CA change 4): remoteBranchCleanupApprovalId AND
    remoteBranchCleanupApprovalRequestedAt AND remoteBranchCleanupApprovedAt AND remoteBranchCleanupApprovalDecisionBy
5.  the ApprovalRequest re-reads status === APPROVED AND executionPlanRef.id === anchor.executionPlanRef.id (structured only;
    never parse reason) — not relying on the id + fetched status alone (combined with check 4)
6.  anchor.repositoryIdentity matches the configured deps identity (provider/owner/repo)
7.  anchor.pullRequestRef present AND belongs to the same identity (ref.provider/owner/repo === identity)
8.  target := anchor.pullRequestHeadBranch present; target === anchor.pushedBranch
9.  target !== 'main' (PR_BASE_BRANCH_POLICY / default branch)
10. target passes isSafePushBranch
11. expectedHeadCommit := anchor.mergedHeadSha (CA change 2 — NO fallback to pullRequestCommitHash) present AND SHA-shaped
12. LOCAL-cleanup chain present + consistent (CA change 3): anchor.branchCleanupMode === 'local'
13.   AND anchor.cleanedBranch === anchor.pullRequestHeadBranch (== target)
14.   AND anchor.cleanedRemoteBranch === false AND typeof anchor.cleanedLocalBranch === 'boolean'
      (cleanedLocalBranch may be true or false — local cleanup could have been idempotent already-absent — but the
       local-cleanup evidence must exist; missing/inconsistent → Blocked before the manager call)
```

Manager `deleteRemoteBranch` (live reads → single DELETE) — checks 15–17, all pre-DELETE → *Blocked*:

```text
15. PR still confirmably merged/attributable — live getMergePreflight: ref/head-branch integrity match AND state === 'merged'; else Blocked
16. remote branch existence + SHA — live getRemoteBranchCommit(identity, target):
       null (404)                    → ABSENT → idempotent success (§4.7), NO DELETE call
       commit !== expectedHeadCommit → Blocked (remote branch moved after merge; a moved branch is never deleted)
17. single exact branch target — the provider takes ONE exact branch name (no wildcard/pattern/bulk method exists)
```

Only when checks 1–16 pass (and the branch exists at the expected SHA) is the single DELETE (§4.4) performed. The
provider re-reads the ref immediately before the DELETE to minimize the race window.

**Expected commit (CA change 2).** `expectedHeadCommit := anchor.mergedHeadSha` — the merge-execution evidence from
`PR_MERGED` (ADR-0057). There is **no fallback to `anchor.pullRequestCommitHash`** (weaker, earlier PR-context
evidence): if `mergedHeadSha` is absent or not SHA-shaped, the turn **Blocks** before the manager call.

### 4.4 Deletion strategy — read-immediately-before-delete (GitHub has NO atomic CAS) (GitHub CAS Limitation)

**ADR-0060 limitation preserved:** `DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}` accepts **no** expected-SHA
/ `If-Match` parameter — **a true SHA-conditional delete is impossible via the GitHub refs API.** Mitigation (CA):

```text
Inside provider.deleteRemoteBranch({ identity, branch, expectedCommitHash }):
  1. GET  /repos/{owner}/{repo}/git/ref/heads/{branch}    → object.sha  (read IMMEDIATELY before delete)
     - 404 → return { deleted:false, alreadyAbsent:true }  (idempotent; manager also handled absent at check 12)
  2. verify object.sha === expectedCommitHash             → mismatch → RemoteBranchCleanupBlockedError (moved; not deleted)
  3. DELETE /repos/{owner}/{repo}/git/refs/heads/{branch} → 204 → { deleted:true, deletedCommitHash: expectedCommitHash }
     - any non-204 / network throw → RemoteBranchCleanupUnverifiedError (the DELETE may have taken effect)
```

- The read→verify→delete window is a single adapter round-trip; the target is the head of an **already-merged** PR
  (unlikely to receive new pushes), and the manager's check 12 already verified the SHA once. **Residual race**
  (a concurrent push advancing the branch between the read and the DELETE) is **explicitly accepted** and **bounded**
  by (a) the merged-PR context, (b) the millisecond window, (c) the Unverified-on-ambiguity rule (§4.7). GitHub
  provides no atomic conditional-delete on refs; a delete whose outcome we cannot confirm is **never** "not deleted".
- **NEVER** `git push --delete` / `-r` / a wildcard / a pattern / the default branch / a force flag / a bulk call.
  Single exact ref, RepositoryHosting-side, bounded `fetch`, sanitized errors (no token/raw payload), **no retry**
  (mirrors the 3d-C/3e/3g adapter discipline). The adapter `request` gains `'DELETE'` as a method (currently
  `'GET'|'POST'|'PUT'`); a 204 response has no JSON body (do not call `res.json()` on success).

### 4.5 Ownership + capability change (Provider API)

**Remote branch deletion → the RepositoryHosting capability. `git push --delete` (Git) is REJECTED** (ADR-0023: Git
is local-repository-only and must never handle a remote URL/credentials; routing a remote mutation through it would
smuggle blast radius behind a "local" capability). **Git gains nothing in 3j-B.**

**Provider port (`RepositoryHostingProvider`) — one read + one mutating method; NO `ApprovalRef`:**

```ts
// READ-ONLY (ADR-0060, 3j-B) — the remote branch head commit, or null when the branch is absent (404). Single bounded
// GET (GET /repos/{owner}/{repo}/git/ref/heads/{branch}); sanitized errors; no token/raw payload; no pagination/retry.
getRemoteBranchCommit(identity: RepositoryIdentity, branch: string): Promise<{ commitHash: string } | null>;

// The ONLY new mutating method (ADR-0060, 3j-B) — deletes EXACTLY one remote branch. Takes NO ApprovalRef (consumed by
// the Manager). Reads the ref immediately, verifies object.sha === expectedCommitHash (§4.4; GitHub has no atomic CAS),
// then DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}. NEVER the default branch / a wildcard-pattern / a force
// flag / git push. PHASE-AWARE: pre-DELETE SHA mismatch/known failure → RemoteBranchCleanupBlockedError; a failure
// AT/AFTER the DELETE → RemoteBranchCleanupUnverifiedError.
deleteRemoteBranch(input: {
  identity: RepositoryIdentity;
  branch: string;
  expectedCommitHash: string;
}): Promise<RemoteBranchCleanupResult>;
```

**Manager (`RepositoryHostingManager.deleteRemoteBranch`) — preflight + single DELETE; consumes the ApprovalRef:**

```ts
async deleteRemoteBranch(input: {
  identity: RepositoryIdentity;
  pullRequestRef: PullRequestRef;
  expectedHeadBranch: string;
  expectedBaseBranch: string;
  branch: string;                 // == anchored PR head branch (never user-supplied)
  expectedCommitHash: string;     // == anchored merged head SHA
  approvalRef: ApprovalRef;
}): Promise<RemoteBranchCleanupResult>
// 1. backstop validation → BlockedError (approval APPROVED; provider.kind === identity.provider; supported;
//    owner/repo safe; ref belongs to identity; safe branch; branch !== 'main'; branch !== base; SHA-shaped expected).
// 2. live getMergePreflight → ref/head integrity + state === 'merged'; read failure/mismatch/non-merged → BlockedError (check 11).
// 3. getRemoteBranchCommit(identity, branch): null → idempotent { deleted:false, alreadyAbsent:true } (check 12);
//    commit !== expectedCommitHash → BlockedError.
// 4. SINGLE provider.deleteRemoteBranch: provider BlockedError → Blocked; UnverifiedError → Unverified; any OTHER
//    throw → Unverified (NO blanket-convert of the Blocked case). Result-integrity (branch === target, deleted true or
//    alreadyAbsent, identity match) mismatch → Unverified.
```

**New domain type + errors — Option B (CA change 6): `packages/core/src/domain/repository-hosting.ts`, re-exported
from the core package index.** Rationale: the GitHub **adapter** (`repository-hosting-github`) must *throw* the
phase-aware typed errors, the **manager** must `instanceof`-branch on them (Blocked stays Blocked; Unverified/unknown
→ Unverified — no blanket-convert), and the **runtime** must `instanceof`-branch to pick the composer. All three reach
the domain via the core public API (the adapter imports from `@chunsik/core`), so a single domain-level export is the
one location shared by all three **without leaking provider details into runtime logic** (the runtime only sees the
typed error, never a raw provider payload). (Option A — manager-exported — is rejected: the adapter cannot import from
the manager module across the package boundary.)

```ts
export interface RemoteBranchCleanupResult {
  provider: RepositoryHostingProviderKind;  // 'github'
  owner: string;
  repo: string;
  branch: string;              // the deleted (or already-absent) remote branch (== anchored PR head branch)
  deleted: boolean;            // true when this run deleted a remote ref; false when already absent
  alreadyAbsent: boolean;      // true when the remote branch did not exist (404)
  deletedCommitHash?: string;  // the commit the remote branch pointed at (== expectedCommitHash), when deleted
}
export class RemoteBranchCleanupBlockedError extends Error {}     // definitively NOT deleted (pre-DELETE)
export class RemoteBranchCleanupUnverifiedError extends Error {}  // DELETE attempted; outcome unknown — never "not deleted"
```

Runtime `deps.repositoryHosting.manager` gains `deleteRemoteBranch` (type-only widening; the runtime calls the manager
ONLY, never the provider, and passes NO token — the token stays adapter-local, exactly as merge execution).

### 4.6 Runtime execution turn + routing

The 3j-A `REMOTE_BRANCH_CLEANUP_APPROVED` block changes exactly one route (execute → the new turn); a new
`REMOTE_BRANCH_CLEANED` terminal block is added.

`REMOTE_BRANCH_CLEANUP_APPROVED` (3j-B) — **execution checked FIRST (CA change 1)** so an execute phrase is never
swallowed by the re-request route:

```text
1. interpretRemoteBranchCleanupExecutionIntent === 'execute'→ handleRemoteBranchCleanupExecutionTurn (NEW — preflight → single DELETE → REMOTE_BRANCH_CLEANED)
2. interpretRemoteBranchCleanupIntent === 'remote'          → handleRemoteBranchCleanupAlreadyApprovedTurn (unchanged; no re-approval)
3. status/check phrase                                      → handlePrStatusPreviewTurn (read-only; keeps the state)
4. merge phrase                                             → handleMergeAlreadyMergedTurn
5. DEPLOY_ONLY_WORDS / companion                            → handleMergeExecutionUnsupportedCompanionTurn
```

New terminal `REMOTE_BRANCH_CLEANED` block (idempotent; NEVER re-deletes/deploys):

```text
1. interpretRemoteBranchCleanupIntent === 'remote'  → handleRemoteBranchAlreadyCleanedTurn (already cleaned; no mutation)
2. interpretBranchCleanupIntent === 'local'         → handleBranchAlreadyCleanedTurn
3. interpretMainSyncIntent === 'sync'               → handleMainAlreadySyncedTurn
4. status/check phrase                              → handlePrStatusPreviewTurn (read-only; keeps REMOTE_BRANCH_CLEANED)
5. merge phrase                                     → handleMergeAlreadyMergedTurn
6. DEPLOY_ONLY_WORDS / companion                    → handleMergeExecutionUnsupportedCompanionTurn
```

`handleRemoteBranchCleanupExecutionTurn` (mirrors `handleMergeExecutionTurn`, 3g): resolve identity+manager (not
configured → `composeRemoteBranchCleanupUnavailable`, anchor unchanged); run the runtime preflight (checks 2–10 →
`composeRemoteBranchCleanupExecutionBlocked`); re-read the 3j-A approval via structured fields; call
`manager.deleteRemoteBranch(...)` passing `approvalRef(request)` and NO token. On success → anchor
`REMOTE_BRANCH_CLEANED` (fields per §4.1; `cleanedRemoteBranch = result.deleted`); on `RemoteBranchCleanupBlockedError`
→ `composeRemoteBranchCleanupExecutionBlocked` (stays `REMOTE_BRANCH_CLEANUP_APPROVED`); on
`RemoteBranchCleanupUnverifiedError` **and any unknown throw** → `composeRemoteBranchCleanupUnverified` (stays
`REMOTE_BRANCH_CLEANUP_APPROVED`). The 3j-A `handleRemoteBranchCleanupExecutionUnavailableTurn`/
`composeRemoteBranchCleanupExecutionUnavailable` are removed (superseded). The read-only status-preview guard widens
to also accept `REMOTE_BRANCH_CLEANED`.

### 4.7 Failure semantics (extends the ADR-0054/0060 rule to remote branch deletion)

```text
KNOWN pre-DELETE block → RemoteBranchCleanupBlockedError → composeRemoteBranchCleanupExecutionBlocked
    (any of checks 1–12 fails, incl. approval not APPROVED, plan/identity/ref mismatch, target==main/default, unsafe
    name, PR not confirmably merged, remote SHA mismatch, could-not-read live state). Safe to say "원격 브랜치를 삭제하지
    않았어요." Anchor stays REMOTE_BRANCH_CLEANUP_APPROVED (approval still valid; the user may retry).

UNKNOWN / generic / result-integrity failure AT/AFTER the DELETE → RemoteBranchCleanupUnverifiedError → composeRemoteBranchCleanupUnverified
    (the DELETE returned non-204 ambiguously, threw, or the result failed integrity). The ref MAY be gone. MUST NOT
    claim "not deleted" and MUST NOT claim "deleted" — say "삭제 결과를 확인하지 못했어요, GitHub에서 확인해 주세요."
    Anchor stays REMOTE_BRANCH_CLEANUP_APPROVED.

ALREADY ABSENT (remote branch 404 at check 12 / provider read) → composeRemoteBranchCleanupSucceeded (alreadyAbsent)
    + anchor REMOTE_BRANCH_CLEANED (idempotent, cleanedRemoteBranch=false); NO DELETE call.

NOT CONFIGURED (no identity / no manager / no token) → composeRemoteBranchCleanupUnavailable; no state change.
```

The manager does **not** blanket-convert provider throws (a provider `Blocked` stays `Blocked`; `Unverified` and any
unknown throw are `Unverified`).

### 4.8 Response composers + wording

New/finalized `ResponseComposer` methods (deterministic, bounded); distinguish remote-deleted / already-absent /
blocked / unverified / unavailable:

```text
composeRemoteBranchCleanupSucceeded(context, { branch, cleanedRemoteBranch, alreadyAbsent })
  — deleted:       "원격 브랜치 '<name>'을 삭제했어요 (병합 완료된 PR의 브랜치예요). 로컬 브랜치·main은 건드리지 않았어요. 배포/릴리즈/태그도 하지 않았어요."
  — alreadyAbsent: "원격 브랜치 '<name>'은 이미 없어요. 이번엔 삭제한 원격 브랜치가 없어요. 로컬 브랜치·main은 변경하지 않았어요. 배포/릴리즈/태그도 하지 않았어요."
composeRemoteBranchCleanupExecutionBlocked(context)  — "원격 브랜치를 삭제하지 않았어요" + safe reason. NEVER claims deleted.
composeRemoteBranchCleanupUnverified(context)        — "원격 브랜치 삭제 결과를 확인하지 못했어요, GitHub에서 확인해 주세요." NEVER "not deleted"/"deleted".
composeRemoteBranchAlreadyCleaned(context, { branch })— at REMOTE_BRANCH_CLEANED: already cleaned; nothing newly deleted.
composeRemoteBranchCleanupExecutionUnavailable(context) — REPURPOSED from 3j-A ("not implemented yet" → 3j-B: not
                                                       configured / cannot execute now; no state change). The 3j-A
                                                       handleRemoteBranchCleanupExecutionUnavailableTurn is removed
                                                       (superseded by handleRemoteBranchCleanupExecutionTurn).
```

**Wording invariants:** distinguish remote-deleted / nothing-newly-deleted (already absent) / blocked / unverified;
every path states local branch + main were NOT touched; never imply deployed / released / production-ready / tagged /
all-branches-cleaned / repository-fully-cleaned.

### 4.9 GitHub adapter (adapter-only)

`packages/repository-hosting-github/src/index.ts` implements the two provider methods against github.com REST via the
built-in `fetch` (no octokit/gh/curl/shell; base fixed to `https://api.github.com`; token adapter-local):

```text
getRemoteBranchCommit → GET /repos/{enc(owner)}/{enc(repo)}/git/ref/heads/{encRefPath(branch)}
    200 → { commitHash: body.object.sha } (validate SHA-shaped; reject a non-"commit" object type)
    404 → null ; other status → sanitized statusError
deleteRemoteBranch → (read-before-delete, §4.4): getRemoteBranchCommit → absent → alreadyAbsent; SHA mismatch →
    RemoteBranchCleanupBlockedError; else DELETE /repos/{enc(owner)}/{enc(repo)}/git/refs/heads/{encRefPath(branch)}
    204 → { deleted:true, deletedCommitHash: expectedCommitHash } ; non-204/throw → RemoteBranchCleanupUnverifiedError
```

**Slash-containing branch names (CA change 5).** The GitHub refs endpoints address the ref as
`heads/<branch>` where `<branch>` is a **path** (`refs/heads/feature/login`), NOT a single URL segment. So the branch
must be encoded **per slash-segment** — encode each segment, join with `/` (slash preserved):

```ts
// heads/feature/login  → "heads/feature/login" (each segment percent-encoded, the '/' separators kept)
function encRefPath(branch: string): string {
  return `heads/${branch.split('/').map(encodeURIComponent).join('/')}`;
}
// → GET/DELETE /repos/<owner>/<repo>/git/ref(s)/heads/feature/login   (NOT heads%2Ffeature%2Flogin)
```

`enc()` (single-segment `encodeURIComponent`, used for owner/repo) must **not** be used for the branch here — it would
`%2F`-escape the slashes and address the wrong ref. Adapter tests assert the **exact** requested URL path for
`v2/remote-branch-cleanup-approval` and `feature/login`, and that no wildcard/pattern/bulk/default-branch endpoint is
ever constructed. `request` gains `'DELETE'`; a 204 success is not JSON-parsed. Errors never include the token or the
raw payload (reuse `statusError`). Fake-`fetch` unit tests only — no live network.

---

## 5. Required design decisions — summary

- **State.** Add `REMOTE_BRANCH_CLEANED` (terminal) + the six descriptive fields; set the reused `cleanedRemoteBranch`.
  Preserve the full prior chain incl. the 3j-A approval evidence (§4.1).
- **Ownership.** RepositoryHosting owns the delete; `git push --delete` / a Git provider/manager remote-delete method /
  shell / `CommandExecution` are forbidden (§4.5, §6).
- **Approval.** Consumed, not re-designed — re-read the 3j-A CRITICAL approval via structured fields; no second
  approval, no reason parsing (§4.2, §4.3 check 4).
- **Preflight + CAS.** 13 live checks (§4.3); GitHub has no atomic SHA-conditional delete → read-immediately-before-
  delete + SHA verify + DELETE, bounded accepted residual race (§4.4).
- **Already absent.** Idempotent `REMOTE_BRANCH_CLEANED` (`cleanedRemoteBranch=false`, no DELETE) (§4.3/§4.7).
- **Failure.** Phase-aware: pre-DELETE → Blocked ("not deleted"); at/after → Unverified (never "not deleted"); no
  blanket-convert; new typed errors (§4.7).
- **Provider API.** `getRemoteBranchCommit` + `deleteRemoteBranch`; no ApprovalRef to the provider; manager consumes
  approval; runtime → manager only; token adapter-local (§4.5).

---

## 6. Out of scope — explicitly forbidden

Sprint 3j-B's implementation must **not** add or perform any of:

```text
deploy · release · tag creation · delete the default/'main' branch · delete arbitrary/user-named branches ·
bulk branch deletion · wildcard/pattern deletion · force behavior · git push --delete (Git stays local-only) ·
LOCAL branch deletion (that was 3i) · reset --hard/force push · PR mutation · reviewer/label/assignee mutation ·
workflow dispatch · check rerun · CommandExecution/shell fallback · ExecutionOrchestrator changes ·
WorkspaceWrite/Patch/CodeGeneration changes · Git capability changes · a second/new approval design (3j-A owns it)
```

`RepositoryHostingProvider` gains exactly one read + one mutating method (both single, exact, bounded). The token
stays adapter-local. The runtime calls the manager only, never the provider.

---

## 7. Required tests in the implementation (24 + 25–34 = 34 — CA list)

Runtime tests (`conversation-runtime.test.ts`) + RepositoryHosting Manager tests (`repository-hosting-manager.test.ts`
with a fake provider) + GitHub adapter tests (`repository-hosting-github` with an injected fake `fetch`). Numbered to
CA's list:

```text
1.  REMOTE_BRANCH_CLEANUP_APPROVED + execute phrase → the execution path runs (manager.deleteRemoteBranch called).
2.  the 3j-A approval is re-read and must be APPROVED (non-APPROVED → Blocked, no delete).
3.  executionPlanRef mismatch → Blocked, no delete.
4.  missing remoteBranchCleanupApprovalId → Blocked, no delete.
5.  repository identity mismatch (anchor vs configured / ref vs identity) → Blocked, no delete.
6.  pullRequestRef mismatch → Blocked, no delete.
7.  target branch != pullRequestHeadBranch/pushedBranch → Blocked, no delete.
8.  target main/default branch → Blocked, no delete.
9.  unsafe target branch name → Blocked, no delete.
10. PR not confirmably merged (live read) → Blocked, no delete.
11. remote branch absent (404) → idempotent REMOTE_BRANCH_CLEANED (cleanedRemoteBranch=false), NO DELETE call.
12. remote branch SHA mismatch → Blocked, no DELETE.
13. remote branch SHA match + APPROVED + execute → exactly ONE DELETE call.
14. provider Blocked remains Blocked ("not deleted").
15. provider Unverified remains Unverified.
16. unknown provider throw after the mutation path → Unverified (never "not deleted").
17. result-integrity mismatch → Unverified.
18. success anchors REMOTE_BRANCH_CLEANED and preserves the full chain (identity/pullRequestRef/head/pushedBranch/
    mergedHeadSha/mergeCommitHash/syncedMainCommit/mainSyncBranch + 3i local + 3j-A approval evidence).
19. response says remote branch deleted; local branch / main / deploy / release / tag untouched.
20. already-absent response says nothing newly deleted and avoids overclaim.
21. no Git method or git push --delete exists (Git capability unchanged; no push --delete argv).
22. no shell / CommandExecution fallback (adapter uses bounded fetch only).
23. no deploy/release/tag/PR mutation on any path.
24. the token is adapter-local ONLY and never appears in the reason/anchor/response/log.
```

CA additional tests (25–34):

```text
25. APPROVED + "원격 브랜치 삭제해줘" → already approved, no delete.
26. APPROVED + "원격 브랜치 삭제 실행해줘" → execution path (manager.deleteRemoteBranch called).
27. APPROVED + "지금 원격 브랜치 삭제해줘" → execution path.
28. APPROVED + execute phrase containing bulk/wildcard/main/default → no delete (classifier rejects).
29. missing mergedHeadSha (or not SHA-shaped) → Blocked, no delete; NO pullRequestCommitHash fallback.
30. local-cleanup evidence missing/inconsistent (branchCleanupMode/cleanedBranch/cleanedRemoteBranch/cleanedLocalBranch) → Blocked, no delete.
31. approval evidence incomplete (approvedAt / decisionBy / requestedAt missing) → Blocked, no delete.
32. slash-containing branch names produce the EXACT GitHub refs URL (heads/feature/login, heads/v2/remote-branch-cleanup-approval) and delete only that one ref.
33. provider already-absent after the manager saw it present → idempotent REMOTE_BRANCH_CLEANED, cleanedRemoteBranch=false.
34. REMOTE_BRANCH_CLEANED + remote cleanup phrase → already cleaned, no second DELETE.
```

Additional guard tests (enduring invariants): the adapter emits `DELETE /git/refs/heads/<exact-branch>` only — never a
`push`/`--delete`/`-r`/force/wildcard, and never the default branch; a 204 is not JSON-parsed; exactly ONE DELETE and
only after the full preflight passes; the Manager does NOT blanket-convert provider `Blocked`; `REMOTE_BRANCH_CLEANED`
never unlocks deploy/release/tag and never re-deletes.

---

## 8. Validation & stop condition

- **3j-B implementation validation:** Node 22 · `pnpm typecheck` (exit 0) · `pnpm test` (full suite green, +3j-B tests).
- **3j-B stops after opening the PR** (per CA Final Instruction) — the execution half of ADR-0060. Still forbidden:
  deploy/release/tag, default/main/arbitrary/bulk/wildcard delete, force, `git push --delete`, Git capability change,
  local branch deletion, reset/force-push, PR/reviewer/label/assignee mutation, workflow dispatch, check rerun,
  shell/`CommandExecution`, `ExecutionOrchestrator`/`WorkspaceWrite`/`Patch`/`CodeGeneration` change, a second/new
  approval design.
