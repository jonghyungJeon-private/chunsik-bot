# Sprint 1c Review

## Objective

"Claude CLI가 없거나, 인증이 안 되었거나, timeout/error가 발생해도 Chunsik이
제품처럼 실패한다." — classify provider failures, reply to the user kindly, and
record a FAILED `TaskRun` with an error summary + duration. No secrets in argv or
logs.

## Scope

- `AiFailureKind` taxonomy: `UNAVAILABLE | AUTH_REQUIRED | TIMEOUT |
  EXECUTION_FAILED | EMPTY_OUTPUT`.
- `ClaudeCliProvider.execute` throws a classified `AiProviderError` (timeout, spawn
  failure, auth stderr, non-zero exit, empty stdout).
- Core maps the kind → friendly Discord message; `TaskRun` FAILED + `error` summary
  + `durationMs`; the user always gets a reply (no rethrow).
- stderr secret-masking; prompt stays on stdin; user messages carry no technical detail.
- Vitest expanded; ADR-0015.

## Files Changed

**Core:**
- `domain/enums.ts` — `AiFailureKind` enum.
- `domain/task.ts` — `TaskRun.durationMs?`.
- `errors.ts` — `AiProviderError(kind, message)`.
- `application/ai-failure.ts` *(new)* — `describeAiFailure(err)` → `{ kind, userMessage,
  errorSummary }`; core owns the user-facing copy.
- `application/orchestrator.ts` — failure path: classify → `failRun(summary, {providerId})`
  → FAILED → send friendly `composeError` reply (best-effort), no rethrow.
- `application/task-manager.ts` — `completeRun`/`failRun` record `durationMs`;
  `failRun` accepts `{providerId}`.
- `application/response-composer.ts` — `composeError(context, userMessage)`.
- `application/index.ts` — export `ai-failure`.

**Adapter:**
- `ai-cli/src/index.ts` — `ClaudeCliProvider.execute` throws `AiProviderError` per
  taxonomy (+ `classifyStderr` auth vs execution); empty stdout → `EMPTY_OUTPUT`.

**Tests:** `ai-cli/src/index.test.ts` (failure kinds + masking), `ai-failure.test.ts` *(new)*.
**Docs:** `DECISIONS.md` (ADR-0015), `CHANGELOG.md`, `CURRENT_STATE.md`, this review.

## Architecture Impact

Conforms to `ARCHITECTURE.md`. The failure taxonomy is **provider-agnostic** (in
core); the core maps `AiFailureKind` → UX, with **no provider-id branching**. CLI
specifics stay in `@chunsik/ai-cli`. Core still depends only on ports. No new port;
`AiProviderError`/`AiFailureKind` are core types the adapter imports.

## ADR Impact

**Added ADR-0015** — accepts global `~/.claude` context in v1 (neutral cwd retained,
no `--bare`, isolated mode deferred) + the failure taxonomy, masking, and minimal
usage (`providerId` + `durationMs`). No existing ADR amended.

## Runtime Flow

```
… ChunsikCore.executeTask:
   route(capability) → provider (providerId captured)
   provider.execute(promptSpec):
     timeout                 → AiProviderError(TIMEOUT)
     spawn failure (code null) → AiProviderError(UNAVAILABLE)
     non-zero + auth stderr  → AiProviderError(AUTH_REQUIRED)
     non-zero (other)        → AiProviderError(EXECUTION_FAILED)
     exit 0 but empty stdout → AiProviderError(EMPTY_OUTPUT)
   catch:
     describeAiFailure(err) → { kind, userMessage, errorSummary }
     tasks.failRun(run, errorSummary, {providerId})  → TaskRun FAILED + durationMs
     tasks.transition(task, FAILED)
     platform.sendMessage(composer.composeError(ctx, userMessage))   ← user always replied
   (router NoProviderAvailableError → UNAVAILABLE, same path)
```

## Persistence Result

