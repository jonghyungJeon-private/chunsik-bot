import { createHash } from 'node:crypto';

export class CanonicalizationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const b = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

export function canonicalize(value: unknown): string {
  const active = new WeakSet<object>();
  const visit = (candidate: unknown): string => {
    if (typeof candidate === 'string' || typeof candidate === 'boolean') return JSON.stringify(candidate);
    if (typeof candidate === 'number') {
      if (!Number.isSafeInteger(candidate) || Object.is(candidate, -0)) {
        throw new CanonicalizationError('CANONICAL_INTEGER_REQUIRED');
      }
      return String(candidate);
    }
    if (candidate === null || typeof candidate !== 'object') {
      throw new CanonicalizationError('CANONICAL_VALUE_REJECTED');
    }
    if (active.has(candidate)) throw new CanonicalizationError('CANONICAL_CYCLE_REJECTED');
    active.add(candidate);
    try {
      if (Array.isArray(candidate)) {
        for (let index = 0; index < candidate.length; index += 1) {
          if (!Object.prototype.hasOwnProperty.call(candidate, index)) {
            throw new CanonicalizationError('CANONICAL_SPARSE_ARRAY_REJECTED');
          }
        }
        if (Reflect.ownKeys(candidate).some((key) => typeof key === 'symbol')) {
          throw new CanonicalizationError('CANONICAL_SYMBOL_KEY_REJECTED');
        }
        return `[${candidate.map((entry) => visit(entry)).join(',')}]`;
      }
      if (Object.getPrototypeOf(candidate) !== Object.prototype) {
        throw new CanonicalizationError('CANONICAL_PROTOTYPE_REJECTED');
      }
      const ownKeys = Reflect.ownKeys(candidate);
      if (ownKeys.some((key) => typeof key === 'symbol')) {
        throw new CanonicalizationError('CANONICAL_SYMBOL_KEY_REJECTED');
      }
      const object = candidate as Readonly<Record<string, unknown>>;
      const keys = (ownKeys as string[]).sort(compareCodePoints);
      return `{${keys.map((key) => {
        const entry = object[key];
        if (entry === undefined) throw new CanonicalizationError('CANONICAL_UNDEFINED_REJECTED');
        return `${JSON.stringify(key)}:${visit(entry)}`;
      }).join(',')}}`;
    } finally {
      active.delete(candidate);
    }
  };
  return visit(value);
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
