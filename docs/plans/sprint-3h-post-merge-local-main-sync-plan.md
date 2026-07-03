# Sprint 3h Plan — Post-Merge Local Main Synchronization (fast-forward-only; NO force/reset, NO branch deletion, NO deploy)

- **Status:** APPROVED WITH CHANGES (all 6 CA plan-review changes applied) → implementing on branch
  `v2/post-merge-main-sync`; PR to open for CA Implementation Review. Do not merge.
- **Base:** `main @ 520702836e051f9cce29a604674a9a164416ce84`
- **Validation runtime (for the FUTURE implementation):** Node 22 · `pnpm typecheck` · `pnpm test`
- **ADR (proposed):** ADR-0058 — Post-Merge Local Main Synchronization (added to `DECISIONS.md` at implementation
  time, not now).
- **Nature:** the safe path from a live `PR_MERGED` anchor to a **local workspace repository** whose `main` ref is
  synchronized to the merged remote `main` commit — **fast-forward only**, via the **Git capability** (CAP-002),
  never a shell. Closes the "remote main advanced but the local workspace is on an old head" gap CA flagged at 92%.
  **No force/reset, no branch deletion, no deploy/release, no `CommandExecution`/shell.**
- **Predecessors (reused, not re-litigated):**
  - **ADR-0057** (Sprint 3g) — the `PR_MERGED` anchor + `mergedHeadSha`/`mergeCommitHash`/`pullRequestBaseBranch`/
    `repositoryIdentity` this consumes as the sole trigger source and sync evidence.
  - **ADR-0054/0048/0046** — the remote-mutation Blocked-vs-Unverified safety rule (extended to local sync) and
    the Git mutation discipline (single bounded argv operation, adapter-side, no shell, provider result is not an
    independent verification).
  - **ADR-0023/0047** — Git = local **repository** capability (`GitProvider`/`GitManager`, `rootPath`-composed,
    no remote URLs); `GitStatus.ahead/behind/upstream` already parsed read-only (no network fetch).

---

## 0. CA required plan questions → where answered

| CA plan question | Answered in |
|---|---|
| Q1 New product state (`MAIN_SYNCED`?) | §4.1, §5 Q1 |
| Q2 Sync ownership (Git capability vs new orchestration) | §4.5, §5 Q2 |
| Q3 Required conservative local sync preflight (14 checks) | §4.3 |
| Q4 Sync strategy (fast-forward-only) | §4.4, §5 Q4 |
| Q5 Failure semantics (Blocked vs Unverified) | §4.6 |
| Q6 Branch deletion forbidden | §6 |
| Q7 Deploy/release boundary | §2, §6, §5 Q7 |
| Q8 Response wording | §4.7 |
| Required tests (18) | §7 |
| Allowed / Forbidden scope | §4.5/§4.4 / §6 |

---

## 0.1 CA plan-review disposition (APPROVED WITH CHANGES → all 6 applied)

| CA required change | Disposition | Where |
|---|---|---|
| 1. Split **checked-out-main** vs **ref-only** sync (current==main → ff checked-out main incl. working tree/index; current!=main → ff `refs/heads/main` only, no checkout switch; detached HEAD → Blocked). Result carries `syncMode`/`workingTreeUpdated`/`previousMainCommit`/`syncedCommitHash` | Applied | §4.1, §4.4, §4.5, §7 (19–21/26/27) |
| 2. **Phase-aware** provider errors — pre-ref-update failure → Blocked; at/after ref-update → Unverified; Manager must not blanket-convert every `syncMainFastForward` throw to Unverified (Option A: typed phase-aware provider errors) | Applied | §4.5, §4.6, §7 (22–24) |
| 3. **CAS / expected-previous-commit** — observe `localMainCommit` before sync; fast-forward `refs/heads/main` from `previousMainCommit` to `expectedRemoteCommit` only if it is still `previousMainCommit`; moved-before → Blocked, moved-during/after → Unverified | Applied | §4.3 (check 11b), §4.4, §4.5 |
| 4. **Expected remote main tip = `mergeCommitHash`; absent → Block, NO `mergedHeadSha` fallback** in 3h (explicit wording) | Applied | §4.3 (check 5), §5 Q5 |
| 5. Response wording precision — never "workspace synced"/"working tree is now main"; distinguish ref-only ("local main ref synchronized, current checkout unchanged, working tree remained clean") vs checked-out-main ("checked-out main fast-forwarded, working tree updated, clean after sync") | Applied | §4.7 |
| 6. Add tests 19–27 (mode split + phase-aware failure) | Applied | §7 |

