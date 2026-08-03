import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import {
  ExternalEgressControl,
  MAX_EXECUTABLE_BYTES,
  OLLAMA_EXECUTABLE_IDENTITY_VERSION,
  OLLAMA_INVENTORY_PARSER_VERSION,
  OLLAMA_PREFLIGHT_COMMAND_POLICY_VERSION,
  OLLAMA_PREFLIGHT_CONTRACT_VERSION,
  OllamaPreflightStatus,
} from '../provider-routing/ollama-preflight/contracts';
import type {
  ApprovedOllamaExecutable,
  OllamaPreflightResult,
} from '../provider-routing/ollama-preflight/contracts';
import type {
  OllamaPreflightFileSystem,
  PreflightFileStat,
} from '../provider-routing/ollama-preflight/executable-identity';
import { parseApprovedLoopbackEndpoint } from '../provider-routing/ollama-preflight/policy';
import {
  ContainedOllamaPreflightProcessRunner,
} from '../provider-routing/ollama-preflight/process-runner';
import type {
  PreflightSandbox,
} from '../provider-routing/ollama-preflight/process-runner';
import { OllamaInventoryPreflight } from '../provider-routing/ollama-preflight/preflight';

const FLAGS = Object.freeze([
  '--executable-realpath',
  '--expected-executable-sha256',
  '--expected-executable-size-bytes',
  '--approved-loopback-endpoint',
  '--external-egress-control',
] as const);

type InvocationFlag = typeof FLAGS[number];

export const OLLAMA_PREFLIGHT_EXECUTION_CONTRACT_VERSION =
  'stage2b-ollama-preflight-execution-v1' as const;

export interface OllamaPreflightInvocation {
  readonly executableRealpath: string;
  readonly expectedExecutableSha256: string;
  readonly expectedExecutableSizeBytes: number;
  readonly approvedLoopbackEndpoint: string;
  readonly externalEgressControl: ExternalEgressControl;
}

export class OllamaPreflightInvocationError extends Error {
  constructor(readonly code: 'INVALID_INVOCATION') {
    super(code);
    this.name = 'OllamaPreflightInvocationError';
  }
}

function invalidInvocation(): never {
  throw new OllamaPreflightInvocationError('INVALID_INVOCATION');
}

export function parseOllamaPreflightInvocation(argv: readonly string[]): OllamaPreflightInvocation {
  const values = new Map<InvocationFlag, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      flag === undefined ||
      value === undefined ||
      !FLAGS.includes(flag as InvocationFlag) ||
      values.has(flag as InvocationFlag) ||
      flag.includes('=') ||
      value.startsWith('--')
    ) {
      invalidInvocation();
    }
    values.set(flag as InvocationFlag, value);
  }
  if (values.size !== FLAGS.length || FLAGS.some((flag) => !values.has(flag))) {
    invalidInvocation();
  }

  const executableRealpath = values.get('--executable-realpath') as string;
  const expectedExecutableSha256 = values.get('--expected-executable-sha256') as string;
  const sizeText = values.get('--expected-executable-size-bytes') as string;
  const approvedLoopbackEndpointInput = values.get('--approved-loopback-endpoint') as string;
  const controlText = values.get('--external-egress-control') as string;
  if (!isAbsolute(executableRealpath) || !/^[0-9a-f]{64}$/.test(expectedExecutableSha256)) {
    invalidInvocation();
  }
  if (!/^[1-9][0-9]*$/.test(sizeText)) invalidInvocation();
  const expectedExecutableSizeBytes = Number(sizeText);
  if (
    !Number.isSafeInteger(expectedExecutableSizeBytes) ||
    expectedExecutableSizeBytes <= 0 ||
    expectedExecutableSizeBytes > MAX_EXECUTABLE_BYTES
  ) {
    invalidInvocation();
  }
  let approvedLoopbackEndpoint: string;
  try {
    approvedLoopbackEndpoint = parseApprovedLoopbackEndpoint(approvedLoopbackEndpointInput);
  } catch {
    invalidInvocation();
  }
  if (!Object.values(ExternalEgressControl).includes(controlText as ExternalEgressControl)) {
    invalidInvocation();
  }
  return Object.freeze({
    executableRealpath,
    expectedExecutableSha256,
    expectedExecutableSizeBytes,
    approvedLoopbackEndpoint,
    externalEgressControl: controlText as ExternalEgressControl,
  });
}

