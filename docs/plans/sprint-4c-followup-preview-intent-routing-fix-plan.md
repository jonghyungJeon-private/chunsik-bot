# Sprint 4c-Follow-up — CodeChangePreview Command UX / Intent-Routing Fix (PLAN-ONLY)

> **PLAN-ONLY BOUNDARY.** This sprint produces **only this document** plus the read-only investigation it records.
> It makes **no code change**, creates **no branch/commit/PR**, retries **no UAT**, mutates **no sandbox**, changes
> **no GitHub App auth**, and **relaxes no approval boundary**. It records the read-only investigation of the
> intent-routing that BLOCKED Gate 4B Scenario C, states confirmed root causes, and proposes a fix + acceptance /
> UAT-rerun criteria for a **future, separately-approved** implementation sprint. Product: **Quoky (formerly
> ChunsikBot V2)**.

- **Status:** **CLOSED — APPROVED (2026-07-09).** CA's final review confirmed every APPROVED-WITH-CHANGES item was
  folded in and returned a plain **APPROVED**. This plan-only sprint is accepted and closed; **implementation was
  NOT authorized by this approval** — it proceeds under a separate implementation sprint plan:
  `docs/plans/sprint-4c-followup-preview-intent-routing-fix-implementation-plan.md`. No execution occurred under
  this document (see §0.1/§0.2).
- **Base:** `main @ 0559c368e77960806a44e07f5ef01fd5b5ad6266` (Sprint 4b / ADR-0061). No code changed; Node 22
  `typecheck`/`test` baseline unaffected (49 files / 1098 tests green, per the Gate 4B validation observation).
- **Trigger:** Gate 4B Scenario C BLOCKED at the code-change **preview / patch-generation** entry point — a
  product/runtime command-UX / intent-routing gap, **not** a GitHub App auth failure. See
  `docs/plans/sprint-4c-gate4b-uat-result-record.md`.
- **Investigation method:** read-only source inspection only. No code/branch/commit/PR/sandbox/UAT action taken.

---

## 0.1 CA review outcome — APPROVED WITH CHANGES (2026-07-09)

CA reviewed the full plan and returned **APPROVED WITH CHANGES** (plan-only; implementation NOT yet approved). CA
accepted every investigation finding — routing is 100% deterministic (regex/keyword/state); AI is used only in
downstream patch-content generation; the blocker message is a fixed response string; a negation-blind commit/push
token match hijacked the preview request into a commit-approval intent; and there is no direct preview entry point.
Binding CA decisions, folded into this plan (§7/§8 updated accordingly):

```text
- FIX-1 (deterministic PREVIEW intent/matcher)            : REQUIRED scope.
- FIX-2 (negation-aware pre-classification mutation gates) : REQUIRED scope.
- FIX-3 (anchor-independent commit-gate precedence)        : OPTIONAL / constrained investigation item — first slice
                                                             prefers minimal change; must NOT weaken any approval
                                                             boundary and must KEEP the safe reply to a genuine commit request.
- Preview-generation approval boundary                     : 7a SELECTED — a preview-only request KEEPS the existing
                                                             HIGH-risk plan approval before AI patch generation.
- 7b (AI generation without plan approval)                 : DEFERRED / NOT APPROVED (this slice) — a preview is the
                                                             entry point where AI authors patch content that later
                                                             leads to apply, so the approval boundary is NOT relaxed.
- Gate 4B Scenario C rerun                                 : ONLY after the fix merges, in a NEW attended window
                                                             (fresh §2 preflight), FROM the preview stage.
- Scenario A / B                                            : keep their settled DEFERRED decisions (shipped coverage).
- Scenario C                                                : re-attempted from the preview stage.
```

Still NOT approved: implementation · code change · branch/commit/PR · UAT retry · sandbox mutation · Gate 5 · Gate 6.

---

## 0.2 CA final review outcome — APPROVED (2026-07-09) — plan-only sprint CLOSED

CA re-reviewed the updated plan and confirmed every §0.1 item was correctly folded in: 7a explicitly selected, 7b
explicitly deferred/not approved, FIX-1 and FIX-2 explicitly required, FIX-3 explicitly optional/constrained, the
Gate 4B rerun gated to a new attended window after the fix merges, Scenario A/B keeping their deferred decisions,
Scenario C resuming from the preview stage, GitHub App auth/token-flow change forbidden, and approval-boundary
relaxation forbidden. Final verdict: **APPROVED.**

