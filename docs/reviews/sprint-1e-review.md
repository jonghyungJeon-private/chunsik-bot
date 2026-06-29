# Sprint 1e Review

## Objective

"한 세션 안에서 직전 대화 맥락을 다음 Claude 응답에 최소한으로 반영한다." — persist
the user message and the assistant response as short-term memory, and include the
recent same-session turns in the next prompt. (Plus the two carryover 1d items:
chunk numbering and a partial-send-failure notice.)

## Scope

- Store inbound USER message + assistant RESPONSE as SHORT_TERM memory (session-scoped, role in metadata).
- `ContextBuilder` includes recent N=10 same-session SHORT_TERM turns, simply truncated.
- `PromptComposer` renders them into the conversation/context layer.
- Chunk numbering `(i/N)` for multi-message replies; partial-send-failure notice.
- ADR-0017 + review. (No vector search, long-term, or summarization.)

## Files Changed

**Core:**
- `application/memory-manager.ts` — `recordShortTerm(message, sessionId?)` + new
  `recordAssistant(text, context, sessionId?)` via private `saveShortTerm(role,…)`;
  role in metadata; **no provider id stored**.
- `application/context-builder.ts` — session-scoped retrieval (channel fallback),
  `role: text` formatting, truncation (`MAX_MEMORY_CHARS = 400`, `RECENT_LIMIT = 10`).
- `application/orchestrator.ts` — record user with `session.id`; record the assistant
  response after `completeRun`.

**Adapter (`@chunsik/adapter-discord`):**
- `delivery.ts` — `(i/N)` numbering for ≥2 chunks; `PARTIAL_FAILURE_NOTICE` +
  `deliverWithNotice` (one best-effort notice on partial failure, no resend).
- `index.ts` — `sendMessage` uses `deliverWithNotice`; the notice send self-logs on failure.

**Storage:** `storage-sqlite/src/index.ts` — `memories.session_id` column (+ defensive
`ALTER` migration); save/findByScope filter by `sessionId`.

**App:** `main.ts` — startup log string.
**Tests:** `memory-manager.test.ts` *(new)*; `context-builder.test.ts`, `delivery.test.ts` updated.
**Docs:** `DECISIONS.md` (ADR-0017), `CHANGELOG.md`, `CURRENT_STATE.md`, this review.

## Architecture Impact

Conforms to `ARCHITECTURE.md`. Memory is core domain; retrieval is session-scoped
through ports. Chunk numbering / partial-failure notice are **Discord-specific and
stay in the adapter** — the core never knows about chunks. No core contract changed
(only additive method params / a new memory column).

## ADR Impact

**Added ADR-0017** (conversation memory policy). Carryover delivery items are covered
by **ADR-0016**. No existing ADR amended.

## Runtime Flow

```
handleInboundMessage:
  resolve Actor → open Session(sid) → memory.recordShortTerm(userMsg, sid)  [role=user]
  classify → createTask(sid) → plan → executeTask:
    ContextBuilder.build(task): recentShortTerm({sessionId: sid}, 10) → "role: text" (truncated)
    PromptComposer.compose → PromptSpec.context = recent turns
    ClaudeCliProvider.execute → answer
    completeRun → memory.recordAssistant(answer, ctx, sid)  [role=assistant]
    ResponseComposer → DiscordPlatformAdapter.sendMessage:
      deliverWithNotice → deliverChunks ((i/N) if ≥2) ; on partial failure → one notice
```

## Persistence Result (SQLite memory)

Two-turn live smoke, one session `b7e0c1cb…`:

| # | role | content (excerpt) |
|---|---|---|
| 1 | user | `춘식아 너 뭐야?` |
| 2 | assistant | `안녕하세요! 저는 **춘식이**예요 🐹 로컬에서 동작하는 AI 코딩…` |
| 3 | user | `방금 답변 한 줄로 줄여줘` |
| 4 | assistant | `로컬에서 동작하는 Claude 기반 AI 코딩 어시스턴트 춘식이예요 🐹` |

`memories=4` (all same session), `tasks=2 COMPLETED`, `task_runs=2 SUCCEEDED`
(`claude-cli`, dur 9378 / 7052 ms), `artifacts=2`. The **second answer is a one-line
shortening of the first** → recent session memory reached the prompt.

## Tests

`pnpm test` (Vitest) — **8 files, 41 tests, all passed**. New/updated:
- `memory-manager.test.ts`: records user+assistant scoped by session with role; recent
  turns oldest→newest with **session isolation**; **no providerId** stored.
- `context-builder.test.ts`: queries by `{sessionId}` (channel fallback), `role: text`
  formatting, long-content truncation.
- `delivery.test.ts`: `(i/N)` numbering for multi-chunk (none for single); `deliverWithNotice`
  sends the notice exactly once on failure and swallows a failing notice.

## Typecheck

`pnpm typecheck` → **PASS (exit 0)**.

## Memory / ContextBuilder Test Result

Covered above — persistence + session-scoped recall + truncation + role formatting all green.

## Live Smoke Test

Two messages in `#일반`: turn 2 ("방금 답변 한 줄로 줄여줘") produced a one-line summary of
turn 1 — confirming the previous user+assistant turns were carried into the prompt via
session-scoped SHORT_TERM memory.

## Risks

- Truncation (400 chars/turn) can drop detail from long prior turns.
- `memories` grows unbounded (no pruning yet) — future retention policy.
- Session = active session for the channel; a new session starts fresh (expected).

## Trade-offs

- Simple truncate over summarization (explicitly out of scope) — cheap, lossy.
- Role stored in `metadata` (not a typed column) — keeps the schema generic.
- Current user message is included in recent context AND the task layer (minor
  redundancy) — accepted for simplicity.

## Deferred

- Vector recall, long-term + summarized memory, retention/pruning.
- File-attachment delivery; bounded delivery resend (RetryPolicy ADR).
- Codex/Ollama + multi-provider fallback.

## Questions for Chief Architect

1. **Retention/pruning:** when should we cap or expire `memories` (per session count,
   age, or total size)?
2. **Context inclusion:** keep including the current user message in recent context, or
   exclude it (it already appears in the task layer)?
3. **Next sprint:** project memory / long-term, or Codex/Ollama fallback?
