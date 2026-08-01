import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { buildScorecards } from './provider-benchmark';
import type {
  BenchmarkExecutionEvidence,
  BenchmarkPhase,
  BenchmarkScorecard,
} from './provider-benchmark';
import { readExecutionEvidence } from './provider-benchmark-cli';
import { FAILURE_SIGNATURE_REGISTRY_VERSION } from './provider-failure-signatures';
import {
  CANDIDATE_CHECKER_CONTRACT_VERSION,
  evaluateScenarioV4,
} from './provider-semantic-validation-candidate';
import {
  V3_CHECKER_CONTRACT_VERSION,
  aggregateVerdict,
  evaluateScenarioV3,
} from './provider-semantic-validation';
import type { EvidenceRecord } from './provider-semantic-validation';
import {
  buildFailureSignatureDistribution,
  buildSemanticChangeSummary,
  createDraftTransitionOverlay,
  detectSemanticTransitions,
  evaluateCriticalRecall,
  evaluateShadowPromotionGate,
  validateTransitionOverlay,
} from './provider-semantic-transition';
import type {
  CriticalRecallLock,
  PromotionGateResult,
  SemanticChangeSummary,
  SemanticTransition,
  SignatureDistribution,
  TransitionOverlay,
  TransitionRecordPair,
} from './provider-semantic-transition';

export const CORPUS_REGISTRY_SCHEMA_VERSION = 'stage2a-golden-corpus-registry-v1';
export const CORPUS_DIGEST_ALGORITHM = 'sha256-file-sha-lines-v1';

export interface CorpusRegistryEntry {
  readonly corpusId: string;
  readonly campaignId: string;
  readonly phase: BenchmarkPhase;
  readonly evidenceDir: string;
  readonly logicalPathPrefix: string;
  readonly expectedDigest: string;
  readonly expectedRecords: number;
  readonly expectedCheckInstances: number;
}

export interface GoldenCorpusRegistry {
  readonly schemaVersion: typeof CORPUS_REGISTRY_SCHEMA_VERSION;
  readonly registryVersion: string;
  readonly corpusVersion: string;
  readonly digestAlgorithm: typeof CORPUS_DIGEST_ALGORITHM;
  readonly expectedCombinedDigest: string;
  readonly corpora: readonly CorpusRegistryEntry[];
}

export interface LoadedCorpus {
  readonly entry: CorpusRegistryEntry;
  readonly digest: string;
  readonly executions: readonly BenchmarkExecutionEvidence[];
  readonly recordCount: number;
  readonly checkInstanceCount: number;
}

export interface CorpusIntegrityReport {
  readonly passed: boolean;
  readonly registryVersion: string;
  readonly corpusVersion: string;
  readonly combinedDigest: string;
  readonly expectedCombinedDigest: string;
  readonly recordCount: number;
  readonly checkInstanceCount: number;
  readonly failures: readonly string[];
  readonly corpora: readonly {
    corpusId: string;
    digest: string;
    expectedDigest: string;
    recordCount: number;
    checkInstanceCount: number;
  }[];
}

export interface EvaluatorReplayReport {
  readonly checkerVersion: string;
  readonly failureSignatureRegistryVersion: string;
  readonly replayDigest: string;
  readonly scorecardsByCorpus: Readonly<Record<string, readonly BenchmarkScorecard[]>>;
  readonly failureSignatureDistribution: SignatureDistribution;
}

export interface ShadowDecisionImpact {
  readonly rankingsByCorpus: readonly {
    readonly corpusId: string;
    readonly baseline: readonly string[];
    readonly candidate: readonly string[];
    readonly changed: boolean;
  }[];
  readonly championDelta: {
    readonly baseline: null;
    readonly candidate: null;
    readonly publicationSuppressed: true;
  };
  readonly advancement: readonly never[];
}

export interface ShadowReplayReport {
  readonly mode: 'provider-free-shadow';
  readonly providerExecuted: false;
  readonly corpusIntegrity: CorpusIntegrityReport;
  readonly deterministic: boolean;
  readonly baseline: EvaluatorReplayReport;
  readonly candidate: EvaluatorReplayReport;
  readonly transitions: readonly SemanticTransition[];
  readonly overlay: TransitionOverlay;
  readonly semanticChangeSummary: SemanticChangeSummary;
  readonly shadowDecisionImpact: ShadowDecisionImpact;
  readonly promotionGate: PromotionGateResult;
}

