import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runShadowCli } from './provider-semantic-shadow-cli';
import {
  CORPUS_DIGEST_ALGORITHM,
  CORPUS_REGISTRY_SCHEMA_VERSION,
  loadGoldenCorpusRegistry,
  runProviderFreeShadowReplay,
} from './provider-semantic-shadow';
import {
  CHECKER_CONTRACT_VERSION,
  aggregateVerdict,
  evaluateScenario,
} from './provider-semantic-validation';
import type { EvidenceRecord } from './provider-semantic-validation';

const sha256 = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex');

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const createSyntheticRegistry = (): { registryPath: string; root: string } => {
  const root = mkdtempSync(join(tmpdir(), 'chunsik-shadow-test-'));
  temporaryDirectories.push(root);
  const evidenceDir = join(root, 'executions');
  mkdirSync(evidenceDir);
  const response = 'Service Atlas is unverified. What do you mean by "currently connected"?';
  const checks = evaluateScenario('E', response);
  const record: EvidenceRecord = {
    scenarioId: 'E',
    callOrdinal: 1,
    head: 'a'.repeat(40),
    providerId: 'ollama-cli',
    model: 'synthetic:model',
    promptBytes: 10,
    promptSha256: 'b'.repeat(64),
    responseBytes: Buffer.byteLength(response),
    responseSha256: sha256(response),
    responsePreview: response,
    previewTruncated: false,
    durationMs: 10,
    exitCode: 0,
    checks,
    automatedVerdict: aggregateVerdict(checks),
    humanVerdict: 'PENDING',
    promptLeakDetected: false,
    leakCategory: null,
  };
  const campaignId = 'synthetic-a1';
  const evidence = {
    campaignFingerprint: 'c'.repeat(64),
    campaignIdentity: {
      campaignId,
      campaignFingerprint: 'c'.repeat(64),
      repositoryHead: 'a'.repeat(40),
      configurationDigest: 'd'.repeat(64),
      phase: 'A1',
      scheduleContractVersion: 'stage2a-a1-schedule-v2.1',
      promptContractVersion: 'adr-0063-provider-continuity-v2',
      fixtureVersion: 'stage2a-provider-semantic-a-e-v1',
      checkerContractVersion: CHECKER_CONTRACT_VERSION,
      benchmarkContractVersion: 'stage2a-provider-benchmark-v2',
      staticCodeBindingDigest: 'e'.repeat(64),
      executableIdentity: {
        approvedPath: '/synthetic/ollama',
        realPath: '/synthetic/ollama',
        sizeBytes: 1,
        mode: '755',
        sha256: 'f'.repeat(64),
      },
    },
    executionBinding: '1'.repeat(64),
    records: [record],
  };
  const evidenceName = '01-synthetic-run.json';
  const evidencePath = join(evidenceDir, evidenceName);
  const content = `${JSON.stringify(evidence)}\n`;
  writeFileSync(evidencePath, content, 'utf8');
  const logicalPathPrefix = 'synthetic/golden-a1/executions';
  const digest = sha256(`${sha256(content)}  ${logicalPathPrefix}/${evidenceName}\n`);
  const registry = {
    schemaVersion: CORPUS_REGISTRY_SCHEMA_VERSION,
    registryVersion: 'synthetic-registry-v1',
    corpusVersion: 'synthetic-golden-v1',
    digestAlgorithm: CORPUS_DIGEST_ALGORITHM,
    expectedCombinedDigest: digest,
    corpora: [
      {
        corpusId: 'A1',
        campaignId,
        phase: 'A1',
        evidenceDir,
        logicalPathPrefix,
        expectedDigest: digest,
        expectedRecords: 1,
        expectedCheckInstances: 4,
      },
    ],
  };
  const registryPath = join(root, 'registry.json');
  writeFileSync(registryPath, `${JSON.stringify(registry)}\n`, 'utf8');
  return { registryPath, root };
};

describe('provider-free semantic shadow replay', () => {
  it('loads a versioned corpus registry and replays baseline/candidate deterministically', () => {
    const { registryPath } = createSyntheticRegistry();
    const report = runProviderFreeShadowReplay({
      registry: loadGoldenCorpusRegistry(registryPath),
    });
    expect(report).toMatchObject({
      mode: 'provider-free-shadow',
      providerExecuted: false,
      deterministic: true,
      corpusIntegrity: {
        passed: true,
        recordCount: 1,
        checkInstanceCount: 4,
      },
      promotionGate: {
        eligible: false,
        provisional: true,
        advancement: [],
        champions: {
          semanticChampion: null,
          latencyChampion: null,
          overallChampion: null,
        },
      },
      shadowDecisionImpact: {
        championDelta: {
          baseline: null,
          candidate: null,
          publicationSuppressed: true,
        },
        advancement: [],
      },
    });
    expect(report.transitions).toHaveLength(1);
    expect(report.semanticChangeSummary.signatureDistribution).toContainEqual({
      signature: 'PREDICATE_REDEFINITION',
      baseline: 1,
      candidate: 0,
      delta: -1,
    });
  });

  it('writes bounded deterministic reports without running a Provider', () => {
    const { registryPath, root } = createSyntheticRegistry();
    const outputDir = join(root, 'output');
    expect(runShadowCli(['--registry', registryPath, '--output-dir', outputDir])).toMatchObject({
      status: 'PASS',
      providerExecuted: false,
      deterministic: true,
      promotionEligible: false,
    });
    const report = JSON.parse(readFileSync(join(outputDir, 'shadow-report.json'), 'utf8')) as {
      providerExecuted: boolean;
      transitions: unknown[];
    };
    expect(report.providerExecuted).toBe(false);
    expect(report.transitions).toHaveLength(1);
    expect(() =>
      runShadowCli(['--registry', registryPath, '--output-dir', outputDir]),
    ).toThrow('SHADOW_OUTPUT_ALREADY_EXISTS');
  });

  it('fails closed when the immutable corpus digest changes', () => {
    const { registryPath } = createSyntheticRegistry();
    const registry = loadGoldenCorpusRegistry(registryPath);
    const report = runProviderFreeShadowReplay({
      registry: { ...registry, expectedCombinedDigest: '0'.repeat(64) },
    });
    expect(report.corpusIntegrity.passed).toBe(false);
    expect(report.promotionGate).toMatchObject({
      eligible: false,
      reasons: expect.arrayContaining(['CORPUS_INTEGRITY_FAILED']),
    });
  });
});
