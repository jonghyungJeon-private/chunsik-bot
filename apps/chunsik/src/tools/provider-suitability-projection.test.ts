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
  ReliabilityTier,
  RankingDimension,
  RoutingClass,
  RoutingPolicyEngine,
  SortDirection,
  SupportLevel,
  TerminalDecision,
  TimeoutClass,
  adapterId,
  policyId,
  providerId,
} from '@chunsik/core';
import type { BenchmarkCampaignReport, BenchmarkScorecard } from './provider-benchmark';
import type { BenchmarkDecision } from './provider-benchmark-decision';
import {
  SUITABILITY_PROJECTION_VERSION,
  SuitabilityProjectionInput,
  computeSuitabilityDescriptorConfigurationDigest,
  projectProviderSuitability,
} from './provider-suitability-projection';

const modelId = 'synthetic:1b';
const provider = 'synthetic-cli:synthetic:1b';
const sha = (character: string): string => character.repeat(64);

const scorecard = (overrides: Partial<BenchmarkScorecard> = {}): BenchmarkScorecard => ({
  model: modelId,
  sampleCount: 100,
  scenarioCounts: { A: 20, B: 20, C: 20, D: 20, E: 20 },
  automatedPassCount: 100,
  automatedFailCount: 0,
  humanReviewRequiredCount: 0,
  semantic: 100,
  worstScenarioPass: 100,
  authority: 100,
  continuity: 100,
  targetPreservation: 100,
  instructionFollowing: 100,
  latency: 100,
  p95LatencyMs: 100,
  averageLatencyMs: 90,
  outputStability: 100,
  averageResponseBytes: 100,
  p95ResponseBytes: 100,
  variance: 100,
  overall: 100,
  criticalFailure: false,
  complete: true,
  failureDistribution: {
    LEAK: 0,
    CONTAINMENT: 0,
    EXECUTION: 0,
    AUTHORITY: 0,
    TARGET_PRESERVATION: 0,
    CONTINUITY: 0,
    CLARIFICATION: 0,
    INSTRUCTION_FOLLOWING: 0,
    FORMATTING: 0,
    OTHER: 0,
  },
  ...overrides,
});

const report = (card: BenchmarkScorecard = scorecard()): BenchmarkCampaignReport => ({
  campaignId: 'campaign-v1',
  phase: 'A2',
  configurationSource: 'EXPLICIT_FILE',
  configurationDigest: sha('a'),
  configurationIdentity: sha('a'),
  campaignFingerprint: sha('b'),
  expectedModels: [modelId],
  observedModels: [modelId],
  budget: { configurations: 1, executions: 10, generationCalls: 100, versionCalls: 10, inventoryCalls: 10, childCalls: 120 },
  coverage: { expectedModels: [modelId], observedModels: [modelId], completedModels: [modelId], missingModels: [],
    incompleteModels: [], unexpectedModels: [], completionRate: 100, modelDetails: [] },
  campaignComplete: true,
  provisional: false,
  scorecards: [card],
  providerMatrix: [],
});

