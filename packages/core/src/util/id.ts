import { randomUUID } from 'node:crypto';

/**
 * Generates opaque ids. Centralized so it can later be swapped for an injected
 * IdGenerator (e.g. for deterministic tests) without touching call sites.
 */
export function newId(): string {
  return randomUUID();
}
