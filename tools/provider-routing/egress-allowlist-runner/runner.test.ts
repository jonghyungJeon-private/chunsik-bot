import { describe, expect, it } from 'vitest';
import { ALLOWLIST_CONTRACT, TIER_A_COMMAND_IDS, TIER_A_RECORDS } from './allowlist';
import { CanonicalizationError, canonicalize, sha256 } from './canonical';
import {
  AllowlistContract, AllowlistRecord, ApprovalSymbolTable, CommandEvidence, ExecutableIdentity,
  ExecutionBaselineBinding, FixtureProcessResult,
} from './contracts';
import {
  AllowlistError, DependencyState, FixtureAllowedCommandExecutor, assertClosedEvidence,
  createExecutionBaselineBindingDigest, createStaticAllowlistDigest, deriveDependencyState,
  evaluateFixture, isDispatchable, resolveApprovalSymbols, validateContract,
} from './runner';

const encoder = new TextEncoder();
const SYMBOLS: ApprovalSymbolTable = Object.freeze({
  APPROVAL_BOUND_HEAD_SHA: '1'.repeat(40),
  APPROVAL_BOUND_ARCHITECTURE_PLAN_BLOB_ID: '2'.repeat(40),
  APPROVAL_BOUND_GIT_VERSION_LINE: 'git version 2.39.5 (Apple Git-154)',
});
const STATIC = createStaticAllowlistDigest(SYMBOLS);
const ROOT = TIER_A_RECORDS[0]!.workingDirectory;
const HEAD = '1'.repeat(40);
const IDENTITY: ExecutableIdentity = Object.freeze({
  realpath: '/usr/bin/git', fileType: 'REGULAR_FILE', device: 1, inode: 2, mode: 493,
  uid: 0, gid: 0, sizeBytes: 100, codeSignature: 'fixture-signature',
});
const BASELINE: ExecutionBaselineBinding = Object.freeze({
  branch: 'main', repositoryHead: HEAD, repositoryParent: '0'.repeat(40), originMain: '2'.repeat(40), expectedBehindCount: 0,
  expectedAheadCount: 12, trackedClean: true, stagedClean: true, untrackedCount: 32,
  untrackedPolicy: 'PRESERVE_EXACT_COUNT', repositoryRoot: ROOT, allowlistDocumentBlobId: '4'.repeat(40),
  architecturePlanBlobId: '5'.repeat(40), staticAllowlistDigest: STATIC.digest,
  sequencerPolicy: { version: 'stage2b-5c-eg-f0-stop-first-sequencer-v1', stopOnFirstFailure: true },
  processAdapterPolicy: { version: 'stage2b-5c-eg-f0-process-adapter-v1', topology: 'ONE_BOUNDED_CHILD_NO_DESCENDANTS', timeoutMs: 5000 },
  streamAdapterPolicy: { version: 'stage2b-5c-eg-f0-real-stream-adapter-v1', maxSegmentBytes: 4096, maxPendingSegmentsPerStream: 1 },
  terminationPolicy: { version: 'stage2b-5c-eg-f0-exact-child-termination-v1', termSignal: 'SIGTERM', termGraceMs: 500, killSignal: 'SIGKILL', closeDeadlineMs: 500 },
  environmentPolicy: { version: 'stage2b-5c-eg-f0-host-environment-v1', environment: { LANG: 'C', LC_ALL: 'C' } },
  executableIdentityPolicy: { version: 'stage2b-5c-eg-f0-executable-identity-v1', immediatePreDispatchRecheck: true },
});
const DEPENDENCY_CONTEXT = Object.freeze({ allowlistDigest: STATIC.digest, executionBaselineDigest: 'fixture-baseline-digest',
  sequencerRunId: 'fixture-run', sequenceIndex: 16, repositoryHead: HEAD, workingDirectory: ROOT });

function chunks(...values: (string | Uint8Array)[]): readonly Uint8Array[] {
  return values.map((value) => typeof value === 'string' ? encoder.encode(value) : value);
}

function process(stdout: readonly Uint8Array[] = [], stderr: readonly Uint8Array[] = [], exitCode = 0): FixtureProcessResult {
  return { stdoutChunks: stdout, stderrChunks: stderr, exitCode };
}

