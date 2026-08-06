import { ALLOWLIST_CONTRACT, TIER_A_COMMAND_IDS } from './allowlist';
import { canonicalize, sha256 } from './canonical';
import {
  APPROVAL_SYMBOL_NAMES,
  AllowedCommandExecutor,
  ApprovalSymbolName,
  ApprovalSymbolTable,
  AllowlistContract,
  AllowlistRecord,
  COMMAND_EVIDENCE_CONTRACT_VERSION,
  CommandEvidence,
  DocumentBlobBinding,
  EVIDENCE_SCHEMA_VERSION,
  ExecutableIdentity,
  ExecutableIdentityVerifier,
  ExecutionBaselineBinding,
  FixtureProcessResult,
  StopReason,
} from './contracts';

const SYMBOL_PREFIX = 'APPROVAL_BOUND_';
const RESOLUTION_BRAND = new WeakSet<object>();
const DEPENDENCY_STATE_BRAND = new WeakSet<object>();

export class AllowlistError extends Error {
  constructor(readonly reason: StopReason) {
    super(reason);
  }
}

export interface SymbolResolutionResult {
  readonly contract: AllowlistContract;
}

export interface DependencyState {
  readonly established: readonly string[];
  readonly allowlistDigest: string;
  readonly repositoryHead: string;
  readonly workingDirectory: string;
  readonly executionBaselineDigest: string;
  readonly sequencerRunId: string;
  readonly sequenceIndex: number;
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
  return resolveApprovalSymbolsClosed(contract, input).contract;
}

export function resolveApprovalSymbolsClosed(contract: AllowlistContract, input: Readonly<Record<string, string>>): SymbolResolutionResult {
  const expected = [...APPROVAL_SYMBOL_NAMES].sort();
  const keys = Object.keys(input).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new AllowlistError('ALLOWLIST_UNRESOLVED');
  }
  const result = Object.freeze({ contract: resolveValue(contract, input as ApprovalSymbolTable) as AllowlistContract });
  RESOLUTION_BRAND.add(result);
  return result;
}

const CONTRACT_KEYS = Object.freeze([
  'contractVersion', 'canonicalizationVersion', 'evidenceSchemaVersion', 'patternDialect',
  'patternDialectVersion', 'regexDocumentRepresentation', 'approvalBoundSymbolPolicyVersion',
  'rawOutputPolicyVersion', 'mismatchPolicyVersion', 'streamPrecedencePolicyVersion', 'commandOrderVersion', 'records',
].sort());
const RECORD_KEYS = Object.freeze([
  'approvalStatus', 'commandId', 'executable', 'expectedRealpath', 'approvedExecutableIdentityContract', 'argv',
  'workingDirectory', 'environment', 'privilegeClass', 'localDaemonContact', 'networkPolicy',
  'processLifecyclePolicy', 'timeoutMs', 'stdoutMaxLines', 'stdoutMaxBytes', 'stderrMaxLines',
  'stderrMaxBytes', 'patternDialect', 'outputSchema', 'expectedNormalizedFacts', 'redactionPolicy',
  'stopConditions', 'evidenceClass', 'explicitDependencies',
].sort());

function exactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function validateDependencyGraph(records: readonly AllowlistRecord[]): void {
  const ids = new Set(records.map((record) => record.commandId));
  const edges = new Map<string, readonly string[]>();
  for (const record of records) {
    const dependencies = record.explicitDependencies;
    if (new Set(dependencies).size !== dependencies.length) throw new Error('DUPLICATE_DEPENDENCY');
    if (dependencies[0] !== 'SYMBOL_TABLE:RESOLVED') throw new Error('SYMBOL_DEPENDENCY_REQUIRED');
    const commandDependencies = dependencies.slice(1).map((dependency) => {
      const match = /^(.+):SUCCESS$/.exec(dependency);
      if (match === null || !ids.has(match[1] ?? '')) throw new Error('UNKNOWN_DEPENDENCY');
      if (match[1] === record.commandId) throw new Error('SELF_DEPENDENCY');
      return match[1] ?? '';
    });
    edges.set(record.commandId, commandDependencies);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (id: string): void => {
    if (visiting.has(id)) throw new Error('DEPENDENCY_CYCLE');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of edges.get(id) ?? []) walk(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) walk(id);
}

export function validateContract(contract: AllowlistContract): void {
  if (!exactKeys(contract, CONTRACT_KEYS)) throw new Error('ALLOWLIST_CONTRACT_SCHEMA_MISMATCH');
  if (contract.contractVersion !== 'stage2b-5c-eg-f0-allowlist-v2' ||
      contract.canonicalizationVersion !== 'stage2b-5c-eg-f0-canonical-json-v2' ||
      contract.evidenceSchemaVersion !== 'stage2b-5c-eg-f0-command-evidence-schema-v2') {
    throw new Error('ALLOWLIST_CONTRACT_VERSION_MISMATCH');
  }
  if (contract.commandOrderVersion !== 'stage2b-5c-eg-f0-command-order-v1') throw new Error('COMMAND_ORDER_VERSION_MISMATCH');
  if (contract.records.length !== 16) throw new Error('TIER_A_RECORD_COUNT_MISMATCH');
  const ids = contract.records.map((entry) => entry.commandId);
  if (new Set(ids).size !== ids.length || ids.some((id, index) => id !== TIER_A_COMMAND_IDS[index])) {
    throw new Error('TIER_A_COMMAND_ID_MISMATCH');
  }
  for (const record of contract.records) {
    if (!exactKeys(record, RECORD_KEYS)) throw new Error('ALLOWLIST_RECORD_SCHEMA_MISMATCH');
    if (!exactKeys(record.outputSchema, ['flags', 'kind', 'source'])) throw new Error('OUTPUT_SCHEMA_MISMATCH');
    if (record.approvalStatus !== 'CANDIDATE_ONLY_NOT_APPROVED') throw new Error('APPROVAL_STATUS_MISMATCH');
    if (record.localDaemonContact !== 'NONE') throw new Error('LOCAL_DAEMON_CONTACT_REJECTED');
    if (record.outputSchema.flags !== 'u' || record.patternDialect !== 'ECMASCRIPT_2023_UNICODE') {
      throw new Error('PATTERN_DIALECT_MISMATCH');
    }
    if (new Set(record.stopConditions).size !== record.stopConditions.length ||
        !['ALLOWLIST_UNRESOLVED', 'BASELINE_MISMATCH', 'EXECUTABLE_MISMATCH', 'COMMAND_SAFETY_BLOCKED',
          'DEPENDENCY_NOT_ESTABLISHED', 'GIT_IDENTITY_NOT_ESTABLISHED', 'STDOUT_OUTPUT_LIMIT_EXCEEDED',
          'STDERR_OUTPUT_LIMIT_EXCEEDED', 'BOTH_STREAM_OUTPUT_LIMIT_EXCEEDED', 'STDERR_NONEMPTY',
          'INVALID_UTF8', 'SCHEMA_MISMATCH', 'PATTERN_MISMATCH', 'NORMALIZATION_FAILED', 'NONZERO_EXIT',
          'UNEXPECTED_EXIT', 'LOCAL_DAEMON_CONTACT_DETECTED', 'NETWORK_ACTIVITY_DETECTED', 'COMMAND_TIMEOUT',
          'PROCESS_SPAWN_FAILED', 'STREAM_READ_FAILED', 'PROCESS_TERMINATION_FAILED']
          .every((reason) => record.stopConditions.includes(reason as StopReason))) {
      throw new Error('STOP_CONDITIONS_INCOMPLETE');
    }
  }
  validateDependencyGraph(contract.records);

  const gitVersion = contract.records[0];
  const headSha = String(contract.records[2]?.expectedNormalizedFacts.headSha);
  const architectureBlobId = String(contract.records[7]?.expectedNormalizedFacts.architectureBlobId);
  const gitVersionLine = String(gitVersion?.expectedNormalizedFacts.gitVersionLine);
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

export function createStaticAllowlistDigest(symbols: Readonly<Record<string, string>>): {
  readonly bytes: string;
  readonly digest: string;
  readonly contract: AllowlistContract;
  readonly symbolResolution: SymbolResolutionResult;
} {
  const symbolResolution = resolveApprovalSymbolsClosed(ALLOWLIST_CONTRACT, symbols);
  validateContract(symbolResolution.contract);
  const bytes = canonicalize(symbolResolution.contract);
  if (bytes.includes(SYMBOL_PREFIX)) throw new AllowlistError('ALLOWLIST_UNRESOLVED');
  return Object.freeze({ bytes, digest: sha256(bytes), contract: symbolResolution.contract, symbolResolution });
}

export interface DependencyDerivationInput {
  readonly symbolResolution: SymbolResolutionResult;
  readonly priorEvidence: readonly CommandEvidence[];
  readonly allowlistDigest: string;
  readonly repositoryHead: string;
  readonly workingDirectory: string;
  readonly executionBaselineDigest?: string;
  readonly sequencerRunId?: string;
  readonly sequenceIndex?: number;
}

export function deriveDependencyState(input: DependencyDerivationInput): DependencyState {
  if (!RESOLUTION_BRAND.has(input.symbolResolution)) throw new AllowlistError('ALLOWLIST_UNRESOLVED');
  if (sha256(canonicalize(input.symbolResolution.contract)) !== input.allowlistDigest) {
    throw new AllowlistError('ALLOWLIST_UNRESOLVED');
  }
  const established = ['SYMBOL_TABLE:RESOLVED'];
  for (const evidence of input.priorEvidence) {
    assertClosedEvidence(evidence as unknown as Readonly<Record<string, unknown>>);
    const record = input.symbolResolution.contract.records.find((entry) => entry.commandId === evidence.commandId);
    if (evidence.exitClass === 'SUCCESS' && evidence.stopReason === 'NONE' &&
        evidence.normalizationResult === 'SUCCESS' && evidence.allowlistDigest === input.allowlistDigest &&
        evidence.repositoryHead === input.repositoryHead && evidence.workingDirectory === input.workingDirectory &&
        evidence.repositoryBranch === 'main' && evidence.localDaemonContact === 'NONE' &&
        evidence.contractVersion === COMMAND_EVIDENCE_CONTRACT_VERSION &&
        evidence.schemaVersion === EVIDENCE_SCHEMA_VERSION &&
        evidence.executionBaselineDigest === (input.executionBaselineDigest ?? 'fixture-baseline-digest') &&
        evidence.sequencerRunId === (input.sequencerRunId ?? 'fixture-run') &&
        evidence.commandOrderVersion === 'stage2b-5c-eg-f0-command-order-v1' &&
        evidence.sequenceIndex < (input.sequenceIndex ?? 16) && record !== undefined &&
        evidence.executableRealpath === record.expectedRealpath && evidence.privilegeClass === record.privilegeClass) {
      established.push(`${evidence.commandId}:SUCCESS`);
    }
  }
  const state = Object.freeze({
    established: Object.freeze([...new Set(established)]),
    allowlistDigest: input.allowlistDigest,
    repositoryHead: input.repositoryHead,
    workingDirectory: input.workingDirectory,
    executionBaselineDigest: input.executionBaselineDigest ?? 'fixture-baseline-digest',
    sequencerRunId: input.sequencerRunId ?? 'fixture-run',
    sequenceIndex: input.sequenceIndex ?? 16,
  });
  DEPENDENCY_STATE_BRAND.add(state);
  return state;
}

export function isDispatchable(record: AllowlistRecord, state: DependencyState, context: {
  readonly allowlistDigest: string;
  readonly repositoryHead: string;
  readonly workingDirectory: string;
}): {
  readonly dispatchable: boolean;
  readonly reason: StopReason;
} {
  if (!DEPENDENCY_STATE_BRAND.has(state)) return { dispatchable: false, reason: 'DEPENDENCY_NOT_ESTABLISHED' };
  if (state.allowlistDigest !== context.allowlistDigest || state.repositoryHead !== context.repositoryHead ||
      state.workingDirectory !== context.workingDirectory) {
    return { dispatchable: false, reason: 'DEPENDENCY_NOT_ESTABLISHED' };
  }
  const available = new Set(state.established);
  if (!available.has('SYMBOL_TABLE:RESOLVED')) return { dispatchable: false, reason: 'ALLOWLIST_UNRESOLVED' };
  const missing = record.explicitDependencies.find((dependency) => !available.has(dependency));
  if (missing === 'F0-GIT-00:SUCCESS') return { dispatchable: false, reason: 'GIT_IDENTITY_NOT_ESTABLISHED' };
  if (missing !== undefined) return { dispatchable: false, reason: 'DEPENDENCY_NOT_ESTABLISHED' };
  return { dispatchable: true, reason: 'NONE' };
}

/** Fixture-only adapter. It returns preloaded chunks and never imports or invokes a host process API. */
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

export function createExecutionBaselineBindingDigest(binding: ExecutionBaselineBinding): string {
  return sha256(canonicalize(binding));
}

export function createDocumentBlobBindingDigest(binding: DocumentBlobBinding): string {
  return sha256(canonicalize(binding));
}

interface StreamResult {
  readonly text: string;
  readonly byteCount: number;
  readonly exceeded: boolean;
  readonly invalidUtf8: boolean;
}

function consumeChunks(chunks: readonly Uint8Array[], maxBytes: number, maxLines: number): StreamResult {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let byteCount = 0;
  let text = '';
  let newlineCount = 0;
  let dataAfterNewline = false;
  let pendingCr = false;
  const append = (value: string): boolean => {
    for (const character of value) {
      if (pendingCr) {
        text += '\n';
        newlineCount += 1;
        dataAfterNewline = false;
        pendingCr = false;
        if (newlineCount > maxLines) return false;
        if (character === '\n') continue;
      }
      if (character === '\r') {
        pendingCr = true;
      } else if (character === '\n') {
        text += '\n';
        newlineCount += 1;
        dataAfterNewline = false;
      } else {
        text += character;
        dataAfterNewline = true;
      }
      if (newlineCount + (dataAfterNewline ? 1 : 0) > maxLines) return false;
    }
    return true;
  };
  try {
    for (const chunk of chunks) {
      byteCount += chunk.byteLength;
      if (byteCount > maxBytes) return { text: '', byteCount, exceeded: true, invalidUtf8: false };
      if (!append(decoder.decode(chunk, { stream: true }))) {
        return { text: '', byteCount, exceeded: true, invalidUtf8: false };
      }
    }
    if (!append(decoder.decode())) return { text: '', byteCount, exceeded: true, invalidUtf8: false };
    if (pendingCr) {
      text += '\n';
      newlineCount += 1;
      if (newlineCount > maxLines) return { text: '', byteCount, exceeded: true, invalidUtf8: false };
    }
    return { text, byteCount, exceeded: false, invalidUtf8: false };
  } catch {
    return { text: '', byteCount, exceeded: false, invalidUtf8: true };
  }
}

export interface FixtureEvaluation {
  readonly record: AllowlistRecord;
  readonly processResult: FixtureProcessResult;
  readonly identityVerifier?: ExecutableIdentityVerifier;
  readonly approvedIdentity: ExecutableIdentity;
  readonly dependencyState: DependencyState;
  readonly normalizedFacts: Readonly<Record<string, string | number | boolean>>;
  readonly schemaValid: boolean;
  readonly allowlistDigest: string;
  readonly repositoryHead: string;
  readonly observedAt: string;
  readonly executionBaseline?: ExecutionBaselineBinding;
  readonly executionBaselineDigest?: string;
  readonly sequencerRunId?: string;
  readonly sequenceIndex?: number;
  readonly processSignal?: CommandEvidence['processSignal'];
}

function identityMatches(left: ExecutableIdentity, right: ExecutableIdentity): boolean {
  return canonicalize(left) === canonicalize(right);
}

function evidence(input: FixtureEvaluation, identity: ExecutableIdentity, exitClass: CommandEvidence['exitClass'],
  stopReason: StopReason, stdoutBytes: number, stderrBytes: number,
  facts: Readonly<Record<string, string | number | boolean>>, outputTruncated: boolean,
  normalizationResult: CommandEvidence['normalizationResult']): CommandEvidence {
  return Object.freeze({
    contractVersion: COMMAND_EVIDENCE_CONTRACT_VERSION, schemaVersion: EVIDENCE_SCHEMA_VERSION,
    allowlistDigest: input.allowlistDigest,
    executionBaselineDigest: input.executionBaselineDigest ?? 'fixture-baseline-digest',
    sequencerRunId: input.sequencerRunId ?? 'fixture-run',
    commandOrderVersion: 'stage2b-5c-eg-f0-command-order-v1', sequenceIndex: input.sequenceIndex ?? 0,
    commandId: input.record.commandId,
    executableRealpath: identity.realpath, executableIdentity: identity,
    argvDigest: sha256(canonicalize(input.record.argv)), workingDirectory: input.record.workingDirectory,
    repositoryBranch: 'main', repositoryHead: input.repositoryHead, privilegeClass: input.record.privilegeClass,
    localDaemonContact: input.record.localDaemonContact, exitClass, stopReason,
    processExitCode: input.processSignal === undefined || input.processSignal === 'NONE' ? input.processResult.exitCode : 'NONE',
    processSignal: input.processSignal ?? 'NONE', stdoutByteCount: stdoutBytes,
    stderrByteCount: stderrBytes, normalizedFacts: Object.freeze({ ...facts }), redactionCount: 0,
    outputTruncated, normalizationResult, evidenceClass: input.record.evidenceClass, observedAt: input.observedAt,
  });
}

function failure(input: FixtureEvaluation, identity: ExecutableIdentity, exitClass: CommandEvidence['exitClass'],
  stopReason: StopReason, stdoutBytes = 0, stderrBytes = 0, truncated = false): CommandEvidence {
  return evidence(input, identity, exitClass, stopReason, stdoutBytes, stderrBytes, {}, truncated, 'REJECTED');
}

export function evaluateFixture(input: FixtureEvaluation): CommandEvidence {
  const dependency = isDispatchable(input.record, input.dependencyState, {
    allowlistDigest: input.allowlistDigest,
    repositoryHead: input.repositoryHead,
    workingDirectory: input.record.workingDirectory,
  });
  if (!dependency.dispatchable) {
    const exitClass = dependency.reason === 'ALLOWLIST_UNRESOLVED' ? 'ALLOWLIST_UNRESOLVED' : 'DEPENDENCY_UNSATISFIED';
    return failure(input, input.approvedIdentity, exitClass, dependency.reason);
  }
  if (input.identityVerifier === undefined) {
    return failure(input, input.approvedIdentity, 'COMMAND_SAFETY_BLOCKED', 'COMMAND_SAFETY_BLOCKED');
  }
  const identity = input.identityVerifier.verify(input.record);
  if (identity === undefined || !identityMatches(identity, input.approvedIdentity) ||
      identity.realpath !== input.record.expectedRealpath) {
    return failure(input, identity ?? input.approvedIdentity, 'EXECUTABLE_MISMATCH', 'EXECUTABLE_MISMATCH');
  }

  const stdout = consumeChunks(input.processResult.stdoutChunks, input.record.stdoutMaxBytes, input.record.stdoutMaxLines);
  const stderr = consumeChunks(input.processResult.stderrChunks, input.record.stderrMaxBytes, input.record.stderrMaxLines);
  if (stdout.exceeded && stderr.exceeded) return failure(input, identity, 'OUTPUT_LIMIT_EXCEEDED', 'BOTH_STREAM_OUTPUT_LIMIT_EXCEEDED', stdout.byteCount, stderr.byteCount, true);
  if (stderr.exceeded) return failure(input, identity, 'OUTPUT_LIMIT_EXCEEDED', 'STDERR_OUTPUT_LIMIT_EXCEEDED', stdout.byteCount, stderr.byteCount, true);
  if (stdout.exceeded) return failure(input, identity, 'OUTPUT_LIMIT_EXCEEDED', 'STDOUT_OUTPUT_LIMIT_EXCEEDED', stdout.byteCount, stderr.byteCount, true);
  if (stdout.invalidUtf8 || stderr.invalidUtf8) return failure(input, identity, 'SCHEMA_MISMATCH', 'INVALID_UTF8', stdout.byteCount, stderr.byteCount);
  if (stderr.byteCount > 0) return failure(input, identity, 'STDERR_NONEMPTY', 'STDERR_NONEMPTY', stdout.byteCount, stderr.byteCount);
  if (input.processResult.exitCode !== 0) return failure(input, identity, 'EXECUTION_ERROR', 'NONZERO_EXIT', stdout.byteCount, stderr.byteCount);

  if (input.record.outputSchema.kind === 'PATTERN' &&
      !new RegExp(input.record.outputSchema.source, input.record.outputSchema.flags).test(stdout.text)) {
    return failure(input, identity, 'SCHEMA_MISMATCH', 'PATTERN_MISMATCH', stdout.byteCount, stderr.byteCount);
  }
  if (input.record.outputSchema.kind === 'CLOSED_GRAMMAR' && !input.schemaValid) {
    return failure(input, identity, 'SCHEMA_MISMATCH', 'SCHEMA_MISMATCH', stdout.byteCount, stderr.byteCount);
  }

  let facts = input.normalizedFacts;
  if (input.record.commandId === 'F0-GIT-04') {
    const match = /^([0-9]{1,6})[ \t]+([0-9]{1,6})\n?$/.exec(stdout.text);
    const behindCount = Number(match?.[1]);
    const aheadCount = Number(match?.[2]);
    facts = Object.freeze({ behindCount, aheadCount });
    const baseline = input.executionBaseline;
    if (baseline === undefined || behindCount !== baseline.expectedBehindCount ||
        aheadCount !== baseline.expectedAheadCount) {
      return failure(input, identity, 'BASELINE_MISMATCH', 'BASELINE_MISMATCH', stdout.byteCount, stderr.byteCount);
    }
  } else if (canonicalize(facts) !== canonicalize(input.record.expectedNormalizedFacts)) {
    return failure(input, identity, 'SCHEMA_MISMATCH', 'NORMALIZATION_FAILED', stdout.byteCount, stderr.byteCount);
  }
  return evidence(input, identity, 'SUCCESS', 'NONE', stdout.byteCount, stderr.byteCount, facts, false, 'SUCCESS');
}

const EVIDENCE_KEYS = Object.freeze([
  'contractVersion', 'schemaVersion', 'allowlistDigest', 'commandId', 'executableRealpath',
  'executionBaselineDigest', 'sequencerRunId', 'commandOrderVersion', 'sequenceIndex',
  'executableIdentity', 'argvDigest', 'workingDirectory', 'repositoryBranch', 'repositoryHead',
  'privilegeClass', 'localDaemonContact', 'exitClass', 'stopReason', 'processExitCode', 'processSignal', 'stdoutByteCount',
  'stderrByteCount', 'normalizedFacts', 'redactionCount', 'outputTruncated', 'normalizationResult',
  'evidenceClass', 'observedAt',
].sort());

export function assertClosedEvidence(value: Readonly<Record<string, unknown>>): void {
  if (!exactKeys(value, EVIDENCE_KEYS)) throw new Error('EVIDENCE_UNKNOWN_FIELD');
  if (value.schemaVersion !== EVIDENCE_SCHEMA_VERSION) throw new Error('EVIDENCE_SCHEMA_VERSION_MISMATCH');
  if (value.commandOrderVersion !== 'stage2b-5c-eg-f0-command-order-v1') throw new Error('COMMAND_ORDER_VERSION_MISMATCH');
  if (!Number.isInteger(value.sequenceIndex) || (value.sequenceIndex as number) < 0 || (value.sequenceIndex as number) > 15) {
    throw new Error('EVIDENCE_SEQUENCE_INDEX_INVALID');
  }
  if (typeof value.sequencerRunId !== 'string' || value.sequencerRunId.length < 1 || value.sequencerRunId.length > 128 ||
      typeof value.executionBaselineDigest !== 'string' || value.executionBaselineDigest.length < 1) {
    throw new Error('EVIDENCE_REPLAY_BINDING_INVALID');
  }
  const exitCode = value.processExitCode;
  const signal = value.processSignal;
  if ((typeof exitCode === 'number' && signal !== 'NONE') ||
      (exitCode === 'NONE' && signal === 'NONE' && value.stopReason !== 'PROCESS_SPAWN_FAILED')) {
    throw new Error('PROCESS_RESULT_CONTRADICTION');
  }
  if (value.exitClass !== 'SUCCESS' && canonicalize(value.normalizedFacts) !== '{}') {
    throw new Error('FAILED_EVIDENCE_FACTS_NOT_EMPTY');
  }
}
