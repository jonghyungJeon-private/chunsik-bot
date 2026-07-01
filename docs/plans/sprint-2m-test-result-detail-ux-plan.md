# Sprint 2m Plan — Test Result Detail UX

- **Status:** ✅ APPROVED WITH CHANGES (Chief Architect Review) — implementing this scope.
- **Base:** `main` @ `0163cfc` · **Validation runtime:** Node 22 (to be run at implementation time).
- **Directed by:** Chief Architect (this sprint's topic is CA-assigned, not Claude-proposed).
- **Goal:** When a user runs `테스트 돌려줘` / `typecheck 돌려줘`, report more than pass/fail — command,
  exit code, duration, a safe excerpt of the last output, and whether the log was truncated — as one
  natural-language reply.
- **Phase:** Phase 2 — Product Construction (third runtime sprint, after Sprint 2k Conversation
  Runtime and Sprint 2l Live Test Execution). **Not** a new capability/aggregate.
- **Process:** V2 architecture-first, step 1 (plan-only) → CA review next.

> **Framing.** Sprint 2l opened the live-execution path; `CommandExecution` already carries
> `command`, `args`, `exitCode`, `stdout`, `stderr`, `durationMs`, `status` (`domain/command-execution.ts:15-51`).
> `ConversationRuntime.frameTestResult` already reads it via the existing `commandExecutions.get`
> path. Nothing here is a new read path or a new fact — this sprint spends facts that are already on
> hand but currently thrown away, and phrases them safely. No command-surface change.

---

## 1. Objective

Turn the current binary pass/fail reply into a short, safe, natural-language summary that includes:

```
- command
- exitCode
- duration
- pass/fail
- a bounded excerpt of stdout/stderr's tail
- an explicit "log truncated" notice when applicable
```

...and give `TIMED_OUT` / no-`CommandExecution` cases their own distinct, non-alarming phrasing
instead of collapsing into one generic "명령을 실행할 수 없었어요."

## 2. Scope (this sprint)

- A new **Application-layer DTO** carrying the display-relevant `CommandExecution` facts (§5.1).
- **`ResponseComposer.composeTestResult`** signature change + a new **`composeTestTimedOut`** (§5.3).
- **`ConversationRuntime.frameTestResult`** framing improvement: branch on `SUCCEEDED` / `FAILED` /
  `TIMED_OUT` instead of today's `SUCCEEDED|FAILED` vs. everything-else (§5.4).
- A pure, deterministic **output-summarization rule** (last-N-lines + max-chars) owned by the
  Composer (§5.2).
- Tests for all of the above (new + updated).

## 3. Non-goals (explicit, per Chief Architect direction)

No command-surface expansion, no user-supplied command, no shell string, no arbitrary command
synthesis, no AI-generated command or AI-generated summary, no retry, no patch/write/code
modification, no GitHub Actions/Discord-rich-UI integration, no new aggregate/repository/migration/
capability, no `Core`/`ExecutionOrchestrator` contract change. This sprint is a **read + format**
change over an existing, already-persisted aggregate.

## 4. Current State (survey)

- `CommandExecution` (`packages/core/src/domain/command-execution.ts`) already has every field the
  ticket asks for: `command`, `args`, `exitCode?`, `stdout`, `stderr`, `durationMs`, `status`. **No
  domain change needed.**
- `packages/command-local/src/index.ts` (`maskCommandOutput`, CAP-007/ADR-0028, already implemented)
  caps each stream at 100,000 chars and redacts secret-shaped substrings **before** the text is ever
  written into `CommandExecution.stdout`/`.stderr`. This happens at the adapter boundary, upstream of
  everything this sprint touches.
- `ConversationRuntime.frameTestResult` (`conversation-runtime.ts:316-335`) already fetches the
  `CommandExecution` and inspects `status`/`args`, then discards `exitCode`, `stdout`, `stderr`,
  `durationMs`, `command` — passing the composer only `passed: boolean` and `kind`.
- `ResponseComposer.composeTestResult(context, passed, kind)` (`response-composer.ts:93-103`) renders
  one of two fixed one-line sentences. No detail surface exists today.
- `TIMED_OUT` and "no `CommandExecution` at all" (gate refusal / spawn error) both fall through to
  `composeCommandUnavailable` — one generic sentence, no distinction, no facts.

## 5. Design

### 5.1 `TestResultDetail` DTO — where it lives

Added to `packages/core/src/application/response-composer.ts`, next to the existing local
`ExecutionReplyStatus` union — **not** in `domain/`, not persisted, not an aggregate:

```ts
export interface TestResultDetail {
  kind: 'test' | 'typecheck';
  command: string;
  args: string[];
  exitCode?: number;   // absent for TIMED_OUT (process was killed, no exit)
  durationMs: number;
  stdout: string;      // already masked + 100k-capped by the runner adapter (§5.2 note)
  stderr: string;      // already masked + 100k-capped by the runner adapter (§5.2 note)
}
```

**Why a narrow DTO instead of passing the `CommandExecution` aggregate straight through** (the
existing precedent for `composeApprovalNotice` does take a full `ApprovalRequest`): a `CommandExecution`
carries `id`/`executionPlanRef`/`approvalRef`/`workspaceRef`/`workspaceChangeRef`/`commandHash` — none
of it renderable, all of it irrelevant to the reply. Passing the aggregate as-is would couple
`ResponseComposer` to domain identity/Ref fields it has no business inspecting. The DTO is exactly
the display-relevant subset, decided by `ConversationRuntime` (which already reads the aggregate).

### 5.2 Output-summarization rule (CA-approved, with required change)

Pure, deterministic, no AI call — lives as a private helper inside `response-composer.ts` (see
§6 Q6 for why it sits in the Composer and not the Runtime):

1. **Stream choice:** prefer `stdout`; fall back to `stderr` only if `stdout` is empty. (`pnpm
   test`/`pnpm typecheck` — Vitest/tsc — write their reporter output to stdout; this avoids ambiguous
   interleaving from showing both streams at once.)
2. **Tail, not head:** take the **last `MAX_SUMMARY_LINES = 20`** lines of the chosen stream — the
   actionable failure detail for a test runner/typechecker is at the end, not the start.
3. **Char cap:** if that slice still exceeds `MAX_SUMMARY_CHARS = 1200`, cut further from the front
   (keep the tail) down to 1200 chars. 1200 leaves headroom under Discord's 2000-char message limit
   once the surrounding Korean sentence (command/exit/duration) is added.
4. **`truncated` flag** is `true` if *either* (a) the excerpt is shorter than the original stream
   (line- or char-cut occurred), *or* (b) the stream already contains the runner's own
   `…[truncated]` marker (it was cut at the 100k-char adapter boundary before this code ever saw it).
   Either case renders the same one-line notice — the user does not need to know which boundary cut it.
5. **No re-redaction.** Truncating an already-masked string cannot re-expose anything — cutting text
   never un-redacts it — so no secret-pattern logic is duplicated here (see §6 Q3).
6. **CA-required: don't hide the omitted stream.** The helper's internal result also tracks
   `chosenStream: 'stdout' | 'stderr' | 'none'` and `omittedStream?: 'stdout' | 'stderr'` (set only
   when `stdout` was chosen **and** `stderr` was non-empty). This is a Composer-internal summary
   result, not a domain concept and not part of `TestResultDetail`. When `omittedStream` is set, the
   reply adds one line: `"stderr 출력도 있었지만, 여기서는 stdout 마지막 부분만 보여드려요."` (or the
   `stdout`-equivalent, symmetrically, in the unlikely case `stderr` was chosen because `stdout` was
   empty but that's moot — `omittedStream` only ever fires for the stdout-preferred branch since
   stderr is only chosen when stdout is empty).
7. **Wording safety (CA-required):** the truncation notice states only that the log was cut —
   `"출력이 길어서 마지막 부분만 보여드렸어요."` — and must **never** claim a completeness/security
   guarantee (e.g. "전체 로그는 안전합니다", "민감정보는 완전히 제거됐습니다"). We trust the adapter's
   masking boundary (§6 Q3) but do not assert it to the user.
8. **No output at all** (`stdout`/`stderr` both empty, `chosenStream: 'none'`) → a graceful
   "출력 없음" style line instead of an empty/absent excerpt block.

### 5.3 `ResponseComposer` changes

```ts
// signature change (single call site — no back-compat shim, per project convention)
composeTestResult(context: ConversationContext, detail: TestResultDetail & { passed: boolean }): OutboundMessage

// new
composeTestTimedOut(context: ConversationContext, detail: TestResultDetail): OutboundMessage
```

- `composeTestResult` renders: label (테스트/타입체크) + pass/fail + `exitCode` + `durationMs` (as
  seconds, one decimal) + the summarized excerpt in a **fenced code block** (CA decision — §5.2 item
  6/7 notices as plain lines around it) + the truncation notice when `truncated`.
- `composeTestTimedOut` renders a distinct, non-alarming sentence (CA-required wording constraints):
  - does **not** say "테스트 실패" / phrase it as a test verdict,
  - does **not** show `exitCode` (none exists — the process was killed, not exited),
  - shows the actual elapsed `durationMs` (e.g. "실행 시간: 30.0s") but does **not** claim it is "the
    configured timeout" — `TestResultDetail` carries no configured-timeout value, so the sentence
    only reports what happened: `"제한 시간 안에 끝나지 않아 중단됐어요."`
  - **forbidden phrasing:** "configured timeout duration exceeded" or any wording implying we know
    the limit that was set.
- `composeCommandUnavailable` is **unchanged** — it remains the reply for the one remaining case
  where no `CommandExecution` exists at all (gate refusal / spawn error), where there are no facts
  to summarize.
- **Message-length defense (CA-required):** beyond the `MAX_SUMMARY_CHARS = 1200` excerpt cap, the
  composer keeps the full rendered `OutboundMessage.text` (surrounding sentences + fenced excerpt)
  under ~1900 chars, with a test asserting this bound (Discord's hard limit is 2000).

### 5.4 `ConversationRuntime.frameTestResult` changes

Branch on `exec.status` three ways instead of today's two:

```
SUCCEEDED | FAILED  → build TestResultDetail from exec fields → composer.composeTestResult(...)
TIMED_OUT            → build TestResultDetail (exitCode omitted) → composer.composeTestTimedOut(...)
(no exec at all)     → composer.composeCommandUnavailable(...)   // unchanged
```

`kind` continues to come from `exec.args.includes('typecheck')` (existing logic, unchanged). The
runtime still never composes text itself — it only decides which case applies and hands over facts,
per the ADR-0032 invariant.

## 6. Architecture Questions — decisions

**Q1. Where does the Test Result Summary DTO live?**
`TestResultDetail` in `packages/core/src/application/response-composer.ts` — Application layer, not
domain, not persisted, no new file. Same pattern already used for `ExecutionReplyStatus`. Rejected
alternative: passing the raw `CommandExecution` aggregate into the Composer (couples it to Ref/id
fields it must never render — see §5.1).

**Q2. stdout/stderr summary rule — last N lines? max chars?**
Last **20 lines** of the chosen stream (stdout preferred, stderr fallback), then capped at **1200
chars** from the front if still too long (keeping the tail). Both constants are named, colocated
constants in `response-composer.ts` (`MAX_SUMMARY_LINES`, `MAX_SUMMARY_CHARS`), not magic numbers, so
a future sprint can retune them without re-deriving the rule. **CA-required addition:** when `stdout`
is chosen and `stderr` is non-empty, the reply indicates the omitted stream exists (§5.2 item 6) —
stdout-preference must not make stderr disappear silently. Full detail in §5.2.

**Q3. Where is the secret/masked-output trust boundary?**
At the **command-runner adapter** (`packages/command-local/src/index.ts::maskCommandOutput`),
already implemented under ADR-0028/CAP-007 — upstream of everything in this sprint. By the time
`CommandExecution.stdout`/`.stderr` reach `ConversationRuntime`/`ResponseComposer`, they are already
redacted and capped at 100k chars. This sprint's summarization is a **length** transform only, over
already-safe text; it adds **no second masking pass** (that would be scope creep and duplicate
logic that could drift out of sync with the adapter's pattern list). Truncating redacted text cannot
re-expose anything, so this boundary placement is safe by construction. **CA-required constraint:**
we trust this boundary internally, but user-facing wording must never assert it as a guarantee (no
"완전한 redaction 보장" / "전체 로그는 안전합니다" style phrasing) — see §5.2 item 7.

**Q4. How do exitCode≠0 and timeout/system-failure differ in the reply?**
They already differ in *meaning* (ADR-0033: a ran-but-failed command is a **product result**, not a
bot error) but not yet in *detail*. This sprint keeps that meaning split and adds detail to both
sides distinctly: `FAILED` (ran, exit≠0) still goes through `composeTestResult` — now with exit
code + duration + excerpt — still framed as a result, still `RuntimeTurnStatus = 'RESPONDED'`.
`TIMED_OUT` (never produced a real exit) gets the **new** `composeTestTimedOut` — framed as the
process being killed, not as a failing test, **no exitCode shown, no "configured timeout" claim**
(§5.3), still `RuntimeTurnStatus = 'FAILED'` (no behavior change to the turn-status contract, only
to the reply text/detail). No-`CommandExecution` stays on `composeCommandUnavailable`, unchanged,
since there are no facts to show.

**Q5. How does the `ResponseComposer` API change?**
`composeTestResult` gains a `detail: TestResultDetail & { passed: boolean }` parameter, replacing
today's bare `passed`/`kind` pair (one call site, one test file — changed directly, no shim, per
project convention on avoiding back-compat scaffolding). One new method, `composeTestTimedOut`.
`composeCommandUnavailable`, `composeError`, `composeApprovalNotice`, etc. are untouched.

**Q6. Where does Runtime framing stop and Composer wording start?**
Same boundary ADR-0032/ADR-0033 already established, restated precisely for this sprint: **Runtime
decides which case applies** (`SUCCEEDED`/`FAILED`/`TIMED_OUT`/no-exec) and **assembles raw facts**
into `TestResultDetail` — it does not truncate, count lines, or write Korean text. **Composer owns
all text shaping**, including the last-N-lines/max-chars summarization (§5.2) and the truncation
notice — because "how much of this output is safe/useful to show in a chat bubble" is a rendering
decision, not a fact about the execution. This keeps the invariant "reply text is built only by
`ResponseComposer`" (ADR-0032 §10) intact — summarization is text-building.

## 7. Case matrix (reply framing)

| `CommandExecution.status` | Facts available | Composer method | Framing |
|---|---|---|---|
| `SUCCEEDED` | full | `composeTestResult` (`passed: true`) | product result — success + detail |
| `FAILED` (ran, exit≠0) | full | `composeTestResult` (`passed: false`) | product result — failure + detail (not a system error) |
| `TIMED_OUT` | command/args/durationMs (no exitCode) | `composeTestTimedOut` | distinct — process killed, not a test verdict; exitCode never shown |
| no `CommandExecution` (gate refusal / spawn error) | none | `composeCommandUnavailable` | unchanged — generic, no detail to show |

## 8. Validation Strategy (tests to add/change at implementation — Node 22)

**Test approach (CA-required, Option A):** the output-summary helper stays a **private** function
inside `response-composer.ts`. It is exercised **indirectly**, through the rendered
`OutboundMessage.text` of `composeTestResult`/`composeTestTimedOut` — the product surface (final
text) is what matters, not the helper's internal shape.

New/updated, in `response-composer.test.ts` (new file — did not exist before this sprint):
1. `composeTestResult` success — text contains command, duration, exitCode, and the excerpt.
2. `composeTestResult` failure — text contains command, duration, non-zero exitCode, and the excerpt.
3. Short output → shown, no truncation notice.
4. Output >20 lines → tail kept, truncation notice present.
5. One huge line (>1200 chars, ≤20 lines) → tail kept (char-capped), truncation notice present.
6. Stream carrying the adapter's `…[truncated]` marker → truncation notice present (via the rendered
   text), even absent a chat-level cut.
7. stdout preferred over stderr when both are non-empty.
8. stdout selected but stderr also non-empty → omitted-stream notice line present.
9. stdout empty → stderr selected (and shown).
10. No output on either stream → graceful "출력 없음"-style line, not an empty block.
11. `composeTestTimedOut` — does not claim pass/fail, does not show `exitCode`, does not claim a
    "configured timeout" value.
12. Full rendered text (surrounding sentences + fenced excerpt) stays under ~1900 chars even at max
    excerpt size — regression guard for the Discord 2000-char limit.

Updated, in `conversation-runtime.test.ts` (existing cases at lines ~352-383 change expectations,
not behavior contracts):
13. "tests pass" / "tests fail" cases: still `status: 'RESPONDED'`, still contain 통과/실패; runtime
    passes a `TestResultDetail` (command/args/exitCode/durationMs/stdout/stderr/kind) to the composer
    instead of bare `passed`/`kind` — `commandExecutions.get` call shape unchanged.
14. "command could not run (timeout)" case: **expectation changes** — currently asserts the reply
    equals `composeCommandUnavailable(...)`'s text; after this sprint it must equal
    `composeTestTimedOut(...)`'s text instead. `status` stays `'FAILED'`.
15. No new case for "no `CommandExecution` at all" is needed — behavior there is unchanged
    (`composeCommandUnavailable`, untouched).
16. `pnpm typecheck` + `pnpm test` green on **Node 22**.

## 9. Architecture Impact / Reuse

- **Reuses, unchanged:** `domain/command-execution.ts`, `command-execution-manager.ts`,
  `execution-orchestrator.ts`, `command-runner.port.ts`, `packages/command-local` (masking/capping),
  storage/repositories, the `commandExecutions.get` read path, `IntentClassifier`/`IntentResolver`,
  `ExecutionOrchestrator` contract, `RuntimeTurnStatus`/`ExecutionOutcomeStatus` enums.
- **Changes:** `response-composer.ts` (new DTO + summarization helper + one changed signature + one
  new method), `conversation-runtime.ts` (`frameTestResult` three-way branch instead of two-way).
- **No new** aggregate / repository / migration / capability / port. **No** `Core` or
  `ExecutionOrchestrator` contract change.

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Excerpt accidentally too long for the platform message limit | Low | Char cap (1200) chosen with headroom under Discord's 2000-char limit; deterministic, tested |
| Summarization logic silently duplicates/drifts from the adapter's masking | Low | §6 Q3: explicit no-second-masking-pass decision; summarization is a pure length transform over already-safe text |
| `TIMED_OUT` reply gets read as a test failure ("결과") | Med (Product) | Q4: `composeTestTimedOut` is deliberately NOT phrased as a pass/fail verdict |
| Existing timeout test assertion breaks silently | Low | Called out explicitly in §8 item 9 as a known, intentional expectation change |
| Scope creep into showing both stdout+stderr combined | Low | §5.2 stream-choice rule is explicit and single-stream, decided up front |

## Chief Architect Review

**APPROVED WITH CHANGES.** All six required changes above (§5.2 item 6/7/8, §5.3 timeout wording +
message-length defense, §8 Option A test approach) are incorporated into this plan. Proceeding to
implementation: author ADR-0034, implement the approved scope only, add/update tests per §8, validate
on Node 22, open a PR for Chief Architect Implementation Review.

## Next Step

Implementation on branch `v2/test-result-detail-ux`; no scope beyond §2/§5. PR opened for CA
implementation review before merge.
