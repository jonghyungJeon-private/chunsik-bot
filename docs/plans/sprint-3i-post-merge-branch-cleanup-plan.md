# Sprint 3i Plan — Post-Merge Branch Cleanup (LOCAL merged-branch delete only; remote deletion deferred; NO force/bulk/wildcard)

- **Status:** APPROVED WITH CHANGES (all 6 CA plan-review changes applied) → implementing on branch
  `v2/post-merge-branch-cleanup`; PR to open for CA Implementation Review. Do not merge.
- **Base:** `main @ 5758a0134c4772283f55b99f3247fac905eb5de3`
- **Validation runtime (for the FUTURE implementation):** Node 22 · `pnpm typecheck` · `pnpm test`
- **ADR (proposed):** ADR-0059 — Post-Merge Branch Cleanup (added to `DECISIONS.md` at implementation time, not now).
- **Nature:** from a live `MAIN_SYNCED` anchor, an explicit cleanup command deletes the **already-merged local
  feature branch** (the anchored PR head branch) — via the **Git capability** (CAP-002), **safe delete only**
  (`git branch -d`, never `-D`/force), never a shell. **Remote branch deletion is explicitly DEFERRED** to a
  future, separately-gated sprint (CA preference). **No force-delete of an unmerged branch, no bulk/wildcard, no
  deleting `main`, no deploy/release, no remote push, no PR mutation.**
- **Predecessors (reused, not re-litigated):**
  - **ADR-0058** (Sprint 3h) — the `MAIN_SYNCED` anchor + `syncedMainCommit`/`mainSyncBranch` this consumes as the
    sole trigger source + cleanup evidence.
  - **ADR-0057/0054** — the `pullRequestHeadBranch`/`pushedBranch` (the completed chain's feature branch = the
    ONLY deletion target) and the remote-mutation Blocked-vs-Unverified safety rule (extended to local deletion).
  - **ADR-0046/0048/0023** — the Git mutation discipline (single bounded argv operation, adapter-side, no shell,
    provider result is not an independent verification); Git = local **repository** capability.

---

## 0. CA required plan questions → where answered

| CA plan question | Answered in |
|---|---|
| Q1 New product state (`BRANCH_CLEANED`?) + fields | §4.1, §5 Q1 |
| Q2 Ownership (local = Git; remote = defer / separate approval) | §4.5, §5 Q2 |
| Q3 Conservative trigger classifier | §4.2, §5 Q3 |
| Q4 Preflight (15 checks) | §4.3 |
| Q5 Failure semantics (Blocked vs Unverified) | §4.6 |
| Q6 Approval (local: none; remote: deferred/approval) | §5 Q6 |
| Q7 Response wording | §4.7 |
| Q8 Out of scope | §6 |
| Required tests (18) | §7 |

---

## 0.1 CA plan-review disposition (APPROVED WITH CHANGES → all 6 applied)

| CA required change | Disposition | Where |
|---|---|---|
| 1. Remote-cleanup phrases must route to `composeRemoteBranchCleanupUnsupported` (never local cleanup as a side effect); classifier order: remote-phrase → unsupported, THEN local-phrase → local cleanup | Applied — `interpretRemoteBranchCleanupIntent` checked FIRST | §4.2, §4.8, §7 (19/20) |
| 2. Delete target uses a CAS-style `expectedBranchCommit`; provider `deleteMergedLocalBranch(rootPath, branch, expectedBranchCommit)`; moved-before → Blocked, ambiguous during/after → Unverified | Applied | §4.4, §4.5, §7 (22/23) |
| 3. Do not rely on `git branch -d`/current HEAD; **Option A** — `git update-ref -d refs/heads/<target> <expectedBranchCommit>` after the manager verifies the target is an ancestor of `syncedMainCommit` (deterministic, no checkout switch) | Applied | §4.4, §4.5, §7 (25/26) |
| 4. Manager must read local `main` and verify it still equals `anchor.syncedMainCommit`; moved → Block | Applied | §4.3 (check 9b), §7 (24) |
| 5. `already absent` stays idempotent with local-only wording ("already absent; no branch deleted this run; remote not deleted; main not changed") | Applied | §4.6, §4.7, §7 (27) |
| 6. Add tests 19–28 | Applied | §7 |

## 1. Goal

From a live `MAIN_SYNCED` anchor, an explicit **local** branch-cleanup command deletes the already-merged feature
branch (the anchored PR head branch) — safe delete only, after a conservative preflight:

