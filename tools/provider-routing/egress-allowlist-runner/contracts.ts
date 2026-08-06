export const ALLOWLIST_CONTRACT_VERSION = 'stage2b-5c-eg-f0-allowlist-v2';
export const ALLOWLIST_CANONICALIZATION_VERSION = 'stage2b-5c-eg-f0-canonical-json-v2';
export const EVIDENCE_SCHEMA_VERSION = 'stage2b-5c-eg-f0-command-evidence-schema-v2';
export const PATTERN_DIALECT = 'ECMASCRIPT_2023_UNICODE';
export const PATTERN_DIALECT_VERSION = 'stage2b-5c-eg-f0-pattern-ecmascript-2023-unicode-v1';
export const REGEX_DOCUMENT_REPRESENTATION = 'LITERAL_REGEX_SOURCE_TEXT';
export const APPROVAL_BOUND_SYMBOL_POLICY_VERSION = 'stage2b-5c-eg-f0-approval-bound-symbols-v1';
export const RAW_OUTPUT_POLICY_VERSION = 'stage2b-5c-eg-f0-raw-output-v1';
export const MISMATCH_POLICY_VERSION = 'stage2b-5c-eg-f0-mismatch-v1';
export const STREAM_PRECEDENCE_POLICY_VERSION = 'stage2b-5c-eg-f0-stream-precedence-v1';
export const COMMAND_EVIDENCE_CONTRACT_VERSION = 'stage2b-5c-eg-f0-command-evidence-v1';
export const COMMAND_ORDER_VERSION = 'stage2b-5c-eg-f0-command-order-v1';
export const SEQUENCER_CONTRACT_VERSION = 'stage2b-5c-eg-f0-stop-first-sequencer-v1';
export const PROCESS_ADAPTER_POLICY_VERSION = 'stage2b-5c-eg-f0-process-adapter-v1';
export const REAL_STREAM_ADAPTER_POLICY_VERSION = 'stage2b-5c-eg-f0-real-stream-adapter-v1';
export const TERMINATION_POLICY_VERSION = 'stage2b-5c-eg-f0-exact-child-termination-v1';
export const ENVIRONMENT_POLICY_VERSION = 'stage2b-5c-eg-f0-host-environment-v1';
export const EXECUTABLE_IDENTITY_POLICY_VERSION = 'stage2b-5c-eg-f0-executable-identity-v1';
export const PRIOR_STATIC_DIGEST_COMPATIBLE = false;
export const PRIOR_BASELINE_DIGEST_COMPATIBLE = false;
export const FINAL_DIGEST_FROZEN = false;

export const APPROVAL_SYMBOL_NAMES = [
  'APPROVAL_BOUND_HEAD_SHA',
  'APPROVAL_BOUND_ARCHITECTURE_PLAN_BLOB_ID',
  'APPROVAL_BOUND_GIT_VERSION_LINE',
] as const;
export type ApprovalSymbolName = (typeof APPROVAL_SYMBOL_NAMES)[number];
export type ApprovalSymbolTable = Readonly<Record<ApprovalSymbolName, string>>;

export type ExitClass =
  | 'SUCCESS' | 'ALLOWLIST_UNRESOLVED' | 'EXPECTED_NOT_FOUND' | 'PERMISSION_DENIED'
  | 'STDERR_NONEMPTY' | 'SCHEMA_MISMATCH' | 'OUTPUT_LIMIT_EXCEEDED'
  | 'EXECUTABLE_MISMATCH' | 'BASELINE_MISMATCH' | 'COMMAND_SAFETY_BLOCKED'
  | 'DEPENDENCY_UNSATISFIED' | 'EXECUTION_ERROR' | 'UNEXPECTED_EXIT';

export type StopReason =
  | 'NONE' | 'ALLOWLIST_UNRESOLVED' | 'EXPECTED_NOT_FOUND' | 'BASELINE_MISMATCH'
  | 'EXECUTABLE_MISMATCH' | 'GIT_IDENTITY_NOT_ESTABLISHED' | 'NONZERO_EXIT'
  | 'UNEXPECTED_EXIT' | 'PERMISSION_DENIED' | 'STDERR_NONEMPTY'
  | 'STDERR_OUTPUT_LIMIT_EXCEEDED' | 'STDOUT_OUTPUT_LIMIT_EXCEEDED'
  | 'BOTH_STREAM_OUTPUT_LIMIT_EXCEEDED' | 'SCHEMA_MISMATCH' | 'INVALID_UTF8'
  | 'PATTERN_MISMATCH' | 'OUTPUT_TRUNCATED' | 'NORMALIZATION_FAILED' | 'DEPENDENCY_NOT_ESTABLISHED'
  | 'LOCAL_DAEMON_CONTACT_DETECTED' | 'NETWORK_ACTIVITY_DETECTED' | 'COMMAND_SAFETY_BLOCKED'
  | 'COMMAND_TIMEOUT' | 'PROCESS_SPAWN_FAILED' | 'STREAM_READ_FAILED' | 'PROCESS_TERMINATION_FAILED';

export interface ExecutableIdentity {
  readonly realpath: string;
  readonly fileType: 'REGULAR_FILE';
  readonly device: number;
  readonly inode: number;
  readonly mode: number;
  readonly uid: number;
  readonly gid: number;
  readonly sizeBytes: number;
  readonly codeSignature: string;
}

export interface OutputSchema {
  readonly kind: 'PATTERN' | 'CLOSED_GRAMMAR';
  readonly source: string;
  readonly flags: 'u';
}

