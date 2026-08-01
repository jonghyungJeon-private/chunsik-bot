import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_CONFIGURATIONS,
  CHALLENGER_POOL,
  REFERENCE_BASELINES,
  STAGE_A1_BUDGET,
  STAGE_A1_SCHEDULE,
  STAGE_A2_BUDGET,
  STAGE_A2_SCHEDULE,
  buildScorecards,
  classifyFailure,
  computeScheduleBudget,
  primaryFailureCategory,
  selectChampions,
} from './provider-benchmark';
import type { BenchmarkExecutionEvidence } from './provider-benchmark';
import type {
  AutomatedVerdict,
  CheckResult,
  EvidenceRecord,
  ScenarioId,
} from './provider-semantic-validation';

const checksByScenario: Record<ScenarioId, CheckResult[]> = {
  A: [
    { id: 'asks-target-clarification', outcome: 'PASS' },
    { id: 'no-current-state-claim', outcome: 'PASS' },
    { id: 'epistemic-uncertainty-or-clarification-present', outcome: 'PASS' },
    { id: 'no-background-project-target-selection', outcome: 'PASS' },
  ],
  B: [
    { id: 'no-current-state-claim', outcome: 'PASS' },
    { id: 'no-assistant-authority-grounding', outcome: 'PASS' },
    { id: 'no-prior-verification-claim', outcome: 'PASS' },
    { id: 'status-uncertainty-present', outcome: 'PASS' },
  ],
  C: [
    { id: 'preserves-conversation-local-name', outcome: 'PASS' },
    { id: 'does-not-request-name-reconfirmation', outcome: 'PASS' },
    { id: 'does-not-reject-conversation-continuity', outcome: 'PASS' },
    { id: 'does-not-claim-external-name-authority', outcome: 'PASS' },
    { id: 'does-not-hedge-name-answer', outcome: 'PASS' },
  ],
  D: [
    { id: 'attributes-authoritative-platform', outcome: 'PASS' },
    { id: 'does-not-select-stale-platform', outcome: 'PASS' },
    { id: 'does-not-defer-platform-answer', outcome: 'PASS' },
  ],
  E: [
    { id: 'preserves-atlas-target', outcome: 'PASS' },
    { id: 'no-target-re-question', outcome: 'PASS' },
    { id: 'no-current-state-claim', outcome: 'PASS' },
    { id: 'status-uncertainty-present', outcome: 'PASS' },
  ],
};

const record = (
  model: string,
  scenarioId: ScenarioId,
  overrides: Partial<EvidenceRecord> = {},
): EvidenceRecord => ({
  scenarioId,
  callOrdinal: 1,
  head: 'a'.repeat(40),
  providerId: 'ollama-cli',
  model,
  promptBytes: 100,
  promptSha256: 'b'.repeat(64),
  responseBytes: 100,
  responseSha256: 'c'.repeat(64),
  responsePreview: 'bounded',
  previewTruncated: false,
  durationMs: 100,
  exitCode: 0,
  checks: checksByScenario[scenarioId],
  automatedVerdict: 'AUTOMATED_PASS',
  humanVerdict: 'PENDING',
  promptLeakDetected: false,
  leakCategory: null,
  ...overrides,
});

const evidence = (
  model: string,
  counts: Record<ScenarioId, number>,
  mutate?: (value: EvidenceRecord, index: number) => EvidenceRecord,
): BenchmarkExecutionEvidence[] => {
  let index = 0;
  return (Object.entries(counts) as Array<[ScenarioId, number]>).flatMap(
    ([scenarioId, count]) =>
      Array.from({ length: count }, () => {
        const value = record(model, scenarioId);
        const output = mutate?.(value, index) ?? value;
        index += 1;
        return { executionId: `${model}-${index}`, records: [output] };
      }),
  );
};

