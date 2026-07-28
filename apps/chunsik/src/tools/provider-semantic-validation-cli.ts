import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  DEFAULT_BIN,
  DEFAULT_MODEL,
  FIXTURE_VERSION,
  HarnessBlockedError,
  MAX_CALLS,
  NodeProcessAdapter,
  PROMPT_CONTRACT_VERSION,
  ProviderSemanticHarness,
  buildAllowlistedEnvironment,
  computeRevisionBinding,
  validateFixtures,
  validateNonSecretConfig,
} from './provider-semantic-validation';
import type {
  HarnessConfig,
  RevisionInspector,
  RevisionState,
  ScenarioId,
} from './provider-semantic-validation';

type Mode =
  | 'validate-config'
  | 'validate-fixtures'
  | 'probe-provider'
  | 'run'
  | 'run-all';

const HELP = `Stage 2A Provider Semantic Validation Harness

Offline modes (no Provider process):
  pnpm provider:semantic -- --mode validate-config [--bin ollama] [--model llama3.1]
  pnpm provider:semantic -- --mode validate-fixtures

Strict modes (require separate Provider/loopback approval):
  pnpm provider:semantic -- --mode probe-provider --expected-head <sha> --expected-binding <sha> --bin <path> --model <name>
  pnpm provider:semantic -- --mode run --scenario A --calls 2 --expected-head <sha> --expected-binding <sha> --bin <path> --model <name>
  pnpm provider:semantic -- --mode run-all --calls 2 --expected-head <sha> --expected-binding <sha> --bin <path> --model <name>

The harness writes bounded JSON to stdout only. It never writes repository evidence.
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

const option = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const parseMode = (args: readonly string[]): Mode => {
  const mode = option(args, '--mode');
  if (
    mode === 'validate-config' ||
    mode === 'validate-fixtures' ||
    mode === 'probe-provider' ||
    mode === 'run' ||
    mode === 'run-all'
  ) {
    return mode;
  }
  throw new HarnessBlockedError('INVALID_MODE');
};

const parseScenario = (args: readonly string[]): ScenarioId => {
  const id = option(args, '--scenario');
  if (id === 'A' || id === 'B' || id === 'C' || id === 'D' || id === 'E') {
    return id;
  }
  throw new HarnessBlockedError('INVALID_SCENARIO');
};

const parseCalls = (args: readonly string[]): number => {
  const raw = option(args, '--calls') ?? '1';
  if (!/^\d+$/.test(raw)) throw new HarnessBlockedError('INVALID_CALL_COUNT');
  return Number(raw);
};

const approvedParentEnvironment = (): Readonly<
  Record<string, string | undefined>
> => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  TMP: process.env.TMP,
  TEMP: process.env.TEMP,
  LANG: process.env.LANG,
  LC_ALL: process.env.LC_ALL,
});

const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

const configFromArgs = (args: readonly string[]): HarnessConfig => ({
  repoRoot,
  bin: option(args, '--bin') ?? DEFAULT_BIN,
  model: option(args, '--model') ?? DEFAULT_MODEL,
  expectedHead: option(args, '--expected-head') ?? '',
  expectedBinding: option(args, '--expected-binding') ?? '',
  calls: parseCalls(args),
  parentEnv: approvedParentEnvironment(),
});

async function main(args: readonly string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }
  const mode = parseMode(args);
  const inspector = new GitRevisionInspector(repoRoot);
  if (mode === 'validate-fixtures') {
    writeJson({ mode, status: 'PASS', ...validateFixtures() });
    return;
  }
  const config = configFromArgs(args);
  validateNonSecretConfig(config.bin, config.model, config.calls);
  if (mode === 'validate-config') {
    const state = inspector.inspect();
    const binding = computeRevisionBinding(state, repoRoot);
    writeJson({
      mode,
      status: 'PASS',
      executionReady:
        state.branch === 'main' &&
        state.head === state.originMain &&
        state.trackedClean,
      branch: state.branch,
      head: state.head,
      originMain: state.originMain,
      trackedClean: state.trackedClean,
      fixtureVersion: FIXTURE_VERSION,
      promptContractVersion: PROMPT_CONTRACT_VERSION,
      binding: binding.binding,
      compiledDigests: {
        promptComposer: binding.composerDigest,
        promptRenderer: binding.rendererDigest,
        providerAdapter: binding.adapterDigest,
        semanticHarness: binding.harnessDigest,
      },
      sourceDigests: binding.sourceDigests,
      childEnvironmentNames: Object.keys(
        buildAllowlistedEnvironment(config.parentEnv),
      ).sort(),
      providerId: 'ollama-cli',
      model: config.model,
      executable: config.bin,
      providerExecuted: false,
    });
    return;
  }
  if (!config.expectedHead || !config.expectedBinding) {
    throw new HarnessBlockedError('MISSING_REVISION_BINDING');
  }
  const harness = new ProviderSemanticHarness(
    new NodeProcessAdapter(),
    inspector,
  );
  if (mode === 'probe-provider') {
    const result = await harness.probeProvider(config);
    writeJson({
      mode,
      status: 'PASS',
      ...result,
      providerId: 'ollama-cli',
      model: config.model,
    });
    return;
  }
  const scenarioIds: ScenarioId[] =
    mode === 'run-all' ? ['A', 'B', 'C', 'D', 'E'] : [parseScenario(args)];
  const records = await harness.run(config, scenarioIds);
  const hasFailure = records.some(
    (record) => record.automatedVerdict !== 'AUTOMATED_PASS',
  );
  writeJson({
    mode,
    status: hasFailure ? 'AUTOMATED_FAIL' : 'HUMAN_REVIEW_REQUIRED',
    callCount: records.length,
    records,
  });
  if (hasFailure) process.exitCode = 2;
}

if (require.main === module) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    const code =
      error instanceof HarnessBlockedError ? error.code : 'UNCLASSIFIED_ERROR';
    writeJson({ status: 'BLOCKED', code });
    process.exitCode = 3;
  });
}

export { HELP, GitRevisionInspector, main };
