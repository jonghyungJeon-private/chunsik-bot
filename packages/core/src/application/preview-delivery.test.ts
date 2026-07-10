import { describe, expect, it } from 'vitest';
import { buildCanonicalDiff, splitCanonicalDiff, type PreviewFile } from './preview-delivery';

/** Reconstruction invariant (CA RC3): the payload segments concatenate to the original, byte-for-byte. */
const reconstructs = (canonical: string, budget: number): boolean => {
  const r = splitCanonicalDiff(canonical, budget);
  return r.kind === 'segments' && r.segments.join('') === canonical;
};

describe('preview-delivery — canonical diff (Sprint 4c-Follow-up-5, F5-A/F5-B)', () => {
  const fileBlock = (path: string, lines: string[]): string =>
    [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, '@@ -0,0 +1,' + lines.length + ' @@', ...lines.map((l) => `+${l}`)].join('\n') + '\n';

  it('buildCanonicalDiff normalizes each file block to exactly one trailing newline, in order', () => {
    const files: PreviewFile[] = [
      { path: 'a.ts', changeKind: 'add', unifiedDiff: '@@ -0,0 +1 @@\n+a' }, // no trailing newline
      { path: 'b.ts', changeKind: 'add', unifiedDiff: '@@ -0,0 +1 @@\n+b\n' }, // already terminated
    ];
    const canonical = buildCanonicalDiff(files);
    expect(canonical).toBe('@@ -0,0 +1 @@\n+a\n@@ -0,0 +1 @@\n+b\n');
  });

  it('empty diff → no segments', () => {
    expect(splitCanonicalDiff('', 100)).toEqual({ kind: 'segments', segments: [] });
  });

  it('empty/zero budget → attachment-required', () => {
    expect(splitCanonicalDiff('anything', 0)).toEqual({ kind: 'attachment-required', reason: 'empty-budget' });
  });

  it('under budget → a single segment equal to the input', () => {
    const canonical = fileBlock('a.ts', ['one', 'two']);
    const r = splitCanonicalDiff(canonical, 10_000);
    expect(r).toEqual({ kind: 'segments', segments: [canonical] });
  });

  it('over budget → multiple segments that reconstruct the input byte-for-byte', () => {
    const canonical = fileBlock('big.ts', Array.from({ length: 200 }, (_, i) => `line ${i} content`));
    const r = splitCanonicalDiff(canonical, 300);
    expect(r.kind).toBe('segments');
    if (r.kind === 'segments') {
      expect(r.segments.length).toBeGreaterThan(1);
      expect(r.segments.every((s) => s.length <= 300)).toBe(true);
      expect(r.segments.join('')).toBe(canonical); // byte-for-byte
    }
  });

  it('prefers a file boundary: a two-file diff splits at the file break when it fits better', () => {
    const a = fileBlock('a.ts', Array.from({ length: 8 }, (_, i) => `a${i}`));
    const b = fileBlock('b.ts', Array.from({ length: 8 }, (_, i) => `b${i}`));
    const canonical = a + b;
    const r = splitCanonicalDiff(canonical, a.length + 20); // room for ~one file per segment
    expect(r.kind).toBe('segments');
    if (r.kind === 'segments') {
      expect(r.segments.join('')).toBe(canonical);
      // the second file's header should start a segment (not be glued mid-way into file a's segment)
      expect(r.segments.some((s) => s.startsWith('diff --git a/b.ts'))).toBe(true);
    }
  });

  it('a single diff line longer than the budget → attachment-required (never a mid-line split)', () => {
    const canonical = `@@ -0,0 +1 @@\n+${'X'.repeat(500)}\n`;
    expect(splitCanonicalDiff(canonical, 100)).toEqual({ kind: 'attachment-required', reason: 'line-exceeds-budget' });
  });

  it('Korean + emoji content is preserved byte-for-byte across segments', () => {
    const canonical = fileBlock('한글.ts', ['한국어 라인 하나 😀', '두 번째 줄 🚀', '세 번째 라인 ✅']);
    expect(reconstructs(canonical, 40)).toBe(true);
  });

  it('every non-attachment split reconstructs exactly (fuzz over budgets)', () => {
    const canonical = fileBlock('f.ts', Array.from({ length: 60 }, (_, i) => `content line number ${i}`));
    for (const budget of [50, 80, 120, 200, 512, 1024]) {
      const r = splitCanonicalDiff(canonical, budget);
      if (r.kind === 'segments') expect(r.segments.join(''), `budget=${budget}`).toBe(canonical);
    }
  });
});
