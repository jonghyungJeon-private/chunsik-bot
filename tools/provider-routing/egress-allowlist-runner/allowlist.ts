import {
  ALLOWLIST_CANONICALIZATION_VERSION,
  ALLOWLIST_CONTRACT_VERSION,
  APPROVAL_BOUND_SYMBOL_POLICY_VERSION,
  AllowlistContract,
  AllowlistRecord,
  EVIDENCE_SCHEMA_VERSION,
  MISMATCH_POLICY_VERSION,
  PATTERN_DIALECT,
  PATTERN_DIALECT_VERSION,
  RAW_OUTPUT_POLICY_VERSION,
  REGEX_DOCUMENT_REPRESENTATION,
  STREAM_PRECEDENCE_POLICY_VERSION,
} from './contracts';

const ROOT = '/Users/seongsujeonjonghyeong/demo_Project/chunsik-bot-2';
const ENVIRONMENT = Object.freeze({ LANG: 'C', LC_ALL: 'C' });
const STOP_CONDITIONS = Object.freeze([
  'ALLOWLIST_UNRESOLVED', 'BASELINE_MISMATCH', 'EXECUTABLE_MISMATCH', 'COMMAND_SAFETY_BLOCKED',
  'DEPENDENCY_NOT_ESTABLISHED', 'GIT_IDENTITY_NOT_ESTABLISHED', 'NONZERO_EXIT', 'UNEXPECTED_EXIT',
  'STDERR_NONEMPTY', 'STDOUT_OUTPUT_LIMIT_EXCEEDED', 'STDERR_OUTPUT_LIMIT_EXCEEDED',
  'BOTH_STREAM_OUTPUT_LIMIT_EXCEEDED', 'INVALID_UTF8', 'SCHEMA_MISMATCH', 'PATTERN_MISMATCH',
  'NORMALIZATION_FAILED', 'LOCAL_DAEMON_CONTACT_DETECTED', 'NETWORK_ACTIVITY_DETECTED',
] as const);

interface RecordInput {
  readonly commandId: string;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly stdoutMaxLines: number;
  readonly stdoutMaxBytes: number;
  readonly stderrMaxLines: number;
  readonly stderrMaxBytes: number;
  readonly schemaKind: 'PATTERN' | 'CLOSED_GRAMMAR';
  readonly schemaSource: string;
  readonly expected: Readonly<Record<string, string | number | boolean>>;
  readonly evidenceClass: string;
  readonly dependencies: readonly string[];
  readonly redactionPolicy?: string;
}

function record(input: RecordInput): AllowlistRecord {
  return Object.freeze({
    approvalStatus: 'CANDIDATE_ONLY_NOT_APPROVED',
    commandId: input.commandId,
    executable: input.executable,
    expectedRealpath: input.executable,
    approvedExecutableIdentityContract: 'stage2b-5c-eg-f0-executable-identity-v1',
    argv: Object.freeze([...input.argv]),
    workingDirectory: ROOT,
    environment: ENVIRONMENT,
    privilegeClass: 'UNPRIVILEGED',
    localDaemonContact: 'NONE',
    networkPolicy: 'NONE',
    processLifecyclePolicy: 'ONE_BOUNDED_CHILD_NO_DESCENDANTS',
    timeoutMs: 5000,
    stdoutMaxLines: input.stdoutMaxLines,
    stdoutMaxBytes: input.stdoutMaxBytes,
    stderrMaxLines: input.stderrMaxLines,
    stderrMaxBytes: input.stderrMaxBytes,
    patternDialect: PATTERN_DIALECT,
    outputSchema: Object.freeze({ kind: input.schemaKind, source: input.schemaSource, flags: 'u' }),
    expectedNormalizedFacts: Object.freeze({ ...input.expected }),
    redactionPolicy: input.redactionPolicy ?? 'NONE',
    stopConditions: STOP_CONDITIONS,
    evidenceClass: input.evidenceClass,
    explicitDependencies: Object.freeze([...input.dependencies]),
  });
}

