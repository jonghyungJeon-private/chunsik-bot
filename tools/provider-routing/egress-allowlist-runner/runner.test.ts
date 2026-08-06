import { describe, expect, it } from 'vitest';
import { ALLOWLIST_CONTRACT, TIER_A_COMMAND_IDS, TIER_A_RECORDS } from './allowlist';
import { canonicalize, sha256 } from './canonical';
import { ApprovalSymbolTable, ExecutableIdentity, FixtureProcessResult } from './contracts';
import {
  AllowlistError,
  FixtureAllowedCommandExecutor,
  assertClosedEvidence,
  createStaticAllowlistDigest,
  evaluateFixture,
  isDispatchable,
  resolveApprovalSymbols,
  validateContract,
} from './runner';

const encoder = new TextEncoder();
const SYMBOLS: ApprovalSymbolTable = Object.freeze({
  APPROVAL_BOUND_HEAD_SHA: '1'.repeat(40),
  APPROVAL_BOUND_ARCHITECTURE_PLAN_BLOB_ID: '2'.repeat(40),
  APPROVAL_BOUND_GIT_VERSION_LINE: 'git version 2.39.5 (Apple Git-154)',
});
const IDENTITY: ExecutableIdentity = Object.freeze({
  realpath: '/usr/bin/git', fileType: 'REGULAR_FILE', device: 1, inode: 2, mode: 493,
  uid: 0, gid: 0, sizeBytes: 100, codeSignature: 'fixture-signature',
});
const DIGEST = createStaticAllowlistDigest(SYMBOLS).digest;

function process(stdout: string, stderr = '', exitCode = 0): FixtureProcessResult {
  return { stdout: encoder.encode(stdout), stderr: encoder.encode(stderr), exitCode };
}

function evaluate(commandId: string, result: FixtureProcessResult, options: {
  readonly dependencies?: ReadonlySet<string>;
  readonly identity?: ExecutableIdentity;
  readonly capability?: boolean;
  readonly schemaValid?: boolean;
} = {}) {
  const record = TIER_A_RECORDS.find((entry) => entry.commandId === commandId);
  if (record === undefined) throw new Error('fixture record missing');
  const identity = options.identity ?? { ...IDENTITY, realpath: record.expectedRealpath };
  return evaluateFixture({
    record,
    processResult: result,
    approvedIdentity: identity,
    identityVerifier: options.capability === false ? undefined : { verify: () => identity },
    satisfiedDependencies: options.dependencies ?? new Set(['SYMBOL_TABLE:RESOLVED', 'F0-GIT-00:SUCCESS', 'F0-GIT-07:SUCCESS']),
    normalizedFacts: record.expectedNormalizedFacts,
    schemaValid: options.schemaValid ?? true,
    allowlistDigest: DIGEST,
    repositoryHead: '1'.repeat(40),
    observedAt: '2026-08-06T00:00:00Z',
  });
}

