import {
  INVENTORY_STDOUT_LIMIT,
  INVENTORY_TIMEOUT_MS,
  OLLAMA_EXECUTABLE_IDENTITY_VERSION,
  OLLAMA_INVENTORY_PARSER_VERSION,
  OLLAMA_PREFLIGHT_COMMAND_POLICY_VERSION,
  OLLAMA_PREFLIGHT_CONTRACT_VERSION,
  OVERALL_TIMEOUT_MS,
  OllamaPreflightCommandCategory,
  OllamaPreflightError,
  OllamaPreflightFailureCode,
  OllamaPreflightStatus,
  REQUIRED_OLLAMA_MODELS,
  STDERR_LIMIT,
  VERSION_STDOUT_LIMIT,
  VERSION_TIMEOUT_MS,
} from './contracts';
import type {
  ApprovedOllamaExecutable,
  OllamaPreflightCheck,
  OllamaPreflightResult,
} from './contracts';
import {
  assertOllamaExecutableIdentity,
} from './executable-identity';
import type { OllamaPreflightFileSystem } from './executable-identity';
import { parseOllamaInventory, parseOllamaVersion } from './parsers';
import { argvFor, buildIsolatedOllamaEnvironment } from './policy';
import type {
  OllamaPreflightProcessResult,
  OllamaPreflightProcessRunner,
} from './process-runner';

export interface OllamaPreflightRequest {
  readonly executablePath: string;
  readonly approvedExecutable: ApprovedOllamaExecutable;
  readonly loopbackEndpoint: string;
  readonly sandboxHome: string;
  readonly sandboxTmpdir: string;
  readonly externalEgressDenied: boolean;
}

const blockedCodes = new Set<OllamaPreflightFailureCode>([
  OllamaPreflightFailureCode.INVALID_PREFLIGHT_CONFIGURATION,
  OllamaPreflightFailureCode.EXECUTABLE_IDENTITY_MISMATCH,
  OllamaPreflightFailureCode.REMOTE_HOST_CONFIGURATION_DETECTED,
  OllamaPreflightFailureCode.NETWORK_CONTAINMENT_UNAVAILABLE,
  OllamaPreflightFailureCode.PROCESS_CONTAINMENT_FAILED,
  OllamaPreflightFailureCode.MODEL_DOWNLOAD_DETECTED,
]);

function checkOf(
  category: OllamaPreflightCommandCategory,
  result: OllamaPreflightProcessResult,
  status: OllamaPreflightCheck['status'],
): OllamaPreflightCheck {
  return Object.freeze({
    category, status, exitCode: result.exitCode, timedOut: result.timedOut,
    stdoutBytes: result.stdoutBytes, stderrBytes: result.stderrBytes,
    stdoutSha256: result.stdoutSha256, stderrSha256: result.stderrSha256,
    durationMs: result.durationMs,
  });
}

export class OllamaInventoryPreflight {
  constructor(
    private readonly fileSystem: OllamaPreflightFileSystem,
    private readonly processRunner: OllamaPreflightProcessRunner,
    private readonly nowMs: () => number = Date.now,
  ) {}

