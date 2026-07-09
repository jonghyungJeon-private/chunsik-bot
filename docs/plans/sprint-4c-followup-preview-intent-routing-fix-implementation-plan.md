# Sprint 4c-Follow-up — Preview Intent Routing Fix — Implementation Plan (PLAN-ONLY)

> **PLAN-ONLY BOUNDARY.** This document specifies the exact implementation design for the CA-approved Preview Intent
> Routing Fix (`docs/plans/sprint-4c-followup-preview-intent-routing-fix-plan.md`, **CLOSED — APPROVED, 2026-07-09**).
> It makes **no code change**, creates **no branch/commit/PR**, retries **no UAT**, mutates **no sandbox**, changes
> **no GitHub App auth**, and **relaxes no approval boundary**. Writing this document is the only action taken now.
> Implementation proceeds only under a **separate CA approval** of this plan. Product: **Quoky (formerly
> ChunsikBot V2)**.

- **Status:** PLAN-ONLY. **CA review: APPROVED WITH CHANGES (2026-07-09, round 1) — required TEST_EXECUTION/validation
  negation folded in (§0.1); awaiting final CA review.** No implementation authorized by this document.
- **Base:** `main @ 0559c368e77960806a44e07f5ef01fd5b5ad6266` (Sprint 4b / ADR-0061). No code changed; Node 22
  `typecheck`/`test` baseline unaffected (49 files / 1098 tests green).
