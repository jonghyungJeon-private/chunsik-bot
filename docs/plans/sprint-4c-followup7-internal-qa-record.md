# Sprint 4c Follow-up-7 (F7) — Independent Internal QA Record

Adversarial, independent QA of the F7 production fix (misrouted preview request →
GENERAL_CHAT → `InvalidTaskTransitionError: PENDING -> RUNNING` crash → user got no
response). Reviewer distrusted the summary and verified by reading code and running
tests. This record is preserved as the completion artifact.

## REVIEWED_STATE
- Base: `da6bee74bc06c304009296800a0a44acc79890ae` (HEAD of `main`).
- Work under review: UNCOMMITTED working tree (never committed / pushed by QA).
- Modified (tracked) production `.ts`: `conversation-runtime.ts`, `intent-classifier.ts`,
  `orchestrator.ts`, `response-composer.ts`, `index.ts`.
- New (untracked) production: `packages/core/src/application/safe-error.ts`.
- Modified/new tests: `conversation-runtime.test.ts`, `intent-classifier.test.ts`,
  new `orchestrator.test.ts`, new `safe-error.test.ts`.
- QA writes: this record only. A throwaway probe (`/tmp/f7probe.mjs`) was created,
  run, and deleted — repo tree left clean (no probe artifact in `git status`).

## NODE_VERSION
- `v22.22.1` (Node 22 per policy; nvm `use 22`). Not `.nvmrc`'s 18.

## PRODUCTION_DIFF (vs da6bee7 — files + one-line nature; F7-scope-only confirmed)
1. `packages/core/src/application/conversation-runtime.ts` (+32) — F7-A + F7-D. `handle()`
   is now a public try/catch wrapper delegating to renamed `handleInner()`; on ANY escaping
   error it logs internally (name/code/messageId/stack) and returns a sanitized `FAILED`
   TurnResult via `composeSanitizedError`. In `handleWorkTurn`, adds `transition(task,
   PLANNING)` before `transition(task, RUNNING)` so RUNNING is reached via the legal
   PENDING → PLANNING → RUNNING path.
2. `packages/core/src/application/intent-classifier.ts` (+4/-1) — F7-B. `previewWords`
   broadened: `(?:코드|파일|패치)\s*변경안` (was 파일-only) and optional `로|를` between
   미리보기 and 생성/만들/보여.
3. `packages/core/src/application/orchestrator.ts` (+28/-2) — F7-D. `ChunsikCore.handleInboundMessage`
   wraps `runtime.handle()` in try/catch backstop: on throw, logs internally and sends
   exactly ONE sanitized error via `formatSafeErrorText`; a delivery failure is `.catch`-logged
   only (no retry/recursion) and the method returns (no crash).
4. `packages/core/src/application/response-composer.ts` (+12) — F7-D. Adds
   `composeSanitizedError(context, safe, ctx)` → `{ context, text: formatSafeErrorText(...) }`.
5. `packages/core/src/application/index.ts` (+1) — barrel `export * from './safe-error'`.
6. `packages/core/src/application/safe-error.ts` (NEW, +73) — F7-D. `SafeError {code,message}`,
   `toSafeError` (maps by Error NAME only), `formatSafeErrorText`, `safeRequestId`.

Verdict: every change is within the stated F7 scope. NO unrelated production change was
found (no dependency-direction violations, no touched adapters/apps, no behavior change
outside the failure/preview-routing paths).

## LEAKAGE_ANALYSIS (can any raw / stack / secret reach the user?) — NO
Evidence, code path by code path:
- `toSafeError(err)` reads ONLY `err.name` (`err instanceof Error ? err.name : ''`) and
  matches it against a fixed, ordered rule table; unknown → `UNKNOWN` (INTERNAL_ERROR). It
  NEVER copies `err.message`, `err.stack`, or any property carrying free text into the output.
  Output is one of 5 fixed `{code, message}` constants (Korean, non-secret).
