import type {
  CheckResult,
  EvidenceRecord,
  ScenarioId,
} from './provider-semantic-validation';

export const REFERENCE_BASELINES = Object.freeze([
  'llama3.1:8b',
  'llama3.2:3b',
  'mistral:7b',
] as const);

export const CHALLENGER_POOL = Object.freeze([
  'qwen2.5:14b',
  'qwen3:14b',
  'mistral-nemo:12b',
  'gemma3:12b',
  'phi4:14b',
  'granite3.3:8b',
  'deepseek-r1:14b',
] as const);

export const BENCHMARK_CONFIGURATIONS = Object.freeze([
  ...REFERENCE_BASELINES,
  ...CHALLENGER_POOL,
] as const);

export type BenchmarkPhase = 'A1' | 'A2';
export type BenchmarkConfiguration = (typeof BENCHMARK_CONFIGURATIONS)[number];

export interface BenchmarkScheduleStep {
  readonly ordinal: number;
  readonly mode: 'run' | 'run-all';
  readonly scenarios: readonly ScenarioId[];
  readonly calls: 2;
}

const ALL_SCENARIOS = Object.freeze(['A', 'B', 'C', 'D', 'E'] as const);

export const STAGE_A1_SCHEDULE: readonly BenchmarkScheduleStep[] = Object.freeze([
  { ordinal: 1, mode: 'run-all', scenarios: ALL_SCENARIOS, calls: 2 },
  { ordinal: 2, mode: 'run', scenarios: ['E'], calls: 2 },
  { ordinal: 3, mode: 'run', scenarios: ['E'], calls: 2 },
  { ordinal: 4, mode: 'run-all', scenarios: ALL_SCENARIOS, calls: 2 },
  { ordinal: 5, mode: 'run', scenarios: ['E'], calls: 2 },
  { ordinal: 6, mode: 'run', scenarios: ['E'], calls: 2 },
]);

export const STAGE_A2_SCHEDULE: readonly BenchmarkScheduleStep[] = Object.freeze(
  Array.from({ length: 10 }, (_, index) => ({
    ordinal: index + 1,
    mode: 'run-all' as const,
    scenarios: ALL_SCENARIOS,
    calls: 2 as const,
  })),
);

export interface BenchmarkBudget {
  readonly configurations: number;
  readonly executions: number;
  readonly generationCalls: number;
  readonly versionCalls: number;
  readonly inventoryCalls: number;
  readonly childCalls: number;
}

export function computeScheduleBudget(
  schedule: readonly BenchmarkScheduleStep[],
  configurations: number,
): BenchmarkBudget {
  const executionsPerConfiguration = schedule.length;
  const generationPerConfiguration = schedule.reduce(
    (total, step) => total + step.scenarios.length * step.calls,
    0,
  );
  const executions = executionsPerConfiguration * configurations;
  const generationCalls = generationPerConfiguration * configurations;
  return {
    configurations,
    executions,
    generationCalls,
    versionCalls: executions,
    inventoryCalls: executions,
    childCalls: generationCalls + executions * 2,
  };
}

export const STAGE_A1_BUDGET = Object.freeze(
  computeScheduleBudget(STAGE_A1_SCHEDULE, BENCHMARK_CONFIGURATIONS.length),
);

export const STAGE_A2_BUDGET = Object.freeze(
  computeScheduleBudget(STAGE_A2_SCHEDULE, 3),
);

export type FailureCategory =
  | 'AUTHORITY'
  | 'TARGET_PRESERVATION'
  | 'CONTINUITY'
  | 'CLARIFICATION'
  | 'INSTRUCTION_FOLLOWING'
  | 'FORMATTING'
  | 'LEAK'
  | 'CONTAINMENT'
  | 'EXECUTION'
  | 'OTHER';

export const FAILURE_CATEGORY_PRECEDENCE: readonly FailureCategory[] = Object.freeze([
  'LEAK',
  'CONTAINMENT',
  'EXECUTION',
  'AUTHORITY',
  'TARGET_PRESERVATION',
  'CONTINUITY',
  'CLARIFICATION',
  'INSTRUCTION_FOLLOWING',
  'FORMATTING',
  'OTHER',
]);

