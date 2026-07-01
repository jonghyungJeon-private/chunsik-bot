# Sprint 2r Plan — Unified Diff Preview (still preview, no Patch/Write)

- **Status:** ✅ APPROVED WITH CHANGES (Chief Architect Review, Round 1) — required changes applied
  below; implementing this scope next.
- **Base:** `main` @ `f0b9d7e` · **Validation runtime:** Node 22 (to be run at implementation time).
- **Directed by:** Chief Architect (this sprint's topic is CA-assigned, not Claude-proposed).
- **Goal:** Render Sprint 2q's AI code-change proposal as a **unified-diff-style** preview — current
  workspace file content vs. the AI's proposed content — instead of a plain excerpt of the proposed
  text alone. Still preview only: no `Patch`, no `WorkspaceWrite`, no `CommandExecution`, no file
  mutation, no `ExecutionOrchestrator` change.
- **Phase:** Phase 2 — Product Construction (eighth runtime sprint, after 2k/2l/2m/2n/2o/2p/2q). **Not**
  a new capability. Reuses `WorkspaceManager.diff()` — already built, already used by
  `ExecutionOrchestrator`'s `WORKSPACE_DIFF` stage (CAP-001, ADR-0022) — for a purpose it was never
  wired into: a `planningOnly` post-approval preview.
- **Process:** V2 architecture-first, step 1 (plan-only) → CA review Round 1 complete → applying
  required changes → implementation next. No implementation, no branch, no commit, no PR in this step.

> **Framing.** ADR-0038's own Consequences section already named this sprint: *"No unified-diff-style
> preview against current file content this sprint (would require a `WorkspaceManager.diff` read) —
> deferred as a low-risk future enhancement, not a limitation of the chosen design."* The survey
> confirmed that read already exists, in exactly the shape this sprint needs, and is already wired to
> the same `ProposedChange[]` type `CodeGenerationManager` produces. CA Round 1 confirmed the direction
> and the reuse strategy, and required eight changes — all applied below — mostly around treating
> anything less than a clean, complete diff as a failure rather than a degraded success, and making the
> rendered text survive its own length limits without losing the "not applied" safety wording.

---

## 1. Objective

After Sprint 2q's `runCodeGenerationPreview` filters the AI's proposal down to in-scope changes (path
normalizes to a validated `targetFiles` entry), instead of rendering each change as a bare excerpt of
the *proposed* content, compute a real unified diff — **current workspace file content → proposed
content** — via the existing `WorkspaceManager.diff()` read, and render that as the preview. The diff is
never treated as a `PatchSet`; it is display-only, computed on every turn, and discarded once the reply
is sent. **CA Round 1:** anything that isn't a clean, complete diff of every in-scope file (a missing
current file, a read failure, an empty result) is reported as a failed preview, never as a partial or
degraded success.

## 2. The central architecture finding — the read this sprint needs already exists

**Finding: `WorkspaceManager.diff(ref: WorkspaceRef, changes: ProposedChange[]): Promise<WorkspaceDiff>`
already exists (`packages/core/src/application/workspace-manager.ts:60-62`), and its provider
implementation already produces a real, deterministic unified diff. CA Round 1: confirmed, approved
without change.**

- `WorkspaceManager.diff()` delegates to `WorkspaceProvider.diff()`
  (`packages/core/src/ports.ts`); the shipped implementation,
  `LocalCloneWorkspaceProvider.diff()` (`packages/workspace-local/src/index.ts:352-390`), already:
  - reads the current file (`readFileSync`) only if it exists, and classifies the change as
    `'add' | 'modify' | 'delete'` (`DiffChangeKind`);
  - computes the unified diff text with `createTwoFilesPatch` from the `diff` npm package (already a
    dependency of `@chunsik/workspace-local`) — **not** the AI, **not** a provider;
  - skips (and flags) binary content or content over the size guard, setting `binary`/`truncated`
    rather than fabricating a diff;
  - returns `WorkspaceDiff { refId, files: FileDiff[], estimatedChangedLines, truncated }`, where each
    `FileDiff` already carries `{ path, changeKind, unified, binary, oldSize?, newSize? }`
    (`packages/core/src/domain/workspace.ts:54-85`).
- This is **exactly** the ADR-0022 "read-only diff of a proposed change set against the current
  workspace contents... the pre-Approval representation the future Write slice routes through the
  approval gate" — already load-bearing for `ExecutionOrchestrator`'s `WORKSPACE_DIFF` stage
  (`execution-orchestrator.ts:244-251`, `:323-327`), which calls
  `this.deps.workspace.diff(request.workspaceRef, changes)` on exactly a `ProposedChange[]`.
- `ConversationRuntime` already holds a `WorkspaceManager` instance as `this.deps.workspace` (used today
  for `.open()`/`.list()`/`.prepare()`, Sprint 2o/2p). **The real object passed into
  `ConversationRuntimeDeps.workspace` at `app.module.ts:368` is the full `WorkspaceManager` — `.diff()` is
  already callable on it at runtime.** The only gap is that `ConversationRuntimeDeps`'s `workspace`
  *sub-interface* (the narrow structural type `conversation-runtime.ts:157-162` declares) doesn't
  currently list `diff` — a type-level omission, not a missing capability.

**Consequence for scope: no new capability, no new port, no new DI wiring in `app.module.ts`.** Adding
`diff` to the `workspace` field's declared type in `ConversationRuntimeDeps` is the entire "hookup" — the
already-injected `WorkspaceManager` instance satisfies the widened interface with zero code change at
the wiring site.