const decision = (acceptanceQualified = true): BenchmarkDecision => ({
  decisionPolicyVersion: 'stage2a-provider-decision-v2.1',
  provisional: false,
  scorecards: [{ model: modelId, advancementEligible: false, winnerEligible: true, acceptanceQualified }],
  advancement: [],
  champions: { semanticChampion: modelId, latencyChampion: modelId, overallChampion: modelId, statisticalTie: false },
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

const input = (overrides: Partial<SuitabilityProjectionInput> = {}): SuitabilityProjectionInput => {
  const base: SuitabilityProjectionInput = {
    report: report(),
    decision: decision(),
    evidenceBinding: {
    campaignId: 'campaign-v1',
    benchmarkContractVersion: 'stage2a-provider-benchmark-v2',
    benchmarkConfigurationDigest: sha('a'),
    campaignFingerprint: sha('b'),
    decisionPolicyVersion: 'stage2a-provider-decision-v2.1',
    providerId: provider,
    adapterId: 'synthetic-cli',
    modelId,
    descriptorConfigurationDigest: computeSuitabilityDescriptorConfigurationDigest(descriptorTemplate),
    promptContractVersion: 'prompt-v1',
    scenarioContractVersion: 'scenario-v1',
    evaluatorContractVersion: 'evaluator-v1',
    projectionVersion: SUITABILITY_PROJECTION_VERSION,
  },
    hardFailures: { promptLeak: false, multiEntryEcho: false, containmentOrCleanupFailure: false,
      bindingMismatch: false, promptShaMismatch: false, downloadMarker: false },
    descriptorTemplate,
  };
  return { ...base, ...overrides };
};

describe('provider suitability projection', () => {
  it('projects the same bounded candidate and digest for the same evidence', () => {
    const first = projectProviderSuitability(input());
    const second = projectProviderSuitability(input());
    expect(first).toEqual(second);
    expect(first).toMatchObject({ suitability: 'ELIGIBLE', reasonCodes: ['QUALIFIED_EVIDENCE'],
      ratificationStatus: 'RATIFICATION_REQUIRED', runtimeMutation: 'NONE',
      descriptorCandidate: { providerId: provider, modelId, enabled: false } });
    expect(first.candidateProfileDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is invariant to scorecard and decision field insertion order', () => {
    const normal = projectProviderSuitability(input());
    const reversedCard = Object.fromEntries(Object.entries(scorecard()).reverse()) as unknown as BenchmarkScorecard;
    const reversedDecision = Object.fromEntries(Object.entries(decision()).reverse()) as unknown as BenchmarkDecision;
    const permuted = projectProviderSuitability(input({ report: report(reversedCard), decision: reversedDecision }));
    expect(permuted.candidateProfileDigest).toBe(normal.candidateProfileDigest);
  });

  it('is invariant to unrelated model input ordering', () => {
    const otherCard = { ...scorecard(), model: 'other:1b' };
    const otherDecision = { ...decision().scorecards[0]!, model: 'other:1b' };
    const base = input();
    const withOrder = (reverse: boolean): SuitabilityProjectionInput => ({ ...base,
      report: { ...base.report, expectedModels: [modelId, 'other:1b'], observedModels: [modelId, 'other:1b'],
        scorecards: reverse ? [otherCard, ...base.report.scorecards] : [...base.report.scorecards, otherCard] },
      decision: { ...base.decision, scorecards: reverse ? [otherDecision, ...base.decision.scorecards] :
        [...base.decision.scorecards, otherDecision] } });
    expect(projectProviderSuitability(withOrder(true)).candidateProfileDigest)
      .toBe(projectProviderSuitability(withOrder(false)).candidateProfileDigest);
  });

  it.each([
    ['prompt leak', { promptLeak: true }, 'PROMPT_LEAK'],
    ['multi-entry echo', { multiEntryEcho: true }, 'MULTI_ENTRY_ECHO'],
    ['containment failure', { containmentOrCleanupFailure: true }, 'CONTAINMENT_OR_CLEANUP_FAILURE'],
    ['download marker', { downloadMarker: true }, 'DOWNLOAD_MARKER'],
  ] as const)('never makes %s evidence eligible', (_label, failure, reason) => {
    const projected = projectProviderSuitability(input({ hardFailures: { ...input().hardFailures, ...failure } }));
    expect(projected.suitability).toBe('INELIGIBLE');
    expect(projected.reasonCodes).toContain(reason);
    expect(projected.descriptorCandidate.enabled).toBe(false);
  });

  it('maps incomplete or insufficient evidence to UNPROVEN', () => {
    const card = scorecard({ complete: false });
    const incompleteReport = { ...report(card), campaignComplete: false, provisional: true };
    const incompleteDecision = { ...decision(false), provisional: true };
    const projected = projectProviderSuitability(input({ report: incompleteReport, decision: incompleteDecision }));
    expect(projected.suitability).toBe('UNPROVEN');
    expect(projected.reasonCodes).toEqual(expect.arrayContaining(['CAMPAIGN_INCOMPLETE', 'MODEL_EVIDENCE_INCOMPLETE']));
  });

  it.each([
    ['provider/model mismatch', { evidenceBinding: { ...input().evidenceBinding, providerId: 'other:model' } },
      'PROVIDER_MODEL_IDENTITY_MISMATCH'],
    ['configuration digest mismatch', { evidenceBinding: { ...input().evidenceBinding,
      benchmarkConfigurationDigest: sha('d') } }, 'EVIDENCE_BINDING_MISMATCH'],
    ['campaign fingerprint mismatch', { evidenceBinding: { ...input().evidenceBinding,
      campaignFingerprint: sha('e') } }, 'EVIDENCE_BINDING_MISMATCH'],
    ['stale projection version', { evidenceBinding: { ...input().evidenceBinding,
      projectionVersion: 'stage2c-suitability-projection-v0' as typeof SUITABILITY_PROJECTION_VERSION } },
      'EVIDENCE_BINDING_MISMATCH'],
  ] as const)('rejects %s', (_label, patch, code) => {
    expect(() => projectProviderSuitability(input(patch))).toThrowError(code);
  });

  it('rejects stale descriptor configuration', () => {
    const changed = { ...descriptorTemplate, operationalProfile: { ...descriptorTemplate.operationalProfile,
      latencyTier: LatencyTier.FAST } };
    expect(() => projectProviderSuitability(input({ descriptorTemplate: changed })))
      .toThrowError('DESCRIPTOR_CONFIGURATION_MISMATCH');
  });

  it('fails closed for malformed runtime evidence', () => {
    expect(() => projectProviderSuitability(undefined as unknown as SuitabilityProjectionInput))
      .toThrowError('MALFORMED_SUITABILITY_EVIDENCE');
  });

  it.each([
    ['binding mismatch', { bindingMismatch: true }, 'EVIDENCE_BINDING_MISMATCH'],
    ['prompt SHA mismatch', { promptShaMismatch: true }, 'PROMPT_SHA_MISMATCH'],
  ] as const)('rejects integrity failure: %s', (_label, failure, code) => {
    expect(() => projectProviderSuitability(input({ hardFailures: { ...input().hardFailures, ...failure } })))
      .toThrowError(code);
  });

  it('does not mutate an existing runtime registry or routing-visible snapshot', () => {
    const runtimeDescriptor = { ...projectProviderSuitability(input()).descriptorCandidate,
      providerId: providerId('runtime:stable'), adapterId: adapterId('runtime'), modelId: 'stable',
      evidenceBindingDigest: sha('f') };
    const registry = new ProviderRegistry('runtime-v1', [{ providerId: runtimeDescriptor.providerId,
      descriptor: runtimeDescriptor }]);
    const policy = new RoutingPolicyEngine({ version: 'runtime-v1', policies: [{
      policyId: policyId('runtime-policy'), version: '1', precedence: 1,
      when: { capabilities: [Capability.GENERAL_CHAT] }, eligibility: {},
      ranking: [{ dimension: RankingDimension.SEMANTIC_RELIABILITY,
        direction: SortDirection.DESCENDING }], terminal: TerminalDecision.NO_SELECTION,
    }] });
    const before = registry.snapshot({ 'runtime:stable': ProviderAvailability.AVAILABLE });
    const policyDigest = policy.policyDigest;
    projectProviderSuitability(input());
    expect(registry.snapshot({ 'runtime:stable': ProviderAvailability.AVAILABLE })).toEqual(before);
    expect(registry.get(providerId(provider))).toBeUndefined();
    expect(policy.policyDigest).toBe(policyDigest);
  });
});
