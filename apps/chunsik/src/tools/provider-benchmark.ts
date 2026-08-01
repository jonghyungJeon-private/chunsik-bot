import { createHash } from 'node:crypto';
import {
  CHECKER_CONTRACT_VERSION,
  FIXTURE_VERSION,
  PROMPT_CONTRACT_VERSION,
} from './provider-semantic-validation';
import type {
  CheckResult,
  EvidenceRecord,
  ExecutableIdentity,
  ScenarioId,
} from './provider-semantic-validation';
import type { LoadedBenchmarkConfiguration } from './provider-benchmark-config';

export type BenchmarkPhase = 'A1' | 'A2';

export const BENCHMARK_CONTRACT_VERSION = 'stage2a-provider-benchmark-v2';
export const STAGE_A1_SCHEDULE_CONTRACT_VERSION = 'stage2a-a1-schedule-v2.1';
export const STAGE_A2_SCHEDULE_CONTRACT_VERSION = 'stage2a-a2-schedule-v2.1';

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

export const scheduleFor = (phase: BenchmarkPhase): readonly BenchmarkScheduleStep[] =>
  phase === 'A1' ? STAGE_A1_SCHEDULE : STAGE_A2_SCHEDULE;

export const scheduleContractVersionFor = (phase: BenchmarkPhase): string =>
  phase === 'A1' ? STAGE_A1_SCHEDULE_CONTRACT_VERSION : STAGE_A2_SCHEDULE_CONTRACT_VERSION;

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

export interface BenchmarkCampaignIdentityInput {
  readonly repositoryHead: string;
  readonly configurationDigest: string;
  readonly phase: BenchmarkPhase;
  readonly scheduleContractVersion: string;
  readonly promptContractVersion: string;
  readonly fixtureVersion: string;
  readonly checkerContractVersion: string;
  readonly benchmarkContractVersion: string;
  readonly staticCodeBindingDigest: string;
  readonly executableIdentity: ExecutableIdentity;
}

export interface BenchmarkCampaignIdentity extends BenchmarkCampaignIdentityInput {
  readonly campaignId: string;
  readonly campaignFingerprint: string;
}

export const canonicalCampaignFingerprintPayload = (
  input: BenchmarkCampaignIdentityInput,
): readonly (readonly [string, unknown])[] => [
  ['repositoryHead', input.repositoryHead],
  ['configurationDigest', input.configurationDigest],
  ['phase', input.phase],
  ['scheduleContractVersion', input.scheduleContractVersion],
  ['promptContractVersion', input.promptContractVersion],
  ['fixtureVersion', input.fixtureVersion],
  ['checkerContractVersion', input.checkerContractVersion],
  ['benchmarkContractVersion', input.benchmarkContractVersion],
  ['staticCodeBindingDigest', input.staticCodeBindingDigest],
  ['executableApprovedPath', input.executableIdentity.approvedPath],
  ['executableRealPath', input.executableIdentity.realPath],
  ['executableSha256', input.executableIdentity.sha256],
  ['executableSizeBytes', input.executableIdentity.sizeBytes],
  ['executableMode', input.executableIdentity.mode],
];

export const computeCampaignFingerprint = (input: BenchmarkCampaignIdentityInput): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalCampaignFingerprintPayload(input)))
    .digest('hex');

export const buildCampaignIdentity = (
  campaignId: string,
  input: BenchmarkCampaignIdentityInput,
): BenchmarkCampaignIdentity =>
  Object.freeze({
    campaignId,
    ...input,
    executableIdentity: Object.freeze({ ...input.executableIdentity }),
    campaignFingerprint: computeCampaignFingerprint(input),
  });

export interface BenchmarkExecutionEvidence {
  readonly executionId: string;
  readonly campaignFingerprint: string | null;
  readonly campaignIdentity?: BenchmarkCampaignIdentity;
  readonly executionBinding?: string;
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
  readonly failureDistribution: Readonly<Record<FailureCategory, number>>;
}

export interface ModelCoverageDetail {
  readonly model: string;
  readonly expectedScenarioCounts: ScenarioCounts;
  readonly observedScenarioCounts: ScenarioCounts;
  readonly missingScenarioCounts: ScenarioCounts;
  readonly complete: boolean;
}

export interface CampaignCoverage {
  readonly expectedModels: readonly string[];
  readonly observedModels: readonly string[];
  readonly completedModels: readonly string[];
  readonly missingModels: readonly string[];
  readonly incompleteModels: readonly string[];
  readonly unexpectedModels: readonly string[];
  readonly completionRate: number;
  readonly modelDetails: readonly ModelCoverageDetail[];
}

export interface ProviderMatrixEntry {
  readonly model: string;
  readonly semantic: number;
  readonly worstScenarioPass: number;
  readonly authority: number;
  readonly continuity: number;
  readonly target: number;
  readonly instructionFollowing: number;
  readonly latency: number;
  readonly variance: number;
  readonly overall: number;
  readonly complete: boolean;
  readonly criticalFailure: boolean;
}

