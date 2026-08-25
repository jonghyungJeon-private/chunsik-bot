import { describe, expect, it } from 'vitest';
import { ReliabilityTier } from './provider-routing-contracts';
import {
  RoutingFailureCode,
  RuntimeValidationRule,
} from './runtime-response-validation-contracts';
import {
  AUTHORITY_SENSITIVE,
  GENERAL_CHAT,
  LOW_RISK_FAST_PATH,
  ValidationProfileConfigurationError,
  ValidationProfileRegistry,
  ValidationReliabilityAxis,
  createDefaultValidationProfileRegistry,
} from './validation-profile-registry';

describe('ValidationProfileRegistry', () => {
  it('resolves only the three ratified frozen profiles', () => {
    const registry = createDefaultValidationProfileRegistry();

    expect(registry.all().map((profile) => profile.profileId)).toEqual([
      AUTHORITY_SENSITIVE,
      GENERAL_CHAT,
      LOW_RISK_FAST_PATH,
    ]);
    expect(registry.resolve(GENERAL_CHAT).rules).toEqual([
      RuntimeValidationRule.NON_EMPTY,
      RuntimeValidationRule.OUTPUT_LIMIT,
      RuntimeValidationRule.PROMPT_LEAK,
      RuntimeValidationRule.MULTI_ENTRY_ECHO,
      RuntimeValidationRule.SECRET_EXPOSURE_RISK,
      RuntimeValidationRule.RECENCY_GROUNDING,
    ]);
    expect(registry.resolve(GENERAL_CHAT)).toMatchObject({
      version: '2',
      escalationEnabled: true,
      escalationReliabilityAxis: ValidationReliabilityAxis.SEMANTIC,
      minimumEscalationReliability: ReliabilityTier.HIGH,
    });
    expect(registry.resolve(AUTHORITY_SENSITIVE)).toMatchObject({
      escalationEnabled: true,
      escalationReliabilityAxis: ValidationReliabilityAxis.AUTHORITY,
      minimumEscalationReliability: ReliabilityTier.STANDARD,
    });
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.all())).toBe(true);
    expect(Object.isFrozen(registry.resolve(GENERAL_CHAT))).toBe(true);
    expect(Object.isFrozen(registry.resolve(GENERAL_CHAT).rules)).toBe(true);
  });

  it('fails fast with a bounded code for an unknown profile', () => {
    const registry = createDefaultValidationProfileRegistry();
    try {
      registry.resolve('STRUCTURED_OUTPUT' as typeof GENERAL_CHAT);
      throw new Error('expected unknown profile failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationProfileConfigurationError);
      expect((error as ValidationProfileConfigurationError).code).toBe(
        RoutingFailureCode.UNKNOWN_VALIDATION_PROFILE,
      );
    }
  });

  it('rejects duplicate profile ids', () => {
    const profile = createDefaultValidationProfileRegistry().resolve(LOW_RISK_FAST_PATH);
    const configuration = {
      profileId: profile.profileId,
      version: profile.version,
      rules: profile.rules,
      outputLimitBytes: profile.outputLimitBytes,
      escalationEnabled: false,
    };
    expect(() => new ValidationProfileRegistry([configuration, configuration])).toThrow(/Duplicate/);
  });

  it('canonicalizes rule order and produces a deterministic profile digest', () => {
    const base = {
      profileId: GENERAL_CHAT,
      version: 'fixture-v1',
      outputLimitBytes: 4_096,
      escalationEnabled: false,
    };
    const left = new ValidationProfileRegistry([
      {
        ...base,
        rules: [RuntimeValidationRule.SECRET_EXPOSURE_RISK, RuntimeValidationRule.NON_EMPTY],
      },
    ]).resolve(GENERAL_CHAT);
    const right = new ValidationProfileRegistry([
      {
        ...base,
        rules: [RuntimeValidationRule.NON_EMPTY, RuntimeValidationRule.SECRET_EXPOSURE_RISK],
      },
    ]).resolve(GENERAL_CHAT);

    expect(left.rules).toEqual([RuntimeValidationRule.NON_EMPTY, RuntimeValidationRule.SECRET_EXPOSURE_RISK]);
    expect(left.configurationDigest).toBe(right.configurationDigest);
    expect(left.configurationDigest).toMatch(/^[a-f0-9]{64}$/);
  });
});