```text
- Sprint 4c-Follow-up plan is APPROVED; the plan-only sprint may be closed.
- This approval does NOT authorize implementation, branch creation, code changes, commit/PR, UAT retry, or
  Gate 5 / Gate 6.
- Next: a separate implementation sprint plan for the Preview Intent Routing Fix, keeping this exact approved
  scope (FIX-1 required, FIX-2 required, FIX-3 optional/constrained, 7a selected, 7b deferred/not approved, no
  GitHub App auth/token-flow changes, no approval-boundary relaxation) — see
  `docs/plans/sprint-4c-followup-preview-intent-routing-fix-implementation-plan.md`.
```

---

## 1. Problem statement

- **What blocked:** In the Gate 4B attended window, the operator asked the bot to **generate a patch/diff preview
  only** and explicitly prohibited apply/commit/push/PR ("do not run pnpm test, do not apply workspace, do not
  commit, do not push, do not create PR"). The bot repeatedly answered with the commit-approval-prerequisite
  message and never generated a preview:
  > "지금은 커밋 승인을 준비할 수 없어요. 먼저 코드 변경을 적용(WORKSPACE_APPLIED)한 뒤에 커밋을 요청해 주세요. git 명령은 실행하지 않았어요."
- **It is NOT a GitHub App auth failure.** The happy path never reached `installation_id` resolution, token mint,
  App push, or PR creation, so App auth is **UNTESTED**, not failed.
- **The real blocker:** the request never reached the code-change/preview path. A **global, anchor-independent,
  pre-classification keyword gate** intercepted it as a *commit* intent — because the operator's **negative**
  instructions ("do not **commit**", "do not **push**") contain the very tokens the gate matches, and the gate has
  **no negation awareness**.

---

## 2. Investigation findings — intent-routing structure (answers CA's 7 questions)

All routing lives in `packages/core/src/application/`. Findings are grounded in exact file:line + regex.

**Q1–Q3 — AI/LLM vs deterministic?** **Routing/intent selection is 100% deterministic** (regex/keyword/state);
**no AI/LLM is involved in routing.** AI is used only *downstream* to author the patch *content* after a plan is
approved.
```text
- IntentClassifier.classify()  (intent-classifier.ts:16)   — deterministic regex; comment (line 11):
                                                             "AI-driven classification arrives later; the router is held for it."
- All interpret* matchers        (conversation-runtime.ts)  — String.includes() word-lists + RegExp .test(), no AI.
- Content generation is AI        (code-generation-manager.ts:45 CodeGenerationManager.generate → ProviderSelector →
                                    AiProvider) — this is the ONLY AI step, and it runs AFTER plan approval, not in routing.
```

**Q7 — Is the blocker message fixed or LLM-generated?** **Fixed.** It is a hardcoded Korean string literal at
`response-composer.ts:995` (`composeCommitUnavailable`-style method), emitted by `handleCommitUnavailableTurn`.

**Q4 — Why does "patch/diff preview only" classify as a commit-approval intent?** Because of an
**anchor-independent commit gate that runs before classification**, matched by the **negated** commit/push tokens:
```text
conversation-runtime.ts:1839   if (ConversationRuntime.interpretCommitIntent(message.text)) { … return handleCommitUnavailableTurn }
                               // runs UNCONDITIONALLY, before classify() at line 1894, with NO anchor required.

interpretCommitIntent()  (conversation-runtime.ts:1297):
    const hasCommitToken = /(커밋|\bcommit\b)/i.test(t);
    if (hasCommitToken && COMMIT_FORBIDDEN_COMPANION.test(t)) return 'commit-with-forbidden';   // ← THE HIT
    if (!COMMIT_WORDS.test(t)) return null;
    return 'commit';

COMMIT_FORBIDDEN_COMPANION (line 751) = /(푸시|\bpush\b|git\s*add|리셋|reset|checkout|stash|branch|브랜치|merge|머지|rebase|tag|태그)/i
```
Routing trace for the operator's message (contains "commit" and "push" tokens, both negated):
```text
1. line ~1808 interpretCommitExecutionIntent → 'push-unsupported' (not 'execute') → guard is `=== 'execute'` → skip
2. line 1817  WORKSPACE_APPLIED block          → no anchor → skip
3. line 1839  interpretCommitIntent            → hasCommitToken('commit') && COMMIT_FORBIDDEN_COMPANION('push')
                                                → returns 'commit-with-forbidden' (TRUTHY)
                                                → no COMMIT_APPROVED anchor → handleCommitUnavailableTurn
                                                → response-composer.ts:995  ← BLOCKER (classify() at 1894 never reached)
```

**Q5 — Is there an explicit trigger to enter `CodeChangePreview` / `PATCH_GENERATED`?** **No direct one.** The
preview is only a *byproduct* of the code-change execution flow, gated behind a plan approval:
```text
fresh code-change request (must match IntentClassifier.detectCodeChange, intent-classifier.ts:95)
  → IMPLEMENT_CODE / CODE_IMPLEMENTATION
  → IntentResolver.resolve sets planningOnly:true          (intent-resolver.ts:58)
  → HIGH-risk plan approval created → AWAITING_APPROVAL (HALT)
  → operator approves → decide(true) → orchestrator.resume  (conversation-runtime.ts:1964)
  → runCodeGenerationPreview → composeCodeDiffPreview       (conversation-runtime.ts:1973, 2082)
  → anchor status 'ELIGIBLE'                                (conversation-runtime.ts:2087)   ← first preview appears HERE
```
There is **no "preview only" command**. Worse, `detectCodeChange` requires a change VERB
(`고쳐|고치|수정해|바꿔|변경해|구현해|fix|change|modify|implement`, line 100) + a code NOUN (line 101). A
preview-phrased request ("변경 **미리보기**", "patch/diff **preview**") matches **none** of those verbs → it would
fall through to `CHAT` even if the commit gate had not fired. So "preview only" is unroutable to preview generation
**by design**.

**Q6 — KO/EN mixed handling?** Each matcher unions KO+EN tokens in one case-insensitive regex over the lowercased,
trimmed text (e.g. `COMMIT_WORDS` line 747, `detectCodeChange` lines 100–101). Mixed KO/EN is handled — but **none**
of the matchers strip or detect **negation**, so "do not commit" reads identically to "commit".

**Downstream lifecycle (verified; must be preserved):**
```text
ELIGIBLE → AWAITING_APPROVAL → APPROVED → PATCH_READY → WORKSPACE_APPLIED → COMMIT_APPROVAL_PENDING →
COMMIT_APPROVED → GIT_COMMITTED → PUSH_APPROVAL_PENDING → PUSH_APPROVED → GIT_PUSHED → PR_APPROVAL_PENDING →
PR_APPROVED → PR_CREATED → …   (ApplyPreviewAnchorStatus, conversation-runtime.ts:200)
```
Each transition is gated by a specific qualified phrase + anchor state; e.g. patch generation needs `PATCH_WORDS`
("패치 만들어"/"generate patch", line 702) on an `APPROVED` anchor; final apply needs `FINAL_APPLY_WORDS`
("파일에 적용"/"apply patch", line 717) on a `PATCH_READY` anchor. The guards themselves work as designed — the
gap is purely the **entry** to preview and the **negation-blind pre-classification gates**.

---

## 3. Root cause (CONFIRMED) + residual hypotheses

**Confirmed root cause A — negation-blind, anchor-independent commit/mutation gates run before classification.**
`interpretCommitIntent` (and the sibling mutation gates) fire on token presence regardless of negation, and
`interpretCommitIntent` at line 1839 fires **with no anchor**, short-circuiting before `classify()`. A message whose
primary intent is "preview only" is hijacked by its own "do not commit/push" prohibitions.

**Confirmed root cause B — no preview entry point.** There is no explicit "generate a preview" intent/command, and
`detectCodeChange` does not recognize preview-phrased requests as code changes. Preview generation is reachable only
via `IMPLEMENT_CODE` → plan-approval → post-approval AI generation.

**Residual hypotheses to validate during implementation (from CA §8.2):**
```text
- H1 (CONFIRMED): commit keyword outranks a preview request — yes, via the pre-classification gate at line 1839.
- H2 (CONFIRMED): the negative "commit"/"push" token triggers the commit gate — yes, via 'commit-with-forbidden'.
- H3 (CONFIRMED): the preview intent is absent/weak — yes, no preview intent exists; detectCodeChange excludes it.
- H4 (PARTIAL):  KO/EN mixed → fallback intent — mixed tokens are matched, but negation is never handled; a pure
                 preview request with no change-verb would fall to CHAT (a weak fallback), confirming H3.
- H5 (CONFIRMED): the state-guard message masks the real (mis)routing — the fixed line-995 message is emitted by an
                 anchor-independent commit gate, so it masks that the request was never classified.
```

---

## 4. Investigation targets — status

```text
ConversationRuntime (conversation-runtime.ts)         ✓ inspected — routing order (handle(), lines 1505–1894);
                                                        the pre-classification mutation gates (1839/1848/1861/1875).
IntentClassifier (intent-classifier.ts)               ✓ inspected — deterministic; no preview intent; detectCodeChange.
IntentResolver (intent-resolver.ts)                    ✓ inspected — planningOnly:true for CODE_IMPLEMENTATION (line 58).
CapabilityRouter (capability-router.ts)                ✓ inspected — AI provider selection only; not text routing.
ResponseComposer (response-composer.ts)                ✓ inspected — blocker message is a fixed literal (line 995).
CodeGenerationManager (code-generation-manager.ts)     ✓ inspected — the only AI step; runs post-approval.
CommitApproval matcher (COMMIT_WORDS, line 747)        ✓ inspected — no negation handling.
WorkspaceApply / Patch matchers (lines 694/702/717)    ✓ inspected — no negation handling.
StatelessApplyPreviewFlow (stateless-apply-preview-flow.ts) ✓ inspected — anchor lifecycle store; not the blocker.
```

---

## 5. Proposed command UX (design proposal — NOT implemented here)

Introduce an **explicit, deterministic preview-only intent** that routes to code-change **preview generation** and
**stops at the read-only `ELIGIBLE` preview** (never applies, commits, pushes, or PRs):
```text
Natural-language (KO): "변경 미리보기 만들어줘", "코드 변경 미리보기", "diff 미리보기", "패치 미리보기 보여줘",
                       "코드 변경 초안 만들어줘", "파일 변경안 보여줘"
Natural-language (EN): "show me a patch/diff preview", "preview the change only", "generate a preview (only)"
Explicit command:      an optional slash-style "/preview <request>" for an unambiguous entry (recommended).
```
Behavior: a preview-only request generates and shows the unified-diff preview and leaves the anchor at `ELIGIBLE`
(files untouched; no git). Applying still requires the separate, explicit apply approval — unchanged.

---

## 6. Design principles / invariants (MUST hold — no boundary relaxation)

Preserve exactly (per CA direction §7):
```text
- reviewed preview REQUIRED before workspace apply
- WORKSPACE_APPLIED REQUIRED before commit approval
- commit REQUIRED before push
- push approval REQUIRED before push
- PR creation NEVER bundled implicitly with push
- GitHub App auth flow UNCHANGED
- no apply/commit/push/PR automation; each remote mutation stays separately, explicitly approved
```
The fix changes **only** how a *preview* request is recognized and routed to preview generation, and how
**negated** mutation tokens are treated — it must not weaken any approval gate or add automation.

---

## 7. Fix approaches — CA-decided (2026-07-09)

```text
FIX-1 [REQUIRED] (routing entry): add a deterministic PREVIEW intent/matcher (PREVIEW_WORDS + optional "/preview"),
        recognized BEFORE the mutation gates, that routes to code-change preview generation and halts at ELIGIBLE.
        SETTLED — CA selected 7a: a preview-only request KEEPS the existing HIGH-risk plan approval before AI patch
        generation. 7b (generate the read-only preview WITHOUT that approval) is DEFERRED / NOT APPROVED this slice —
        even though a preview mutates nothing, it is the entry point at which AI authors patch content that later
        leads to apply, so the current approval boundary is NOT relaxed.
FIX-2 [REQUIRED] (negation safety): make the pre-classification mutation gates (interpretCommitIntent line 1297, and
        siblings) negation-aware — a clause under an explicit prohibition ("~하지 마", "do not ~", "말고", "없이")
        must NOT count as that intent (e.g. "commit하지 마", "push하지 마", "do not commit/push"). Minimally:
        strip/skip negated clauses before token matching.
FIX-3 [OPTIONAL / constrained investigation]: reconsider firing interpretCommitIntent at line 1839 with NO anchor.
        The first slice PREFERS minimal change here. Any change MUST NOT weaken an approval boundary and MUST KEEP
        the scoped "no applied change to commit" safe reply for a genuine commit request — it may only stop that
        gate from pre-empting a clearly preview/code-change request.
```
All three are behavioral routing fixes; none touches approval boundaries, GitHub App auth / token flow, or adds
automation. Implementation order for the future sprint: FIX-1 + FIX-2 first (required); FIX-3 only if it can be done
within the constraints above.

---

## 8. Acceptance criteria (for the future implementation sprint)

```text
[ ] A "patch/diff preview only" request (KO & EN, incl. with negated apply/commit/push/PR prohibitions) routes to
    code-change preview generation (CodeChangePreview / PATCH_GENERATED or the equivalent preview anchor), NOT to
    commit approval.
[ ] "변경 미리보기", "코드 변경 미리보기", "patch preview", "diff preview", "preview only", "파일 변경안" are
    recognized as the preview intent and are NOT misclassified as commit approval.
[ ] The blocker message (response-composer.ts:995) no longer appears for a preview-only request.
[ ] Negated mutation tokens ("do not commit/push", "커밋하지 마", "푸시하지 마") do NOT trigger the commit/push gates.
[ ] 7a preserved: a preview-only request still passes through the HIGH-risk plan approval before AI patch generation.
[ ] Preview generation applies NOTHING: no workspace mutation, no git.
[ ] After preview, the anchor/state is a reviewed-preview state (ELIGIBLE) that ALLOWS the separate apply approval.
[ ] preview still REQUIRED before apply; apply still REQUIRED before commit; push approval still REQUIRED before push.
[ ] Every downstream invariant (§6) still holds: preview→apply→commit→push→PR, each separately approved.
[ ] No approval boundary relaxed; no apply/commit/push/PR automation added.
[ ] GitHub App auth / token-flow code is NOT changed.
[ ] Existing tests stay green (Node 22: 49 files / 1098 tests baseline) + new tests cover the preview-intent routing
    and the negation-handling cases.
[ ] typecheck exits 0.
```

---

## 9. UAT rerun criteria (Gate 4B Scenario C re-entry, after the fix merges)

```text
- Re-run Gate 4B Scenario C from the PREVIEW stage in a NEW attended, time-boxed window, after a fresh §2 preflight.
- Scenario A/B keep their settled decisions (deferred to shipped coverage).
- Scenario C happy path re-executed end-to-end: preview → apply → commit → push → PR, each step separately approved.
- D (HTTPS push) / F (repo-id down-scoping) / G (secret-free) observed within/around C.
- Success = the App-auth happy path (installation resolve id 145166383 → down-scoped mint → App push → PR_CREATED)
  is finally exercised, secret-free.
```

---

## 10. Out of scope / forbidden (this plan-only sprint)

```text
FORBIDDEN now: code change · branch · commit · PR · UAT retry · sandbox mutation · GitHub App auth / token-flow
               change · approval-boundary relaxation · apply/commit/push/PR automation · 7b (deferred/not approved) ·
               Gate 5 · Gate 6 · Sprint 4d start.
DEFERRED:      the broad Quoky naming migration (Sprint 4d+), unchanged.
```

---

## 11. Stop condition (this sprint)

Plan-only. **This document (plus the recorded read-only investigation) is the sole deliverable.** No implementation,
no branch/commit/PR, no UAT retry, no sandbox mutation, no App-auth change. After writing this plan, **stop and
request CA review.** Implementation proceeds only under a separate CA approval; the Gate 4B Scenario C rerun proceeds
only under a new attended window per §9.
