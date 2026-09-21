import { execFileSync } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import {
  CHILD_ENV_ALLOWLIST,
  FIXTURE_VERSION,
  FORBIDDEN_CHILD_ENV_NAMES,
  HarnessBlockedError,
  MAX_CALLS,
  NodeProcessAdapter,
  PROMPT_CONTRACT_VERSION,
  ProviderSemanticHarness,
  canonicalExecutionBindingPayload,
  computeExecutionBindingDigest,
  computeStaticCodeBinding,
  resolveApprovedExecutable,
  resolveApprovedModelsDir,
  validateCalls,
  validateFixtures,
  validateModel,
} from './provider-semantic-validation';
import {
  CHECKER_CONTRACT_VERSION,
  DEFAULT_SEMANTIC_EVALUATOR,
} from './provider-semantic-evaluator';
import type {
  HarnessConfig,
  ProviderMode,
  RevisionInspector,
  RevisionState,
  ScenarioId,
} from './provider-semantic-validation';

type Mode =
  | 'validate-fixtures'
  | 'validate-config'
  | 'plan-execution'
  | 'probe-provider'
  | 'run'
  | 'run-all';

const MODES: readonly Mode[] = [
  'validate-fixtures',
  'validate-config',
  'plan-execution',
  'probe-provider',
  'run',
  'run-all',
];

const PROVIDER_MODES: readonly ProviderMode[] = ['probe-provider', 'run', 'run-all'];

const HELP = `Stage 2A Provider Semantic Validation Harness

Offline modes (no Provider process, no executable resolution):
  pnpm provider:semantic -- --mode validate-fixtures
  pnpm provider:semantic -- --mode validate-config

Offline execution planning (resolves the approved executable, spawns nothing):
  pnpm provider:semantic -- --mode plan-execution --for-mode run --bin <absolute-path> --model <name> --scenario A --calls 2

Strict modes (require separate Provider/loopback approval):
  pnpm provider:semantic -- --mode probe-provider --bin <absolute-path> --model <name> --expected-head <sha40> --expected-static-binding <sha256> --expected-execution-binding <sha256>
  pnpm provider:semantic -- --mode run --scenario A --calls 2 --bin <absolute-path> --model <name> --expected-head <sha40> --expected-static-binding <sha256> --expected-execution-binding <sha256>
  pnpm provider:semantic -- --mode run-all --calls 2 --bin <absolute-path> --model <name> --expected-head <sha40> --expected-static-binding <sha256> --expected-execution-binding <sha256>

Every option is validated against an exact per-mode schema before anything is
spawned. --bin must be an absolute path; there is no default executable, no PATH
lookup, and no environment fallback. The harness writes bounded JSON to stdout
only and never writes repository evidence.
`;

const repoRoot = resolve(__dirname, '../../../..');

class GitRevisionInspector implements RevisionInspector {
  constructor(private readonly root: string) {}

