import {
  AuthorityRequirement,
  AvailabilityClass,
  Capability,
  ConcurrencyClass,
  ContextCapacity,
  CostTier,
  ExecutionLocality,
  IntentType,
  LatencyClass,
  LatencyTier,
  OutputSizeClass,
  ProviderAvailability,
  ProviderDescriptor,
  ProviderRegistry,
  RankingDimension,
  ReliabilityTier,
  Requirement,
  RoutingClass,
  RoutingContext,
  RoutingPolicy,
  RoutingPolicyConfiguration,
  RoutingPolicyEngine,
  RoutingRequestType,
  SemanticRisk,
  SortDirection,
  SupportLevel,
  TerminalDecision,
  TimeoutClass,
  adapterId,
  policyId,
  providerId,
  validationProfileId,
} from '@chunsik/core';
import { selectionDigest } from './canonical';
import {
  CanonicalSelectionProjection,
  SelectionFixture,
  SelectionPolicyFixture,
  SelectionProviderFixture,
  SelectionReplayResult,
} from './contracts';

function optional<T>(values: readonly T[]): readonly T[] | undefined {
  return values.length === 0 ? undefined : values;
}

function descriptor(provider: SelectionProviderFixture): ProviderDescriptor {
  return {
    providerId: providerId(provider.id),
    adapterId: adapterId('selection-fixture-adapter'),
    modelId: `opaque-${provider.id}`,
    capabilities: {
      supportedCapabilities: provider.supportedCapabilities as Capability[],
      routingClasses: provider.routingClasses as RoutingClass[],
      semanticReliability: provider.semanticReliability as ReliabilityTier,
      authorityReliability: provider.authorityReliability as ReliabilityTier,
      continuityReliability: provider.continuityReliability as ReliabilityTier,
      toolUse: provider.toolUse as SupportLevel,
      structuredOutput: provider.structuredOutput as SupportLevel,
      contextCapacity: provider.contextCapacity as ContextCapacity,
      streaming: SupportLevel.UNSUPPORTED,
      executionLocality: provider.executionLocality as ExecutionLocality,
    },
    operationalProfile: {
      latencyTier: provider.latencyTier as LatencyTier,
      timeoutClass: TimeoutClass.STANDARD,
      costTier: provider.costTier as CostTier,
      concurrencyClass: ConcurrencyClass.LIMITED,
      availabilityClass: AvailabilityClass.LOCAL_STABLE,
    },
    enabled: provider.enabled,
    profileVersion: 'selection-fixture-profile-v1',
  };
}

function compilePolicy(input: SelectionPolicyFixture): RoutingPolicy {
  const when = input.when;
  const eligibility = input.eligibility;
  return {
    policyId: policyId(input.policyId),
    version: input.version,
    precedence: input.precedence,
    when: {
      capabilities: optional(when.capabilities as Capability[]),
      requestTypes: optional(when.requestTypes as RoutingRequestType[]),
      intentTypes: optional(when.intentTypes as IntentType[]),
      semanticRisks: optional(when.semanticRisks as SemanticRisk[]),
      latencyClasses: optional(when.latencyClasses as LatencyClass[]),
      toolUseRequirements: optional(when.toolUseRequirements as Requirement[]),
      authorityRequirements: optional(when.authorityRequirements as AuthorityRequirement[]),
      continuityRequirements: optional(when.continuityRequirements as Requirement[]),
      outputSizes: optional(when.outputSizes as OutputSizeClass[]),
      validationProfiles: optional((when.validationProfiles as string[]).map(validationProfileId)),
    },
    eligibility: {
      requiredRoutingClasses: optional(eligibility.requiredRoutingClasses as RoutingClass[]),
      excludedRoutingClasses: optional(eligibility.excludedRoutingClasses as RoutingClass[]),
      minimumSemanticReliability: (eligibility.minimumSemanticReliability as ReliabilityTier | null) ?? undefined,
      minimumAuthorityReliability: (eligibility.minimumAuthorityReliability as ReliabilityTier | null) ?? undefined,
      minimumContinuityReliability: (eligibility.minimumContinuityReliability as ReliabilityTier | null) ?? undefined,
      requiresToolUse: (eligibility.requiresToolUse as boolean | null) ?? undefined,
      requiresStructuredOutput: (eligibility.requiresStructuredOutput as boolean | null) ?? undefined,
      minimumContextCapacity: (eligibility.minimumContextCapacity as ContextCapacity | null) ?? undefined,
      executionLocality: (eligibility.executionLocality as ExecutionLocality | null) ?? undefined,
    },
    ranking: input.ranking.map((rule) => ({
      dimension: rule.dimension as RankingDimension,
      direction: rule.direction as SortDirection,
      ...(rule.routingClassPreference.length === 0
        ? {}
        : { routingClassPreference: rule.routingClassPreference as RoutingClass[] }),
    })),
    terminal: input.terminal as TerminalDecision,
  };
}

