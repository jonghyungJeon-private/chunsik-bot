import { containmentBindingDigest as computeContainmentBindingDigest } from './containment-binding-digest';
import {
  CONTAINMENT_ATTEMPT_PHASES,
  CONTAINMENT_AUDIT_FAILURE_CODES,
  CONTAINMENT_MODEL_INTEGRITY_STATUSES,
  CONTAINMENT_PREFLIGHT_DISPOSITIONS,
  CONTAINMENT_RUNTIME_FAMILIES,
  CONTINUATION_CONTAINMENT_AUDIT_SCHEMA,
  type ContainmentBindingEvidence,
  type ContainmentPostAttemptEvidence,
  type ContinuationContainmentAudit,
} from '../ports/continuation-containment-audit';

/**
 * R3-A strict, fail-closed validation/projection for the bounded ContinuationContainmentAudit.
 *
 * Mirrors the R1 inert descriptor-safe discipline (continuation-receiver-validation.ts): every field is
 * read once from its own data descriptor; accessor/getter properties, symbol keys, prototype pollution,
 * `toJSON` hooks and any unexpected keys are all rejected without invocation. Malformed, contradictory,
 * or out-of-bounds evidence returns null (never a fabricated success). The projection returns a freshly
 * created frozen record so no caller-owned reference survives into durable storage.
 */

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const OPAQUE = /^[^\u0000-\u001f\u007f]{1,256}$/;

const PLAIN_PROTOS: readonly unknown[] = [Object.prototype, null];
type RecordValue = Record<string, unknown>;

/** Reject anything that is not a plain, own-data-descriptor object with exactly the expected keys. */
function plainObject(v: unknown, required: readonly string[], optional: readonly string[] = []): v is RecordValue {
  if (!v || typeof v !== 'object' || Array.isArray(v) || !PLAIN_PROTOS.includes(Object.getPrototypeOf(v))) return false;
  const keys = Reflect.ownKeys(v);
  if (keys.some((k) => typeof k === 'symbol')) return false;
  const allowed = [...required, ...optional];
  if (!(keys as string[]).every((k) => allowed.includes(k))) return false;
  if (!required.every((k) => keys.includes(k))) return false;
  return (keys as string[]).every((k) => {
    const d = Object.getOwnPropertyDescriptor(v, k);
    return !!d && 'value' in d; // data descriptor only: reject getters/setters, never invoke them
  });
}

/** Read an own data-descriptor value exactly once. Throws on accessor/non-data descriptors. */
function readValue(v: RecordValue, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(v, key);
  if (!d || !('value' in d)) throw new Error('NON_DATA_DESCRIPTOR');
  return d.value;
}

const oneOf = (v: unknown, values: readonly unknown[]): boolean => values.includes(v);
const id = (v: unknown): boolean => typeof v === 'string' && ID.test(v);
const hex64 = (v: unknown): boolean => typeof v === 'string' && HEX64.test(v);
const version = (v: unknown): boolean => typeof v === 'string' && VERSION.test(v);
const opaque = (v: unknown): boolean => typeof v === 'string' && OPAQUE.test(v);

const BINDING_KEYS = [
  'executionId', 'taskRunId', 'containmentPolicyId', 'containmentPolicyVersion', 'containmentPolicyDigest',
  'containmentBindingDigest', 'providerId', 'modelId', 'modelDigest', 'imageDigest', 'runtimeFamily',
  'runtimeVersion', 'securityProfileDigest', 'modelMountIdentityDigest', 'verifierVersion',
  'channelAResultDigest', 'channelBResultDigest', 'preflightDisposition', 'modelIntegrityStatus',
] as const;

const PREPARED_KEYS = ['providerBindingDigest', 'securityProfileId', 'instanceIdentityDigest',
  'channelAVerifierVersion', 'channelBVerifierVersion'] as const;