```text
MAIN_SYNCED
→ explicit LOCAL branch cleanup command ("로컬 브랜치 정리해줘" / "merged branch 정리해줘" / "feature branch 삭제해줘" /
  "cleanup local branch" / "delete local merged branch")
→ verify MAIN_SYNCED context (syncedMainCommit + mainSyncBranch == main)
→ resolve the deletion target = the ANCHORED PR head branch (never a user-named branch)
→ verify target != main, safe branch name, target belongs to the completed chain
→ verify local main synced to the expected commit; target is fully merged into local main; target NOT checked out
→ delete the LOCAL branch (git branch -d — safe/merged-only, never -D)
→ anchor BRANCH_CLEANED (+ cleanedBranch, cleanedLocalBranch, branchCleanupMode: 'local', branchCleanedAt/By)
→ respond: which LOCAL branch was deleted, that main/remote/other branches were NOT touched, and NO deploy/release

Known pre-delete failure (any preflight / not-merged / checked-out / unsafe)  → "브랜치를 삭제하지 않았어요" (definitely not deleted)
Unknown failure AFTER the delete attempt                                     → "삭제 결과를 확인하지 못했어요, git branch로 확인해 주세요" (never "not deleted")
Local branch already absent                                                  → BRANCH_CLEANED (idempotent) + "이미 정리되어 있어요" (nothing deleted this run)
Git / repository not available                                               → "정리할 수 없어요 (저장소 확인)"
```

**Remote branch deletion is NOT performed in Sprint 3i** — it is deferred (§4.5, §5 Q2/Q6).

---

## 2. Boundary & the most important rule

> **A branch cleanup deletes exactly ONE already-merged LOCAL branch — the anchored PR head branch — and nothing
> else.** Sprint 3i performs **no** remote branch deletion (deferred), **no** force delete (`git branch -D`/
> `--force`), **no** deletion of `main`, **no** bulk/wildcard/pattern deletion, **no** deletion of an unmerged or
> currently-checked-out branch, **no** `reset --hard`/force push/remote push, **no** PR mutation, **no** deploy/
> release/tag, **no** `CommandExecution`/shell, **no** `ExecutionOrchestrator`/`WorkspaceWrite`/`Patch`/
> `CodeGeneration` change. It runs through the **Git capability** (`GitProvider`/`GitManager`), adapter-side,
> argv-only. `BRANCH_CLEANED` means only: the specific completed feature branch's LOCAL reference was deleted (or
> was already absent) this run — it does **not** mean deployed / released / production-ready / tagged / all-
> branches-cleaned / repository-fully-cleaned / remote-branch-deleted. If the branch is not fully merged, is
> checked out, is `main`, or the name is unsafe → **block, never force**. Unknown failure after the delete attempt
> is **unverified**, never "not deleted" (the ADR-0054 safety rule, applied to local branch deletion).

---

## 3. Architecture & reuse (source-verified)

- **Trigger anchored to `MAIN_SYNCED` only** (`conversation-runtime.ts`; the 3h `MAIN_SYNCED` routing block). A new
  `interpretBranchCleanupIntent` is consulted **only** there. Every other state is unchanged — a cleanup phrase
  elsewhere never deletes.
- **The deletion target is the ANCHORED PR head branch** (`anchor.pullRequestHeadBranch`, cross-checked against
  `pushedBranch`) — **never a user-named branch** (mirrors the 3e/3g rule: query the anchored ref, not a fresh
  user-supplied id). The user's phrase only expresses "clean up the merged branch"; the target is fixed by the
  anchor. This is why `main 삭제해줘` and `<arbitrary> 삭제해줘` cannot delete anything but the completed chain's
  feature branch, and the preflight still rejects `main`.
- **Reads/preserves the `MAIN_SYNCED` causal chain** — `syncedMainCommit`, `mainSyncBranch`, `pullRequestHeadBranch`,
  `pushedBranch`, `repositoryIdentity`, `workspaceRef.rootPath`.
- **Git access mirrors 3h sync** — the runtime reaches Git only through `this.deps.git.*` (a `GitManager`), never
  shelling out; `rootPath = anchor.workspaceRef.rootPath`; base policy `main` (`PR_BASE_BRANCH_POLICY`).
- **New Git capability method mirrors `syncMainFastForward`** — one single **safe** local-branch delete, adapter-
  side, argv-only, timeout, masked stderr, defensive branch-name validation, phase-aware errors. The provider
  result is not an independent verification.