  async execute(request: OllamaPreflightRequest): Promise<OllamaPreflightResult> {
    const startedAt = this.nowMs();
    let identityDigest: string | null = request.approvedExecutable.identity.identityDigest;
    const checks: OllamaPreflightCheck[] = [];
    let normalizedVersion: string | null = null;
    let installed: readonly string[] = [];
    let missing: readonly string[] = REQUIRED_OLLAMA_MODELS;
    let inventoryObserved = false;
    let additionalModelCount = 0;
    let downloadObserved = false;
    try {
      if (!request.externalEgressDenied) {
        throw new OllamaPreflightError(OllamaPreflightFailureCode.NETWORK_CONTAINMENT_UNAVAILABLE);
      }
      const environment = buildIsolatedOllamaEnvironment({
        home: request.sandboxHome,
        tmpdir: request.sandboxTmpdir,
        loopbackEndpoint: request.loopbackEndpoint,
      });
      const executable = assertOllamaExecutableIdentity(
        request.approvedExecutable, request.executablePath, this.fileSystem,
      );
      const versionBudget = Math.min(VERSION_TIMEOUT_MS, this.remainingBudget(startedAt));
      if (versionBudget <= 0) throw new OllamaPreflightError(OllamaPreflightFailureCode.TIMEOUT);
      const version = await this.processRunner.run({
        executable, category: OllamaPreflightCommandCategory.VERSION,
        argv: argvFor(OllamaPreflightCommandCategory.VERSION), environment,
        timeoutMs: versionBudget, stdoutLimitBytes: VERSION_STDOUT_LIMIT,
        stderrLimitBytes: STDERR_LIMIT, networkClass: 'LOOPBACK_DAEMON',
      });
      downloadObserved ||= version.downloadObserved;
      const versionFailure = this.processFailure(version, OllamaPreflightFailureCode.VERSION_CHECK_FAILED);
      if (versionFailure !== null) {
        checks.push(checkOf(OllamaPreflightCommandCategory.VERSION, version, blockedCodes.has(versionFailure) ? 'BLOCKED' : 'FAIL'));
        throw new OllamaPreflightError(versionFailure);
      }
      checks.push(checkOf(OllamaPreflightCommandCategory.VERSION, version, 'PASS'));
      normalizedVersion = parseOllamaVersion(version.stdout, version.stderr);

      const revalidated = assertOllamaExecutableIdentity(
        request.approvedExecutable, request.executablePath, this.fileSystem,
      );
      const inventoryBudget = Math.min(INVENTORY_TIMEOUT_MS, this.remainingBudget(startedAt));
      if (inventoryBudget <= 0) throw new OllamaPreflightError(OllamaPreflightFailureCode.TIMEOUT);
      const inventory = await this.processRunner.run({
        executable: revalidated, category: OllamaPreflightCommandCategory.INVENTORY,
        argv: argvFor(OllamaPreflightCommandCategory.INVENTORY), environment,
        timeoutMs: inventoryBudget, stdoutLimitBytes: INVENTORY_STDOUT_LIMIT,
        stderrLimitBytes: STDERR_LIMIT, networkClass: 'LOOPBACK_DAEMON',
      });
      downloadObserved ||= inventory.downloadObserved;
      const inventoryFailure = this.processFailure(inventory, OllamaPreflightFailureCode.INVENTORY_CHECK_FAILED);
      if (inventoryFailure !== null) {
        checks.push(checkOf(OllamaPreflightCommandCategory.INVENTORY, inventory, blockedCodes.has(inventoryFailure) ? 'BLOCKED' : 'FAIL'));
        throw new OllamaPreflightError(inventoryFailure);
      }
      checks.push(checkOf(OllamaPreflightCommandCategory.INVENTORY, inventory, 'PASS'));
      const parsed = parseOllamaInventory(inventory.stdout);
      inventoryObserved = true;
      installed = parsed.installedRequiredModels;
      missing = parsed.missingRequiredModels;
      additionalModelCount = parsed.additionalModelCount;
      if (missing.length > 0) {
        throw new OllamaPreflightError(OllamaPreflightFailureCode.REQUIRED_MODEL_MISSING);
      }
      return this.result(OllamaPreflightStatus.PASS, null, identityDigest, normalizedVersion,
        installed, missing, inventoryObserved, additionalModelCount, downloadObserved, checks);
    } catch (error) {
      const code = error instanceof OllamaPreflightError
        ? error.code : OllamaPreflightFailureCode.UNEXPECTED_FAILURE;
      if (
        checks.length > 0 &&
        [
          OllamaPreflightFailureCode.INVALID_UTF8,
          OllamaPreflightFailureCode.VERSION_OUTPUT_INVALID,
          OllamaPreflightFailureCode.INVENTORY_OUTPUT_INVALID,
        ].includes(code)
      ) {
        const last = checks.pop() as OllamaPreflightCheck;
        checks.push(Object.freeze({ ...last, status: 'FAIL' }));
      }
      return this.result(blockedCodes.has(code) ? OllamaPreflightStatus.BLOCKED : OllamaPreflightStatus.FAIL,
        code, identityDigest, normalizedVersion, installed, missing, inventoryObserved,
        additionalModelCount, downloadObserved, checks);
    }
  }

  private processFailure(
    result: OllamaPreflightProcessResult,
    commandFailure: OllamaPreflightFailureCode,
  ): OllamaPreflightFailureCode | null {
    if (result.downloadObserved) return OllamaPreflightFailureCode.MODEL_DOWNLOAD_DETECTED;
    if (result.cleanupFailed || result.spawnFailed) return OllamaPreflightFailureCode.PROCESS_CONTAINMENT_FAILED;
    if (result.timedOut) return OllamaPreflightFailureCode.TIMEOUT;
    if (result.outputLimited) return OllamaPreflightFailureCode.OUTPUT_LIMIT_EXCEEDED;
    if (result.exitCode !== 0) return commandFailure;
    return null;
  }

  private remainingBudget(startedAt: number): number {
    return Math.max(0, OVERALL_TIMEOUT_MS - Math.max(0, this.nowMs() - startedAt));
  }

  private result(
    status: OllamaPreflightStatus,
    failureCode: OllamaPreflightFailureCode | null,
    executableIdentityDigest: string | null,
    normalizedVersion: string | null,
    installedRequiredModels: readonly string[],
    missingRequiredModels: readonly string[],
    inventoryObserved: boolean,
    additionalModelCount: number,
    downloadObserved: boolean,
    checks: readonly OllamaPreflightCheck[],
  ): OllamaPreflightResult {
    return Object.freeze({
      contractVersion: OLLAMA_PREFLIGHT_CONTRACT_VERSION,
      parserContractVersion: OLLAMA_INVENTORY_PARSER_VERSION,
      executableIdentityContractVersion: OLLAMA_EXECUTABLE_IDENTITY_VERSION,
      commandPolicyVersion: OLLAMA_PREFLIGHT_COMMAND_POLICY_VERSION,
      status, failureCode, executableIdentityDigest, normalizedVersion,
      requiredModels: REQUIRED_OLLAMA_MODELS,
      installedRequiredModels: Object.freeze([...installedRequiredModels]),
      missingRequiredModels: Object.freeze([...missingRequiredModels]),
      inventoryObserved, additionalModelCount,
      downloadCapableCommandInvoked: false,
      downloadObserved, networkClass: 'LOOPBACK_DAEMON',
      providerExecutionCount: 0, commandCount: checks.length,
      checks: Object.freeze([...checks]),
    });
  }
}
