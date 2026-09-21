import {
  INVENTORY_STDOUT_LIMIT,
  INVENTORY_TIMEOUT_MS,
  OLLAMA_EXECUTABLE_IDENTITY_VERSION,
  OLLAMA_INVENTORY_PARSER_VERSION,
  OLLAMA_PREFLIGHT_COMMAND_POLICY_VERSION,
  OLLAMA_PREFLIGHT_CONTRACT_VERSION,
  OVERALL_TIMEOUT_MS,
  ExternalEgressControl,
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
  OllamaPreflightNetworkClass,
  OllamaPreflightResult,
} from './contracts';
import {
  assertOllamaExecutableIdentity,
} from './executable-identity';
import type { OllamaPreflightFileSystem } from './executable-identity';
import { parseOllamaInventory, parseOllamaVersion } from './parsers';
import { argvFor, parseApprovedLoopbackEndpoint } from './policy';
import type {
  OllamaPreflightProcessResult,
  OllamaPreflightProcessRunner,
} from './process-runner';

export interface OllamaPreflightRequest {
  readonly executablePath: string;
  readonly approvedExecutable: ApprovedOllamaExecutable;
  readonly loopbackEndpoint: string;
  readonly externalEgressControl: ExternalEgressControl;
  readonly externalEgressIsolationVerified: boolean;
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
    let inventoryFingerprint: string | null = null;
    let downloadObserved = false;
    let networkClass: OllamaPreflightNetworkClass | null = null;
    let externalEgressControl: ExternalEgressControl | null = null;
    let externalEgressIsolationVerified = false;
    try {
      const egress = this.validateEgressControl(
        request.externalEgressControl,
        request.externalEgressIsolationVerified,
      );
      externalEgressControl = egress.control;
      externalEgressIsolationVerified = egress.isolationVerified;
      const approvedLoopbackEndpoint = parseApprovedLoopbackEndpoint(request.loopbackEndpoint);
      const executable = assertOllamaExecutableIdentity(
        request.approvedExecutable, request.executablePath, this.fileSystem,
      );
      const versionBudget = Math.min(VERSION_TIMEOUT_MS, this.remainingBudget(startedAt));
      if (versionBudget <= 0) throw new OllamaPreflightError(OllamaPreflightFailureCode.TIMEOUT);
      const version = await this.processRunner.run({
        executable, category: OllamaPreflightCommandCategory.VERSION,
        argv: argvFor(OllamaPreflightCommandCategory.VERSION), approvedLoopbackEndpoint,
        timeoutMs: versionBudget, stdoutLimitBytes: VERSION_STDOUT_LIMIT,
        stderrLimitBytes: STDERR_LIMIT,
      });
      networkClass = version.networkClass;
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
        argv: argvFor(OllamaPreflightCommandCategory.INVENTORY), approvedLoopbackEndpoint,
        timeoutMs: inventoryBudget, stdoutLimitBytes: INVENTORY_STDOUT_LIMIT,
        stderrLimitBytes: STDERR_LIMIT,
      });
      networkClass = inventory.networkClass;
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
      inventoryFingerprint = parsed.inventoryFingerprint;
      if (missing.length > 0) {
        throw new OllamaPreflightError(OllamaPreflightFailureCode.REQUIRED_MODEL_MISSING);
      }
      return this.result(OllamaPreflightStatus.PASS, null, identityDigest, normalizedVersion,
        installed, missing, inventoryObserved, additionalModelCount, inventoryFingerprint, downloadObserved,
        externalEgressControl, externalEgressIsolationVerified, networkClass, checks);
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
        additionalModelCount, inventoryFingerprint, downloadObserved, externalEgressControl,
        externalEgressIsolationVerified, networkClass, checks);
    }
  }

  private processFailure(
    result: OllamaPreflightProcessResult,
    commandFailure: OllamaPreflightFailureCode,
  ): OllamaPreflightFailureCode | null {
    if (result.downloadObserved) return OllamaPreflightFailureCode.MODEL_DOWNLOAD_DETECTED;
    if (result.cleanupFailed || result.spawnFailed || result.containmentFailed) {
      return OllamaPreflightFailureCode.PROCESS_CONTAINMENT_FAILED;
    }
    if (result.timedOut) return OllamaPreflightFailureCode.TIMEOUT;
    if (result.outputLimited) return OllamaPreflightFailureCode.OUTPUT_LIMIT_EXCEEDED;
    if (result.exitCode !== 0) return commandFailure;
    return null;
  }

  private remainingBudget(startedAt: number): number {
    return Math.max(0, OVERALL_TIMEOUT_MS - Math.max(0, this.nowMs() - startedAt));
  }

  private validateEgressControl(
    control: ExternalEgressControl,
    isolationVerified: boolean,
  ): { readonly control: ExternalEgressControl; readonly isolationVerified: boolean } {
    if (
      control === ExternalEgressControl.OS_DENIED_VERIFIED &&
      isolationVerified === true
    ) {
      return { control, isolationVerified: true };
    }
    if (
      control === ExternalEgressControl.CONFIG_RESTRICTED_RISK_ACCEPTED &&
      isolationVerified === false
    ) {
      return { control, isolationVerified: false };
    }
    throw new OllamaPreflightError(OllamaPreflightFailureCode.NETWORK_CONTAINMENT_UNAVAILABLE);
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
    inventoryFingerprint: string | null,
    downloadObserved: boolean,
    externalEgressControl: ExternalEgressControl | null,
    externalEgressIsolationVerified: boolean,
    networkClass: OllamaPreflightNetworkClass | null,
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
      inventoryObserved, additionalModelCount, inventoryFingerprint,
      downloadCapableCommandInvoked: false,
      downloadObserved, externalEgressControl, externalEgressIsolationVerified, networkClass,
      providerExecutionCount: 0, commandCount: checks.length,
      checks: Object.freeze([...checks]),
    });
  }
}
