/**
 * Discord response delivery (ADR-0016). Pure, framework-free helpers so the
 * 2000-char limit, chunking, and send-failure handling are unit-testable without
 * a live gateway. Discord specifics stay in this adapter; the core never sees them.
 */

/** Safe per-message length (Discord hard limit is 2000; headroom for safety). */
export const DISCORD_SAFE_LIMIT = 1900;

/**
 * Policy seam: above this many chunks, the intended behavior is to deliver the
 * response as a FILE ATTACHMENT instead of many messages. NOT implemented in v1
 * (seam + policy only) — we still send chunks and log that the threshold was hit.
 */
export const FILE_ATTACHMENT_CHUNK_THRESHOLD = 5;

/**
 * Split text into ≤ maxLen pieces, preferring newline then space boundaries;
 * an over-long single token is hard-cut. Pure slicing — no non-whitespace is lost.
 */
export function chunkText(text: string, maxLen: number = DISCORD_SAFE_LIMIT): string[] {
  if (text.length === 0) return [];
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let rest = text;
  const minBoundary = Math.floor(maxLen * 0.6);

  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen);
    const nl = window.lastIndexOf('\n');
    const sp = window.lastIndexOf(' ');
    let cut = maxLen;
    if (nl >= minBoundary) cut = nl + 1;
    else if (sp >= minBoundary) cut = sp + 1;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

export interface DeliveryReport {
  totalChunks: number;
  sent: number;
  ok: boolean;
  error?: string;
}

export type ChunkSender = (chunk: string) => Promise<void>;

/**
 * Send `text` as ordered chunks via `send`. Sequential (awaits each before the
 * next, preserving order). On the first send failure it STOPS (partial delivery)
 * and reports — no resend, so no duplicate messages. Rate-limit backoff is
 * delegated to discord.js's REST layer (ADR-0016).
 */
export async function deliverChunks(
  text: string,
  send: ChunkSender,
  opts: { maxLen?: number } = {},
): Promise<DeliveryReport> {
  const chunks = chunkText(text, opts.maxLen ?? DISCORD_SAFE_LIMIT);
  const total = chunks.length;
  // Number multi-message replies so they read in order (single chunk = no prefix).
  const outgoing = total >= 2 ? chunks.map((c, i) => `(${i + 1}/${total}) ${c}`) : chunks;

  let sent = 0;
  for (const chunk of outgoing) {
    try {
      await send(chunk);
      sent += 1;
    } catch (err) {
      return {
        totalChunks: total,
        sent,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return { totalChunks: total, sent, ok: true };
}

/** Short notice shown once when delivery partially fails (ADR-0016 / decision 3). */
export const PARTIAL_FAILURE_NOTICE = '답변 일부를 전송하지 못했어요.';

/**
 * Deliver chunks; if delivery partially fails, attempt the short notice ONCE
 * (no resend, no retry). A failing notice is swallowed (caller logs).
 */
export async function deliverWithNotice(
  text: string,
  send: ChunkSender,
  notify: (message: string) => Promise<void>,
  opts: { maxLen?: number } = {},
): Promise<DeliveryReport> {
  const report = await deliverChunks(text, send, opts);
  if (!report.ok) {
    await notify(PARTIAL_FAILURE_NOTICE).catch(() => undefined);
  }
  return report;
}
