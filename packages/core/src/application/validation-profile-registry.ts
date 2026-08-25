import { createHash } from 'node:crypto';
import {
  ROUTING_RESPONSE_RULE_CONTRACT_VERSION,
  RuntimeValidationRule,
  RoutingFailureCode,
} from './runtime-response-validation-contracts';
import {
  ReliabilityTier,
  RoutingConfigurationError,
  ValidationProfileId,
  isRoutingIdentifier,
  validationProfileId,
} from './provider-routing-contracts';

const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_PROFILE_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_OUTPUT_LIMIT_BYTES = 64 * 1024;
const RULE_ORDER = Object.freeze(Object.values(RuntimeValidationRule));
const RULES = new Set(RULE_ORDER);
const RELIABILITY_TIERS = new Set(Object.values(ReliabilityTier));

export const LOW_RISK_FAST_PATH = validationProfileId('LOW_RISK_FAST_PATH');
export const GENERAL_CHAT = validationProfileId('GENERAL_CHAT');
export const AUTHORITY_SENSITIVE = validationProfileId('AUTHORITY_SENSITIVE');

export enum ValidationReliabilityAxis {
  SEMANTIC = 'SEMANTIC',
  AUTHORITY = 'AUTHORITY',
}

const RELIABILITY_AXES = new Set(Object.values(ValidationReliabilityAxis));

export interface ValidationProfileConfiguration {
  readonly profileId: ValidationProfileId;
  readonly version: string;
  readonly rules: readonly RuntimeValidationRule[];
  readonly outputLimitBytes: number;
  readonly escalationEnabled: boolean;
  readonly escalationReliabilityAxis?: ValidationReliabilityAxis;
  readonly minimumEscalationReliability?: ReliabilityTier;
}

export interface ValidationProfileDefinition extends ValidationProfileConfiguration {
  readonly ruleContractVersion: typeof ROUTING_RESPONSE_RULE_CONTRACT_VERSION;
  readonly configurationDigest: string;
}

export class ValidationProfileConfigurationError extends RoutingConfigurationError {
  constructor(
    readonly code: RoutingFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'ValidationProfileConfigurationError';
  }
}

function fail(code: RoutingFailureCode, message: string): never {
  throw new ValidationProfileConfigurationError(code, message);
}

function profileDigest(configuration: Omit<ValidationProfileDefinition, 'configurationDigest'>): string {
  return createHash('sha256').update(JSON.stringify(configuration)).digest('hex');
}