- **Failure taxonomy reuses the ADR-0054 rule** — a KNOWN pre-delete failure is *Blocked* ("not deleted"); any
  failure at/after the single delete call is *Unverified*.
- **`now()`** supplies `branchCleanedAt`; actor id supplies `branchCleanedBy`. **No RepositoryHosting change, no
  push, no PR mutation.**

---

## 4. Design

### 4.1 New product state + anchor fields (Q1)

`ApplyPreviewAnchorStatus` gains, after `MAIN_SYNCED`: **`BRANCH_CLEANED`** (terminal). No `DEPLOYED`/`RELEASED`/
`TAGGED`.

```text
BRANCH_CLEANED — the specific completed feature branch's LOCAL reference was deleted (or was already absent) DURING
                 THIS RUN (Sprint 3i, ADR-0059). Terminal. NOT deployed/released/production-ready/tagged/
                 all-branches-cleaned/repository-fully-cleaned/remote-branch-deleted.
```

New `ApplyPreviewAnchor` fields (optional on the type; **required on `BRANCH_CLEANED`** as noted):

```text
branchCleanupMode?: 'local' | 'remote' | 'local-and-remote' // required on BRANCH_CLEANED; ALWAYS 'local' in 3i
                                                            //   ('remote'/'local-and-remote' reserved for a future gated sprint)
cleanedBranch?: string          // required on BRANCH_CLEANED; the branch name targeted (== anchored PR head branch)
branchCleanedAt?: IsoTimestamp  // required on BRANCH_CLEANED; RUNTIME record timestamp (now())
branchCleanedBy?: Id            // required on BRANCH_CLEANED; the actor who triggered cleanup
cleanedLocalBranch?: boolean    // required on BRANCH_CLEANED; true when a local ref was deleted this run (false when already absent)
cleanedRemoteBranch?: boolean   // required on BRANCH_CLEANED; ALWAYS false in 3i (remote deletion deferred)
```

`BRANCH_CLEANED` **preserves the full `MAIN_SYNCED` chain** (`...anchor`): identity/pullRequestRef/head/base/commit
+ merge evidence + sync evidence. It never clears them.

### 4.2 Runtime trigger classifier (Q3)

A new deterministic classifier, consulted **only** at `MAIN_SYNCED` (and, for the already-cleaned reply, at
`BRANCH_CLEANED`). Requires a cleanup verb AND a branch word, and rejects bulk/wildcard/`main`-target phrases:

```ts
const CLEANUP_VERB = /(정리|삭제|지워|없애|\bcleanup\b|clean\s*up|\bdelete\b|\bremove\b|\bprune\b)/i;
const BRANCH_WORD = /(브랜치|\bbranch\b|merged\s*branch|feature\s*branch)/i;
// A REMOTE cleanup phrase (CA change 1) — must route to composeRemoteBranchCleanupUnsupported (NEVER local delete).
const REMOTE_BRANCH_WORD = /(원격|remote|origin\b|github)/i;
// Bulk / wildcard / "everything" / main-as-target guards — none of these may delete anything.
const CLEANUP_BULK = /(다\s*(삭제|지워|정리)|전부|모두|\ball\b|every|\*|패턴|pattern|wildcard)/i;
const CLEANUP_MAIN_TARGET = /((^|\s)(main|메인)\s*(브랜치)?\s*(삭제|지워|delete|remove))/i;

// Checked FIRST at MAIN_SYNCED (CA change 1): a remote-branch cleanup phrase → 'remote' (→ unsupported reply, NO
// local delete). A cleanup verb + branch word + a remote qualifier (원격/remote/origin/github).
static interpretRemoteBranchCleanupIntent(text): 'remote' | null {
  const t = text.trim().toLowerCase();
  if (CLEANUP_VERB.test(t) && BRANCH_WORD.test(t) && REMOTE_BRANCH_WORD.test(t)) return 'remote';
  return null;
}
// Checked AFTER the remote guard: a LOCAL cleanup phrase → 'local'. Rejects bulk/wildcard/"main 삭제"; and a remote
// qualifier is excluded (already handled above) so a remote phrase can never fall through to local (CA change 1).
static interpretBranchCleanupIntent(text): 'local' | null {
  const t = text.trim().toLowerCase();
  if (CLEANUP_BULK.test(t) || CLEANUP_MAIN_TARGET.test(t)) return null; // bulk/wildcard/"main 삭제" → never
  if (REMOTE_BRANCH_WORD.test(t)) return null;                          // remote → not local (routed above)
  if (CLEANUP_VERB.test(t) && BRANCH_WORD.test(t)) return 'local';       // Sprint 3i: LOCAL only
  return null;                                                          // bare "정리해줘"/"배포해줘"/… → not cleanup
}
```

