import { ALLOWLIST_CONTRACT, TIER_A_COMMAND_IDS } from './allowlist';
import { canonicalize, sha256 } from './canonical';
import {
  APPROVAL_SYMBOL_NAMES,
  ApprovalSymbolName,
  ApprovalSymbolTable,
  AllowlistContract,
  AllowlistRecord,
  COMMAND_EVIDENCE_CONTRACT_VERSION,
  CommandEvidence,
  EVIDENCE_SCHEMA_VERSION,
  ExecutableIdentity,
  ExecutableIdentityVerifier,
  FixtureProcessResult,
  AllowedCommandExecutor,
  StopReason,
} from './contracts';

const SYMBOL_PREFIX = 'APPROVAL_BOUND_';

export class AllowlistError extends Error {
  constructor(readonly reason: StopReason) {
    super(reason);
  }
}

function resolveValue(value: unknown, symbols: ApprovalSymbolTable): unknown {
  if (typeof value === 'string') {
    if (!value.startsWith(SYMBOL_PREFIX)) return value;
    if (!APPROVAL_SYMBOL_NAMES.includes(value as ApprovalSymbolName)) throw new AllowlistError('ALLOWLIST_UNRESOLVED');
    const resolved = symbols[value as ApprovalSymbolName];
    if (resolved.length === 0 || resolved.startsWith(SYMBOL_PREFIX)) throw new AllowlistError('ALLOWLIST_UNRESOLVED');
    return resolved;
  }
  if (Array.isArray(value)) return value.map((entry) => resolveValue(entry, symbols));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveValue(entry, symbols)]));
  }
  return value;
}

export function resolveApprovalSymbols(contract: AllowlistContract, input: Readonly<Record<string, string>>): AllowlistContract {
  const keys = Object.keys(input).sort();
  if (keys.length !== APPROVAL_SYMBOL_NAMES.length || keys.some((key, index) => key !== [...APPROVAL_SYMBOL_NAMES].sort()[index])) {
    throw new AllowlistError('ALLOWLIST_UNRESOLVED');
  }
  return resolveValue(contract, input as ApprovalSymbolTable) as AllowlistContract;
}

export function validateContract(contract: AllowlistContract): void {
  const contractKeys = [
    'contractVersion', 'canonicalizationVersion', 'evidenceSchemaVersion', 'patternDialect',
    'patternDialectVersion', 'regexDocumentRepresentation', 'approvalBoundSymbolPolicyVersion',
    'rawOutputPolicyVersion', 'mismatchPolicyVersion', 'streamPrecedencePolicyVersion', 'records',
  ].sort();
  const recordKeys = [
    'commandId', 'executable', 'expectedRealpath', 'approvedExecutableIdentityContract', 'argv',
    'workingDirectory', 'environment', 'privilegeClass', 'localDaemonContact', 'networkPolicy',
    'processLifecyclePolicy', 'timeoutMs', 'stdoutMaxLines', 'stdoutMaxBytes', 'stderrMaxLines',
    'stderrMaxBytes', 'patternDialect', 'outputSchema', 'expectedNormalizedFacts', 'redactionPolicy',
    'stopConditions', 'evidenceClass', 'explicitDependencies',
  ].sort();
  if (Object.keys(contract).sort().some((key, index) => key !== contractKeys[index]) || Object.keys(contract).length !== contractKeys.length) {
    throw new Error('ALLOWLIST_CONTRACT_SCHEMA_MISMATCH');
  }
  if (contract.records.length !== 16) throw new Error('TIER_A_RECORD_COUNT_MISMATCH');
  const ids = contract.records.map((entry) => entry.commandId);
  if (new Set(ids).size !== ids.length || ids.some((id, index) => id !== TIER_A_COMMAND_IDS[index])) {
    throw new Error('TIER_A_COMMAND_ID_MISMATCH');
  }
  for (const record of contract.records) {
    if (Object.keys(record).sort().some((key, index) => key !== recordKeys[index]) || Object.keys(record).length !== recordKeys.length) {
      throw new Error('ALLOWLIST_RECORD_SCHEMA_MISMATCH');
    }
    if (Object.keys(record.outputSchema).sort().join(',') !== 'flags,kind,source') throw new Error('OUTPUT_SCHEMA_MISMATCH');
    if (record.localDaemonContact !== 'NONE') throw new Error('LOCAL_DAEMON_CONTACT_REJECTED');
    if (record.outputSchema.flags !== 'u' || record.patternDialect !== 'ECMASCRIPT_2023_UNICODE') {
      throw new Error('PATTERN_DIALECT_MISMATCH');
    }
  }
  const gitVersion = contract.records[0];
  const head = contract.records[2];
  const identities = contract.records[7];
  const gitVersionLine = String(gitVersion?.expectedNormalizedFacts.gitVersionLine);
  const headSha = String(head?.expectedNormalizedFacts.headSha);
  const architectureBlobId = String(identities?.expectedNormalizedFacts.architectureBlobId);
  if (gitVersion === undefined || gitVersion.outputSchema.kind !== 'PATTERN' ||
      (!gitVersionLine.startsWith(SYMBOL_PREFIX) &&
       !new RegExp(gitVersion.outputSchema.source, gitVersion.outputSchema.flags).test(gitVersionLine))) {
    throw new Error('APPROVAL_BOUND_GIT_VERSION_LINE_MISMATCH');
  }
  if ((!headSha.startsWith(SYMBOL_PREFIX) && !/^[0-9a-f]{40}$/.test(headSha)) ||
      (!architectureBlobId.startsWith(SYMBOL_PREFIX) && !/^[0-9a-f]{40}$/.test(architectureBlobId))) {
    throw new Error('APPROVAL_BOUND_IDENTITY_MISMATCH');
  }
}