## 1. Goal

From a live `PR_MERGED` anchor, an explicit sync command synchronizes the **local** repository's `main` ref to the
merged remote `main` commit — fast-forward only, after a conservative local + remote preflight:

```text
PR_MERGED
→ explicit sync command ("main 동기화해줘" / "로컬 main 최신화해줘" / "머지된 main 받아와줘" / "sync main" / "update local main")
→ verify PR_MERGED context (repositoryIdentity + base==main + mergedHeadSha + mergeCommitHash)   ← anchor evidence
→ verify LOCAL repo safe (is-repo, clean tree: no staged/unstaged/untracked, not mid-operation)
→ observe REMOTE main commit (read-only) and confirm it equals the expected merge result           ← read before mutation
→ if fast-forward is possible: GitManager.syncMain(...) → single Git fast-forward of local main      ← FF-only, no force
→ anchor MAIN_SYNCED (+ syncedMainCommit, mainSyncedAt; full PR_MERGED chain preserved)
→ respond: which local ref reached which commit, tree stayed clean, and what was NOT done (deploy/release/branch delete)

Known pre-sync failure (any preflight/observe/FF-impossible)  → "로컬 main을 동기화하지 않았어요" (definitely not synced)
Unknown failure AFTER the local mutation attempt              → "동기화 결과를 확인하지 못했어요, git status/log를 확인해 주세요" (never "not synced")
Local main already at the expected commit                     → MAIN_SYNCED (idempotent) + "이미 최신이에요"
Git/sync capability not configured / not a repository         → "동기화할 수 없어요 (설정/저장소 확인)"
```

---

## 2. Boundary & the most important rule

> **A local main sync is a fast-forward of the LOCAL `main` ref — and nothing else.** Sprint 3h performs **no**
> force/`--force`/hard reset (no reset by default), **no** branch deletion (local/remote/GitHub), **no** deploy/
> release/tag, **no** remote push, **no** PR mutation, **no** working-tree content edits beyond the fast-forward,
> **no** `CommandExecution`/shell fallback, **no** `ExecutionOrchestrator`/`WorkspaceWrite`/`Patch`/`CodeGeneration`
> change. It runs entirely through the **Git capability** (`GitProvider`/`GitManager`), adapter-side, argv-only.
> **`MAIN_SYNCED` does NOT unlock deploy/release** and does not mean deployed / released / production-ready /
> branch-deleted / remote-branch-cleaned / CI-permanently-verified. If a fast-forward is not possible, **block —
> never force.** Unknown failure after the local mutation attempt is **unverified**, never "not synced" (the
> ADR-0054 remote-mutation safety rule, applied to local Git).

---

## 3. Architecture & reuse (source-verified)

- **Trigger anchored to `PR_MERGED` only** (`conversation-runtime.ts`; the 3g `PR_MERGED` routing block). A new
  `interpretMainSyncIntent` is consulted **only** there, before the 3g already-merged / companion routing. Every
  other state is unchanged, so a sync phrase elsewhere never syncs.
- **Reads/preserves the `PR_MERGED` causal chain** — `repositoryIdentity`, `pullRequestBaseBranch`, `mergedHeadSha`,
  `mergeCommitHash`, and the full push/commit/workspace context (incl. `workspaceRef.rootPath`, the sole repo path).
- **Git access mirrors 3a push execution** — the runtime reaches Git only through `this.deps.git.*` (a
  `GitManager`), never shelling out; `rootPath = anchor.workspaceRef.rootPath`; base branch policy `main`
  (`PR_BASE_BRANCH_POLICY`). Uses the existing read-only `git.status`/`git.info`.
- **New Git capability methods mirror `commitFiles`/`pushApprovedCommit`** — one read-only remote-ref observation +
  one single **fast-forward-only** local mutation, both adapter-side, argv-only (never a shell string), timeouts,
  masked stderr, no remote URLs, defensive ref validation before any git call. The provider result is **not** an
  independent verification (mirrors `GitPushResult`).