**Why `ConversationRuntime` calls `WorkspaceManager.diff()` directly, not through `ExecutionOrchestrator`
(same reasoning as ADR-0038 Q4/§2):** `planningOnly`'s `selectStages()` produces `[PLANNING, APPROVAL]`
only (ADR-0035) — it never includes `WORKSPACE_DIFF`, for the same reason it never includes
`CODE_GENERATION`. Forcing this sprint's diff through the Orchestrator would require a resume-only stage
override, which ADR-0038 already rejected for the identical shape of problem. `ConversationRuntime` is
already the direct composer of `CodeGenerationManager` (Sprint 2q) and `WorkspaceManager.list/open`
(Sprint 2o/2p) outside the Orchestrator — calling `WorkspaceManager.diff()` directly is the same
established composition pattern, a third time, not a new one.

## 3. Scope (this sprint)

- `ConversationRuntimeDeps.workspace` gains one additional declared method, `diff` (§5.1) — the
  underlying `WorkspaceManager` instance already implements it; this is a type-only addition, not a new
  dependency or provider.
- `runCodeGenerationPreview` (Sprint 2q, `conversation-runtime.ts`) is extended: after filtering the
  proposal to in-scope changes, if at least one survives, call `this.deps.workspace.diff(workspaceRef,
  inScopeChanges)`. **CA Round 1 Required Change #1/#3:** the result is checked for two failure
  conditions — `diff.files.length === 0` (an impossible-but-guarded case) and any file with
  `changeKind === 'add'` (a validated `targetFiles` entry whose current content could not be found at
  diff time) — **before** building the success DTO. Either condition routes to the existing
  `composeCodeGenerationPreviewFailed` reply, never a partial success (§5.2).
