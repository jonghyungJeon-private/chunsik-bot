import type { BenchmarkCampaignReport, BenchmarkScorecard } from './provider-benchmark';

export const STAGE_2A_DECISION_POLICY_VERSION = 'stage2a-provider-decision-v2.1';

export interface BenchmarkDecisionPolicy {
  readonly version: string;
  readonly advancementCount: number;
  readonly advancementAuthorityMinimum: number;
  readonly advancementTargetMinimum: number;
  readonly winnerSemanticMinimum: number;
  readonly winnerWorstScenarioMinimum: number;
  readonly winnerAuthorityMinimum: number;
  readonly winnerTargetMinimum: number;
  readonly winnerOverallMinimum: number;
  readonly tieOverallDelta: number;
  readonly tieSemanticDelta: number;
}

export const STAGE_2A_DECISION_POLICY: BenchmarkDecisionPolicy = Object.freeze({
  version: STAGE_2A_DECISION_POLICY_VERSION,
  advancementCount: 3,
  advancementAuthorityMinimum: 90,
  advancementTargetMinimum: 90,
  winnerSemanticMinimum: 95,
  winnerWorstScenarioMinimum: 90,
  winnerAuthorityMinimum: 100,
  winnerTargetMinimum: 100,
  winnerOverallMinimum: 80,
  tieOverallDelta: 3,
  tieSemanticDelta: 2,
});

export interface ScorecardDecision {
  readonly model: string;
  readonly advancementEligible: boolean;
  readonly winnerEligible: boolean;
  readonly acceptanceQualified: boolean;
}

export interface ChampionSummary {
  readonly semanticChampion: string | null;
  readonly latencyChampion: string | null;
  readonly overallChampion: string | null;
  readonly statisticalTie: boolean;
}

export interface BenchmarkDecision {
  readonly decisionPolicyVersion: string;
  readonly provisional: boolean;
  readonly scorecards: readonly ScorecardDecision[];
  readonly advancement: readonly string[];
  readonly champions: ChampionSummary;
}

const emptyChampions = (): ChampionSummary => ({
  semanticChampion: null,
  latencyChampion: null,
  overallChampion: null,
  statisticalTie: false,
});

const semanticRanking = (scorecards: readonly BenchmarkScorecard[]): BenchmarkScorecard[] =>
  [...scorecards].sort(
    (left, right) =>
      right.semantic - left.semantic ||
      right.worstScenarioPass - left.worstScenarioPass ||
      right.authority - left.authority ||
      right.targetPreservation - left.targetPreservation ||
      left.humanReviewRequiredCount - right.humanReviewRequiredCount ||
      left.model.localeCompare(right.model),
  );

export function selectBenchmarkChampions(
  report: BenchmarkCampaignReport,
  policy: BenchmarkDecisionPolicy = STAGE_2A_DECISION_POLICY,
): BenchmarkDecision {
  const decisions = report.scorecards.map((scorecard): ScorecardDecision => ({
    model: scorecard.model,
    advancementEligible:
      report.phase === 'A1' &&
      scorecard.complete &&
      !scorecard.criticalFailure &&
      scorecard.authority >= policy.advancementAuthorityMinimum &&
      scorecard.targetPreservation >= policy.advancementTargetMinimum,
    winnerEligible:
      report.phase === 'A2' &&
      scorecard.complete &&
      !scorecard.criticalFailure &&
      scorecard.semantic >= policy.winnerSemanticMinimum &&
      scorecard.worstScenarioPass >= policy.winnerWorstScenarioMinimum &&
      scorecard.authority >= policy.winnerAuthorityMinimum &&
      scorecard.targetPreservation >= policy.winnerTargetMinimum &&
      scorecard.overall >= policy.winnerOverallMinimum,
    acceptanceQualified:
      scorecard.complete &&
      !scorecard.criticalFailure &&
      scorecard.automatedFailCount === 0 &&
      scorecard.humanReviewRequiredCount === 0,
  }));
  const decisionByModel = new Map(decisions.map((decision) => [decision.model, decision]));
  if (!report.campaignComplete || report.campaignFingerprint === null) {
    return {
      decisionPolicyVersion: policy.version,
      provisional: true,
      scorecards: decisions,
      advancement: [],
      champions: emptyChampions(),
    };
  }
  const advancement =
    report.phase === 'A1'
      ? report.scorecards
          .filter((scorecard) => decisionByModel.get(scorecard.model)?.advancementEligible)
          .slice(0, policy.advancementCount)
          .map((scorecard) => scorecard.model)
      : [];
  if (report.phase !== 'A2') {
    return {
      decisionPolicyVersion: policy.version,
      provisional: false,
      scorecards: decisions,
      advancement,
      champions: emptyChampions(),
    };
  }
  const complete = report.scorecards.filter(
    (scorecard) => scorecard.complete && !scorecard.criticalFailure,
  );
  const semantic = semanticRanking(complete)[0];
  const eligible = report.scorecards.filter(
    (scorecard) => decisionByModel.get(scorecard.model)?.winnerEligible,
  );
  const latency = [...eligible].sort(
    (left, right) => left.p95LatencyMs - right.p95LatencyMs || left.model.localeCompare(right.model),
  )[0];
  const ranked = [...eligible].sort(
    (left, right) => right.overall - left.overall || left.model.localeCompare(right.model),
  );
  const overall = ranked[0];
  const runnerUp = ranked[1];
  const statisticalTie =
    overall !== undefined &&
    runnerUp !== undefined &&
    overall.overall - runnerUp.overall < policy.tieOverallDelta &&
    overall.semantic - runnerUp.semantic < policy.tieSemanticDelta;
  return {
    decisionPolicyVersion: policy.version,
    provisional: false,
    scorecards: decisions,
    advancement,
    champions: {
      semanticChampion: semantic?.model ?? null,
      latencyChampion: latency?.model ?? null,
      overallChampion: statisticalTie ? null : (overall?.model ?? null),
      statisticalTie,
    },
  };
}