/** Inert projection of the immutable binding evidence against the exact executionId/taskRunId. */
function projectBinding(raw: unknown, executionId: string, taskRunId: string): ContainmentBindingEvidence | null {
  if (!plainObject(raw, BINDING_KEYS, PREPARED_KEYS)) return null;
  const prepared: Record<string, unknown> = {};
  if (PREPARED_KEYS.some(k => Object.prototype.hasOwnProperty.call(raw, k))) {
    if (!PREPARED_KEYS.every(k => Object.prototype.hasOwnProperty.call(raw, k))) return null;
    for (const key of PREPARED_KEYS) prepared[key] = readValue(raw, key);
    if (!hex64(prepared.providerBindingDigest) || !id(prepared.securityProfileId)
      || !hex64(prepared.instanceIdentityDigest) || !version(prepared.channelAVerifierVersion)
      || !version(prepared.channelBVerifierVersion)
      || prepared.channelAVerifierVersion === prepared.channelBVerifierVersion
      || prepared.providerBindingDigest === readValue(raw, 'containmentBindingDigest')
      || readValue(raw, 'preflightDisposition') !== 'VERIFIED') return null;
  }
  const executionIdValue = readValue(raw, 'executionId');
  const taskRunIdValue = readValue(raw, 'taskRunId');
  const containmentPolicyId = readValue(raw, 'containmentPolicyId');
  const containmentPolicyVersion = readValue(raw, 'containmentPolicyVersion');
  const containmentPolicyDigest = readValue(raw, 'containmentPolicyDigest');
  const containmentBindingDigest = readValue(raw, 'containmentBindingDigest');
  const providerId = readValue(raw, 'providerId');
  const modelId = readValue(raw, 'modelId');
  const modelDigest = readValue(raw, 'modelDigest');
  const imageDigest = readValue(raw, 'imageDigest');
  const runtimeFamily = readValue(raw, 'runtimeFamily');
  const runtimeVersion = readValue(raw, 'runtimeVersion');
  const securityProfileDigest = readValue(raw, 'securityProfileDigest');
  const modelMountIdentityDigest = readValue(raw, 'modelMountIdentityDigest');
  const verifierVersion = readValue(raw, 'verifierVersion');
  const channelAResultDigest = readValue(raw, 'channelAResultDigest');
  const channelBResultDigest = readValue(raw, 'channelBResultDigest');
  const preflightDisposition = readValue(raw, 'preflightDisposition');
  const modelIntegrityStatus = readValue(raw, 'modelIntegrityStatus');

  if (
    executionIdValue !== executionId || taskRunIdValue !== taskRunId ||
    !id(executionIdValue) || !id(taskRunIdValue) ||
    !id(containmentPolicyId) || !version(containmentPolicyVersion) || !hex64(containmentPolicyDigest) ||
    !hex64(containmentBindingDigest) || !id(providerId) || !opaque(modelId) || !hex64(modelDigest) ||
    !hex64(imageDigest) || !oneOf(runtimeFamily, CONTAINMENT_RUNTIME_FAMILIES) || !version(runtimeVersion) ||
    !hex64(securityProfileDigest) || !hex64(modelMountIdentityDigest) || !version(verifierVersion) ||
    !hex64(channelAResultDigest) || !hex64(channelBResultDigest) ||
    !oneOf(preflightDisposition, CONTAINMENT_PREFLIGHT_DISPOSITIONS) ||
    modelIntegrityStatus !== 'VERIFIED_AT_BIND'
  ) {
    return null;
  }
  const binding = Object.freeze({
    ...prepared,
    executionId: executionIdValue, taskRunId: taskRunIdValue, containmentPolicyId, containmentPolicyVersion,
    containmentPolicyDigest, containmentBindingDigest, providerId, modelId, modelDigest, imageDigest,
    runtimeFamily, runtimeVersion, securityProfileDigest, modelMountIdentityDigest, verifierVersion,
    channelAResultDigest, channelBResultDigest, preflightDisposition, modelIntegrityStatus,
  }) as ContainmentBindingEvidence;
  // Prepared-form evidence must bind these exact persisted facts, including the run/context. Reuse
  // issuance's canonical constructor; no registry requirement (JSON/restart round trips must work).
  if (PREPARED_KEYS.every(k => Object.prototype.hasOwnProperty.call(prepared, k))) {
    if (binding.executionId !== binding.taskRunId || computeContainmentBindingDigest({
      ...binding,
      executionContext: binding,
      providerBindingDigest: binding.providerBindingDigest!, securityProfileId: binding.securityProfileId!,
      instanceIdentityDigest: binding.instanceIdentityDigest!,
      channelAVerifierVersion: binding.channelAVerifierVersion!, channelBVerifierVersion: binding.channelBVerifierVersion!,
      expectedModelId: binding.modelId, expectedModelDigest: binding.modelDigest,
    }) !== binding.containmentBindingDigest) return null;
  }
  return binding;
}

const POST_KEYS = ['attemptBoundaryCrossed', 'postAttemptModelIntegrity', 'failureCode'] as const;

/** Inert projection of the optional append-once post-attempt evidence. */
function projectPostAttempt(raw: unknown): ContainmentPostAttemptEvidence | null {
  if (!plainObject(raw, POST_KEYS)) return null;
  const attemptBoundaryCrossed = readValue(raw, 'attemptBoundaryCrossed');
  const postAttemptModelIntegrity = readValue(raw, 'postAttemptModelIntegrity');
  const failureCode = readValue(raw, 'failureCode');
  if (
    attemptBoundaryCrossed !== true ||
    !oneOf(postAttemptModelIntegrity, CONTAINMENT_MODEL_INTEGRITY_STATUSES) ||
    !(failureCode === null || oneOf(failureCode, CONTAINMENT_AUDIT_FAILURE_CODES))
  ) {
    return null;
  }
  // A bind-time-only status is not a valid POST-attempt observation.
  if (postAttemptModelIntegrity === 'VERIFIED_AT_BIND') return null;
  return Object.freeze({
    attemptBoundaryCrossed: true,
    postAttemptModelIntegrity,
    failureCode,
  }) as ContainmentPostAttemptEvidence;
}