- `formatSafeErrorText` builds the user text from ONLY: fixed template strings, `safe.message`
  (fixed constant), `safe.code` (fixed constant), and optional `ctx.stage` / `ctx.requestId`.
  In every F7 call site `stage` is not supplied from error data, and `requestId` is
  `safeRequestId(message.id)` = `req-` + last 6 alphanumerics of the platform message id
  (all non-alnum stripped) — never a secret.
- `handle()` catch and the `ChunsikCore` backstop pass ONLY `{ requestId }` (no raw text).
  The full exception + stack go exclusively to `logger.error(...)` (internal stdout/stderr
  sink), never into any OutboundMessage.
- The OutboundMessage `context` field carries routing metadata (platform/channel/user), not
  the raw error, and is not rendered into user text.
- INDEPENDENT PROBE (dist): `toSafeError(new Error('password=hunter2 /abs/key.pem token=ghp_ABC123
  SELECT * FROM users'))` → code `INTERNAL_ERROR`; rendered text scanned for
  `[password, hunter2, key.pem, /abs, ghp_ABC123, SELECT, "FROM users", token=]` →
  `LEAKED_TOKENS = []`. `InvalidTaskTransitionError('PENDING','RUNNING')` → rendered text does
  NOT contain its raw `Illegal task transition` message (rawLeaked=false). `safeRequestId`
  reduced a Discord-style id to `req-153367`.
Conclusion: no raw exception text, stack frame, token, key, absolute secret path, env value,
provider payload, or SQL can reach the user-facing response through any F7 path.

## DELIVERY_SEMANTICS (exactly-once / no-recursion / survives) — HOLDS
- Normal path: `handle()` returns FAILED (or any) TurnResult → `ChunsikCore` calls
  `sendMessage(result.reply)` exactly once. (orchestrator.test.ts case 3 + conversation-runtime
  F7-D tests.)
- `handle()` throws (only possible if infra logger/composer itself throws — application errors
  are caught inside): backstop sends exactly one sanitized message. (orchestrator.test.ts case 1:
  1 send, resolves, no raw/stack, internal error logged.)
- Backstop `sendMessage` also throws: the failure is `.catch`-logged once, NO second send, method
  still resolves — no recursion, runtime alive. (orchestrator.test.ts case 2: sends length 1,
  ≥2 error logs incl. one containing "delivery".)
- No code path sends two error messages: the sanitized reply is produced in exactly one place
  per path (either the returned FAILED reply delivered by the normal `sendMessage`, or the
  backstop send — never both, because a throwing `handle()` skips the normal send via `return`).
- Runtime survives: conversation-runtime F7-E "failure" test reuses the SAME runtime instance —
  after a forced failed turn it handles a subsequent normal turn → RESPONDED with no residue.

## F7A_REALNESS (real map enforced? probe result) — REAL
- The real `TaskManager.TRANSITIONS` (task-manager.ts:15-36): `PENDING: [PLANNING, CANCELED]`
  (RUNNING absent → forbidden), `PLANNING: [WAITING_APPROVAL, RUNNING, FAILED, CANCELED]`
  (RUNNING present → legal). `transition()` throws `InvalidTaskTransitionError` when
  `!canTransition`.
- The new conversation-runtime tests wire the REAL `TaskManager` over an in-memory storage
  (`new TaskManager(storage)`), NOT a permissive fake, and assert the exact save history
  `[PENDING, PLANNING, RUNNING, COMPLETED]` for GENERAL_CHAT and PROJECT_ANALYSIS work turns,
  plus a regression guard that direct `transition(pending, RUNNING)` rejects with
  `InvalidTaskTransitionError`.
