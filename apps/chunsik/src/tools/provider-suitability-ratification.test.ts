import { describe, expect, it } from 'vitest';
import {
  AvailabilityClass,
  Capability,
  ConcurrencyClass,
  ContextCapacity,
  CostTier,
  ExecutionLocality,
  LatencyTier,
  ProviderAvailability,
  ProviderRegistry,
  RankingDimension,
  ReliabilityTier,
  RoutingClass,
  RoutingPolicyEngine,
  SortDirection,
  SupportLevel,
  TerminalDecision,
  TimeoutClass,
  policyId,
  providerId,
} from '@chunsik/core';
import type { BenchmarkCampaignReport, BenchmarkScorecard } from './provider-benchmark';
import type { BenchmarkDecision } from './provider-benchmark-decision';
import {
  CandidateStaticProviderProfile,
  SUITABILITY_PROJECTION_VERSION,
  SuitabilityProjectionInput,
  computeCandidateProfileDigest,
  computeSuitabilityDescriptorConfigurationDigest,
  projectProviderSuitability,
} from './provider-suitability-projection';
import {
  SUITABILITY_RATIFICATION_CONTRACT_VERSION,
  SuitabilityRatificationApprovalBinding,
  ratifySuitabilityProfile,
} from './provider-suitability-ratification';

const modelId = 'synthetic:1b';
const provider = 'synthetic-cli:synthetic:1b';
const sha = (character: string): string => character.repeat(64);

const scorecard = (overrides: Partial<BenchmarkScorecard> = {}): BenchmarkScorecard => ({
  model: modelId, sampleCount: 100, scenarioCounts: { A: 20, B: 20, C: 20, D: 20, E: 20 },
  automatedPassCount: 100, automatedFailCount: 0, humanReviewRequiredCount: 0, semantic: 100,
  worstScenarioPass: 100, authority: 100, continuity: 100, targetPreservation: 100,
  instructionFollowing: 100, latency: 100, p95LatencyMs: 100, averageLatencyMs: 90,
  outputStability: 100, averageResponseBytes: 100, p95ResponseBytes: 100, variance: 100, overall: 100,
  criticalFailure: false, complete: true,
  failureDistribution: { LEAK: 0, CONTAINMENT: 0, EXECUTION: 0, AUTHORITY: 0,
    TARGET_PRESERVATION: 0, CONTINUITY: 0, CLARIFICATION: 0, INSTRUCTION_FOLLOWING: 0,
    FORMATTING: 0, OTHER: 0 },
  ...overrides,
});

const report = (card: BenchmarkScorecard = scorecard()): BenchmarkCampaignReport => ({
  campaignId: 'campaign-v1', phase: 'A2', configurationSource: 'EXPLICIT_FILE',
  configurationDigest: sha('a'), configurationIdentity: sha('a'), campaignFingerprint: sha('b'),
  expectedModels: [modelId], observedModels: [modelId],
  budget: { configurations: 1, executions: 10, generationCalls: 100, versionCalls: 10,
    inventoryCalls: 10, childCalls: 120 },
  coverage: { expectedModels: [modelId], observedModels: [modelId], completedModels: [modelId],
    missingModels: [], incompleteModels: [], unexpectedModels: [], completionRate: 100, modelDetails: [] },
  campaignComplete: true, provisional: false, scorecards: [card], providerMatrix: [],
});

const decision = (acceptanceQualified = true): BenchmarkDecision => ({
  decisionPolicyVersion: 'stage2a-provider-decision-v2.1', provisional: false,
  scorecards: [{ model: modelId, advancementEligible: false, winnerEligible: true, acceptanceQualified }],
  advancement: [], champions: { semanticChampion: modelId, latencyChampion: modelId,
    overallChampion: modelId, statisticalTie: false },
});