export function createStaticAllowlistDigest(symbols: Readonly<Record<string, string>>): { readonly bytes: string; readonly digest: string; readonly contract: AllowlistContract } {
  const contract = resolveApprovalSymbols(ALLOWLIST_CONTRACT, symbols);
  validateContract(contract);
  const bytes = canonicalize(contract);
  if (bytes.includes(SYMBOL_PREFIX)) throw new AllowlistError('ALLOWLIST_UNRESOLVED');
  return Object.freeze({ bytes, digest: sha256(bytes), contract });
}

export function dependenciesSatisfied(record: AllowlistRecord, satisfied: ReadonlySet<string>): boolean {
  return record.explicitDependencies.every((dependency) => satisfied.has(dependency));
}

/** Fixture-only adapter. It returns preloaded bytes and never imports or invokes a host process API. */
export class FixtureAllowedCommandExecutor implements AllowedCommandExecutor {
  invocationCount = 0;

  constructor(private readonly results: Readonly<Record<string, FixtureProcessResult>>) {}

  execute(record: AllowlistRecord): Promise<FixtureProcessResult> {
    const result = this.results[record.commandId];
    if (result === undefined) return Promise.reject(new Error('FIXTURE_RESULT_MISSING'));
    this.invocationCount += 1;
    return Promise.resolve(result);
  }
}

export function createExecutionBaselineBindingDigest(binding: import('./contracts').ExecutionBaselineBinding): string {
  return sha256(canonicalize(binding));
}

export function createDocumentBlobBindingDigest(binding: import('./contracts').DocumentBlobBinding): string {
  return sha256(canonicalize(binding));
}

export function isDispatchable(record: AllowlistRecord, satisfied: ReadonlySet<string>): { readonly dispatchable: boolean; readonly reason: StopReason } {
  if (!satisfied.has('SYMBOL_TABLE:RESOLVED')) return { dispatchable: false, reason: 'ALLOWLIST_UNRESOLVED' };
  if (!dependenciesSatisfied(record, satisfied)) return { dispatchable: false, reason: 'GIT_IDENTITY_NOT_ESTABLISHED' };
  return { dispatchable: true, reason: 'NONE' };
}

export interface FixtureEvaluation {
  readonly record: AllowlistRecord;
  readonly processResult: FixtureProcessResult;
  readonly identityVerifier?: ExecutableIdentityVerifier;
  readonly approvedIdentity: ExecutableIdentity;
  readonly satisfiedDependencies: ReadonlySet<string>;
  readonly normalizedFacts: Readonly<Record<string, string | number | boolean>>;
  readonly schemaValid: boolean;
  readonly allowlistDigest: string;
  readonly repositoryHead: string;
  readonly observedAt: string;
}

function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n|\r/g, '\n');
  } catch {
    throw new AllowlistError('INVALID_UTF8');
  }
}

function lineCount(value: string): number {
  if (value.length === 0) return 0;
  const parts = value.split('\n');
  return parts.at(-1) === '' ? parts.length - 1 : parts.length;
}

function identityMatches(left: ExecutableIdentity, right: ExecutableIdentity): boolean {
  return canonicalize(left) === canonicalize(right);
}

function failure(input: FixtureEvaluation, identity: ExecutableIdentity, exitClass: CommandEvidence['exitClass'], stopReason: StopReason, stdoutBytes: number, stderrBytes: number, truncated = false): CommandEvidence {
  return evidence(input, identity, exitClass, stopReason, stdoutBytes, stderrBytes, {}, truncated, 'REJECTED');
}

function evidence(input: FixtureEvaluation, identity: ExecutableIdentity, exitClass: CommandEvidence['exitClass'], stopReason: StopReason, stdoutBytes: number, stderrBytes: number, facts: Readonly<Record<string, string | number | boolean>>, outputTruncated: boolean, normalizationResult: CommandEvidence['normalizationResult']): CommandEvidence {
  return Object.freeze({
    contractVersion: COMMAND_EVIDENCE_CONTRACT_VERSION,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    allowlistDigest: input.allowlistDigest,
    commandId: input.record.commandId,
    executableRealpath: identity.realpath,
    executableIdentity: identity,
    argvDigest: sha256(canonicalize(input.record.argv)),
    workingDirectory: input.record.workingDirectory,
    repositoryBranch: 'main',
    repositoryHead: input.repositoryHead,
    privilegeClass: input.record.privilegeClass,
    localDaemonContact: input.record.localDaemonContact,
    exitClass,
    stopReason,
    stdoutByteCount: stdoutBytes,
    stderrByteCount: stderrBytes,
    normalizedFacts: Object.freeze({ ...facts }),
    redactionCount: 0,
    outputTruncated,
    normalizationResult,
    evidenceClass: input.record.evidenceClass,
    observedAt: input.observedAt,
  });
}

