import type { Artifact } from '../domain';
import type { ValidationProfileId } from './provider-routing-contracts';

export const ROUTING_RESPONSE_RULE_CONTRACT_VERSION = 'routing-response-rules-v1' as const;
export const ROUTING_FAILURE_MATRIX_VERSION = 'routing-failure-matrix-v2' as const;

export enum ValidationDisposition {
  ACCEPT = 'ACCEPT',
  ESCALATE = 'ESCALATE',
  REJECT = 'REJECT',
}

export enum RuntimeValidationRule {
  NON_EMPTY = 'NON_EMPTY',
  OUTPUT_LIMIT = 'OUTPUT_LIMIT',
  PROMPT_LEAK = 'PROMPT_LEAK',
  MULTI_ENTRY_ECHO = 'MULTI_ENTRY_ECHO',
  SECRET_EXPOSURE_RISK = 'SECRET_EXPOSURE_RISK',
  AUTHORITY_SEMANTIC_SCOPE = 'AUTHORITY_SEMANTIC_SCOPE',
}

export enum ResponseValidationReasonCode {
  EMPTY_OUTPUT = 'EMPTY_OUTPUT',
  OUTPUT_LIMIT_VIOLATION = 'OUTPUT_LIMIT_VIOLATION',
  PROMPT_LEAK = 'PROMPT_LEAK',
  MULTI_ENTRY_ECHO = 'MULTI_ENTRY_ECHO',
  SECRET_EXPOSURE_RISK = 'SECRET_EXPOSURE_RISK',
  AUTHORITY_SCOPE_VIOLATION = 'AUTHORITY_SCOPE_VIOLATION',
  VALIDATOR_INTERNAL_FAILURE = 'VALIDATOR_INTERNAL_FAILURE',
}

export interface RuntimeValidationResult {
  readonly disposition: ValidationDisposition;
  readonly reasonCodes: readonly ResponseValidationReasonCode[];
  readonly responseSha256: string;
  readonly byteCount: number;
  readonly profileVersion: string;
  readonly ruleContractVersion: typeof ROUTING_RESPONSE_RULE_CONTRACT_VERSION;
}

export interface RuntimeValidationInputView {
  readonly validationProfile: ValidationProfileId;
  readonly prompt: string;
  readonly contextCorpus?: readonly string[];
  readonly result: {
    readonly text: string;
    readonly artifacts?: readonly Artifact[];
    readonly audit?: unknown;
    readonly raw?: unknown;
  };
}

/** Artifact projection deliberately excludes provider metadata and storage URI fields. */
export type BoundedProviderArtifact = Readonly<
  Pick<Artifact, 'id' | 'kind' | 'title' | 'createdAt'> &
    Partial<Pick<Artifact, 'taskId' | 'taskRunId' | 'content' | 'mimeType'>>
>;

export interface BoundedProviderOutput {
  readonly text: string;
  readonly artifacts: readonly BoundedProviderArtifact[];
  readonly responseSha256: string;
  readonly byteCount: number;
}

export enum RoutingFailureClass {
  CONFIGURATION = 'CONFIGURATION',
  OPERATIONAL = 'OPERATIONAL',
  VALIDATION = 'VALIDATION',
  SAFETY = 'SAFETY',
}

export enum RoutingFailureProducerStatus {
  ACTIVE = 'ACTIVE',
  PRODUCER_PENDING = 'PRODUCER_PENDING',
}

export enum RoutingFailureCode {
  ROUTING_CONFIGURATION_MISMATCH = 'ROUTING_CONFIGURATION_MISMATCH',
  BINDING_MISMATCH = 'BINDING_MISMATCH',
  PROVIDER_BINDING_NOT_FOUND = 'PROVIDER_BINDING_NOT_FOUND',
  PROVIDER_DISABLED = 'PROVIDER_DISABLED',
  UNKNOWN_VALIDATION_PROFILE = 'UNKNOWN_VALIDATION_PROFILE',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  PROVIDER_AUTH_REQUIRED = 'PROVIDER_AUTH_REQUIRED',
  PROVIDER_TIMEOUT = 'PROVIDER_TIMEOUT',
  PROVIDER_EXECUTION_FAILED = 'PROVIDER_EXECUTION_FAILED',
  PROVIDER_SPAWN_FAILED = 'PROVIDER_SPAWN_FAILED',
  EMPTY_OUTPUT = 'EMPTY_OUTPUT',
  OUTPUT_LIMIT_VIOLATION = 'OUTPUT_LIMIT_VIOLATION',
  STRUCTURAL_VALIDATION_FAILED = 'STRUCTURAL_VALIDATION_FAILED',
  SEMANTIC_VALIDATION_FAILED = 'SEMANTIC_VALIDATION_FAILED',
  SEMANTIC_VALIDATION_UNRESOLVED = 'SEMANTIC_VALIDATION_UNRESOLVED',
  STRUCTURAL_VALIDATION_UNRESOLVED = 'STRUCTURAL_VALIDATION_UNRESOLVED',
  DEADLINE_EXHAUSTED = 'DEADLINE_EXHAUSTED',
  PROMPT_LEAK = 'PROMPT_LEAK',
  MULTI_ENTRY_ECHO = 'MULTI_ENTRY_ECHO',
  SECRET_EXPOSURE_RISK = 'SECRET_EXPOSURE_RISK',
  CONTAINMENT_FAILURE = 'CONTAINMENT_FAILURE',
  MODEL_DOWNLOAD_DETECTED = 'MODEL_DOWNLOAD_DETECTED',
  VALIDATOR_INTERNAL_FAILURE = 'VALIDATOR_INTERNAL_FAILURE',
}