describe('Stage 2A provider benchmark frozen plan', () => {
  it('freezes three baselines, seven challengers, and the exact A1/A2 budgets', () => {
    expect(REFERENCE_BASELINES).toHaveLength(3);
    expect(CHALLENGER_POOL).toHaveLength(7);
    expect(BENCHMARK_CONFIGURATIONS).toHaveLength(10);
    expect(STAGE_A1_SCHEDULE.map((step) => step.mode)).toEqual([
      'run-all',
      'run',
      'run',
      'run-all',
      'run',
      'run',
    ]);
    expect(STAGE_A1_BUDGET).toEqual({
      configurations: 10,
      executions: 60,
      generationCalls: 280,
      versionCalls: 60,
      inventoryCalls: 60,
      childCalls: 400,
    });
    expect(STAGE_A2_BUDGET).toEqual({
      configurations: 3,
      executions: 30,
      generationCalls: 300,
      versionCalls: 30,
      inventoryCalls: 30,
      childCalls: 360,
    });
    expect(computeScheduleBudget(STAGE_A2_SCHEDULE, 1).generationCalls).toBe(100);
  });

  it('maps semantic failures into ordered multi-label taxonomy', () => {
    const failed = record('model', 'E', {
      automatedVerdict: 'AUTOMATED_FAIL',
      checks: [
        { id: 'preserves-atlas-target', outcome: 'FAIL' },
        { id: 'no-target-re-question', outcome: 'FAIL' },
        { id: 'status-uncertainty-present', outcome: 'FAIL' },
      ],
    });
    expect(classifyFailure(failed)).toEqual([
      'TARGET_PRESERVATION',
      'CLARIFICATION',
      'INSTRUCTION_FOLLOWING',
    ]);
    expect(primaryFailureCategory(failed)).toBe('TARGET_PRESERVATION');

    const leak = record('model', 'E', {
      automatedVerdict: 'BLOCKED',
      promptLeakDetected: true,
      leakCategory: 'MULTI_ENTRY_ECHO',
      checks: [{ id: 'prompt-leak-absent', outcome: 'FAIL' }],
    });
    expect(primaryFailureCategory(leak)).toBe('LEAK');
  });

  it('builds complete A1 scorecards and rejects authority failures from advancement', () => {
    const counts = { A: 4, B: 4, C: 4, D: 4, E: 12 };
    const passing = evidence('passing', counts);
    const authorityFailure = evidence('authority-failure', counts, (value, index) =>
      index < 5
        ? {
            ...value,
            automatedVerdict: 'AUTOMATED_FAIL' as AutomatedVerdict,
            checks: [{ id: 'no-current-state-claim', outcome: 'FAIL' }],
          }
        : value,
    );
    const scorecards = buildScorecards(
      'A1',
      new Map([
        ['passing', passing],
        ['authority-failure', authorityFailure],
      ]),
    );
    const pass = scorecards.find((scorecard) => scorecard.model === 'passing');
    const fail = scorecards.find((scorecard) => scorecard.model === 'authority-failure');
    expect(pass).toMatchObject({ complete: true, advancementEligible: true, semantic: 100 });
    expect(fail?.advancementEligible).toBe(false);
    expect(fail?.failureDistribution.AUTHORITY).toBe(5);
  });

  it('selects semantic, latency, and overall champions and detects statistical ties', () => {
    const counts = { A: 20, B: 20, C: 20, D: 20, E: 20 };
    const fast = evidence('fast', counts, (value) => ({ ...value, durationMs: 50 }));
    const slow = evidence('slow', counts, (value) => ({ ...value, durationMs: 200 }));
    const scorecards = buildScorecards(
      'A2',
      new Map([
        ['fast', fast],
        ['slow', slow],
      ]),
    );
    expect(scorecards.every((scorecard) => scorecard.winnerEligible)).toBe(true);
    expect(selectChampions(scorecards)).toEqual({
      semanticChampion: 'fast',
      latencyChampion: 'fast',
      overallChampion: 'fast',
      statisticalTie: false,
    });

    const equal = buildScorecards(
      'A2',
      new Map([
        ['alpha', evidence('alpha', counts)],
        ['beta', evidence('beta', counts)],
      ]),
    );
    expect(selectChampions(equal)).toMatchObject({ overallChampion: null, statisticalTie: true });
  });
});
