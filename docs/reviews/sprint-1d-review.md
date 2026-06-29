# Sprint 1d Review

## Objective

"Claude가 긴 응답을 생성하거나 Discord 제한에 걸려도 Chunsik이 안정적으로 응답한다." —
chunk responses under Discord's 2000-char limit, send them sequentially, handle
send failures gracefully, and keep the typing indicator alive during long runs.

## Scope

- Chunk responses at a Discord-safe limit; sequential multi-message send.
- Graceful send-failure handling + minimal rate-limit defense (delegated to discord.js).
- Keep "is typing…" alive across ~50–70s runs (refresh under the ~10s TTL).
- Response-format cleanup (trim + non-empty fallback).
- File-attachment for very long responses: **seam/policy only** (deferred).
- ADR-0016 + review.

## Files Changed

**Adapter (`@chunsik/adapter-discord`) — all Discord specifics stay here:**
- `delivery.ts` *(new)* — pure `chunkText` (newline/space boundaries, hard-cut),
  `deliverChunks` (sequential, stop-on-first-failure, no resend), `DISCORD_SAFE_LIMIT`,
  `FILE_ATTACHMENT_CHUNK_THRESHOLD` (seam).
- `delivery.test.ts` *(new)* — chunking + send-failure tests.
- `index.ts` — `sendMessage` delivers via `deliverChunks` (logs chunk count / failure);
  `sendTyping` starts a **self-refreshing typing loop** (cleared on send / safety cap);
  `pumpTyping` / `clearTyping`; `stop()` clears timers; re-exports delivery helpers.

**Core:**
- `application/response-composer.ts` — trim + non-empty fallback.

**App:** `main.ts` — startup log string.
**Docs:** `DECISIONS.md` (ADR-0016), `CHANGELOG.md`, `CURRENT_STATE.md`, this review.

## Architecture Impact

Conforms to `ARCHITECTURE.md`. Chunking, send-failure handling, rate-limit reliance,
and the typing-indicator TTL are **Discord-specific and live in the adapter**; the
core still produces a plain `OutboundMessage` and knows nothing about 2000-char limits
or typing TTLs. No core contract changed.

## ADR Impact

**Added ADR-0016** — Discord response delivery policy (chunking, sequential send,
stop-on-failure with no resend, discord.js rate-limit reliance, typing refresh,
file-attachment seam). No existing ADR amended.

## Runtime Flow

```
ChunsikCore.executeTask → ResponseComposer.compose (trim) → PlatformAdapter.sendMessage
  DiscordPlatformAdapter.sendMessage(target):
    clearTyping(target)                         ← typing stops as the reply arrives
    chunkText(text, 1900) → [c1, c2, c3]
    deliverChunks: await channel.send(c1); send(c2); send(c3)   (sequential, in order)
      on first failure → stop + log (masked), report partial; no resend
    log "message delivered in chunks chunks=N"
  (meanwhile, from message receipt:)
  sendTyping(target) → pumpTyping now + setInterval(8s) refresh until sendMessage / cap
```

## Persistence Result

Live smoke (long answer): one Discord message →

| table | count | detail |
|---|---|---|
| tasks | 1 | `COMPLETED`, `GENERAL_CHAT` |
| task_runs | 1 | `SUCCEEDED`, `providerId=claude-cli`, `durationMs=71655`, `error=none` |
| artifacts | 1 | `MARKDOWN_REPORT`, **5351 chars** → delivered as **3 chunks** |

## Tests

`pnpm test` (Vitest) — **7 files, 32 tests, all passed**. New `delivery.test.ts` (8):
- `chunkText`: empty → []; short → 1 chunk; long → multiple ≤ maxLen with no
  non-whitespace loss; prefers newline boundary; hard-cuts an over-long token;
  honors `DISCORD_SAFE_LIMIT`.
- `deliverChunks`: ordered send + ok; empty → nothing sent; **stops on first failure**
  (sent count + error reported, remaining chunks not attempted — no resend).

## Typecheck

`pnpm typecheck` → **PASS (exit 0)**.

## Chunking / Send-failure Test Result

- Chunking: deterministic unit tests (above) — boundary preference, hard-cut, ≤ limit.
- Send failure: simulated via an injected sender that throws on the 2nd chunk →
  `ok=false`, `sent=1`, error captured, **3rd chunk never attempted** (stop, no resend).

## Live Smoke Test

`#일반`에 긴 답변 요청 → Claude 5351자 응답 → 어댑터가 **3개 메시지로 순차 전송**
(`message delivered in chunks chunks=3`), task `COMPLETED` / run `SUCCEEDED`
(`durationMs=71655`). Typing-indicator refresh shipped in this build; the prior run
showed the gap (single 10s indicator vs ~50–70s run) which this sprint fixes.

## Risks

- Partial delivery: a mid-sequence send failure leaves earlier chunks delivered
  (logged; AI run remains COMPLETED). No resend by design (avoids duplicates).
- Typing loop is capped (~128s) so it can't leak; if a run somehow exceeds it the
  indicator stops before the (timed-out) reply.
- Very long answers produce several messages until the file-attachment seam is built.

## Trade-offs

- No manual send resend → rely on discord.js for rate-limit backoff; trades
  "best-effort redelivery" for "no duplicate messages" (matches the retry concern).
- Typing refresh is adapter-internal timer state (not a core concern) — keeps the
  TTL detail out of the core at the cost of a little adapter statefulness.
- Chunk boundaries are plain (no "(1/N)" numbering) to keep messages clean in v1.

## Deferred

- File-attachment delivery for very long responses (seam only).
- Chunk numbering / richer formatting; bounded delivery resend (RetryPolicy ADR).
- Codex/Ollama + multi-provider fallback (Sprint 1d+ per prior decision).

## Questions for Chief Architect

1. **File-attachment threshold:** at how many chunks (or chars) should we switch to a
   single file attachment — and is that the next sprint?
2. **Chunk numbering:** add "(1/N)" prefixes for multi-message replies, or keep clean?
3. **Partial-delivery UX:** on a send failure mid-sequence, should the bot post a short
   "응답 일부만 전송됨" notice, or stay silent (logged only)?