describe('canonical allowlist contract', () => {
  it('recursively canonicalizes independent of insertion order', () => {
    expect(canonicalize({ z: { b: 2, a: 1 }, a: true })).toBe(canonicalize({ a: true, z: { a: 1, b: 2 } }));
  });

  it('preserves array order', () => {
    expect(canonicalize(['a', 'b'])).not.toBe(canonicalize(['b', 'a']));
  });

  it('produces identical digests for semantic equivalents', () => {
    expect(sha256(canonicalize({ b: 2, a: 1 }))).toBe(sha256(canonicalize({ a: 1, b: 2 })));
  });

  it('changes digest when a policy version changes', () => {
    const resolved = resolveApprovalSymbols(ALLOWLIST_CONTRACT, SYMBOLS);
    expect(sha256(canonicalize({ ...resolved, rawOutputPolicyVersion: 'changed' }))).not.toBe(sha256(canonicalize(resolved)));
  });

  it('changes digest when a dependency changes', () => {
    const resolved = resolveApprovalSymbols(ALLOWLIST_CONTRACT, SYMBOLS);
    const records = resolved.records.map((entry, index) => index === 0 ? { ...entry, explicitDependencies: ['changed'] } : entry);
    expect(sha256(canonicalize({ ...resolved, records }))).not.toBe(sha256(canonicalize(resolved)));
  });

  it('changes digest when a regex source changes', () => {
    const resolved = resolveApprovalSymbols(ALLOWLIST_CONTRACT, SYMBOLS);
    const records = resolved.records.map((entry, index) => index === 0 ? { ...entry, outputSchema: { ...entry.outputSchema, source: 'changed' } } : entry);
    expect(sha256(canonicalize({ ...resolved, records }))).not.toBe(sha256(canonicalize(resolved)));
  });

  it('excludes observed timestamps from the static digest', () => {
    expect(canonicalize(resolveApprovalSymbols(ALLOWLIST_CONTRACT, SYMBOLS))).not.toContain('observedAt');
  });

  it.each([
    ['unknown', { ...SYMBOLS, APPROVAL_BOUND_UNKNOWN: 'x' }],
    ['missing', { APPROVAL_BOUND_HEAD_SHA: SYMBOLS.APPROVAL_BOUND_HEAD_SHA, APPROVAL_BOUND_ARCHITECTURE_PLAN_BLOB_ID: SYMBOLS.APPROVAL_BOUND_ARCHITECTURE_PLAN_BLOB_ID }],
    ['extra', { ...SYMBOLS, EXTRA: 'x' }],
  ])('rejects %s symbol tables', (_label, symbols) => {
    expect(() => resolveApprovalSymbols(ALLOWLIST_CONTRACT, symbols)).toThrowError(AllowlistError);
  });

  it('prevents symbolic content from reaching canonical bytes', () => {
    expect(createStaticAllowlistDigest(SYMBOLS).bytes).not.toContain('APPROVAL_BOUND_HEAD_SHA');
  });

  it('rejects an approval-bound Git line outside the accepted pattern', () => {
    expect(() => createStaticAllowlistDigest({ ...SYMBOLS, APPROVAL_BOUND_GIT_VERSION_LINE: 'git version 2.0 trailing' })).toThrow('APPROVAL_BOUND_GIT_VERSION_LINE_MISMATCH');
  });

  it('rejects non-integers, null and undefined', () => {
    expect(() => canonicalize(1.5)).toThrow('CANONICAL_INTEGER_REQUIRED');
    expect(() => canonicalize(null)).toThrow('CANONICAL_VALUE_REJECTED');
    expect(() => canonicalize({ value: undefined })).toThrow('CANONICAL_UNDEFINED_REJECTED');
  });
});

describe('patterns and dependencies', () => {
  const gitPattern = new RegExp(TIER_A_RECORDS[0]?.outputSchema.source ?? '', 'u');
  const divergencePattern = new RegExp(TIER_A_RECORDS[4]?.outputSchema.source ?? '', 'u');

  it('accepts normal and bounded Apple-style Git versions', () => {
    expect(gitPattern.test('git version 2.39.5\n')).toBe(true);
    expect(gitPattern.test('git version 2.39.5 (Apple Git-154)\n')).toBe(true);
  });

  it('rejects arbitrary Git-version trailing text', () => {
    expect(gitPattern.test('git version 2.39.5 arbitrary trailing text\n')).toBe(false);
  });

  it('rejects multiline Git-version output', () => {
    expect(gitPattern.test('git version 2.39.5\nextra\n')).toBe(false);
  });

  it('accepts only the approved tab-separated divergence', () => {
    expect(divergencePattern.test('0\t10\n')).toBe(true);
    expect(divergencePattern.test('0\t9\n')).toBe(false);
  });

  it('blocks Git records before Git identity succeeds', () => {
    expect(isDispatchable(TIER_A_RECORDS[1]!, new Set(['SYMBOL_TABLE:RESOLVED']))).toEqual({ dispatchable: false, reason: 'GIT_IDENTITY_NOT_ESTABLISHED' });
  });

  it('blocks source reads before accepted blob identities succeed', () => {
    expect(isDispatchable(TIER_A_RECORDS[9]!, new Set(['SYMBOL_TABLE:RESOLVED']))).toEqual({ dispatchable: false, reason: 'GIT_IDENTITY_NOT_ESTABLISHED' });
  });
});

