import { CONTINUATION_ROUTING_CODES } from '../ports/continuation-routing-audit';
import type { ContinuationReceiverOutcome } from '../ports/continuation-receiver.port';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const evidence = ['NOT_DISPATCHED', 'DISPATCHED', 'RETURNED', 'UNKNOWN'];
const reasons = ['EMPTY_OUTPUT', 'OUTPUT_LIMIT_VIOLATION', 'PROMPT_LEAK', 'MULTI_ENTRY_ECHO',
  'SECRET_EXPOSURE_RISK', 'RECENCY_GROUNDING_VIOLATION', 'AUTHORITY_SCOPE_VIOLATION', 'VALIDATOR_INTERNAL_FAILURE'];
const statuses = ['ACCEPTED', 'REJECTED', 'HUMAN_REVIEW_REQUIRED', 'EXECUTION_FAILED', 'SAFETY_BLOCKED',
  'CONFIGURATION_FAILED', 'PRE_DISPATCH_FAILED', 'UNKNOWN'];
type RecordValue = Record<string, unknown>;

/**
 * B2 §5-§11: inert descriptor-safe reads. A field is read at most once, from its own data descriptor.
 * Accessors (getter/setter), inherited properties, and symbol keys are all rejected — never re-read.
 * The extracted primitive/value becomes the only downstream source; receiver serialization hooks
 * (toJSON) are never invoked, and generic JSON serialization is never used as a security boundary.
 */
const PLAIN_PROTOS: readonly unknown[] = [Object.prototype, null];

/** Reject anything that is not a plain, own-data-descriptor object with exactly the expected keys. */
function plainObject(v: unknown, required: readonly string[], optional: readonly string[] = []): v is RecordValue {
  if (!v || typeof v !== 'object' || Array.isArray(v) || !PLAIN_PROTOS.includes(Object.getPrototypeOf(v))) return false;
  const keys = Reflect.ownKeys(v);
  // No symbol keys, no own toJSON hook, no unexpected keys, every present key is a data descriptor.
  if (keys.some(k => typeof k === 'symbol')) return false;
  const allowed = [...required, ...optional];
  if (!(keys as string[]).every(k => allowed.includes(k))) return false;
  if (!required.every(k => keys.includes(k))) return false;
  return (keys as string[]).every(k => {
    const d = Object.getOwnPropertyDescriptor(v, k);
    return !!d && 'value' in d; // data descriptor only: reject getters/setters, never invoke them
  });
}

/** Read an own data-descriptor value exactly once. Returns a sentinel-free single read. */
function readValue(v: RecordValue, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(v, key);
  if (!d || !('value' in d)) throw new Error('NON_DATA_DESCRIPTOR');
  return d.value;
}

/**
 * B2 §8: dense bounded array with only own data-descriptor indices. Rejects sparse arrays (holes),
 * accessor indices, custom prototypes, own toJSON, and any unexpected own keys beyond length+indices.
 * Returns the read-once values in index order; never re-reads an index.
 */
function denseArray(v: unknown, maxLength: number): unknown[] | null {
  if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype) return null;
  if (v.length > maxLength) return null;
  const keys = Reflect.ownKeys(v);
  if (keys.some(k => typeof k === 'symbol')) return null;
  const expected = new Set<string>(['length']);
  for (let i = 0; i < v.length; i++) expected.add(String(i));
  if (!(keys as string[]).every(k => expected.has(k))) return null; // no extra own props, no toJSON
  const out: unknown[] = [];
  for (let i = 0; i < v.length; i++) {
    const d = Object.getOwnPropertyDescriptor(v, i);
    if (!d || !('value' in d)) return null; // hole or accessor index → reject
    out.push(d.value);
  }
  return out;
}

const oneOf = (v: unknown, values: readonly unknown[]): boolean => values.includes(v);
const id = (v: unknown): boolean => typeof v === 'string' && ID.test(v);
const hash = (v: unknown): boolean => v === null || typeof v === 'string' && HASH.test(v);
const nullableId = (v: unknown): boolean => v === null || id(v);
const code = (v: unknown): boolean => v === null || oneOf(v, CONTINUATION_ROUTING_CODES);
const number = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
const integer = (v: unknown): boolean => number(v) && Number.isSafeInteger(v);