- **Failure taxonomy reuses the ADR-0054 rule** — a KNOWN pre-mutation failure is *Blocked* ("not synced"); any
  failure at/after the single mutating call is *Unverified* ("could not confirm — check `git status`").
- **`now()`** (already imported) supplies `mainSyncedAt` (the runtime record timestamp).
- **No RepositoryHosting change, no push, no PR mutation.** Sync reads the remote ref (network read) and
  fast-forwards a local ref; it never writes to the remote.

---

## 4. Design

### 4.1 New product state + anchor fields (Q1)

`ApplyPreviewAnchorStatus` gains, after `PR_MERGED`: **`MAIN_SYNCED`** (terminal). No `DEPLOY_*`/`RELEASED`/
`BRANCH_DELETED`.

```text
MAIN_SYNCED — the LOCAL workspace repository's `main` ref was synchronized (fast-forward) to the expected
              post-merge remote `main` commit DURING THIS RUN. Terminal for this chain.
```

`MAIN_SYNCED` does **NOT** mean: deployed · released · production-ready · branch deleted · remote branch cleaned up ·
CI permanently verified.

New `ApplyPreviewAnchor` fields (optional on the type; **required on `MAIN_SYNCED`** as noted):

```text
syncedMainCommit?: string   // required on MAIN_SYNCED; the local main commit reached after fast-forward (== expected remote main tip)
mainSyncedAt?: IsoTimestamp // required on MAIN_SYNCED; RUNTIME record timestamp (now()) — when ChunsikBot recorded the sync this run
mainSyncBranch?: string     // required on MAIN_SYNCED; the local ref synchronized (always 'main' per PR_BASE_BRANCH_POLICY)
syncMode?: 'checked-out-main' | 'ref-only'  // required on MAIN_SYNCED (CA change 1); which strategy was used
workingTreeUpdated?: boolean               // required on MAIN_SYNCED (CA change 1); true only in checked-out-main mode (ff moved the working tree)
previousMainCommit?: string                // required on MAIN_SYNCED (CA change 3); local main commit BEFORE the fast-forward (CAS base / audit)
```

`MAIN_SYNCED` **preserves the full `PR_MERGED` chain** (`...anchor`): identity/pullRequestRef/number/url/head/base/
commit + `mergedHeadSha`/`mergeCommitHash`/`mergedAt`/`mergeExecutedBy` + the 3f approval evidence. It never clears
the merge evidence.

### 4.2 Runtime trigger classifier

A new deterministic classifier, consulted **only** at `PR_MERGED` (and, for the already-synced reply, at
`MAIN_SYNCED`):

```ts
const SYNC_WORD = /(동기화|최신화|받아와|받아 ?줘|\bsync\b|\bpull\b|update\s+(local\s+)?main)/i;
const MAIN_WORD = /(\bmain\b|메인|로컬\s*main|origin\/main)/i;
// A sync command needs a sync verb AND a main target (so a bare "sync"/"pull" or a bare "main" does not trigger).
static interpretMainSyncIntent(text): 'sync' | null {
  const t = text.trim().toLowerCase();
  if (SYNC_WORD.test(t) && (MAIN_WORD.test(t) || /update\s+(local\s+)?main/.test(t))) return 'sync';
  return null;
}
```

Covers CA phrases — `main 동기화해줘`, `로컬 main 최신화해줘`, `머지된 main 받아와줘`, `sync main`, `update local main`.
**The exact trigger policy is offered for CA review (§5 Q3-trigger).** A merge phrase, a status/check phrase, and a
deploy/release phrase do **not** trigger sync. A sync phrase at any state other than `PR_MERGED`/`MAIN_SYNCED` does
not sync (§4.8).

### 4.3 Required conservative local sync preflight — all 14 checks (Q3)

Split across the runtime (anchor/identity evidence, checks 1–5, 10–11) and the Git Manager (live local + remote
state, checks 6–9, 12–14). **Every** check that fails **before** the single fast-forward mutation is *Blocked*
("local main was not synchronized"). Order is fixed; no check is skipped.

Runtime `handleMainSyncTurn` (before any mutating Git call) — any failure → `composeMainSyncBlocked`:

```text
1.  anchor.status === 'PR_MERGED'
2.  anchor.repositoryIdentity present AND matches the configured deps.repositoryHosting.identity
3.  anchor.pullRequestBaseBranch === 'main' (PR_BASE_BRANCH_POLICY)
4.  anchor.mergedHeadSha present (SHA-shaped)
5.  anchor.mergeCommitHash present (SHA-shaped) — the EXPECTED remote main tip. ABSENT → Block, with **NO fallback
    to mergedHeadSha** (CA change 4): "ChunsikBot cannot prove which remote main commit should be synchronized,
    therefore local main sync is blocked." (A future sprint may add a bounded ancestry policy; 3h requires exact
    mergeCommitHash.)
10. anchor.workspaceRef.rootPath present AND git.isRepository(rootPath) is true (workspace identity still a repo)
```

Git Manager `syncMain` (read local + remote, then the single mutation) — checks 6–9, 11, 11b, 12–14, all pre-mutation → *Blocked*:

```text
6.  local working tree clean (git.status.clean)
7.  no untracked files (git.status.untracked is empty) — nothing would be overwritten by the fast-forward
8.  no staged changes (git.status.staged is empty)
9.  no unstaged/uncommitted changes (git.status.unstaged is empty); not mid-merge (hasUnmergedPaths false)
9b. NOT detached HEAD (git.info.detached false) → detached → Blocked (CA change 1)
11. local 'main' exists (getLocalRefCommit('main') non-null) — absent → Blocked (NO auto-create in the first sync sprint, §5 Q6)
11b. OBSERVE localMainCommit BEFORE sync (= getLocalRefCommit('main')) — recorded as the CAS base `previousMainCommit` (CA change 3)
12. remote 'main' commit OBSERVED before any mutation (read-only getRemoteRefCommit succeeds)
13. observed remote 'main' commit === anchor.mergeCommitHash (the expected merge result from PR_MERGED)
14. sync is deterministic + bounded — one remote-ref read + one fetch + one fast-forward; NO loops/retries/pagination
```

Only when all checks pass is the single fast-forward performed. If the local `main` (`previousMainCommit`) is **not**
an ancestor of the expected remote commit (fast-forward impossible), **Block — never force/reset** (§4.4).

### 4.4 Sync strategy (Q4, CA change 1/3) — fast-forward only, MODE-SPLIT, CAS-guarded

**Fast-forward only; no hard reset, no force.** The mutation MODE depends on the current checkout (CA change 1),
and the local `main` ref update is a compare-and-swap against the observed `previousMainCommit` (CA change 3):

```text
current branch == 'main'   → CHECKED-OUT-MAIN mode: fast-forward the checked-out main WITH the working tree/index
                             (ff-only merge style: `git merge --ff-only <expectedRemoteCommit>`). workingTreeUpdated=true.
current branch != 'main'   → REF-ONLY mode: fast-forward ONLY refs/heads/main; NO checkout switch, NO working-tree
                             update (`git update-ref refs/heads/main <expectedRemoteCommit> <previousMainCommit>` — a
                             git-native CAS). workingTreeUpdated=false. The current branch/working tree are untouched.
detached HEAD              → Blocked (never sync a detached HEAD).
```

Single mutating primitive `syncMainFastForward(rootPath, remote, 'main', expectedRemoteCommit, previousMainCommit)`,
PHASE-AWARE (CA change 2/3):

```text
PRE-REF-UPDATE (all failures → GitMainSyncBlockedError, "not synced"):
  1. bounded fetch of the remote 'main' (updates the remote-tracking ref / FETCH_HEAD; NO working-tree change),
  2. verify the fetched tip === expectedRemoteCommit (else Blocked, stale),
  3. verify previousMainCommit is an ANCESTOR of expectedRemoteCommit (fast-forward possible; else Blocked, non-ff),
  4. CAS precheck: current refs/heads/main === previousMainCommit (else Blocked — local main moved before update).
REF-UPDATE + AFTER (all failures → GitMainSyncUnverifiedError, never "not synced"):
  5. checked-out-main → `git merge --ff-only <expectedRemoteCommit>`; ref-only → `git update-ref refs/heads/main
     <expectedRemoteCommit> <previousMainCommit>` (CAS; git rejects if main moved → the update is atomic),
  6. read back the local main commit; verify === expectedRemoteCommit (else Unverified).
- NEVER `--force`/`-f`, NEVER `reset --hard`, NEVER a force/lease push, NEVER a checkout switch (ref-only), NEVER
  delete a branch. If previousMainCommit === expectedRemoteCommit → alreadyUpToDate (no ref move; workingTreeUpdated=false).
```