export function evaluateFixture(input: FixtureEvaluation): CommandEvidence {
  const dependency = isDispatchable(input.record, input.satisfiedDependencies);
  if (!dependency.dispatchable) return failure(input, input.approvedIdentity, dependency.reason === 'ALLOWLIST_UNRESOLVED' ? 'ALLOWLIST_UNRESOLVED' : 'EXECUTABLE_MISMATCH', dependency.reason, 0, 0);
  if (input.identityVerifier === undefined) return failure(input, input.approvedIdentity, 'COMMAND_SAFETY_BLOCKED', 'COMMAND_SAFETY_BLOCKED', 0, 0);
  const identity = input.identityVerifier.verify(input.record);
  if (identity === undefined || !identityMatches(identity, input.approvedIdentity) || identity.realpath !== input.record.expectedRealpath) {
    return failure(input, identity ?? input.approvedIdentity, 'EXECUTABLE_MISMATCH', 'EXECUTABLE_MISMATCH', 0, 0);
  }

  const stdoutBytes = input.processResult.stdout.byteLength;
  const stderrBytes = input.processResult.stderr.byteLength;
  let stdout: string;
  let stderr: string;
  try {
    stdout = decode(input.processResult.stdout);
    stderr = decode(input.processResult.stderr);
  } catch (error) {
    return failure(input, identity, 'SCHEMA_MISMATCH', error instanceof AllowlistError ? error.reason : 'INVALID_UTF8', stdoutBytes, stderrBytes);
  }
  const stdoutExceeded = stdoutBytes > input.record.stdoutMaxBytes || lineCount(stdout) > input.record.stdoutMaxLines;
  const stderrExceeded = stderrBytes > input.record.stderrMaxBytes || lineCount(stderr) > input.record.stderrMaxLines;
  if (stdoutExceeded && stderrExceeded) return failure(input, identity, 'OUTPUT_LIMIT_EXCEEDED', 'BOTH_STREAM_OUTPUT_LIMIT_EXCEEDED', stdoutBytes, stderrBytes, true);
  if (stderrExceeded) return failure(input, identity, 'OUTPUT_LIMIT_EXCEEDED', 'STDERR_OUTPUT_LIMIT_EXCEEDED', stdoutBytes, stderrBytes, true);
  if (stdoutExceeded) return failure(input, identity, 'OUTPUT_LIMIT_EXCEEDED', 'STDOUT_OUTPUT_LIMIT_EXCEEDED', stdoutBytes, stderrBytes, true);
  if (stderrBytes > 0) return failure(input, identity, 'STDERR_NONEMPTY', 'STDERR_NONEMPTY', stdoutBytes, stderrBytes);
  if (input.processResult.exitCode !== 0) return failure(input, identity, 'EXECUTION_ERROR', 'NONZERO_EXIT', stdoutBytes, stderrBytes);

  if (input.record.outputSchema.kind === 'PATTERN') {
    const pattern = new RegExp(input.record.outputSchema.source, input.record.outputSchema.flags);
    if (!pattern.test(stdout)) return failure(input, identity, 'SCHEMA_MISMATCH', 'PATTERN_MISMATCH', stdoutBytes, stderrBytes);
  } else if (!input.schemaValid) {
    return failure(input, identity, 'SCHEMA_MISMATCH', 'SCHEMA_MISMATCH', stdoutBytes, stderrBytes);
  }
  if (canonicalize(input.normalizedFacts) !== canonicalize(input.record.expectedNormalizedFacts)) {
    return failure(input, identity, 'SCHEMA_MISMATCH', 'NORMALIZATION_FAILED', stdoutBytes, stderrBytes);
  }
  return evidence(input, identity, 'SUCCESS', 'NONE', stdoutBytes, stderrBytes, input.normalizedFacts, false, 'SUCCESS');
}

const EVIDENCE_KEYS = Object.freeze([
  'contractVersion', 'schemaVersion', 'allowlistDigest', 'commandId', 'executableRealpath',
  'executableIdentity', 'argvDigest', 'workingDirectory', 'repositoryBranch', 'repositoryHead',
  'privilegeClass', 'localDaemonContact', 'exitClass', 'stopReason', 'stdoutByteCount',
  'stderrByteCount', 'normalizedFacts', 'redactionCount', 'outputTruncated', 'normalizationResult',
  'evidenceClass', 'observedAt',
].sort());

export function assertClosedEvidence(value: Readonly<Record<string, unknown>>): void {
  const keys = Object.keys(value).sort();
  if (keys.length !== EVIDENCE_KEYS.length || keys.some((key, index) => key !== EVIDENCE_KEYS[index])) {
    throw new Error('EVIDENCE_UNKNOWN_FIELD');
  }
}