- **Predecessor:** `docs/plans/sprint-4c-followup-preview-intent-routing-fix-plan.md` (investigation + CA-approved
  scope). This document does not re-derive the root cause — it inherits it verbatim (§1 below is a short recap; see
  the predecessor's §2/§3 for the full investigation).
- **Approved scope (binding, carried forward unchanged from the predecessor's §0.1/§0.2):**
  ```text
  FIX-1 (deterministic PREVIEW intent)          : REQUIRED
  FIX-2 (negation-aware gates: commit/push/apply/PR + TEST_EXECUTION/validation): REQUIRED
        (TEST_EXECUTION/validation negation added per CA review 2026-07-09; see §3.5)
  FIX-3 (anchor-independent commit-gate precedence): OPTIONAL / constrained — minimal-change preference; must not
                                                     weaken any approval boundary; must keep the safe "no applied
                                                     change to commit" reply for a genuine commit request
  Preview approval boundary                      : 7a SELECTED (preview-only keeps the existing HIGH-risk plan
                                                     approval before AI patch generation)
  7b (generation without plan approval)          : DEFERRED / NOT APPROVED
  GitHub App auth / token-flow code              : UNCHANGED (forbidden to touch)
  Approval-boundary relaxation                    : FORBIDDEN
  Apply/commit/push/PR automation                 : FORBIDDEN
  ```

---

## 0.1 CA review outcome — APPROVED WITH CHANGES (2026-07-09, round 1)

CA reviewed this implementation plan and **approved the overall direction** (FIX-1 7a pipeline reuse, FIX-2
negation-aware gates, FIX-3 optional/constrained, GitHub App auth/token-flow untouched, no approval-boundary
relaxation, UAT-rerun sequencing). **One required change before final approval, now folded in:**

```text
REQUIRED: add negated TEST_EXECUTION / validation-command handling to FIX-2's required scope.
Reason  : in the Gate 4B window the bot ran `pnpm test` even though the operator said "테스트 실행하지 마" /
          "pnpm test 실행하지 마". detectTestRun (intent-classifier.ts:83) runs BEFORE detectCodeChange inside
          classify() (line 34 vs 48) and matches 테스트/test + an action verb (실행/run/돌려/해줘) or `pnpm test`,
          so a NEGATED test phrase inside a preview-only request would classify as RUN_TESTS and execute. Including
          P5 (the exact message) as an acceptance case is not enough — the negation must be in the DESIGN scope so
          the implementer does not miss it.
Folded in: the FIX-2 scope line (above) · §3.5 (design + apply locations) · §5 (P7/P8/N6/N7/R9/R10) · §6 (files).
```

Still NOT approved: implementation · branch · code change · commit · PR · UAT retry · sandbox mutation.

---

## 1. Recap — what this fixes (see predecessor for full investigation)

Two confirmed root causes block a "patch/diff preview only" request from ever reaching preview generation:

```text
A. conversation-runtime.ts:1839 calls interpretCommitIntent(message.text) UNCONDITIONALLY, before classify()
   (line 1894) and with NO anchor required. interpretCommitIntent (line 1297) has no negation awareness, so a
   message containing "do not commit" / "do not push" / "커밋하지 마세요" / "푸시하지 마" is read as a genuine
   commit-with-forbidden-companion request and short-circuits into the fixed blocker reply
   (response-composer.ts:995) — classify() is never reached.
B. Even if (A) did not fire, IntentClassifier.detectCodeChange (intent-classifier.ts:95) requires a change VERB
   (고쳐/수정해/바꿔/변경해/구현해/fix/change/modify/implement) — a preview-phrased request ("변경 미리보기",
   "diff preview") matches none of those verbs and falls to CHAT. There is no preview intent at all today.
```
The downstream lifecycle guards (preview → apply → commit → push → PR, each separately approved) are correct and
must not change. This fix only changes: (1) how a preview-only request is *classified*, and (2) how the
pre-classification mutation gates treat *negated* mutation tokens.

---

## 2. Design — FIX-1 (deterministic PREVIEW intent) [REQUIRED]

### 2.1 Where it plugs in

Reuse the **existing** `IMPLEMENT_CODE` → `planningOnly` → plan-approval → `runCodeGenerationPreview` pipeline
(`conversation-runtime.ts:1969-1973`) rather than inventing a new lifecycle or anchor status. That pipeline already
does exactly what a "preview" needs: it generates a `CodeDiffPreview` and leaves the anchor at `ELIGIBLE`
(`conversation-runtime.ts:2087`) — files untouched, no git — and it is **already gated by the HIGH-risk plan
approval** (`IntentResolver.resolve`, `intent-resolver.ts:58`, unconditional for `CODE_IMPLEMENTATION`). This is
exactly **7a**: no new approval-boundary code is needed because the existing gate already applies to every
`CODE_IMPLEMENTATION` intent, preview-phrased or not.

### 2.2 Classifier change

In `intent-classifier.ts`, widen code-change detection so a preview-phrased request also yields
`IntentType.IMPLEMENT_CODE` / `Capability.CODE_IMPLEMENTATION`:

```text
Add a PREVIEW_WORDS matcher (KO + EN, deterministic, mirroring the existing detectCodeChange conservatism):
  KO: 변경 미리보기 | 코드 변경 미리보기 | diff 미리보기 | 패치 미리보기 | 미리보기만 | 미리보기 생성 |
      코드 변경 초안 | 파일 변경안
  EN: patch preview | diff preview | preview only | preview the change | show (me )?a preview | generate a preview

detectCodeChange(text) gains a THIRD disjunct (alongside the existing refactor / bugish+fixVerb / changeVerb+codeish
checks): if PREVIEW_WORDS matches, return a new kind tag — 'preview' — WITHOUT requiring a change verb or a code
noun (a preview request may legitimately say only "diff 미리보기 보여줘" with no "fix/change" verb at all).
```
`Intent.raw.kind` becomes `'fix' | 'change' | 'refactor' | 'preview'`. `IntentResolver` does not need to branch on
`kind` (it already ignores `raw.kind` for `CODE_IMPLEMENTATION` — see `intent-resolver.ts:40-59` — `command` is only
derived from `raw.kind` for `TEST_EXECUTION`); `kind: 'preview'` flows through unchanged and reaches the identical
`planningOnly: true` path. No `IntentResolver` change is required. (If summary/telemetry wording should reflect
"preview" specifically, that is a `intent.summary` cosmetic detail, not a routing change — optional, non-binding.)

### 2.3 Optional explicit command

An unambiguous `/preview <request>` entry point (recommended, not required for FIX-1's acceptance): detected at the
very top of `ConversationRuntime.handle()`, before the approval/scope-clarification/anchor checks, by a literal
prefix match on `message.text` (`/^\/preview\s+/i`). On match, strip the prefix and feed the remainder through the
same `IMPLEMENT_CODE` path with `raw.kind: 'preview'`, bypassing NL ambiguity entirely. This is an additive,
zero-risk entry point layered on top of 2.2 — the plan does not require it for MVP but flags it as low-cost/high-value.

---

## 3. Design — FIX-2 (negation-aware pre-classification gates) [REQUIRED]

### 3.1 The core problem with a naive fix

Korean and English negate in different positions relative to the verb ("do **not** commit" vs. "커밋하지 **마**"),
so a single fixed-offset lookbehind/lookahead cannot catch both forms uniformly. The recommended design is a
**shared, centrally-applied negation-window check**, not a per-matcher patch (duplicating negation logic across
`interpretCommitIntent`, `interpretPushIntent`, `interpretCommitExecutionIntent`, `interpretFinalApplyIntent`, etc.
would be a maintenance hazard and contradicts the "minimal, single-point change" spirit CA asked for).

### 3.2 Proposed shared utility

```text
New pure function (e.g. exported from conversation-runtime.ts near the other matchers, or a small new
`intent-negation.ts` if that keeps conversation-runtime.ts's diff smaller — implementer's call, not a boundary):

  isNegated(text: string, matchIndex: number, matchLength: number): boolean

Behavior: look at a bounded window (proposed: 20 chars before AND after the match — must be tuned against the test
matrix in §5, not hard-committed here) around the matched keyword span, split on clause boundaries (. , \n 그리고
그런데 하지만 and but), and check whether the SAME clause contains a negation marker:
  KO markers : 하지\s*마(?:세요|요)?|하지\s*말(?:아|고)|금지|말고|없이
  EN markers : \bdo\s+not\b|\bdon't\b|\bnever\b|\bwithout\b

A matched keyword is negated ⇔ a negation marker exists in the same clause. Only suppress the match when negated;
never invert the match into a positive different intent (negation removes the trigger, it doesn't create a new one).
```

### 3.3 Where to apply it

Apply `isNegated` as a guard **only** at the specific mutation-gate checks CA's acceptance criteria (§7 below) name
— commit / push / apply / PR gates — not blanket across every matcher (over-applying risks suppressing a genuine
mutation request that happens to share a sentence with an unrelated negated clause elsewhere):

```text
interpretCommitIntent (line 1297)            : hasCommitToken match AND COMMIT_FORBIDDEN_COMPANION match must each
                                                individually pass isNegated() == false before counting.
interpretCommitExecutionIntent (line 1316)   : COMMIT_EXECUTION_FORBIDDEN / COMMIT_EXECUTION_WORDS matches, same rule.
interpretPushIntent / interpretPushExecutionIntent (~1330-1358+): PUSH_WORDS / PUSH_FORBIDDEN_COMPANION /
                                                PUSH_EXECUTION_WORDS matches, same rule.
The PR-creation matcher (Sprint 3b area)     : PR words / forbidden-companion, same rule, for symmetry — CA's
                                                acceptance text explicitly includes "commit/push/apply/PR".
interpretApplyIntent / interpretPatchIntent /
interpretFinalApplyIntent (lines 1218/1225/1233): APPLY_WORDS / PATCH_WORDS / FINAL_APPLY_WORDS matches, same rule —
                                                a "do not apply" clause must not be read as an apply request.
```
`GIT_MUTATING_WORDS`/`GIT_DIFF_WORDS`/`GIT_STATUS_WORDS` (the read-only git-preview matcher, Sprint 2w) are **out of
scope** — they already default to a read-only, non-mutating classification and are not implicated in the BLOCKED
observation; touching them is unnecessary surface area.

### 3.4 Ordering interaction with FIX-1

With FIX-2 applied, the operator's original message ("generate a preview only; do not run tests, do not apply, do
not commit, do not push, do not create a PR") now evaluates `interpretCommitIntent` → both the commit token and its
forbidden companion are negated → returns `null` → line 1839 no longer intercepts. The message falls through to
`classify()` (line 1894), where FIX-1's widened `detectCodeChange` recognizes the preview phrasing → `IMPLEMENT_CODE`
→ the existing `planningOnly` plan-approval flow. **FIX-1 and FIX-2 (incl. §3.5 test negation) are jointly necessary
and sufficient** for the exact observed failure; this is a deliberate, verified design, not a guess.

### 3.5 TEST_EXECUTION / validation-command negation (CA-required, 2026-07-09) [REQUIRED]

The same negation discipline MUST also cover test/validation, because test detection is a SEPARATE path that runs
before code-change classification and was directly implicated in the Gate 4B observation (the bot ran `pnpm test`
despite "테스트 실행하지 마"):

```text
Apply the shared isNegated() (§3.2) at:
  IntentClassifier.detectTestRun (intent-classifier.ts:83)  — the PRIMARY fix. detectTestRun returns
      'typecheck'/'test' on a (타입체크/typecheck) or (테스트/test + 실행/run/돌려/해줘) or `pnpm test` match. Guard
      EACH matched token with isNegated(): a negated test/typecheck phrase ("테스트 실행하지 마",
      "pnpm test 실행하지 마", "do not run tests", "do not test", "검증 실행하지 마") must return undefined
      (→ NOT a RUN_TESTS intent), so classify() proceeds to detectCodeChange and the preview intent (FIX-1) wins.
  ConversationRuntime.interpretPostApplyValidationIntent (conversation-runtime.ts:1818) — only fires on a
      WORKSPACE_APPLIED anchor, so it is NOT implicated in the observed no-anchor preview case; guard it too for
      symmetry, so a negated "테스트 실행하지 마" on an applied anchor is not read as a validation-run request.
Shared-module consequence: detectTestRun lives in intent-classifier.ts while the mutation gates live in
  conversation-runtime.ts, so isNegated() MUST be a shared module importable by BOTH (this settles §3.2's
  "implementer's call" toward a small shared `intent-negation.ts`).
Do NOT change NON-negated behavior: "테스트 실행해줘" / "pnpm test 실행해줘" must still run tests (ADR-0033
  allow-listed command), and a genuine validation request on a WORKSPACE_APPLIED anchor must still validate.
```

---

## 4. Design — FIX-3 (optional / constrained) — investigation-first, implement only if still needed

```text
Procedure: implement FIX-1 + FIX-2 first, then run the FULL acceptance test matrix (§5). If every case passes,
FIX-3 is NOT implemented this slice — record that outcome and close FIX-3 as "not needed, superseded by FIX-1+2."
Only if a residual failing case remains (e.g. an ambiguous message that is BOTH a genuine future-commit mention and
a preview request, where negation-stripping alone cannot disambiguate) does the implementer revisit line 1839's
anchor-independent precedence — and even then, the change must be scoped to "do not let this check pre-empt a
message the classifier would recognize as a preview/code-change request," and must preserve the existing scoped
"no applied change to commit" safe reply for a genuine, non-negated, non-preview commit request.
```

---

## 5. Acceptance test matrix (concrete cases; new tests to add in `conversation-runtime.test.ts`)

```text
POSITIVE — must route to preview generation (IMPLEMENT_CODE → planningOnly plan → AWAITING_APPROVAL; after approval
           → runCodeGenerationPreview → ELIGIBLE), and must NEVER show the line-995 blocker:
  P1  "변경 미리보기 만들어줘"                                                    (KO, no negation)
  P2  "diff preview only, please"                                              (EN, no negation)
  P3  "패치 미리보기만 보여주세요. 아직 커밋하지 마세요."                          (KO, negated commit)
  P4  "generate a preview only — do not apply, do not commit, do not push, do not create a PR" (EN, multi-negation)
  P5  the exact operator message from the Gate 4B BLOCKED observation (KO/EN mixed, do-not-test/apply/commit/push/PR)
  P6  "/preview 이 함수 리팩터링 초안 보여줘"                                     (explicit command form, if implemented)
  P7  "diff preview only. do not run tests. do not commit. do not push."       (EN — must route to PREVIEW, NOT
                                                                                 TEST_EXECUTION and NOT commit)
  P8  "변경 미리보기만 보여줘. pnpm test 실행하지 마. 커밋하지 마."               (KO — must route to PREVIEW; must
                                                                                 NOT run pnpm test; must NOT commit)

REGRESSION — must NOT be affected by FIX-1/FIX-2 (verify unchanged behavior):
  R1  "커밋해줘" with no anchor, no negation                → still handleCommitUnavailableTurn (line-995 reply) —
      a genuine commit request with nothing to commit must still get the safe, scoped reply.
  R2  "커밋하고 푸시해줘" with no anchor, no negation         → still 'commit-with-forbidden' → same safe reply
      (forbidden-companion detection must still work when NOT negated).
  R3  WORKSPACE_APPLIED anchor + "커밋해줘" (no negation)    → still routes to handleCommitApprovalTurn (COMMIT_APPROVAL
      planning) — the real commit-approval flow must be untouched.
  R4  GIT_COMMITTED anchor + "푸시해줘" (no negation)         → still routes to the push-approval planning flow.
  R5  ELIGIBLE anchor + "적용해줘" (no negation)              → still handleApplyIntentTurn (creates approval #2).
  R6  APPROVED anchor + "패치 만들어줘" (no negation)         → still handlePatchGenerationTurn.
  R7  PATCH_READY anchor + "파일에 적용해줘" (no negation)    → still handleWorkspaceApplyTurn (first real mutation).
  R8  a message with an UNRELATED negation elsewhere in the sentence but a real, non-negated commit request →
      still classifies as a genuine commit request (isNegated's clause-boundary check must not over-suppress).
  R9  "테스트 실행해줘" / "pnpm test 실행해줘" (no negation) → still RUN_TESTS (ADR-0033 allow-listed command runs).
  R10 a genuine, preview-unrelated test request ("이 프로젝트 테스트 돌려줘") → still routes to TEST_EXECUTION.

NEGATION-UTILITY — direct unit tests for isNegated() in isolation:
  N1  "do not commit" → commit token negated == true
  N2  "커밋하지 마세요" → commit token negated == true
  N3  "commit this" → commit token negated == false
  N4  "do not push, but please commit" → push negated == true, commit negated == false (clause boundary respected)
  N5  "커밋 없이 진행해" → commit token negated == true ("without committing")
  N6  "do not run tests" → test token negated == true
  N7  "테스트 실행하지 마" → test token negated == true

INTEGRATION — full-suite regression:
  I1  Node 22 `pnpm typecheck` exits 0.
  I2  Node 22 `pnpm test` — existing 49 files / 1098 tests stay green + all P/R/N cases above pass.
  I3  No GitHub App auth / token-flow file is touched (diff review check, not an automated test).
```

---

## 6. Files expected to change (implementation sprint; NOT touched now)

```text
packages/core/src/application/intent-negation.ts (NEW)       — FIX-2: the shared isNegated() utility, imported by
                                                               BOTH intent-classifier.ts and conversation-runtime.ts
                                                               (required, not optional — §3.5).
packages/core/src/application/intent-classifier.ts          — FIX-1: PREVIEW_WORDS + detectCodeChange widening
                                                               (or a sibling detectPreviewRequest()). FIX-2/§3.5:
                                                               guard detectTestRun's test/typecheck matches with
                                                               isNegated().
packages/core/src/application/conversation-runtime.ts       — FIX-2: isNegated() guards at interpretCommitIntent /
                                                               interpretCommitExecutionIntent / interpretPushIntent /
                                                               interpretPushExecutionIntent / interpretApplyIntent /
                                                               interpretPatchIntent / interpretFinalApplyIntent /
                                                               the PR-creation matcher / interpretPostApplyValidationIntent.
packages/core/src/application/intent-negation.test.ts (NEW)  — isNegated() unit cases (N1–N7).
packages/core/src/application/intent-classifier.test.ts      — new PREVIEW_WORDS / detectCodeChange / detectTestRun-
                                                               negation tests (incl. R9/R10, N6/N7).
packages/core/src/application/conversation-runtime.test.ts   — the full P/R matrix (§5), incl. P7/P8, R9/R10.
docs/DECISIONS.md                                            — a new ADR entry IF the implementation sprint's CA
                                                               architecture review ratifies one (see §8 draft below);
                                                               ratification happens at that review, not here.
NOT touched: packages/github-app-auth/**, packages/repository-hosting-github/**, apps/chunsik/src/config.ts, any
             GitHub App auth / token-minting / git-credential code (forbidden by the approved scope).
```

---

## 7. Acceptance criteria (verbatim from the CA-approved predecessor plan §8, unchanged)

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
[ ] Every downstream invariant (predecessor §6) still holds: preview→apply→commit→push→PR, each separately approved.
[ ] No approval boundary relaxed; no apply/commit/push/PR automation added.
[ ] GitHub App auth / token-flow code is NOT changed.
[ ] Existing tests stay green (Node 22: 49 files / 1098 tests baseline) + new tests cover the full §5 matrix.
[ ] typecheck exits 0.
```

---

## 8. Proposed ADR draft (for ratification at the implementation sprint's CA architecture review — NOT ratified now)

```text
Proposed: ADR-0062 — Preview Intent Routing Fix (deterministic preview intent into the existing CodeChangePreview
pipeline; negation-aware pre-classification mutation gates)

Decision (draft): recognize an explicit, deterministic "preview" intent (KO+EN keyword set, optional "/preview"
command) that routes into the EXISTING IMPLEMENT_CODE → planningOnly → plan-approval → AI-generation-preview
pipeline (no new anchor status, no new lifecycle state, no approval-boundary change — 7a). Make the
pre-classification commit/push/apply/PR mutation gates AND the TEST_EXECUTION/validation detection negation-aware via
a shared, bounded-window, clause-scoped isNegated() check, so an explicit prohibition ("do not commit/push",
"커밋하지 마", "테스트 실행하지 마", "do not run tests") no longer triggers that intent.
Status: PROPOSED — to be ratified (Accepted/Rejected/Superseded) by CA at the implementation sprint's own
architecture review, per the project's plan → CA review → implement → PR → CA impl review → merge process. This
plan does not ratify it; it only drafts the decision for that later review.
Relations: extends ADR-0038 (AI Code Generation Preview) / ADR-0040 (Explicit Preview Apply Approval) / ADR-0045
(Explicit Git-Commit Approval, the COMMIT_WORDS/COMMIT_FORBIDDEN_COMPANION matchers this fix modifies) / ADR-0047
(Explicit Git-Push Approval, the PUSH_WORDS/PUSH_FORBIDDEN_COMPANION matchers) / ADR-0033 (Live Test Execution, the
detectTestRun matcher this fix guards with negation) / ADR-0043 (Post-Apply Validation, interpretPostApplyValidationIntent).
Does NOT touch ADR-0061 (GitHub App Authentication) — no App-auth/token-flow code changes.
```

---

## 9. Sequencing (for the future implementation sprint — not started now)

```text
1. CA approves this implementation plan (separate approval; this document alone does not authorize it).
2. Implement FIX-1 (classifier) + FIX-2 (negation utility + guards) together — they are jointly required for the
   observed failure (§3.4).
3. Add and run the full §5 test matrix (P1–P6, R1–R8, N1–N5) + typecheck; confirm the 49-file/1098-test baseline
   plus new tests are green on Node 22.
4. Assess FIX-3 per §4's procedure; implement only if a residual case demands it, within the stated constraints.
5. Draft the ADR (§8) into DECISIONS.md as part of that sprint's own CA architecture review — not here.
6. PR → CA implementation review → merge (per AGENTS.md's standard 6-step gate).
7. ONLY THEN: CA opens a NEW attended, time-boxed Gate 4B window with a fresh §2 preflight, and Scenario C is
   re-attempted from the preview stage (Scenario A/B keep their deferred decisions).
```

---

## 10. Out of scope / forbidden (this plan-only document)

```text
FORBIDDEN now: any code change · branch · commit · PR · UAT retry · sandbox mutation · GitHub App auth / token-flow
               change · approval-boundary relaxation · apply/commit/push/PR automation · 7b · Gate 5 · Gate 6 ·
               Sprint 4d start · DECISIONS.md edit (the ADR in §8 is a draft for a FUTURE ratification, not written
               into DECISIONS.md now).
```

---

## 11. Stop condition (this document)

Plan-only. **This document is the sole deliverable.** No code change, no branch/commit/PR, no UAT retry, no sandbox
mutation, no App-auth change, no DECISIONS.md edit. After writing this plan, **stop and request CA review.**
Implementation proceeds only under a separate CA approval of this document, following the sequencing in §9.