function evidence(commandId: string, overrides: Partial<CommandEvidence> = {}): CommandEvidence {
  const record = STATIC.contract.records.find((entry) => entry.commandId === commandId);
  return {
    contractVersion: 'stage2b-5c-eg-f0-command-evidence-v1', schemaVersion: 'stage2b-5c-eg-f0-command-evidence-schema-v2',
    allowlistDigest: STATIC.digest, executionBaselineDigest: 'fixture-baseline-digest', sequencerRunId: 'fixture-run',
    commandOrderVersion: 'stage2b-5c-eg-f0-command-order-v1', sequenceIndex: record === undefined ? 0 : STATIC.contract.records.indexOf(record),
    commandId, executableRealpath: '/usr/bin/git', executableIdentity: IDENTITY,
    argvDigest: record === undefined ? '3'.repeat(64) : sha256(canonicalize(record.argv)), workingDirectory: ROOT, repositoryBranch: 'main', repositoryHead: HEAD,
    privilegeClass: 'UNPRIVILEGED', localDaemonContact: 'NONE', exitClass: 'SUCCESS', stopReason: 'NONE',
    processExitCode: 0, processSignal: 'NONE',
    stdoutByteCount: 0, stderrByteCount: 0, normalizedFacts: {}, redactionCount: 0, outputTruncated: false,
    normalizationResult: 'SUCCESS', evidenceClass: record?.evidenceClass ?? 'FIXTURE', observedAt: '2026-08-06T00:00:00Z', ...overrides,
  };
}

function dependencyState(priorEvidence: readonly CommandEvidence[] = []): DependencyState {
  return deriveDependencyState({
    symbolResolution: STATIC.symbolResolution, priorEvidence, allowlistDigest: STATIC.digest,
    executionBaselineDigest: 'fixture-baseline-digest', sequencerRunId: 'fixture-run', sequenceIndex: 16,
    repositoryHead: HEAD, workingDirectory: ROOT,
  });
}

function evaluate(record: AllowlistRecord, result: FixtureProcessResult, options: {
  readonly state?: DependencyState;
  readonly identity?: ExecutableIdentity;
  readonly capability?: boolean;
  readonly facts?: Readonly<Record<string, string | number | boolean>>;
  readonly schemaValid?: boolean;
  readonly baseline?: ExecutionBaselineBinding;
} = {}) {
  const identity = options.identity ?? { ...IDENTITY, realpath: record.expectedRealpath };
  return evaluateFixture({
    record, processResult: result, approvedIdentity: identity,
    identityVerifier: options.capability === false ? undefined : { verify: () => identity },
    dependencyState: options.state ?? dependencyState([
      evidence('F0-GIT-00'), evidence('F0-GIT-07'),
    ]),
    normalizedFacts: options.facts ?? record.expectedNormalizedFacts, schemaValid: options.schemaValid ?? true,
    allowlistDigest: STATIC.digest, repositoryHead: HEAD, observedAt: '2026-08-06T00:00:00Z',
    executionBaseline: options.baseline,
  });
}

function contractWith(records: readonly AllowlistRecord[]): AllowlistContract {
  return { ...ALLOWLIST_CONTRACT, records };
}