describe('fixture-only evaluation', () => {
  it('blocks executable mismatch before fixture dispatch result is accepted', () => {
    const bad = { ...IDENTITY, realpath: '/wrong' };
    expect(evaluate('F0-GIT-01', process('main\n'), { identity: bad }).stopReason).toBe('EXECUTABLE_MISMATCH');
  });

  it('blocks missing identity capability', () => {
    expect(evaluate('F0-GIT-01', process('main\n'), { capability: false }).stopReason).toBe('COMMAND_SAFETY_BLOCKED');
  });

  it('enforces stdout and stderr cap precedence', () => {
    expect(evaluate('F0-GIT-01', process('x'.repeat(65))).stopReason).toBe('STDOUT_OUTPUT_LIMIT_EXCEEDED');
    expect(evaluate('F0-GIT-01', process('', 'x'.repeat(513))).stopReason).toBe('STDERR_OUTPUT_LIMIT_EXCEEDED');
    expect(evaluate('F0-GIT-01', process('x'.repeat(65), 'x'.repeat(513))).stopReason).toBe('BOTH_STREAM_OUTPUT_LIMIT_EXCEEDED');
  });

  it('classifies bounded non-empty stderr after cap checks', () => {
    expect(evaluate('F0-GIT-01', process('main\n', 'warning')).exitClass).toBe('STDERR_NONEMPTY');
  });

  it('rejects schema mismatch without partial facts', () => {
    const evidence = evaluate('F0-GIT-01', process('other\n'));
    expect(evidence.stopReason).toBe('PATTERN_MISMATCH');
    expect(evidence.normalizedFacts).toEqual({});
  });

  it('keeps all failure evidence facts empty', () => {
    expect(evaluate('F0-GIT-01', process('', '', 1)).normalizedFacts).toEqual({});
  });

  it('maps a nonzero fixture exit deterministically', () => {
    const evidence = evaluate('F0-GIT-01', process('', '', 7));
    expect([evidence.exitClass, evidence.stopReason]).toEqual(['EXECUTION_ERROR', 'NONZERO_EXIT']);
  });

  it('rejects invalid UTF-8 without facts', () => {
    const evidence = evaluate('F0-GIT-01', { exitCode: 0, stdout: new Uint8Array([0xff]), stderr: new Uint8Array() });
    expect([evidence.stopReason, evidence.normalizedFacts]).toEqual(['INVALID_UTF8', {}]);
  });

  it('creates closed success evidence without raw streams', () => {
    const evidence = evaluate('F0-GIT-01', process('main\n'));
    expect(evidence.stopReason).toBe('NONE');
    expect('stdout' in evidence || 'stderr' in evidence).toBe(false);
    expect(() => assertClosedEvidence(evidence as unknown as Record<string, unknown>)).not.toThrow();
    expect(() => assertClosedEvidence({ ...evidence, unknown: true })).toThrow('EVIDENCE_UNKNOWN_FIELD');
  });
});

describe('executable contract boundary', () => {
  it('pins exactly 16 accepted command ids and excludes templates', () => {
    validateContract(ALLOWLIST_CONTRACT);
    expect(TIER_A_RECORDS).toHaveLength(16);
    expect(TIER_A_RECORDS.map((entry) => entry.commandId)).toEqual(TIER_A_COMMAND_IDS);
    expect(TIER_A_RECORDS.some((entry) => entry.commandId.includes('MAN'))).toBe(false);
  });

  it('rejects unknown machine-contract fields', () => {
    expect(() => validateContract({ ...ALLOWLIST_CONTRACT, unknown: true } as typeof ALLOWLIST_CONTRACT)).toThrow('ALLOWLIST_CONTRACT_SCHEMA_MISMATCH');
  });

  it('classifies every Tier A record as no local daemon contact', () => {
    expect(TIER_A_RECORDS.every((entry) => entry.localDaemonContact === 'NONE')).toBe(true);
  });

  it('contains no production executor implementation', () => {
    expect(TIER_A_RECORDS.every((entry) => entry.processLifecyclePolicy === 'ONE_BOUNDED_CHILD_NO_DESCENDANTS')).toBe(true);
  });

  it('uses a preloaded fixture executor without host dispatch', async () => {
    const executor = new FixtureAllowedCommandExecutor({ 'F0-GIT-01': process('main\n') });
    await expect(executor.execute(TIER_A_RECORDS[1]!)).resolves.toEqual(process('main\n'));
    expect(executor.invocationCount).toBe(1);
  });
});
