# Sprint 2w Plan — Post-Validation Git Status Preview (WORKSPACE_APPLIED → read-only Git preview)

- **Status:** ✅ APPROVED WITH CHANGES (Chief Architect Review) — the read-only diff extension is approved,
  and the 10 required changes are applied below (read-only argv-only diff `git --no-pager diff --no-ext-diff
  --no-color HEAD`; diff preview calls BOTH status+diff; untracked-content excluded + stated; safe files
  derivation + binary marker only; layered budgets; English `commit` conservative→mutating; mutating
  precedence; git-read-failure no fallback; validation-lookup failure never fails the preview; no persistence/
  re-anchor; read-only-vs-mutation wording). No branch/commit/PR until implementation.
- **Base:** `main` @ `1f0c0fc` · **Validation runtime:** Node 22 (to be run at implementation time).
- **Directed by:** Chief Architect (this sprint's topic and constraints are CA-assigned, not Claude-proposed).
- **Goal:** After Sprint 2u leaves a `WORKSPACE_APPLIED` anchor (real file mutation) and Sprint 2v optionally
  records a `postApplyValidationRef`, a later turn with an **explicit git-preview command** ("git 상태
  보여줘", "변경 파일 보여줘", "diff 보여줘", …) returns a **bounded, read-only** summary of the current
  working-tree state through the **Git** capability (CAP-002), against `anchor.workspaceRef`. **No git
  mutation (add/commit/push/reset/checkout/stash/branch/…), no CommandExecution, no WorkspaceWrite, no file
  mutation, no ExecutionOrchestrator change.**
- **Phase:** Phase 2 — Product Construction (thirteenth runtime sprint, after 2k–2v). **Not** a new
  capability — reuses `GitManager`/`GitProvider`/`GitStatus` (CAP-002, ADR-0023) exactly as built for the
  status path, plus the Sprint 2u `WORKSPACE_APPLIED` anchor and (read-only) the Sprint 2v
  `postApplyValidationRef`. The diff path needs **one minimal read-only extension** to the Git capability
  (see §2/§5.8) — read-only only, no mutation.
- **Process:** V2 architecture-first, step 1 (plan-only).

> **Framing.** Everything read-only already exists and was verified by reading source (CA "do not guess").
> `GitManager.status(rootPath)` returns a `GitStatus` (branch + staged/unstaged/untracked + clean) — a real,
> already-built read-only "what changed" answer. It takes a plain `rootPath`; `anchor.workspaceRef.rootPath`
> supplies it. Git execution stays adapter-side (`LocalGitProvider`, argument-array `spawnSync`, 5 s timeout,
> read-only subcommands, secret-masked stderr) — core stays `child_process`-free. The **only** gap is a
> read-only **diff** method (none exists), which Sprint 2w adds as the smallest safe read-only extension
> (`GitProvider.diff`/`GitManager.diff` + a `GitDiff` type). This sprint is composition + one read-only
> extension: recover the `WORKSPACE_APPLIED` anchor → detect an explicit git-preview intent → reject mutating
> git phrases → call the read-only Git method against `anchor.workspaceRef.rootPath` → render a bounded
> summary (optionally noting the last validation). Proceeding with strict read-only git discipline: **no git
> mutation, ever, in this sprint.**

---

## 1. Objective

`WORKSPACE_APPLIED` anchor (Sprint 2u/2v) carries `executionPlanRef`, `workspaceRef`, `workspaceChangeRef`,
`targetFiles`, and optionally `postApplyValidationRef` (Sprint 2v). A later turn with an **explicit
git-preview command** drives `ConversationRuntime` to:
1. confirm the anchor is `WORKSPACE_APPLIED` and detect an explicit git-preview intent (§5.4). A bare
   "좋아"/"오케이"/"확인"/"다음 단계 진행"/"계속 진행"/"검증됐네" never triggers;
2. **reject mutating git phrases** ("커밋해줘"/"push 해줘"/"git add 해줘"/"git reset 해줘"/"stash 해줘"/…) →
   a read-only "not supported" reply, **no git call** (CA Q4/Constraint 2). "커밋 전에 변경사항 요약해줘" is a
   *status* phrase, not a commit command;
3. map the phrase to the read-only Git method(s) — status phrases → `GitManager.status`; diff phrases →
   `GitManager.status` **then** `GitManager.diff` (CA #2 — status supplies branch/clean + untracked paths
   that `git diff HEAD` omits; the new `diff` extension supplies the tracked unified diff) — against
   `anchor.workspaceRef.rootPath` (CA Q5);
4. render a **bounded** summary via `ResponseComposer` (changed files ≤ 30, diff ≤ 5 files / ≤ 3000 chars,
   overall reusing the existing chat budget), labeling any truncation (CA Q6);
5. if `anchor.postApplyValidationRef` exists, include the last validation's command + status as read-only
   context ("최근 검증 기록: pnpm test SUCCEEDED — 이번에 다시 실행하진 않았어요"); else "검증 기록 없음"
   (CA Q8). Never claim current validity unless it was just run;
6. always state git add/commit/push were **not** performed, no file mutation, no command execution, and never
   infer "safe to commit / ready to push / deploy / verified forever" (CA Q9/Constraint 5).

If there is **no** `WORKSPACE_APPLIED` anchor, the git-preview path is not taken and no broad general git
handling is created (CA Q3). Any Git read failure → a safe failure reply; never a CommandExecution/shell
fallback (CA Q10).

## 2. Central finding — Git is a built, read-only, adapter-isolated capability; `status` exists, `diff` does not

**Verified against source (CA "do not guess"):**
- `GitManager` (`git-manager.ts:11-48`, CAP-002/ADR-0023): `isRepository(rootPath)`, `info(rootPath):
  RepositoryInfo`, `status(rootPath): GitStatus`, `isClean(rootPath)`, `requireClean(rootPath)` — **all
  read-only**; a thin passthrough over `GitProvider`. It takes a plain `rootPath` **string** (Git ≠
  Workspace; composes via path, no `WorkspaceRef` dependency).
- `GitProvider` port (`git-provider.port.ts:17-28`): `isRepository`/`info`/`status` — read-only only; the
  doc explicitly forbids commit/checkout/branch/merge/reset/stash/push/pull/fetch/tag/worktree; adapter runs
  git via argument-array spawn, timeout, cwd = repo root; core never touches `child_process`. **No `diff`.**
- `GitStatus` (`git.ts:7-23`): `{ clean, branch, staged[], unstaged[], untracked[], ahead?, behind?,
  isDetached?, hasUnmergedPaths? }`. `RepositoryInfo` (`git.ts:30-41`): `{ isRepository, rootPath, branch,
  headSha?, detached }` — **no remote URLs** (credential-safety, ADR-0023). **No Git aggregate, no Ref, no
  storage/persistence.**
- `LocalGitProvider` (`git-local/src/index.ts`): `spawnSync('git', args, {cwd, timeout:5000})` (no shell),
  `status` = `git status --porcelain=v1 -b` → `parsePorcelain`; `info` = `rev-parse`/`symbolic-ref`;
  `sanitizeGitStderr` masks tokens/URL creds + truncates to 300 chars. Read-only subcommands only.
- **Runtime has no git dependency today.** `ConversationRuntime` never calls git (the only "git" mentions are
  disclaimer text and the Sprint 2v deny-fragment). So Sprint 2w must add a `git` dep (the already-registered
  `GitManager`).
- `GitManager` is **already a registered provider** (`app.module.ts:178-179`, from `GIT_PROVIDER` =
  `LocalGitProvider`) but **not injected into `ConversationRuntime`**. Reuse it; add one inject entry.
- `ResponseComposer` bounds already exist: `MAX_MESSAGE_CHARS = 1900` (chat budget) + `clampToMessageBudget`;
  `MAX_DIFF_LINES_PER_FILE = 40` / `MAX_DIFF_CHARS_PER_FILE = 1000` (Sprint 2r unified-diff preview). Reuse
  the chat budget; add changed-files/diff caps as documented (§5.7/§6 Q6).

**Consequence.** The **status** path needs **no Git-capability change** (reuse `GitManager.status`). The
**diff** path needs the **smallest safe read-only extension** (Q2): `GitProvider.diff`/`GitManager.diff` +
a `GitDiff` domain type + `LocalGitProvider.diff` adapter (read-only `git diff`, bounded). No aggregate, no
Ref, no storage, no mutation. The remaining wiring is on `ConversationRuntime`: add a `git` dep, add a
git-preview intent detector + one routing branch + one handler, and add `ResponseComposer` methods. **No new
anchor state or field** (Q7 — a read-only view is not persisted).

## 3. Scope (this sprint)

- **No new anchor status or field (CA Q7).** No `GIT_PREVIEWED` state; no `postApplyGitPreviewRef` (there is
  no `GitStatusRef`/`GitDiffRef` domain type and no git storage — a read-only view is transient). The anchor
  is read, never re-anchored, on this path.
- **`ConversationRuntimeDeps` gains one dependency** (§5.2): `git: { status(rootPath: string):
  Promise<GitStatus>; diff(rootPath: string): Promise<GitDiff> }` — the existing `GitManager` (reused;
  `status` unchanged, `diff` is the new read-only extension). `app.module.ts` injects the already-registered
  `GitManager` (one new inject entry; no new provider). The existing read-only `commandExecutions.get` dep
  (Sprint 2l) is reused to resolve the last validation's command for Q8 context.
- **New explicit git-preview detection**, `ConversationRuntime.interpretGitPreviewIntent(text): 'status' |
  'diff' | 'mutating' | null` (§5.4), using dedicated `GIT_STATUS_WORDS`/`GIT_DIFF_WORDS`/`GIT_MUTATING`
  distinct from every prior word-set. Mutating git phrases → `'mutating'` (reject, no git call). "커밋 전에
  변경사항 요약" is a status phrase, not a commit.
- **`handle()` routing** (§5.4): a new branch checked among the `WORKSPACE_APPLIED`-aware checks, guarded on
  `applyAnchor?.status === 'WORKSPACE_APPLIED'` **and** a non-null git-preview intent. Git-preview phrases
  don't overlap the FINAL_APPLY/PATCH/APPLY/validation word-sets, so those branches are untouched; anything
  else still falls through (no broad general git handling — CA Q3).
- **`handleGitPreviewTurn`** (§5.5): mutating → reject reply (RESPONDED, no git call); status → `git.status`;
  **diff → `git.status` THEN `git.diff`** (CA #2 — status supplies branch/clean + untracked paths that
  `git diff HEAD` omits; if status throws, `git.diff` is NOT called, CA #7), all against
  `anchor.workspaceRef.rootPath` → bounded render (+ read-only validation context, which never fails the
  preview, CA #8) → RESPONDED. A git read throw → safe failure (no CommandExecution/shell fallback, CA #7).
- **Minimal read-only Git diff extension** (§5.8, CA APPROVED): `GitDiff` domain type + `GitProvider.diff` +
  `GitManager.diff` + `LocalGitProvider.diff` — **read-only, argument-array only** (`git --no-pager diff
  --no-ext-diff --no-color [--name-only] HEAD`, unborn-HEAD fallback without `HEAD`), timeout+masked stderr,
  hard adapter cap, binary → marker only, tracked-changes only (untracked via status). Never a mutating
  subcommand.
- **New `ResponseComposer` methods** (§5.7): `composeGitStatusPreview`, `composeGitDiffPreview` (takes BOTH
  status+diff), `composeGitMutationNotSupported`, `composeGitPreviewUnavailable` — reusing the message-budget
  helpers; **every successful preview states "읽기 전용 Git 미리보기" + no git add/commit/push + no file
  mutation + no command execution** (CA #10); layered bounds + truncation labels (CA #4); forbidding overclaim.
- **Read-only discipline (CA Constraint 1/2):** only the Git capability touches git; the runtime never shells
  out; CommandExecution/WorkspaceWrite/Patch are never used for git; only `status`/`diff` (read-only) run —
  never add/commit/push/reset/checkout/stash/branch/tag/merge/rebase.
- **Workspace source = `anchor.workspaceRef.rootPath` (CA Q5):** never re-resolved from the active project or
  the latest message on this path.
- Tests for all of the above (§8), including the CA's 39 explicitly required test items.

## 4. Non-goals (explicit, per Chief Architect direction)

No implementation before plan approval · no branch/commit/PR beyond this plan-only step · `git add`/`commit`/
`push`/`reset`/`checkout`/`stash`/`branch`/`tag`/`merge`/`rebase` (or any git mutation) · branch/PR creation ·
deployment · `CommandExecution` (or a shell git command through it) · shelling out to git from the runtime ·
`WorkspaceWrite`/any file mutation · **automatic git preview after apply or after validation** (the user must
explicitly ask) · AI deciding whether to commit · commit-message generation as a final action · multi-command
git workflow · broad general git command handling outside the `WORKSPACE_APPLIED` post-apply path ·
`ExecutionOrchestrator` stage change or new stage · `Core` contract change (beyond the read-only `GitProvider`
extension) · a new anchor state/field · exposing remote URLs · claiming safe-to-commit/ready-to-push/deploy/
verified-forever/clean-tree-beyond-what-Git-reports.

## 5. Design

### 5.1 No new anchor state or field (CA Q7)

`ApplyPreviewAnchor` is unchanged. A read-only git preview is transient — there is no `GitStatusRef`/
`GitDiffRef` domain type and no git storage to reference, so nothing is persisted and the anchor is not
re-anchored on this path. (If a future sprint adds a persisted `GitStatusRef`, a `postApplyGitPreviewRef?`
could then be considered — out of scope here.)

### 5.2 `ConversationRuntimeDeps` — one new dependency (the already-registered GitManager)

```ts
/** Reused for the read-only post-apply git preview (Sprint 2w, ADR-0044) — the already-registered GitManager
 *  (CAP-002). READ-ONLY: `status` is unchanged; `diff` is a new read-only extension (§5.8). The runtime
 *  never shells out to git, and never calls a mutating git operation. */
readonly git: {
  status(rootPath: string): Promise<GitStatus>;
  diff(rootPath: string): Promise<GitDiff>;
};
```
The existing `readonly commandExecutions: { get(id): Promise<CommandExecution | null> }` (Sprint 2l) is
reused to resolve the last validation's command for the Q8 context line — no new dep for that.

### 5.3 What is read, where, and why read-only (CA Constraints 1/2, Q5)

- **What:** `GitManager.status(rootPath)` (branch + staged/unstaged/untracked + clean) for status phrases;
  `GitManager.diff(rootPath)` (bounded read-only unified diff) for diff phrases. Both **read-only**; the
  runtime never constructs a mutating git command and never shells out.
- **Where (Q5):** `rootPath = anchor.workspaceRef.rootPath` — the workspace the file was applied to. Never
  re-resolved from the active project or the message on this path.
- **Why read-only-safe:** the Git capability's port contract is read-only (ADR-0023); the diff extension
  (§5.8) is read-only `git diff` only. `GitManager` never mutates; there is no approval gate because nothing
  is mutated. CommandExecution/WorkspaceWrite are never on this path.

### 5.4 `handle()` routing + explicit git-preview detection

```ts
/** Mutating git phrases (Sprint 2w, ADR-0044) — must NEVER route to a read-only preview (CA Q4/Constraint
 *  2 / Required Change #5/#6). Two commit rules by language:
 *   - Korean "커밋" counts as a command ONLY with an action verb (해/하자/할/…), so "커밋 전에 변경사항
 *     요약해줘" is a STATUS phrase, not a commit (CA-approved).
 *   - English `commit` stays CONSERVATIVE: ANY `commit` token → mutating (so "commit this"/"before commit
 *     show changes" → unsupported, no git read), until a future sprint adds clearer NL handling (CA #5). */
const GIT_MUTATING =
  /(커밋\s*(해|하자|할|하기|하고|하는)|\bcommit\b|푸시|\bpush\b|git\s*add|\badd\s*해|리셋|\breset\b|checkout|체크아웃|stash|스태시|\bbranch\b|브랜치\s*(만들|생성)|merge|머지|rebase|리베이스|\btag\b|태그)/i;
/** Read-only diff-preview phrases. */
const GIT_DIFF_WORDS = /(\bdiff\b|디프)/i;
/** Read-only status/changed-files phrases (incl. the CA-approved safe Korean "커밋 전에 변경사항 요약"). */
const GIT_STATUS_WORDS = /(git\s*상태|깃\s*상태|git\s*status|\bstatus\b\s*보여|변경\s*파일|변경\s*사항|변경사항|바뀐\s*파일|커밋\s*전)/i;

/** Explicit read-only git-preview intent (Sprint 2w, ADR-0044). Returns:
 *   'mutating' → a git MUTATION phrase → reject, no git call (checked FIRST — precedence over diff/status,
 *                CA Required Change #6);
 *   'diff'     → a read-only diff preview;
 *   'status'   → a read-only status/changed-files preview;
 *   'null'     → not a git-preview intent → fall through (no broad general git handling, CA Q3). */
static interpretGitPreviewIntent(text: string): 'status' | 'diff' | 'mutating' | null {
  const t = text.trim().toLowerCase();
  if (GIT_MUTATING.test(t)) return 'mutating';       // reject even if it also contains a preview word (tests 15/16)
  if (GIT_DIFF_WORDS.test(t)) return 'diff';
  if (GIT_STATUS_WORDS.test(t)) return 'status';
  return null;                                        // "좋아"/"오케이"/"확인"/"다음 단계 진행"/"검증됐네" → null
}
```
Routing — a new branch inside the `WORKSPACE_APPLIED`-aware checks (git-preview phrases don't overlap the
2u/2t/2s/2v word-sets, so those are untouched):
```ts
if (applyAnchor?.status === 'WORKSPACE_APPLIED') {
  const validationKind = ConversationRuntime.interpretPostApplyValidationIntent(message.text); // Sprint 2v
  if (validationKind) return this.handlePostApplyValidationTurn(message, session, applyAnchor, validationKind);
  const gitKind = ConversationRuntime.interpretGitPreviewIntent(message.text);                 // Sprint 2w
  if (gitKind) return this.handleGitPreviewTurn(message, session, applyAnchor, gitKind);
}
// ... FINAL_APPLY / PATCH / APPLY branches unchanged; else fall through to classify (no general git handling).
```
Ordering note: the Sprint 2v validation check stays first; a validation phrase ("테스트/typecheck") and a
git-preview phrase ("git 상태/diff") are disjoint, so order is immaterial for correctness — documented for
clarity. With **no** `WORKSPACE_APPLIED` anchor, neither detector is consulted (CA Q3 — no general git flow).

### 5.5 `handleGitPreviewTurn` — the main flow

```ts
private async handleGitPreviewTurn(
  message: InboundMessage,
  session: Session,
  anchor: ApplyPreviewAnchor,
  kind: 'status' | 'diff' | 'mutating',
): Promise<TurnResult> {
  // 1. (CA Q4/Constraint 2) A git MUTATION phrase → read-only "not supported" reply. NORMAL turn (RESPONDED),
  //    no git call, anchor unchanged.
  if (kind === 'mutating') {
    return this.respondComposed(message, session, this.deps.composer.composeGitMutationNotSupported(message.context));
  }

  // 2. Anchor guard: WORKSPACE_APPLIED must carry the workspaceRef we read against (defensive).
  if (!anchor.workspaceRef) {
    return this.failComposed(message, session, this.deps.composer.composeGitPreviewUnavailable(message.context));
  }
  const rootPath = anchor.workspaceRef.rootPath;

  // 3. Read-only validation context (CA Q8 / Required Change #8) — resolve the last validation's command via
  //    the existing read-only commandExecutions.get. A missing/failed lookup NEVER fails the git preview:
  //    it degrades to 'unavailable'/'none' and the preview proceeds.
  const validation = await this.loadValidationContext(anchor); // {command,status} | 'unavailable' | 'none'

  // 4. Read-only Git call (CA Constraint 1/2, Q10 / Required Change #2/#7). A throw → safe failure, NO
  //    CommandExecution/shell fallback, NO workspace re-resolution.
  try {
    // (CA Required Change #2) a diff preview needs BOTH: git.status (branch/clean + UNTRACKED paths, which
    // `git diff HEAD` does not include) AND git.diff (tracked staged/unstaged unified diff). Status is read
    // FIRST; if it throws, git.diff is NOT called (CA Required Change #7).
    if (kind === 'diff') {
      const status = await this.deps.git.status(rootPath);
      const diff = await this.deps.git.diff(rootPath);
      return this.respondComposed(message, session, this.deps.composer.composeGitDiffPreview(message.context, { status, diff, validation }));
    }
    const status = await this.deps.git.status(rootPath);
    return this.respondComposed(message, session, this.deps.composer.composeGitStatusPreview(message.context, { status, validation }));
  } catch {
    this.logGitPreviewFailed(session, anchor, `git ${kind} read failed`);
    return this.failComposed(message, session, this.deps.composer.composeGitPreviewUnavailable(message.context));
  }
}

/** Read-only: resolve the last post-apply validation's command + status for display context (CA Q8). Uses
 *  the existing commandExecutions.get; never runs a command. A null result → 'none'; a THROW → 'unavailable'
 *  (CA Required Change #8: a validation-lookup failure must NOT fail the git preview). */
private async loadValidationContext(
  anchor: ApplyPreviewAnchor,
): Promise<{ command: string; status: string } | 'unavailable' | 'none'> {
  const ref = anchor.postApplyValidationRef;
  if (!ref) return 'none';
  try {
    const exec = await this.deps.commandExecutions.get(ref.id);
    if (!exec) return 'unavailable'; // ref present but record gone → "불러올 수 없어요", preview still proceeds
    return { command: [exec.command, ...exec.args].join(' '), status: exec.status };
  } catch {
    return 'unavailable';
  }
}

private logGitPreviewFailed(session: Session, anchor: ApplyPreviewAnchor, reason: string): void {
  this.deps.logger.warn('git preview failed', {
    reason, sessionId: session.id, executionPlanId: anchor.executionPlanRef.id,
  }); // deliberately NO diff text / file content / stderr
}
```
Everything is **RESPONDED** except a genuine git read failure (FAILED via `failComposed`). No re-anchor, no
mutation, no git write, no CommandExecution on any branch.

### 5.6 (reserved)

### 5.7 `ResponseComposer` — new methods (reuse budget helpers, read-only disclaimers)

All reuse `clampToMessageBudget`/`MAX_MESSAGE_CHARS` (1900, the existing chat budget — the final clamp). A
shared `ValidationContext = { command: string; status: string } | 'unavailable' | 'none'` param carries the
Q8 facts. **Every successful preview reply MUST include, verbatim (CA Required Change #10):** "읽기 전용 Git
미리보기", "git add/commit/push는 하지 않았어요.", "파일 수정은 하지 않았어요.", "명령 실행도 하지
않았어요." **CA Q9/Change #10 forbidden across all:** 커밋 준비 완료 / push 가능 / 배포 가능 / 안전함 /
검증 완료 / committed / pushed / ready to deploy / safe to commit / verified forever / 테스트 통과 상태 /
clean (unless Git reports clean). Layered bounds (Q6/Change #4): changed files ≤ 30; diff files displayed ≤ 5;
diff unified display ≤ 3000 chars **before** the final message clamp; final = existing composer budget;
adapter hard cap upstream (§5.8). **Any** truncation at any layer → a user-facing "일부만 보여드렸어요"/"외
N개" label.

```ts
/** Read-only git status preview (Sprint 2w, ADR-0044). Branch + changed files (staged/unstaged/untracked,
 *  ≤30, "외 N개" when capped). Clean → "현재 Git 기준 변경 파일이 없어요." (never infers tests passed /
 *  deploy). Includes the fixed read-only disclaimers (Change #10) + validation context. */
composeGitStatusPreview(context, input: { status: GitStatus; validation: ValidationContext }): OutboundMessage;

/** Read-only git diff preview (Sprint 2w, ADR-0044). Takes BOTH status and diff (Change #2): the unified
 *  diff shows TRACKED staged/unstaged changes only, and the reply states "diff는 추적 중인 파일 변경만
 *  포함해요. untracked 파일은 상태 목록에만 표시돼요." — untracked paths come from `status`, never as inline
 *  diff content. Bounded (≤5 files / ≤3000 chars, truncation labeled); binary files show a marker only
 *  (Change #3), never binary content. Same fixed disclaimers + validation context. */
composeGitDiffPreview(context, input: { status: GitStatus; diff: GitDiff; validation: ValidationContext }): OutboundMessage;

/** A git MUTATION phrase (커밋/푸시/add/reset/…, or any English `commit`) on the post-apply path (CA Q4) —
 *  read-only reminder; no git ran. States only status/diff preview is available; git changes need a separate
 *  future step. */
composeGitMutationNotSupported(context): OutboundMessage;

/** Git read failed / not a repository (CA Q10) — safe failure; no CommandExecution/shell fallback implied. */
composeGitPreviewUnavailable(context): OutboundMessage;
```
Validation-context wording (Q8/Change #8): `'none'` → "검증 기록 없음"; `'unavailable'` → "최근 검증 기록을
불러올 수 없어요."; else "최근 검증 기록: {command} {status} (이번에 다시 실행하진 않았어요)" — never asserts
current validity.

### 5.8 Minimal read-only Git **diff** extension (CA Q2 — smallest safe read-only extension)

No read-only diff method exists (§2). **CA APPROVED — include the smallest read-only diff surface**, under the
required restrictions (CA Required Changes #1/#3):
```ts
// domain/git.ts (Sprint 2w, ADR-0044) — read-only diff view; NOT persisted, no Ref, no storage.
export interface GitDiff {
  /** Changed TRACKED file paths (from `--name-only`), bounded-safe (NOT parsed from unbounded raw diff). */
  files: string[];
  /** Unified diff of TRACKED staged/unstaged changes only — untracked file CONTENTS are NOT included
   *  (`git diff HEAD` excludes them); untracked paths are surfaced via GitStatus (CA Required Change #2).
   *  Size-bounded by the adapter's hard cap. Binary files appear as a marker line only, never binary
   *  content (CA Required Change #3). */
  unified: string;
  /** True when the adapter dropped hunks/files to fit its hard cap. */
  truncated: boolean;
}

// ports/git-provider.port.ts — read-only, extends the existing read-only contract (still no mutation).
diff(rootPath: string): Promise<GitDiff>;

// git-local: LocalGitProvider.diff — READ-ONLY, argument-array only (never a shell string, never shell:true,
//   never user-provided args/pathspec), same GIT_TIMEOUT_MS + sanitizeGitStderr discipline as status/info:
//   files:   git --no-pager diff --no-ext-diff --no-color --name-only HEAD      (bounded-safe file list)
//   unified: git --no-pager diff --no-ext-diff --no-color HEAD                  (tracked diff; binary → marker)
//   unborn HEAD (no commits) fallback: the same two commands WITHOUT `HEAD`
//     (git --no-pager diff --no-ext-diff --no-color [--name-only])
//   The adapter applies a HARD safety cap to `unified` before returning (e.g. 20 000 chars) and sets
//   `truncated`; git's own binary-file line ("Binary files ... differ") is kept as-is (marker only). Never
//   runs add/commit/push/reset/checkout/stash/branch/merge/rebase/tag. GitManager.diff is a passthrough.
```
Rationale for the flags: `--no-ext-diff` (never invoke a user-configured external diff tool), `--no-color`
(no ANSI codes), `--no-pager` (no pager). All read-only. The **display** bounds (≤5 files, ≤3000 chars) +
truncation label are applied by `composeGitDiffPreview` (reusing the composer's truncation discipline); the
adapter's hard cap is the upstream backstop. This is read-only only; no aggregate/Ref/storage; the ADR-0023
mutation boundary is unchanged (extended read-only per ADR-0044).

### 5.9 `app.module.ts` — inject the already-registered GitManager

The `ConversationRuntime` factory gains `git: GitManager` in its params + `inject` array (the provider
already exists, `app.module.ts:178-179`), and passes `git: gitManager`. No new provider registration; one new
import/inject entry (unlike Sprint 2v's `command`, `GitManager` is not yet injected into the runtime).

## 6. Required Architecture Questions — answers for CA review

**Q1. Current Git capability API?** Documented from source in §2: `GitManager.isRepository/info/status/
isClean/requireClean` — all read-only; `GitProvider.isRepository/info/status`; `GitStatus {clean, branch,
staged[], unstaged[], untracked[], ahead?/behind?/isDetached?/hasUnmergedPaths?}`; `RepositoryInfo
{isRepository, rootPath, branch, headSha?, detached}` (no remote URLs); takes plain `rootPath`;
`LocalGitProvider` runs read-only subcommands via argument-array `spawnSync` (5 s timeout, masked stderr);
**no Git aggregate/Ref, no storage.** Methods are read-only; none mutate.

**Q2. What read-only git operations already exist? (APPROVED WITH CHANGE)** **status** = `GitManager.status`
(`git status --porcelain=v1 -b` → `GitStatus`; changed files = staged/unstaged/untracked). **info** =
`GitManager.info`. **No `diff` method exists.** **CA APPROVED** the minimal read-only extension
(`GitProvider.diff`/`GitManager.diff` + `GitDiff`, §5.8) — argv-only read-only `git diff` (`--no-pager
--no-ext-diff --no-color [--name-only] HEAD`), tracked-changes only, binary→marker, hard-capped; stays inside
the Git capability with **no mutation and no persistence**. (Plan-only: specified, not implemented here.)

**Q3. Require WORKSPACE_APPLIED?** Yes for the post-apply git preview — the branch only fires on a
`WORKSPACE_APPLIED` anchor. With no such anchor, neither git detector is consulted and **no broad general git
handling is created**; the message falls through unchanged.

**Q4. Trigger? (APPROVED WITH CHANGE)** `interpretGitPreviewIntent` (§5.4): mutating git phrases →
`'mutating'` (reject, **checked FIRST — precedence over diff/status**, CA #6); `diff`/`디프` → `'diff'`;
`git 상태`/`깃 상태`/`변경 파일`/`변경사항`/`바뀐 파일`/`커밋 전` → `'status'`; else null.
"좋아"/"오케이"/"확인"/"다음 단계 진행"/"계속 진행"/"검증됐네" → null. **Korean** "커밋 전에 변경사항
요약해줘" is a status phrase (커밋 without an action verb, CA-approved). **English `commit` stays conservative
(CA #5):** any `commit` token → mutating ("commit this"/"before commit show changes" → unsupported, no git
read). Mutating examples rejected with no git read: "커밋해줘"/"push 해줘"/"git add 해줘"/"git reset
해줘"/"stash 해줘"/"diff 보고 커밋해줘".

**Q5. What workspace?** `anchor.workspaceRef.rootPath` — never re-resolved on this path.

**Q6. How is output bounded? (APPROVED WITH CHANGE)** Layered (CA #4): changed files ≤ 30 (labeled "외 N개");
diff files displayed ≤ 5 (labeled); diff unified display ≤ 3000 chars **before** the final clamp (labeled);
final = existing `MAX_MESSAGE_CHARS` (1900) `clampToMessageBudget` (the stricter existing chat invariant, not
the CA's suggested 4500 — documented); adapter hard cap upstream (§5.8). **Any** truncation at **any** layer
→ a user-facing truncation label. Git capability has no built-in truncation, so bounding lives in the
composer + the adapter cap.

**Q7. Anchor the result?** No — **no new state, no `GIT_PREVIEWED`, no persisted field.** There is no
`GitStatusRef`/`GitDiffRef` type and no git storage; a read-only view is transient (CA Q7).

**Q8. Validation context? (APPROVED WITH CHANGE)** If `anchor.postApplyValidationRef` exists, resolve it
read-only via `commandExecutions.get(ref.id)` → "최근 검증 기록: {command} {status} (이번에 다시 실행하진
않았어요)" (never claims current validity). **A missing/failed lookup NEVER fails the git preview (CA #8):**
`get` → null or throw → the preview still proceeds with "최근 검증 기록을 불러올 수 없어요." (`'unavailable'`);
no `postApplyValidationRef` at all → "검증 기록 없음" (`'none'`). No validation is ever re-run; no
CommandExecution.

**Q9. Wording? (APPROVED WITH CHANGE)** `ResponseComposer` (§5.7). Every successful preview MUST include
(CA #10): "읽기 전용 Git 미리보기", "git add/commit/push는 하지 않았어요.", "파일 수정은 하지 않았어요.",
"명령 실행도 하지 않았어요." "현재 Git 기준 변경 파일이 없어요." only when Git reports clean; never infers
tests passed / deploy-ready. Forbidden: 커밋 준비 완료 / push 가능 / 배포 가능 / 안전함 / 검증 완료 / 테스트
통과 상태 / committed / pushed / ready to deploy / safe to commit / verified forever / clean beyond Git's
report.

**Q10. Git read fails? (APPROVED WITH CHANGE)** Caught → `composeGitPreviewUnavailable` (safe failure); **no
mutation, no CommandExecution fallback, no shell, no workspace re-resolution**; failure logged without
content. **For a diff preview, `git.status` is read first; if it throws, `git.diff` is NOT called** (CA #7).

**Q11. Does ExecutionOrchestrator change?** **No.** The handler calls `deps.git.status`/`deps.git.diff`
directly (as Sprint 2q–2v call their capabilities directly). No new `ExecutionStage`; not called on this path.

**Q12. Prove no hidden side effects? (APPROVED WITH CHANGE)** Tests (§8): `git.status`/`git.diff` called only
on a valid `WORKSPACE_APPLIED` + explicit git-preview turn (never on mutating/other paths); no git
**mutating** method exists on the dep and none is called; `command.run` 0, `workspaceWrite.apply` 0,
`patch.generate` 0, `patch.get` 0, `codeGeneration.generate` 0, `orchestrator.run`/`.resume` 0; no shell; no
automatic preview after apply/validation; the read uses `anchor.workspaceRef.rootPath`. **Added per CA #12:**
no re-anchor on git preview (`applyPreviewFlow.anchor` 0); a validation-lookup failure does NOT fail the
preview; on a diff preview a `git.status` failure prevents the `git.diff` call; a mutating+preview phrase
rejects before ANY git read.

## 7. Case matrix

| Case | Detection | Result |
|---|---|---|
| 1. WORKSPACE_APPLIED + "git 상태 보여줘"/"깃 상태 보여줘"/"변경 파일 보여줘"/"변경사항 보여줘"/"커밋 전에 변경사항 요약해줘" | `status` | `git.status(anchor.workspaceRef.rootPath)` → `composeGitStatusPreview` (RESPONDED) |
| 2. WORKSPACE_APPLIED + "diff 보여줘"/"git diff 보여줘" | `diff` | `git.status` THEN `git.diff` (CA #2) → `composeGitDiffPreview` (bounded; untracked via status; binary→marker), RESPONDED |
| 3. WORKSPACE_APPLIED + "커밋해줘"/"push 해줘"/"git add 해줘"/"git reset 해줘"/"stash 해줘" | `mutating` | `composeGitMutationNotSupported` (RESPONDED), **no git call** |
| 3b. mutating + preview word ("diff 보고 커밋해줘", "커밋해줘 변경사항") | `mutating` (checked first, CA #6) | rejected, **no git call** |
| 3c. English `commit` ("commit this"/"before commit show changes") | `mutating` (CA #5 conservative) | rejected, **no git read** |
| 4. WORKSPACE_APPLIED + "좋아"/"오케이"/"확인"/"다음 단계 진행"/"계속 진행"/"검증됐네" | null | fall through; no git call |
| 5. Git reports clean | `status`, clean | "현재 Git 기준 변경 파일이 없어요." — no test-pass/deploy inference |
| 6. `postApplyValidationRef` resolves | any preview | "최근 검증 기록: pnpm test SUCCEEDED (이번에 다시 실행하진 않았어요)" |
| 6b. `postApplyValidationRef` present but `get` → null / throws | any preview | preview **still succeeds**; "최근 검증 기록을 불러올 수 없어요." (CA #8) |
| 7. `postApplyValidationRef` absent | any preview | "검증 기록 없음" |
| 8. `git.status` throws (not a repo / git missing / timeout) | caught | `composeGitPreviewUnavailable`; no CommandExecution/shell/re-resolve; logged |
| 8b. diff preview: `git.status` throws first | caught before diff | `git.diff` **not called** (CA #7); safe failure |
| 8c. diff preview: `git.diff` throws after status ok | caught | safe failure |
| 9. changed files > 30 / diff > 5 files / diff > 3000 chars | layered bounds (CA #4) | truncated + labeled at each layer |
| 9b. binary file differs | adapter | binary marker only, **no binary content** (CA #3) |
| 9c. untracked files present | status+diff | untracked shown via **status**, never as inline diff; reply states so (CA #2) |
| 10. **No** WORKSPACE_APPLIED anchor + "git 상태 보여줘" | not the branch | fall through; **no** post-apply git preview, no general git handling (CA Q3) |
| 11. not automatic — apply success / validation success | routing | zero git call until an explicit git-preview turn |
| 12. any successful preview | render | never re-anchors (`applyPreviewFlow.anchor` not called, CA #9) |

## 8. Required Tests (Node 22) — the CA's full 51-item list

**`conversation-runtime.test.ts`** — status/diff calls (1–6): 1. WA + "git 상태 보여줘" → `git.status`.
2. "깃 상태 보여줘" → `git.status`. 3. "변경 파일 보여줘" → `git.status`. 4. "커밋 전에 변경사항 요약해줘" →
`git.status`. 5. "diff 보여줘" → `git.status` **and** `git.diff` (CA #2). 6. "git diff 보여줘" → `git.status`
**and** `git.diff`.

Negative / not-automatic (7–10): 7. "좋아"/"오케이"/"확인" → no git call. 8. "다음 단계 진행" → no git call.
9. a `handleWorkspaceApplyTurn` success (Sprint 2u) → **zero** git call. 10. a `handlePostApplyValidationTurn`
success (Sprint 2v) → **zero** git call.

Mutating rejection (11–16): 11. "커밋해줘" → no `git.status`/`git.diff`, `composeGitMutationNotSupported`.
12. "git add 해줘" → no git call. 13. "push 해줘" → no git call. 14. "git reset 해줘" → no git call.
15. mutating + diff word ("diff 보고 커밋해줘") → rejected, no git read (CA #6). 16. mutating + status word
("커밋해줘 변경사항 보여줘") → rejected, no git read.

Workspace / gating (17–19): 17. **no** WA anchor + "git 상태 보여줘" → no post-apply git preview.
18. `git.status`/`git.diff` receive `anchor.workspaceRef.rootPath`. 19. workspace **not** re-resolved
(`workspace.open` not called).

Bounds (20–23): 20. changed files > 30 → capped at 30 + count label. 21. diff files > 5 → capped + label.
22. diff text > display budget → truncated + label. 23. final message within the composer budget.

Validation context (24–27): 24. `postApplyValidationRef` resolves → reply includes command + status.
25. absent → "검증 기록 없음". 26. ref present but `commandExecutions.get` → null → preview **still succeeds**,
"불러올 수 없어요" (CA #8). 27. `get` throws → preview **still succeeds**, validation unknown.

Disclaimers (28–32): 28. reply says "읽기 전용 Git 미리보기". 29. reply says no git add/commit/push performed.
30. reply says no file mutation performed. 31. reply says no command execution performed. 32. reply does NOT
say ready to deploy / pushed / committed / safe to commit / verified forever.

Read failure (33–37): 33. `git.status` throws on a status preview → `composeGitPreviewUnavailable`.
34. diff preview: `git.status` throws first → `git.diff` **not called** (CA #7). 35. diff preview: `git.diff`
throws after status ok → safe failure. 36. read failure does **not** call CommandExecution. 37. read failure
does **not** call WorkspaceWrite.

No side effects / no re-anchor (38–47): 38. no `command.run`. 39. no `workspaceWrite.apply`. 40. no
`patch.generate`. 41. no `patch.get`. 42. no `codeGeneration.generate`. 43. no `orchestrator.run`/`.resume`.
44. no git **mutating** method (the `git` dep exposes only `status`/`diff`; structural). 45. no shell command
from the runtime. 46. git **status** preview does not re-anchor (`applyPreviewFlow.anchor` 0, CA #9). 47. git
**diff** preview does not re-anchor.

Adapter / diff semantics (48–49) — `git-local/src/index.test.ts`: 48. a binary-file diff shows the marker
only, **no binary content** (CA #3). 49. an oversized diff is truncated at the adapter hard cap and flagged;
untracked files appear in status/diff context but **not** as inline diff content (CA #2).

**`response-composer.test.ts`**: `composeGitStatusPreview` (branch + changed files ≤30 + "외 N개" label +
clean-case wording + the fixed read-only disclaimers + validation line; forbidden overclaim),
`composeGitDiffPreview` (takes status+diff; bounded diff ≤5 files/≤3000 chars + truncation label + untracked
note + binary marker + disclaimers), `composeGitMutationNotSupported` (read-only reminder, distinct),
`composeGitPreviewUnavailable` (safe failure, distinct) — all four distinct; the `'unavailable'`/`'none'`/
resolved validation-context wordings distinct.

**Node 22**: 50. `pnpm typecheck` green. 51. `pnpm test` green.

## 9. Architecture Impact / Reuse

- **Reuses, unchanged:** `GitManager.status`/`GitProvider.status`/`GitStatus`/`RepositoryInfo` +
  `LocalGitProvider` status path (CAP-002, ADR-0023 — read-only, zero change), the Sprint 2u
  `WORKSPACE_APPLIED` anchor + `workspaceRef`, the Sprint 2v `postApplyValidationRef` (read via the existing
  `commandExecutions.get`), the `ResponseComposer` message-budget helpers, `StatelessApplyPreviewFlow` (no
  change — anchor untouched).
- **Changes:** `conversation-runtime.ts` (+`git` dep, +`interpretGitPreviewIntent` + word-sets, +1 routing
  branch, +`handleGitPreviewTurn` + `loadValidationContext` + `logGitPreviewFailed`), `response-composer.ts`
  (+4 methods, reusing helpers), `app.module.ts` (+`GitManager` inject/passthrough — reuse, no new provider).
  **Read-only Git extension (CA APPROVED):** `domain/git.ts` (+`GitDiff`), `ports/git-provider.port.ts`
  (+read-only `diff`), `git-local` (+`LocalGitProvider.diff` read-only, argv-only adapter + tests).
- **No new** aggregate / repository / migration / capability / anchor status/field. **No** `Core` behavior
  change beyond a **read-only** `GitProvider` method. **No** `ExecutionOrchestrator` change or call. **No git
  mutation.** CommandExecution/WorkspaceWrite/Patch untouched and uncalled on this path.
- **ADR-0044** (to be authored before implementation) must document, per CA-required content:
  - Sprint 2w is explicit **read-only** post-apply git preview only; Git capability is the only thing that
    touches git; the runtime never shells out; CommandExecution/WorkspaceWrite are not used; **git mutation
    is forbidden**.
  - Allowed git operations: **status and read-only diff only**; the read-only `diff` extension is approved as
    the minimal Git-capability extension (argv-only `git --no-pager diff --no-ext-diff --no-color
    [--name-only] HEAD`; unborn-HEAD fallback; binary→marker; hard cap; untracked contents NOT included).
  - `WORKSPACE_APPLIED` anchor required; **no broad general git command handling**; `postApplyValidationRef`
    is optional **context only** (never current validity); a validation-lookup failure does not fail the
    preview.
  - **No `GIT_PREVIEWED` state, no git-preview persistence, no re-anchor.**
  - Mutating git phrases are rejected; **mutating has precedence over status/diff**; Korean "커밋 전에
    변경사항 요약" is status; **English `commit` stays conservative** (→ mutating).
  - Output is **bounded and truncation-labeled** (layered: files ≤30, diff files ≤5, diff ≤3000 chars,
    composer budget, adapter cap); **untracked-file diff content is not included** (surfaced via status).
  - Git read failure has **no CommandExecution/shell fallback and no workspace re-resolution**; on a diff
    preview a status failure prevents the diff call.
  - **No clean-tree/deploy/commit overclaim**; every preview states read-only + no add/commit/push + no file
    mutation + no command execution. Git mutation remains a separate future sprint.

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A mutating git phrase runs / routes to preview | High (safety) | `GIT_MUTATING` checked FIRST → `'mutating'` reject (precedence, CA #6); the `git` dep exposes only `status`/`diff` (no mutating method); adapter runs only read-only subcommands (§5.4/§5.8) — tested (§8 11–16, 44) |
| "커밋 전에 변경사항 요약" misread as a commit, or English "commit before…" mislabeled | Med | Korean 커밋 counts as a command only with an action verb → "커밋 전" is status; English `commit` stays conservative → mutating (CA #5, §5.4) — tested (§8 4, 15–16, case 3c) |
| Runtime shells out to git / uses CommandExecution for git | High (arch) | git runs only via the `git` dep (GitManager → argv-only adapter); read failure never falls back to CommandExecution/shell/re-resolve (§5.3/§5.5, CA Constraint 1/Q10/#7) — tested (§8 36–37) |
| Diff omits untracked files silently / dumps binary content | Med | diff preview calls status too (untracked via status); reply states diff = tracked only; binary → marker only, no content (CA #2/#3, §5.7/§5.8) — tested (§8 48–49) |
| Oversized status/diff floods chat | Med | layered bounds (files ≤30, diff ≤5 files/≤3000 chars, composer budget, adapter cap), truncation labeled at each layer (CA #4, §5.7/§5.8/Q6) — tested (§8 20–23) |
| Overclaim (safe to commit / clean / deployed) | Med (Product) | fixed read-only disclaimers on every preview; clean-wording only when Git reports clean; validation shown as record-only; forbidden-word discipline (CA #10/Q9, §5.7) — tested (§8 28–32) |
| Validation lookup failure blocks the preview | Med | `loadValidationContext` catches null/throw → `'unavailable'`; the preview always proceeds (CA #8, §5.5) — tested (§8 26–27) |
| Auto-running git after apply/validation | Med (Product) | explicit-phrase gate; apply/validation success runs zero git (§5.4) — tested (§8 9–10) |
| Adding state for a read-only view / re-anchoring | Low | no `GIT_PREVIEWED`, no persisted ref, no re-anchor on preview (CA #9, §5.1/Q7) — tested (§8 46–47) |
| Breaking existing flows / creating broad git handling | Med | gated on WORKSPACE_APPLIED + git-preview intent; no anchor → fall through, no general git flow (§5.4, Q3) — tested (§8 17) |
| Diff extension widening the write surface | Low | `diff` is read-only `git diff` only (argv-only, `--no-ext-diff`); port stays read-only; ADR-0023 mutation boundary unchanged (CA #1, §5.8) |

## Next Step

Plan-only (this document). Per the approved sequence: (1) this plan → **Chief Architect Review** (including
the §5.8 decision: include the read-only diff extension vs. status-only); (2) on approval, author ADR-0044;
(3) implement exactly the approved scope (§3/§5) on a `v2/<topic>` branch; (4) add/update tests per §8;
(5) validate on **Node 22**; (6) open a PR for Chief Architect Implementation Review. **Stop here** — no
implementation, branch, commit, or PR until the plan is approved.