/**
 * Inert projection of one attempt: reads every field once from its data descriptor, validates, and
 * returns a freshly-created bounded primitive record. No receiver-owned reference survives.
 */
function projectAttempt(raw: unknown, index: number): RecordValue | null {
  if (!plainObject(raw, ['index', 'path', 'providerId', 'outcome', 'failureCode', 'validationDisposition',
    'validationReasonCodes', 'responseSha256', 'byteCount', 'durationMs', 'dispatchEvidence'])) return null;
  const idx = readValue(raw, 'index');
  const path = readValue(raw, 'path');
  const providerId = readValue(raw, 'providerId');
  const outcome = readValue(raw, 'outcome');
  const failureCode = readValue(raw, 'failureCode');
  const validationDisposition = readValue(raw, 'validationDisposition');
  const rawReasonCodes = readValue(raw, 'validationReasonCodes');
  const responseSha256 = readValue(raw, 'responseSha256');
  const byteCount = readValue(raw, 'byteCount');
  const durationMs = readValue(raw, 'durationMs');
  const dispatchEvidence = readValue(raw, 'dispatchEvidence');
  const reasonCodes = denseArray(rawReasonCodes, reasons.length);
  if (!reasonCodes) return null;
  if (idx !== index + 1 || !oneOf(path, index === 0 ? ['PRIMARY'] : ['FALLBACK', 'ESCALATION'])
    || !id(providerId) || !oneOf(outcome, ['PROVIDER_FAILED', 'VALIDATION_ACCEPTED', 'VALIDATION_REJECTED', 'UNKNOWN'])
    || !code(failureCode) || !oneOf(validationDisposition, [null, 'ACCEPT', 'ESCALATE', 'REJECT'])
    || new Set(reasonCodes).size !== reasonCodes.length || !reasonCodes.every(r => oneOf(r, reasons))
    || !hash(responseSha256) || !(byteCount === null || integer(byteCount)) || !number(durationMs)
    || !oneOf(dispatchEvidence, evidence)) return null;
  if (outcome === 'VALIDATION_ACCEPTED' && !(validationDisposition === 'ACCEPT' && reasonCodes.length === 0
    && failureCode === null && dispatchEvidence === 'RETURNED' && responseSha256 !== null && byteCount !== null)) return null;
  return Object.freeze({
    index: idx, path, providerId, outcome, failureCode, validationDisposition,
    validationReasonCodes: Object.freeze([...reasonCodes]), responseSha256, byteCount, durationMs, dispatchEvidence,
  });
}

function projectTransition(raw: unknown, i: number): RecordValue | null {
  if (!plainObject(raw, ['sequence', 'evidence', 'code'])) return null;
  const sequence = readValue(raw, 'sequence');
  const ev = readValue(raw, 'evidence');
  const c = readValue(raw, 'code');
  if (sequence !== i + 1 || !oneOf(ev, evidence) || !code(c)) return null;
  return Object.freeze({ sequence, evidence: ev, code: c });
}

/**
 * B2 §12: inert recursive projection of the routing audit into newly-created frozen primitives.
 * Returns null on any malformed/contradictory shape. On success returns a frozen plain record with
 * no reference to any receiver-owned nested array/object.
 */