export interface BenchmarkCampaignReport {
  readonly campaignId: string;
  readonly phase: BenchmarkPhase;
  readonly configurationSource: LoadedBenchmarkConfiguration['configurationSource'];
  readonly configurationDigest: string;
  readonly configurationIdentity: string | 'UNKNOWN_LEGACY';
  readonly campaignFingerprint: string | null;
  readonly expectedModels: readonly string[];
  readonly observedModels: readonly string[];
  readonly budget: BenchmarkBudget;
  readonly coverage: CampaignCoverage;
  readonly campaignComplete: boolean;
  readonly provisional: boolean;
  readonly scorecards: readonly BenchmarkScorecard[];
  readonly providerMatrix: readonly ProviderMatrixEntry[];
}

export class BenchmarkCampaignError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'BenchmarkCampaignError';
  }
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

export const expectedScenarioCounts = (
  schedule: readonly BenchmarkScheduleStep[],
): ScenarioCounts => {
  const counts: Record<ScenarioId, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const step of schedule) {
    for (const scenario of step.scenarios) counts[scenario] += step.calls;
  }
  return counts;
};

const scenarioCountsFor = (records: readonly EvidenceRecord[]): ScenarioCounts => ({
  A: records.filter((record) => record.scenarioId === 'A').length,
  B: records.filter((record) => record.scenarioId === 'B').length,
  C: records.filter((record) => record.scenarioId === 'C').length,
  D: records.filter((record) => record.scenarioId === 'D').length,
  E: records.filter((record) => record.scenarioId === 'E').length,
});

const sameCounts = (left: ScenarioCounts, right: ScenarioCounts): boolean =>
  ALL_SCENARIOS.every((scenario) => left[scenario] === right[scenario]);

const missingCounts = (expected: ScenarioCounts, observed: ScenarioCounts): ScenarioCounts => ({
  A: Math.max(0, expected.A - observed.A),
  B: Math.max(0, expected.B - observed.B),
  C: Math.max(0, expected.C - observed.C),
  D: Math.max(0, expected.D - observed.D),
  E: Math.max(0, expected.E - observed.E),
});

interface PartialScorecard extends Omit<BenchmarkScorecard, 'latency' | 'overall'> {}

const partialScorecard = (
  expectedCounts: ScenarioCounts,
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
  return {
    model,
    sampleCount: records.length,
    scenarioCounts: counts,
    automatedPassCount: records.filter(
      (record) => record.automatedVerdict === 'AUTOMATED_PASS',
    ).length,
    automatedFailCount: records.filter(
      (record) => record.automatedVerdict === 'AUTOMATED_FAIL',
    ).length,
    humanReviewRequiredCount: records.filter(
      (record) => record.automatedVerdict === 'HUMAN_REVIEW_REQUIRED',
    ).length,
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
    complete: sameCounts(counts, expectedCounts),
    failureDistribution: Object.freeze({ ...failureDistribution }),
  };
};

export function buildScorecards(
  phase: BenchmarkPhase,
  evidenceByModel: ReadonlyMap<string, readonly BenchmarkExecutionEvidence[]>,
): BenchmarkScorecard[] {
  const expectedCounts = expectedScenarioCounts(scheduleFor(phase));
  const partials = [...evidenceByModel.entries()].map(([model, evidence]) =>
    partialScorecard(expectedCounts, model, evidence),
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
      return { ...scorecard, latency, overall };
    })
    .sort((left, right) => right.overall - left.overall || left.model.localeCompare(right.model));
}

const providerMatrix = (scorecards: readonly BenchmarkScorecard[]): ProviderMatrixEntry[] =>
  scorecards.map((scorecard) => ({
    model: scorecard.model,
    semantic: scorecard.semantic,
    worstScenarioPass: scorecard.worstScenarioPass,
    authority: scorecard.authority,
    continuity: scorecard.continuity,
    target: scorecard.targetPreservation,
    instructionFollowing: scorecard.instructionFollowing,
    latency: scorecard.latency,
    variance: scorecard.variance,
    overall: scorecard.overall,
    complete: scorecard.complete,
    criticalFailure: scorecard.criticalFailure,
  }));