const descriptorTemplate: SuitabilityProjectionInput['descriptorTemplate'] = {
  capabilities: { supportedCapabilities: [Capability.GENERAL_CHAT], routingClasses: [RoutingClass.BALANCED],
    semanticReliability: ReliabilityTier.STANDARD, authorityReliability: ReliabilityTier.STANDARD,
    continuityReliability: ReliabilityTier.STANDARD, toolUse: SupportLevel.UNSUPPORTED,
    structuredOutput: SupportLevel.UNSUPPORTED, contextCapacity: ContextCapacity.MEDIUM,
    streaming: SupportLevel.UNSUPPORTED, executionLocality: ExecutionLocality.LOCAL },
  operationalProfile: { latencyTier: LatencyTier.UNKNOWN, timeoutClass: TimeoutClass.STANDARD,
    costTier: CostTier.UNKNOWN, concurrencyClass: ConcurrencyClass.UNKNOWN,
    availabilityClass: AvailabilityClass.UNKNOWN },
};

function candidate(overrides: Partial<SuitabilityProjectionInput> = {}): CandidateStaticProviderProfile {
  return projectProviderSuitability({ report: report(), decision: decision(),
    evidenceBinding: { campaignId: 'campaign-v1', benchmarkContractVersion: 'stage2a-provider-benchmark-v2',
      benchmarkConfigurationDigest: sha('a'), campaignFingerprint: sha('b'),
      decisionPolicyVersion: 'stage2a-provider-decision-v2.1', providerId: provider,
      adapterId: 'synthetic-cli', modelId,
      descriptorConfigurationDigest: computeSuitabilityDescriptorConfigurationDigest(descriptorTemplate),
      promptContractVersion: 'prompt-v1', scenarioContractVersion: 'scenario-v1',
      evaluatorContractVersion: 'evaluator-v1', projectionVersion: SUITABILITY_PROJECTION_VERSION },
    hardFailures: { promptLeak: false, multiEntryEcho: false, containmentOrCleanupFailure: false,
      bindingMismatch: false, promptShaMismatch: false, downloadMarker: false },
    descriptorTemplate, ...overrides });
}

function approval(value: CandidateStaticProviderProfile): SuitabilityRatificationApprovalBinding {
  return { ratificationContractVersion: SUITABILITY_RATIFICATION_CONTRACT_VERSION,
    approvalId: 'approval-stage2c-slice2', authorityId: 'chief-architect', decision: 'APPROVED',
    candidateProfileDigest: value.candidateProfileDigest, evidenceBindingDigest: value.evidenceDigest,
    descriptorConfigurationDigest: value.descriptorConfigurationDigest,
    providerId: value.descriptorCandidate.providerId, modelId: value.descriptorCandidate.modelId,
    projectionVersion: value.projectionVersion };
}

function redigest(value: CandidateStaticProviderProfile): CandidateStaticProviderProfile {
  const { candidateProfileDigest: _ignored, ...payload } = value;
  return { ...payload, candidateProfileDigest: computeCandidateProfileDigest(payload) };
}

