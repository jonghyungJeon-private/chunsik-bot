import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  BenchmarkConfigurationError,
  computeConfigurationDigest,
  loadBenchmarkConfiguration,
  validateBenchmarkConfiguration,
} from './provider-benchmark-config';
import type { LoadedBenchmarkConfiguration } from './provider-benchmark-config';
import {
  BenchmarkCampaignError,
  buildCampaignReport,
  scheduleFor,
} from './provider-benchmark';
import type {
  BenchmarkCampaignIdentity,
  BenchmarkExecutionEvidence,
  BenchmarkPhase,
} from './provider-benchmark';
import {
  STAGE_2A_DECISION_POLICY_VERSION,
  selectBenchmarkChampions,
} from './provider-benchmark-decision';
import type { EvidenceRecord } from './provider-semantic-validation';

type CliMode = 'plan-stage-a1' | 'summarize';

interface CliArguments {
  readonly mode: CliMode;
  readonly phase?: BenchmarkPhase;
  readonly evidenceDir?: string;
  readonly configPath?: string;
}

const HELP = `Stage 2A Provider Benchmark Framework

Offline plan (spawns no Provider):
  pnpm provider:benchmark -- --mode plan-stage-a1 [--config <absolute-path>]

Read-only evidence aggregation (spawns no Provider):
  pnpm provider:benchmark -- --mode summarize --phase A1 --evidence-dir <absolute-path> [--config <absolute-path>]
  pnpm provider:benchmark -- --mode summarize --phase A2 --evidence-dir <absolute-path> [--config <absolute-path>]
`;

class BenchmarkCliError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'BenchmarkCliError';
  }
}

const parseArguments = (input: readonly string[]): CliArguments | 'help' => {
  const argv = input[0] === '--' ? input.slice(1) : input;
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return 'help';
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (option === undefined || value === undefined || !option.startsWith('--')) {
      throw new BenchmarkCliError('MALFORMED_ARGUMENTS');
    }
    if (!['--mode', '--phase', '--evidence-dir', '--config'].includes(option)) {
      throw new BenchmarkCliError('UNKNOWN_OPTION');
    }
    if (values.has(option)) throw new BenchmarkCliError('DUPLICATE_OPTION');
    values.set(option, value);
  }
  const mode = values.get('--mode');
  if (mode !== 'plan-stage-a1' && mode !== 'summarize') {
    throw new BenchmarkCliError('INVALID_MODE');
  }
  const configPath = values.get('--config');
  if (configPath !== undefined && !isAbsolute(configPath)) {
    throw new BenchmarkCliError('CONFIG_PATH_NOT_ABSOLUTE');
  }
  if (mode === 'plan-stage-a1') {
    if ([...values.keys()].some((key) => !['--mode', '--config'].includes(key))) {
      throw new BenchmarkCliError('IRRELEVANT_OPTION');
    }
    return { mode, configPath };
  }
  const phase = values.get('--phase');
  const evidenceDir = values.get('--evidence-dir');
  if (
    (phase !== 'A1' && phase !== 'A2') ||
    evidenceDir === undefined ||
    [...values.keys()].some(
      (key) => !['--mode', '--phase', '--evidence-dir', '--config'].includes(key),
    )
  ) {
    throw new BenchmarkCliError('MISSING_OR_INVALID_SUMMARY_OPTION');
  }
  if (!isAbsolute(evidenceDir)) throw new BenchmarkCliError('EVIDENCE_DIR_NOT_ABSOLUTE');
  return { mode, phase, evidenceDir, configPath };
};

const jsonObjectLines = (content: string): unknown[] => {
  const parsed: unknown[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
    try {
      parsed.push(JSON.parse(trimmed) as unknown);
    } catch {
      throw new BenchmarkCliError('EVIDENCE_JSON_MALFORMED');
    }
  }
  return parsed;
};

