import { describe, expect, it } from 'vitest';
import {
  computeConfigurationDigest,
  validateBenchmarkConfiguration,
} from './provider-benchmark-config';
import type { LoadedBenchmarkConfiguration } from './provider-benchmark-config';
import {
  BENCHMARK_CONTRACT_VERSION,
  BenchmarkCampaignError,
  STAGE_A1_SCHEDULE,
  buildCampaignIdentity,
  buildCampaignReport,
  buildScorecards,
  classifyFailure,
  computeCampaignFingerprint,
  computeScheduleBudget,
  primaryFailureCategory,
  scheduleContractVersionFor,
} from './provider-benchmark';
import type {
  BenchmarkCampaignIdentity,
  BenchmarkCampaignIdentityInput,
  BenchmarkExecutionEvidence,
} from './provider-benchmark';
import {
  CHECKER_CONTRACT_VERSION,
  FIXTURE_VERSION,
  PROMPT_CONTRACT_VERSION,
} from './provider-semantic-validation';
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

const countsA1 = { A: 4, B: 4, C: 4, D: 4, E: 12 } as const;

const rawEvidence = (
  model: string,
  counts: Record<ScenarioId, number> = countsA1,
  mutate?: (value: EvidenceRecord, index: number) => EvidenceRecord,
): BenchmarkExecutionEvidence[] => {
  let index = 0;
  return (Object.entries(counts) as Array<[ScenarioId, number]>).flatMap(
    ([scenarioId, count]) =>
      Array.from({ length: count }, () => {
        const value = record(model, scenarioId);
        const output = mutate?.(value, index) ?? value;
        index += 1;
        return {
          executionId: `${model}-${index}`,
          campaignFingerprint: null,
          records: [output],
        };
      }),
  );
};

const loaded = (models: readonly string[], phase: 'A1' | 'A2' = 'A1'): LoadedBenchmarkConfiguration => {
  const configuration = validateBenchmarkConfiguration({
    schemaVersion: 1,
    campaignId: `campaign-${models.length}`,
    phase,
    models: models.map((id, index) => ({
      id,
      role: index === 0 ? 'REFERENCE' : 'CHALLENGER',
      tier: 'REQUIRED',
    })),
  });
  return {
    configuration,
    configurationDigest: computeConfigurationDigest(configuration),
    configurationSource: 'EXPLICIT_FILE',
    sourcePath: '/tmp/config.json',
  };
};

const identityInput = (
  configurationDigest: string,
  overrides: Partial<BenchmarkCampaignIdentityInput> = {},
): BenchmarkCampaignIdentityInput => ({
  repositoryHead: 'a'.repeat(40),
  configurationDigest,
  phase: 'A1',
  scheduleContractVersion: scheduleContractVersionFor('A1'),
  promptContractVersion: PROMPT_CONTRACT_VERSION,
  fixtureVersion: FIXTURE_VERSION,
  checkerContractVersion: CHECKER_CONTRACT_VERSION,
  benchmarkContractVersion: BENCHMARK_CONTRACT_VERSION,
  staticCodeBindingDigest: 'd'.repeat(64),
  executableIdentity: {
    approvedPath: '/usr/local/bin/ollama',
    realPath: '/usr/local/bin/ollama',
    sizeBytes: 100,
    mode: '755',
    sha256: 'e'.repeat(64),
  },
  ...overrides,
});

const identified = (
  evidence: readonly BenchmarkExecutionEvidence[],
  identity: BenchmarkCampaignIdentity,
): BenchmarkExecutionEvidence[] =>
  evidence.map((item) => ({
    ...item,
    campaignFingerprint: identity.campaignFingerprint,
    campaignIdentity: identity,
    executionBinding: 'f'.repeat(64),
  }));