describe('hardened canonicalization', () => {
  it('is stable across recursive insertion orders', () => {
    expect(canonicalize({ z: { b: 2, a: 1 }, a: true })).toBe(canonicalize({ a: true, z: { a: 1, b: 2 } }));
  });
  it('preserves array order', () => expect(canonicalize(['a', 'b'])).not.toBe(canonicalize(['b', 'a'])));
  it('orders Unicode code points rather than UTF-16 units', () => {
    expect(canonicalize({ '\u{10000}': 1, '\uE000': 2 })).toBe('{"":2,"𐀀":1}');
  });
  it.each([
    ['negative zero', -0, 'CANONICAL_INTEGER_REQUIRED'],
    ['float', 1.5, 'CANONICAL_INTEGER_REQUIRED'],
    ['NaN', Number.NaN, 'CANONICAL_INTEGER_REQUIRED'],
    ['Infinity', Number.POSITIVE_INFINITY, 'CANONICAL_INTEGER_REQUIRED'],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1, 'CANONICAL_INTEGER_REQUIRED'],
    ['undefined', undefined, 'CANONICAL_VALUE_REJECTED'],
    ['null', null, 'CANONICAL_VALUE_REJECTED'],
    ['function', () => undefined, 'CANONICAL_VALUE_REJECTED'],
    ['symbol value', Symbol('x'), 'CANONICAL_VALUE_REJECTED'],
    ['bigint', 1n, 'CANONICAL_VALUE_REJECTED'],
    ['Date', new Date(0), 'CANONICAL_PROTOTYPE_REJECTED'],
    ['Map', new Map(), 'CANONICAL_PROTOTYPE_REJECTED'],
    ['Set', new Set(), 'CANONICAL_PROTOTYPE_REJECTED'],
    ['RegExp', /x/u, 'CANONICAL_PROTOTYPE_REJECTED'],
    ['boxed primitive', new Number(1), 'CANONICAL_PROTOTYPE_REJECTED'],
    ['class instance', new (class Fixture {})(), 'CANONICAL_PROTOTYPE_REJECTED'],
  ])('rejects %s', (_label, value, code) => {
    expect(() => canonicalize(value)).toThrowError(new CanonicalizationError(code));
  });
  it('rejects sparse arrays', () => {
    const sparse = new Array(2); sparse[1] = 'x';
    expect(() => canonicalize(sparse)).toThrow('CANONICAL_SPARSE_ARRAY_REJECTED');
  });
  it('rejects symbol-keyed objects', () => {
    expect(() => canonicalize({ [Symbol('x')]: true })).toThrow('CANONICAL_SYMBOL_KEY_REJECTED');
  });
  it('rejects cyclic input deterministically', () => {
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    expect(() => canonicalize(cyclic)).toThrow('CANONICAL_CYCLE_REJECTED');
  });
  it('changes static digest for policy, dependency, and regex changes', () => {
    const resolved = resolveApprovalSymbols(ALLOWLIST_CONTRACT, SYMBOLS);
    const dependencyRecords = resolved.records.map((entry, index) => index === 0 ? { ...entry, explicitDependencies: ['changed'] } : entry);
    const regexRecords = resolved.records.map((entry, index) => index === 0 ? { ...entry, outputSchema: { ...entry.outputSchema, source: 'changed' } } : entry);
    expect(new Set([
      sha256(canonicalize(resolved)),
      sha256(canonicalize({ ...resolved, rawOutputPolicyVersion: 'changed' })),
      sha256(canonicalize({ ...resolved, records: dependencyRecords })),
      sha256(canonicalize({ ...resolved, records: regexRecords })),
    ]).size).toBe(4);
  });
  it('keeps baseline values outside the static digest and inside baseline digest', () => {
    expect(STATIC.bytes).not.toContain('expectedAheadCount');
    expect(createExecutionBaselineBindingDigest(BASELINE)).not.toBe(createExecutionBaselineBindingDigest({ ...BASELINE, expectedAheadCount: 13 }));
  });
});

