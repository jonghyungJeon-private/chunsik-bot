# Sprint 2y Plan — Approved Git Commit Execution (COMMIT_APPROVED → commit exact approved files, NO push)

- **Status:** ✅ APPROVED WITH CHANGES (Chief Architect Review) — the 14 required changes are applied below
  (no pre-commit `git add`; **untracked approved candidates blocked**; tracked-file eligibility check; split
  untracked-unsupported vs scope-changed wording; execution routing gated to COMMIT_APPROVED/GIT_COMMITTED
  only; GitManager+provider defensive input validation; commit-result integrity check before GIT_COMMITTED;
  preserve `commitApprovalId` + push-context on GIT_COMMITTED; failure wording states no-rollback/no-push;
  staged/unstaged dedup; push never commits). No branch/commit/PR until implementation. **No push, no
  `git add`, in this sprint.**
- **Base:** `main` @ `b357c23` · **Validation runtime:** Node 22 (to be run at implementation time).
- **Directed by:** Chief Architect (this sprint's topic and constraints are CA-assigned, not Claude-proposed).
- **Goal:** From a `COMMIT_APPROVED` anchor (Sprint 2x — commit approval recorded, nothing committed), an
  **explicit commit-execution command** ("승인된 커밋 실행해줘") re-reads git status, **re-verifies the approved
  context and exact candidate scope**, and — only if everything still matches — performs a **single, exact-file
  git commit** through the **Git** capability (a new, narrow, Approval-gated mutation), returning the commit
  hash. **The first real git mutation in the product.** Still **no push, no PR, no deployment, no
  CommandExecution/shell, no WorkspaceWrite/Patch/CodeGeneration, no `ExecutionOrchestrator` change.**
- **Phase:** Phase 2 — Product Construction (fifteenth runtime sprint, after 2k–2x). Adds **one** narrow
  Git-capability mutation method (`commitFiles`) — the smallest surface that commits exactly the approved
  files; reuses `ApprovalManager.get`, the Sprint 2x `COMMIT_APPROVED` anchor + fields, and `GitManager.status`.
- **Process:** V2 architecture-first, step 1 (plan-only).

> **Framing.** A git commit is a repository mutation, so Sprint 2y is deliberately narrow and heavily
> guarded. Everything was verified against source (CA "do not guess"): the Git capability is read-only today
> (`GitManager.status`/`diff`/`info`/`isRepository`; `LocalGitProvider` runs argv-only `spawnSync`, timeout,
> `sanitizeGitStderr`); the Sprint 2x `COMMIT_APPROVED` anchor already carries `commitApprovalId`/
> `proposedCommitMessage`/`commitCandidateFiles` (+ `workspaceRef`/`workspaceChangeRef`/`executionPlanRef`/
> `targetFiles`); `ApprovalManager.get` + `approvalRef(request)` give the APPROVED-status Ref; and
> `WorkspaceWriteManager` is the exact Ref-gate model (`approvalRef.status === APPROVED` + plan-scope before
> any mutation). Sprint 2y adds a single high-level `GitManager.commitFiles({rootPath, files, message,
> approvalRef})` that the adapter implements as a safe exact-pathspec commit, and a runtime handler that
> **re-verifies approval + anchor + exact candidate scope against a fresh `git status` before mutating**.
> Proceeding with strict exact-file commit discipline: only the approved candidate files, only after
> `COMMIT_APPROVED`, only on an explicit execution request, never a push.

---

## 1. Objective

At `COMMIT_APPROVED` (Sprint 2x), an **explicit commit-execution command** drives `ConversationRuntime` to:
1. require `COMMIT_APPROVED` and detect an explicit commit-execution intent (§5.4); a bare "좋아"/"오케이"/
   "확인"/"진행해"/"다음 단계" never triggers; push/add/reset/… phrases are rejected (no push, Constraint 7);
2. verify the approved context is complete (`commitApprovalId`/`proposedCommitMessage`/`commitCandidateFiles`
   + `workspaceRef`/`workspaceChangeRef`/`executionPlanRef`), else safe failure, no commit (Constraint 3);
3. `approvals.get(anchor.commitApprovalId)` and verify it **exists, `status === APPROVED`,
   `executionPlanRef.id === anchor.executionPlanRef.id`** (Constraint 6), deriving the `ApprovalRef` via
   `approvalRef(request)`; else safe failure, no commit;
4. re-read `git.status(anchor.workspaceRef.rootPath)` (catch → safe failure, no commit, no fallback);
5. **re-validate exact scope** against the fresh status (Constraints 2/3/4, Q4/Q5/Q6): every candidate path
   safe (`safeRelativePath`) and within `targetFiles`; every candidate still changed; the in-scope changed
   set **equals** the approved candidate set (no additional in-scope change, Q6); no changed file outside
   `targetFiles`; **no staged file outside the candidate set** (Constraint 4). Any mismatch → safe failure
   requiring a **new commit approval**, no commit;
6. re-validate `proposedCommitMessage` is still a valid bounded single line (Constraint 5); else safe
   failure requiring a new approval (never regenerate/ask AI/accept a new message here);
7. call **`git.commitFiles({ rootPath, files: commitCandidateFiles, message: proposedCommitMessage,
   approvalRef })`** — the Git capability stages and commits **only** those exact files and returns
   `{ commitHash, committedFiles, message }`. Ref-gated (`approvalRef.status === APPROVED`); argv-only; no push;
8. on success → re-anchor `GIT_COMMITTED` with `commitHash` + `committedFiles`, and reply with the hash, the
   files, and **"git push는 하지 않았어요"**; on failure → safe failure (no fake success, no push, no rollback).

At `GIT_COMMITTED`, a repeat execution → "already committed" with the hash, no new commit (Q11). Throughout:
**no git push/reset/checkout/stash/branch/tag/merge/rebase, no CommandExecution/shell, no WorkspaceWrite/
Patch/CodeGeneration, no `ExecutionOrchestrator` change** (Constraints 1/7/8, Q13/Q14).

## 2. Central finding — the mutation surface is one narrow, Approval-gated Git method; everything else is verify-then-reuse

**Verified against source (CA "do not guess"):**
- `GitManager` (`git-manager.ts`, CAP-002): read-only `isRepository`/`info`/`status`/`diff`/`isClean`/
  `requireClean`. **No mutation method.** Sprint 2y adds exactly one: `commitFiles`.
- `GitProvider` port + `LocalGitProvider` (`git-local/src/index.ts`): the adapter runs git via
  `GitRunner` = argv-array `spawnSync('git', args, {cwd, timeoutMs: 5000})` (never a shell string,
  `res.status`/`stdout`/`stderr`/`timedOut`/`failed`), with `sanitizeGitStderr` (masks tokens/URL creds,
  truncates to 300). `exec(rootPath, args)` + `failure(label, res)` compose the read-only commands. Sprint 2y's
  `commitFiles` reuses this exact pattern for a **mutating** argv sequence (still no shell, no user args
  beyond the approved file list + message passed as separate argv elements).
- **Ref-gate model = `WorkspaceWriteManager.apply`** (`workspace-write-manager.ts:45-53`): validates
  `approvalRef.status === APPROVED` and `approvalRef.executionPlanRef.id === <plan>` **before** mutating —
  Ref-only, no `ApprovalManager` query. `GitManager.commitFiles` mirrors this (`approvalRef.status ===
  APPROVED`); the runtime additionally verifies the live `ApprovalRequest` via `approvals.get` (Constraint 6).
- `ApprovalManager.get(id): Promise<ApprovalRequest | null>` exists; `approvalRef(request)` (`domain/
  approval.ts`) derives `{id, status, executionPlanRef}` from the aggregate. `ApprovalStatus.APPROVED` is the
  target. `RepositoryInfo.headSha` (`git.ts`) is the existing HEAD-sha shape (a commit hash is the same form).
- **Sprint 2x `COMMIT_APPROVED` anchor** (`conversation-runtime.ts`): carries `commitApprovalId`,
  `proposedCommitMessage`, `commitCandidateFiles`, plus `workspaceRef`/`workspaceChangeRef`/`executionPlanRef`/
  `targetFiles`. Routing: at `COMMIT_APPROVED`, `interpretCommitIntent` ("커밋해줘") → `handleCommitAlreadyApprovedTurn`.
  Sprint 2y adds a DISTINCT `interpretCommitExecutionIntent` checked first at `COMMIT_APPROVED`. The
  `COMMIT_APPROVAL_PENDING` interception is unchanged and still first, so a commit-execution phrase during a
  pending decision stays in the decision flow (Q/test 8).
- `safeRelativePath` + `normalizeRelativePath` (Sprint 2x / target-scope) exist for defensive path checks.
- The runtime `git` dep is `{ status, diff }`; Sprint 2y widens it with `commitFiles`. `GitManager` is a
  registered provider already injected into the runtime as `git` (Sprint 2w) — reuse, no new provider.

**Consequence: exactly one new Git-capability mutation method (`GitProvider.commitFiles` + `GitManager.commitFiles`
+ a `GitCommitResult` type), no new aggregate/repository/migration/capability.** No `GitProvider` low-level
`add`/`commit` primitives are exposed to the runtime (Q2). The remaining changes are on `ConversationRuntime`:
one anchor status + two fields, an execution-intent detector, one routing branch, one handler, and
`ResponseComposer` methods; plus widening the `git` dep and the `app.module` git passthrough is unchanged
(same registered `GitManager`, one method added to it).

## 3. Scope (this sprint)

- **New Git mutation surface (CA Q1/Q2/#5/#6/#7, Constraint 1):** `GitCommitResult { commitHash, committedFiles,
  message }`; `GitProvider.commitFiles(rootPath, files, message)` (the adapter commits **exactly** those
  tracked files via `git commit --only -- <files>` — **no separate `git add`**, CA #1 — and returns the
  hash; validates paths defensively, CA #7); `GitManager.commitFiles({ rootPath, files, message, approvalRef })`
  — a single high-level method, **Ref-gated** (`approvalRef.status === APPROVED`) with defensive input
  validation (safe/unique paths, valid message, non-empty rootPath, CA #6), that delegates to the provider.
  **No application-facing low-level `add`/`commit`.** `ApprovalRef` goes to the manager, not the provider (CA #13).
- **`ApplyPreviewAnchor` gains one status + two fields** (§5.1): `GIT_COMMITTED` (a commit was executed) +
  `commitHash?: string` + `committedFiles?: string[]`. Justified: durable `commitHash` is the handoff a
  future push sprint needs (CA Q9/Q10). This is the **first** state that means "committed" — deliberately
  NOT introduced before Sprint 2y (Sprint 2x forbade it).
- **`ConversationRuntimeDeps.git` widened** (§5.2): `commitFiles(input): Promise<GitCommitResult>` on the
  already-injected `GitManager`. No new dep/provider. `approvals.get` (existing) is reused.
- **New commit-execution detection**, `interpretCommitExecutionIntent(text): 'execute' | 'push-unsupported'
  | null` (§5.4), distinct from Sprint 2x's `interpretCommitIntent`. Bare approval words → null; push/add/
  reset/… → `'push-unsupported'`.
- **`handle()` routing (CA #4 — gated to commit-relevant states only)** (§5.4): execution handling is inside
  `COMMIT_APPROVED` / `GIT_COMMITTED` blocks (execution checked **before** the 2x commit-intent so "이제 실제
  커밋해줘" executes); the `COMMIT_APPROVAL_PENDING` interception stays first; **push-only is NOT intercepted
  outside commit states** (WORKSPACE_APPLIED "push 해줘" stays the 2w mutating reject); an explicit `execute`
  phrase with no commit-relevant anchor → a scoped unavailable reply (never for push-only).
- **`handleCommitExecutionTurn`** (§5.5): the guarded flow (context guard → live-approval verify → message
  re-validate → fresh status re-read → **untracked-candidate block (CA #1/#2)** → exact-scope re-validation
  (staged/unstaged de-duped, CA #11) → `git.commitFiles` → **result-integrity gate (CA #8)** → `GIT_COMMITTED`
  preserving `commitApprovalId` + push-context (CA #9)), plus `handleCommitAlreadyCommittedTurn`,
  `handleCommitPushUnsupportedTurn`, `handleCommitExecutionUnavailableTurn`, and `logCommitExecutionFailed`
  (structured, optional-access, no diff/content).
- **`ResponseComposer` methods** (§5.7, six): `composeCommitExecuted`, `composeCommitExecutionFailed`
  (no-rollback/no-push/re-check wording, CA #10), `composeCommitExecutionUnavailable` (new approval needed),
  **`composeCommitExecutionUntrackedUnsupported`** (CA #3, distinct), `composeCommitAlreadyCommitted`,
  `composeCommitPushUnsupported`; reuse `composeCommitStatusUnavailable` (2x) for a `git.status` read failure.
- **Exact-file discipline (Constraints 2/3/4, CA #1/#2/#11):** commit only `anchor.commitCandidateFiles`,
  **tracked only** (untracked blocked); re-validate the full set against fresh de-duped status; block on
  out-of-scope/unsafe/untracked/no-longer-changed/extra-in-scope-changed/unrelated-staged; message only from
  `anchor.proposedCommitMessage`.
- Tests for all of the above (§8), including the CA's 90 required items.

## 4. Non-goals (explicit, per Chief Architect direction)

No implementation before plan approval · no branch/commit/PR beyond this plan-only step · **`git push`** ·
`git reset`/`checkout`/`stash`/`branch`/`tag`/`merge`/`rebase` · PR creation · deployment · automatic commit
after approval (execution needs an explicit request) · commit from `WORKSPACE_APPLIED` without
`COMMIT_APPROVED` · commit with unapproved/out-of-scope files · committing all changed/staged/working-tree
files · regenerating or accepting a new commit message at execution time · AI commit messages · broad general
git command handling · application-facing low-level `add`/`commit` primitives · CommandExecution-based git ·
runtime shell-out · `WorkspaceWrite`/`Patch`/`CodeGeneration` · `ExecutionOrchestrator` stage change ·
rollback (Q8 — none this sprint) · a full `GitCommit` aggregate (Q9 — anchor field only).

## 5. Design

### 5.1 `ApplyPreviewAnchor` — one new status, two new fields

```ts
export type ApplyPreviewAnchorStatus =
  | 'ELIGIBLE' | 'AWAITING_APPROVAL' | 'APPROVED' | 'PATCH_READY' | 'WORKSPACE_APPLIED'
  | 'COMMIT_APPROVAL_PENDING' | 'COMMIT_APPROVED'
  /** A real git commit was executed (Sprint 2y, ADR-0046). Carries `commitHash` + `committedFiles`. This is
   *  the first state that means committed — NOT pushed, NOT deployed. */
  | 'GIT_COMMITTED';

export interface ApplyPreviewAnchor {
  // ...existing (…, commitApprovalId?, proposedCommitMessage?, commitCandidateFiles?) ...
  /** The executed commit's hash (Sprint 2y) — preserved for a future push sprint. */
  commitHash?: string;
  /** The exact files included in the executed commit (Sprint 2y) — the approved candidate set. */
  committedFiles?: string[];
}
```
`GIT_COMMITTED` means **committed only** — never pushed/deployed; the copy says so.

### 5.2 Git capability — one narrow, Ref-gated mutation (CA Q1/Q2, Constraint 1)

```ts
// domain/git.ts (Sprint 2y, ADR-0046)
export interface GitCommitResult {
  /** The new commit's full sha. */
  commitHash: string;
  /** The exact files committed (the approved candidate set). */
  committedFiles: string[];
  /** The commit message used (the approved message). */
  message: string;
}

// ports/git-provider.port.ts — the FIRST mutating method on the Git port (ADR-0046 extends ADR-0023's
// read-only contract with a single narrow, high-level commit). Still argv-only, no shell, timeout, masked
// stderr. Stages and commits EXACTLY `files` with `message`; commits no other path; never pushes.
commitFiles(rootPath: string, files: string[], message: string): Promise<GitCommitResult>;

// application/git-manager.ts — Ref-gated (mirrors WorkspaceWriteManager) + defensive input validation (CA
// #6): validates APPROVED status, non-empty files, all safe relative paths, unique-after-normalization,
// valid bounded single-line message, non-empty rootPath — BEFORE delegating. Runtime already did the full
// context/scope re-validation (§5.5); this is the capability-level backstop.
async commitFiles(input: { rootPath: string; files: string[]; message: string; approvalRef: ApprovalRef }): Promise<GitCommitResult> {
  if (input.approvalRef.status !== ApprovalStatus.APPROVED) {
    throw new Error(`git commit requires an APPROVED approval (got ${input.approvalRef.status})`);
  }
  if (!input.rootPath.trim()) throw new Error('git commit requires a rootPath');
  if (!input.files.length) throw new Error('git commit requires at least one file');
  const safe = input.files.map(safeRelativePath);
  if (safe.some((f) => f === null)) throw new Error('git commit rejects unsafe file paths');
  if (new Set(safe as string[]).size !== safe.length) throw new Error('git commit rejects duplicate files');
  if (!isValidCommitMessage(input.message)) throw new Error('git commit rejects an invalid message');
  return this.provider.commitFiles(input.rootPath, safe as string[], input.message);
}
```
**`LocalGitProvider.commitFiles` (adapter)** — argv-only, exact tracked pathspec, **no pre-commit `git add`**,
no shell, no push (CA #1/#2/#7):
```
// Defense-in-depth (the runtime + manager already validated). The provider ALSO validates path args before
// any git call: reject absolute / `..` traversal / empty, and deduplicate (CA #7). Never a shell string;
// `--` separates paths; the message is a single argv element (never interpolated).
//   NO `git add` (CA #1 — a separate stage is a mutation that would persist if the commit then fails, and
//   Sprint 2y has no rollback). Instead a single partial commit of the exact tracked paths:
git --no-pager commit --only -m <message> -- <files...>          // commit ONLY these tracked paths, one op
git --no-pager rev-parse HEAD                                     // read back the new commit sha
```
`--only`/`-o` commits exactly the listed pathspecs from the working tree without a separate staging mutation
and without touching other index entries. **Untracked approved candidates are blocked upstream (§5.5) — this
sprint commits tracked modified/deleted files only** (CA #1/#2). A path-validation failure → throw a
sanitized error with **no git command run**; a git failure → throw `this.failure('commit', res)`. Returns
`{ commitHash: <rev-parse HEAD>, committedFiles: files, message }`. **Never** runs `add`/push/reset/checkout/
stash/branch/tag/merge/rebase.

### 5.3 `ConversationRuntimeDeps.git` — widen with `commitFiles`

```ts
readonly git: {
  status(rootPath: string): Promise<GitStatus>;
  diff(rootPath: string): Promise<GitDiff>;
  /** Sprint 2y (ADR-0046) — the ONLY git mutation; Ref-gated exact-file commit. Never pushes. */
  commitFiles(input: { rootPath: string; files: string[]; message: string; approvalRef: ApprovalRef }): Promise<GitCommitResult>;
};
```
Reuses `approvals.get` (existing) for the live-approval verification. `app.module` passes the same registered
`GitManager` (now with `commitFiles`) — no new provider/inject.

### 5.4 `handle()` routing + commit-execution detection

```ts
/** Explicit commit-EXECUTION phrases (Sprint 2y, ADR-0046) — distinct from Sprint 2x commit-approval words.
 *  'execute' → perform the approved commit; 'push-unsupported' → a push/other-mutation phrase (rejected, no
 *  push); null → not an execution request (bare 좋아/오케이/확인/진행해/다음 단계 → null). */
const COMMIT_EXECUTION_WORDS =
  /(승인된?\s*커밋\s*실행|커밋\s*실행|이제\s*실제\s*커밋|commit\s+approved\s+changes|execute\s+commit|run\s+approved\s+commit)/i;
const COMMIT_EXECUTION_FORBIDDEN =
  /(푸시|\bpush\b|리셋|\breset\b|checkout|체크아웃|stash|스태시|\bbranch\b|브랜치|merge|머지|rebase|리베이스|\btag\b|태그|git\s*add)/i;

static interpretCommitExecutionIntent(text: string): 'execute' | 'push-unsupported' | null {
  const t = text.trim().toLowerCase();
  if (COMMIT_EXECUTION_FORBIDDEN.test(t)) return 'push-unsupported'; // push/reset/… (incl. "commit and push")
  if (COMMIT_EXECUTION_WORDS.test(t)) return 'execute';
  return null;
}
```
Routing (CA #4 — execution handling is **gated to commit-relevant states only**; the `COMMIT_APPROVAL_PENDING`
interception stays first, so a pending decision is never pre-empted, Q/test 8; **push-only is NOT intercepted
outside commit states**, so WORKSPACE_APPLIED "push 해줘" stays the Sprint 2w mutating reject):
```ts
if (applyAnchor?.status === 'COMMIT_APPROVAL_PENDING') { return this.handleCommitApprovalDecisionTurn(...); }
// (Sprint 2y) commit EXECUTION — ONLY at COMMIT_APPROVED / GIT_COMMITTED. Checked before the 2x commit-intent
// so "이제 실제 커밋해줘" executes rather than re-printing already-approved.
if (applyAnchor?.status === 'COMMIT_APPROVED') {
  const execKind = ConversationRuntime.interpretCommitExecutionIntent(message.text);
  if (execKind === 'push-unsupported') return this.handleCommitPushUnsupportedTurn(message, session);
  if (execKind === 'execute') return this.handleCommitExecutionTurn(message, session, applyAnchor);
}
if (applyAnchor?.status === 'GIT_COMMITTED') {
  const execKind = ConversationRuntime.interpretCommitExecutionIntent(message.text);
  if (execKind === 'push-unsupported') return this.handleCommitPushUnsupportedTurn(message, session);
  if (execKind === 'execute') return this.handleCommitAlreadyCommittedTurn(message, session, applyAnchor);
}
// An explicit commit-EXECUTION phrase with no commit-relevant anchor → a scoped "not available" reply — but
// ONLY for an explicit 'execute' phrase (never push-only; a push-only phrase falls through so 2w/2x own it).
if (
  applyAnchor?.status !== 'COMMIT_APPROVED' && applyAnchor?.status !== 'GIT_COMMITTED' &&
  ConversationRuntime.interpretCommitExecutionIntent(message.text) === 'execute'
) {
  return this.handleCommitExecutionUnavailableTurn(message, session);
}
// ... (Sprint 2x commit-intent, 2v/2w WORKSPACE_APPLIED, 2u/2t/2s) unchanged ...
```
No broad/global commit-execution handling is installed: outside COMMIT_APPROVED/GIT_COMMITTED, only an
**explicit `execute` phrase** produces a reply; push/add/reset-only phrases are left to the existing 2w/2x
handling.

### 5.5 `handleCommitExecutionTurn` — the guarded commit (COMMIT_APPROVED)

```ts
private async handleCommitExecutionTurn(message, session, anchor): Promise<TurnResult> {
  // 1. (Constraint 3) complete approved context, else safe failure (no commit). Logging never throws.
  if (
    anchor.status !== 'COMMIT_APPROVED' || !anchor.commitApprovalId || !anchor.proposedCommitMessage ||
    !anchor.commitCandidateFiles?.length || !anchor.workspaceRef || !anchor.workspaceChangeRef || !anchor.executionPlanRef
  ) {
    this.logCommitExecutionFailed(session, anchor, 'approved commit context incomplete');
    return this.failComposed(message, session, this.deps.composer.composeCommitExecutionUnavailable(message.context));
  }
  // 2. (Constraint 6) verify the live ApprovalRequest: exists, APPROVED, same plan. Derive the ApprovalRef.
  const request = await this.deps.approvals.get(anchor.commitApprovalId);
  if (!request || request.status !== ApprovalStatus.APPROVED || request.executionPlanRef.id !== anchor.executionPlanRef.id) {
    this.logCommitExecutionFailed(session, anchor, 'commit approval not APPROVED/plan-mismatched/missing');
    return this.failComposed(message, session, this.deps.composer.composeCommitExecutionUnavailable(message.context));
  }
  const gitApprovalRef = approvalRef(request);
  // 3. (Constraint 5) approved message still a valid bounded single line, else require a new approval.
  if (!isValidCommitMessage(anchor.proposedCommitMessage)) {
    return this.failComposed(message, session, this.deps.composer.composeCommitExecutionUnavailable(message.context));
  }
  // 4. Re-read git status (Constraint 3). A throw → safe failure, no commit, no fallback.
  let status: GitStatus;
  try { status = await this.deps.git.status(anchor.workspaceRef.rootPath); }
  catch { this.logCommitExecutionFailed(session, anchor, 'git status read failed');
          return this.failComposed(message, session, this.deps.composer.composeCommitStatusUnavailable(message.context)); }

  // 5. (Constraints 2/4, Q4/Q5/Q6, CA #2/#11) EXACT-scope re-validation against the FRESH status; sets are
  //    normalized + de-duplicated so a candidate appearing in BOTH staged and unstaged is still eligible.
  //    unavailable() = composeCommitExecutionUnavailable (needs a new approval); untracked() = the DISTINCT
  //    composeCommitExecutionUntrackedUnsupported. Any block → NO commit.
  const unavailable = () => this.failComposed(message, session, this.deps.composer.composeCommitExecutionUnavailable(message.context));
  const candidates = anchor.commitCandidateFiles.map(safeRelativePath);
  if (candidates.some((c) => c === null)) return unavailable();               // unsafe approved candidate (Q22)
  const safeCandidates = [...new Set(candidates as string[])];
  const scope = new Set(anchor.targetFiles.map(normalizeRelativePath));
  if (safeCandidates.some((c) => !scope.has(c))) return unavailable();        // candidate outside targetFiles (Q23)
  const norm = (xs: string[]) => xs.map(safeRelativePath);
  const stagedN = norm(status.staged);
  const unstagedN = norm(status.unstaged);
  const untrackedN = norm(status.untracked);
  if ([...stagedN, ...unstagedN, ...untrackedN].some((c) => c === null)) return unavailable(); // unsafe changed path
  const trackedChanged = new Set([...stagedN, ...unstagedN].filter((c): c is string => c !== null)); // staged ∪ unstaged
  const untrackedSet = new Set(untrackedN.filter((c): c is string => c !== null));
  const stagedSet = new Set(stagedN.filter((c): c is string => c !== null));
  const candSet = new Set(safeCandidates);
  // (CA #1/#2) untracked approved candidate → DISTINCT untracked-unsupported reply (no separate git add here).
  if (safeCandidates.some((c) => untrackedSet.has(c) && !trackedChanged.has(c))) {
    this.logCommitExecutionFailed(session, anchor, 'approved candidate is untracked');
    return this.failComposed(message, session, this.deps.composer.composeCommitExecutionUntrackedUnsupported(message.context));
  }
  // every approved candidate still a TRACKED change (Q5); in-scope tracked-changed set EQUALS candidate set
  // (Q6); no changed file (tracked or untracked) outside targetFiles (Q4); no staged file outside candidates
  // (Constraint 4).
  const allChanged = new Set([...trackedChanged, ...untrackedSet]);
  const inScopeTrackedChanged = [...trackedChanged].filter((c) => scope.has(c));
  const missing = safeCandidates.filter((c) => !trackedChanged.has(c));
  const extraInScope = inScopeTrackedChanged.filter((c) => !candSet.has(c));
  const outOfScope = [...allChanged].filter((c) => !scope.has(c));
  const stagedOutsideCandidates = [...stagedSet].filter((c) => !candSet.has(c));
  if (missing.length || extraInScope.length || outOfScope.length || stagedOutsideCandidates.length) {
    this.logCommitExecutionFailed(session, anchor, 'approved commit scope no longer matches working tree');
    return unavailable();
  }

  // 6. Execute the exact-file commit through the Git capability (Ref-gated). A throw → safe failure: NO fake
  //    success, NO push, NO rollback (Q8/CA #10).
  let result: GitCommitResult;
  try {
    result = await this.deps.git.commitFiles({
      rootPath: anchor.workspaceRef.rootPath, files: safeCandidates,
      message: anchor.proposedCommitMessage, approvalRef: gitApprovalRef,
    });
  } catch {
    this.logCommitExecutionFailed(session, anchor, 'git commit failed');
    return this.failComposed(message, session, this.deps.composer.composeCommitExecutionFailed(message.context));
  }

  // 7. (CA #8) Result-integrity gate BEFORE trusting the commit: hash non-empty + SHA-shaped; committedFiles
  //    exactly equal the approved candidates; message equals the approved message. Any mismatch → safe
  //    failure, NO GIT_COMMITTED, do not claim committed.
  const sameSet = (a: string[], b: Set<string>) => a.length === b.size && a.every((x) => b.has(x));
  if (
    !/^[0-9a-f]{7,40}$/i.test(result.commitHash) ||
    !sameSet(result.committedFiles.map(normalizeRelativePath), candSet) ||
    result.message !== anchor.proposedCommitMessage
  ) {
    this.logCommitExecutionFailed(session, anchor, 'commit result integrity mismatch');
    return this.failComposed(message, session, this.deps.composer.composeCommitExecutionFailed(message.context));
  }

  // 8. Success → re-anchor GIT_COMMITTED with the hash + committed files. (CA #9) PRESERVE commitApprovalId
  //    (audit/threading) + workspaceRef/workspaceChangeRef/targetFiles/executionPlanRef/postApplyValidationRef
  //    (a future push sprint needs them); clear proposedCommitMessage + commitCandidateFiles (replaced by
  //    committedFiles/hash). Reply: hash + files + no push.
  await this.deps.applyPreviewFlow.anchor(session, {
    ...anchor, status: 'GIT_COMMITTED', commitHash: result.commitHash, committedFiles: result.committedFiles,
    proposedCommitMessage: undefined, commitCandidateFiles: undefined, // commitApprovalId PRESERVED (CA #9)
  });
  const reply = this.deps.composer.composeCommitExecuted(message.context, { commitHash: result.commitHash, files: result.committedFiles });
  await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
  return this.responded(session, reply);
}
```
`handleCommitAlreadyCommittedTurn` (GIT_COMMITTED + execution phrase) → `composeCommitAlreadyCommitted(context,
anchor.commitHash)` (already committed, no new commit, no push). `handleCommitPushUnsupportedTurn` →
`composeCommitPushUnsupported`. `handleCommitExecutionUnavailableTurn` → `composeCommitExecutionUnavailable`.
`isValidCommitMessage` reuses the Sprint 2x commit-message bounds (single line, ≤120, no control chars,
non-empty). `logCommitExecutionFailed` uses optional field access so it never throws on incomplete context
(Sprint 2x lesson).

### 5.6 (reserved)

### 5.7 `ResponseComposer` — methods

**No overclaim:** never pushed / deployed / ready-to-push / safe-to-deploy. Every reply states **no push**.
```ts
composeCommitExecuted(context, { commitHash, files }): OutboundMessage;  // "커밋했어요: <shortHash>\n대상 파일: … \ngit push는 하지 않았어요."
// (CA #10) failure MUST say not committed + no push + rollback NOT performed + re-check git state; MUST NOT
// say 변경 없음/원상복구 완료/index unchanged/안전하게 되돌렸어요:
// "커밋을 완료하지 못했어요. git push는 하지 않았어요. rollback은 수행하지 않았어요. Git 상태는 다시 확인해 주세요."
composeCommitExecutionFailed(context): OutboundMessage;
composeCommitExecutionUnavailable(context): OutboundMessage;             // wrong state / stale-or-mismatched approval / scope changed → "다시 커밋 승인을 받아 주세요"; no commit
// (CA #3) DISTINCT from unavailable — an approved candidate is untracked (no separate git add this sprint):
// "승인된 후보 파일 중 새 파일(untracked)이 있어 이번 단계에서는 커밋하지 않았어요. git add를 별도로 수행하지
//  않기 때문에, 새 파일 커밋은 별도 단계가 필요해요. git push는 하지 않았어요."
composeCommitExecutionUntrackedUnsupported(context): OutboundMessage;
composeCommitAlreadyCommitted(context, commitHash): OutboundMessage;     // GIT_COMMITTED — "이미 커밋했어요: <hash>. git push는 하지 않았어요."
composeCommitPushUnsupported(context): OutboundMessage;                  // push/reset/… — "push는 아직 지원하지 않아요. 커밋만 가능해요. push는 하지 않았어요."
// composeCommitStatusUnavailable (Sprint 2x) reused for a git.status read failure on this path.
```

## 6. Required Architecture Questions — answers for CA review

**Q1. Exact Git API to add? (APPROVED WITH CHANGES)** `GitCommitResult {commitHash, committedFiles, message}`
+ `GitProvider.commitFiles(rootPath, files, message)` + `GitManager.commitFiles({rootPath, files, message,
approvalRef})`. Manager **Ref-gated** (`approvalRef.status === APPROVED`) **+ defensive input validation** (safe
+ unique paths, valid message, non-empty rootPath, CA #6); provider **validates paths + argv-only** (CA #7).
`ApprovalRef` to the manager, not the provider (CA #13). **No pre-commit `git add`; tracked-file exact commit
only; result integrity validated (CA #1/#8).**

**Q2. Staging + commit one method? (APPROVED WITH CHANGE)** Yes — one high-level `commitFiles`; **no separate
`git add`** (CA #1 — a separate stage would persist if the commit then failed, and there is no rollback). The
adapter does a single `git commit --only -m <msg> -- <files>` of the exact **tracked** paths. **Untracked
approved candidates are blocked** (§5.5, CA #1/#2). No application-facing `add`.

**Q3. Unrelated staged files?** **Block.** If any staged path is outside `commitCandidateFiles` → safe failure,
no commit (Constraint 4, §5.5 step 5). Conservative: never risk including surprising index content.

**Q4. Out-of-scope unstaged/untracked?** **Block all changed files outside `anchor.targetFiles`** (preserves the
Sprint 2x rule) — safe failure, no commit (§5.5 step 5). (Narrower rules were considered; the CA-preferred
conservative rule is adopted.)

**Q5. Candidate files no longer changed?** No commit; safe failure requiring a new approval
(`composeCommitExecutionUnavailable`) — the approved files have nothing to commit (§5.5 step 5 `missing`).

**Q6. Additional in-scope file changed after approval?** **Block, require a new commit approval** — the in-scope
changed set must **equal** the approved candidate set (§5.5 step 5 `extraInScope`).

**Q7. Approved message invalid now?** No commit; safe failure requiring a new approval (§5.5 step 3). Never
regenerate, ask AI, or accept a new message at execution (Constraint 5).

**Q8. git commit fails? (APPROVED WITH CHANGE)** No fake success; `composeCommitExecutionFailed` — **states not
committed, no push, and rollback NOT performed, and to re-check git state** (CA #10; never 변경 없음/원상복구/
index unchanged); no raw stderr in the reply (adapter masks); `GIT_COMMITTED` not set.

**Q9. Persist the result? (APPROVED WITH CHANGE)** Store `commitHash` + `committedFiles` **on the anchor** (+
`GIT_COMMITTED`); **no full `GitCommit` aggregate**. Per CA #9, **preserve `commitApprovalId`** (audit/threading)
+ `workspaceRef`/`workspaceChangeRef`/`targetFiles`/`executionPlanRef`/`postApplyValidationRef` (future push
handoff); clear `proposedCommitMessage` + `commitCandidateFiles` (replaced by `committedFiles`/hash). ADR-0046
documents exactly which fields are preserved and why.

**Q10. On success? (APPROVED WITH CHANGE)** **Validate the returned result integrity first** (CA #8: hash
SHA-shaped/non-empty; `committedFiles` === approved candidates; `message` === approved) — only then re-anchor
`GIT_COMMITTED`, store `commitHash`/`committedFiles`, and reply with the hash + files + **no push** (§5.5).

**Q11. Execution again after success?** `GIT_COMMITTED` + execution phrase → `composeCommitAlreadyCommitted`
(hash shown), **no new commit, no mutation** (§5.4/§5.5).

**Q12. Push phrases? (APPROVED WITH ROUTING CHANGE)** At `COMMIT_APPROVED`/`GIT_COMMITTED`,
`interpretCommitExecutionIntent` → `'push-unsupported'` → `composeCommitPushUnsupported`, **no commit, no push**
(incl. "commit and push" and a post-commit "push 해줘"). **Push handling is NOT installed globally** (CA #4/#12):
outside commit states a push-only phrase is left to the existing 2w/2x handling.

**Q13. Does ExecutionOrchestrator change?** **No.** The handler calls `git.commitFiles` directly.

**Q14. Prove no hidden side effects? (APPROVED WITH CHANGES)** Tests (§8): only `git.status` + `git.commitFiles`
+ `approvals.get` are called; `git.commitFiles` receives exactly the approved files + message + APPROVED
`ApprovalRef` (never the raw `ApprovalRequest`); the adapter runs only `commit`/`rev-parse` argv (asserted) —
**no `git add`, no push/reset/checkout/stash/branch/tag/merge/rebase**; no `command.run`, `workspaceWrite.apply`,
`patch.generate`/`get`, `codeGeneration.generate`, `orchestrator.run`/`.resume`; no runtime shell. **Added per
CA #14:** untracked candidate blocked (no `commitFiles`); result-integrity failure prevents `GIT_COMMITTED`;
failure wording implies no rollback/clean-index; routing does not broadly intercept push outside commit states.

## 7. Case matrix

| Case | State / detection | Result |
|---|---|---|
| 1. COMMIT_APPROVED + "승인된 커밋 실행해줘"/"커밋 실행해줘"/"이제 실제 커밋해줘"/"execute commit", scope intact | `execute` | verify approval+scope → `git.commitFiles(exact files)` → `GIT_COMMITTED` (+hash) → `composeCommitExecuted` (no push) |
| 2. ambiguous ("좋아"/"오케이"/"확인"/"진행해"/"다음 단계") at COMMIT_APPROVED | null | no execution |
| 3. no COMMIT_APPROVED/GIT_COMMITTED anchor + execution phrase | `execute`, wrong state | `composeCommitExecutionUnavailable`, no commit |
| 4. WORKSPACE_APPLIED + execution phrase | `execute`, wrong state | `composeCommitExecutionUnavailable`, no commit |
| 5. COMMIT_APPROVAL_PENDING + execution phrase | pending interception (first) | stays approval-decision flow (ambiguous → re-prompt), no execution |
| 6. COMMIT_APPROVED + push / "commit and push" / reset/stash/checkout/add | `push-unsupported` | `composeCommitPushUnsupported`, no push, no commit |
| 6b. WORKSPACE_APPLIED + "push 해줘" (no commit anchor) | not intercepted by 2y (CA #4) | existing Sprint 2w mutating reject; no commit-execution handling |
| 7. incomplete approved context (missing id/msg/candidates/refs) | guard | `composeCommitExecutionUnavailable`, no commit, log never throws |
| 8. approval missing / not APPROVED / plan mismatch | verify | `composeCommitExecutionUnavailable`, no commit |
| 9. approved message invalid now | verify | `composeCommitExecutionUnavailable` (new approval needed), no commit |
| 10. `git.status` throws | caught | `composeCommitStatusUnavailable`, no commit, no fallback |
| 11. approved candidate no longer changed | scope re-validate | `composeCommitExecutionUnavailable`, no commit |
| 12. changed file outside targetFiles | scope re-validate | `composeCommitExecutionUnavailable`, no commit |
| 13. extra in-scope changed file (beyond candidate set) | scope re-validate (Q6) | `composeCommitExecutionUnavailable` (new approval), no commit |
| 14. staged file outside candidate set | scope re-validate (Constraint 4) | `composeCommitExecutionUnavailable`, no commit |
| 15. unsafe candidate/changed path (absolute/`..`/empty) | scope re-validate | `composeCommitExecutionUnavailable`, no commit |
| 15b. approved candidate currently **untracked** (CA #1/#2) | scope re-validate | `composeCommitExecutionUntrackedUnsupported` (distinct), no commit, no `git add` |
| 15c. candidate appears in BOTH staged and unstaged (CA #11) | scope re-validate (deduped) | still eligible if otherwise valid → commits |
| 16. `git.commitFiles` throws | caught | `composeCommitExecutionFailed` (not committed / no push / no rollback / re-check); no `GIT_COMMITTED` |
| 16b. `git.commitFiles` returns bad hash / wrong files / wrong message (CA #8) | result-integrity gate | `composeCommitExecutionFailed`; **no `GIT_COMMITTED`**, does not claim committed |
| 17. GIT_COMMITTED + execution phrase again | already committed | `composeCommitAlreadyCommitted` (hash), no new commit |
| 18. any success | — | `git.commitFiles` files === approved candidates; message === approved; adapter uses **no `git add`**, never push/reset/…; `GIT_COMMITTED` preserves `commitApprovalId`+push-context |

## 8. Required Tests (Node 22) — the CA's full 90-item list

**`conversation-runtime.test.ts`** — execute + intent (1–9): 1–4. COMMIT_APPROVED + "승인된 커밋 실행해줘"/"커밋
실행해줘"/"이제 실제 커밋해줘"/"execute commit" → `git.commitFiles` once. 5. ambiguous → no commit. 6. no
COMMIT_APPROVED anchor + execution phrase → no commit. 7. WORKSPACE_APPLIED + execution phrase → no commit.
8. COMMIT_APPROVAL_PENDING + execution phrase → stays the decision flow, no commit. 9. COMMIT_APPROVAL_PENDING +
"승인" → COMMIT_APPROVED only, no `commitFiles`.

Push/mutation rejection (10–13): 10. COMMIT_APPROVED + push → reject, no commit/push. 11. + "commit and push" →
reject. 12. + add/reset/stash/checkout → reject. 13. GIT_COMMITTED + push → reject, no push.

Context/approval guards (14–20): 14–17. missing commitApprovalId / proposedCommitMessage / commitCandidateFiles /
workspaceRef|workspaceChangeRef|executionPlanRef → safe failure, no commit. 18. approval `get` → null → safe
failure. 19. not APPROVED → safe failure. 20. plan mismatch → safe failure.

Scope re-validation (21–29): 21. `git.status` throws → safe failure, no commit. 22. unsafe candidate → no
commit. 23. candidate outside targetFiles → no commit. 24. candidate no longer changed → no commit. 25. changed
file outside targetFiles → no commit. 26. extra in-scope changed file not in candidate set → no commit.
27. staged file outside candidate set → no commit. 28. **untracked approved candidate → no commit**
(`composeCommitExecutionUntrackedUnsupported`). 29. **candidate in both staged & unstaged → still eligible** if
otherwise valid.

Message (30–32): 30. approved message invalid now → no commit. 31. execution never accepts a new message.
32. message to `commitFiles` exactly equals approved message.

commitFiles input (33–38): 33. valid context calls `git.commitFiles` once. 34. input `files` exactly equals
approved candidates. 35. input `message` exactly equals approved. 36. receives the approved `ApprovalRef`. 37.
does NOT receive the raw `ApprovalRequest`. 38. does NOT call `git.diff`.

`GitManager.commitFiles` validation (39–43): 39. rejects non-APPROVED approvalRef. 40. rejects empty files.
41. rejects duplicate files. 42. rejects unsafe path. 43. rejects invalid message.

**`git-local/src/index.test.ts`** — adapter (44–50): 44. commits exact tracked files only. 45. argv-array only.
46. uses `--` before pathspecs. 47. message passed as one argv element. 48. **does NOT run `git add`**. 49.
never runs push/reset/checkout/stash/branch/tag/merge/rebase. 50. rejects unsafe path before any git call.

Result integrity / success / repeat (51–62): 51. validates result hash. 52. validates returned files. 53.
validates returned message. 54. result-integrity failure → **no `GIT_COMMITTED`**. 55. success re-anchors
`GIT_COMMITTED`. 56. stores `commitHash`. 57. stores `committedFiles`. 58. preserves `workspaceRef`/
`workspaceChangeRef`/`targetFiles`/`executionPlanRef` (+ `commitApprovalId`). 59. preserves
`postApplyValidationRef`. 60. reply includes the commit hash. 61. reply says git push not performed. 62. repeat
execution after success → no new commit.

Failure wording (63–67): 63. `commitFiles` throws → `composeCommitExecutionFailed`. 64. does not claim
committed. 65. says no push. 66. says rollback not performed. 67. does not claim index clean/unchanged.

No side effects (68–82): 68. no `command.run`. 69. no `workspaceWrite.apply`. 70. no `patch.generate`. 71. no
`patch.get`. 72. no `codeGeneration.generate`. 73. no `orchestrator.run`/`.resume`. 74. no runtime shell. 75–82.
no git push/reset/checkout/stash/branch/tag/merge/rebase (adapter argv assertion).

**`response-composer.test.ts`** (83–88): 83. `composeCommitExecuted` says committed + no push. 84.
`composeCommitExecutionFailed` says not committed / no push / no rollback (never clean-index). 85.
`composeCommitExecutionUnavailable` says a new approval is needed. 86. `composeCommitAlreadyCommitted` includes
the hash + no new commit. 87. `composeCommitPushUnsupported` says push not supported / no push. 88. no reply
says pushed/deployed/ready-to-push; `composeCommitExecutionUntrackedUnsupported` is distinct from unavailable.

**Node 22**: 89. `pnpm typecheck` green. 90. `pnpm test` green.

## 9. Architecture Impact / Reuse

- **Reuses, unchanged:** `GitManager.status`/`GitProvider`/`LocalGitProvider` read path + `GitRunner`/
  `sanitizeGitStderr` adapter machinery (CAP-002), `ApprovalManager.get` + `approvalRef()` (CAP-004), the
  `WorkspaceWriteManager` Ref-gate pattern (mirrored), the Sprint 2x `COMMIT_APPROVED` anchor + fields +
  `safeRelativePath`/`normalizeRelativePath` + commit-message bounds, `StatelessApplyPreviewFlow`.
- **Changes:** `domain/git.ts` (+`GitCommitResult`), `ports/git-provider.port.ts` (+`commitFiles` — the first
  mutating port method), `git-local` (+`LocalGitProvider.commitFiles` argv-only exact-tracked-file commit
  **with no `git add`** + path validation + tests), `git-manager.ts` (+Ref-gated `commitFiles` with defensive
  input validation), `conversation-runtime.ts` (+`GIT_COMMITTED` status, +`commitHash`/`committedFiles` fields,
  +`git.commitFiles` dep, +`interpretCommitExecutionIntent` + word-sets, +state-gated routing,
  +`handleCommitExecutionTurn`/`handleCommitAlreadyCommittedTurn`/`handleCommitPushUnsupportedTurn`/
  `handleCommitExecutionUnavailableTurn` + `logCommitExecutionFailed`; reuses `isValidCommitMessage`/
  `safeRelativePath`), `response-composer.ts` (+**6** methods). `app.module.ts` unchanged (same registered
  `GitManager`).
- **No new** aggregate / repository / migration / capability. **No** `ExecutionOrchestrator`/`Core` contract
  change (beyond the one Git mutation method). **No push, no `git add`.** CommandExecution/WorkspaceWrite/Patch
  untouched.
- **ADR-0046** (to be authored before implementation) must document, per CA-required content: Sprint 2y is
  approved git **commit execution** only (the first real git mutation); commit only after `COMMIT_APPROVED` +
  an explicit execution phrase; **no automatic execution after approval**; the Git capability owns the
  mutation, the runtime never shells out, CommandExecution is not used for git; a **single high-level
  `commitFiles`** (no low-level add/commit exposed); **no pre-commit `git add`**; **untracked approved
  candidates are blocked** (commit exact **tracked** approved files only); `ApprovalRef` passed to the manager
  (not the provider), APPROVED-gated; the manager validates safe/unique inputs + valid message, the provider
  validates path args + argv-only + `--` before pathspecs; the message comes only from the approved anchor (no
  AI/new message at execution); the live `ApprovalRequest` must be APPROVED + plan-matched; a fresh `git.status`
  re-validation before mutation blocks staged-outside-candidates / changed-outside-targetFiles / extra-in-scope
  / no-longer-changed; **result-integrity validation before `GIT_COMMITTED`**; `GIT_COMMITTED` means committed
  only (not pushed/deployed) with `commitHash`/`committedFiles` on the anchor (**`commitApprovalId` preserved**,
  no aggregate); commit failure has **no rollback** and wording must not imply a clean index; **no push/PR/
  deployment**, no WorkspaceWrite/Patch/CodeGeneration/Orchestrator.

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Commits unrelated/staged/out-of-scope/untracked files | High (safety) | commit only `commitCandidateFiles` (tracked); block on out-of-scope/extra-in-scope/unrelated-staged/unsafe/**untracked** after a fresh de-duped status re-read; adapter commits exact pathspecs `commit --only -- <files>` (§5.5/§5.2, Constraints 2/3/4, CA #1/#2/#11) — tested (§8 22–29, 34, 44) |
| Partial-stage side effect if commit fails | High (safety) | **no separate `git add`** — a single `commit --only` (no pre-stage mutation to persist on failure); untracked blocked (CA #1) — tested (§8 48, 28) |
| Executes without a live APPROVED approval | High (safety) | `approvals.get` verify exists+APPROVED+plan before commit; `GitManager.commitFiles` Ref-gates `status===APPROVED` (§5.5/§5.2, Constraint 6/CA #6) — tested (§8 18–20, 36, 39) |
| Push slips in | High | no push method exists; at commit states the detector rejects push/"commit and push" as `push-unsupported`; adapter runs only commit/rev-parse (§5.2/§5.4, Constraint 7/CA #12) — tested (§8 10–13, 49, 75–82) |
| Trusting bad provider result as a commit | High (safety) | result-integrity gate (hash SHA-shaped, files===candidates, message===approved) before `GIT_COMMITTED` (§5.5, CA #8) — tested (§8 51–54) |
| Runtime shells out / uses CommandExecution for git | High (arch) | git runs only via `git.commitFiles` (GitManager → argv-only adapter); no CommandExecution/shell (Constraint 8) — tested (§8 68, 74) |
| Message tampered / regenerated at execution | Med | message only from `anchor.proposedCommitMessage`, re-validated; invalid → new approval; single argv element (§5.5, Constraint 5) — tested (§8 30–32, 47) |
| Fake success / rollback-clean-index confusion on failure | Med | commit throw → `composeCommitExecutionFailed` (not committed / no push / **no rollback** / re-check); never clean-index/원상복구; no `GIT_COMMITTED` (§5.5/§5.7, Q8/CA #10) — tested (§8 63–67) |
| Broad global push/commit-execution handling | Med (arch) | execution routing gated to COMMIT_APPROVED/GIT_COMMITTED only; push-only outside → existing 2w/2x (§5.4, CA #4) — tested (§8 7, 13, case 6b) |
| Double commit on repeat | Med | `GIT_COMMITTED` + execution → already-committed reply, no new commit (§5.4, Q11) — tested (§8 62) |
| Guard log throws on missing field | Low | `logCommitExecutionFailed` uses optional access (2x lesson) — tested (§8 14–17) |
| `GIT_COMMITTED` read as pushed/deployed | Med (Product) | copy: committed only, "git push는 하지 않았어요"; forbidden pushed/deployed/ready-to-push (§5.7) — tested (§8 61, 88) |

## Next Step

Plan-only (this document). Per the approved sequence: (1) this plan → **Chief Architect Review**; (2) on
approval, author ADR-0046; (3) implement exactly this scope (§3/§5) on a `v2/<topic>` branch; (4) add/update
tests per §8; (5) validate on **Node 22**; (6) open a PR for Chief Architect Implementation Review. **Stop
here** — no implementation, branch, commit, or PR until the plan is approved. **No push in this sprint.**