const sha256 = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function loadGoldenCorpusRegistry(path: string): GoldenCorpusRegistry {
  if (!isAbsolute(path)) throw new Error('CORPUS_REGISTRY_PATH_NOT_ABSOLUTE');
  const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!isRecord(value) || !Array.isArray(value.corpora)) {
    throw new Error('CORPUS_REGISTRY_INVALID');
  }
  if (
    value.schemaVersion !== CORPUS_REGISTRY_SCHEMA_VERSION ||
    value.digestAlgorithm !== CORPUS_DIGEST_ALGORITHM ||
    typeof value.registryVersion !== 'string' ||
    typeof value.corpusVersion !== 'string' ||
    typeof value.expectedCombinedDigest !== 'string'
  ) {
    throw new Error('CORPUS_REGISTRY_SCHEMA_INVALID');
  }
  const corpora = value.corpora.map((candidate): CorpusRegistryEntry => {
    if (
      !isRecord(candidate) ||
      typeof candidate.corpusId !== 'string' ||
      typeof candidate.campaignId !== 'string' ||
      (candidate.phase !== 'A1' && candidate.phase !== 'A2') ||
      typeof candidate.evidenceDir !== 'string' ||
      !isAbsolute(candidate.evidenceDir) ||
      typeof candidate.logicalPathPrefix !== 'string' ||
      typeof candidate.expectedDigest !== 'string' ||
      typeof candidate.expectedRecords !== 'number' ||
      typeof candidate.expectedCheckInstances !== 'number'
    ) {
      throw new Error('CORPUS_REGISTRY_ENTRY_INVALID');
    }
    return {
      corpusId: candidate.corpusId,
      campaignId: candidate.campaignId,
      phase: candidate.phase,
      evidenceDir: candidate.evidenceDir,
      logicalPathPrefix: candidate.logicalPathPrefix,
      expectedDigest: candidate.expectedDigest,
      expectedRecords: candidate.expectedRecords,
      expectedCheckInstances: candidate.expectedCheckInstances,
    };
  });
  if (corpora.length === 0 || new Set(corpora.map((entry) => entry.corpusId)).size !== corpora.length) {
    throw new Error('CORPUS_REGISTRY_ENTRY_DUPLICATE');
  }
  if (
    corpora.some(
      (entry, index) =>
        index > 0 &&
        (corpora[index - 1]?.logicalPathPrefix.localeCompare(entry.logicalPathPrefix) ?? 0) > 0,
    )
  ) {
    throw new Error('CORPUS_REGISTRY_ORDER_INVALID');
  }
  return {
    schemaVersion: CORPUS_REGISTRY_SCHEMA_VERSION,
    registryVersion: value.registryVersion,
    corpusVersion: value.corpusVersion,
    digestAlgorithm: CORPUS_DIGEST_ALGORITHM,
    expectedCombinedDigest: value.expectedCombinedDigest,
    corpora,
  };
}

const evidenceFiles = (entry: CorpusRegistryEntry): readonly string[] => {
  const directory = realpathSync(entry.evidenceDir);
  if (!statSync(directory).isDirectory()) throw new Error('CORPUS_EVIDENCE_NOT_DIRECTORY');
  const files = readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort();
  if (files.length === 0) throw new Error('CORPUS_EVIDENCE_MISSING');
  return files.map((file) => join(directory, file));
};

const digestLines = (
  entry: CorpusRegistryEntry,
  files: readonly string[],
): readonly string[] =>
  files.map((file) => {
    const fileDigest = sha256(readFileSync(file));
    return `${fileDigest}  ${entry.logicalPathPrefix}/${basename(file)}\n`;
  });

const digestForLines = (lines: readonly string[]): string => sha256(lines.join(''));