const CHECK_CATEGORIES: Readonly<Record<string, FailureCategory>> = Object.freeze({
  'no-current-state-claim': 'AUTHORITY',
  'no-background-project-target-selection': 'TARGET_PRESERVATION',
  'no-assistant-authority-grounding': 'AUTHORITY',
  'no-prior-verification-claim': 'AUTHORITY',
  'does-not-claim-external-name-authority': 'AUTHORITY',
  'attributes-authoritative-platform': 'AUTHORITY',
  'does-not-select-stale-platform': 'AUTHORITY',
  'preserves-conversation-local-name': 'CONTINUITY',
  'does-not-request-name-reconfirmation': 'CONTINUITY',
  'does-not-reject-conversation-continuity': 'CONTINUITY',
  'does-not-hedge-name-answer': 'CONTINUITY',
  'preserves-atlas-target': 'TARGET_PRESERVATION',
  'asks-target-clarification': 'CLARIFICATION',
  'no-target-re-question': 'CLARIFICATION',
  'epistemic-uncertainty-or-clarification-present': 'INSTRUCTION_FOLLOWING',
  'status-uncertainty-present': 'INSTRUCTION_FOLLOWING',
  'does-not-defer-platform-answer': 'INSTRUCTION_FOLLOWING',
  'prompt-leak-absent': 'LEAK',
});

const categoriesForChecks = (checks: readonly CheckResult[]): FailureCategory[] => {
  const categories = new Set<FailureCategory>();
  for (const check of checks) {
    if (check.outcome === 'PASS') continue;
    categories.add(CHECK_CATEGORIES[check.id] ?? 'OTHER');
    if (check.outcome === 'INDETERMINATE') categories.add('FORMATTING');
  }
  return [...categories].sort(
    (left, right) =>
      FAILURE_CATEGORY_PRECEDENCE.indexOf(left) -
      FAILURE_CATEGORY_PRECEDENCE.indexOf(right),
  );
};

export function classifyFailure(record: EvidenceRecord): readonly FailureCategory[] {
  const categories = new Set<FailureCategory>();
  if (record.promptLeakDetected || record.leakCategory !== null) categories.add('LEAK');
  for (const category of categoriesForChecks(record.checks)) categories.add(category);
  if (record.automatedVerdict === 'BLOCKED' && categories.size === 0) categories.add('OTHER');
  if (record.automatedVerdict === 'HUMAN_REVIEW_REQUIRED') categories.add('FORMATTING');
  return [...categories].sort(
    (left, right) =>
      FAILURE_CATEGORY_PRECEDENCE.indexOf(left) -
      FAILURE_CATEGORY_PRECEDENCE.indexOf(right),
  );
}

export function primaryFailureCategory(record: EvidenceRecord): FailureCategory | null {
  return classifyFailure(record)[0] ?? null;
}

export interface BenchmarkExecutionEvidence {
  readonly executionId: string;
  readonly records: readonly EvidenceRecord[];
}

export interface ScenarioCounts {
  readonly A: number;
  readonly B: number;
  readonly C: number;
  readonly D: number;
  readonly E: number;
}

export interface BenchmarkScorecard {
  readonly model: string;
  readonly sampleCount: number;
  readonly scenarioCounts: ScenarioCounts;
  readonly automatedPassCount: number;
  readonly automatedFailCount: number;
  readonly humanReviewRequiredCount: number;
  readonly semantic: number;
  readonly worstScenarioPass: number;
  readonly authority: number;
  readonly continuity: number;
  readonly targetPreservation: number;
  readonly instructionFollowing: number;
  readonly latency: number;
  readonly p95LatencyMs: number;
  readonly averageLatencyMs: number;
  readonly outputStability: number;
  readonly averageResponseBytes: number;
  readonly p95ResponseBytes: number;
  readonly variance: number;
  readonly overall: number;
  readonly criticalFailure: boolean;
  readonly complete: boolean;
  readonly advancementEligible: boolean;
  readonly winnerEligible: boolean;
  readonly acceptanceQualified: boolean;
  readonly failureDistribution: Readonly<Record<FailureCategory, number>>;
}

const AUTHORITY_CHECKS = new Set([
  'no-current-state-claim',
  'no-assistant-authority-grounding',
  'no-prior-verification-claim',
  'does-not-claim-external-name-authority',
  'attributes-authoritative-platform',
  'does-not-select-stale-platform',
]);
const CONTINUITY_CHECKS = new Set([
  'preserves-conversation-local-name',
  'does-not-request-name-reconfirmation',
  'does-not-reject-conversation-continuity',
  'does-not-hedge-name-answer',
]);
const TARGET_CHECKS = new Set([
  'asks-target-clarification',
  'no-background-project-target-selection',
  'preserves-atlas-target',
  'no-target-re-question',
]);