export interface AllowlistRecord {
  readonly approvalStatus: 'CANDIDATE_ONLY_NOT_APPROVED';
  readonly commandId: string;
  readonly executable: string;
  readonly expectedRealpath: string;
  readonly approvedExecutableIdentityContract: string;
  readonly argv: readonly string[];
  readonly workingDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly privilegeClass: 'UNPRIVILEGED';
  readonly localDaemonContact: 'NONE';
  readonly networkPolicy: 'NONE';
  readonly processLifecyclePolicy: 'ONE_BOUNDED_CHILD_NO_DESCENDANTS';
  readonly timeoutMs: number;
  readonly stdoutMaxLines: number;
  readonly stdoutMaxBytes: number;
  readonly stderrMaxLines: number;
  readonly stderrMaxBytes: number;
  readonly patternDialect: typeof PATTERN_DIALECT;
  readonly outputSchema: OutputSchema;
  readonly expectedNormalizedFacts: Readonly<Record<string, string | number | boolean>>;
  readonly redactionPolicy: string;
  readonly stopConditions: readonly StopReason[];
  readonly evidenceClass: string;
  readonly explicitDependencies: readonly string[];
}

export interface AllowlistContract {
  readonly contractVersion: string;
  readonly canonicalizationVersion: string;
  readonly evidenceSchemaVersion: string;
  readonly patternDialect: string;
  readonly patternDialectVersion: string;
  readonly regexDocumentRepresentation: string;
  readonly approvalBoundSymbolPolicyVersion: string;
  readonly rawOutputPolicyVersion: string;
  readonly mismatchPolicyVersion: string;
  readonly streamPrecedencePolicyVersion: string;
  readonly commandOrderVersion: string;
  readonly records: readonly AllowlistRecord[];
}

export interface CommandEvidence {
  readonly contractVersion: string;
  readonly schemaVersion: string;
  readonly allowlistDigest: string;
  readonly executionBaselineDigest: string;
  readonly sequencerRunId: string;
  readonly commandOrderVersion: string;
  readonly sequenceIndex: number;
  readonly commandId: string;
  readonly executableRealpath: string;
  readonly executableIdentity: ExecutableIdentity;
  readonly argvDigest: string;
  readonly workingDirectory: string;
  readonly repositoryBranch: string;
  readonly repositoryHead: string;
  readonly privilegeClass: 'UNPRIVILEGED';
  readonly localDaemonContact: 'NONE' | 'POSSIBLE' | 'REQUIRED';
  readonly exitClass: ExitClass;
  readonly stopReason: StopReason;
  readonly processExitCode: number | 'NONE';
  readonly processSignal: 'NONE' | 'SIGTERM' | 'SIGKILL' | 'UNEXPECTED_SIGNAL';
  readonly stdoutByteCount: number;
  readonly stderrByteCount: number;
  readonly normalizedFacts: Readonly<Record<string, string | number | boolean>>;
  readonly redactionCount: number;
  readonly outputTruncated: boolean;
  readonly normalizationResult: 'SUCCESS' | 'NOT_ATTEMPTED' | 'REJECTED';
  readonly evidenceClass: string;
  readonly observedAt: string;
}

export interface AllowedCommandExecutor {
  execute(record: AllowlistRecord): Promise<FixtureProcessResult>;
}

export interface ExecutableIdentityVerifier {
  verify(record: AllowlistRecord): ExecutableIdentity | undefined;
}

export interface FixtureProcessResult {
  readonly exitCode: number;
  readonly stdoutChunks: readonly Uint8Array[];
  readonly stderrChunks: readonly Uint8Array[];
}

export interface ExecutionBaselineBinding {
  readonly branch: string;
  readonly repositoryHead: string;
  readonly repositoryParent: string;
  readonly originMain: string;
  readonly expectedBehindCount: number;
  readonly expectedAheadCount: number;
  readonly trackedClean: boolean;
  readonly stagedClean: boolean;
  readonly untrackedCount: number;
  readonly untrackedPolicy: string;
  readonly repositoryRoot: string;
  readonly allowlistDocumentBlobId: string;
  readonly architecturePlanBlobId: string;
  readonly staticAllowlistDigest: string;
  readonly sequencerPolicy: Readonly<{ version: typeof SEQUENCER_CONTRACT_VERSION; stopOnFirstFailure: true }>;
  readonly processAdapterPolicy: Readonly<{ version: typeof PROCESS_ADAPTER_POLICY_VERSION; topology: 'ONE_BOUNDED_CHILD_NO_DESCENDANTS'; timeoutMs: 5000 }>;
  readonly streamAdapterPolicy: Readonly<{ version: typeof REAL_STREAM_ADAPTER_POLICY_VERSION; maxSegmentBytes: 4096; maxPendingSegmentsPerStream: 1 }>;
  readonly terminationPolicy: Readonly<{ version: typeof TERMINATION_POLICY_VERSION; termSignal: 'SIGTERM'; termGraceMs: 500; killSignal: 'SIGKILL'; closeDeadlineMs: 500 }>;
  readonly environmentPolicy: Readonly<{ version: typeof ENVIRONMENT_POLICY_VERSION; environment: Readonly<{ LANG: 'C'; LC_ALL: 'C' }> }>;
  readonly executableIdentityPolicy: Readonly<{ version: typeof EXECUTABLE_IDENTITY_POLICY_VERSION; immediatePreDispatchRecheck: true }>;
}

export interface DocumentBlobBinding {
  readonly allowlistDocumentBlobId: string;
  readonly architecturePlanBlobId: string;
}