describe('suitability profile ratification', () => {
  it('ratifies an eligible exact candidate as an immutable approved static profile', () => {
    const value = candidate();
    const result = ratifySuitabilityProfile({ candidate: value, approval: approval(value) });
    expect(result).toMatchObject({ ratificationStatus: 'APPROVED',
      ratificationContractVersion: SUITABILITY_RATIFICATION_CONTRACT_VERSION,
      candidateProfileDigest: value.candidateProfileDigest, evidenceBindingDigest: value.evidenceDigest,
      providerId: provider, modelId, runtimeMutation: 'NONE', approvedDescriptor: { enabled: false } });
    expect(result.approvedProfileDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.approvedDescriptor)).toBe(true);
    expect(Object.isFrozen(result.approvedDescriptor.capabilities)).toBe(true);
    expect(Object.isFrozen(result.approvedDescriptor.capabilities.supportedCapabilities)).toBe(true);
    expect(Object.isFrozen(result.approvedDescriptor.operationalProfile)).toBe(true);
  });

  it.each([
    ['INELIGIBLE', { hardFailures: { ...candidateInput().hardFailures, promptLeak: true } }],
    ['UNPROVEN', { report: { ...report(), campaignComplete: false, provisional: true },
      decision: { ...decision(false), provisional: true } }],
  ] as const)('rejects %s candidates', (_status, patch) => {
    const value = candidate(patch as Partial<SuitabilityProjectionInput>);
    expect(() => ratifySuitabilityProfile({ candidate: value, approval: approval(value) }))
      .toThrowError('CANDIDATE_NOT_ELIGIBLE');
  });

  it.each([
    ['candidate digest', (value: CandidateStaticProviderProfile) => ({ ...approval(value),
      candidateProfileDigest: sha('c') }), 'APPROVAL_CANDIDATE_MISMATCH'],
    ['evidence binding', (value: CandidateStaticProviderProfile) => ({ ...approval(value),
      evidenceBindingDigest: sha('d') }), 'APPROVAL_EVIDENCE_MISMATCH'],
    ['descriptor configuration', (value: CandidateStaticProviderProfile) => ({ ...approval(value),
      descriptorConfigurationDigest: sha('e') }), 'APPROVAL_DESCRIPTOR_CONFIGURATION_MISMATCH'],
    ['provider/model', (value: CandidateStaticProviderProfile) => ({ ...approval(value),
      modelId: 'other:1b' }), 'APPROVAL_PROVIDER_MODEL_MISMATCH'],
  ] as const)('rejects stale %s approval binding', (_label, mutate, code) => {
    const value = candidate();
    expect(() => ratifySuitabilityProfile({ candidate: value, approval: mutate(value) }))
      .toThrowError(code);
  });

  it('rejects a candidate whose own digest is stale', () => {
    const value = candidate();
    const stale = { ...value, reasonCodes: ['QUALIFIED_EVIDENCE', 'CAMPAIGN_PROVISIONAL'] as const };
    expect(() => ratifySuitabilityProfile({ candidate: stale, approval: approval(stale) }))
      .toThrowError('CANDIDATE_DIGEST_MISMATCH');
  });

  it.each([
    ['evidence binding', (value: CandidateStaticProviderProfile) => redigest({ ...value,
      descriptorCandidate: { ...value.descriptorCandidate, evidenceBindingDigest: sha('f') } }),
      'EVIDENCE_BINDING_MISMATCH'],
    ['provider/model identity', (value: CandidateStaticProviderProfile) => redigest({ ...value,
      descriptorCandidate: { ...value.descriptorCandidate, modelId: 'other:1b' } }),
      'PROVIDER_MODEL_IDENTITY_MISMATCH'],
    ['descriptor configuration', (value: CandidateStaticProviderProfile) => redigest({ ...value,
      descriptorCandidate: { ...value.descriptorCandidate,
        operationalProfile: { ...value.descriptorCandidate.operationalProfile,
          latencyTier: LatencyTier.SLOW } } }),
      'DESCRIPTOR_CONFIGURATION_MISMATCH'],
    ['enabled descriptor', (value: CandidateStaticProviderProfile) => redigest({ ...value,
      descriptorCandidate: { ...value.descriptorCandidate, enabled: true } }),
      'CANDIDATE_DESCRIPTOR_ENABLED'],
  ] as const)('rejects invalid candidate %s', (_label, mutate, code) => {
    const value = mutate(candidate());
    expect(() => ratifySuitabilityProfile({ candidate: value, approval: approval(value) })).toThrowError(code);
  });

  it('rejects unsupported candidate and ratification versions', () => {
    const value = candidate();
    const staleCandidate = { ...value, projectionVersion: 'stage2c-suitability-projection-v0' as
      typeof SUITABILITY_PROJECTION_VERSION };
    expect(() => ratifySuitabilityProfile({ candidate: staleCandidate, approval: approval(value) }))
      .toThrowError('CANDIDATE_VERSION_UNSUPPORTED');
    expect(() => ratifySuitabilityProfile({ candidate: value, approval: { ...approval(value),
      ratificationContractVersion: 'stage2c-suitability-ratification-v0' as
        typeof SUITABILITY_RATIFICATION_CONTRACT_VERSION } })).toThrowError('RATIFICATION_VERSION_UNSUPPORTED');
  });

  it('rejects malformed approval input', () => {
    const value = candidate();
    expect(() => ratifySuitabilityProfile({ candidate: value, approval: { ...approval(value), extra: true } as
      unknown as SuitabilityRatificationApprovalBinding })).toThrowError('APPROVAL_BINDING_MALFORMED');
  });

  it('is deterministic for identical input and object-key permutation', () => {
    const value = candidate();
    const binding = approval(value);
    const first = ratifySuitabilityProfile({ candidate: value, approval: binding });
    const permutedCandidate = Object.fromEntries(Object.entries(value).reverse()) as
      unknown as CandidateStaticProviderProfile;
    const permutedApproval = Object.fromEntries(Object.entries(binding).reverse()) as
      unknown as SuitabilityRatificationApprovalBinding;
    const second = ratifySuitabilityProfile({ candidate: permutedCandidate, approval: permutedApproval });
    expect(second).toEqual(first);
    expect(second.approvedProfileDigest).toBe(first.approvedProfileDigest);
  });

  it('does not mutate registry, policy, or a production configuration value', () => {
    const value = candidate();
    const registry = new ProviderRegistry('runtime-v1', [{ providerId: value.descriptorCandidate.providerId,
      descriptor: { ...value.descriptorCandidate, providerId: providerId(provider), enabled: true } }]);
    const policy = new RoutingPolicyEngine({ version: 'runtime-v1', policies: [{
      policyId: policyId('runtime-policy'), version: '1', precedence: 1,
      when: { capabilities: [Capability.GENERAL_CHAT] }, eligibility: {},
      ranking: [{ dimension: RankingDimension.SEMANTIC_RELIABILITY,
        direction: SortDirection.DESCENDING }], terminal: TerminalDecision.NO_SELECTION }] });
    const registryBefore = registry.snapshot({ [provider]: ProviderAvailability.AVAILABLE });
    const policyBefore = policy.policyDigest;
    const productionConfiguration = Object.freeze({ digest: sha('9'), appliedProfile: null });
    ratifySuitabilityProfile({ candidate: value, approval: approval(value) });
    expect(registry.snapshot({ [provider]: ProviderAvailability.AVAILABLE })).toEqual(registryBefore);
    expect(policy.policyDigest).toBe(policyBefore);
    expect(productionConfiguration).toEqual({ digest: sha('9'), appliedProfile: null });
  });
});

function candidateInput(): SuitabilityProjectionInput {
  const value = candidate();
  return { report: report(), decision: decision(), evidenceBinding: {
    campaignId: 'campaign-v1', benchmarkContractVersion: 'stage2a-provider-benchmark-v2',
    benchmarkConfigurationDigest: sha('a'), campaignFingerprint: sha('b'),
    decisionPolicyVersion: 'stage2a-provider-decision-v2.1', providerId: provider,
    adapterId: 'synthetic-cli', modelId, descriptorConfigurationDigest: value.descriptorConfigurationDigest,
    promptContractVersion: 'prompt-v1', scenarioContractVersion: 'scenario-v1',
    evaluatorContractVersion: 'evaluator-v1', projectionVersion: SUITABILITY_PROJECTION_VERSION },
    hardFailures: { promptLeak: false, multiEntryEcho: false, containmentOrCleanupFailure: false,
      bindingMismatch: false, promptShaMismatch: false, downloadMarker: false }, descriptorTemplate };
}
