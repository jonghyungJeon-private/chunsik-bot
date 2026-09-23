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
function record(v: unknown, required: string[], optional: string[] = []): v is RecordValue {
  if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return false;
  const keys = Reflect.ownKeys(v);
  return required.every(k => keys.includes(k)) && keys.every(k => typeof k === 'string'
    && [...required, ...optional].includes(k) && 'value' in Object.getOwnPropertyDescriptor(v, k)!);
}
const oneOf = (v: unknown, values: readonly unknown[]): boolean => values.includes(v);
const id = (v: unknown): boolean => typeof v === 'string' && ID.test(v);
const hash = (v: unknown): boolean => v === null || typeof v === 'string' && HASH.test(v);
const nullableId = (v: unknown): boolean => v === null || id(v);
const code = (v: unknown): boolean => v === null || oneOf(v, CONTINUATION_ROUTING_CODES);
const number = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
const integer = (v: unknown): boolean => number(v) && Number.isSafeInteger(v);
function audit(v: unknown, executionId: string): boolean {
  if (!record(v, ['schemaVersion', 'executionId', 'matchedPolicyId', 'policyVersion', 'configurationVersion',
    'policyDigest', 'configurationDigest', 'terminalStatus', 'terminalCode', 'attemptCount', 'attemptCountKnown',
    'attempts', 'finalAcceptedProviderId', 'dispatchEvidence', 'transitions'])) return false;
  if (v.schemaVersion !== 'continuation-routing-audit-v1' || v.executionId !== executionId || !id(v.executionId)
    || !nullableId(v.matchedPolicyId) || !nullableId(v.policyVersion) || !nullableId(v.configurationVersion)
    || !hash(v.policyDigest) || !hash(v.configurationDigest) || !oneOf(v.terminalStatus, statuses)
    || !code(v.terminalCode) || !nullableId(v.finalAcceptedProviderId) || !oneOf(v.dispatchEvidence, evidence)
    || typeof v.attemptCountKnown !== 'boolean' || !Array.isArray(v.attempts) || v.attempts.length > 2
    || !Array.isArray(v.transitions) || v.transitions.length > 7) return false;
  if (v.attemptCountKnown ? !oneOf(v.attemptCount, [0, 1, 2]) || v.attemptCount !== v.attempts.length
    : v.attemptCount !== null) return false;
  if (!v.attempts.every((a: unknown, index: number) => {
    if (!record(a, ['index', 'path', 'providerId', 'outcome', 'failureCode', 'validationDisposition',
      'validationReasonCodes', 'responseSha256', 'byteCount', 'durationMs', 'dispatchEvidence'])) return false;
    return a.index === index + 1 && oneOf(a.path, index === 0 ? ['PRIMARY'] : ['FALLBACK', 'ESCALATION'])
      && id(a.providerId) && oneOf(a.outcome, ['PROVIDER_FAILED', 'VALIDATION_ACCEPTED', 'VALIDATION_REJECTED', 'UNKNOWN'])
      && code(a.failureCode) && oneOf(a.validationDisposition, [null, 'ACCEPT', 'ESCALATE', 'REJECT'])
      && Array.isArray(a.validationReasonCodes) && a.validationReasonCodes.length <= reasons.length
      && new Set(a.validationReasonCodes).size === a.validationReasonCodes.length
      && a.validationReasonCodes.every(r => oneOf(r, reasons)) && hash(a.responseSha256)
      && (a.byteCount === null || integer(a.byteCount)) && number(a.durationMs) && oneOf(a.dispatchEvidence, evidence)
      && (a.outcome !== 'VALIDATION_ACCEPTED' || a.validationDisposition === 'ACCEPT'
        && a.validationReasonCodes.length === 0 && a.failureCode === null && a.dispatchEvidence === 'RETURNED'
        && a.responseSha256 !== null && a.byteCount !== null);
  })) return false;
  if (!v.transitions.every((t: unknown, i: number) => record(t, ['sequence', 'evidence', 'code'])
    && t.sequence === i + 1 && oneOf(t.evidence, evidence) && code(t.code))) return false;
  if (v.dispatchEvidence === 'NOT_DISPATCHED' && (!v.attemptCountKnown || v.attemptCount !== 0)) return false;
  const last = v.attempts[v.attempts.length - 1] as RecordValue | undefined;
  if (v.terminalStatus === 'ACCEPTED') {
    if (!v.attemptCountKnown || v.terminalCode !== null || v.dispatchEvidence !== 'RETURNED'
      || !last || last.outcome !== 'VALIDATION_ACCEPTED' || v.finalAcceptedProviderId !== last.providerId) return false;
  } else if (v.finalAcceptedProviderId !== null) return false;
  return true;
}
export function freezeContinuationValue<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeContinuationValue(child);
    Object.freeze(value);
  }
  return value;
}
/** Strict bounded projection: never persist malformed/unknown post-invocation data as certainty. */
export function snapshotReceiverOutcome(value: unknown, executionId: string): ContinuationReceiverOutcome | null {
  try {
    if (!value || typeof value !== 'object') return null;
    const state = (value as RecordValue).disposition;
    const fields = state === 'SUCCEEDED' ? ['disposition', 'artifactIds']
      : state === 'FAILED' ? ['disposition', 'error'] : state === 'UNRESOLVED' ? ['disposition', 'reason'] : null;
    if (!fields || !record(value, fields, state === 'SUCCEEDED' ? ['routingAudit', 'acceptedProviderId'] : ['routingAudit'])) return null;
    if (value.routingAudit !== undefined && !audit(value.routingAudit, executionId)) return null;
    if (state === 'SUCCEEDED') {
      if (!Array.isArray(value.artifactIds) || value.artifactIds.length > 128
        || !value.artifactIds.every(v => typeof v === 'string' && v.length > 0 && v.length <= 256 && v.trim() === v)) return null;
      if (value.acceptedProviderId !== undefined && !id(value.acceptedProviderId)) return null;
      if (value.routingAudit !== undefined) {
        const a = value.routingAudit as RecordValue;
        if (a.terminalStatus !== 'ACCEPTED' || value.acceptedProviderId !== undefined
          && value.acceptedProviderId !== a.finalAcceptedProviderId) return null;
      }
    } else if (state === 'FAILED' ? value.error !== 'CONTINUATION_RECEIVER_FAILED' : value.reason !== 'EXECUTION_UNCERTAIN') return null;
    return freezeContinuationValue(JSON.parse(JSON.stringify(value)) as ContinuationReceiverOutcome);
  } catch { return null; }
}
