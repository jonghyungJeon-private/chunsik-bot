import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { loadGoldenCorpusRegistry, runProviderFreeShadowReplay } from './provider-semantic-shadow';
import type { CriticalRecallLock, TransitionOverlay } from './provider-semantic-transition';

interface ShadowCliArguments {
  readonly registryPath: string;
  readonly outputDir: string;
  readonly overlayPath?: string;
  readonly criticalLocksPath?: string;
}

export class ShadowCliError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ShadowCliError';
  }
}

const parseArguments = (argv: readonly string[]): ShadowCliArguments => {
  const input = argv[0] === '--' ? argv.slice(1) : argv;
  const values = new Map<string, string>();
  for (let index = 0; index < input.length; index += 2) {
    const option = input[index];
    const value = input[index + 1];
    if (
      option === undefined ||
      value === undefined ||
      !['--registry', '--output-dir', '--overlay', '--critical-locks'].includes(option)
    ) {
      throw new ShadowCliError('SHADOW_ARGUMENTS_INVALID');
    }
    if (values.has(option)) throw new ShadowCliError('SHADOW_ARGUMENT_DUPLICATE');
    values.set(option, value);
  }
  const registryPath = values.get('--registry');
  const outputDir = values.get('--output-dir');
  if (registryPath === undefined || outputDir === undefined) {
    throw new ShadowCliError('SHADOW_ARGUMENT_REQUIRED');
  }
  const paths = [registryPath, outputDir, values.get('--overlay'), values.get('--critical-locks')].filter(
    (value): value is string => value !== undefined,
  );
  if (paths.some((path) => !isAbsolute(path))) {
    throw new ShadowCliError('SHADOW_PATH_NOT_ABSOLUTE');
  }
  return {
    registryPath,
    outputDir,
    overlayPath: values.get('--overlay'),
    criticalLocksPath: values.get('--critical-locks'),
  };
};

const readJson = <T>(path: string | undefined): T | undefined =>
  path === undefined ? undefined : (JSON.parse(readFileSync(path, 'utf8')) as T);

export const runShadowCli = (argv: readonly string[]): unknown => {
  const args = parseArguments(argv);
  const registry = loadGoldenCorpusRegistry(args.registryPath);
  const report = runProviderFreeShadowReplay({
    registry,
    overlay: readJson<TransitionOverlay>(args.overlayPath),
    criticalLocks: readJson<readonly CriticalRecallLock[]>(args.criticalLocksPath),
  });
  if (existsSync(args.outputDir)) throw new ShadowCliError('SHADOW_OUTPUT_ALREADY_EXISTS');
  mkdirSync(args.outputDir);
  const writeJson = (name: string, value: unknown): void => {
    writeFileSync(join(args.outputDir, name), `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  };
  writeJson('baseline-report.json', report.baseline);
  writeJson('candidate-report.json', report.candidate);
  writeJson('transitions.json', report.transitions);
  writeJson('transition-overlay.draft.json', report.overlay);
  writeJson('semantic-change-summary.json', report.semanticChangeSummary);
  writeJson('shadow-decision-impact.json', report.shadowDecisionImpact);
  writeJson('promotion-gate.json', report.promotionGate);
  writeJson('shadow-report.json', report);
  return {
    status: report.corpusIntegrity.passed && report.deterministic ? 'PASS' : 'BLOCKED',
    providerExecuted: false,
    corpusVersion: report.corpusIntegrity.corpusVersion,
    transitionCount: report.transitions.length,
    deterministic: report.deterministic,
    promotionEligible: report.promotionGate.eligible,
    outputDir: args.outputDir,
  };
};

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(runShadowCli(process.argv.slice(2)))}\n`);
  } catch (error: unknown) {
    const code = error instanceof ShadowCliError ? error.code : 'SHADOW_REPLAY_BLOCKED';
    process.stdout.write(`${JSON.stringify({ status: 'BLOCKED', providerExecuted: false, code })}\n`);
    process.exitCode = 3;
  }
}

export { parseArguments };
