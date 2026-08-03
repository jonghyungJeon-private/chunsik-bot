export const OLLAMA_PREFLIGHT_CONTRACT_VERSION = 'stage2b-ollama-preflight-v1' as const;
export const OLLAMA_INVENTORY_PARSER_VERSION = 'stage2b-ollama-inventory-parser-v1' as const;
export const OLLAMA_EXECUTABLE_IDENTITY_VERSION = 'stage2b-ollama-executable-identity-v1' as const;
export const OLLAMA_PREFLIGHT_COMMAND_POLICY_VERSION =
  'stage2b-ollama-preflight-command-policy-v1' as const;

export const REQUIRED_OLLAMA_MODELS = Object.freeze(['llama3.1:8b', 'granite3.3:8b'] as const);
export const VERSION_TIMEOUT_MS = 5_000;
export const INVENTORY_TIMEOUT_MS = 10_000;
export const OVERALL_TIMEOUT_MS = 20_000;
export const VERSION_STDOUT_LIMIT = 4 * 1024;
export const INVENTORY_STDOUT_LIMIT = 64 * 1024;
export const STDERR_LIMIT = 8 * 1024;
export const MAX_INVENTORY_ROWS = 512;
export const MAX_EXECUTABLE_BYTES = 1024 * 1024 * 1024;
export const KILL_GRACE_MS = 1_000;
export const FINAL_SETTLEMENT_EPSILON_MS = 100;

export enum OllamaPreflightStatus {
  PASS = 'PASS',
  FAIL = 'FAIL',
  BLOCKED = 'BLOCKED',
}

export enum OllamaPreflightFailureCode {
  INVALID_PREFLIGHT_CONFIGURATION = 'INVALID_PREFLIGHT_CONFIGURATION',
  EXECUTABLE_NOT_FOUND = 'EXECUTABLE_NOT_FOUND',
  EXECUTABLE_NOT_RUNNABLE = 'EXECUTABLE_NOT_RUNNABLE',
  EXECUTABLE_IDENTITY_MISMATCH = 'EXECUTABLE_IDENTITY_MISMATCH',
  VERSION_CHECK_FAILED = 'VERSION_CHECK_FAILED',
  VERSION_OUTPUT_INVALID = 'VERSION_OUTPUT_INVALID',
  INVENTORY_CHECK_FAILED = 'INVENTORY_CHECK_FAILED',
  INVENTORY_OUTPUT_INVALID = 'INVENTORY_OUTPUT_INVALID',
  REQUIRED_MODEL_MISSING = 'REQUIRED_MODEL_MISSING',
  MODEL_DOWNLOAD_DETECTED = 'MODEL_DOWNLOAD_DETECTED',
  LOCAL_DAEMON_UNAVAILABLE = 'LOCAL_DAEMON_UNAVAILABLE',
  REMOTE_HOST_CONFIGURATION_DETECTED = 'REMOTE_HOST_CONFIGURATION_DETECTED',
  NETWORK_CONTAINMENT_UNAVAILABLE = 'NETWORK_CONTAINMENT_UNAVAILABLE',
  TIMEOUT = 'TIMEOUT',
  OUTPUT_LIMIT_EXCEEDED = 'OUTPUT_LIMIT_EXCEEDED',
  INVALID_UTF8 = 'INVALID_UTF8',
  PROCESS_CONTAINMENT_FAILED = 'PROCESS_CONTAINMENT_FAILED',
  UNEXPECTED_FAILURE = 'UNEXPECTED_FAILURE',
}

export enum OllamaPreflightCommandCategory {
  VERSION = 'VERSION',
  INVENTORY = 'INVENTORY',
}

export enum ExternalEgressControl {
  OS_DENIED_VERIFIED = 'OS_DENIED_VERIFIED',
  CONFIG_RESTRICTED_RISK_ACCEPTED = 'CONFIG_RESTRICTED_RISK_ACCEPTED',
}

/**
 * Classifies validated endpoint/environment configuration only. It does not attest to observed
 * connectivity, command success, process-containment success, or external-egress denial.
 */
export type OllamaPreflightNetworkClass = 'LOOPBACK_DAEMON';

export interface OllamaExecutableIdentity {
  readonly contractVersion: typeof OLLAMA_EXECUTABLE_IDENTITY_VERSION;
  readonly identityDigest: string;
  readonly sizeBytes: number;
  readonly modeClass: 'EXECUTABLE';
  readonly pathKind: 'ABSOLUTE_REALPATH';
}

/** Internal approved target. The real path must never enter the public result. */
export interface ApprovedOllamaExecutable {
  readonly realPath: string;
  readonly identity: OllamaExecutableIdentity;
}

export interface OllamaPreflightCheck {
  readonly category: OllamaPreflightCommandCategory;
  readonly status: 'PASS' | 'FAIL' | 'BLOCKED';
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly durationMs: number;
}

export interface OllamaPreflightResult {
  readonly contractVersion: typeof OLLAMA_PREFLIGHT_CONTRACT_VERSION;
  readonly parserContractVersion: typeof OLLAMA_INVENTORY_PARSER_VERSION;
  readonly executableIdentityContractVersion: typeof OLLAMA_EXECUTABLE_IDENTITY_VERSION;
  readonly commandPolicyVersion: typeof OLLAMA_PREFLIGHT_COMMAND_POLICY_VERSION;
  readonly status: OllamaPreflightStatus;
  readonly failureCode: OllamaPreflightFailureCode | null;
  readonly executableIdentityDigest: string | null;
  readonly normalizedVersion: string | null;
  readonly requiredModels: readonly string[];
  readonly installedRequiredModels: readonly string[];
  readonly missingRequiredModels: readonly string[];
  readonly inventoryObserved: boolean;
  readonly additionalModelCount: number;
  readonly downloadCapableCommandInvoked: false;
  readonly downloadObserved: boolean;
  readonly externalEgressControl: ExternalEgressControl | null;
  readonly externalEgressIsolationVerified: boolean;
  readonly networkClass: OllamaPreflightNetworkClass | null;
  readonly providerExecutionCount: 0;
  readonly commandCount: number;
  readonly checks: readonly OllamaPreflightCheck[];
}

export class OllamaPreflightError extends Error {
  constructor(readonly code: OllamaPreflightFailureCode) {
    super(code);
    this.name = 'OllamaPreflightError';
  }
}