describe('Stage 2A pool-independent benchmark engine', () => {
  it('preserves the frozen A1 budget calculation for arbitrary pool sizes', () => {
    expect(computeScheduleBudget(STAGE_A1_SCHEDULE, 4)).toEqual({
      configurations: 4,
      executions: 24,
      generationCalls: 112,
      versionCalls: 24,
      inventoryCalls: 24,
      childCalls: 160,
    });
    expect(computeScheduleBudget(STAGE_A1_SCHEDULE, 10).generationCalls).toBe(280);
    expect(computeScheduleBudget(STAGE_A1_SCHEDULE, 15).childCalls).toBe(600);
  });

  it('maps semantic failures into the unchanged ordered taxonomy', () => {
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
  });

  it('computes deterministic fingerprints and excludes campaignId', () => {
    const input = identityInput('1'.repeat(64));
    expect(computeCampaignFingerprint(input)).toBe(computeCampaignFingerprint(input));
    expect(buildCampaignIdentity('first', input).campaignFingerprint).toBe(
      buildCampaignIdentity('second', input).campaignFingerprint,
    );
  });

  it.each([
    ['configurationDigest', { configurationDigest: '2'.repeat(64) }],
    ['repositoryHead', { repositoryHead: 'b'.repeat(40) }],
    ['prompt', { promptContractVersion: 'changed-prompt' }],
    ['fixture', { fixtureVersion: 'changed-fixture' }],
    ['checker', { checkerContractVersion: 'changed-checker' }],
    ['schedule', { scheduleContractVersion: 'changed-schedule' }],
    ['benchmark', { benchmarkContractVersion: 'changed-benchmark' }],
    ['static binding', { staticCodeBindingDigest: '9'.repeat(64) }],
    [
      'executable',
      {
        executableIdentity: {
          approvedPath: '/usr/local/bin/ollama',
          realPath: '/usr/local/bin/ollama',
          sizeBytes: 101,
          mode: '755',
          sha256: 'e'.repeat(64),
        },
      },
    ],
  ])('changes the fingerprint when %s changes', (_label, overrides) => {
    const baseline = identityInput('1'.repeat(64));
    expect(computeCampaignFingerprint(identityInput('1'.repeat(64), overrides))).not.toBe(
      computeCampaignFingerprint(baseline),
    );
  });

  it('keeps legacy evidence unidentified and provisional', () => {
    const config = loaded(['alpha']);
    const report = buildCampaignReport(config, rawEvidence('alpha'));
    expect(report).toMatchObject({
      configurationIdentity: 'UNKNOWN_LEGACY',
      campaignFingerprint: null,
      campaignComplete: false,
      provisional: true,
    });
    expect(report.scorecards[0]).toMatchObject({ complete: true, semantic: 100 });
  });

  it('builds complete 4-model and 15-model campaigns with exact coverage', () => {
    for (const count of [4, 15]) {
      const models = Array.from({ length: count }, (_, index) => `model-${index}`);
      const config = loaded(models);
      const identity = buildCampaignIdentity(
        config.configuration.campaignId,
        identityInput(config.configurationDigest),
      );
      const evidence = identified(models.flatMap((model) => rawEvidence(model)), identity);
      const report = buildCampaignReport(config, evidence);
      expect(report.campaignComplete).toBe(true);
      expect(report.providerMatrix[0]).toEqual(
        expect.objectContaining({
          model: expect.any(String),
          semantic: expect.any(Number),
          authority: expect.any(Number),
          continuity: expect.any(Number),
          target: expect.any(Number),
          latency: expect.any(Number),
          variance: expect.any(Number),
          overall: expect.any(Number),
        }),
      );
      expect(report.coverage).toMatchObject({
        expectedModels: [...models].sort(),
        observedModels: [...models].sort(),
        completedModels: [...models].sort(),
        missingModels: [],
        incompleteModels: [],
        unexpectedModels: [],
        completionRate: 100,
      });
    }
  });

  it('reports missing models and exact missing scenario samples', () => {
    const config = loaded(['alpha', 'beta']);
    const incomplete = rawEvidence('alpha', { A: 3, B: 4, C: 4, D: 4, E: 10 });
    const report = buildCampaignReport(config, incomplete);
    expect(report.coverage.missingModels).toEqual(['beta']);
    expect(report.coverage.incompleteModels).toEqual(['alpha']);
    expect(report.coverage.modelDetails.find((item) => item.model === 'alpha')).toMatchObject({
      missingScenarioCounts: { A: 1, B: 0, C: 0, D: 0, E: 2 },
      complete: false,
    });
  });

  it('rejects same-count substituted models', () => {
    const config = loaded(['alpha']);
    expect(() => buildCampaignReport(config, rawEvidence('substitute'))).toThrowError(
      'UNEXPECTED_EVIDENCE_MODEL',
    );
  });

  it('rejects mixed fingerprints', () => {
    const config = loaded(['alpha']);
    const first = buildCampaignIdentity('first', identityInput(config.configurationDigest));
    const second = buildCampaignIdentity(
      'second',
      identityInput(config.configurationDigest, { repositoryHead: 'b'.repeat(40) }),
    );
    const evidence = rawEvidence('alpha');
    const mixed = [
      ...identified(evidence.slice(0, 1), first),
      ...identified(evidence.slice(1), second),
    ];
    expect(() => buildCampaignReport(config, mixed)).toThrowError(
      new BenchmarkCampaignError('CAMPAIGN_FINGERPRINT_MISMATCH'),
    );
  });

  it('keeps scorecard weights independent of model role metadata', () => {
    const evidenceByModel = new Map([['alpha', rawEvidence('alpha')]]);
    const first = buildScorecards('A1', evidenceByModel)[0];
    const second = buildScorecards('A1', evidenceByModel)[0];
    expect(first).toEqual(second);

    const authorityFailure = rawEvidence('alpha', countsA1, (value, index) =>
      index < 5
        ? {
            ...value,
            automatedVerdict: 'AUTOMATED_FAIL' as AutomatedVerdict,
            checks: [{ id: 'no-current-state-claim', outcome: 'FAIL' }],
          }
        : value,
    );
    expect(buildScorecards('A1', new Map([['alpha', authorityFailure]]))[0]?.authority).toBeLessThan(90);
  });
});
