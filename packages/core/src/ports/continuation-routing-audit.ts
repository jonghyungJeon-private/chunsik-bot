/** Bounded port DTO, independent of Application routing implementation types. No raw metadata. */
export const CONTINUATION_ROUTING_CODES = [
  'ROUTING_CONFIGURATION_MISMATCH',
  'BINDING_MISMATCH',
  'PROVIDER_BINDING_NOT_FOUND',
  'PROVIDER_DISABLED',
  'UNKNOWN_VALIDATION_PROFILE',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_AUTH_REQUIRED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_EXECUTION_FAILED',
  'PROVIDER_SPAWN_FAILED',
  'EMPTY_OUTPUT',
  'OUTPUT_LIMIT_VIOLATION',
  'STRUCTURAL_VALIDATION_FAILED',
  'SEMANTIC_VALIDATION_FAILED',
  'SEMANTIC_VALIDATION_UNRESOLVED',
  'STRUCTURAL_VALIDATION_UNRESOLVED',
  'DEADLINE_EXHAUSTED',
  'PROMPT_LEAK',
  'MULTI_ENTRY_ECHO',
  'SECRET_EXPOSURE_RISK',
  'CONTAINMENT_FAILURE',
  'MODEL_DOWNLOAD_DETECTED',
  'VALIDATOR_INTERNAL_FAILURE',
  'INVALID_PROVIDER_BINDING',
  'DUPLICATE_PROVIDER_BINDING',
  'UNKNOWN_PROVIDER_BINDING',
  'PROVIDER_BINDING_MISMATCH',
  'POLICY_NOT_MATCHED',
  'NO_ELIGIBLE_PROVIDER',
  'PRE_DISPATCH_FAILED',
  'RECEIVER_EXCEPTION',
  'INVALID_RECEIVER_OUTCOME',
  'ARTIFACT_PERSISTENCE_FAILED',
] as const;
export type ContinuationRoutingCode = typeof CONTINUATION_ROUTING_CODES[number];
export type ContinuationDispatchEvidence = 'NOT_DISPATCHED' | 'DISPATCHED' | 'RETURNED' | 'UNKNOWN';
export type ContinuationRoutingStatus = 'ACCEPTED' | 'REJECTED' | 'HUMAN_REVIEW_REQUIRED'
  | 'EXECUTION_FAILED' | 'SAFETY_BLOCKED' | 'CONFIGURATION_FAILED' | 'PRE_DISPATCH_FAILED' | 'UNKNOWN';
export type ContinuationValidationReason = 'EMPTY_OUTPUT' | 'OUTPUT_LIMIT_VIOLATION' | 'PROMPT_LEAK'
  | 'MULTI_ENTRY_ECHO' | 'SECRET_EXPOSURE_RISK' | 'RECENCY_GROUNDING_VIOLATION'
  | 'AUTHORITY_SCOPE_VIOLATION' | 'VALIDATOR_INTERNAL_FAILURE';
export interface ContinuationRoutingAttempt {
  readonly index: 1 | 2;
  readonly path: 'PRIMARY' | 'FALLBACK' | 'ESCALATION';
  readonly providerId: string;
  readonly outcome: 'PROVIDER_FAILED' | 'VALIDATION_ACCEPTED' | 'VALIDATION_REJECTED' | 'UNKNOWN';
  readonly failureCode: ContinuationRoutingCode | null;
  readonly validationDisposition: 'ACCEPT' | 'ESCALATE' | 'REJECT' | null;
  readonly validationReasonCodes: readonly ContinuationValidationReason[];
  readonly responseSha256: string | null;
  readonly byteCount: number | null;
  readonly durationMs: number;
  readonly dispatchEvidence: ContinuationDispatchEvidence;
}
export interface ContinuationRoutingAudit {
  readonly schemaVersion: 'continuation-routing-audit-v1';
  readonly executionId: string;
  readonly matchedPolicyId: string | null;
  readonly policyVersion: string | null;
  readonly configurationVersion: string | null;
  readonly policyDigest: string | null;
  readonly configurationDigest: string | null;
  readonly terminalStatus: ContinuationRoutingStatus;
  readonly terminalCode: ContinuationRoutingCode | null;
  readonly attemptCount: 0 | 1 | 2 | null;
  readonly attemptCountKnown: boolean;
  readonly attempts: readonly ContinuationRoutingAttempt[];
  readonly finalAcceptedProviderId: string | null;
  readonly dispatchEvidence: ContinuationDispatchEvidence;
  readonly transitions: readonly Readonly<{
    sequence: number;
    evidence: ContinuationDispatchEvidence;
    code: ContinuationRoutingCode | null;
  }>[];
}