function projectAudit(raw: unknown, executionId: string): RecordValue | null {
  if (!plainObject(raw, ['schemaVersion', 'executionId', 'matchedPolicyId', 'policyVersion', 'configurationVersion',
    'policyDigest', 'configurationDigest', 'terminalStatus', 'terminalCode', 'attemptCount', 'attemptCountKnown',
    'attempts', 'finalAcceptedProviderId', 'dispatchEvidence', 'transitions'])) return null;
  const schemaVersion = readValue(raw, 'schemaVersion');
  const execId = readValue(raw, 'executionId');
  const matchedPolicyId = readValue(raw, 'matchedPolicyId');
  const policyVersion = readValue(raw, 'policyVersion');
  const configurationVersion = readValue(raw, 'configurationVersion');
  const policyDigest = readValue(raw, 'policyDigest');
  const configurationDigest = readValue(raw, 'configurationDigest');
  const terminalStatus = readValue(raw, 'terminalStatus');
  const terminalCode = readValue(raw, 'terminalCode');
  const attemptCount = readValue(raw, 'attemptCount');
  const attemptCountKnown = readValue(raw, 'attemptCountKnown');
  const rawAttempts = readValue(raw, 'attempts');
  const finalAcceptedProviderId = readValue(raw, 'finalAcceptedProviderId');
  const dispatchEvidence = readValue(raw, 'dispatchEvidence');
  const rawTransitions = readValue(raw, 'transitions');
  if (schemaVersion !== 'continuation-routing-audit-v1' || execId !== executionId || !id(execId)
    || !nullableId(matchedPolicyId) || !nullableId(policyVersion) || !nullableId(configurationVersion)
    || !hash(policyDigest) || !hash(configurationDigest) || !oneOf(terminalStatus, statuses)
    || !code(terminalCode) || !nullableId(finalAcceptedProviderId) || !oneOf(dispatchEvidence, evidence)
    || typeof attemptCountKnown !== 'boolean') return null;
  const attempts = denseArray(rawAttempts, 2);
  const transitions = denseArray(rawTransitions, 7);
  if (!attempts || !transitions) return null;
  if (attemptCountKnown ? !oneOf(attemptCount, [0, 1, 2]) || attemptCount !== attempts.length
    : attemptCount !== null) return null;
  const projectedAttempts: RecordValue[] = [];
  for (let i = 0; i < attempts.length; i++) {
    const a = projectAttempt(attempts[i], i);
    if (!a) return null;
    projectedAttempts.push(a);
  }
  const projectedTransitions: RecordValue[] = [];
  for (let i = 0; i < transitions.length; i++) {
    const t = projectTransition(transitions[i], i);
    if (!t) return null;
    projectedTransitions.push(t);
  }
  if (dispatchEvidence === 'NOT_DISPATCHED' && (!attemptCountKnown || attemptCount !== 0)) return null;
  const last = projectedAttempts[projectedAttempts.length - 1];
  if (terminalStatus === 'ACCEPTED') {
    if (!attemptCountKnown || terminalCode !== null || dispatchEvidence !== 'RETURNED'
      || !last || last.outcome !== 'VALIDATION_ACCEPTED' || finalAcceptedProviderId !== last.providerId) return null;
  } else if (finalAcceptedProviderId !== null) return null;
  return Object.freeze({
    schemaVersion, executionId: execId, matchedPolicyId, policyVersion, configurationVersion,
    policyDigest, configurationDigest, terminalStatus, terminalCode, attemptCount, attemptCountKnown,
    attempts: Object.freeze(projectedAttempts), finalAcceptedProviderId, dispatchEvidence,
    transitions: Object.freeze(projectedTransitions),
  });
}

