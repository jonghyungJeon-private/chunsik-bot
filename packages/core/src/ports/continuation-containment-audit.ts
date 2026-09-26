/**
 * R3-A bounded containment audit port DTO. This is a SEPARATE, independently versioned contract from
 * `continuation-routing-audit-v1` (see ./continuation-routing-audit): it is NEVER merged into the
 * routing audit and the routing audit never gains containment keys. It carries only bounded semantic
 * facts needed by R1/R2 to reason about a contained continuation attempt. It intentionally exposes NO
 * runtime implementation details (no raw container ID, OrbStack/Docker path, inspect JSON, CLI argv,
 * host filesystem path, environment dump, socket path, mount source path, or raw runtime error) — any
 * adapter/runtime instance identity contributes to `containmentBindingDigest` without being surfaced.
 *
 * R3-A defines the contract only. No container/VM/daemon/network is created or probed by this module.
 */

/** Independently versioned; distinct from 'continuation-routing-audit-v1'. */
export const CONTINUATION_CONTAINMENT_AUDIT_SCHEMA = 'continuation-containment-audit-v1' as const;

/**
 * Runtime family under which the (future) contained attempt is prepared. `NONE` is the R3-A default:
 * no runtime family is selected or executed yet (Strict feasibility gate pending). Adapter families are
 * enumerated as bounded semantic tokens, never adapter vocabulary leaked as free text.
 */
export const CONTAINMENT_RUNTIME_FAMILIES = ['NONE', 'CONTAINER_NO_NETWORK', 'VM_NO_NIC'] as const;
export type ContainmentRuntimeFamily = typeof CONTAINMENT_RUNTIME_FAMILIES[number];

/**
 * Preflight disposition for the two-channel verifier (Channel A runtime inspection + Channel B
 * in-instance self-check). `NOT_PERFORMED` is the R3-A default: no verification runs yet.
 */
export const CONTAINMENT_PREFLIGHT_DISPOSITIONS = [
  'NOT_PERFORMED',
  'VERIFIED',
  'PREFLIGHT_FAILED',
  'UNAVAILABLE',
] as const;
export type ContainmentPreflightDisposition = typeof CONTAINMENT_PREFLIGHT_DISPOSITIONS[number];

/**
 * A-3 scoped model-integrity semantics. The contract MUST NOT claim the exact model bytes were
 * immutable throughout execution against a privileged host/runtime actor. It supports a bind-time
 * verification plus a bounded post-attempt disposition. `MISMATCH` after an attempt must drive
 * UNRESOLVED (never a false definite success). `NOT_REVERIFIED`/`UNAVAILABLE` are honest unknowns.
 */
export const CONTAINMENT_MODEL_INTEGRITY_STATUSES = [
  'VERIFIED_AT_BIND',
  'MATCHED',
  'MISMATCH',
  'NOT_REVERIFIED',
  'UNAVAILABLE',
] as const;
export type ContainmentModelIntegrityStatus = typeof CONTAINMENT_MODEL_INTEGRITY_STATUSES[number];

/**
 * Pure attempt-phase semantics (no real execution in R3-A). PRE_ATTEMPT deterministic failures are
 * definite (FAILED); once ATTEMPT_STARTED, uncertain outcomes are UNRESOLVED. Classification is never
 * inferred from a final failure code alone — the phase/evidence decides.
 */
export const CONTAINMENT_ATTEMPT_PHASES = ['PRE_ATTEMPT', 'ATTEMPT_STARTED', 'POST_ATTEMPT'] as const;
export type ContainmentAttemptPhase = typeof CONTAINMENT_ATTEMPT_PHASES[number];

/** Whether optional append-once post-attempt evidence has been recorded. */
export const CONTAINMENT_POST_ATTEMPT_EVIDENCE_STATUSES = ['NONE', 'RECORDED'] as const;
export type ContainmentPostAttemptEvidenceStatus =
  typeof CONTAINMENT_POST_ATTEMPT_EVIDENCE_STATUSES[number];