  inspect(): RevisionState {
    const git = (args: string[]): string =>
      execFileSync('git', args, {
        cwd: this.root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    return {
      branch: git(['symbolic-ref', '--short', 'HEAD']),
      head: git(['rev-parse', 'HEAD']),
      originMain: git(['rev-parse', 'origin/main']),
      trackedClean:
        git(['status', '--porcelain', '--untracked-files=no']).length === 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Finding 7 — fully fail-closed argument parser
// ---------------------------------------------------------------------------

type OptionKind = 'mode' | 'text' | 'model' | 'path' | 'scenario' | 'calls' | 'sha40' | 'sha64';

const OPTION_KINDS: Readonly<Record<string, OptionKind>> = Object.freeze({
  '--mode': 'mode',
  '--for-mode': 'text',
  '--bin': 'path',
  '--model': 'model',
  '--models-dir': 'path',
  '--scenario': 'scenario',
  '--calls': 'calls',
  '--expected-head': 'sha40',
  '--expected-static-binding': 'sha64',
  '--expected-execution-binding': 'sha64',
});

const STRICT_REQUIRED = [
  '--bin',
  '--model',
  '--expected-head',
  '--expected-static-binding',
  '--expected-execution-binding',
] as const;

const MODE_SCHEMA: Readonly<
  Record<Mode, { required: readonly string[]; optional: readonly string[] }>
> = Object.freeze({
  'validate-fixtures': { required: [], optional: [] },
  'validate-config': { required: [], optional: [] },
  'plan-execution': {
    required: ['--for-mode', '--bin', '--model'],
    optional: ['--scenario', '--calls', '--models-dir'],
  },
  'probe-provider': { required: [...STRICT_REQUIRED], optional: ['--models-dir'] },
  run: {
    required: [...STRICT_REQUIRED, '--scenario', '--calls'],
    optional: ['--models-dir'],
  },
  'run-all': { required: [...STRICT_REQUIRED, '--calls'], optional: ['--models-dir'] },
});

export interface ParsedArguments {
  kind: 'help' | 'command';
  mode: Mode;
  options: Readonly<Record<string, string>>;
}

const isOptionToken = (token: string): boolean => token.startsWith('--');

function validateOptionValue(name: string, value: string): void {
  const kind = OPTION_KINDS[name];
  switch (kind) {
    case 'mode':
      if (!MODES.includes(value as Mode)) throw new HarnessBlockedError('INVALID_MODE');
      return;
    case 'text':
      if (!PROVIDER_MODES.includes(value as ProviderMode)) {
        throw new HarnessBlockedError('INVALID_TARGET_MODE');
      }
      return;
    case 'model':
      validateModel(value);
      return;
    case 'path':
      if (!isAbsolute(value)) throw new HarnessBlockedError('OPTION_PATH_NOT_ABSOLUTE');
      return;
    case 'scenario':
      if (!['A', 'B', 'C', 'D', 'E'].includes(value)) {
        throw new HarnessBlockedError('INVALID_SCENARIO');
      }
      return;
    case 'calls': {
      if (!/^\d+$/.test(value)) throw new HarnessBlockedError('MALFORMED_INTEGER');
      const calls = Number(value);
      validateCalls(calls);
      return;
    }
    case 'sha40':
      if (!/^[0-9a-f]{40}$/.test(value)) throw new HarnessBlockedError('MALFORMED_SHA40');
      return;
    case 'sha64':
      if (!/^[0-9a-f]{64}$/.test(value)) throw new HarnessBlockedError('MALFORMED_SHA256');
      return;
    default:
      throw new HarnessBlockedError('UNKNOWN_OPTION');
  }
}

/**
 * Rejects unknown, duplicate, irrelevant, abbreviated, value-less, malformed,
 * and positional arguments, plus the unsupported `--flag=value` form. Every
 * rejection happens here, before any executable is resolved or spawned.
 */
export function parseCliArguments(input: readonly string[]): ParsedArguments {
  // A single leading `--` is the package-manager argument separator
  // (`pnpm provider:semantic -- --mode ...`). Any later `--` stays rejected.
  const argv = input[0] === '--' ? input.slice(1) : input;
  const help = argv.filter((token) => token === '--help' || token === '-h');
  if (help.length > 0) {
    if (argv.length !== 1) throw new HarnessBlockedError('HELP_MUST_BE_SOLE_ARGUMENT');
    return { kind: 'help', mode: 'validate-fixtures', options: {} };
  }

  const options: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) throw new HarnessBlockedError('MALFORMED_ARGUMENTS');
    if (!isOptionToken(token)) {
      throw new HarnessBlockedError(
        token.startsWith('-') ? 'UNKNOWN_OPTION' : 'POSITIONAL_ARGUMENT_REJECTED',
      );
    }
    if (token.includes('=')) {
      throw new HarnessBlockedError('OPTION_VALUE_FORM_UNSUPPORTED');
    }
    if (!Object.prototype.hasOwnProperty.call(OPTION_KINDS, token)) {
      throw new HarnessBlockedError('UNKNOWN_OPTION');
    }
    if (Object.prototype.hasOwnProperty.call(options, token)) {
      throw new HarnessBlockedError('DUPLICATE_OPTION');
    }
    const value = argv[index + 1];
    if (value === undefined || isOptionToken(value)) {
      throw new HarnessBlockedError('MISSING_OPTION_VALUE');
    }
    validateOptionValue(token, value);
    options[token] = value;
    index += 1;
  }

  const rawMode = options['--mode'];
  if (rawMode === undefined) throw new HarnessBlockedError('MISSING_MODE');
  const mode = rawMode as Mode;
  const schema = MODE_SCHEMA[mode];
  const allowed = new Set<string>(['--mode', ...schema.required, ...schema.optional]);
  for (const name of Object.keys(options)) {
    if (!allowed.has(name)) throw new HarnessBlockedError('IRRELEVANT_OPTION');
  }
  for (const name of schema.required) {
    if (!Object.prototype.hasOwnProperty.call(options, name)) {
      throw new HarnessBlockedError('MISSING_REQUIRED_OPTION');
    }
  }
  if (mode === 'run-all' && options['--scenario'] !== undefined) {
    throw new HarnessBlockedError('IRRELEVANT_OPTION');
  }
  if (mode === 'plan-execution') {
    const target = options['--for-mode'] as ProviderMode;
    const hasScenario = options['--scenario'] !== undefined;
    const hasCalls = options['--calls'] !== undefined;
    if (target === 'run' && (!hasScenario || !hasCalls)) {
      throw new HarnessBlockedError('MISSING_REQUIRED_OPTION');
    }
    if (target === 'run-all' && (hasScenario || !hasCalls)) {
      throw new HarnessBlockedError(hasScenario ? 'IRRELEVANT_OPTION' : 'MISSING_REQUIRED_OPTION');
    }
    if (target === 'probe-provider' && (hasScenario || hasCalls)) {
      throw new HarnessBlockedError('IRRELEVANT_OPTION');
    }
  }
  return { kind: 'command', mode, options: Object.freeze({ ...options }) };
}

// ---------------------------------------------------------------------------

const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

const scenariosFor = (mode: ProviderMode, scenario: string | undefined): ScenarioId[] => {
  if (mode === 'probe-provider') return [];
  if (mode === 'run-all') return ['A', 'B', 'C', 'D', 'E'];
  if (scenario === undefined) throw new HarnessBlockedError('MISSING_REQUIRED_OPTION');
  return [scenario as ScenarioId];
};

const configFrom = (
  options: Readonly<Record<string, string>>,
  calls: number,
): HarnessConfig => ({
  repoRoot,
  executablePath: options['--bin'] ?? '',
  model: options['--model'] ?? '',
  calls,
  modelsDir: options['--models-dir'] ?? null,
  expectedHead: options['--expected-head'] ?? '',
  expectedStaticBinding: options['--expected-static-binding'] ?? '',
  expectedExecutionBinding: options['--expected-execution-binding'] ?? '',
});

async function main(argv: readonly string[]): Promise<void> {
  const parsed = parseCliArguments(argv);
  if (parsed.kind === 'help') {
    process.stdout.write(HELP);
    return;
  }
  const { mode, options } = parsed;
  const inspector = new GitRevisionInspector(repoRoot);

  if (mode === 'validate-fixtures') {
    writeJson({
      mode,
      status: 'PASS',
      providerExecuted: false,
      checkerContractVersion: CHECKER_CONTRACT_VERSION,
      ...validateFixtures(),
    });
    return;
  }

  if (mode === 'validate-config') {
    validateFixtures();
    const state = inspector.inspect();
    const staticBinding = computeStaticCodeBinding(
      state,
      repoRoot,
      DEFAULT_SEMANTIC_EVALUATOR.checkerContractVersion,
    );
    writeJson({
      mode,
      status: 'PASS',
      providerExecuted: false,
      executionReady:
        state.branch === 'main' && state.head === state.originMain && state.trackedClean,
      branch: state.branch,
      head: state.head,
      originMain: state.originMain,
      trackedClean: state.trackedClean,
      fixtureVersion: FIXTURE_VERSION,
      promptContractVersion: PROMPT_CONTRACT_VERSION,
      checkerContractVersion: CHECKER_CONTRACT_VERSION,
      staticBinding: staticBinding.digest,
      boundModules: staticBinding.modules,
      childEnvironmentNames: [...CHILD_ENV_ALLOWLIST],
      forbiddenChildEnvironmentNames: [...FORBIDDEN_CHILD_ENV_NAMES],
      parentEnvironmentForwarded: false,
      providerId: 'ollama-cli',
    });
    return;
  }

  if (mode === 'plan-execution') {
    validateFixtures();
    const targetMode = options['--for-mode'] as ProviderMode;
    const model = options['--model'] ?? '';
    validateModel(model);
    const calls = targetMode === 'probe-provider' ? 0 : Number(options['--calls']);
    if (targetMode !== 'probe-provider') validateCalls(calls);
    const state = inspector.inspect();
    const staticBinding = computeStaticCodeBinding(
      state,
      repoRoot,
      DEFAULT_SEMANTIC_EVALUATOR.checkerContractVersion,
    );
    const executable = resolveApprovedExecutable(options['--bin'] ?? '');
    const modelsDir = resolveApprovedModelsDir(options['--models-dir'] ?? null);
    const input = {
      staticBindingDigest: staticBinding.digest,
      executable,
      model,
      mode: targetMode,
      scenarios: scenariosFor(targetMode, options['--scenario']),
      calls,
      modelsDir,
      checkerContractVersion: DEFAULT_SEMANTIC_EVALUATOR.checkerContractVersion,
    };
    writeJson({
      mode,
      status: 'PASS',
      providerExecuted: false,
      checkerContractVersion: CHECKER_CONTRACT_VERSION,
      head: state.head,
      staticBinding: staticBinding.digest,
      executionBinding: computeExecutionBindingDigest(input),
      executionBindingPayload: canonicalExecutionBindingPayload(input),
    });
    return;
  }

  const providerMode: ProviderMode = mode;
  const calls = providerMode === 'probe-provider' ? 0 : Number(options['--calls']);
  const config = configFrom(options, calls);
  const harness = new ProviderSemanticHarness(
    new NodeProcessAdapter(),
    inspector,
    DEFAULT_SEMANTIC_EVALUATOR,
  );

  if (providerMode === 'probe-provider') {
    const result = await harness.probeProvider(config);
    writeJson({
      mode,
      status: 'PASS',
      checkerContractVersion: CHECKER_CONTRACT_VERSION,
      ...result,
      providerId: 'ollama-cli',
      model: config.model,
    });
    return;
  }

  const scenarioIds = scenariosFor(providerMode, options['--scenario']);
  const records = await harness.run(config, providerMode, scenarioIds);
  const failed = records.some((record) => record.automatedVerdict === 'AUTOMATED_FAIL');
  writeJson({
    mode,
    status: failed ? 'AUTOMATED_FAIL' : 'HUMAN_REVIEW_REQUIRED',
    callCount: records.length,
    maxCalls: MAX_CALLS,
    checkerContractVersion: CHECKER_CONTRACT_VERSION,
    records,
  });
  if (failed) process.exitCode = 2;
}

if (require.main === module) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    if (error instanceof HarnessBlockedError) {
      writeJson({
        status: 'BLOCKED',
        checkerContractVersion: CHECKER_CONTRACT_VERSION,
        code: error.code,
        details: error.details,
      });
    } else {
      writeJson({
        status: 'BLOCKED',
        checkerContractVersion: CHECKER_CONTRACT_VERSION,
        code: 'UNCLASSIFIED_ERROR',
      });
    }
    process.exitCode = 3;
  });
}

export { HELP, GitRevisionInspector, main };