export function loadGoldenCorpus(
  registry: GoldenCorpusRegistry,
): { readonly corpora: readonly LoadedCorpus[]; readonly integrity: CorpusIntegrityReport } {
  const failures: string[] = [];
  const allDigestLines: string[] = [];
  const corpora = registry.corpora.map((entry): LoadedCorpus => {
    const files = evidenceFiles(entry);
    const lines = digestLines(entry, files);
    allDigestLines.push(...lines);
    const digest = digestForLines(lines);
    const executions = files.map((file) => {
      const evidence = readExecutionEvidence(file);
      return { ...evidence, executionId: basename(file, '.json') };
    });
    const records = executions.flatMap((execution) => execution.records);
    const checkInstanceCount = records.reduce((total, record) => total + record.checks.length, 0);
    if (digest !== entry.expectedDigest) failures.push(`${entry.corpusId}:DIGEST_MISMATCH`);
    if (records.length !== entry.expectedRecords) failures.push(`${entry.corpusId}:RECORD_COUNT`);
    if (checkInstanceCount !== entry.expectedCheckInstances) {
      failures.push(`${entry.corpusId}:CHECK_COUNT`);
    }
    if (records.some((record) => record.previewTruncated || record.responsePreview === undefined)) {
      failures.push(`${entry.corpusId}:RESPONSE_NOT_REPLAYABLE`);
    }
    if (executions.some((execution) => execution.campaignIdentity?.campaignId !== entry.campaignId)) {
      failures.push(`${entry.corpusId}:CAMPAIGN_ID_MISMATCH`);
    }
    return {
      entry,
      digest,
      executions,
      recordCount: records.length,
      checkInstanceCount,
    };
  });
  const combinedDigest = digestForLines(allDigestLines);
  if (combinedDigest !== registry.expectedCombinedDigest) failures.push('COMBINED_DIGEST_MISMATCH');
  return {
    corpora,
    integrity: {
      passed: failures.length === 0,
      registryVersion: registry.registryVersion,
      corpusVersion: registry.corpusVersion,
      combinedDigest,
      expectedCombinedDigest: registry.expectedCombinedDigest,
      recordCount: corpora.reduce((total, corpus) => total + corpus.recordCount, 0),
      checkInstanceCount: corpora.reduce(
        (total, corpus) => total + corpus.checkInstanceCount,
        0,
      ),
      failures,
      corpora: corpora.map((corpus) => ({
        corpusId: corpus.entry.corpusId,
        digest: corpus.digest,
        expectedDigest: corpus.entry.expectedDigest,
        recordCount: corpus.recordCount,
        checkInstanceCount: corpus.checkInstanceCount,
      })),
    },
  };
}

const replayRecord = (
  record: EvidenceRecord,
  evaluator: 'baseline' | 'candidate',
): EvidenceRecord => {
  const response = record.responsePreview;
  if (response === undefined || record.previewTruncated) {
    throw new Error('CORPUS_RESPONSE_NOT_REPLAYABLE');
  }
  const checks =
    evaluator === 'baseline'
      ? evaluateScenarioV3(record.scenarioId, response)
      : evaluateScenarioV4(record.scenarioId, response);
  return { ...record, checks, automatedVerdict: aggregateVerdict(checks) };
};

const scorecardsFor = (
  corpus: LoadedCorpus,
  executions: readonly BenchmarkExecutionEvidence[],
): readonly BenchmarkScorecard[] => {
  const byModel = new Map<string, BenchmarkExecutionEvidence[]>();
  for (const execution of executions) {
    const model = execution.records[0]?.model;
    if (model === undefined) throw new Error('SHADOW_EVIDENCE_MODEL_MISSING');
    const grouped = byModel.get(model) ?? [];
    grouped.push(execution);
    byModel.set(model, grouped);
  }
  return buildScorecards(corpus.entry.phase, byModel);
};

interface ReplayOnce {
  readonly pairs: readonly TransitionRecordPair[];
  readonly baseline: EvaluatorReplayReport;
  readonly candidate: EvaluatorReplayReport;
  readonly transitions: readonly SemanticTransition[];
}