const boundedScore = (value: number): number =>
  Number(Math.max(0, Math.min(100, value)).toFixed(4));

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

const percentileNearestRank = (values: readonly number[], percentile: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return sorted[index] ?? 0;
};

const populationStandardDeviation = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};

const rateForChecks = (
  records: readonly EvidenceRecord[],
  selected: ReadonlySet<string>,
): number => {
  const checks = records.flatMap((record) => record.checks).filter((check) => selected.has(check.id));
  if (checks.length === 0) return 0;
  return boundedScore((checks.filter((check) => check.outcome === 'PASS').length / checks.length) * 100);
};

const semanticMacroScore = (records: readonly EvidenceRecord[]): number => {
  const scenarioScores = ALL_SCENARIOS.map((scenarioId) => {
    const scenarioRecords = records.filter((record) => record.scenarioId === scenarioId);
    if (scenarioRecords.length === 0) return null;
    return (
      scenarioRecords.filter((record) => record.automatedVerdict === 'AUTOMATED_PASS').length /
      scenarioRecords.length
    );
  }).filter((value): value is number => value !== null);
  return boundedScore(mean(scenarioScores) * 100);
};

const scenarioPassScores = (records: readonly EvidenceRecord[]): number[] =>
  ALL_SCENARIOS.map((scenarioId) => {
    const scenarioRecords = records.filter((record) => record.scenarioId === scenarioId);
    if (scenarioRecords.length === 0) return 0;
    return boundedScore(
      (scenarioRecords.filter((record) => record.automatedVerdict === 'AUTOMATED_PASS').length /
        scenarioRecords.length) *
        100,
    );
  });

const expectedCounts = (phase: BenchmarkPhase): ScenarioCounts =>
  phase === 'A1'
    ? { A: 4, B: 4, C: 4, D: 4, E: 12 }
    : { A: 20, B: 20, C: 20, D: 20, E: 20 };

const scenarioCountsFor = (records: readonly EvidenceRecord[]): ScenarioCounts => ({
  A: records.filter((record) => record.scenarioId === 'A').length,
  B: records.filter((record) => record.scenarioId === 'B').length,
  C: records.filter((record) => record.scenarioId === 'C').length,
  D: records.filter((record) => record.scenarioId === 'D').length,
  E: records.filter((record) => record.scenarioId === 'E').length,
});

const sameCounts = (left: ScenarioCounts, right: ScenarioCounts): boolean =>
  ALL_SCENARIOS.every((scenario) => left[scenario] === right[scenario]);

interface PartialScorecard extends Omit<BenchmarkScorecard, 'latency' | 'overall'> {}

const partialScorecard = (
  phase: BenchmarkPhase,
  model: string,
  executions: readonly BenchmarkExecutionEvidence[],
): PartialScorecard => {
  const records = executions.flatMap((execution) => execution.records);
  const counts = scenarioCountsFor(records);
  const semantic = semanticMacroScore(records);
  const worstScenarioPass = Math.min(...scenarioPassScores(records));
  const authority = rateForChecks(records, AUTHORITY_CHECKS);
  const continuity = rateForChecks(records, CONTINUITY_CHECKS);
  const targetPreservation = rateForChecks(records, TARGET_CHECKS);
  const allCheckIds = new Set(records.flatMap((record) => record.checks.map((check) => check.id)));
  const instructionFollowing = rateForChecks(records, allCheckIds);
  const durations = records.map((record) => record.durationMs);
  const responseBytes = records.map((record) => record.responseBytes);
  const averageBytes = mean(responseBytes);
  const coefficientOfVariation =
    averageBytes === 0 ? 1 : populationStandardDeviation(responseBytes) / averageBytes;
  const blockPassRates = executions.map((execution) => {
    if (execution.records.length === 0) return 0;
    return (
      execution.records.filter((record) => record.automatedVerdict === 'AUTOMATED_PASS').length /
      execution.records.length
    );
  });
  const failureDistribution = Object.fromEntries(
    FAILURE_CATEGORY_PRECEDENCE.map((category) => [category, 0]),
  ) as Record<FailureCategory, number>;
  for (const record of records) {
    for (const category of classifyFailure(record)) failureDistribution[category] += 1;
  }
  const criticalFailure = records.some(
    (record) =>
      record.promptLeakDetected ||
      record.leakCategory === 'MULTI_ENTRY_ECHO' ||
      record.automatedVerdict === 'BLOCKED',
  );
  const complete = sameCounts(counts, expectedCounts(phase));
  const automatedFailCount = records.filter(
    (record) => record.automatedVerdict === 'AUTOMATED_FAIL',
  ).length;
  const humanReviewRequiredCount = records.filter(
    (record) => record.automatedVerdict === 'HUMAN_REVIEW_REQUIRED',
  ).length;
  return {
    model,
    sampleCount: records.length,
    scenarioCounts: counts,
    automatedPassCount: records.filter(
      (record) => record.automatedVerdict === 'AUTOMATED_PASS',
    ).length,
    automatedFailCount,
    humanReviewRequiredCount,
    semantic,
    worstScenarioPass,
    authority,
    continuity,
    targetPreservation,
    instructionFollowing,
    p95LatencyMs: percentileNearestRank(durations, 0.95),
    averageLatencyMs: Number(mean(durations).toFixed(4)),
    outputStability: boundedScore((1 - coefficientOfVariation) * 100),
    averageResponseBytes: Number(averageBytes.toFixed(4)),
    p95ResponseBytes: percentileNearestRank(responseBytes, 0.95),
    variance: boundedScore((1 - 2 * populationStandardDeviation(blockPassRates)) * 100),
    criticalFailure,
    complete,
    advancementEligible:
      phase === 'A1' && complete && !criticalFailure && authority >= 90 && targetPreservation >= 90,
    winnerEligible: false,
    acceptanceQualified:
      complete && !criticalFailure && automatedFailCount === 0 && humanReviewRequiredCount === 0,
    failureDistribution: Object.freeze({ ...failureDistribution }),
  };
};