function context(fixture: SelectionFixture): RoutingContext {
  return {
    capability: fixture.context.capability as Capability,
    requestType: fixture.context.requestType as RoutingRequestType,
    intentType: fixture.context.intentType as IntentType,
    semanticRisk: fixture.context.semanticRisk as SemanticRisk,
    latencyClass: fixture.context.latencyClass as LatencyClass,
    toolUseRequirement: fixture.context.toolUseRequirement as Requirement,
    authorityRequirement: fixture.context.authorityRequirement as AuthorityRequirement,
    continuityRequirement: fixture.context.continuityRequirement as Requirement,
    expectedOutputSize: fixture.context.expectedOutputSize as OutputSizeClass,
    validationProfile: validationProfileId(fixture.context.validationProfile!),
  };
}

interface ReplayPermutation {
  readonly reverseProviders: boolean;
  readonly reversePolicies: boolean;
}

const ORIGINAL: ReplayPermutation = Object.freeze({ reverseProviders: false, reversePolicies: false });
const FIXED_PERMUTATION: ReplayPermutation = Object.freeze({ reverseProviders: true, reversePolicies: true });

function reverse<T>(values: readonly T[], enabled: boolean): readonly T[] {
  return enabled ? [...values].reverse() : values;
}

function run(fixture: SelectionFixture, permutation: ReplayPermutation): SelectionReplayResult {
  const providers = reverse(fixture.registry.providers, permutation.reverseProviders);
  const registry = new ProviderRegistry(
    fixture.registry.version,
    providers.map((provider) => {
      const value = descriptor(provider);
      return { providerId: value.providerId, descriptor: value };
    }),
  );
  const snapshot = registry.snapshot(
    Object.fromEntries(providers.map((provider) => [provider.id, provider.availability as ProviderAvailability])),
  );
  const policyFixtures = reverse(fixture.policyConfiguration.policies, permutation.reversePolicies);
  const configuration: RoutingPolicyConfiguration = {
    version: fixture.policyConfiguration.version,
    policies: policyFixtures.map(compilePolicy),
  };
  const engine = new RoutingPolicyEngine(configuration);
  const decision = engine.select(context(fixture), snapshot);
  const matched = policyFixtures.find((policy) => policy.policyId === decision.matchedPolicyId);
  const projection: CanonicalSelectionProjection = Object.freeze({
    selectedProviderId: decision.selectedProviderId,
    eligibleProviderIds: Object.freeze([...decision.eligibleProviderIds]),
    matchedPolicyId: decision.matchedPolicyId,
    reasonCode: decision.reasonCode,
    policyVersion: decision.policyVersion,
    registryVersion: decision.registryVersion,
    registryConfigurationDigest: decision.registryConfigurationDigest,
    policyConfigurationDigest: decision.policyConfigurationDigest,
    configurationDigest: decision.configurationDigest,
    rankingVector: Object.freeze((matched?.ranking ?? []).map((rule) => Object.freeze({
      dimension: rule.dimension as RankingDimension,
      direction: rule.direction as SortDirection,
    }))),
  });
  return Object.freeze({ projection, projectionDigest: selectionDigest(projection), providerInvocations: 0 });
}

export function replaySelectionFixture(fixture: SelectionFixture): SelectionReplayResult {
  return run(fixture, ORIGINAL);
}

export function replaySelectionFixtureMetamorphic(fixture: SelectionFixture): SelectionReplayResult {
  return run(fixture, FIXED_PERMUTATION);
}

export function replaySelectionFixtureTwice(fixture: SelectionFixture): readonly [SelectionReplayResult, SelectionReplayResult] {
  return [run(fixture, ORIGINAL), run(fixture, ORIGINAL)];
}
