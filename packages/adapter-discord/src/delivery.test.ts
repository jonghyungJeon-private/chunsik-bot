import { describe, expect, it } from 'vitest';
import {
  chunkText,
  deliverChunks,
  deliverWithNotice,
  DISCORD_SAFE_LIMIT,
  PARTIAL_FAILURE_NOTICE,
} from './delivery';

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
  });

  it('uses the Discord-safe default limit', () => {
    expect(chunkText('y'.repeat(DISCORD_SAFE_LIMIT + 10)).every((c) => c.length <= DISCORD_SAFE_LIMIT)).toBe(true);
  });
});

describe('deliverChunks', () => {
  it('numbers multi-chunk replies (i/N) and sends in order', async () => {
    const sent: string[] = [];
    const report = await deliverChunks('abcabcabc', async (c) => {
      sent.push(c);
    }, { maxLen: 3 });
    expect(report).toMatchObject({ ok: true, totalChunks: 3, sent: 3 });
    expect(sent).toEqual(['(1/3) abc', '(2/3) abc', '(3/3) abc']);
  });

  it('does not number a single chunk', async () => {
    const sent: string[] = [];
    await deliverChunks('hello', async (c) => {
      sent.push(c);
    });
    expect(sent).toEqual(['hello']);
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
    expect(report.sent).toBe(1);
    expect(report.error).toContain('discord 500');
    expect(attempts).toHaveLength(2); // third chunk never attempted
  });
});

describe('deliverWithNotice', () => {
  it('does not notify on success', async () => {
    const notified: string[] = [];
    const report = await deliverWithNotice('hi', async () => {}, async (m) => {
      notified.push(m);
    });
    expect(report.ok).toBe(true);
    expect(notified).toEqual([]);
  });

  it('sends the partial-failure notice exactly once on failure', async () => {
    const notified: string[] = [];
    const report = await deliverWithNotice(
      'aaabbb',
      async () => {
        throw new Error('send down');
      },
      async (m) => {
        notified.push(m);
      },
      { maxLen: 3 },
    );
    expect(report.ok).toBe(false);
    expect(notified).toEqual([PARTIAL_FAILURE_NOTICE]);
  });

  it('swallows a failing notice (no throw)', async () => {
    const report = await deliverWithNotice(
      'aaabbb',
      async () => {
        throw new Error('send down');
      },
      async () => {
        throw new Error('notice down');
      },
      { maxLen: 3 },
    );
    expect(report.ok).toBe(false);
  });
});