const replayOnce = (
  registry: GoldenCorpusRegistry,
  corpora: readonly LoadedCorpus[],
): ReplayOnce => {
  const pairs: TransitionRecordPair[] = [];
  const baselineScorecards: Record<string, readonly BenchmarkScorecard[]> = {};
  const candidateScorecards: Record<string, readonly BenchmarkScorecard[]> = {};
  for (const corpus of corpora) {
    const baselineExecutions = corpus.executions.map((execution) => ({
      ...execution,
      records: execution.records.map((record) => replayRecord(record, 'baseline')),
    }));
    const candidateExecutions = corpus.executions.map((execution) => ({
      ...execution,
      records: execution.records.map((record) => replayRecord(record, 'candidate')),
    }));
    baselineScorecards[corpus.entry.corpusId] = scorecardsFor(corpus, baselineExecutions);
    candidateScorecards[corpus.entry.corpusId] = scorecardsFor(corpus, candidateExecutions);
    for (let executionIndex = 0; executionIndex < baselineExecutions.length; executionIndex += 1) {
      const baselineExecution = baselineExecutions[executionIndex];
      const candidateExecution = candidateExecutions[executionIndex];
      if (baselineExecution === undefined || candidateExecution === undefined) {
        throw new Error('SHADOW_EXECUTION_PAIR_MISSING');
      }
      for (let recordIndex = 0; recordIndex < baselineExecution.records.length; recordIndex += 1) {
        const baseline = baselineExecution.records[recordIndex];
        const candidate = candidateExecution.records[recordIndex];
        const source = corpus.executions[executionIndex]?.records[recordIndex];
        if (baseline === undefined || candidate === undefined || source?.responsePreview === undefined) {
          throw new Error('SHADOW_RECORD_PAIR_MISSING');
        }
        if (
          JSON.stringify(source.checks) !== JSON.stringify(baseline.checks) ||
          source.automatedVerdict !== baseline.automatedVerdict
        ) {
          throw new Error('BASELINE_REPLAY_MISMATCH');
        }
        pairs.push({
          corpusId: corpus.entry.corpusId,
          corpusVersion: registry.corpusVersion,
          campaignId: corpus.entry.campaignId,
          executionId: baselineExecution.executionId,
          response: source.responsePreview,
          baselineCheckerVersion: V3_CHECKER_CONTRACT_VERSION,
          candidateCheckerVersion: CANDIDATE_CHECKER_CONTRACT_VERSION,
          baseline,
          candidate,
        });
      }
    }
  }
  const transitions = detectSemanticTransitions(pairs);
  const baselineDistribution = buildFailureSignatureDistribution(pairs, 'baseline');
  const candidateDistribution = buildFailureSignatureDistribution(pairs, 'candidate');
  const baselineCore = {
    checkerVersion: V3_CHECKER_CONTRACT_VERSION,
    failureSignatureRegistryVersion: FAILURE_SIGNATURE_REGISTRY_VERSION,
    scorecardsByCorpus: baselineScorecards,
    failureSignatureDistribution: baselineDistribution,
  };
  const candidateCore = {
    checkerVersion: CANDIDATE_CHECKER_CONTRACT_VERSION,
    failureSignatureRegistryVersion: FAILURE_SIGNATURE_REGISTRY_VERSION,
    scorecardsByCorpus: candidateScorecards,
    failureSignatureDistribution: candidateDistribution,
  };
  return {
    pairs,
    baseline: { ...baselineCore, replayDigest: sha256(JSON.stringify(baselineCore)) },
    candidate: { ...candidateCore, replayDigest: sha256(JSON.stringify(candidateCore)) },
    transitions,
  };
};

export function runProviderFreeShadowReplay(input: {
  readonly registry: GoldenCorpusRegistry;
  readonly overlay?: TransitionOverlay;
  readonly criticalLocks?: readonly CriticalRecallLock[];
}): ShadowReplayReport {
  const { corpora, integrity } = loadGoldenCorpus(input.registry);
  const first = replayOnce(input.registry, corpora);
  const second = replayOnce(input.registry, corpora);
  const deterministic =
    first.baseline.replayDigest === second.baseline.replayDigest &&
    first.candidate.replayDigest === second.candidate.replayDigest &&
    JSON.stringify(first.transitions) === JSON.stringify(second.transitions);
  const overlay =
    input.overlay ?? createDraftTransitionOverlay(input.registry.corpusVersion, first.transitions);
  validateTransitionOverlay(overlay, first.transitions);
  const criticalRecall = evaluateCriticalRecall(first.pairs, input.criticalLocks ?? []);
  const semanticChangeSummary = buildSemanticChangeSummary({
    transitions: first.transitions,
    overlay,
    criticalRecall,
    baselineDistribution: first.baseline.failureSignatureDistribution,
    candidateDistribution: first.candidate.failureSignatureDistribution,
  });
  const promotionGate = evaluateShadowPromotionGate({
    integrityPassed: integrity.passed,
    deterministic,
    transitions: first.transitions,
    overlay,
    summary: semanticChangeSummary,
  });
  const corpusIds = [...new Set([
    ...Object.keys(first.baseline.scorecardsByCorpus),
    ...Object.keys(first.candidate.scorecardsByCorpus),
  ])].sort();
  const shadowDecisionImpact: ShadowDecisionImpact = {
    rankingsByCorpus: corpusIds.map((corpusId) => {
      const baseline = (first.baseline.scorecardsByCorpus[corpusId] ?? []).map(
        (scorecard) => scorecard.model,
      );
      const candidate = (first.candidate.scorecardsByCorpus[corpusId] ?? []).map(
        (scorecard) => scorecard.model,
      );
      return {
        corpusId,
        baseline,
        candidate,
        changed: JSON.stringify(baseline) !== JSON.stringify(candidate),
      };
    }),
    championDelta: { baseline: null, candidate: null, publicationSuppressed: true },
    advancement: [],
  };
  return {
    mode: 'provider-free-shadow',
    providerExecuted: false,
    corpusIntegrity: integrity,
    deterministic,
    baseline: first.baseline,
    candidate: first.candidate,
    transitions: first.transitions,
    overlay,
    semanticChangeSummary,
    shadowDecisionImpact,
    promotionGate,
  };
}