describe('closed symbols and validated dependencies', () => {
  it.each([
    ['unknown', { ...SYMBOLS, APPROVAL_BOUND_UNKNOWN: 'x' }],
    ['missing', { APPROVAL_BOUND_HEAD_SHA: HEAD, APPROVAL_BOUND_ARCHITECTURE_PLAN_BLOB_ID: '2'.repeat(40) }],
    ['extra', { ...SYMBOLS, EXTRA: 'x' }],
  ])('rejects %s symbols', (_label, symbols) => {
    expect(() => createStaticAllowlistDigest(symbols)).toThrowError(AllowlistError);
  });
  it('rejects a forged arbitrary dependency state', () => {
    const forged = { established: ['SYMBOL_TABLE:RESOLVED', 'F0-GIT-00:SUCCESS'], ...DEPENDENCY_CONTEXT };
    expect(isDispatchable(TIER_A_RECORDS[1]!, forged, DEPENDENCY_CONTEXT)).toEqual({ dispatchable: false, reason: 'DEPENDENCY_NOT_ESTABLISHED' });
  });
  it('derives command success only from validated successful evidence', () => {
    expect(dependencyState([evidence('F0-GIT-00')]).established).toContain('F0-GIT-00:SUCCESS');
    expect(dependencyState([evidence('F0-GIT-00', { exitClass: 'EXECUTION_ERROR', stopReason: 'NONZERO_EXIT', normalizationResult: 'REJECTED' })]).established).not.toContain('F0-GIT-00:SUCCESS');
  });
  it('rejects symbol resolution paired with the wrong current digest', () => {
    expect(() => deriveDependencyState({
      symbolResolution: STATIC.symbolResolution, priorEvidence: [], allowlistDigest: 'wrong',
      repositoryHead: HEAD, workingDirectory: ROOT,
    })).toThrow('ALLOWLIST_UNRESOLVED');
  });
  it('rejects replay from wrong digest, HEAD, and working directory', () => {
    const state = dependencyState([
      evidence('A', { allowlistDigest: 'wrong' }), evidence('B', { repositoryHead: 'wrong' }),
      evidence('C', { workingDirectory: '/wrong' }),
    ]);
    expect(state.established).toEqual(['SYMBOL_TABLE:RESOLVED']);
  });
  it('binds the derived state itself to digest, HEAD, and working directory', () => {
    const state = dependencyState([evidence('F0-GIT-00')]);
    expect(isDispatchable(TIER_A_RECORDS[1]!, state, { ...DEPENDENCY_CONTEXT, repositoryHead: 'wrong' }).reason)
      .toBe('DEPENDENCY_NOT_ESTABLISHED');
  });
  it('uses Git-specific and mechanism-neutral missing dependency reasons', () => {
    const symbolsOnly = dependencyState();
    expect(isDispatchable(TIER_A_RECORDS[1]!, symbolsOnly, DEPENDENCY_CONTEXT).reason).toBe('GIT_IDENTITY_NOT_ESTABLISHED');
    expect(isDispatchable(TIER_A_RECORDS[9]!, symbolsOnly, DEPENDENCY_CONTEXT).reason).toBe('DEPENDENCY_NOT_ESTABLISHED');
  });
  it('does not consume fixture chunks before dependency validation', () => {
    const result = evaluate(TIER_A_RECORDS[9]!, process(chunks(new Uint8Array([0xff]))), { state: dependencyState() });
    expect([result.exitClass, result.stopReason, result.stdoutByteCount]).toEqual(['DEPENDENCY_UNSATISFIED', 'DEPENDENCY_NOT_ESTABLISHED', 0]);
  });
  it('rejects unknown, duplicate, self, and cyclic dependencies', () => {
    const replace = (id: string, dependencies: readonly string[]) => ALLOWLIST_CONTRACT.records.map((entry) => entry.commandId === id ? { ...entry, explicitDependencies: dependencies } : entry);
    expect(() => validateContract(contractWith(replace('F0-GIT-01', ['SYMBOL_TABLE:RESOLVED', 'UNKNOWN:SUCCESS'])))).toThrow('UNKNOWN_DEPENDENCY');
    expect(() => validateContract(contractWith(replace('F0-GIT-01', ['SYMBOL_TABLE:RESOLVED', 'SYMBOL_TABLE:RESOLVED'])))).toThrow('DUPLICATE_DEPENDENCY');
    expect(() => validateContract(contractWith(replace('F0-GIT-01', ['SYMBOL_TABLE:RESOLVED', 'F0-GIT-01:SUCCESS'])))).toThrow('SELF_DEPENDENCY');
    const cyclic = ALLOWLIST_CONTRACT.records.map((entry) => entry.commandId === 'F0-GIT-00' ? { ...entry, explicitDependencies: ['SYMBOL_TABLE:RESOLVED', 'F0-GIT-01:SUCCESS'] } : entry);
    expect(() => validateContract(contractWith(cyclic))).toThrow('DEPENDENCY_CYCLE');
  });
});