Rejected for this sprint: Option B (hard reset local main to origin/main — destructive; forbidden §6), deferred to a
possible future sprint. The mode split makes Option A safe both when main is and is not the current checkout: it
never force-switches the checkout and never touches an unrelated working tree.

### 4.5 Sync ownership + Git capability change (Q2)

**The Git capability owns local repository synchronization primitives; the Conversation Runtime only composes; no
shell/`CommandExecution` fallback.** Two new methods, shapes mirroring `pushApprovedCommit`:

**Provider port (`GitProvider`) — one read + one mutating method, argv-only, adapter-side:**

```ts
// READ-ONLY: observe the remote branch tip WITHOUT updating any local ref or the working tree (git ls-remote style).
// Bounded single call, timeout, masked stderr, no remote URL exposed. Throws on failure (→ Blocked upstream).
getRemoteRefCommit(rootPath: string, remote: string, branch: string): Promise<{ commitHash: string }>;

// READ-ONLY: the local branch tip (git rev-parse refs/heads/<branch>), or null when the branch does not exist.
// Used for preflight check 11 (local main exists) + 11b (the CAS base `previousMainCommit`). No mutation.
getLocalRefCommit(rootPath: string, branch: string): Promise<{ commitHash: string } | null>;

// The mutating method — fetch the remote branch + FAST-FORWARD the local `branch` to `expectedRemoteCommit` ONLY,
// mode-split by the current checkout, CAS-guarded against `expectedPreviousCommit` (CA changes 1/2/3). Single
// bounded operation; NEVER --force/-f, NEVER reset --hard, NEVER a checkout switch (ref-only), NEVER a push, NEVER
// branch deletion. PHASE-AWARE errors: throws GitMainSyncBlockedError for PRE-ref-update failures (fetch/tip
// mismatch/non-ff/CAS-precheck/detached), GitMainSyncUnverifiedError for failures AT/AFTER the ref-update attempt.
// Approval gating (if any) is done by GitManager; this port takes no ApprovalRef (mirrors commitFiles/pushApprovedCommit).
syncMainFastForward(rootPath: string, remote: string, branch: string, expectedRemoteCommit: string, expectedPreviousCommit: string): Promise<GitMainSyncResult>;
```

**Manager (`GitManager.syncMain`) — orchestrates the preflight + the single mutation; NO ApprovalRef (§5 Q8):**

```ts
async syncMain(input: { rootPath: string; remote: string; branch: string; expectedRemoteCommit: string }): Promise<GitMainSyncResult>
// 1. defensive validation (non-empty rootPath, safe remote/branch via isSafePushRemote/isSafePushBranch,
//    SHA-shaped expectedRemoteCommit) → all → GitMainSyncBlockedError (no read, no mutation).
// 2. isRepository + read local status (checks 6–9) + info (9b detached) → any dirty/untracked/staged/unmerged/
//    detached → GitMainSyncBlockedError.
// 3. getLocalRefCommit('main') (checks 11/11b) → null → Blocked; else record previousMainCommit (the CAS base).
// 4. getRemoteRefCommit (check 12) → throws → GitMainSyncBlockedError; tip != expectedRemoteCommit (check 13) → Blocked.
// 5. SINGLE syncMainFastForward(…, previousMainCommit) call — PHASE-AWARE (CA change 2): a GitMainSyncBlockedError
//    from the provider (pre-ref-update) propagates as Blocked; a GitMainSyncUnverifiedError propagates as Unverified;
//    any OTHER/unknown throw → Unverified (conservative — it happened at/around the mutation). The Manager does NOT
//    blanket-convert every throw to Unverified. Result-integrity (syncedCommitHash === expectedRemoteCommit) → Unverified.
```

**New domain type + errors:**

