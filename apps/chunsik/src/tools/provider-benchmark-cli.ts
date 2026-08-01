import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  BENCHMARK_CONFIGURATIONS,
  STAGE_A1_BUDGET,
  STAGE_A1_SCHEDULE,
  STAGE_A2_BUDGET,
  STAGE_A2_SCHEDULE,
  buildScorecards,
  selectChampions,
} from './provider-benchmark';
import type {
  BenchmarkExecutionEvidence,
  BenchmarkPhase,
} from './provider-benchmark';
import type { EvidenceRecord } from './provider-semantic-validation';

type CliMode = 'plan-stage-a1' | 'summarize';

interface CliArguments {
  readonly mode: CliMode;
  readonly phase?: BenchmarkPhase;
  readonly evidenceDir?: string;
}

const HELP = `Stage 2A Provider Benchmark Framework

Offline plan (spawns no Provider):
  pnpm provider:benchmark -- --mode plan-stage-a1

Read-only evidence aggregation (spawns no Provider):
  pnpm provider:benchmark -- --mode summarize --phase A1 --evidence-dir <absolute-path>
  pnpm provider:benchmark -- --mode summarize --phase A2 --evidence-dir <absolute-path>
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
    if (!['--mode', '--phase', '--evidence-dir'].includes(option)) {
      throw new BenchmarkCliError('UNKNOWN_OPTION');
    }
    if (values.has(option)) throw new BenchmarkCliError('DUPLICATE_OPTION');
    values.set(option, value);
  }
  const mode = values.get('--mode');
  if (mode !== 'plan-stage-a1' && mode !== 'summarize') {
    throw new BenchmarkCliError('INVALID_MODE');
  }
  if (mode === 'plan-stage-a1') {
    if (values.size !== 1) throw new BenchmarkCliError('IRRELEVANT_OPTION');
    return { mode };
  }
  const phase = values.get('--phase');
  const evidenceDir = values.get('--evidence-dir');
  if ((phase !== 'A1' && phase !== 'A2') || evidenceDir === undefined || values.size !== 3) {
    throw new BenchmarkCliError('MISSING_OR_INVALID_SUMMARY_OPTION');
  }
  if (!isAbsolute(evidenceDir)) throw new BenchmarkCliError('EVIDENCE_DIR_NOT_ABSOLUTE');
  return { mode, phase, evidenceDir };
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
    typeof record.durationMs === 'number' &&
    typeof record.responseBytes === 'number' &&
    Array.isArray(record.checks) &&
    typeof record.automatedVerdict === 'string' &&
    typeof record.promptLeakDetected === 'boolean'
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
  if (
    model === undefined ||
    !BENCHMARK_CONFIGURATIONS.includes(model as (typeof BENCHMARK_CONFIGURATIONS)[number]) ||
    records.some((record) => record.model !== model)
  ) {
    throw new BenchmarkCliError('EVIDENCE_MODEL_INVALID');
  }
  return { executionId: path, records };
};

const readEvidenceDirectory = (
  candidate: string,
): ReadonlyMap<string, readonly BenchmarkExecutionEvidence[]> => {
  let directory: string;
  try {
    directory = realpathSync(candidate);
  } catch {
    throw new BenchmarkCliError('EVIDENCE_DIR_NOT_FOUND');
  }
  if (!statSync(directory).isDirectory()) throw new BenchmarkCliError('EVIDENCE_DIR_NOT_DIRECTORY');
  const evidenceByModel = new Map<string, BenchmarkExecutionEvidence[]>();
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort();
  if (files.length === 0) throw new BenchmarkCliError('EVIDENCE_FILES_MISSING');
  for (const file of files) {
    const evidence = readExecutionEvidence(join(directory, file));
    const model = evidence.records[0]?.model;
    if (model === undefined) throw new BenchmarkCliError('EVIDENCE_MODEL_INVALID');
    const grouped = evidenceByModel.get(model) ?? [];
    grouped.push(evidence);
    evidenceByModel.set(model, grouped);
  }
  return evidenceByModel;
};

const providerMatrix = (scorecards: ReturnType<typeof buildScorecards>) =>
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

export const runBenchmarkCli = (argv: readonly string[]): unknown => {
  const parsed = parseArguments(argv);
  if (parsed === 'help') return HELP;
  if (parsed.mode === 'plan-stage-a1') {
    return {
      mode: parsed.mode,
      status: 'PASS',
      providerExecuted: false,
      configurations: BENCHMARK_CONFIGURATIONS,
      schedule: STAGE_A1_SCHEDULE,
      budget: STAGE_A1_BUDGET,
      stageA2Schedule: STAGE_A2_SCHEDULE,
      stageA2Budget: STAGE_A2_BUDGET,
    };
  }
  const evidenceByModel = readEvidenceDirectory(parsed.evidenceDir ?? '');
  const scorecards = buildScorecards(parsed.phase ?? 'A1', evidenceByModel);
  const expectedConfigurations = parsed.phase === 'A1' ? BENCHMARK_CONFIGURATIONS.length : 3;
  return {
    mode: parsed.mode,
    phase: parsed.phase,
    status: 'PASS',
    providerExecuted: false,
    campaignComplete:
      evidenceByModel.size === expectedConfigurations && scorecards.every((item) => item.complete),
    scorecards,
    providerMatrix: providerMatrix(scorecards),
    advancement:
      parsed.phase === 'A1'
        ? scorecards.filter((item) => item.advancementEligible).slice(0, 3).map((item) => item.model)
        : undefined,
    champions: parsed.phase === 'A2' ? selectChampions(scorecards) : undefined,
  };
};

if (require.main === module) {
  try {
    const result = runBenchmarkCli(process.argv.slice(2));
    process.stdout.write(typeof result === 'string' ? result : `${JSON.stringify(result)}\n`);
  } catch (error: unknown) {
    const code = error instanceof BenchmarkCliError ? error.code : 'UNCLASSIFIED_ERROR';
    process.stdout.write(`${JSON.stringify({ status: 'BLOCKED', code })}\n`);
    process.exitCode = 3;
  }
}

export { BenchmarkCliError, HELP, parseArguments };