function normalize(configuration: ValidationProfileConfiguration): ValidationProfileDefinition {
  if (
    typeof configuration.profileId !== 'string' ||
    !isRoutingIdentifier(configuration.profileId) ||
    typeof configuration.version !== 'string' ||
    !VERSION.test(configuration.version)
  ) {
    fail(RoutingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Invalid validation profile identity');
  }
  if (
    !Number.isSafeInteger(configuration.outputLimitBytes) ||
    configuration.outputLimitBytes <= 0 ||
    configuration.outputLimitBytes > MAX_PROFILE_OUTPUT_BYTES ||
    !Array.isArray(configuration.rules) ||
    configuration.rules.length === 0
  ) {
    fail(RoutingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Invalid validation profile bounds');
  }
  if (new Set(configuration.rules).size !== configuration.rules.length || configuration.rules.some((rule) => !RULES.has(rule))) {
    fail(RoutingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Invalid validation profile rules');
  }
  if (
    typeof configuration.escalationEnabled !== 'boolean' ||
    configuration.escalationEnabled !== Boolean(configuration.escalationReliabilityAxis) ||
    configuration.escalationEnabled !== Boolean(configuration.minimumEscalationReliability) ||
    (configuration.escalationReliabilityAxis !== undefined &&
      !RELIABILITY_AXES.has(configuration.escalationReliabilityAxis)) ||
    (configuration.minimumEscalationReliability !== undefined &&
      !RELIABILITY_TIERS.has(configuration.minimumEscalationReliability))
  ) {
    fail(RoutingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Invalid validation escalation configuration');
  }

  const rules = Object.freeze(
    [...configuration.rules].sort((left, right) => RULE_ORDER.indexOf(left) - RULE_ORDER.indexOf(right)),
  );
  const canonical = {
    profileId: configuration.profileId,
    version: configuration.version,
    rules,
    outputLimitBytes: configuration.outputLimitBytes,
    escalationEnabled: configuration.escalationEnabled,
    ...(configuration.escalationReliabilityAxis
      ? { escalationReliabilityAxis: configuration.escalationReliabilityAxis }
      : {}),
    ...(configuration.minimumEscalationReliability
      ? { minimumEscalationReliability: configuration.minimumEscalationReliability }
      : {}),
    ruleContractVersion: ROUTING_RESPONSE_RULE_CONTRACT_VERSION,
  };
  return Object.freeze({ ...canonical, configurationDigest: profileDigest(canonical) });
}

/** Immutable registry selected upstream; the Runtime validator only resolves and consumes it. */
export class ValidationProfileRegistry {
  private readonly definitions: readonly ValidationProfileDefinition[];

  constructor(configurations: readonly ValidationProfileConfiguration[]) {
    if (configurations.length === 0) {
      fail(RoutingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Validation profile registry must not be empty');
    }
    const seen = new Set<string>();
    const definitions = configurations.map((configuration) => {
      if (seen.has(configuration.profileId)) {
        fail(RoutingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Duplicate validation profile');
      }
      seen.add(configuration.profileId);
      return normalize(configuration);
    });
    definitions.sort((left, right) => left.profileId.localeCompare(right.profileId));
    this.definitions = Object.freeze(definitions);
    Object.freeze(this);
  }

  all(): readonly ValidationProfileDefinition[] {
    return this.definitions;
  }

  resolve(id: ValidationProfileId): ValidationProfileDefinition {
    const definition = this.definitions.find((candidate) => candidate.profileId === id);
    if (!definition) {
      fail(RoutingFailureCode.UNKNOWN_VALIDATION_PROFILE, 'Unknown validation profile');
    }
    return definition;
  }
}

export function createDefaultValidationProfileRegistry(): ValidationProfileRegistry {
  return new ValidationProfileRegistry([
    {
      profileId: LOW_RISK_FAST_PATH,
      version: '1',
      rules: [RuntimeValidationRule.NON_EMPTY, RuntimeValidationRule.OUTPUT_LIMIT],
      outputLimitBytes: DEFAULT_OUTPUT_LIMIT_BYTES,
      escalationEnabled: false,
    },
    {
      profileId: GENERAL_CHAT,
      version: '2',
      rules: [
        RuntimeValidationRule.NON_EMPTY,
        RuntimeValidationRule.OUTPUT_LIMIT,
        RuntimeValidationRule.PROMPT_LEAK,
        RuntimeValidationRule.MULTI_ENTRY_ECHO,
        RuntimeValidationRule.SECRET_EXPOSURE_RISK,
        RuntimeValidationRule.RECENCY_GROUNDING,
      ],
      outputLimitBytes: DEFAULT_OUTPUT_LIMIT_BYTES,
      escalationEnabled: true,
      escalationReliabilityAxis: ValidationReliabilityAxis.SEMANTIC,
      minimumEscalationReliability: ReliabilityTier.HIGH,
    },
    {
      profileId: AUTHORITY_SENSITIVE,
      version: '1',
      rules: [
        RuntimeValidationRule.NON_EMPTY,
        RuntimeValidationRule.OUTPUT_LIMIT,
        RuntimeValidationRule.PROMPT_LEAK,
        RuntimeValidationRule.MULTI_ENTRY_ECHO,
        RuntimeValidationRule.SECRET_EXPOSURE_RISK,
        RuntimeValidationRule.AUTHORITY_SEMANTIC_SCOPE,
      ],
      outputLimitBytes: DEFAULT_OUTPUT_LIMIT_BYTES,
      escalationEnabled: true,
      escalationReliabilityAxis: ValidationReliabilityAxis.AUTHORITY,
      minimumEscalationReliability: ReliabilityTier.STANDARD,
    },
  ]);
}