- The existing in-scope/out-of-scope filtering step (Sprint 2q's `toCodeChangePreview`) is refactored to
  expose the filtered `ProposedChange[]` (not only the rendering-shaped `CodeChangePreview`), so both the
  old text-excerpt path and the new diff path can share one filtering implementation (§5.2). **CA Round
  1 Required Change #6:** the extraction must preserve each `ProposedChange`'s `delete`/`newContent`
  shape exactly as given — no reconstruction that could default a field the original didn't have. No
  change to `toCodeChangePreview`'s existing exported signature or behavior — existing Sprint 2q tests
  keep passing unmodified.
- One new `ResponseComposer` DTO, `CodeDiffPreview`, and one new method, `composeCodeDiffPreview` (§5.4).
  **CA Round 1 Required Change #2:** rendering is budget-aware — a lowered per-file cap plus a reserved
  footer budget guarantee the mandatory "not applied / not modified" wording survives even a huge diff,
  rather than relying on the existing defensive `clampToMessageBudget` alone. **CA Round 1 Required
  Change #4:** binary and size-skipped files render an explicit "diff를 표시할 수 없어요" style notice —
  never phrased as if a diff was shown.
- **The diff preview becomes the primary preview for a successful in-scope proposal, replacing Sprint
  2q's `composeCodeGenerationPreview` call in `runCodeGenerationPreview`'s success branch (§6 Q12).**
  Sprint 2q's `composeCodeGenerationPreview`/`CodeChangePreview`/`toCodeChangePreview` are **not
  deleted** — kept for compatibility and their own tests, per Chief Architect direction (**CA Round 1
  Required Change #7**), the same accepted "no longer reached from this call site" status ADR-0038
  already gave `composePlanningOnlyApproved`.
- A read failure branch: `workspace.diff()` throwing (e.g. a read error) is caught and reported through
  the **existing** `composeCodeGenerationPreviewFailed` reply (**CA Round 1 Required Change #8,
  confirmed as acceptable default**: no new failure-wording method — the required behavior is identical
  to Sprint 2q's existing generation-failure behavior: `FAILED`, "파일은 수정되지 않았어요", no mutation
  attempted).
- Tests for all of the above (§8), including the CA's 32 explicitly required test items.

## 4. Non-goals (explicit, per Chief Architect direction)

No implementation before plan approval · no branch/commit/PR beyond this plan-only step · Preview →
Apply · `Patch` generation · `Patch` application · `WorkspaceWrite` · file mutation · git mutation ·
`CommandExecution` · test execution after generation · autonomous agent loop · retry loop · multi-file
selection · directory/module scope · semantic repository search · repository indexing · AI target-file
guessing · provider-specific diff generation · `ExecutionOrchestrator` stage change · `Core` contract
change · a new `PatchSet` type · calling `PatchManager` · calling `WorkspaceWrite` · any filesystem write
· rendering a successful diff preview for a `changeKind: 'add'` file this sprint (CA Round 1 Required
Change #1). `planningOnly`'s meaning is **not** changed — no rename.

## 5. Design

### 5.1 `ConversationRuntimeDeps.workspace` — one additional declared method, zero new wiring

Today (`conversation-runtime.ts:157-162`):

```ts
readonly workspace: {
  prepare(task: Task): Promise<WorkspaceRef | undefined>;
  open(project: { id: Id; rootPath: string }): Promise<WorkspaceRef>;
  list(ref: WorkspaceRef, glob?: string): Promise<string[]>;
};
```

Changes to:

```ts
readonly workspace: {
  prepare(task: Task): Promise<WorkspaceRef | undefined>;
  open(project: { id: Id; rootPath: string }): Promise<WorkspaceRef>;
  list(ref: WorkspaceRef, glob?: string): Promise<string[]>;
  /** Reused for post-approval diff preview (Sprint 2r, ADR-0039) — not a new port/capability;
   *  the same read-only WorkspaceManager.diff() ExecutionOrchestrator's WORKSPACE_DIFF stage uses. */
  diff(ref: WorkspaceRef, changes: ProposedChange[]): Promise<WorkspaceDiff>;
};
```

**No `app.module.ts` change.** The object passed as `workspace` at `app.module.ts:368` is already the
full `WorkspaceManager` instance (injected at `app.module.ts:327`); it already implements `.diff()`
(§2). Widening the *declared* structural type is the only code change at this seam. **CA Round 1:**
confirmed, no wiring change required.

### 5.2 `runCodeGenerationPreview` — extended with a diff step, guarded against non-clean results

Today (Sprint 2q, `conversation-runtime.ts:411-431`):

```ts
const proposal = await this.deps.codeGeneration.getProposal(generation);
if (!proposal) { /* failComposed(...) */ }

const preview = toCodeChangePreview(proposal.proposal, targetFiles);
if (preview.changes.length === 0) { /* failComposed(..., composeCodeGenerationPreviewNoValidChange) */ }

const reply = this.deps.composer.composeCodeGenerationPreview(message.context, preview);
return this.respondComposed(message, session, reply, outcome);
```

Changes to:

```ts
const proposal = await this.deps.codeGeneration.getProposal(generation);
if (!proposal) { /* failComposed(...) — unchanged */ }

const { inScope, outOfScopeWarnings } = filterInScopeChanges(proposal.proposal, targetFiles);
if (inScope.length === 0) {
  return this.failComposed(
    message, session,
    this.deps.composer.composeCodeGenerationPreviewNoValidChange(message.context, outOfScopeWarnings),
    outcome,
  );
}

let diff: WorkspaceDiff;
try {
  diff = await this.deps.workspace.diff(request.workspaceRef, inScope);
} catch {
  // Read-only failure (e.g. current file unreadable) — same guaranteed non-mutation as every other
  // preview failure. Reuses the existing wording/status; no new failure composer method (§6 Q7/Q8,
  // CA Round 1 Required Change #8).
  return this.failComposed(
    message, session, this.deps.composer.composeCodeGenerationPreviewFailed(message.context), outcome,
  );
}

// CA Round 1 Required Change #3: an empty diff result cannot be presented as a successful preview —
// treat it the same as any other failed preview attempt, never as "nothing changed" success.
if (diff.files.length === 0) {
  return this.failComposed(
    message, session, this.deps.composer.composeCodeGenerationPreviewFailed(message.context), outcome,
  );
}

// CA Round 1 Required Change #1: targetFiles are Workspace-validated existing files (Sprint 2o) — a
// changeKind of 'add' for one of them means its current content could not be found/read at diff time.
// That is a failed preview attempt this sprint, never a successful "new file" diff.
if (diff.files.some((f) => f.changeKind === 'add')) {
  return this.failComposed(
    message, session, this.deps.composer.composeCodeGenerationPreviewFailed(message.context), outcome,
  );
}

const diffPreview = toCodeDiffPreview(diff, outOfScopeWarnings);
const reply = this.deps.composer.composeCodeDiffPreview(message.context, diffPreview);
return this.respondComposed(message, session, reply, outcome);
```

`filterInScopeChanges` is `toCodeChangePreview`'s existing normalized-matching loop, extracted so both
the diff path and the retained text-excerpt path share one filtering implementation. **CA Round 1
Required Change #6:** the extraction preserves each in-scope `ProposedChange`'s original shape via
object-spread + a single overridden field — it never reconstructs a new object that could default
`newContent`/`delete` differently from what the AI actually returned:

```ts
/** Shared in-scope/out-of-scope split (Sprint 2q's toCodeChangePreview, extracted for reuse in
 *  Sprint 2r's diff path). Comparison uses normalizeRelativePath exact-match — never a raw string
 *  compare — and callers must use the validated targetFiles value, never the AI's raw path.
 *
 *  CA Round 1 Required Change #6: spreads `change` and overrides only `path`, so `delete`/`newContent`
 *  survive exactly as the AI returned them — never reconstructed with a defaulted field the original
 *  proposal didn't carry (this project's tsconfig has exactOptionalPropertyTypes: false, but the spread
 *  form is correct regardless and needs no cast). */
export function filterInScopeChanges(
  proposal: ProposedChange[],
  targetFiles: string[],
): { inScope: ProposedChange[]; outOfScopeWarnings: string[] } {
  const normalizedTargets = new Map(targetFiles.map((p) => [normalizeRelativePath(p), p]));
  const inScope: ProposedChange[] = [];
  const outOfScopeWarnings: string[] = [];
  for (const change of proposal) {
    const validatedPath = normalizedTargets.get(normalizeRelativePath(change.path));
    if (!validatedPath) {
      outOfScopeWarnings.push(change.path);
      continue;
    }
    inScope.push({ ...change, path: validatedPath }); // validated value, never the AI's raw path
  }
  return { inScope, outOfScopeWarnings };
}

/** toCodeChangePreview (Sprint 2q) becomes a thin wrapper — signature/behavior unchanged. */
export function toCodeChangePreview(proposal: ProposedChange[], targetFiles: string[]): CodeChangePreview {
  const { inScope, outOfScopeWarnings } = filterInScopeChanges(proposal, targetFiles);
  const changes = inScope.map((c) => ({
    path: c.path,
    kind: c.delete ? ('delete' as const) : ('update' as const),
    ...(c.delete ? {} : { excerpt: c.newContent }),
  }));
  return { changes, outOfScopeWarnings };
}
```

`request.workspaceRef` is guaranteed present at this point — it is one of the three guards already
checked before any `generate()` call (§ADR-0038, unchanged).

### 5.3 `toCodeDiffPreview` — shaping a clean `WorkspaceDiff` into a display DTO

By the time `toCodeDiffPreview` runs, both guard checks in §5.2 have already passed — every `FileDiff`
in `diff.files` has `changeKind` `'modify'` or `'delete'`, never `'add'`, and the array is non-empty. Per
ADR-0032's invariant, `ConversationRuntime` does not compose user-facing text — it only shapes facts.
Bounding/truncation-notice wording belongs to `ResponseComposer` (§5.4), the same division Sprint 2q
already used. `toCodeDiffPreview` therefore passes through `WorkspaceDiff`'s **unclamped** unified text:

```ts
/** Shape an already-guarded WorkspaceManager.diff() result into the composer-facing DTO (Sprint 2r,
 *  ADR-0039). Pure data reshaping — no bounding/truncation-notice text here; ResponseComposer owns
 *  that (ADR-0032). Callers must have already rejected an empty `diff.files` and any `changeKind:
 *  'add'` entry (§5.2, CA Round 1 Required Changes #1/#3) before calling this. */
export function toCodeDiffPreview(diff: WorkspaceDiff, outOfScopeWarnings: string[]): CodeDiffPreview {
  const changes = diff.files.map((f) => ({
    path: f.path, // already the validated targetFiles value — it is what was passed into workspace.diff
    kind: f.changeKind === 'delete' ? ('delete' as const) : ('update' as const), // 'modify' → 'update'
    unified: f.unified, // '' when binary or size-skipped by the provider
    binary: f.binary,
  }));
  return { changes, outOfScopeWarnings };
}
```

`f.path` is safe to render directly (unlike Sprint 2q's raw AI path) because `workspace.diff()` was
called with `inScope`'s **already-validated** paths (§5.2) — the provider's `FileDiff.path` echoes back
exactly what it was given, never an AI-authored string.

### 5.4 `ResponseComposer` — one new DTO, one new method, budget-aware + backtick-safe rendering

```ts
/** Display-relevant shape of a unified-diff-style code-change preview (Sprint 2r, ADR-0039).
 *  Application-layer, not domain, not persisted. `unified`/`binary` come straight from a
 *  WorkspaceManager.diff() FileDiff — current-content-vs-proposed, never AI-authored diff text. Every
 *  entry's `kind` is 'update' | 'delete' — 'add' is rejected as a failure before this DTO is built
 *  (§5.2, CA Round 1 Required Change #1). */
export interface CodeDiffPreview {
  changes: Array<{ path: string; kind: 'update' | 'delete'; unified: string; binary: boolean }>;
  outOfScopeWarnings: string[];
}
```

**CA Round 1 Required Change #2 — the rendered message must preserve the "not applied"/"not modified"
wording even for a huge diff, not merely stay under `MAX_MESSAGE_CHARS`.** Two changes from the original
draft: the per-file cap is lowered (Option A), and the header/footer safety wording is **reserved**
budget the diff body must fit around, rather than being at the mercy of a single trailing
`clampToMessageBudget` call (Option B) — so a huge diff sheds *file blocks*, never the safety wording:

```ts
/** Per-file diff line/char caps before the reserved-budget assembly applies (Sprint 2r, ADR-0039) —
 *  independent of Sprint 2q's MAX_PREVIEW_EXCERPT_CHARS (different content shape). Lowered from an
 *  initial 2000 to 1000 (CA Round 1 Required Change #2) — a single file's diff must leave headroom for
 *  the header, footer, and other files' blocks within MAX_MESSAGE_CHARS. */
const MAX_DIFF_LINES_PER_FILE = 40;
const MAX_DIFF_CHARS_PER_FILE = 1000;
/** Fixed upper bound on the "N개 파일... 생략했어요" notice's length (N ≤ MAX_TARGET_CANDIDATES = 5, so
 *  always short) — reserved up front so the notice never has to compete for budget after the fact. */
const MAX_OMITTED_NOTICE_CHARS = 40;
/** Slack for line-join overhead across header/blocks/footer (CA Round 1 Required Change #2). */
const DIFF_BUDGET_MARGIN_CHARS = 20;

const DIFF_PREVIEW_HEADER =
  '코드 변경 제안을 diff로 보여드려요. 아직 실제로 적용되지 않았어요. 파일은 수정되지 않았어요.';
const DIFF_PREVIEW_FOOTER = '이 제안을 실제로 적용하는 기능은 아직 지원하지 않아요.';

/** Clamp one file's unified diff to a bounded number of lines, then chars; report whether either cap fired. */
function clampDiffText(unified: string): { text: string; truncated: boolean } {
  const lines = unified.split('\n');
  const lineTruncated = lines.length > MAX_DIFF_LINES_PER_FILE;
  let text = (lineTruncated ? lines.slice(0, MAX_DIFF_LINES_PER_FILE) : lines).join('\n');
  const charTruncated = text.length > MAX_DIFF_CHARS_PER_FILE;
  if (charTruncated) text = text.slice(0, MAX_DIFF_CHARS_PER_FILE);
  return { text, truncated: lineTruncated || charTruncated };
}

/**
 * Render one changed file's block. CA Round 1 Required Change #4: binary and size-skipped files must
 * say plainly that a diff could not be displayed — never phrased as if one was shown — and repeat that
 * the file was not modified.
 */
function renderDiffChange(c: CodeDiffPreview['changes'][number]): string {
  if (c.binary) return `- ${c.path}: 바이너리 파일이라 diff를 표시할 수 없어요. (파일은 수정되지 않았어요)`;
  if (!c.unified.trim()) {
    return `- ${c.path}: 내용이 너무 커서 diff를 표시할 수 없어요. (파일은 수정되지 않았어요)`;
  }
  const { text, truncated } = clampDiffText(c.unified);
  const fence = fenceFor(text);
  const label = c.kind === 'delete' ? `${c.path} (삭제 제안)` : c.path;
  const note = truncated ? '\n(diff가 길어서 일부만 보여드렸어요.)' : '';
  return `- ${label}\n${fence}diff\n${text}\n${fence}${note}`;
}
```

```ts
/**
 * A successful unified-diff-style code-change preview (Sprint 2r, ADR-0039). Supersedes
 * composeCodeGenerationPreview as the primary success rendering for runCodeGenerationPreview (§6
 * Q12) — that method is retained, unreached from this call site, same accepted status ADR-0038 gave
 * composePlanningOnlyApproved. Must repeat, not merely mention once, that nothing was applied.
 *
 * CA Round 1 Required Change #2: the header and footer (incl. the out-of-scope warning, if any, and a
 * bound on the "files omitted" notice) are reserved budget FIRST; only the remaining budget is spent on
 * file blocks, which are dropped (not truncated mid-block) once that budget is used up. This guarantees
 * the safety wording survives even when the diff content alone would have exceeded MAX_MESSAGE_CHARS —
 * the trailing clampToMessageBudget call below is now a defensive backstop, not the primary guarantee.
 */
composeCodeDiffPreview(context: ConversationContext, preview: CodeDiffPreview): OutboundMessage {
  const warning = renderOutOfScopeWarning(preview.outOfScopeWarnings);
  const footerLines = [...(warning ? [warning] : []), DIFF_PREVIEW_FOOTER];
  const footer = footerLines.join('\n');
  const reserved =
    DIFF_PREVIEW_HEADER.length + footer.length + MAX_OMITTED_NOTICE_CHARS + DIFF_BUDGET_MARGIN_CHARS;
  const bodyBudget = Math.max(0, MAX_MESSAGE_CHARS - reserved);

  const blocks: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const c of preview.changes) {
    const block = renderDiffChange(c);
    if (used + block.length > bodyBudget) {
      omitted++;
      continue;
    }
    used += block.length;
    blocks.push(block);
  }

  const lines = [DIFF_PREVIEW_HEADER, ...blocks];
  if (omitted > 0) lines.push(`(길이 제한으로 파일 ${omitted}개의 diff는 생략했어요.)`);
  lines.push(...footerLines);
  return { context, text: clampToMessageBudget(lines.join('\n')) };
}
```

Reused, unchanged: `fenceFor` (backtick-safety), `renderOutOfScopeWarning`, `clampToMessageBudget`/
`MAX_MESSAGE_CHARS`. `composeCodeGenerationPreviewFailed`/`composeCodeGenerationPreviewNoValidChange`
are reused as-is for this sprint's failure cases (§3) — no new failure-wording method (CA Round 1
Required Change #8).

### 5.5 `app.module.ts`

**No change.** Confirmed at §2/§5.1 — the injected `WorkspaceManager` already satisfies the widened
`workspace` dependency shape.

## 6. Required Architecture Questions — CA decisions

**Q1. Who owns current file content reading?**
**APPROVED.** `WorkspaceManager.diff()` (`workspace-manager.ts:60-62`) — already exists, already used by
`ExecutionOrchestrator`'s `WORKSPACE_DIFF` stage. No new read method proposed.

**Q2. Is a new capability required?**
**APPROVED.** No. Reuses the existing Workspace read boundary (`WorkspaceManager`/`WorkspaceProvider`,
CAP-001, ADR-0022) via `ConversationRuntime`'s existing Application-layer composition pattern (§2).

**Q3. Who computes the diff?**
**APPROVED WITH CLARIFICATION.** `WorkspaceProvider.diff()` computes it deterministically. Explicit
boundary: AI does not compute the diff; AI provider output is not accepted as a diff source; `Patch`
does not compute this preview; `WorkspaceWrite` does not participate. `ConversationRuntime` calls
`WorkspaceManager.diff()` directly.

**Q4. What input is allowed?**
**APPROVED.** `workspace.diff(workspaceRef, inScope)`, where `inScope` is `filterInScopeChanges`'s
output — `ProposedChange[]` whose every `path` already normalizes to a validated `targetFiles` entry
(§5.2). Forbidden inputs (AI-guessed paths, out-of-scope paths, directory/module scope, chat history,
provider-generated diff text) are structurally excluded: `filterInScopeChanges` runs before
`workspace.diff()` is ever called.

**Q5. How are paths validated?**
**APPROVED.** Same invariant as Sprint 2o/2p/2q: `validated targetFiles > AI-proposed paths`.
`filterInScopeChanges` normalizes and replaces the AI's raw path with the validated `targetFiles` value
before it is ever passed to `workspace.diff()`.

**Q6. How are delete proposals rendered?**
**APPROVED.** `ProposedChange.delete === true` → provider classifies `changeKind: 'delete'` and diffs
current content against empty content (`LocalCloneWorkspaceProvider.diff()`, unchanged) — a
full-removal unified diff. `toCodeDiffPreview` maps this to `kind: 'delete'`; `composeCodeDiffPreview`
labels it "(삭제 제안)". Still preview only — no deletion is applied, no `WorkspaceWrite`, no `Patch`.

**Q7. What happens if current file content cannot be read?**
**APPROVED WITH CHANGE.** `workspace.diff()` throwing is caught and reported via the existing
`composeCodeGenerationPreviewFailed` reply: `RuntimeTurnStatus.FAILED`, "파일은 수정되지 않았어요", no
`Patch`/`WorkspaceWrite`/`CommandExecution` ever attempted (§5.2). **Additionally (Required Change #1):**
a `changeKind: 'add'` result for a previously-validated target file is treated the same way — the file's
current content could not be found/read at diff time, so this sprint reports it as a failure rather than
a successful "new file" diff.

**Q8. What happens if the proposal is huge?**
**APPROVED WITH CHANGE.** Bounded at two independent layers, redesigned to be budget-aware
(§5.4): a lowered per-file cap (`MAX_DIFF_LINES_PER_FILE`=40, `MAX_DIFF_CHARS_PER_FILE`=1000), and a
**reserved footer/header budget** computed before any file block is rendered, so the mandatory
"not applied"/"not modified" wording and the out-of-scope warning always fit — file blocks are dropped
(with a bounded "N개 생략" notice) rather than the safety wording being at risk of truncation. The
trailing `clampToMessageBudget` call remains only as a defensive backstop (ADR-0034 pattern), not the
primary guarantee. The number of files is already bounded upstream by Sprint 2o's
`MAX_TARGET_CANDIDATES` (5).

**Q9. Where is user-facing text composed?**
**APPROVED.** `ResponseComposer.composeCodeDiffPreview` (§5.4) — bounding, truncation notices,
fence-safety, budget reservation, and the "not applied" wording all live there. `ConversationRuntime`/
`toCodeDiffPreview` pass an unclamped DTO of facts only (§5.3), matching ADR-0032's invariant.

**Q10. Does `ExecutionOrchestrator` change?**
**APPROVED.** No. `runCodeGenerationPreview` calls `this.deps.workspace.diff()` directly, exactly the
way it already calls `this.deps.codeGeneration.generate()`/`getProposal()` directly (Sprint 2q) — never
`deps.orchestrator.run`/`.resume` for this step. No `WORKSPACE_DIFF` preview stage, no resume-only stage
override, no `ExecutionOrchestrator` contract change.

**Q11. How do we prove no mutation?**
**APPROVED.** Test proof required (§8): `patch.generate`/`workspaceWrite.apply`/`command.run` call
counts stay `0` across the full approve-and-diff-preview sequence; structurally, only
`this.deps.workspace.diff` is called from the preview path — no `WorkspaceWrite`/`Patch`/`Command`/`Git`
dependency is reachable from it at all (the method has no reference to those deps). No `git` operation
is invoked anywhere in this path (unchanged from Sprint 2q).

**Q12. Does this replace Sprint 2q's text preview?**
**APPROVED.** Yes, for the successful in-scope proposal rendering. `runCodeGenerationPreview` now calls
`composeCodeDiffPreview` instead of `composeCodeGenerationPreview` on the success path (§5.2/§5.4).
`composeCodeGenerationPreview`/`CodeChangePreview`/`toCodeChangePreview` are kept, unmodified in
behavior, for compatibility and their existing tests — the same "retained but no longer reached from
this call site" status ADR-0038 already gave `composePlanningOnlyApproved`, applied a second time to a
different method (Required Change #7). All-out-of-scope, generation-failure, empty-diff, and
`changeKind: 'add'` cases are unchanged/added per §3 — only the **successful, ≥1-clean-in-scope-change**
case's rendering changes.

## 7. Case matrix

| Case | Detection | Result |
|---|---|---|
| 1. Update proposal, in-scope, current file exists | `workspace.diff` returns `changeKind: 'modify'`, non-empty `unified` | `composeCodeDiffPreview`, `RESPONDED`, diff excerpt shown |
| 2. Delete proposal, in-scope | `changeKind: 'delete'` | `composeCodeDiffPreview`, delete-style diff, "(삭제 제안)" label |
| 3. Add proposal (validated target's current file not found at diff time) | `changeKind: 'add'` present anywhere in `diff.files` | **`composeCodeGenerationPreviewFailed`, `FAILED`** (CA Round 1 Required Change #1 — no longer a success case) |
| 4. Binary current or proposed content | `FileDiff.binary === true` | `composeCodeDiffPreview`, "바이너리 파일이라 diff를 표시할 수 없어요" line, not-modified reaffirmed, no crash |
| 5. Oversized file (provider size guard) | `unified === ''`, `binary === false`, `WorkspaceDiff.truncated === true` | `composeCodeDiffPreview`, "내용이 너무 커서 diff를 표시할 수 없어요" line, no fabricated diff |
| 6. All proposed paths out of scope | `filterInScopeChanges` → `inScope.length === 0` | `composeCodeGenerationPreviewNoValidChange`, `FAILED` (unchanged from Sprint 2q); `workspace.diff` never called |
| 7. `workspace.diff()` throws | caught in `runCodeGenerationPreview` | `composeCodeGenerationPreviewFailed`, `FAILED`, no mutation attempted |
| 8. `workspace.diff()` returns zero files | `diff.files.length === 0` | **`composeCodeGenerationPreviewFailed`, `FAILED`** (CA Round 1 Required Change #3 — new guard) |
| 9. Huge diff | per-file cap + reserved-budget assembly fires | bounded excerpt(s) + "생략했어요" notice, safety wording still present, no message-limit overflow (CA Round 1 Required Change #2) |
| 10. Deny/cancel/reconstruct-fail/non-`planningOnly` | unchanged Sprint 2n–2q routing | never calls `workspace.diff` |

## 8. Required Tests (Node 22) — mapped to the CA's 32-item list

**`conversation-runtime.test.ts`**:
1. An update proposal for an in-scope path produces `composeCodeDiffPreview` with a unified diff built
   from fake current content + the proposal's `newContent`.
2. A delete proposal (`delete: true`) produces a delete-style diff (`changeKind: 'delete'` fed through).
3. The diff passed to the composer is exactly the fake `WorkspaceManager.diff()`'s returned `unified`
   text — never independently recomputed by `ConversationRuntime`.
4. The AI's raw provider-returned proposal text is never treated as diff source — only
   `WorkspaceManager.diff()`'s result is rendered.
5. `workspace.diff()` is called with only the **validated** `targetFiles` paths — an out-of-scope AI
   path in the raw proposal is never included in the `changes` argument passed to `workspace.diff()`.
6. An out-of-scope AI path is never read (the fake `workspace.diff()` receives only in-scope changes).
7. Out-of-scope proposed content is never rendered (appears only in the composer's warning input).
8. A proposal whose in-scope subset is empty → `workspace.diff` **never called**,
   `composeCodeGenerationPreviewNoValidChange`, `FAILED`.
9. `workspace.diff()` throwing → `composeCodeGenerationPreviewFailed`, `FAILED`, `executionOutcome`
   preserved when available.
10. `workspace.diff()` resolving with `{ files: [] }` → `composeCodeGenerationPreviewFailed`, `FAILED`
    (CA Round 1 Required Change #3 — new test).
11. `workspace.diff()` resolving with any file at `changeKind: 'add'` → `composeCodeGenerationPreviewFailed`,
    `FAILED`, never a successful diff preview (CA Round 1 Required Change #1 — new test).
17. A successful diff preview calls `composeCodeDiffPreview` exactly once.
18. A successful diff preview does **not** call `composeCodeGenerationPreview` (call count `0`).
19. Deny ("거절") never calls `workspace.diff`.
20. Cancel ("취소") never calls `workspace.diff`.
21. `reconstructResume` failure (re-ask path) never calls `workspace.diff`.
22. A non-`planningOnly` approval resume never calls `workspace.diff`.
23. `PatchManager`'s fake call count stays `0` across the full approve → diff-preview sequence.
24. `workspaceWrite.apply`'s fake call count stays `0`.
25. `command.run`'s fake call count stays `0`.
26. `ExecutionOrchestrator.run`/`.resume` call counts are unaffected by the new diff step (no additional
    Orchestrator calls from it).
27. A successful diff preview's `TurnResult.executionOutcome` equals the resume outcome.
28. A failed diff preview's `TurnResult.executionOutcome` equals the resume outcome when one is available.

**`response-composer.test.ts`** (new cases):
12. A `binary: true` change renders the "바이너리 파일이라 diff를 표시할 수 없어요" notice, never a code
    fence, and reaffirms the file was not modified (CA Round 1 Required Change #4).
13. A change with empty `unified` (size-skipped) renders "내용이 너무 커서 diff를 표시할 수 없어요" —
    never a fabricated/empty diff fence (CA Round 1 Required Change #4).
14. A diff exceeding `MAX_DIFF_LINES_PER_FILE`/`MAX_DIFF_CHARS_PER_FILE` is clamped and reports a
    per-file truncation notice.
15. A huge diff's rendered reply still contains the opening "파일은 수정되지 않았어요"/"아직 실제로
    적용되지 않았어요" wording **and** the closing "적용하는 기능은 아직 지원하지 않아요" wording, and
    stays within `MAX_MESSAGE_CHARS` (CA Round 1 Required Change #2 — proves the reserved-budget
    guarantee, not just the length cap).
16. A diff text containing a run of triple backticks does not break the rendered fence (reuses
    `fenceFor`, same guarantee as Sprint 2q's excerpt fence).

**Unit-level**:
29. `filterInScopeChanges` — a `delete: true` in-scope change survives filtering with `delete: true`
    intact (not defaulted/dropped); `workspace.diff` receives it unchanged except for the validated path
    (CA Round 1 Required Change #6 — new test).
30. `toCodeChangePreview` (Sprint 2q) — existing tests continue to pass unmodified against the
    refactored implementation (§5.2) — proves the extraction is behavior-preserving.
- `toCodeDiffPreview` — maps `FileDiff.changeKind` `'modify'` → `'update'`, `'delete'` → `'delete'`;
  passes `unified`/`binary` through unchanged; passes `outOfScopeWarnings` through unchanged.

31. `pnpm typecheck` green on **Node 22**.
32. `pnpm test` green on **Node 22**.

## 9. Architecture Impact / Reuse

- **Reuses, unchanged:** `WorkspaceManager.diff()`/`WorkspaceProvider.diff()` (CAP-001, ADR-0022, zero
  changes), `WorkspaceDiff`/`FileDiff`/`DiffChangeKind` domain types (zero changes), `CodeGenerationManager`
  (CAP-008, zero changes), `ExecutionOrchestrator`/`selectStages`/`run`/`resume` (zero changes),
  `normalizeRelativePath` (Sprint 2o, reused inside `filterInScopeChanges`), `fenceFor`/
  `renderOutOfScopeWarning`/`clampToMessageBudget`/`MAX_MESSAGE_CHARS` (Sprint 2q/2m, reused directly),
  `composeCodeGenerationPreviewFailed`/`composeCodeGenerationPreviewNoValidChange` (Sprint 2q, reused
  as-is for this sprint's failure cases — no new failure-wording method, CA Round 1 Required Change #8).
- **`composeCodeGenerationPreview`/`CodeChangePreview`/`toCodeChangePreview` (ADR-0038) are retained but
  no longer reached from `runCodeGenerationPreview`'s success branch** — the same accepted "unreached in
  production, not deleted, own tests still pass" status ADR-0038 already gave
  `composePlanningOnlyApproved` (CA Round 1 Required Change #7). Explicit, not an oversight.
- **Changes:** `conversation-runtime.ts` (`workspace` dep type gains `diff`; `toCodeChangePreview`
  refactored into a thin wrapper over new `filterInScopeChanges`; `runCodeGenerationPreview`'s success
  branch extended with a diff step plus two new guard checks — empty-files and `changeKind: 'add'`; one
  new exported helper `toCodeDiffPreview`), `response-composer.ts` (+1 DTO `CodeDiffPreview`, +1 method
  `composeCodeDiffPreview` with reserved-budget assembly, +3 small bounding/rendering helpers). **No
  change to `app.module.ts`** (§5.5).
- **No new** aggregate / repository / migration / capability / port. **No** `Core` or
  `ExecutionOrchestrator` contract change (§2/§6 Q10).
- **ADR-0039** (to be authored before implementation) must include, per CA Round 1:
  1. Sprint 2r is unified diff preview, still not Patch/Write.
  2. Reuses existing `WorkspaceManager.diff()`; no new capability/port/provider.
  3. `ConversationRuntime` calls `workspace.diff` directly after CodeGeneration proposal filtering;
     `ExecutionOrchestrator` remains unchanged; no new `ExecutionStage`; `planningOnly` remains
     Orchestrator-scoped.
  4. Validated `targetFiles` remains the only scope source; AI-proposed paths are untrusted;
     `filterInScopeChanges` normalizes against `targetFiles`; `workspace.diff` receives only validated
     paths; AI does not author the diff; provider AI output is not treated as diff source.
  5. `changeKind: 'add'` is treated as a failure for this sprint.
  6. Binary/oversized/empty diff rendering rules (explicit "diff를 표시할 수 없어요" wording).
  7. Diff rendering is budget-aware; required safety wording survives truncation.
  8. `composeCodeGenerationPreview` is retained but superseded by `composeCodeDiffPreview` for the
     success path.
  9. Failure returns `RuntimeTurnStatus.FAILED`.
  10. No `Patch`/`WorkspaceWrite`/`CommandExecution`/file mutation/git mutation; no `Core` contract
      change; no `ExecutionOrchestrator` contract change.

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A large diff exceeds Discord's message limit, or truncation cuts the safety wording | Low | Reserved header/footer budget computed before file blocks are rendered; file blocks are dropped, never the safety wording (§5.4/§6 Q8, CA Round 1 Required Change #2) — tested (§8 item 15) |
| Diff text containing backticks breaks the rendered fence | Low | Reuses `fenceFor`, same guarantee already proven for Sprint 2q excerpts (§8 item 16) |
| Binary or size-skipped files crash the renderer or read as if a diff was shown | Low | Explicit "diff를 표시할 수 없어요" wording, never a fabricated/empty fence (§5.4, CA Round 1 Required Change #4) — tested (§8 items 12-13) |
| A `changeKind: 'add'` result is presented as a successful "new file" preview when it actually signals a stale/missing target | Med (Product/Safety) | Treated as a failed preview this sprint (§5.2/§6 Q7, CA Round 1 Required Change #1) — tested (§8 item 11) |
| An empty `WorkspaceDiff.files` result is presented as a vacuous "successful" preview | Low | Explicit zero-files guard before building the success DTO (§5.2, CA Round 1 Required Change #3) — tested (§8 item 10) |
| Users read the diff preview as already applied | Med (Product) | Wording repeats "not applied"/"not modified" at open and close, same forbidden-word discipline as ADR-0038 |
| Confusing the retained-but-unreached `composeCodeGenerationPreview` with this sprint's new default | Low | Documented explicitly (§6 Q12, §9, CA Round 1 Required Change #7) — same accepted pattern already used once for `composePlanningOnlyApproved` |
| Reviewers expect this sprint to also cover Preview → Apply | Low | Explicitly out of scope (§4) — a future sprint requires its own plan + CA review, per Sprint 2q's Standing Notes |

## Next Step

**Plan changes applied — CA Round 1 requirements incorporated above.** Per the approved implementation
sequence: (1) plan changes applied (this document); (2) author ADR-0039 next; (3) implement exactly
this scope (§3/§5) on a `v2/<topic>` branch; (4) add/update tests per §8; (5) validate on **Node 22**;
(6) open a PR for Chief Architect Implementation Review. No commit/PR has been made yet — proceeding
to ADR-0039 + implementation now.
