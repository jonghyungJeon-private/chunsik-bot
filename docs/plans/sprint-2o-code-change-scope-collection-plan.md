# Sprint 2o Plan — Code Change Scope Collection (sufficient target scope before Approval)

- **Status:** ✅ APPROVED WITH CHANGES (Chief Architect Review, Round 1) — required changes applied
  below; implementing this scope next.
- **Base:** `main` @ `eb2a28f` · **Validation runtime:** Node 22 (to be run at implementation time).
- **Directed by:** Chief Architect (this sprint's topic is CA-assigned, not Claude-proposed).
- **Goal:** Before a code-change request is even allowed to reach `Planning`/`Approval`
  (Sprint 2n), determine whether the request names a sufficient target (a real, validated,
  Workspace-confirmed project-relative file). If not, ask the user to name one — and create **no**
  `ExecutionPlan`, call **no** `ExecutionOrchestrator.run`, until scope is sufficient.
- **Phase:** Phase 2 — Product Construction (fifth runtime sprint, after 2k/2l/2m/2n). **Not** a
  new capability/aggregate.
- **Process:** V2 architecture-first, step 1 (plan-only) → CA review Round 1 complete → applying
  required changes → implementation next. No implementation, no branch, no commit, no PR in this step.

> **Framing.** Sprint 2n opened `IMPLEMENT_CODE → planningOnly → Planning → Approval →
> AWAITING_APPROVAL`, but it never asks *what* to change — every code-change request today reaches
> the same halt regardless of whether the user named a file. This sprint inserts one gate **before**
> that path even starts: a real, workspace-validated target file, or a clarification question and a
> stop. It does not turn on AI generation, and it does not change what Sprint 2n already does once
> scope is sufficient — `planningOnly`, the `HIGH` risk, and the halt itself are all untouched.

---

## 1. Objective

Given a classified `IMPLEMENT_CODE` intent, decide — deterministically, before any Planning/Approval
work — whether the message names a target scope specific enough to act on. If yes, thread the
**Workspace-validated** path into the `ExecutionRequest` (already-existing `targetFiles` field) and
proceed exactly as Sprint 2n does today. If no, reply with a clarification question that asks for a
file path and instructs the user to re-send the full request with it — and stop: no `ExecutionPlan`,
no `ApprovalRequest`, no `ExecutionOrchestrator.run` at all.

## 2. The central finding (read this before the design)

**Almost everything this sprint needs already exists; the gap is narrow and specific.**

- `ExecutionRequest.targetFiles?: string[]` already exists (`execution-orchestrator.ts:90`) and
  `IntentResolver.resolve()` **already forwards** `context.targetFiles` verbatim into it
  (`intent-resolver.ts`: `...(context.targetFiles ? { targetFiles: context.targetFiles } : {})`).
  **`IntentResolver` needs zero changes.**
- The read-only Workspace capability (CAP-001, ADR-0022) already has exactly the validation primitive
  this sprint needs: `WorkspaceManager.list(ref, glob?)` → `LocalCloneWorkspaceProvider.listFiles`
  (`workspace-local/src/index.ts:329-349`), which walks the sandboxed tree via `resolveWithin`
  (`workspace-local/src/index.ts:69-84` — rejects absolute paths, `..` traversal, and symlink escapes)
  and filters through `DEFAULT_WORKSPACE_POLICY.isReadable` (excludes `node_modules`/`dist`/`build`/
  `.git`/`coverage` and secret-looking names, `workspace-local/src/index.ts:33,48-50,127-133`). A path
  that survives `list()` is **provably** inside the workspace, not secret, and not in an ignored
  directory — for free, with zero new security code. **This provider-level test already exists and is
  the authoritative proof** (`workspace-local/src/index.test.ts:147`, `'listFiles() returns relative
  files, excluding ignored dirs and secrets'`) — see §9 for how Sprint 2o reuses it rather than
  re-proving the same fact.
- **The actual gap:** `ConversationRuntime.handleExecutionIntent` (`conversation-runtime.ts:273-317`)
  never looks at the raw message text for a target file, never calls `workspace.list`, and always
  calls `intentResolver.resolve()` → `orchestrator.run()` regardless of whether a target was named.
  Sprint 2n's own test fixtures ("이 버그 고쳐줘", "배포해줘") never name a file — and the CA's own Case 1
  for this sprint uses that **exact same phrase** as the canonical "scope missing" example. **This is
  not a coincidence to route around; it is the sprint's whole point** — see §8 for what that means for
  Sprint 2n's existing tests.

## 3. Scope (this sprint)

- A new, small, pure Application-layer helper module — **`target-scope.ts`** — that (a) extracts
  candidate project-relative file paths from raw text, requiring a `/` in the candidate (CA Round 1),
  and (b) exposes a small path-normalization helper used to verify a `WorkspaceManager.list` hit is an
  **exact** match for the candidate, never a glob-semantics assumption (CA Round 1). No I/O, no class,
  no dependency, no capability, no port (§5.1).
- `ConversationRuntime.handleExecutionIntent` gains one new branch, gated strictly on
  `intent.capability === Capability.CODE_IMPLEMENTATION`, inserted **after** the existing
  workspace-resolution step and **before** `intentResolver.resolve()` is called: validate up to
  `MAX_TARGET_CANDIDATES = 5` candidates against the real workspace via the existing
  `WorkspaceManager.list`, requiring an exact-match hit; on the first validated hit, thread the
  **Workspace-returned path** (not the raw candidate) into `targetFiles`; on none, reply with a new
  clarification prompt and return **without** calling `resolve()`/`run()` (§5.2).
- `ConversationRuntimeDeps.workspace` gains one additive method in its narrow structural interface —
  `list(ref, glob?)` — already implemented on the real `WorkspaceManager` passed in from
  `app.module.ts` today; no DI wiring change, **not a new port** (§5.2, §6 Q7).
- One new `ResponseComposer` method — `composeTargetScopeClarification` — with CA-specified wording:
  asks for a file path first, does not present natural-language module text as sufficient, and tells
  the user to re-send the full request together with the path (no multi-turn memory this sprint, §5.3).
- Tests for all of the above, plus updates to Sprint 2n's existing `codeIntent` fixtures/tests that
  used a path-free message and asserted execution proceeded (§8 — this is expected, CA-specified
  churn, not a regression).

## 4. Non-goals (explicit, per Chief Architect direction)

No implementation before plan approval · no branch/commit/PR beyond this plan-only step · no AI Code
Generation · no `ProviderSelector` call · no Claude/Ollama/Codex invocation · no semantic search · no
repository indexing · no target-file guessing **by AI** · no directory scope · no natural-language
module/area text treated as sufficient target · no patch generation · no `WorkspaceWrite` · no command
execution · no autonomous agent loop · no retry · no Discord button UI · no new
aggregate/repository/migration/capability/port · no `Core` or `ExecutionOrchestrator` contract change
· no general-purpose execution-stage override system. `planningOnly` stays exactly as narrow as
ADR-0035 defined it; `CODE_IMPLEMENTATION` stays `HIGH`. **Additionally, by this plan's own design
(§7):** no multi-turn clarification-answer correlation/persistence mechanism — see §7 for why that is
forced by the non-goals, not an oversight.

## 5. Design

### 5.1 `target-scope.ts` — pure candidate extraction + exact-match normalization (new, small module)

Not a class, not a capability, not a domain service, not a port/adapter/repository — a pure-function
module in the same style as `code-proposal-parser.ts` (deterministic, no I/O, no DI, no Workspace
access, no AI). Lives in `packages/core/src/application/target-scope.ts`:

```ts
/**
 * Deterministic candidate project-relative file-path extraction from raw user text (Sprint 2o,
 * ADR-0036). Pure, synchronous, no I/O, no Workspace access — finds tokens that LOOK like a
 * project-relative file path (require a `/`, per CA Round 1 — rejects bare filenames, "Node.js",
 * "e.g.", "v1.2.3"), in order of appearance, filtering out anything absolute or containing a `..`
 * segment. A candidate here is NEVER trusted as sufficient scope on its own — the caller
 * (ConversationRuntime) must validate it exists in the real workspace via the existing read-only
 * Workspace capability (`WorkspaceManager.list`) before treating it as a target file (§5.2, Q6).
 * This module is a pure Application-layer parser helper — not a capability, not a domain service.
 */
export function extractTargetPathCandidates(text: string): string[] {
  const matches = text.match(/\b[\w][\w./-]*\.[a-zA-Z0-9]+\b/g) ?? [];
  const out: string[] = [];
  for (const m of matches) {
    if (!m.includes('/')) continue; // CA Round 1: require a path separator
    if (m.startsWith('/') || m.startsWith('.')) continue; // absolute or hidden/dot-relative
    if (m.split('/').includes('..')) continue; // traversal
    if (!out.includes(m)) out.push(m);
  }
  return out;
}

/** Normalize a project-relative path for exact-match comparison (CA Round 1) — strips a leading
 *  `./`, collapses duplicate slashes, drops a trailing slash. Never resolves `..` (a normalized
 *  path still containing `..` is not made safe by this function; extraction already rejects those). */
export function normalizeRelativePath(path: string): string {
  return path.replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
}
```

**Why `/` is now required in the candidate (CA Round 1, Required Change #4):** the earlier draft's
dot-extension-only rule accepted "Node.js", "e.g.", "v1.2.3", and bare root filenames like "foo.ts" as
candidates — harmless (Workspace validation is still the authoritative safety net, §6 Q6) but wasteful
(extra `workspace.list` calls for tokens that were never going to be a real target). Requiring `/`
rejects all of those at zero cost, while still accepting every realistic project path
(`packages/core/src/application/foo.ts`, `src/foo.ts`, `apps/chunsik/src/main.ts`). Root-relative bare
filenames (`foo.ts`, `README.md`) are **conservatively excluded this sprint** (CA's own call: the
complexity of distinguishing a real code target from an incidental root-doc mention needs its own
tests and is not needed now) — a future sprint can lift this if the product wants it.

### 5.2 `ConversationRuntime.handleExecutionIntent` — the new gate

Inserted between the existing workspace-resolution block (`conversation-runtime.ts:279-294`,
unchanged) and the existing `intentResolver.resolve()` call (`conversation-runtime.ts:296`, unchanged
in shape — only the object literal passed to it gains a conditional `targetFiles`):

```ts
/** Bound on how many extracted candidates trigger a workspace.list call per turn (CA Round 1,
 *  Required Change #9) — a chat message must never drive an unbounded number of workspace scans. */
const MAX_TARGET_CANDIDATES = 5;

// ADR-0036: a code-change request needs a validated target before it may reach Planning/Approval.
let targetFiles: string[] | undefined;
if (intent.capability === Capability.CODE_IMPLEMENTATION) {
  const candidates = extractTargetPathCandidates(message.text).slice(0, MAX_TARGET_CANDIDATES);
  for (const candidate of candidates) {
    const hits = await this.deps.workspace.list(workspaceRef!, candidate);
    // CA Round 1, Required Change #1/#2: never assume list()'s glob is exact-match — verify the
    // returned hit normalizes to the same path as the candidate, and use THAT hit as targetFiles,
    // never the raw candidate.
    const matched = hits.find((hit) => normalizeRelativePath(hit) === normalizeRelativePath(candidate));
    if (matched) {
      targetFiles = [matched];
      break;
    }
  }
  if (!targetFiles) {
    return this.respondComposed(
      message,
      session,
      this.deps.composer.composeTargetScopeClarification(message.context),
    );
  }
}

const request = this.deps.intentResolver.resolve(intent, {
  requestedBy: actor.id,
  ...(session.activeProjectId ? { projectId: session.activeProjectId } : {}),
  ...(workspaceRef ? { workspaceRef } : {}),
  ...(targetFiles ? { targetFiles } : {}),
});
```

`workspaceRef!` is safe here: `CODE_IMPLEMENTATION` is a `needsWorkspace` capability
(`conversation-runtime.ts:150-152`, unchanged), so by this point either `workspaceRef` is set or this
function already returned (no active project / workspace-open failure, both unchanged,
`conversation-runtime.ts:281-294`).

`workspace.list(ref, candidate)` reuses `listFiles`'s glob filter (`workspace-local/src/index.ts:348`)
— but per CA Round 1, this plan **does not rely on that filter's glob semantics being exact-match**.
The `matched = hits.find(...)` step is the actual sufficiency check: it treats `hits` as *candidate
hits to verify*, not as a pre-confirmed answer, and only trusts a hit whose normalized form equals the
normalized candidate. This means the implementation is correct even if `listFiles`'s glob matcher
later changes shape — the exactness guarantee lives in `target-scope.ts`'s `normalizeRelativePath`
comparison, not in an assumption about `matchGlob`. A non-empty, exactly-matching hit means the
candidate is a real **file** (`listFiles` only ever pushes `e.isFile()` entries,
`workspace-local/src/index.ts:344`) that passed the ignored-dir/secret filter. **No new Workspace
method, no new capability, no new port** (§6 Q7) — one call to something that already exists.

`ConversationRuntimeDeps.workspace`'s narrow interface (`conversation-runtime.ts:110-113`) gains:

```ts
readonly workspace: {
  prepare(task: Task): Promise<WorkspaceRef | undefined>;
  open(project: { id: Id; rootPath: string }): Promise<WorkspaceRef>;
  list(ref: WorkspaceRef, glob?: string): Promise<string[]>; // new — reuses WorkspaceManager.list
};
```

The real `WorkspaceManager` instance already implements `.list()` (`workspace-manager.ts:55-57`) and
is already the concrete object wired into `ConversationRuntime` in `app.module.ts` — **this is a
structural interface widening only; zero DI wiring change, and not a new port** (CA Round 1, Required
Change #8 — to be stated explicitly in ADR-0036).

### 5.3 `ResponseComposer` — one new method, CA-specified wording

The earlier draft's clarification text offered `"로그인 처리 부분"` as one of two equally-weighted
examples — but that phrase is, by this sprint's own design, **insufficient** scope. Presenting it
without qualification would lead a user to answer with exactly the kind of reply the bot will reject
again. CA Round 1 required (a) asking for a file path as the primary, sufficient ask; (b) framing
module/area text as optional additional context only, never as sufficient on its own; and (c)
instructing the user to **re-send the whole request** together with the path, since this sprint has no
memory of the original question (§7):

```ts
/**
 * Clarification prompt when a code-change request names no validated target file (Code Change
 * Scope Collection, ADR-0036). No ExecutionPlan/ApprovalRequest exists at this point — this is a
 * plain conversational reply, not an approval/waiting state. Wording is CA-specified (Round 1):
 * asks for a file path as the sufficient ask, frames natural-language scope as optional context
 * only, and tells the user to re-send the full request together with the path (no multi-turn
 * memory this sprint, §7).
 */
composeTargetScopeClarification(context: ConversationContext): OutboundMessage {
  return {
    context,
    text:
      '수정할 파일 경로와 함께 다시 요청해 주세요.\n' +
      '예: packages/core/src/application/foo.ts 파일에서 이 버그 고쳐줘\n\n' +
      '"로그인 처리 부분"처럼 설명만으로는 아직 부족해요. 어떤 부분을 고치려는지는 파일 경로와 함께 ' +
      '추가로 적어주면 더 좋아요.',
  };
}
```

Selected by `ConversationRuntime` purely on the fact "no candidate validated" — the runtime still
builds no text (ADR-0032 §10, unchanged invariant).

## 6. Required Architecture Questions — CA decisions

**Q1. Where should target scope detection live?**
**APPROVED WITH CLARIFICATION.** Split by concern, both narrow: **extraction** (pure, no I/O) lives in
the new, standalone module `target-scope.ts`. **`IntentResolver` needs zero changes** — it already
forwards `context.targetFiles` (§2). **Validation** (I/O against the real workspace) is called
directly by `ConversationRuntime`, not by `IntentResolver.resolve()`, because `resolve()` is
deliberately kept synchronous and I/O-free — unchanged shape, unchanged "does not classify, does not
plan" boundary. `IntentClassifier` remains target-free — it still only emits `IMPLEMENT_CODE` +
`raw.kind`, never a target guess.

**Q2. What counts as sufficient scope?**
**APPROVED WITH CHANGE.** Sufficient: a candidate containing `/` and a file extension (§5.1), that
exists in the workspace, is returned by Workspace validation via an exact-match comparison (§5.2), and
is not secret/ignored/outside the workspace. Insufficient: no path; vague module/area text; directory
path; absolute path; `../` traversal; hidden/dot-relative path; a bare root filename like `foo.ts`
(excluded this sprint per §5.1's rationale, not tested/justified enough to include now). Directory
targets remain explicitly out of scope.

**Q3. Should ambiguous requests create a Task/ExecutionPlan or stop before execution?**
**APPROVED.** No. `ConversationRuntime` returns the clarification reply via `respondComposed` (already
the composer/runtime path `composeNeedsProject` and other pre-execution replies use) **before**
`intentResolver.resolve()`, `ExecutionOrchestrator.run`, `ExecutionPlan`, or `ApprovalRequest` — none of
these are ever created for an ambiguous request. Stronger than Sprint 2n's own no-mutation guarantee
(which halts *inside* the orchestrator); this halts *before* the orchestrator is ever called.

**Q4. How should the bot ask for clarification? Which ResponseComposer method owns the text?**
**APPROVED WITH WORDING CHANGE.** New `ResponseComposer.composeTargetScopeClarification` (§5.3) —
must ask for a file path as the sufficient ask, must not imply natural-language module text alone is
sufficient, and must instruct a full re-request (§5.3, §7). Selected by `ConversationRuntime` based on
one fact ("no candidate validated") — Runtime builds no text, per the standing ADR-0032 §10 rule.

**Q5. Should `targetFiles` be populated in `ExecutionRequest`? Only for clear project-relative paths?**
**APPROVED.** Yes — and specifically the **Workspace-returned, exact-match-verified hit**, never the
raw extracted candidate (§5.2, CA Round 1 Required Changes #1-#2). `IntentResolver.resolve()` needs no
change to make this work — the forwarding already exists (§2).

**Q6. How do we prevent path traversal / absolute path / outside-workspace target?**
**APPROVED.** Two layers, reusing ADR-0022's existing, already-reviewed sandbox — no parallel security
model in Runtime:
1. **Extraction-time filter** (§5.1): a candidate starting with `/` or `.`, or containing a `..`
   path segment, is discarded before it ever reaches the Workspace layer.
2. **Workspace-layer enforcement (authoritative):** `WorkspaceManager.list` → `listFiles` walks the
   tree from `resolveWithin(ref.rootPath, '.')` (`workspace-local/src/index.ts:69-84`, 347) — which
   itself rejects absolute inputs, `..` traversal, and symlink escapes — and only enumerates entries
   that pass `DEFAULT_WORKSPACE_POLICY.isReadable` (excludes `node_modules`/`dist`/`build`/`.git`/
   `coverage` and secret-looking names). A path that was never walked can never appear in `list()`'s
   result, **regardless of what glob was requested** — so even a candidate that somehow slipped past
   layer 1 cannot validate. ADR-0036 will state plainly: *the authoritative security boundary is
   `WorkspaceProvider`/`WorkspaceManager`, not the extraction regex.*

**Q7. Does this Sprint need Workspace file-existence validation? Which capability is reused?**
**APPROVED.** Yes, and it is a pure reuse: `WorkspaceManager.list(ref, glob)` (`workspace-manager.ts:
55-57`), backed by the existing CAP-001 `WorkspaceProvider.listFiles` (ADR-0022). **No new capability,
no new Workspace method, no new port** — `ConversationRuntime`'s narrow structural dependency widens
to use an existing `WorkspaceManager` method; this is not a new port (CA Round 1, Required Change #8).

**Q8. How does this interact with `planningOnly`? Does `planningOnly` remain true?**
**APPROVED.** Unchanged and untouched. `IntentResolver.resolve()` still unconditionally sets
`planningOnly: true` for `CODE_IMPLEMENTATION` (ADR-0035) regardless of whether `targetFiles` is
present. `selectStages`'s `needsCodeGeneration = needsCode && !request.planningOnly`
(`execution-orchestrator.ts`) is not touched — a code-change request with a validated target file
still stops at `PLANNING → APPROVAL`. No AI Code Generation in Sprint 2o. This sprint decides
**whether** the request is allowed to reach that point at all, never **what happens once it does**.

**Q9. How do we prove no AI/codegen/mutation occurs?**
**APPROVED.** Even stronger than Sprint 2n's proof, because for an insufficient-scope request the
orchestrator is never invoked at all:
1. **Structural — insufficient scope:** a test asserts `calls.run === 0`; every downstream call
   (`codeGeneration.generate`, `workspace.diff`, `patch.generate`, `workspaceWrite.apply`,
   `command.run`) is unreachable, since none of them are called anywhere except inside
   `ExecutionOrchestrator.run`/`resume`, which was never invoked.
2. **Structural — sufficient scope:** identical to Sprint 2n's own three-layer guarantee (ADR-0035)
   once `orchestrator.run` *is* called — untouched by this sprint.
3. **Test proof (§9):** call-count-zero assertions for both cases, covering both the "no candidate"
   and "candidate present but unvalidated" insufficient-scope variants.

## 7. Why no multi-turn clarification-answer correlation (explicit design decision, not an oversight)

A natural follow-up question: after the bot asks "which file?", does the user's next bare-path reply
(no "고쳐줘"/"수정해줘" verb) get recognized as answering that question? **No, not this sprint, and
not as an accident** — it is forced by the sprint's own non-goals, and CA Round 1 confirmed this
analysis while requiring the clarification wording itself to compensate (§5.3):

- `IntentClassifier.detectCodeChange` (unchanged) requires a fix/change/refactor verb to emit
  `IMPLEMENT_CODE` at all. A bare "packages/core/src/application/intent-classifier.ts에서" reply, with
  no verb, classifies as `CHAT` (or `PROJECT_ANALYSIS` if it happens to match those heuristics) —
  losing the code-change context.
- Recovering that context across turns would require a **new, persisted, stateless-correlation
  mechanism** analogous to `ApprovalFlow`/`StatelessApprovalFlow` (ADR-0032 §6) — but `ApprovalFlow`
  derives its state from an **existing aggregate** (`Session.activeTaskId → Task.planId →
  approvals.findByExecutionPlan`). An insufficient-scope code-change request never creates a Task or
  an `ExecutionPlan` (§6 Q3) — there is **no aggregate to derive a "pending scope clarification" from**
  without inventing one. Inventing one is explicitly forbidden this sprint (no new aggregate/
  repository/migration).
- **CA Round 1's compensating requirement:** since there is no memory across turns, the clarification
  text itself must teach the user the correct single-turn shape — "packages/core/src/application/
  foo.ts 파일에서 이 버그 고쳐줘" — so a user who follows the example re-includes the verb naturally and
  succeeds on the very next turn without needing any correlation mechanism at all (§5.3).
- Therefore: single-shot clarification only, with wording that makes the required next message
  self-evident. A future sprint can revisit true multi-turn correlation once the product decides it's
  worth a new mechanism.

## 8. Impact on Sprint 2n's existing tests (expected, CA-specified, not a regression)

Sprint 2n's own canonical example, "이 버그 고쳐줘", is this sprint's CA-specified "Case 1: Scope
missing" example. Every existing `conversation-runtime.test.ts` case that drives
`handleExecutionIntent` with `intent: codeIntent` and a path-free message (`'이 버그 고쳐줘'`,
`'배포해줘'`) will, after this sprint, hit the **new** insufficient-scope branch and get
`composeTargetScopeClarification` instead of proceeding to `orchestrator.run`. Affected, to be
**updated** at implementation (not broken — their intent changes on purpose):

- `'execution intent (code, active project) → COMPLETED execution, RESPONDED turn'`
- `'high-risk execution → AWAITING_APPROVAL + anchored'`
- `'the resolved ExecutionRequest is marked planningOnly (real IntentResolver, ADR-0035)'`
- `'active project → AWAITING_APPROVAL uses the code-change-specific prompt, not the generic one'`

Each will be changed to use a message that **names a validated path** (e.g. "packages/core/src/
application/foo.ts에서 이 버그 고쳐줘", with the test's fake `workspace.list` returning `['packages/
core/src/application/foo.ts']` for that candidate) to keep exercising Sprint 2n's already-proven
`planningOnly`/`AWAITING_APPROVAL` behavior — **unchanged behavior, different fixture**. New tests are
added for the bare-message (no path) case, asserting the new clarification branch and
`calls.run === 0` (§9). **Not affected:** the `pending`-approval-turn tests (`'next turn "승인"'`,
`'취소'`, etc.) — they enter through `handleApprovalTurn`, not `handleExecutionIntent`, so they never
touch this sprint's new code at all. `TEST_EXECUTION`'s own tests are untouched — the new branch is
gated strictly on `Capability.CODE_IMPLEMENTATION`.

## 9. Validation Strategy (tests to add/change at implementation — Node 22)

**`target-scope.test.ts`** (new file):
1. `extractTargetPathCandidates('packages/core/src/application/foo.ts에서 버그 고쳐줘')` includes
   `'packages/core/src/application/foo.ts'`.
2. Rejects `/etc/passwd` (absolute).
3. Rejects `../../etc/passwd` (traversal).
4. Rejects `Node.js`, `e.g.`, `v1.2.3` (no `/`, CA Round 1 Required Change #4).
5. Rejects bare root filenames like `foo.ts` (no `/` — conservative exclusion, §5.1).
6. Plain module/area text with no path-shaped token ("로그인 처리 부분") yields no candidates.
7. Multiple candidates in one message are returned in order of appearance (caller tries each, bounded
   by `MAX_TARGET_CANDIDATES`, §5.2).
8. `normalizeRelativePath` treats `./packages/foo.ts`, `packages/foo.ts`, and `packages//foo.ts` as
   equal; does not alter a path that already contains `..` (extraction already rejects those, so this
   function is never asked to "fix" one — test documents that it doesn't try to).

**`conversation-runtime.test.ts`**:
9. Code-change message with no path candidate ("이 버그 고쳐줘") → `composeTargetScopeClarification`
   reply, `calls.run === 0`, `workspace.list` never called (no candidates to try).
10. Code-change message with a path candidate that does **not** validate (fake `workspace.list`
    returns `[]` for it) → same clarification reply, `calls.run === 0`.
11. Code-change message with a path candidate that **does** validate (fake `workspace.list` returns
    an exactly-matching hit) → `orchestrator.run` called once, `calls.lastRunRequest?.targetFiles`
    equals `[thatPath]` — **the Workspace-returned hit, not necessarily reference-equal to the raw
    candidate string** — outcome proceeds to `AWAITING_APPROVAL` exactly as Sprint 2n already tests.
12. Fake `workspace.list` returns a hit that does **not** normalize-equal the candidate (simulating a
    glob false-positive) → treated as unvalidated → clarification reply, `calls.run === 0` (proves the
    exact-match check in §5.2 is load-bearing, not decorative — CA Round 1 Required Change #1).
13. Module/area-text-only message ("로그인 처리 부분 수정해줘") → clarification reply, `calls.run === 0`.
14. Secret/ignored/outside-workspace candidates (`.env` mention, `node_modules/foo.ts` mention,
    `../escape.ts` mention, an absolute-path mention) each drive a fake `workspace.list` returning `[]`
    (mirroring the real provider's actual behavior, proven separately in
    `workspace-local/src/index.test.ts:147`) → clarification reply, `calls.run === 0` — CA Round 1
    Required Change #5's Runtime-level proof, paired with the pre-existing provider-level proof rather
    than duplicating it.
15. More than `MAX_TARGET_CANDIDATES` (5) path-shaped tokens in one message → at most 5
    `workspace.list` calls are made (CA Round 1 Required Change #9).
16. `TEST_EXECUTION`/`PROJECT_ANALYSIS`/`CHAT` intents never call `workspace.list` at all (regression
    guard — the gate is capability-specific).
17. The four Sprint 2n tests named in §8 updated to a validated-path fixture; still green, still
    asserting `planningOnly`/`AWAITING_APPROVAL`/the code-change-specific approval prompt.
18. No active project + code-change message with a path → still `composeNeedsProject`,
    `calls.run === 0`, `workspace.list` never called — the existing no-project check still runs
    *before* this sprint's new gate (order unchanged, §5.2).
19. Workspace-open failure + code-change message with a path → still `composeWorkspaceUnavailable`,
    `calls.run === 0` (order unchanged).

**`response-composer.test.ts`** (new cases):
20. `composeTargetScopeClarification` — text asks for a file path with an example.
21. Text instructs the user to re-send the full request together with the path (e.g. contains "파일에서").
22. Text does not present the module/area example as sufficient on its own (does not claim
    "로그인 처리 부분" alone is enough — CA Round 1 Required Change #6).

23. `pnpm typecheck` + `pnpm test` green on **Node 22**.

## 10. Architecture Impact / Reuse

- **Reuses, unchanged:** `IntentClassifier` (no target-file logic added), `IntentResolver.resolve()`
  (zero-diff — the `targetFiles` forwarding already existed), `WorkspaceManager.list`/the whole CAP-001
  sandbox (ADR-0022, including its existing `listFiles` secret/ignored-dir test coverage — reused as
  proof, not re-implemented), `ExecutionOrchestrator`/`selectStages`/`RiskPolicy`/`planningOnly`
  (ADR-0035, all untouched), `respondComposed` (existing Runtime helper).
- **Changes:** new file `target-scope.ts` (pure, no dependency — explicitly not a capability, domain
  service, or port), `conversation-runtime.ts` (`handleExecutionIntent` gains one gated, bounded
  branch; `ConversationRuntimeDeps.workspace` interface gains `list` — additive, not a new port),
  `response-composer.ts` (+1 method, CA-specified wording).
- **No new** aggregate / repository / migration / capability / port. **No** `Core` or
  `ExecutionOrchestrator` contract change (this sprint touches none of `ExecutionRequest`/
  `selectStages`/`ExecutionOrchestrator` at all — everything it needs there already existed).
- **ADR-0036** (authored before implementation) must include, per CA Round 1:
  1. Sprint 2o is scope collection, not code generation.
  2. The target-scope gate runs before `ExecutionOrchestrator` — insufficient scope creates no
     `ExecutionPlan` and no `ApprovalRequest`.
  3. `target-scope.ts` is a pure Application-layer parser helper — not a capability, not a domain
     service, not a port/adapter/repository.
  4. `IntentClassifier` remains target-free; `IntentResolver` remains unchanged (the `targetFiles`
     forwarding already existed).
  5. `ConversationRuntime` validates target candidates through the existing `WorkspaceManager.list` —
     the Workspace boundary is authoritative for path safety, not the extraction regex.
  6. `targetFiles` uses the validated, Workspace-returned path, never the raw candidate.
  7. `planningOnly` remains true; `CODE_IMPLEMENTATION` remains `HIGH`; no AI Code Generation/
     `WorkspaceDiff`/`Patch`/`WorkspaceWrite`/`CommandExecution` this sprint.
  8. No multi-turn clarification correlation this sprint (§7); the clarification wording compensates
     by teaching the correct single-turn shape.
  9. `ConversationRuntimeDeps.workspace` widens structurally to use an existing `WorkspaceManager`
     method — no new Workspace port or capability is introduced.
  10. No new aggregate/repository/migration/capability/port.

## 11. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Extraction regex false-positives on incidental `/`-containing tokens (e.g. a URL fragment) | Low | Exact-match Workspace validation is authoritative — a false candidate simply fails to validate and the next candidate (or clarification) is tried (§5.1/§5.2) |
| Extraction regex misses a real path due to unusual punctuation/spacing | Low-Med | Deterministic v1 heuristic, same conservative-but-imperfect posture as ADR-0033/0035's classifier keywords; falls back to clarification, never to a wrong silent guess |
| `workspace.list`'s glob matcher is assumed exact-match without verification | Low | Explicitly guarded against — `normalizeRelativePath` equality check, not `hits.length > 0` (CA Round 1 Required Change #1, §5.2, tested at §9 item 12) |
| No multi-turn follow-up recognition (§7) reads as a broken conversation to the user | Med (Product) | Explicitly flagged, not hidden; forced by the no-new-aggregate non-goal; clarification wording teaches the correct single-turn shape (§5.3); candidate for a future sprint |
| Sprint 2n test churn is mistaken for a regression during review | Low | §8 explains exactly which tests change and why, matching the CA's own Case 1 example |
| Unbounded `workspace.list` calls from a message with many path-shaped tokens | Low | `MAX_TARGET_CANDIDATES = 5` hard bound (CA Round 1 Required Change #9, §5.2, tested at §9 item 15) |

## CA Round 1 — summary of applied changes

1. `workspace.list` results are verified with an **exact-match** check (`normalizeRelativePath`
   equality), never trusted via `hits.length > 0` (§5.1, §5.2).
2. `targetFiles` is populated from the **Workspace-returned matched hit**, never the raw candidate
   (§5.2, §9 item 11).
3. `target-scope.ts` is explicitly documented as a pure Application-layer parser helper — not a
   capability, domain service, or port (§5.1, ADR-0036 item 3).
4. The extractor now **requires a `/`** in any candidate, rejecting bare filenames, `Node.js`, `e.g.`,
   `v1.2.3` at zero `workspace.list` cost (§5.1).
5. Secret/ignored-path defense is proven by reusing the pre-existing `workspace-local` provider test
   (`index.test.ts:147`) plus one new Runtime-level test with fakes (§9 item 14) — not duplicated from
   scratch; ADR-0036 states the Workspace boundary is authoritative, not the regex.
6. Clarification wording rewritten: asks for a file path as the sufficient ask; frames module/area
   text as optional context only, never as a sufficient example on its own (§5.3).
7. Clarification wording also instructs a full re-request with the path included (e.g. "...파일에서
   이 버그 고쳐줘"), compensating for no multi-turn memory (§5.3, §7).
8. `ConversationRuntimeDeps.workspace.list` addition documented explicitly as a structural interface
   widening — not a new port/capability (§5.2, §6 Q7, ADR-0036 item 9).
9. `MAX_TARGET_CANDIDATES = 5` bounds how many `workspace.list` calls one message can trigger (§5.2).

## Next Step

**Plan changes applied — CA Round 1 requirements incorporated above.** Per the approved implementation
sequence: (1) plan changes applied (this document); (2) author ADR-0036 next; (3) implement exactly
this scope (§3/§5) on a `v2/<topic>` branch; (4) add/update tests per §9; (5) validate on **Node 22**;
(6) open a PR for Chief Architect Implementation Review. No commit/PR has been made yet — proceeding
to ADR-0036 + implementation now.