export function freezeContinuationValue<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeContinuationValue(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Strict bounded inert projection: reads each receiver-controlled field once from its own data
 * descriptor, validates it, and returns a freshly-created frozen primitive projection. Malformed,
 * contradictory, or unsafe post-invocation data is never persisted as terminal certainty (returns null).
 *
 * B1 §2-§3, §14: disposition/audit consistency. An outcome must not carry evidence that contradicts
 * its own disposition. FAILED/UNRESOLVED must not claim ACCEPTED terminal status or a final accepted
 * Provider; FAILED must not carry UNKNOWN evidence that makes definite failure uncertain; an
 * acceptedProviderId is permitted only on SUCCEEDED and must match audit.finalAcceptedProviderId.
 * R1 only validates the supplied bounded audit is non-contradictory; it never derives a disposition.
 */
export function snapshotReceiverOutcome(value: unknown, executionId: string): ContinuationReceiverOutcome | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const container = value as RecordValue;
    const state = plainObject(container, [], ['disposition', 'artifactIds', 'error', 'reason',
      'routingAudit', 'acceptedProviderId']) ? readValue(container, 'disposition') : undefined;
    const fields = state === 'SUCCEEDED' ? ['disposition', 'artifactIds']
      : state === 'FAILED' ? ['disposition', 'error'] : state === 'UNRESOLVED' ? ['disposition', 'reason'] : null;
    if (!fields || !plainObject(container, fields,
      state === 'SUCCEEDED' ? ['routingAudit', 'acceptedProviderId'] : ['routingAudit'])) return null;

    const rawAudit = 'routingAudit' in container ? readValue(container, 'routingAudit') : undefined;
    let audit: RecordValue | undefined;
    if (rawAudit !== undefined) {
      const projected = projectAudit(rawAudit, executionId);
      if (!projected) return null;
      audit = projected;
    }

    if (state === 'SUCCEEDED') {
      const rawArtifactIds = readValue(container, 'artifactIds');
      const artifactIds = denseArray(rawArtifactIds, 128);
      if (!artifactIds || !artifactIds.every(v => typeof v === 'string' && v.length > 0 && v.length <= 256 && v.trim() === v)) return null;
      const acceptedProviderId = 'acceptedProviderId' in container ? readValue(container, 'acceptedProviderId') : undefined;
      if (acceptedProviderId !== undefined && !id(acceptedProviderId)) return null;
      if (audit) {
        // SUCCEEDED with audit must carry ACCEPTED terminal evidence (projectAudit already enforced
        // the ACCEPTED shape). An acceptedProviderId, when present, must match the final Provider.
        if (audit.terminalStatus !== 'ACCEPTED') return null;
        if (acceptedProviderId !== undefined && acceptedProviderId !== audit.finalAcceptedProviderId) return null;
      }
      return freezeContinuationValue({
        disposition: 'SUCCEEDED',
        artifactIds: Object.freeze([...artifactIds]) as readonly string[],
        ...(acceptedProviderId !== undefined ? { acceptedProviderId } : {}),
        ...(audit ? { routingAudit: audit } : {}),
      } as ContinuationReceiverOutcome);
    }

    if (state === 'FAILED') {
      if (readValue(container, 'error') !== 'CONTINUATION_RECEIVER_FAILED') return null;
      if (audit) {
        // A FAILED outcome must carry only evidence consistent with definite failure: no ACCEPTED
        // terminal status, no accepted/final Provider, and no UNKNOWN evidence that makes termination
        // uncertain. projectAudit already rejects finalAcceptedProviderId on non-ACCEPTED audits.
        if (audit.terminalStatus === 'ACCEPTED' || audit.finalAcceptedProviderId !== null) return null;
        if (audit.terminalStatus === 'UNKNOWN' || audit.dispatchEvidence === 'UNKNOWN'
          || audit.attemptCountKnown === false) return null;
        if (audit.attempts && (audit.attempts as readonly RecordValue[]).some(a => a.dispatchEvidence === 'UNKNOWN' || a.outcome === 'UNKNOWN')) return null;
      }
      return freezeContinuationValue({
        disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED',
        ...(audit ? { routingAudit: audit } : {}),
      } as ContinuationReceiverOutcome);
    }

    // UNRESOLVED: uncertain/unknown dispatch evidence is allowed, but it must never simultaneously
    // claim validated acceptance or a final accepted Provider identity.
    if (readValue(container, 'reason') !== 'EXECUTION_UNCERTAIN') return null;
    if (audit && (audit.terminalStatus === 'ACCEPTED' || audit.finalAcceptedProviderId !== null)) return null;
    return freezeContinuationValue({
      disposition: 'UNRESOLVED', reason: 'EXECUTION_UNCERTAIN',
      ...(audit ? { routingAudit: audit } : {}),
    } as ContinuationReceiverOutcome);
  } catch { return null; }
}