describe('chunked fixture stream safety', () => {
  const branch = TIER_A_RECORDS[1]!;
  it('fails closed when a fixture is missing', async () => {
    await expect(new FixtureAllowedCommandExecutor({}).execute(branch)).rejects.toThrow('FIXTURE_RESULT_MISSING');
  });
  it('handles a multibyte UTF-8 code point across chunks before pattern rejection', () => {
    const bytes = encoder.encode('máin\n');
    const result = evaluate(branch, process([bytes.slice(0, 2), bytes.slice(2)]));
    expect(result.stopReason).toBe('PATTERN_MISMATCH');
  });
  it('counts UTF-8 bytes rather than characters', () => {
    const record = { ...branch, stdoutMaxBytes: 2 };
    expect(evaluate(record, process(chunks('é'))).stopReason).toBe('PATTERN_MISMATCH');
    expect(evaluate({ ...record, stdoutMaxBytes: 1 }, process(chunks('é'))).stopReason).toBe('STDOUT_OUTPUT_LIMIT_EXCEEDED');
  });
  it('normalizes CR-only and split CRLF', () => {
    expect(evaluate(branch, process(chunks('main\r'))).exitClass).toBe('SUCCESS');
    expect(evaluate(branch, process(chunks('main\r', '\n'))).exitClass).toBe('SUCCESS');
  });
  it('allows cap equality and rejects one byte beyond', () => {
    const exact = { ...branch, stdoutMaxBytes: 5 };
    expect(evaluate(exact, process(chunks('main\n'))).exitClass).toBe('SUCCESS');
    expect(evaluate({ ...exact, stdoutMaxBytes: 4 }, process(chunks('main\n'))).stopReason).toBe('STDOUT_OUTPUT_LIMIT_EXCEEDED');
    const stderrExact = { ...branch, stderrMaxBytes: 1 };
    expect(evaluate(stderrExact, process(chunks('main\n'), chunks('x'))).stopReason).toBe('STDERR_NONEMPTY');
  });
  it('preserves both-stream precedence with separate chunks', () => {
    expect(evaluate(branch, process(chunks('x'.repeat(65)), chunks('x'.repeat(513)))).stopReason).toBe('BOTH_STREAM_OUTPUT_LIMIT_EXCEEDED');
  });
  it('rejects invalid UTF-8 split across chunks', () => {
    expect(evaluate(branch, process([new Uint8Array([0xc3]), new Uint8Array([0x28])])).stopReason).toBe('INVALID_UTF8');
  });
  it('normalizes divergence columns as behind then ahead and compares baseline', () => {
    const divergence = TIER_A_RECORDS[4]!;
    const success = evaluate(divergence, process(chunks('0\t12\n')), { baseline: BASELINE });
    expect(success.normalizedFacts).toEqual({ behindCount: 0, aheadCount: 12 });
    expect(evaluate(divergence, process(chunks('0\t11\n')), { baseline: BASELINE }).stopReason).toBe('BASELINE_MISMATCH');
  });
});

describe('executable contract completeness', () => {
  it('pins exactly 16 ids and excludes templates', () => {
    validateContract(ALLOWLIST_CONTRACT);
    expect(TIER_A_RECORDS.map((entry) => entry.commandId)).toEqual(TIER_A_COMMAND_IDS);
    expect(TIER_A_RECORDS).toHaveLength(16);
    expect(TIER_A_RECORDS.some((entry) => entry.commandId.includes('MAN'))).toBe(false);
  });
  it('fixes candidate approval status and daemon classification on all records', () => {
    expect(TIER_A_RECORDS.every((entry) => entry.approvalStatus === 'CANDIDATE_ONLY_NOT_APPROVED')).toBe(true);
    expect(TIER_A_RECORDS.every((entry) => entry.localDaemonContact === 'NONE')).toBe(true);
  });
  it('carries complete, ordered, duplicate-free stop conditions', () => {
    for (const record of TIER_A_RECORDS) expect(new Set(record.stopConditions).size).toBe(record.stopConditions.length);
    expect(() => validateContract(ALLOWLIST_CONTRACT)).not.toThrow();
  });
  it('keeps evidence closed and raw-stream-free', () => {
    const result = evaluate(TIER_A_RECORDS[1]!, process(chunks('main\n')));
    expect(() => assertClosedEvidence(result as unknown as Record<string, unknown>)).not.toThrow();
    expect('stdout' in result || 'stderr' in result || 'stdoutChunks' in result).toBe(false);
  });
  it('contains only the fixture executor boundary', async () => {
    const executor = new FixtureAllowedCommandExecutor({ 'F0-GIT-01': process(chunks('main\n')) });
    await expect(executor.execute(TIER_A_RECORDS[1]!)).resolves.toEqual(process(chunks('main\n')));
  });
});