- INDEPENDENT PROBE (dist, real TaskManager + in-memory storage):
  `DIRECT_PENDING_TO_RUNNING_THROWS=true name=InvalidTaskTransitionError`;
  `PENDING→PLANNING→RUNNING` final `RUNNING`; `canTransition PENDING→RUNNING=false`,
  `PENDING→PLANNING=true`, `PLANNING→RUNNING=true`, `RUNNING→COMPLETED=true`,
  `RUNNING→FAILED=true`. Confirms the fix targets the real state machine and the work-turn
  error/success continuations remain legal.

## TEST_COMMANDS + PASS_FAIL_COUNTS (Node v22.22.1)
- `pnpm typecheck` → exit 0 (tsc -b, clean).
- Full `pnpm test` (via `rtk proxy pnpm test`) → exit 0; **Test Files 59 passed (59)**,
  **Tests 1250 passed (1250)**; duration ~30s. No failures, no regressions from the F7-A
  extra PLANNING transition or the new files.
- Focused `npx vitest run safe-error.test.ts orchestrator.test.ts conversation-runtime.test.ts
  intent-classifier.test.ts` → exit 0; **Test Files 4 passed (4)**, **Tests 482 passed (482)**.

## FALSIFICATION_ATTEMPTS
1. Can `handle()` still throw? Only if `deps.logger.error` (or, hypothetically, a broken
   `composer`) throws inside the catch — `toSafeError`/`formatSafeErrorText` are pure string
   ops and cannot throw on the mapped constants. Any APPLICATION error from `handleInner` is
   always caught. That residual infra-logger risk is exactly what the `ChunsikCore` backstop
   covers, so no unhandled application error escapes to the user. Verdict: design sound.
2. Does F7-A's PLANNING step break an existing flow? `handleWorkTurn` is reached ONLY for
   non-execution work (GENERAL_CHAT requiresWork, PROJECT_ANALYSIS); execution intents route
   through the separate `handleExecutionIntent`. The path is PENDING→PLANNING→RUNNING→COMPLETED
   (all legal), error branch RUNNING→FAILED (legal). Pre-F7 this path THREW under the real map,
   so F7-A fixes rather than breaks; the full 1250-test suite is green (no test asserted a
   2-transition count). Verdict: no regression.
3. Does broadened `previewWords` over-match? Minor, low-harm only. `(?:코드|파일|패치)\s*변경안`
   would route an analysis-style message that literally contains "코드/파일/패치 변경안" (e.g.
   "이 코드 변경안 설명해줘") to CODE_IMPLEMENTATION (preview). The `미리보기 ... 보여` alternative is
   tight (requires 미리보기 immediately followed by 생성/만들/보여 with only optional 로/를, so
   "미리보기 기능을 보여줘" does NOT match). Even when it over-matches, the preview pipeline is
   read-only and stops at an approval/preview gate (AWAITING_APPROVAL) with ZERO mutation, so
   the worst case is a benign preview offer, not a destructive action. Verdict: acceptable;
   noted, not a blocker.
4. Two error messages on one turn? No — a throwing `handle()` takes the backstop `return`
   branch (skipping the normal send); a returned FAILED result takes the normal send only.
   Mutually exclusive. Verified by tests + code read.
5. Secret via `stage`/`requestId`/`context`? `stage` is never fed from error data in F7 paths;
   `requestId` is sanitized to `req-<=6 alnum>`; `context` is routing metadata not rendered
   into text. No vector.

## DISCREPANCIES
- None material. One low-severity observation: the `(?:코드|파일|패치)\s*변경안` alternative can
  over-match analysis prose mentioning a "변경안"; harmless because the preview path is
  read-only and approval-gated (documented in FALSIFICATION_ATTEMPTS #3). Not a defect.

## VERDICT
`F7_INTERNAL_QA=PASS` — Production diff is F7-scope-only; no raw/stack/secret can reach the
user (probe: 0 leaked tokens); delivery is exactly-once with no recursion and the runtime
survives; F7-A enforces the REAL TaskManager map (probe: direct PENDING→RUNNING throws,
two-step succeeds); typecheck exit 0 and full suite 1250/1250 + focused 482/482 green on Node
v22.22.1.
