import { describe, expect, it } from 'vitest';
import { AiFailureKind } from '../domain';
import {
  classifyProviderFailure,
  classifyValidationFailure,
} from './routing-failure-classifier';
import {
  ResponseValidationReasonCode,
  ROUTING_RESPONSE_RULE_CONTRACT_VERSION,
  RoutingFailureCode,
  RuntimeValidationResult,
  ValidationDisposition,
} from './runtime-response-validation-contracts';

function validation(
  disposition: ValidationDisposition,
  reasonCodes: readonly ResponseValidationReasonCode[],
): RuntimeValidationResult {
  return {
    disposition,
    reasonCodes,
    responseSha256: 'a'.repeat(64),
    byteCount: 1,
    profileVersion: '1',
    ruleContractVersion: ROUTING_RESPONSE_RULE_CONTRACT_VERSION,
  };
}

describe('routing failure classifier', () => {
  it('maps provider failures without inspecting provider identity', () => {
    expect(classifyProviderFailure(AiFailureKind.UNAVAILABLE)).toBe(RoutingFailureCode.PROVIDER_UNAVAILABLE);
    expect(classifyProviderFailure(AiFailureKind.AUTH_REQUIRED)).toBe(RoutingFailureCode.PROVIDER_AUTH_REQUIRED);
    expect(classifyProviderFailure(AiFailureKind.TIMEOUT)).toBe(RoutingFailureCode.PROVIDER_TIMEOUT);
    expect(classifyProviderFailure(AiFailureKind.EXECUTION_FAILED)).toBe(
      RoutingFailureCode.PROVIDER_EXECUTION_FAILED,
    );
    expect(classifyProviderFailure(AiFailureKind.EMPTY_OUTPUT)).toBe(RoutingFailureCode.EMPTY_OUTPUT);
  });

  it('applies safety before operational and semantic validation reasons', () => {
    expect(
      classifyValidationFailure(
        validation(ValidationDisposition.REJECT, [
          ResponseValidationReasonCode.AUTHORITY_SCOPE_VIOLATION,
          ResponseValidationReasonCode.OUTPUT_LIMIT_VIOLATION,
          ResponseValidationReasonCode.PROMPT_LEAK,
        ]),
      ),
    ).toBe(RoutingFailureCode.PROMPT_LEAK);
  });

  it('applies response-operational failure before semantic escalation', () => {
    expect(
      classifyValidationFailure(
        validation(ValidationDisposition.ESCALATE, [
          ResponseValidationReasonCode.AUTHORITY_SCOPE_VIOLATION,
          ResponseValidationReasonCode.OUTPUT_LIMIT_VIOLATION,
        ]),
      ),
    ).toBe(RoutingFailureCode.OUTPUT_LIMIT_VIOLATION);
  });

  it('returns no failure only for a clean accepted validation', () => {
    expect(classifyValidationFailure(validation(ValidationDisposition.ACCEPT, []))).toBeNull();
  });
});