Covers CA MAY-trigger phrases — `로컬 브랜치 정리해줘`, `merged branch 정리해줘`, `feature branch 삭제해줘`,
`cleanup local branch`, `delete local merged branch` → `'local'`. Rejects CA MUST-NOT phrases — `정리해줘` (no branch
word), `다음 단계 진행해줘` (no), `배포해줘`/`릴리즈해줘` (no), `main 삭제해줘` (main-target guard), `브랜치 다 삭제해줘`
(bulk guard). **Remote-cleanup phrases** — `원격 브랜치 삭제해줘`, `remote branch delete`, `remote branch cleanup`,
`delete remote branch`, `origin 브랜치 삭제`, `GitHub branch delete` → `'remote'` → `composeRemoteBranchCleanupUnsupported`,
**never a local delete side effect** (CA change 1). The **target is always the anchored PR head branch** regardless
of phrase; a user-named branch is never deletable.

### 4.3 Required conservative preflight — 15 checks (Q4)

Split across the runtime (anchor/target evidence) and the Git Manager (live local repo state, then the single
delete). **Every** check that fails **before** the delete is *Blocked* ("branch was not deleted"). Order is fixed.

Runtime `handleBranchCleanupTurn` (before any mutating Git call) — any failure → `composeBranchCleanupBlocked`:

```text
1.  anchor.status === 'MAIN_SYNCED'
2.  anchor.syncedMainCommit present (SHA-shaped)
3.  anchor.mainSyncBranch === 'main' (PR_BASE_BRANCH_POLICY)
4.  original pushed/PR head branch present (anchor.pullRequestHeadBranch, cross-checked == anchor.pushedBranch)
5.  cleanup TARGET := anchor.pullRequestHeadBranch (never user-supplied); target === anchor.pushedBranch
6.  target !== 'main' (never delete main)
7.  target passes the safe branch-name guard (isSafePushBranch)
8.  anchor.workspaceRef.rootPath present
    (identity: anchor.repositoryIdentity present and matches the configured identity)
```

Git Manager `deleteMergedLocalBranch` (read local, then the single delete) — checks 8–12, all pre-delete → *Blocked*:

```text
8.  local repository exists (git.isRepository)
9.  working tree readable + not mid-operation (git.status succeeds; hasUnmergedPaths false)
9b. local 'main' ref exists AND its commit === anchor.syncedMainCommit (CA change 4) — else Blocked (main moved
    after MAIN_SYNCED; cleanup must be tied to the exact synchronized main evidence, not just the old anchor value)
10. current checkout is NOT the target branch (git.info.branch !== target) — else Blocked (cannot delete the checked-out branch)
11. target LOCAL branch exists (getLocalRefCommit(target) → targetCommit); ABSENT → idempotent success (§4.6), no delete
12. target is FULLY MERGED into local main — the Manager verifies `isAncestor(targetCommit, syncedMainCommit)`
    — else Blocked (never force-delete an unmerged branch)
13. (REMOTE, DEFERRED in 3i) remote branch existence — NOT checked (remote deletion out of scope)
14. (REMOTE, DEFERRED in 3i) remote branch points to expected pushed commit — NOT checked (remote deletion out of scope)
15. NO wildcard / pattern / bulk deletion — the target is a single, exact, anchored branch name (guaranteed by §4.2 + check 5)
```

Only when checks 1–12 pass (and the branch exists) is the single CAS delete (§4.4) performed, using the exact
`targetCommit` observed in check 11 as `expectedBranchCommit`.

### 4.4 Deletion strategy — deterministic CAS delete (Option A), no `git branch -d` reliance

**Option A (CA-preferred, change 3):** the mutating primitive is `git update-ref -d refs/heads/<target>
<expectedBranchCommit>` — a git-native compare-and-swap delete that removes the ref **only if it still points at
`expectedBranchCommit`**, and does **not** depend on the current `HEAD`/checkout (which, per Sprint 3h ref-only
mode, may be a non-main branch). Correctness comes from ChunsikBot's explicit preflight (target is an ancestor of
`syncedMainCommit`, check 12), not from `git branch -d`'s incidental HEAD/upstream rules.