const SYMBOLS = ['SYMBOL_TABLE:RESOLVED'] as const;
const GIT = ['/usr/bin/git'] as const;
const GIT_DEPENDENCIES = ['SYMBOL_TABLE:RESOLVED', 'F0-GIT-00:SUCCESS'] as const;
const SOURCE_DEPENDENCIES = ['SYMBOL_TABLE:RESOLVED', 'F0-GIT-07:SUCCESS'] as const;

export const TIER_A_COMMAND_IDS = Object.freeze([
  'F0-GIT-00', 'F0-GIT-01', 'F0-GIT-02', 'F0-GIT-03', 'F0-GIT-04',
  'F0-GIT-05', 'F0-GIT-06', 'F0-GIT-07', 'F0-GIT-08',
  'F1-SRC-01', 'F1-SRC-02', 'F1-SRC-03', 'F1-SRC-04',
  'F1-PATH-01', 'F1-PATH-02', 'F1-PATH-03',
] as const);

export const TIER_A_RECORDS: readonly AllowlistRecord[] = Object.freeze([
  record({ commandId: 'F0-GIT-00', executable: GIT[0], argv: ['--version'], stdoutMaxLines: 1, stdoutMaxBytes: 128, stderrMaxLines: 1, stderrMaxBytes: 512, schemaKind: 'PATTERN', schemaSource: '^git version [0-9A-Za-z][0-9A-Za-z._+-]{0,63}( \\([0-9A-Za-z][0-9A-Za-z ._+-]{0,63}\\))?\\n?$', expected: { gitVersionLine: 'APPROVAL_BOUND_GIT_VERSION_LINE' }, evidenceClass: 'EXECUTABLE_IDENTITY', dependencies: SYMBOLS }),
  record({ commandId: 'F0-GIT-01', executable: GIT[0], argv: ['rev-parse', '--abbrev-ref', 'HEAD'], stdoutMaxLines: 1, stdoutMaxBytes: 64, stderrMaxLines: 1, stderrMaxBytes: 512, schemaKind: 'PATTERN', schemaSource: '^main\\n?$', expected: { branch: 'main' }, evidenceClass: 'REPOSITORY_BASELINE', dependencies: GIT_DEPENDENCIES }),
  record({ commandId: 'F0-GIT-02', executable: GIT[0], argv: ['rev-parse', 'HEAD'], stdoutMaxLines: 1, stdoutMaxBytes: 64, stderrMaxLines: 1, stderrMaxBytes: 512, schemaKind: 'PATTERN', schemaSource: '^[0-9a-f]{40}\\n?$', expected: { headSha: 'APPROVAL_BOUND_HEAD_SHA' }, evidenceClass: 'REPOSITORY_BASELINE', dependencies: GIT_DEPENDENCIES }),
  record({ commandId: 'F0-GIT-03', executable: GIT[0], argv: ['rev-parse', 'origin/main'], stdoutMaxLines: 1, stdoutMaxBytes: 64, stderrMaxLines: 1, stderrMaxBytes: 512, schemaKind: 'PATTERN', schemaSource: '^[0-9a-f]{40}\\n?$', expected: { localOriginMainSha: 'eae8f802a61b65a4d0336b3d1ba69f5bc341bbff' }, evidenceClass: 'REPOSITORY_BASELINE', dependencies: GIT_DEPENDENCIES }),
  record({ commandId: 'F0-GIT-04', executable: GIT[0], argv: ['rev-list', '--left-right', '--count', 'origin/main...HEAD'], stdoutMaxLines: 1, stdoutMaxBytes: 64, stderrMaxLines: 1, stderrMaxBytes: 512, schemaKind: 'PATTERN', schemaSource: '^([0-9]{1,6})[ \\t]+([0-9]{1,6})\\n?$', expected: { normalization: 'behindCount,aheadCount:canonical-base10-integers' }, evidenceClass: 'REPOSITORY_BASELINE', dependencies: GIT_DEPENDENCIES }),
  record({ commandId: 'F0-GIT-05', executable: GIT[0], argv: ['status', '--short'], stdoutMaxLines: 64, stdoutMaxBytes: 8192, stderrMaxLines: 4, stderrMaxBytes: 1024, schemaKind: 'CLOSED_GRAMMAR', schemaSource: 'git-status-short-v1', expected: { stagedChangeCount: 0, trackedChangeCount: 0, untrackedCount: 32 }, evidenceClass: 'REPOSITORY_BASELINE_REDACTED', dependencies: GIT_DEPENDENCIES, redactionPolicy: 'discard-paths-v1' }),
  record({ commandId: 'F0-GIT-06', executable: GIT[0], argv: ['diff', '--cached', '--name-only'], stdoutMaxLines: 1, stdoutMaxBytes: 1, stderrMaxLines: 1, stderrMaxBytes: 512, schemaKind: 'PATTERN', schemaSource: '^$', expected: { stagedPathCount: 0 }, evidenceClass: 'REPOSITORY_BASELINE', dependencies: GIT_DEPENDENCIES }),
  record({ commandId: 'F0-GIT-07', executable: GIT[0], argv: ['ls-files', '--stage', 'docs/plans/stage-2b-slice-5c-eg-external-egress-enforcement-architecture-plan.md', 'docs/plans/stage-2b-slice-5c-eg-f-read-only-feasibility-probe-plan.md', 'apps/chunsik/src/tools/provider-generation-execution.ts', 'apps/chunsik/src/tools/provider-generation-validation.ts', 'apps/chunsik/src/provider-routing/ollama-preflight/preflight.ts', 'apps/chunsik/src/provider-routing/provider-routing-activation.ts'], stdoutMaxLines: 6, stdoutMaxBytes: 2048, stderrMaxLines: 4, stderrMaxBytes: 1024, schemaKind: 'CLOSED_GRAMMAR', schemaSource: 'git-index-six-records-v1', expected: { architectureBlobId: 'APPROVAL_BOUND_ARCHITECTURE_PLAN_BLOB_ID', recordCount: 6 }, evidenceClass: 'REPOSITORY_FILE_IDENTITY', dependencies: GIT_DEPENDENCIES }),
  record({ commandId: 'F0-GIT-08', executable: GIT[0], argv: ['diff', '--name-only', 'eae8f802a61b65a4d0336b3d1ba69f5bc341bbff..HEAD'], stdoutMaxLines: 256, stdoutMaxBytes: 32768, stderrMaxLines: 4, stderrMaxBytes: 1024, schemaKind: 'CLOSED_GRAMMAR', schemaSource: 'repository-relative-paths-v1', expected: { allPathsRepositoryRelative: true, coreChangedPathCount: 0 }, evidenceClass: 'REPOSITORY_SCOPE_REDACTED', dependencies: GIT_DEPENDENCIES, redactionPolicy: 'digest-paths-v1' }),
  record({ commandId: 'F1-SRC-01', executable: '/usr/bin/sed', argv: ['-n', '278,289p', 'apps/chunsik/src/tools/provider-generation-execution.ts'], stdoutMaxLines: 12, stdoutMaxBytes: 4096, stderrMaxLines: 4, stderrMaxBytes: 1024, schemaKind: 'CLOSED_GRAMMAR', schemaSource: 'source-markers-f1-src-01-v1', expected: { prePostPhaseTypePresent: true, runPreflightDelegatedPresent: true, singleHarnessIncrementPresent: true }, evidenceClass: 'STATIC_CURRENT_PATH_EVIDENCE', dependencies: SOURCE_DEPENDENCIES }),
  record({ commandId: 'F1-SRC-02', executable: '/usr/bin/sed', argv: ['-n', '277,353p', 'apps/chunsik/src/tools/provider-generation-validation.ts'], stdoutMaxLines: 77, stdoutMaxBytes: 16384, stderrMaxLines: 4, stderrMaxBytes: 1024, schemaKind: 'CLOSED_GRAMMAR', schemaSource: 'source-markers-f1-src-02-v1', expected: { gatewayExecuteCallCount: 1, preflightPostCallCount: 1, preflightPreCallCount: 1, providerRunnerGuardMaximum: 1 }, evidenceClass: 'STATIC_CURRENT_PATH_EVIDENCE', dependencies: SOURCE_DEPENDENCIES }),
  record({ commandId: 'F1-SRC-03', executable: '/usr/bin/sed', argv: ['-n', '98,126p', 'apps/chunsik/src/provider-routing/ollama-preflight/preflight.ts'], stdoutMaxLines: 29, stdoutMaxBytes: 8192, stderrMaxLines: 4, stderrMaxBytes: 1024, schemaKind: 'CLOSED_GRAMMAR', schemaSource: 'source-markers-f1-src-03-v1', expected: { inventoryRunnerCallCount: 1, orderedVersionBeforeInventory: true, versionRunnerCallCount: 1 }, evidenceClass: 'STATIC_CURRENT_PATH_EVIDENCE', dependencies: SOURCE_DEPENDENCIES }),
  record({ commandId: 'F1-SRC-04', executable: '/usr/bin/sed', argv: ['-n', '102,134p', 'apps/chunsik/src/provider-routing/provider-routing-activation.ts'], stdoutMaxLines: 33, stdoutMaxBytes: 8192, stderrMaxLines: 4, stderrMaxBytes: 1024, schemaKind: 'CLOSED_GRAMMAR', schemaSource: 'source-markers-f1-src-04-v1', expected: { legacyEarlyReturnPresent: true, scopeMismatchThrows: true, verificationBeforeConfiguration: true }, evidenceClass: 'STATIC_ACTIVATION_CONTRACT', dependencies: SOURCE_DEPENDENCIES }),
  record({ commandId: 'F1-PATH-01', executable: '/usr/bin/readlink', argv: ['/usr/local/bin/docker'], stdoutMaxLines: 1, stdoutMaxBytes: 256, stderrMaxLines: 1, stderrMaxBytes: 512, schemaKind: 'PATTERN', schemaSource: '^/Applications/OrbStack\\.app/Contents/MacOS/xbin/docker\\n?$', expected: { pathExists: true, symlinkTarget: '/Applications/OrbStack.app/Contents/MacOS/xbin/docker' }, evidenceClass: 'INSTALLED_PATH_METADATA', dependencies: SYMBOLS }),
  record({ commandId: 'F1-PATH-02', executable: '/usr/bin/stat', argv: ['-L', '-f', '%HT|%Sp|%u|%g|%z', '/usr/local/bin/docker'], stdoutMaxLines: 1, stdoutMaxBytes: 256, stderrMaxLines: 1, stderrMaxBytes: 512, schemaKind: 'CLOSED_GRAMMAR', schemaSource: 'stat-five-field-regular-v1', expected: { fileType: 'Regular File' }, evidenceClass: 'INSTALLED_PATH_METADATA', dependencies: SYMBOLS }),
  record({ commandId: 'F1-PATH-03', executable: '/usr/bin/stat', argv: ['-f', '%HT|%Sp|%u|%g|%z', '/Applications/OrbStack.app'], stdoutMaxLines: 1, stdoutMaxBytes: 256, stderrMaxLines: 1, stderrMaxBytes: 512, schemaKind: 'CLOSED_GRAMMAR', schemaSource: 'stat-five-field-directory-v1', expected: { fileType: 'Directory', pathExists: true }, evidenceClass: 'INSTALLED_PATH_METADATA', dependencies: SYMBOLS }),
]);

export const ALLOWLIST_CONTRACT: AllowlistContract = Object.freeze({
  contractVersion: ALLOWLIST_CONTRACT_VERSION,
  canonicalizationVersion: ALLOWLIST_CANONICALIZATION_VERSION,
  evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
  patternDialect: PATTERN_DIALECT,
  patternDialectVersion: PATTERN_DIALECT_VERSION,
  regexDocumentRepresentation: REGEX_DOCUMENT_REPRESENTATION,
  approvalBoundSymbolPolicyVersion: APPROVAL_BOUND_SYMBOL_POLICY_VERSION,
  rawOutputPolicyVersion: RAW_OUTPUT_POLICY_VERSION,
  mismatchPolicyVersion: MISMATCH_POLICY_VERSION,
  streamPrecedencePolicyVersion: STREAM_PRECEDENCE_POLICY_VERSION,
  records: TIER_A_RECORDS,
});