```ts
export interface GitMainSyncResult {
  branch: string;                              // 'main'
  syncMode: 'checked-out-main' | 'ref-only';   // CA change 1 — which strategy ran
  workingTreeUpdated: boolean;                 // CA change 1 — true only in checked-out-main mode (ff moved the tree)
  syncedCommitHash: string;                    // the local main commit after fast-forward (== expectedRemoteCommit)
  previousMainCommit: string;                  // CA change 3 — local main before the fast-forward (CAS base / audit)
  alreadyUpToDate: boolean;                    // true when local main already equalled the expected commit (no ref move)
}
export class GitMainSyncBlockedError extends Error {}     // definitively NOT synced (pre-ref-update)
export class GitMainSyncUnverifiedError extends Error {}  // ref-update attempted; outcome unknown — never "not synced"
```

Runtime `deps.git` gains `syncMain` (type-only widening; the runtime calls `syncMain` ONLY, never the provider's
`getRemoteRefCommit`/`getLocalRefCommit`/`syncMainFastForward`). No new approval collaborator.

### 4.6 Failure semantics (Q5) — extends the ADR-0054 rule to local Git

```text
KNOWN pre-sync block → GitMainSyncBlockedError → composeMainSyncBlocked
    (any of checks 1–14 fails, incl. dirty/untracked/staged tree, remote read failure, remote tip mismatch,
     non-fast-forward, missing local main). Safe to say: "로컬 main을 동기화하지 않았어요." Anchor stays PR_MERGED.

UNKNOWN / generic failure AFTER the mutating call → GitMainSyncUnverifiedError → composeMainSyncUnverified
    (syncMainFastForward threw mid-operation, OR the result failed integrity). The local ref MAY have moved.
    MUST NOT claim "not synced" and MUST NOT claim "synced" — say "동기화 결과를 확인하지 못했어요, git status/log를
    확인해 주세요." Anchor stays PR_MERGED (we do not assert a sync we could not verify).

ALREADY UP TO DATE (local main already == expected remote tip) → composeMainSyncSucceeded (alreadyUpToDate note) +
    anchor MAIN_SYNCED (idempotent); the fast-forward is a no-op ref move.

NOT CONFIGURED / NOT A REPO (no identity / rootPath not a git repo) → composeMainSyncUnavailable; no state change.
```

### 4.7 Response composers + wording (Q8)

New `ResponseComposer` methods (deterministic, bounded). **Mode-aware wording (CA change 5)** — never say
"workspace synced" or "working tree is now main":

```text
composeMainSyncSucceeded(context, { syncMode, syncedCommitHash, previousMainCommit, workingTreeUpdated, alreadyUpToDate })
  — REF-ONLY mode:          "로컬 main ref를 <commit>로 동기화했어요. 현재 체크아웃한 브랜치는 그대로예요(변경 없음). 워킹트리는 깨끗해요."
  — CHECKED-OUT-MAIN mode:  "체크아웃된 main을 <commit>로 fast-forward 했어요. 워킹트리가 fast-forward로 갱신됐고, 동기화 후에도 깨끗해요."
  — both: append "배포/릴리즈/브랜치 삭제는 하지 않았어요." (alreadyUpToDate → "이미 최신이라 옮길 게 없었어요.")
composeMainSyncBlocked      — "로컬 main을 동기화하지 않았어요" + the concrete safe reason (dirty tree / untracked risk /
                              staged / detached HEAD / remote read failed / remote main != expected merge / non-fast-
                              forward / local main moved / no local main / no mergeCommitHash). NEVER claims synced.
composeMainSyncUnverified   — "동기화 결과를 확인하지 못했어요, git status / git log로 로컬 main을 확인해 주세요." NEVER "not synced"/"synced".
composeMainSyncUnavailable  — "동기화할 수 없어요 (저장소 또는 설정 확인)." (not configured / not a repo); no state change.
```