const isEvidenceRecord = (value: unknown): value is EvidenceRecord => {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    ['A', 'B', 'C', 'D', 'E'].includes(String(record.scenarioId)) &&
    typeof record.model === 'string' &&
    typeof record.head === 'string' &&
    typeof record.durationMs === 'number' &&
    typeof record.responseBytes === 'number' &&
    Array.isArray(record.checks) &&
    typeof record.automatedVerdict === 'string' &&
    typeof record.promptLeakDetected === 'boolean'
  );
};

const isCampaignIdentity = (value: unknown): value is BenchmarkCampaignIdentity => {
  if (value === null || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const executable = item.executableIdentity;
  return (
    typeof item.campaignId === 'string' &&
    typeof item.campaignFingerprint === 'string' &&
    typeof item.repositoryHead === 'string' &&
    typeof item.configurationDigest === 'string' &&
    (item.phase === 'A1' || item.phase === 'A2') &&
    typeof item.scheduleContractVersion === 'string' &&
    typeof item.promptContractVersion === 'string' &&
    typeof item.fixtureVersion === 'string' &&
    typeof item.checkerContractVersion === 'string' &&
    typeof item.benchmarkContractVersion === 'string' &&
    typeof item.staticCodeBindingDigest === 'string' &&
    executable !== null &&
    typeof executable === 'object' &&
    typeof (executable as Record<string, unknown>).approvedPath === 'string' &&
    typeof (executable as Record<string, unknown>).realPath === 'string' &&
    typeof (executable as Record<string, unknown>).sizeBytes === 'number' &&
    typeof (executable as Record<string, unknown>).mode === 'string' &&
    typeof (executable as Record<string, unknown>).sha256 === 'string'
  );
};

const readExecutionEvidence = (path: string): BenchmarkExecutionEvidence => {
  const candidates = jsonObjectLines(readFileSync(path, 'utf8')).filter(
    (value): value is Record<string, unknown> => value !== null && typeof value === 'object',
  );
  const envelope = candidates.find((value) => Array.isArray(value.records));
  if (envelope === undefined || !Array.isArray(envelope.records) || envelope.records.length === 0) {
    throw new BenchmarkCliError('EVIDENCE_RECORDS_MISSING');
  }
  if (!envelope.records.every(isEvidenceRecord)) {
    throw new BenchmarkCliError('EVIDENCE_RECORD_INVALID');
  }
  const records = envelope.records;
  const model = records[0]?.model;
  if (model === undefined || records.some((record) => record.model !== model)) {
    throw new BenchmarkCliError('EVIDENCE_MODEL_INVALID');
  }
  const rawFingerprint = envelope.campaignFingerprint;
  const campaignFingerprint =
    rawFingerprint === undefined || rawFingerprint === null
      ? null
      : typeof rawFingerprint === 'string'
        ? rawFingerprint
        : undefined;
  if (campaignFingerprint === undefined) {
    throw new BenchmarkCliError('EVIDENCE_FINGERPRINT_INVALID');
  }
  const rawIdentity = envelope.campaignIdentity;
  if (rawIdentity !== undefined && !isCampaignIdentity(rawIdentity)) {
    throw new BenchmarkCliError('EVIDENCE_CAMPAIGN_IDENTITY_INVALID');
  }
  if ((campaignFingerprint === null) !== (rawIdentity === undefined)) {
    throw new BenchmarkCliError('EVIDENCE_CAMPAIGN_IDENTITY_INCOMPLETE');
  }
  const executionBinding = envelope.executionBinding;
  if (executionBinding !== undefined && typeof executionBinding !== 'string') {
    throw new BenchmarkCliError('EVIDENCE_EXECUTION_BINDING_INVALID');
  }
  return {
    executionId: path,
    campaignFingerprint,
    campaignIdentity: rawIdentity,
    executionBinding,
    records,
  };
};

const readEvidenceDirectory = (candidate: string): BenchmarkExecutionEvidence[] => {
  let directory: string;
  try {
    directory = realpathSync(candidate);
  } catch {
    throw new BenchmarkCliError('EVIDENCE_DIR_NOT_FOUND');
  }
  if (!statSync(directory).isDirectory()) throw new BenchmarkCliError('EVIDENCE_DIR_NOT_DIRECTORY');
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort();
  if (files.length === 0) throw new BenchmarkCliError('EVIDENCE_FILES_MISSING');
  return files.map((file) => readExecutionEvidence(join(directory, file)));
};

const legacyA2Configuration = (): LoadedBenchmarkConfiguration => {
  const legacy = loadBenchmarkConfiguration(undefined, 'A1');
  const configuration = validateBenchmarkConfiguration(
    { ...legacy.configuration, phase: 'A2', campaignId: 'stage2a-legacy-v2.1-a2-unknown' },
    'A2',
  );
  return {
    configuration,
    configurationDigest: computeConfigurationDigest(configuration),
    configurationSource: 'LEGACY_DEFAULT',
    sourcePath: legacy.sourcePath,
  };
};

const loadForCli = (
  configPath: string | undefined,
  phase: BenchmarkPhase,
): LoadedBenchmarkConfiguration =>
  configPath === undefined && phase === 'A2'
    ? legacyA2Configuration()
    : loadBenchmarkConfiguration(configPath, phase);

const cliReport = (loaded: LoadedBenchmarkConfiguration, evidence: BenchmarkExecutionEvidence[]) => {
  const report = buildCampaignReport(loaded, evidence);
  const decision = selectBenchmarkChampions(report);
  const decisionByModel = new Map(decision.scorecards.map((item) => [item.model, item]));
  return {
    campaignId: report.campaignId,
    configurationSource: report.configurationSource,
    configurationDigest: report.configurationDigest,
    configurationIdentity: report.configurationIdentity,
    campaignFingerprint: report.campaignFingerprint,
    expectedModels: report.expectedModels,
    observedModels: report.observedModels,
    coverage: report.coverage,
    campaignComplete: report.campaignComplete,
    provisional: decision.provisional,
    decisionPolicyVersion: decision.decisionPolicyVersion,
    budget: report.budget,
    scorecards: report.scorecards.map((scorecard) => ({
      ...scorecard,
      ...decisionByModel.get(scorecard.model),
    })),
    providerMatrix: report.providerMatrix,
    advancement: decision.advancement,
    champions: decision.champions,
  };
};

export const runBenchmarkCli = (argv: readonly string[]): unknown => {
  const parsed = parseArguments(argv);
  if (parsed === 'help') return HELP;
  if (parsed.mode === 'plan-stage-a1') {
    const loaded = loadForCli(parsed.configPath, 'A1');
    const report = cliReport(loaded, []);
    return {
      mode: parsed.mode,
      status: 'PASS',
      providerExecuted: false,
      schedule: scheduleFor('A1'),
      ...report,
      configurationIdentity: loaded.configurationDigest,
    };
  }
  const phase = parsed.phase ?? 'A1';
  const loaded = loadForCli(parsed.configPath, phase);
  const evidence = readEvidenceDirectory(parsed.evidenceDir ?? '');
  return {
    mode: parsed.mode,
    phase,
    status: 'PASS',
    providerExecuted: false,
    ...cliReport(loaded, evidence),
  };
};

if (require.main === module) {
  try {
    const result = runBenchmarkCli(process.argv.slice(2));
    process.stdout.write(typeof result === 'string' ? result : `${JSON.stringify(result)}\n`);
  } catch (error: unknown) {
    const code =
      error instanceof BenchmarkCliError ||
      error instanceof BenchmarkConfigurationError ||
      error instanceof BenchmarkCampaignError
        ? error.code
        : 'UNCLASSIFIED_ERROR';
    process.stdout.write(`${JSON.stringify({ status: 'BLOCKED', code })}\n`);
    process.exitCode = 3;
  }
}

export { BenchmarkCliError, HELP, parseArguments, readExecutionEvidence };