/**
 * Strict projection of a full ContinuationContainmentAudit. Returns a frozen, newly-created record or
 * null. `executionId`/`taskRunId` are cross-checked against the exact run identity to prevent evidence
 * from one run being attributed to another.
 */
export function snapshotContainmentAudit(
  value: unknown,
  executionId: string,
  taskRunId: string,
): ContinuationContainmentAudit | null {
  try {
    if (!plainObject(value, ['schemaVersion', 'binding'], ['postAttempt'])) return null;
    const schemaVersion = readValue(value, 'schemaVersion');
    if (schemaVersion !== CONTINUATION_CONTAINMENT_AUDIT_SCHEMA) return null;
    const binding = projectBinding(readValue(value, 'binding'), executionId, taskRunId);
    if (!binding) return null;

    const hasPost = (Reflect.ownKeys(value) as string[]).includes('postAttempt');
    if (!hasPost) {
      return Object.freeze({ schemaVersion: CONTINUATION_CONTAINMENT_AUDIT_SCHEMA, binding });
    }
    const postAttempt = projectPostAttempt(readValue(value, 'postAttempt'));
    if (!postAttempt) return null;
    return Object.freeze({ schemaVersion: CONTINUATION_CONTAINMENT_AUDIT_SCHEMA, binding, postAttempt });
  } catch {
    return null;
  }
}

/**
 * A-1 evidence-preservation comparator. Given the CURRENT durable containment audit and an INCOMING
 * one, decide whether the incoming value preserves security evidence. Used by the persistence layer to
 * reject any generic-save that would remove/mutate binding or post-attempt evidence.
 *
 * Rules:
 *  - current absent  → any incoming (including absent) is allowed.
 *  - current present → incoming MUST be present, MUST carry the identical binding, MUST NOT remove or
 *    change existing post-attempt evidence. Adding post-attempt evidence when none existed is allowed.
 */
export function containmentEvidencePreserved(
  current: ContinuationContainmentAudit | null,
  incoming: ContinuationContainmentAudit | null,
): boolean {
  if (current === null) return true;
  if (incoming === null) return false;
  if (!bindingIdentical(current.binding, incoming.binding)) return false;
  if (current.postAttempt === undefined) return true; // adding post-attempt is allowed
  if (incoming.postAttempt === undefined) return false; // removing post-attempt is forbidden
  return postAttemptIdentical(current.postAttempt, incoming.postAttempt);
}

/** Deep structural equality over the bounded binding fields (no reference identity assumed). */
export function bindingIdentical(a: ContainmentBindingEvidence, b: ContainmentBindingEvidence): boolean {
  return [...BINDING_KEYS, ...PREPARED_KEYS].every((k) => a[k] === b[k]);
}

/** Deep structural equality over the bounded post-attempt fields. */
export function postAttemptIdentical(a: ContainmentPostAttemptEvidence, b: ContainmentPostAttemptEvidence): boolean {
  return (
    a.attemptBoundaryCrossed === b.attemptBoundaryCrossed &&
    a.postAttemptModelIntegrity === b.postAttemptModelIntegrity &&
    a.failureCode === b.failureCode
  );
}

/**
 * B-1 strict generic-save equality (§2/§3/§4). Unlike {@link containmentEvidencePreserved} (the A-1
 * comparator, which permits a semantic CAS to CREATE binding evidence or ADD post-attempt evidence), a
 * generic `save()` on a continuation-bound run may only CARRY FORWARD the exact evidence already present.
 * Preservation is therefore the strict equality:
 *   both absent  → true
 *   both present → identical binding AND identical (both-absent-or-identical) post-attempt
 *   otherwise    → false  (creating, removing, or changing evidence is forbidden for generic save)
 * Evidence creation/mutation is reserved for the semantic CAS APIs only.
 */
export function containmentEvidenceIdentical(
  current: ContinuationContainmentAudit | null,
  incoming: ContinuationContainmentAudit | null,
): boolean {
  if (current === null || incoming === null) return current === null && incoming === null;
  if (!bindingIdentical(current.binding, incoming.binding)) return false;
  if (current.postAttempt === undefined || incoming.postAttempt === undefined) {
    return current.postAttempt === undefined && incoming.postAttempt === undefined;
  }
  return postAttemptIdentical(current.postAttempt, incoming.postAttempt);
}