const validatedFingerprint = (
  evidence: readonly BenchmarkExecutionEvidence[],
  configurationDigest: string,
  phase: BenchmarkPhase,
): string | null => {
  const fingerprintValues = evidence.map((item) => item.campaignFingerprint);
  if (fingerprintValues.every((value) => value === null)) return null;
  if (fingerprintValues.some((value) => value === null)) {
    throw new BenchmarkCampaignError('MIXED_CAMPAIGN_IDENTITY');
  }
  const fingerprints = new Set(fingerprintValues as string[]);
  if (fingerprints.size !== 1) {
    throw new BenchmarkCampaignError('CAMPAIGN_FINGERPRINT_MISMATCH');
  }
  for (const item of evidence) {
    const identity = item.campaignIdentity;
    if (identity === undefined) throw new BenchmarkCampaignError('CAMPAIGN_IDENTITY_MISSING');
    const { campaignId: _campaignId, campaignFingerprint, ...input } = identity;
    if (
      campaignFingerprint !== computeCampaignFingerprint(input) ||
      campaignFingerprint !== item.campaignFingerprint
    ) {
      throw new BenchmarkCampaignError('CAMPAIGN_FINGERPRINT_INVALID');
    }
    if (identity.configurationDigest !== configurationDigest) {
      throw new BenchmarkCampaignError('CAMPAIGN_CONFIGURATION_MISMATCH');
    }
    if (identity.phase !== phase) throw new BenchmarkCampaignError('CAMPAIGN_PHASE_MISMATCH');
    if (
      identity.scheduleContractVersion !== scheduleContractVersionFor(phase) ||
      identity.promptContractVersion !== PROMPT_CONTRACT_VERSION ||
      identity.fixtureVersion !== FIXTURE_VERSION ||
      identity.checkerContractVersion !== CHECKER_CONTRACT_VERSION ||
      identity.benchmarkContractVersion !== BENCHMARK_CONTRACT_VERSION
    ) {
      throw new BenchmarkCampaignError('CAMPAIGN_CONTRACT_MISMATCH');
    }
    if (item.executionBinding === undefined || !/^[0-9a-f]{64}$/.test(item.executionBinding)) {
      throw new BenchmarkCampaignError('EXECUTION_BINDING_MISSING');
    }
    if (item.records.some((record) => record.head !== identity.repositoryHead)) {
      throw new BenchmarkCampaignError('CAMPAIGN_HEAD_MISMATCH');
    }
  }
  return fingerprintValues[0] ?? null;
};

export function buildCampaignReport(
  loaded: LoadedBenchmarkConfiguration,
  evidence: readonly BenchmarkExecutionEvidence[],
): BenchmarkCampaignReport {
  const { configuration, configurationDigest, configurationSource } = loaded;
  const expectedModels = configuration.models.map((model) => model.id).sort();
  const expectedModelSet = new Set(expectedModels);
  const evidenceByModel = new Map<string, BenchmarkExecutionEvidence[]>();
  for (const execution of evidence) {
    const model = execution.records[0]?.model;
    if (model === undefined || execution.records.some((record) => record.model !== model)) {
      throw new BenchmarkCampaignError('EVIDENCE_MODEL_INVALID');
    }
    if (!expectedModelSet.has(model)) {
      throw new BenchmarkCampaignError('UNEXPECTED_EVIDENCE_MODEL');
    }
    const grouped = evidenceByModel.get(model) ?? [];
    grouped.push(execution);
    evidenceByModel.set(model, grouped);
  }
  const fingerprint = validatedFingerprint(evidence, configurationDigest, configuration.phase);
  const observedModels = [...evidenceByModel.keys()].sort();
  const scorecards = buildScorecards(configuration.phase, evidenceByModel);
  const scorecardByModel = new Map(scorecards.map((scorecard) => [scorecard.model, scorecard]));
  const expectedCounts = expectedScenarioCounts(scheduleFor(configuration.phase));
  const modelDetails = expectedModels.map((model): ModelCoverageDetail => {
    const observed = scorecardByModel.get(model)?.scenarioCounts ?? { A: 0, B: 0, C: 0, D: 0, E: 0 };
    return {
      model,
      expectedScenarioCounts: expectedCounts,
      observedScenarioCounts: observed,
      missingScenarioCounts: missingCounts(expectedCounts, observed),
      complete: sameCounts(expectedCounts, observed),
    };
  });
  const completedModels = modelDetails.filter((item) => item.complete).map((item) => item.model);
  const missingModels = expectedModels.filter((model) => !evidenceByModel.has(model));
  const incompleteModels = modelDetails
    .filter((item) => !item.complete && evidenceByModel.has(item.model))
    .map((item) => item.model);
  const unexpectedModels: string[] = [];
  const completionRate = Number(
    ((completedModels.length / expectedModels.length) * 100).toFixed(4),
  );
  const coverage: CampaignCoverage = {
    expectedModels,
    observedModels,
    completedModels,
    missingModels,
    incompleteModels,
    unexpectedModels,
    completionRate,
    modelDetails,
  };
  const campaignComplete =
    fingerprint !== null &&
    missingModels.length === 0 &&
    incompleteModels.length === 0 &&
    unexpectedModels.length === 0;
  return {
    campaignId: configuration.campaignId,
    phase: configuration.phase,
    configurationSource,
    configurationDigest,
    configurationIdentity: fingerprint === null ? 'UNKNOWN_LEGACY' : configurationDigest,
    campaignFingerprint: fingerprint,
    expectedModels,
    observedModels,
    budget: computeScheduleBudget(scheduleFor(configuration.phase), expectedModels.length),
    coverage,
    campaignComplete,
    provisional: !campaignComplete,
    scorecards,
    providerMatrix: providerMatrix(scorecards),
  };
}
