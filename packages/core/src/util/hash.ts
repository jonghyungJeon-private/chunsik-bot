/**
 * Deterministic, dependency-free content hash (two FNV-1a passes → 64-bit hex).
 * Used for a content **revision** fingerprint (e.g. a PatchSet's operations), not
 * for security. Kept pure (no `node:crypto`) to preserve core's purity.
 */
export function contentHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = (0x811c9dc5 ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c;
    h2 = Math.imul(h2, 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