export class NodeOllamaPreflightFileSystem implements OllamaPreflightFileSystem {
  realpath(path: string): string {
    return realpathSync(path);
  }

  stat(path: string): PreflightFileStat {
    const stat = statSync(path);
    return {
      kind: stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other',
      sizeBytes: stat.size,
      mode: stat.mode,
    };
  }

  *readChunks(path: string, maxBytes: number): Iterable<Uint8Array> {
    const descriptor = openSync(path, 'r');
    let observed = 0;
    try {
      while (observed <= maxBytes) {
        const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - observed + 1));
        const count = readSync(descriptor, buffer, 0, buffer.byteLength, null);
        if (count === 0) return;
        observed += count;
        yield buffer.subarray(0, count);
      }
    } finally {
      closeSync(descriptor);
    }
  }
}

export function createRunnerOwnedOllamaSandbox(): PreflightSandbox {
  const root = mkdtempSync(join(tmpdir(), 'chunsik-ollama-preflight-'));
  const home = join(root, 'home');
  const temporary = join(root, 'tmp');
  try {
    mkdirSync(home, { mode: 0o700 });
    mkdirSync(temporary, { mode: 0o700 });
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  let cleaned = false;
  return Object.freeze({
    home,
    tmpdir: temporary,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      rmSync(root, { recursive: true, force: true });
    },
  });
}

type SpawnAdapter = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface OllamaPreflightExecutionDependencies {
  readonly fileSystem?: OllamaPreflightFileSystem;
  readonly spawnAdapter?: SpawnAdapter;
  readonly sandboxFactory?: () => PreflightSandbox;
  readonly verifyOsDenied?: () => boolean;
  readonly writeProjection?: (projection: string) => void;
}

export interface OllamaPreflightExecutionOutcome {
  readonly exitCode: 0 | 2 | 3 | 4 | 5;
  readonly projection: Readonly<Record<string, unknown>>;
}

type EntrypointStatus =
  | 'ENTRYPOINT_CONFIGURATION_ERROR'
  | 'ENTRYPOINT_UNEXPECTED_FAILURE';

function entrypointProjection(
  status: EntrypointStatus,
  failureCode: 'INVALID_INVOCATION' | 'UNEXPECTED_ENTRYPOINT_FAILURE',
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    executionContractVersion: OLLAMA_PREFLIGHT_EXECUTION_CONTRACT_VERSION,
    contractVersion: OLLAMA_PREFLIGHT_CONTRACT_VERSION,
    parserContractVersion: OLLAMA_INVENTORY_PARSER_VERSION,
    executableIdentityContractVersion: OLLAMA_EXECUTABLE_IDENTITY_VERSION,
    commandPolicyVersion: OLLAMA_PREFLIGHT_COMMAND_POLICY_VERSION,
    status,
    failureCode,
    externalEgressControl: null,
    externalEgressIsolationVerified: false,
    networkClass: null,
    executableIdentityDigest: null,
    normalizedVersion: null,
    requiredModels: [],
    installedRequiredModels: [],
    missingRequiredModels: [],
    inventoryObserved: false,
    additionalModelCount: 0,
    providerExecutionCount: 0,
    downloadCapableCommandInvoked: false,
    downloadObserved: false,
    commandCount: 0,
    checks: [],
  });
}

function projectResult(result: OllamaPreflightResult): Readonly<Record<string, unknown>> {
  return Object.freeze({
    executionContractVersion: OLLAMA_PREFLIGHT_EXECUTION_CONTRACT_VERSION,
    contractVersion: result.contractVersion,
    parserContractVersion: result.parserContractVersion,
    executableIdentityContractVersion: result.executableIdentityContractVersion,
    commandPolicyVersion: result.commandPolicyVersion,
    status: result.status,
    failureCode: result.failureCode,
    externalEgressControl: result.externalEgressControl,
    externalEgressIsolationVerified: result.externalEgressIsolationVerified,
    networkClass: result.networkClass,
    executableIdentityDigest: result.executableIdentityDigest,
    normalizedVersion: result.normalizedVersion,
    requiredModels: result.requiredModels,
    installedRequiredModels: result.installedRequiredModels,
    missingRequiredModels: result.missingRequiredModels,
    inventoryObserved: result.inventoryObserved,
    additionalModelCount: result.additionalModelCount,
    providerExecutionCount: result.providerExecutionCount,
    downloadCapableCommandInvoked: result.downloadCapableCommandInvoked,
    downloadObserved: result.downloadObserved,
    commandCount: result.commandCount,
    checks: result.checks,
  });
}