/**
 * Bounded containment failure/reason codes surfaced through Core containment audit. These are semantic
 * containment reasons, not Gateway routing codes; runtime/daemon-specific detail never appears here.
 * `null` means no containment failure was recorded.
 */
export const CONTAINMENT_AUDIT_FAILURE_CODES = [
  'CONTAINMENT_UNAVAILABLE',
  'CONTAINMENT_CONFIGURATION_INVALID',
  'CONTAINMENT_PREFLIGHT_FAILED',
  'CONTAINMENT_BIND_FAILED',
  'MODEL_MISSING',
  'MODEL_DIGEST_MISMATCH',
  'PRIVATE_DAEMON_START_FAILED',
  'PRIVATE_DAEMON_NOT_READY',
  'CONTAINMENT_EVIDENCE_CONFLICT',
  'CONTAINMENT_FAILURE',
  'MODEL_DOWNLOAD_DETECTED',
] as const;
export type ContainmentAuditFailureCode = typeof CONTAINMENT_AUDIT_FAILURE_CODES[number];

/**
 * The immutable binding component of the containment evidence. Recorded once, before any (future)
 * Provider attempt. Its `containmentBindingDigest` is the R3 containment binding — DISTINCT from the
 * Stage2B provider binding digest (see A-2 naming distinction in DECISIONS). It must never be rewritten
 * to a different digest (insert-once).
 */
export interface ContainmentBindingEvidence {
  /** R3-B2 prepared identity extension: all five fields occur together; absent on legacy R3-A audits. */
  readonly providerBindingDigest?: string;
  readonly securityProfileId?: string;
  readonly instanceIdentityDigest?: string;
  readonly channelAVerifierVersion?: string;
  readonly channelBVerifierVersion?: string;
  readonly executionId: string;
  readonly taskRunId: string;
  readonly containmentPolicyId: string;
  readonly containmentPolicyVersion: string;
  readonly containmentPolicyDigest: string;
  /** R3 containment binding digest. NOT the Stage2B providerBindingDigest. */
  readonly containmentBindingDigest: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelDigest: string;
  readonly imageDigest: string;
  readonly runtimeFamily: ContainmentRuntimeFamily;
  readonly runtimeVersion: string;
  readonly securityProfileDigest: string;
  readonly modelMountIdentityDigest: string;
  readonly verifierVersion: string;
  readonly channelAResultDigest: string;
  readonly channelBResultDigest: string;
  readonly preflightDisposition: ContainmentPreflightDisposition;
  /** Bind-time integrity is a scoped claim (A-3); it is never an immutability guarantee. */
  readonly modelIntegrityStatus: Extract<ContainmentModelIntegrityStatus, 'VERIFIED_AT_BIND'>;
}

/**
 * Optional append-once post-attempt evidence. Present only once the (future) attempt boundary is
 * crossed. It NEVER rewrites the binding identity; it only appends bounded post-attempt observation.
 */
export interface ContainmentPostAttemptEvidence {
  readonly attemptBoundaryCrossed: true;
  readonly postAttemptModelIntegrity: ContainmentModelIntegrityStatus;
  readonly failureCode: ContainmentAuditFailureCode | null;
}

/**
 * The durable containment audit stored as bounded TaskRun metadata (`metadata.containmentAudit`). It is
 * an immutable `binding` plus an optional append-once `postAttempt`. R3-A creates this contract only;
 * it is populated by the future R3-C execution adapter.
 */
export interface ContinuationContainmentAudit {
  readonly schemaVersion: typeof CONTINUATION_CONTAINMENT_AUDIT_SCHEMA;
  readonly binding: ContainmentBindingEvidence;
  readonly postAttempt?: ContainmentPostAttemptEvidence;
}

/** Metadata key under TaskRun.metadata that owns the durable containment audit. */
export const CONTAINMENT_AUDIT_METADATA_KEY = 'containmentAudit' as const;