export interface RoutingFailurePolicy {
  readonly code: RoutingFailureCode;
  readonly failureClass: RoutingFailureClass;
  readonly attemptConsumed: 0 | 1;
  readonly fallbackAllowed: boolean;
  readonly escalationAllowed: boolean;
  readonly failClosed: boolean;
  readonly humanReviewCandidate: boolean;
  readonly producerStatus: RoutingFailureProducerStatus;
}

const configuration = (code: RoutingFailureCode): RoutingFailurePolicy => ({
  code,
  failureClass: RoutingFailureClass.CONFIGURATION,
  attemptConsumed: 0,
  fallbackAllowed: false,
  escalationAllowed: false,
  failClosed: true,
  humanReviewCandidate: false,
  producerStatus: RoutingFailureProducerStatus.ACTIVE,
});

const operational = (
  code: RoutingFailureCode,
  fallbackAllowed: boolean,
  producerStatus = RoutingFailureProducerStatus.ACTIVE,
): RoutingFailurePolicy => ({
  code,
  failureClass: RoutingFailureClass.OPERATIONAL,
  attemptConsumed: 1,
  fallbackAllowed,
  escalationAllowed: false,
  failClosed: !fallbackAllowed,
  humanReviewCandidate: false,
  producerStatus,
});

const validation = (
  code: RoutingFailureCode,
  producerStatus = RoutingFailureProducerStatus.ACTIVE,
): RoutingFailurePolicy => ({
  code,
  failureClass: RoutingFailureClass.VALIDATION,
  attemptConsumed: 1,
  fallbackAllowed: false,
  escalationAllowed: true,
  failClosed: false,
  humanReviewCandidate: false,
  producerStatus,
});

const safety = (
  code: RoutingFailureCode,
  producerStatus = RoutingFailureProducerStatus.ACTIVE,
): RoutingFailurePolicy => ({
  code,
  failureClass: RoutingFailureClass.SAFETY,
  attemptConsumed: 1,
  fallbackAllowed: false,
  escalationAllowed: false,
  failClosed: true,
  humanReviewCandidate: true,
  producerStatus,
});

const terminalUnresolvedValidation = (code: RoutingFailureCode): RoutingFailurePolicy => ({
  code,
  failureClass: RoutingFailureClass.VALIDATION,
  attemptConsumed: 1,
  fallbackAllowed: false,
  escalationAllowed: false,
  failClosed: false,
  humanReviewCandidate: true,
  producerStatus: RoutingFailureProducerStatus.PRODUCER_PENDING,
});

const FAILURE_MATRIX: readonly RoutingFailurePolicy[] = [
  configuration(RoutingFailureCode.ROUTING_CONFIGURATION_MISMATCH),
  configuration(RoutingFailureCode.BINDING_MISMATCH),
  configuration(RoutingFailureCode.PROVIDER_BINDING_NOT_FOUND),
  configuration(RoutingFailureCode.PROVIDER_DISABLED),
  configuration(RoutingFailureCode.UNKNOWN_VALIDATION_PROFILE),
  operational(RoutingFailureCode.PROVIDER_UNAVAILABLE, true),
  operational(RoutingFailureCode.PROVIDER_AUTH_REQUIRED, true),
  operational(RoutingFailureCode.PROVIDER_TIMEOUT, true),
  operational(RoutingFailureCode.PROVIDER_EXECUTION_FAILED, true),
  operational(RoutingFailureCode.PROVIDER_SPAWN_FAILED, true, RoutingFailureProducerStatus.PRODUCER_PENDING),
  operational(RoutingFailureCode.EMPTY_OUTPUT, true),
  operational(RoutingFailureCode.OUTPUT_LIMIT_VIOLATION, false),
  validation(
    RoutingFailureCode.STRUCTURAL_VALIDATION_FAILED,
    RoutingFailureProducerStatus.PRODUCER_PENDING,
  ),
  validation(RoutingFailureCode.SEMANTIC_VALIDATION_FAILED),
  terminalUnresolvedValidation(RoutingFailureCode.SEMANTIC_VALIDATION_UNRESOLVED),
  terminalUnresolvedValidation(RoutingFailureCode.STRUCTURAL_VALIDATION_UNRESOLVED),
  operational(RoutingFailureCode.DEADLINE_EXHAUSTED, false, RoutingFailureProducerStatus.PRODUCER_PENDING),
  safety(RoutingFailureCode.PROMPT_LEAK),
  safety(RoutingFailureCode.MULTI_ENTRY_ECHO),
  safety(RoutingFailureCode.SECRET_EXPOSURE_RISK),
  safety(RoutingFailureCode.CONTAINMENT_FAILURE, RoutingFailureProducerStatus.PRODUCER_PENDING),
  safety(RoutingFailureCode.MODEL_DOWNLOAD_DETECTED, RoutingFailureProducerStatus.PRODUCER_PENDING),
  safety(RoutingFailureCode.VALIDATOR_INTERNAL_FAILURE),
].map((entry) => Object.freeze(entry));

export const ROUTING_FAILURE_MATRIX = Object.freeze(FAILURE_MATRIX);