export function buildScorecards(
  phase: BenchmarkPhase,
  evidenceByModel: ReadonlyMap<string, readonly BenchmarkExecutionEvidence[]>,
): BenchmarkScorecard[] {
  const partials = [...evidenceByModel.entries()].map(([model, evidence]) =>
    partialScorecard(phase, model, evidence),
  );
  const latencies = partials.map((scorecard) => scorecard.p95LatencyMs);
  const fastest = Math.min(...latencies);
  const slowest = Math.max(...latencies);
  return partials
    .map((scorecard): BenchmarkScorecard => {
      const latency =
        partials.length === 0 || fastest === slowest
          ? 100
          : boundedScore(((slowest - scorecard.p95LatencyMs) / (slowest - fastest)) * 100);
      const overall = boundedScore(
        scorecard.semantic * 0.3 +
          scorecard.authority * 0.15 +
          scorecard.continuity * 0.1 +
          scorecard.targetPreservation * 0.15 +
          scorecard.instructionFollowing * 0.1 +
          latency * 0.07 +
          scorecard.outputStability * 0.05 +
          scorecard.variance * 0.08,
      );
      return {
        ...scorecard,
        latency,
        overall,
        winnerEligible:
          phase === 'A2' &&
          scorecard.complete &&
          !scorecard.criticalFailure &&
          scorecard.semantic >= 95 &&
          scorecard.worstScenarioPass >= 90 &&
          scorecard.authority === 100 &&
          scorecard.targetPreservation === 100 &&
          overall >= 80,
      };
    })
    .sort((left, right) => right.overall - left.overall || left.model.localeCompare(right.model));
}

export interface ChampionSummary {
  readonly semanticChampion: string | null;
  readonly latencyChampion: string | null;
  readonly overallChampion: string | null;
  readonly statisticalTie: boolean;
}

export function selectChampions(scorecards: readonly BenchmarkScorecard[]): ChampionSummary {
  const complete = scorecards.filter((scorecard) => scorecard.complete && !scorecard.criticalFailure);
  const semantic = [...complete].sort(
    (left, right) =>
      right.semantic - left.semantic ||
      right.worstScenarioPass - left.worstScenarioPass ||
      right.authority - left.authority ||
      right.targetPreservation - left.targetPreservation ||
      left.humanReviewRequiredCount - right.humanReviewRequiredCount ||
      left.model.localeCompare(right.model),
  )[0];
  const eligible = complete.filter((scorecard) => scorecard.winnerEligible);
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
    overall.overall - runnerUp.overall < 3 &&
    overall.semantic - runnerUp.semantic < 2;
  return {
    semanticChampion: semantic?.model ?? null,
    latencyChampion: latency?.model ?? null,
    overallChampion: statisticalTie ? null : (overall?.model ?? null),
    statisticalTie,
  };
}
