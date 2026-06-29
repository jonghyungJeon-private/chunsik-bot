import { describe, expect, it } from 'vitest';
import { chunkText, deliverChunks, DISCORD_SAFE_LIMIT } from './delivery';

describe('chunkText', () => {
  it('returns [] for empty and a single chunk for short text', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('hello')).toEqual(['hello']);
  });

  it('splits long text into ≤ maxLen chunks without losing non-whitespace', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line-${i} some words here`).join('\n');
    const chunks = chunkText(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
    // No non-whitespace content lost.
    expect(chunks.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
  });

  it('prefers a newline boundary when one exists late in the window', () => {
    const text = `${'a'.repeat(70)}\n${'b'.repeat(70)}`;
    const chunks = chunkText(text, 100);
    expect(chunks[0]).toBe(`${'a'.repeat(70)}\n`);
    expect(chunks[1]).toBe('b'.repeat(70));
  });

  it('hard-cuts an over-long single token', () => {
    const chunks = chunkText('x'.repeat(250), 100);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(100);
    expect(chunks[2]).toHaveLength(50);
  });

  it('uses the Discord-safe default limit', () => {
    expect(chunkText('y'.repeat(DISCORD_SAFE_LIMIT + 10)).every((c) => c.length <= DISCORD_SAFE_LIMIT)).toBe(true);
  });
});

describe('deliverChunks', () => {
  it('sends all chunks in order and reports ok', async () => {
    const sentInOrder: string[] = [];
    const report = await deliverChunks('abcabcabc', async (c) => {
      sentInOrder.push(c);
    }, { maxLen: 3 });
    expect(report.ok).toBe(true);
    expect(report.totalChunks).toBe(3);
    expect(report.sent).toBe(3);
    expect(sentInOrder).toEqual(['abc', 'abc', 'abc']);
  });

  it('empty text → nothing sent, ok', async () => {
    let calls = 0;
    const report = await deliverChunks('', async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
    expect(report).toMatchObject({ totalChunks: 0, sent: 0, ok: true });
  });

  it('stops on the first send failure and reports partial delivery (no resend)', async () => {
    const attempts: string[] = [];
    const report = await deliverChunks(
      'aaabbbccc',
      async (c) => {
        attempts.push(c);
        if (attempts.length === 2) throw new Error('discord 500');
      },
      { maxLen: 3 },
    );
    expect(report.ok).toBe(false);
    expect(report.sent).toBe(1); // first chunk succeeded, second failed
    expect(report.error).toContain('discord 500');
    expect(attempts).toHaveLength(2); // stopped — third chunk never attempted
  });
});
