import type { IsoTimestamp } from '../domain';

/**
 * Current time as an ISO timestamp. Centralized so it can later be swapped for
 * an injected Clock without touching call sites.
 */
export function now(): IsoTimestamp {
  return new Date().toISOString();
}
