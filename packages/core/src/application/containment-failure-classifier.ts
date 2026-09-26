import type { ContainmentAttemptPhase } from '../ports/continuation-containment-audit';

/**
 * R3-A pure attempt-phase-sensitive containment classifier (no runtime, no execution). It encodes the
 * ratified rule that a containment/uncertainty outcome is decided by the ATTEMPT PHASE and positive
 * evidence, never by a final failure code alone:
 *
 *   PRE_ATTEMPT  + definite failure                → FAILED   (deterministic, dispatch never occurred)
 *   ATTEMPT_STARTED / POST_ATTEMPT + uncertainty    → UNRESOLVED
 *
 * This is the semantic contract the future R3-C execution adapter and the continuation routing/receiver
 * mapping consume. R3-A ships the pure function + tests; no Provider is executed.
 */

/** Bounded disposition the continuation path derives from phase + code (no new TaskRunStatus). */
export type ContainmentDisposition = 'FAILED' | 'UNRESOLVED';

/**
 * Codes that, AFTER the attempt boundary is crossed, are uncertain (UNRESOLVED) because the
 * execution/enforcement state cannot be disproved. The same codes BEFORE the attempt boundary are
 * definite (FAILED).
 */
export const CONTAINMENT_POST_ATTEMPT_UNCERTAIN_CODES = [
  'CONTAINMENT_FAILURE',
  'MODEL_DOWNLOAD_DETECTED',
] as const;
export type ContainmentPostAttemptUncertainCode =
  typeof CONTAINMENT_POST_ATTEMPT_UNCERTAIN_CODES[number];

/**
 * Codes that are always definite pre-attempt failures (deterministic, before the model request begins).
 * They never occur post-attempt in the contained flow.
 */
export const CONTAINMENT_PRE_ATTEMPT_DEFINITE_CODES = [
  'CONTAINMENT_UNAVAILABLE',
  'CONTAINMENT_CONFIGURATION_INVALID',
  'CONTAINMENT_PREFLIGHT_FAILED',
  'CONTAINMENT_BIND_FAILED',
  'MODEL_MISSING',
  'MODEL_DIGEST_MISMATCH',
  'PRIVATE_DAEMON_START_FAILED',
  'PRIVATE_DAEMON_NOT_READY',
  'CONTAINMENT_EVIDENCE_CONFLICT',
] as const;
export type ContainmentPreAttemptDefiniteCode =
  typeof CONTAINMENT_PRE_ATTEMPT_DEFINITE_CODES[number];

function isPostAttemptUncertainCode(code: string): boolean {
  return (CONTAINMENT_POST_ATTEMPT_UNCERTAIN_CODES as readonly string[]).includes(code);
}
function isPreAttemptDefiniteCode(code: string): boolean {
  return (CONTAINMENT_PRE_ATTEMPT_DEFINITE_CODES as readonly string[]).includes(code);
}

/**
 * Classify a containment failure code by phase.
 *  - PRE_ATTEMPT: any definite containment code → FAILED. A post-attempt-only uncertain code arriving
 *    pre-attempt is also a definite FAILED (it was positively known before dispatch).
 *  - ATTEMPT_STARTED / POST_ATTEMPT: an uncertain code → UNRESOLVED; a definite pre-attempt code cannot
 *    legitimately arise post-attempt, so it is treated conservatively as UNRESOLVED (never a fabricated
 *    definite failure once the boundary is crossed).
 */
export function classifyContainmentFailure(
  phase: ContainmentAttemptPhase,
  code: string,
): ContainmentDisposition {
  if (phase === 'PRE_ATTEMPT') {
    // Deterministic pre-dispatch failure: definite.
    return 'FAILED';
  }
  // Attempt boundary crossed: never a fabricated definite failure once uncertain.
  if (isPostAttemptUncertainCode(code) || isPreAttemptDefiniteCode(code)) return 'UNRESOLVED';
  return 'UNRESOLVED';
}

/**
 * PROVIDER_SPAWN_FAILED is NOT globally classified. Classification depends on phase + positive evidence:
 *  - positively failed before the attempt boundary (e.g. private daemon start failed) → FAILED
 *  - the one-shot client provably failed before the model request began, with positive evidence → FAILED
 *  - otherwise, once the prepared execution has been invoked / launch state is uncertain → UNRESOLVED
 */
export function classifyProviderSpawnFailed(
  phase: ContainmentAttemptPhase,
  positivePreAttemptEvidence: boolean,
): ContainmentDisposition {
  if (phase === 'PRE_ATTEMPT') return 'FAILED';
  if (phase === 'ATTEMPT_STARTED' && positivePreAttemptEvidence) return 'FAILED';
  return 'UNRESOLVED';
}
