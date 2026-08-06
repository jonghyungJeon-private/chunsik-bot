import { createHash } from 'node:crypto';

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const b = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

export function canonicalize(value: unknown): string {
  const visit = (candidate: unknown): string => {
    if (typeof candidate === 'string' || typeof candidate === 'boolean') return JSON.stringify(candidate);
    if (typeof candidate === 'number') {
      if (!Number.isSafeInteger(candidate)) throw new Error('CANONICAL_INTEGER_REQUIRED');
      return String(candidate);
    }
    if (Array.isArray(candidate)) return `[${candidate.map(visit).join(',')}]`;
    if (candidate === null || typeof candidate !== 'object') throw new Error('CANONICAL_VALUE_REJECTED');
    const object = candidate as Readonly<Record<string, unknown>>;
    const keys = Object.keys(object).sort(compareCodePoints);
    return `{${keys.map((key) => {
      const entry = object[key];
      if (entry === undefined) throw new Error('CANONICAL_UNDEFINED_REJECTED');
      return `${JSON.stringify(key)}:${visit(entry)}`;
    }).join(',')}}`;
  };
  return visit(value);
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