Simulated smoke (real ChunsikCore + failing CLI runner, temp SQLite), one message
per kind:

| scenario | task | run | durationMs | error summary | reply |
|---|---|---|---|---|---|
| timeout | FAILED | FAILED | number | `TIMEOUT: claude CLI timed …` | 응답이 너무 오래 걸려서 멈췄어요… |
| unavailable | FAILED | FAILED | number | `UNAVAILABLE: claude CLI co…` | 지금은 AI를 사용할 수 없어요… |
| auth | FAILED | FAILED | number | `AUTH_REQUIRED: claude CLI …` | AI 인증이 필요해요. 관리자가 Claude… |
| execution | FAILED | FAILED | number | `EXECUTION_FAILED: claude C…` | 처리 중 문제가 발생했어요… |
| empty | FAILED | FAILED | number | `EMPTY_OUTPUT: claude CLI r…` | AI가 빈 응답을 반환했어요… |

**TOTALS:** tasks=5, runs=5, failed=5, artifacts=0 (failures persist no artifact).

## Tests

`pnpm test` (Vitest) — **6 files, 24 tests, all passed**:
- `ClaudeCliProvider` (9): success + command construction; TIMEOUT / UNAVAILABLE /
  AUTH_REQUIRED / EXECUTION_FAILED / EMPTY_OUTPUT classification; `AiProviderError`
  instance; `isAvailable`; `maskSecrets` redaction.
- `describeAiFailure` (4): kind→message mapping, `NoProviderAvailableError`→UNAVAILABLE,
  unknown→EXECUTION_FAILED (no raw leak into userMessage), summary length cap.
- Plus prior `RiskPolicy`, `PromptComposer`, `ContextBuilder`, `CapabilityRouter`.

## Typecheck

`pnpm typecheck` → **PASS (exit 0)**.

## Live / Simulated Smoke Test

**Simulated smoke** (allowed for 1c): the real `ChunsikCore` pipeline was driven with
a failing `CliRunner` injected into `ClaudeCliProvider` for all five kinds. Every run
ended `FAILED` with an error summary + `durationMs`, **no artifact**, and the captured
outbound was the kind-specific friendly message (see Persistence Result). The success
path (real `claude -p`) remains validated from Sprint 1b-2.

## Risks

- Global `~/.claude/CLAUDE.md` + auto-memory still load (no `--bare`, OAuth) — accepted
  in v1 (ADR-0015); only repo CLAUDE.md is blocked via neutral cwd.
- `classifyStderr` is heuristic; an auth failure with unusual wording may fall back to
  EXECUTION_FAILED (still a graceful, user-friendly failure — just a less specific message).
- No alternate provider: Claude unavailable ⇒ UNAVAILABLE message (Codex/Ollama fallback deferred).

## Trade-offs

- Failure UX text lives in the **core** (`describeAiFailure`), keyed by kind, so the
  provider only classifies — cleaner separation, single place for copy.
- Orchestrator **swallows** the failure (no rethrow) to reply product-like; the FAILED
  TaskRun + logs preserve the audit trail.
- Heuristic stderr classification over parsing structured output (kept text output per decision 2).

## Deferred

- Isolated Claude-context mode (no global `~/.claude`) for team/SaaS.
- Codex/Ollama providers + multi-provider fallback (Sprint 1d+).
- `--output-format json`, token/cost usage (beyond `durationMs`).
- Retry/backoff policy; partial/streaming replies.

## Questions for Chief Architect

1. **Retry policy:** should TIMEOUT / transient EXECUTION_FAILED auto-retry once before
   replying FAILED, or always fail-fast in v1?
2. **AUTH_REQUIRED routing:** should an auth failure additionally notify an admin
   channel (vs. only the requesting user)?
3. **Sprint 1d:** proceed to Codex/Ollama + fallback, or harden other surfaces
   (e.g., long-reply chunking, rate limiting) first?