function exitCodeFor(status: OllamaPreflightStatus): 0 | 2 | 3 {
  if (status === OllamaPreflightStatus.PASS) return 0;
  if (status === OllamaPreflightStatus.BLOCKED) return 3;
  return 2;
}

function configurationErrorProjection(): Readonly<Record<string, unknown>> {
  return entrypointProjection('ENTRYPOINT_CONFIGURATION_ERROR', 'INVALID_INVOCATION');
}

function unexpectedFailureProjection(): Readonly<Record<string, unknown>> {
  return entrypointProjection('ENTRYPOINT_UNEXPECTED_FAILURE', 'UNEXPECTED_ENTRYPOINT_FAILURE');
}

export async function executeOllamaPreflightInvocation(
  argv: readonly string[],
  dependencies: OllamaPreflightExecutionDependencies = {},
): Promise<OllamaPreflightExecutionOutcome> {
  const writeProjection = dependencies.writeProjection ?? ((projection) => process.stdout.write(`${projection}\n`));
  let projectionWritten = false;
  const writeOnce = (projection: Readonly<Record<string, unknown>>): void => {
    if (projectionWritten) return;
    projectionWritten = true;
    writeProjection(JSON.stringify(projection));
  };
  let invocation: OllamaPreflightInvocation;
  try {
    invocation = parseOllamaPreflightInvocation(argv);
  } catch (error) {
    if (!(error instanceof OllamaPreflightInvocationError)) {
      const projection = unexpectedFailureProjection();
      writeOnce(projection);
      return { exitCode: 5, projection };
    }
    const projection = configurationErrorProjection();
    writeOnce(projection);
    return { exitCode: 4, projection };
  }

  try {
    const fileSystem = dependencies.fileSystem ?? new NodeOllamaPreflightFileSystem();
    const spawnAdapter = dependencies.spawnAdapter ?? ((command, args, options) =>
      spawn(command, [...args], options));
    const sandboxFactory = dependencies.sandboxFactory ?? createRunnerOwnedOllamaSandbox;
    let externalEgressIsolationVerified = false;
    if (invocation.externalEgressControl === ExternalEgressControl.OS_DENIED_VERIFIED) {
      try {
        externalEgressIsolationVerified = dependencies.verifyOsDenied?.() === true;
      } catch {
        externalEgressIsolationVerified = false;
      }
    }
    const expectedExecutable: ApprovedOllamaExecutable = Object.freeze({
      realPath: invocation.executableRealpath,
      identity: Object.freeze({
        contractVersion: OLLAMA_EXECUTABLE_IDENTITY_VERSION,
        identityDigest: invocation.expectedExecutableSha256,
        sizeBytes: invocation.expectedExecutableSizeBytes,
        modeClass: 'EXECUTABLE',
        pathKind: 'ABSOLUTE_REALPATH',
      }),
    });
    const runner = new ContainedOllamaPreflightProcessRunner(spawnAdapter, sandboxFactory);
    const preflight = new OllamaInventoryPreflight(fileSystem, runner);
    const result = await preflight.execute({
      executablePath: invocation.executableRealpath,
      approvedExecutable: expectedExecutable,
      loopbackEndpoint: invocation.approvedLoopbackEndpoint,
      externalEgressControl: invocation.externalEgressControl,
      externalEgressIsolationVerified,
    });
    const projection = projectResult(result);
    writeOnce(projection);
    return { exitCode: exitCodeFor(result.status), projection };
  } catch (error) {
    if (projectionWritten) throw error;
    const projection = unexpectedFailureProjection();
    writeOnce(projection);
    return { exitCode: 5, projection };
  }
}

async function main(): Promise<void> {
  const outcome = await executeOllamaPreflightInvocation(process.argv.slice(2));
  process.exitCode = outcome.exitCode;
}

if (require.main === module) {
  void main().catch(() => {
    process.exitCode = 5;
  });
}