**Required wording invariants (CA change 5 / Q8):** distinguish **ref-only** ("local main ref synchronized, current
checkout unchanged, working tree remained clean") from **checked-out-main** ("checked-out main fast-forwarded,
working tree updated by the fast-forward, clean after sync"); state which commit `main` reached; and state what was
NOT done — **deploy / release / branch deletion**. Never say "workspace synced" / "working tree is now main".
`MAIN_SYNCED` never says deployed / released / production-ready / branch-deleted / remote-cleaned / current-feature-
branch-merged. **`MAIN_SYNCED` does not unlock deploy/release** (Q7).

### 4.8 Runtime routing (`PR_MERGED` and `MAIN_SYNCED`)

At `PR_MERGED` (extends the 3g block), a sync command is checked **before** the 3g already-merged / companion routing:

```text
1. interpretMainSyncIntent === 'sync'                     → handleMainSyncTurn        (NEW — preflight → fast-forward)
2. interpretPrStatusIntent / interpretMergeStatusIntent   → handlePrStatusPreviewTurn (3g read-only; keeps PR_MERGED)
3. interpretMergeExecutionIntent / merge phrase           → composeMergeExecutionAlreadyMerged (3g; no mutation)
4. DEPLOY_ONLY_WORDS / companion                          → composeMergeExecutionUnsupportedCompanion (3g)
```

New `MAIN_SYNCED` block (terminal):

```text
1. interpretMainSyncIntent === 'sync'                     → handleMainAlreadySyncedTurn (already synced; no mutation)
2. interpretPrStatusIntent / interpretMergeStatusIntent   → handlePrStatusPreviewTurn (read-only; keeps MAIN_SYNCED)
3. any merge phrase                                       → composeMergeExecutionAlreadyMerged (no mutation)
4. DEPLOY_ONLY_WORDS / companion                          → composeMergeExecutionUnsupportedCompanion (no deploy/release)
```

Every non-`PR_MERGED`/`MAIN_SYNCED` state is unchanged — a sync phrase there never syncs (CA required test 2).

---

## 5. Required Architecture Questions — decisions

- **Q1 (state)** — Add `MAIN_SYNCED` only (terminal); no deploy/release/branch-deletion state. Means "local main
  fast-forwarded to the expected post-merge remote main this run"; not deployed/released/branch-deleted/remote-
  cleaned/CI-verified (§4.1).
- **Q2 (ownership)** — The **Git capability** owns the sync primitives (`getRemoteRefCommit` read + `syncMainFastForward`
  mutation); `GitManager.syncMain` orchestrates; the Conversation Runtime only composes. **No shell/`CommandExecution`
  fallback; no new orchestration layer** (§4.5).
- **Q3-trigger** — `interpretMainSyncIntent` (sync verb + main target), only at `PR_MERGED`/`MAIN_SYNCED`. Offered
  for CA review; conservative (a bare "sync"/"main" alone does not trigger) (§4.2).
- **Q4 (strategy) — CA change 1** — **Fast-forward only; no hard reset, no force.** MODE-SPLIT by the current
  checkout: `current==main` → checked-out-main ff (working tree/index moved by ff-only merge); `current!=main` →
  ref-only ff of `refs/heads/main` (no checkout switch, no working-tree change); detached HEAD → Block; non-ff →
  Block. CAS-guarded on `previousMainCommit` (CA change 3). Hard reset (Option B) forbidden (§6), deferred (§4.4).
- **Q5 (expected remote tip) — CA change 4** — The expected remote `main` tip is `PR_MERGED.mergeCommitHash`.
  **Require `mergeCommitHash` present; ABSENT → Block, with NO fallback to `mergedHeadSha` in 3h** ("ChunsikBot
  cannot prove which remote main commit should be synchronized, therefore local main sync is blocked"). A future
  sprint may add a bounded ancestry-based policy; 3h requires exact `mergeCommitHash` (§4.3 check 5).
- **Q6 (local main existence / creation)** — Require local `main` to exist; **no auto-create** in the first sprint —
  absent → Block with a clear message (§4.3 check 11).
- **Q7 (deploy/release)** — `MAIN_SYNCED` does **not** unlock deploy/release; both remain out of scope and are stated
  as not-done in every response (§2, §6).
- **Q8 (approval gate?)** — The fast-forward is a **local, non-destructive** ref move gated by `PR_MERGED` + an
  explicit sync command + the conservative preflight. **Recommendation: no new CRITICAL approval** for the first
  fast-forward-only sync sprint (consistent with CA's described flow, which omits an approval step). A future
  hard-reset/force strategy WOULD require its own approval gate. (Flagged for CA.)

---

## 6. Out of scope — explicitly forbidden

Sprint 3h's implementation must **not** add or perform any of:

```text
deploy · release · tag creation ·
local feature branch deletion · remote feature branch deletion · GitHub branch deletion ·
force push · force reset · reset --hard (hard reset by default) · --force/-f · GitHub remote branch deletion ·
reviewer/label/assignee mutation · workflow dispatch · check rerun ·
CommandExecution/shell fallback · ExecutionOrchestrator changes · WorkspaceWrite/Patch/CodeGeneration changes ·
remote push · PR mutation
```

`RepositoryHosting` gains no method. No new approval risk. Git stays argv-only, adapter-side, no remote URLs.

---

## 7. Required tests in the implementation (27)

Runtime tests (`conversation-runtime.test.ts`) + Git Manager tests (`git-manager.test.ts` with a fake provider) +
Git adapter tests (`git-local` with a temp repo) as applicable. Numbered to CA's list:

```text
1.  PR_MERGED + explicit sync command → local sync preflight runs (git.syncMain called).
2.  Non-PR_MERGED (e.g. PR_CREATED / MERGE_APPROVED / null) + sync command → no sync (no syncMain call).
3.  Missing repositoryIdentity (or identity mismatch vs configured) → Blocked/Unavailable, no mutation.
4.  Missing mergeCommitHash evidence → Blocked (per §5 Q5; NO mergedHeadSha fallback), no mutation.
5.  Dirty working tree (unstaged) → Blocked, no mutation.
6.  Staged changes → Blocked, no mutation.
7.  Untracked overwrite risk (untracked present) → Blocked, no mutation.
8.  Remote main read failure (getRemoteRefCommit throws) → Blocked BEFORE mutation.
9.  Remote main tip != expected mergeCommitHash → Blocked (does not contain expected merge result), no mutation.
10. Non-fast-forward local main (not an ancestor of expected) → Blocked, no force/reset.
11. Successful fast-forward → anchors MAIN_SYNCED (+ syncedMainCommit == expected, mainSyncedAt, mainSyncBranch 'main',
    syncMode, workingTreeUpdated, previousMainCommit).
12. MAIN_SYNCED preserves the PR_MERGED causal chain (identity/ref/mergedHeadSha/mergeCommitHash/merge evidence).
13. Success response says LOCAL main synced to <commit>, tree clean, NOT deployed/released/branch-deleted.
14. Unknown failure after the mutating call (syncMainFastForward throws Unverified / result integrity fails) →
    Unverified, never "not synced"; anchor stays PR_MERGED.
15. No branch deletion occurs on any path (no delete-branch primitive called; adapter has none).
16. No deploy/release occurs on any path.
17. No CommandExecution/shell fallback occurs (runtime never shells; provider argv-only).
18. No ExecutionOrchestrator change (guard: orchestrator untouched by the sync path).
# CA change 6 — mode split + phase-aware failure classification
19. current branch == main → checked-out-main fast-forward path; workingTreeUpdated true; ff-only (no reset --hard/force).
20. current branch != main → ref-only path; no checkout switch; current branch unchanged; workingTreeUpdated false.
21. detached HEAD → Blocked; no mutation.
22. local main moves between preflight and ref update → Blocked (pre-ref CAS-precheck) / Unverified (during/after); never silently sync.
23. provider reports pre-ref-update non-fast-forward (GitMainSyncBlockedError) → Blocked; response says not synced.
24. provider throws AFTER the ref-update attempt (GitMainSyncUnverifiedError) → Unverified; response never says not synced.
25. mergeCommitHash absent → Blocked; NO fallback to mergedHeadSha (asserts syncMain not called / mergedHeadSha unused).
26. ref-only mode response says the current checkout is unchanged (never "workspace synced").
27. checked-out-main mode response says the checked-out main was fast-forwarded.
```

Additional guard tests (enduring invariants): the Git adapter's sync primitive uses argv-array spawn (never a shell
string) and never `--force`/`reset --hard`/branch-delete/push/`-f` flags; `GitManager.syncMain` does NOT blanket-
convert provider throws (Blocked stays Blocked); `syncMain` makes exactly ONE mutating call and only after the full
preflight passes; `MAIN_SYNCED` never unlocks deploy/release.

---

## 8. Validation & stop condition

- **Future implementation validation:** Node 22 · `pnpm typecheck` (exit 0) · `pnpm test` (full suite green).
- **This sprint (plan-only) stops here** — the plan document is the only deliverable. No implementation, no branch,
  no commit, no PR, per CA's Stop Condition.
