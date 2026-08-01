import { describe, expect, it } from 'vitest';
import type {
  BenchmarkCampaignReport,
  BenchmarkScorecard,
  CampaignCoverage,
} from './provider-benchmark';
import {
  STAGE_2A_DECISION_POLICY_VERSION,
  selectBenchmarkChampions,
} from './provider-benchmark-decision';

const scorecard = (
  model: string,
  overrides: Partial<BenchmarkScorecard> = {},
): BenchmarkScorecard => ({
  model,
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

const coverage = (models: readonly string[]): CampaignCoverage => ({
  expectedModels: models,
  observedModels: models,
  completedModels: models,
  missingModels: [],
  incompleteModels: [],
  unexpectedModels: [],
  completionRate: 100,
  modelDetails: [],
});

const report = (
  scorecards: readonly BenchmarkScorecard[],
  overrides: Partial<BenchmarkCampaignReport> = {},
): BenchmarkCampaignReport => {
  const models = scorecards.map((item) => item.model);
  return {
    campaignId: 'campaign',
    phase: 'A2',
    configurationSource: 'EXPLICIT_FILE',
    configurationDigest: 'a'.repeat(64),
    configurationIdentity: 'a'.repeat(64),
    campaignFingerprint: 'b'.repeat(64),
    expectedModels: models,
    observedModels: models,
    budget: {
      configurations: models.length,
      executions: models.length * 10,
      generationCalls: models.length * 100,
      versionCalls: models.length * 10,
      inventoryCalls: models.length * 10,
      childCalls: models.length * 120,
    },
    coverage: coverage(models),
    campaignComplete: true,
    provisional: false,
    scorecards,
    providerMatrix: [],
    ...overrides,
  };
};

describe('benchmark decision boundary', () => {
  it('keeps scorecards available while blocking final publication for incomplete campaigns', () => {
    const input = report([scorecard('challenger')], {
      campaignComplete: false,
      provisional: true,
    });
    expect(input.scorecards).toHaveLength(1);
    expect(selectBenchmarkChampions(input)).toMatchObject({
      provisional: true,
      advancement: [],
      champions: {
        semanticChampion: null,
        latencyChampion: null,
        overallChampion: null,
      },
    });
  });

  it('blocks Champion publication for unknown legacy identity', () => {
    const input = report([scorecard('challenger')], {
      configurationIdentity: 'UNKNOWN_LEGACY',
      campaignFingerprint: null,
      campaignComplete: false,
      provisional: true,
    });
    expect(selectBenchmarkChampions(input).champions.overallChampion).toBeNull();
  });

  it('allows a challenger to become all three champions without role bias', () => {
    const decision = selectBenchmarkChampions(
      report([
        scorecard('challenger', { p95LatencyMs: 50 }),
        scorecard('reference', { semantic: 96, overall: 90, p95LatencyMs: 200 }),
      ]),
    );
    expect(decision).toMatchObject({
      decisionPolicyVersion: STAGE_2A_DECISION_POLICY_VERSION,
      provisional: false,
      champions: {
        semanticChampion: 'challenger',
        latencyChampion: 'challenger',
        overallChampion: 'challenger',
        statisticalTie: false,
      },
    });
    expect(decision.scorecards.every((item) => item.winnerEligible)).toBe(true);
  });

  it('preserves the existing statistical tie policy', () => {
    const decision = selectBenchmarkChampions(
      report([
        scorecard('alpha', { overall: 99, semantic: 100 }),
        scorecard('beta', { overall: 97, semantic: 99 }),
      ]),
    );
    expect(decision.champions).toMatchObject({
      overallChampion: null,
      statisticalTie: true,
    });
  });

  it('owns A1 advancement and eligibility outside the scorecard engine', () => {
    const a1 = report(
      [scorecard('alpha'), scorecard('beta', { authority: 89 })],
      { phase: 'A1' },
    );
    const decision = selectBenchmarkChampions(a1);
    expect(decision.advancement).toEqual(['alpha']);
    expect(decision.scorecards).toEqual([
      {
        model: 'alpha',
        advancementEligible: true,
        winnerEligible: false,
        acceptanceQualified: true,
      },
      {
        model: 'beta',
        advancementEligible: false,
        winnerEligible: false,
        acceptanceQualified: true,
      },
    ]);
  });
});
