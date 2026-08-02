import { AiFailureKind } from '../domain';
import {
  ResponseValidationReasonCode,
  ROUTING_FAILURE_MATRIX,
  RoutingFailureClass,
  RoutingFailureCode,
  RoutingFailurePolicy,
  RuntimeValidationResult,
  ValidationDisposition,
} from './runtime-response-validation-contracts';

const PROVIDER_FAILURES: Readonly<Record<AiFailureKind, RoutingFailureCode>> = Object.freeze({
  [AiFailureKind.UNAVAILABLE]: RoutingFailureCode.PROVIDER_UNAVAILABLE,
  [AiFailureKind.AUTH_REQUIRED]: RoutingFailureCode.PROVIDER_AUTH_REQUIRED,
  [AiFailureKind.TIMEOUT]: RoutingFailureCode.PROVIDER_TIMEOUT,
  [AiFailureKind.EXECUTION_FAILED]: RoutingFailureCode.PROVIDER_EXECUTION_FAILED,
  [AiFailureKind.EMPTY_OUTPUT]: RoutingFailureCode.EMPTY_OUTPUT,
});

const REASONS: Readonly<Partial<Record<ResponseValidationReasonCode, RoutingFailureCode>>> = Object.freeze({
  [ResponseValidationReasonCode.PROMPT_LEAK]: RoutingFailureCode.PROMPT_LEAK,
  [ResponseValidationReasonCode.MULTI_ENTRY_ECHO]: RoutingFailureCode.MULTI_ENTRY_ECHO,
  [ResponseValidationReasonCode.SECRET_EXPOSURE_RISK]: RoutingFailureCode.SECRET_EXPOSURE_RISK,
  [ResponseValidationReasonCode.VALIDATOR_INTERNAL_FAILURE]: RoutingFailureCode.VALIDATOR_INTERNAL_FAILURE,
  [ResponseValidationReasonCode.EMPTY_OUTPUT]: RoutingFailureCode.EMPTY_OUTPUT,
  [ResponseValidationReasonCode.OUTPUT_LIMIT_VIOLATION]: RoutingFailureCode.OUTPUT_LIMIT_VIOLATION,
  [ResponseValidationReasonCode.AUTHORITY_SCOPE_VIOLATION]: RoutingFailureCode.SEMANTIC_VALIDATION_FAILED,
});

export function failurePolicy(code: RoutingFailureCode): RoutingFailurePolicy {
  const policy = ROUTING_FAILURE_MATRIX.find((candidate) => candidate.code === code);
  if (!policy) throw new Error('Routing failure code is absent from the matrix');
  return policy;
}

export function classifyProviderFailure(kind: AiFailureKind): RoutingFailureCode {
  return PROVIDER_FAILURES[kind];
}

/** Safety > response-operational > semantic > generic validation. */
export function classifyValidationFailure(validation: RuntimeValidationResult): RoutingFailureCode | null {
  if (validation.disposition === ValidationDisposition.ACCEPT && validation.reasonCodes.length === 0) return null;
  const mapped = validation.reasonCodes.map((reason) => REASONS[reason]).filter((code): code is RoutingFailureCode => code !== undefined);
  return (
    mapped.find((code) => failurePolicy(code).failureClass === RoutingFailureClass.SAFETY) ??
    mapped.find((code) => failurePolicy(code).failureClass === RoutingFailureClass.OPERATIONAL) ??
    mapped.find((code) => code === RoutingFailureCode.SEMANTIC_VALIDATION_FAILED) ??
    RoutingFailureCode.STRUCTURAL_VALIDATION_FAILED
  );
}