```text
- Manager passes the exact observed target tip as expectedBranchCommit (CA change 2):
    getLocalRefCommit(target) → targetCommit ; verify isAncestor(targetCommit, syncedMainCommit) ;
    provider.deleteMergedLocalBranch(rootPath, target, targetCommit)
- Provider CAS-deletes: `git update-ref -d refs/heads/<target> <expectedBranchCommit>` (argv-only).
- NEVER `git branch -D`/`--force`, NEVER 'main' (check 6), NEVER the current checkout (check 10), NEVER a remote ref
  (no `push --delete`, no `-r`), NEVER a wildcard/pattern (single exact ref argv), NEVER a checkout switch to delete.
- Already-absent target → idempotent success (no delete call), BRANCH_CLEANED with cleanedLocalBranch=false.
```

### 4.5 Ownership + Git capability change (Q2)

**Local branch deletion → the Git capability. Remote branch deletion → DEFERRED** to a future, separately-gated
sprint. **Justification:** deleting a fully-merged LOCAL branch is safe and recoverable (its commits are already in
`main`), so it is gated by `MAIN_SYNCED` + an explicit command + a strict preflight. A REMOTE branch deletion is a
**remote mutation** (higher blast radius, not locally recoverable, affects collaborators) and belongs to its own
explicitly-approved sprint — 3i does not implement it (CA preference: "remote cleanup → separate explicit phrase or
separate approval gate; defer"). So local and remote deletion are **not** the same operation.

**Provider port (`GitProvider`) — one read + one mutating method, argv-only:**

```ts
// READ-ONLY (ADR-0059): is `ancestor` an ancestor of `descendant`? (`git merge-base --is-ancestor`). Used by the
// Manager for the "fully merged into main" check (check 12) + the local-main == syncedMainCommit chain. No mutation.
isAncestor(rootPath: string, ancestor: string, descendant: string): Promise<boolean>;

// The FOURTH mutating git operation (CAP-002, ADR-0059) — a CAS delete of a fully-merged LOCAL branch via
// `git update-ref -d refs/heads/<branch> <expectedBranchCommit>` (deterministic; no `git branch -d`/HEAD reliance,
// CA change 3). NEVER `-D`/`--force`, NEVER 'main', NEVER a remote ref, NEVER a wildcard/pattern, NEVER a checkout
// switch. Validates the branch name + SHA defensively first. PHASE-AWARE: a pre-ref-delete failure (branch moved/
// absent vs expectedBranchCommit) throws BranchCleanupBlockedError; a failure AT/AFTER the ref-delete attempt throws
// BranchCleanupUnverifiedError. Takes no ApprovalRef (mirrors commitFiles/pushApprovedCommit/syncMainFastForward).
deleteMergedLocalBranch(rootPath: string, branch: string, expectedBranchCommit: string): Promise<GitBranchCleanupResult>;
```

**Manager (`GitManager.deleteMergedLocalBranch`) — preflight + single CAS delete; NO ApprovalRef (§5 Q6):**

```ts
async deleteMergedLocalBranch(input: { rootPath: string; branch: string; expectedMainCommit: string }): Promise<GitBranchCleanupResult>
// 1. defensive validation (non-empty rootPath, safe branch via isSafePushBranch, branch !== 'main', SHA-shaped
//    expectedMainCommit) → all → BranchCleanupBlockedError.
// 2. isRepository + status (mid-op) + info (current branch != target) → BranchCleanupBlockedError.
// 3. getLocalRefCommit('main') → null → Blocked; commit !== expectedMainCommit → Blocked (main moved, CA change 4).
// 4. getLocalRefCommit(target) → null → idempotent { deleted:false, alreadyAbsent:true }; else record targetCommit.
// 5. isAncestor(targetCommit, expectedMainCommit) false → BranchCleanupBlockedError (not merged; never force).
// 6. SINGLE deleteMergedLocalBranch(provider, target, targetCommit) — phase-aware: provider BranchCleanupBlockedError
//    → Blocked (moved before); BranchCleanupUnverifiedError → Unverified; any OTHER throw → Unverified. (No blanket
//    convert.) Result-integrity (result.branch === target, result.deleted true) mismatch → Unverified.
```

**New domain type + errors:**

```ts
export interface GitBranchCleanupResult {
  branch: string;          // the deleted (or already-absent) local branch
  deleted: boolean;        // true when this run deleted a local ref; false when it was already absent
  alreadyAbsent: boolean;  // true when the local branch did not exist
  deletedCommitHash?: string; // the commit the deleted branch pointed at (for the response/audit), when deleted
}
export class BranchCleanupBlockedError extends Error {}     // definitively NOT deleted (pre-delete)
export class BranchCleanupUnverifiedError extends Error {}  // delete attempted; outcome unknown — never "not deleted"
```

Runtime `deps.git` gains `deleteMergedLocalBranch` (type-only widening; the runtime calls it ONLY, never a shell).
No new approval collaborator. **No remote-delete method is added in 3i.**

### 4.6 Failure semantics (Q5) — extends the ADR-0054 rule to local branch deletion

```text
KNOWN pre-delete block → BranchCleanupBlockedError → composeBranchCleanupBlocked
    (any of checks 1–12 fails, incl. target==main, unsafe name, not merged, checked out, mid-op, identity mismatch).
    Safe to say: "브랜치를 삭제하지 않았어요." Anchor stays MAIN_SYNCED.

UNKNOWN / generic failure AT/AFTER the delete attempt → BranchCleanupUnverifiedError → composeBranchCleanupUnverified
    (`git update-ref -d` threw ambiguously, or the read-back could not confirm the ref is gone). The ref MAY be gone.
    MUST NOT claim "not deleted" and MUST NOT claim "deleted" — say "삭제 결과를 확인하지 못했어요, git branch로 확인해
    주세요." Anchor stays MAIN_SYNCED.

ALREADY ABSENT (target local branch does not exist) → composeBranchCleanupSucceeded (alreadyAbsent) + anchor
    BRANCH_CLEANED (idempotent, cleanedLocalBranch=false); no delete call. (Q4 test 10 — chosen policy: idempotent.)

NOT CONFIGURED / NOT A REPO → composeBranchCleanupUnavailable; no state change.
```

### 4.7 Response composers + wording (Q7)

New `ResponseComposer` methods (deterministic, bounded). **Distinguish local vs remote (Q7):**

```text
composeBranchCleanupSucceeded(context, { cleanedBranch, cleanedLocalBranch, alreadyAbsent })
  — deleted:   "로컬 브랜치 '<name>'을 삭제했어요 (이미 main에 병합된 브랜치예요)."
  — alreadyAbsent (CA change 5): "로컬 브랜치 '<name>'은 이미 없어요. 이번엔 삭제한 브랜치가 없어요. 원격 브랜치는 삭제하지
        않았어요. main은 변경하지 않았어요."
  — both append (deleted case): "원격 브랜치와 main은 건드리지 않았어요. 배포/릴리즈/태그도 하지 않았어요."
composeBranchCleanupBlocked      — "브랜치를 삭제하지 않았어요" + the safe reason (main / unsafe name / not merged /
                                    checked out / context incomplete). NEVER claims deleted.
composeBranchCleanupUnverified   — "브랜치 삭제 결과를 확인하지 못했어요, git branch로 확인해 주세요." NEVER "not deleted"/"deleted".
composeBranchCleanupUnavailable  — "브랜치를 정리할 수 없어요 (저장소/설정 확인)." (not a repo / not configured); no state change.
composeRemoteBranchCleanupUnsupported — a remote-cleanup phrase at MAIN_SYNCED → "원격 브랜치 삭제는 아직 지원하지 않아요
                                    (이후 별도 승인 단계). 로컬 브랜치만 정리할 수 있어요." No mutation.
```

**Required wording invariants (Q7):** distinguish **local branch deleted** / **remote branch deleted** (N/A in 3i —
never claimed) / **nothing deleted** / **deletion unverified**. Every path states main + remote were not touched.
Never imply deployed / released / production-ready / tagged / all-branches-cleaned / repository-fully-cleaned.

### 4.8 Runtime routing (`MAIN_SYNCED` and `BRANCH_CLEANED`)

At `MAIN_SYNCED` (extends the 3h block), a REMOTE-cleanup phrase is checked FIRST (CA change 1) so it can never fall
through to a local delete:

```text
1. interpretRemoteBranchCleanupIntent === 'remote' → handleRemoteBranchCleanupUnsupportedTurn (NO mutation)
2. interpretBranchCleanupIntent === 'local'        → handleBranchCleanupTurn (NEW — preflight → CAS local delete)
3. interpretMainSyncIntent === 'sync'              → handleMainAlreadySyncedTurn (3h; already synced)
4. interpretPrStatusIntent / interpretMergeStatusIntent → handlePrStatusPreviewTurn (read-only; keeps MAIN_SYNCED)
5. merge phrase                                    → composeMergeExecutionAlreadyMerged (no mutation)
6. DEPLOY_ONLY_WORDS / companion                   → composeMergeExecutionUnsupportedCompanion
```

New `BRANCH_CLEANED` block (terminal):

```text
1. interpretRemoteBranchCleanupIntent === 'remote' → handleRemoteBranchCleanupUnsupportedTurn (NO mutation)
2. interpretBranchCleanupIntent === 'local'        → handleBranchAlreadyCleanedTurn (already cleaned; no mutation)
3. interpretMainSyncIntent === 'sync'              → handleMainAlreadySyncedTurn (still synced)
4. interpretPrStatusIntent / interpretMergeStatusIntent → handlePrStatusPreviewTurn (read-only; keeps BRANCH_CLEANED)
5. merge phrase                                    → composeMergeExecutionAlreadyMerged
6. DEPLOY_ONLY_WORDS / companion                   → composeMergeExecutionUnsupportedCompanion
```

Every non-`MAIN_SYNCED`/`BRANCH_CLEANED` state is unchanged — a cleanup phrase there never deletes (test 2). The
read-only status preview guard widens to also accept `BRANCH_CLEANED` (read-only, keeps the state).

---

## 5. Required Architecture Questions — decisions

- **Q1 (state)** — Add `BRANCH_CLEANED` only (terminal). Means "the completed feature branch's LOCAL ref was deleted
  (or already absent) this run"; not deploy/release/tag/production-ready/all-cleaned/remote-deleted. Fields:
  `branchCleanupMode` ('local' in 3i), `cleanedBranch`, `branchCleanedAt`, `branchCleanedBy`, `cleanedLocalBranch`,
  `cleanedRemoteBranch` (false in 3i) (§4.1).
- **Q2 (ownership)** — **Local branch deletion → Git capability** (`git update-ref -d refs/heads/<t> <expected>`
  CAS delete, deterministic — no `git branch -d`/HEAD reliance, CA change 3). **Remote branch deletion → DEFERRED**
  to a future, separately-approved sprint (not implemented in 3i). Justified: local merged-branch
  deletion is safe/recoverable; remote deletion is a higher-risk remote mutation needing its own gate (§4.5).
- **Q3 (trigger)** — `interpretBranchCleanupIntent` (cleanup verb + branch word; rejects bulk/wildcard/`main`-target;
  bare phrases never match), only at `MAIN_SYNCED`/`BRANCH_CLEANED`; target is always the anchored PR head branch
  (§4.2).
- **Q4 (preflight)** — 15 checks (§4.3); remote checks 13/14 are DEFERRED (remote out of scope). **Local branch
  missing → idempotent success** (BRANCH_CLEANED, cleanedLocalBranch=false) — the desired end state is reached and
  nagging is avoided; consistent with the 3g/3h idempotent (already-merged / already-up-to-date) pattern.
- **Q5 (failure)** — Phase-aware (§4.6): pre-delete → Blocked ("not deleted"); at/after the delete → Unverified
  (never "not deleted"). New typed errors; the Manager does not blanket-convert provider throws.
- **Q6 (approval)** — **Local cleanup: no new CRITICAL approval** (`MAIN_SYNCED` + explicit local cleanup command +
  strict preflight + safe `-d`). **Remote cleanup: deferred** — a future sprint must add an explicit approval gate
  (or an explicit separate phrase) before any remote deletion (§4.5).
- **Q7 (wording)** — Distinguish local-deleted / remote-deleted (never claimed in 3i) / nothing-deleted / unverified;
  every path says main + remote untouched; never imply deploy/release/tag/all-cleaned (§4.7).
- **Q8 (out of scope)** — §6.

---

## 6. Out of scope — explicitly forbidden

Sprint 3i's implementation must **not** add or perform any of:

```text
deploy · release · tag creation · delete 'main' · delete arbitrary branches · bulk branch deletion ·
wildcard/pattern deletion · force-delete an unmerged branch (`git branch -D` / `--force`) · reset --hard ·
force push · remote branch deletion (DEFERRED — requires an explicitly-designed, gated future sprint) ·
PR mutation · reviewer/label/assignee mutation · workflow dispatch · check rerun ·
CommandExecution/shell fallback · ExecutionOrchestrator changes · WorkspaceWrite/Patch/CodeGeneration changes ·
RepositoryHosting changes
```

`RepositoryHosting` gains no method. No new approval risk for local cleanup. Git stays argv-only, adapter-side.

---

## 7. Required tests in the implementation (28)

Runtime tests (`conversation-runtime.test.ts`) + Git Manager tests (`git-manager.test.ts` with a fake provider) +
Git adapter tests (`git-local` with a temp repo). Numbered to CA's list:

```text
1.  MAIN_SYNCED + explicit local cleanup command → cleanup preflight runs (git.deleteMergedLocalBranch called).
2.  non-MAIN_SYNCED (PR_CREATED / MERGE_APPROVED / PR_MERGED / null) + cleanup command → no cleanup (no delete call).
3.  missing syncedMainCommit → Blocked, no delete.
4.  missing original head branch (pullRequestHeadBranch) → Blocked, no delete.
5.  target branch is 'main' (anchored head == main) → Blocked, no delete.
6.  target branch differs from anchored PR head (pullRequestHeadBranch != pushedBranch) → Blocked, no delete.
7.  unsafe branch name (fails isSafePushBranch) → Blocked, no delete.
8.  target branch currently checked out (git.info.branch === target) → Blocked, no delete.
9.  target branch not merged into local main → Blocked, no delete (never force-delete).
10. local branch missing → idempotent BRANCH_CLEANED (cleanedLocalBranch=false), no delete call (chosen: idempotent).
11. successful local branch delete → BRANCH_CLEANED (cleanedLocalBranch=true, cleanedRemoteBranch=false, mode 'local').
12. local deletion throw BEFORE attempt (BranchCleanupBlockedError) → Blocked, "not deleted".
13. local deletion throw AFTER attempt (BranchCleanupUnverifiedError / unknown) → Unverified, never "not deleted".
14. no deploy/release/tag on any path.
15. no bulk/wildcard deletion on any path (adapter uses one exact branch argv; classifier rejects bulk/wildcard).
16. no shell/CommandExecution fallback (runtime never shells; provider argv-only, `-d` never `-D`/push).
17. remote branch cleanup is NOT performed in 3i — a remote-cleanup phrase → composeRemoteBranchCleanupUnsupported
    (no delete, no push --delete); cleanedRemoteBranch is always false.
18. response distinguishes local vs remote cleanup (states local deleted + remote/main untouched).
# CA change 6 — additional required tests (19–28)
19. MAIN_SYNCED + "원격 브랜치 삭제해줘" → remote cleanup unsupported, NO local delete (deleteMergedLocalBranch not called).
20. MAIN_SYNCED + "delete remote branch" → remote cleanup unsupported, NO local delete.
21. MAIN_SYNCED + local cleanup phrase uses the anchored pullRequestHeadBranch ONLY (a user-named branch in the
    phrase is ignored; the deleted target == anchored head).
22. target branch tip moves after manager preflight but before provider delete → Blocked (CAS precheck) / Unverified
    (during/after); never anchors BRANCH_CLEANED as deleted.
23. provider deleteMergedLocalBranch receives expectedBranchCommit; the method signature does not accept arbitrary
    user branch input (target + expected commit come from the anchor + preflight only).
24. local main commit != anchor.syncedMainCommit → Blocked, no delete (CA change 4).
25. ref-only / non-main checkout does NOT switch the checkout for cleanup (current branch unchanged after delete).
26. cleanup does NOT rely on `git branch -d` requiring HEAD == main — uses `git update-ref -d <ref> <expected>`.
27. already-absent response says no local branch was deleted this run AND remote branch was not deleted AND main
    was not changed (CA change 5).
28. BRANCH_CLEANED preserves the MAIN_SYNCED chain + merge/sync evidence (identity/ref/mergedHeadSha/mergeCommitHash/
    syncedMainCommit/mainSyncBranch).
```

Additional guard tests (enduring invariants): the Git adapter's cleanup primitive uses argv-array spawn (never a
shell string) and never emits `-D`/`--force`/`push`/`--delete`/`-r`/a wildcard; `GitManager.deleteMergedLocalBranch`
does NOT blanket-convert provider throws; exactly ONE delete call and only after the full preflight passes;
`BRANCH_CLEANED` never unlocks deploy/release and never claims remote deletion.

---

## 8. Validation & stop condition

- **Future implementation validation:** Node 22 · `pnpm typecheck` (exit 0) · `pnpm test` (full suite green).
- **This sprint (plan-only) stops here** — the plan document is the only deliverable. No implementation, no branch,
  no commit, no PR, per CA's Stop Condition.
