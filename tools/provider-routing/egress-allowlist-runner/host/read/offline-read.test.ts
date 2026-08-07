import { describe, expect, it } from 'vitest';
import { TIER_A_RECORDS } from '../../allowlist';
import { canonicalize } from '../../canonical';
import { createStaticAllowlistDigest } from '../../runner';
import {
  ApprovedPathToken, CODE_SIGN_GATE_EFFECT, CODE_SIGN_READ_FEASIBILITY, HostReadSequenceResult, Metadata,
  ScriptedExactHostReadPort, ScriptedReadEntry, XR_HOST_READ_EXECUTION, XR_LIMITS,
  XR_METADATA_EVIDENCE_EXECUTION_ELIGIBLE, XR_READ_ALLOWLIST, XR_READ_ALLOWLIST_VERSION, XR_READ_IDS,
  XR_REAL_FILESYSTEM_ADAPTER, assertApprovedPathToken, assertClosedHostReadEvidence, assertEvidenceSizeWithinCap,
  calculateEvidenceSize,
  createApprovedPathTokenTestHarness, createCallAccountingTestHarness, executablePaths,
  runApprovedHostReadSequence, validateXrReadAllowlist,
} from './offline-read';

const SYMBOLS = Object.freeze({ APPROVAL_BOUND_HEAD_SHA: '1'.repeat(40),
  APPROVAL_BOUND_ARCHITECTURE_PLAN_BLOB_ID: '2'.repeat(40),
  APPROVAL_BOUND_GIT_VERSION_LINE: 'git version 2.39.5 (Apple Git-154)' });
const CONTRACT = createStaticAllowlistDigest(SYMBOLS).contract;
const dir = (inode: number, mtime = 1): Metadata => Object.freeze({ fileType: 'DIRECTORY', device: 1, inode,
  uid: 0, gid: 0, mode: 493, size: 0, mtime });
const file = (inode: number, mtime = 1): Metadata => Object.freeze({ fileType: 'REGULAR_FILE', device: 1, inode,
  uid: 0, gid: 0, mode: 493, size: 100, mtime });
const symlink = (inode: number, mtime = 1): Metadata => Object.freeze({ fileType: 'SYMLINK', device: 1, inode,
  uid: 0, gid: 0, mode: 511, size: 4, mtime });
const paths = Object.freeze({ 'XR-EXEC-GIT': '/usr/bin/git', 'XR-EXEC-SED': '/usr/bin/sed',
  'XR-EXEC-READLINK': '/usr/bin/readlink', 'XR-EXEC-STAT': '/usr/bin/stat' } as const);
const context = Object.freeze({ identity: 'approved-xr-context', observedAt: '2026-08-07T00:00:00Z',
  expectedRealpaths: paths });
const entry = (readId: (typeof XR_READ_IDS)[number], pass: 'PRE_READ_PASS' | 'POST_READ_PASS',
  operation: ScriptedReadEntry['operation'], exactPath: string, callIndex: number,
  result: Metadata | string): ScriptedReadEntry => Object.freeze({ readId, approvedReadContextIdentity: context.identity,
  pass, operation, exactPath, callIndex, result });

function ordinaryRecordEntries(readId: (typeof XR_READ_IDS)[number], startInode = 10): ScriptedReadEntry[] {
  const configured = paths[readId]; const leaf = configured.split('/').at(-1)!; const result: ScriptedReadEntry[] = [];
  for (const [passIndex, pass] of (['PRE_READ_PASS', 'POST_READ_PASS'] as const).entries()) {
    const offset = passIndex * 5; result.push(entry(readId, pass, 'LSTAT', '/usr', offset + 1, dir(1)),
      entry(readId, pass, 'LSTAT', '/usr/bin', offset + 2, dir(2)),
      entry(readId, pass, 'LSTAT', `/usr/bin/${leaf}`, offset + 3, file(startInode)),
      entry(readId, pass, 'REALPATH', configured, offset + 4, configured),
      entry(readId, pass, 'STAT', configured, offset + 5, file(startInode)));
  }
  return result;
}
function ordinaryEntries(): ScriptedReadEntry[] {
  return XR_READ_IDS.flatMap((readId, index) => ordinaryRecordEntries(readId, 10 + index));
}
function normalPort(entries = ordinaryEntries()): ScriptedExactHostReadPort { return new ScriptedExactHostReadPort(entries); }
const complete = (): HostReadSequenceResult => runApprovedHostReadSequence(context, CONTRACT, normalPort());

function linkedGitEntries(target: string, postTarget = target, metadataMtime = 1): ScriptedReadEntry[] {
  const result: ScriptedReadEntry[] = [];
  for (const [passIndex, pass] of (['PRE_READ_PASS', 'POST_READ_PASS'] as const).entries()) {
    const selected = passIndex === 0 ? target : postTarget; const base = passIndex * 8;
    const normalized = selected.startsWith('/') ? selected : '/opt/bin'; const final = `${normalized}/git`;
    result.push(entry('XR-EXEC-GIT', pass, 'LSTAT', '/usr', base + 1, dir(1)),
      entry('XR-EXEC-GIT', pass, 'LSTAT', '/usr/bin', base + 2, symlink(2, metadataMtime + passIndex)),
      entry('XR-EXEC-GIT', pass, 'READLINK', '/usr/bin', base + 3, selected),
      entry('XR-EXEC-GIT', pass, 'LSTAT', '/opt', base + 4, dir(3)),
      entry('XR-EXEC-GIT', pass, 'LSTAT', normalized, base + 5, dir(4)),
      entry('XR-EXEC-GIT', pass, 'LSTAT', `${normalized}/git`, base + 6, file(5)),
      entry('XR-EXEC-GIT', pass, 'REALPATH', '/usr/bin/git', base + 7, final),
      entry('XR-EXEC-GIT', pass, 'STAT', final, base + 8, file(5)));
  }
  return [...result, ...XR_READ_IDS.slice(1).flatMap((id, index) => ordinaryRecordEntries(id, 11 + index))];
}
function symlinkDepthEntries(hops: number, targetBytes?: number): ScriptedReadEntry[] {
  const result: ScriptedReadEntry[] = [];
  const normalizedTargets = Array.from({ length: hops }, (_, index) => `/l${index + 1}`);
  const targets = normalizedTargets.map((normalized) => { if (targetBytes === undefined) return normalized;
    const suffix = normalized.slice(1); const padding = targetBytes - suffix.length - 1;
    let pairs = Math.floor(padding / 5); while ((padding - pairs * 5) % 2 !== 0) pairs -= 1;
    const dots = (padding - pairs * 5) / 2; return `/${'x/../'.repeat(pairs)}${'./'.repeat(dots)}${suffix}`;
  });
  for (const [passIndex, pass] of (['PRE_READ_PASS', 'POST_READ_PASS'] as const).entries()) {
    let call = passIndex * (hops * 2 + 5); result.push(entry('XR-EXEC-GIT', pass, 'LSTAT', '/usr', ++call, dir(1)),
      entry('XR-EXEC-GIT', pass, 'LSTAT', '/usr/bin', ++call, dir(2)),
      entry('XR-EXEC-GIT', pass, 'LSTAT', '/usr/bin/git', ++call, symlink(3)));
    for (let index = 0; index < hops; index += 1) {
      const linkPath = index === 0 ? '/usr/bin/git' : normalizedTargets[index - 1]!; const target = targets[index]!;
      result.push(entry('XR-EXEC-GIT', pass, 'READLINK', linkPath, ++call, target));
      if (index < hops - 1) result.push(entry('XR-EXEC-GIT', pass, 'LSTAT', normalizedTargets[index]!, ++call, symlink(4 + index)));
    }
    const final = normalizedTargets.at(-1)!; result.push(entry('XR-EXEC-GIT', pass, 'LSTAT', final, ++call, file(20)),
      entry('XR-EXEC-GIT', pass, 'REALPATH', '/usr/bin/git', ++call, final),
      entry('XR-EXEC-GIT', pass, 'STAT', final, ++call, file(20)));
  }
  return [...result, ...XR_READ_IDS.slice(1).flatMap((id, index) => ordinaryRecordEntries(id, 11 + index))];
}

describe('XR-I closed allowlist and executable mapping', () => {
  it('accepts exactly four ordered IDs and version', () => { expect(XR_READ_IDS).toHaveLength(4);
    expect(() => validateXrReadAllowlist(XR_READ_ALLOWLIST, XR_READ_ALLOWLIST_VERSION)).not.toThrow(); });
  it('rejects unknown, duplicate, reordered, missing, and wrong-version allowlists before a port call', () => {
    expect(() => validateXrReadAllowlist([{ ...XR_READ_ALLOWLIST[0]!, readId: 'UNKNOWN' } as never,
      ...XR_READ_ALLOWLIST.slice(1)])).toThrow();
    expect(() => validateXrReadAllowlist([XR_READ_ALLOWLIST[0]!, XR_READ_ALLOWLIST[0]!, ...XR_READ_ALLOWLIST.slice(2)]))
      .toThrow('XR_READ_ID_DUPLICATE');
    expect(() => validateXrReadAllowlist([XR_READ_ALLOWLIST[1]!, XR_READ_ALLOWLIST[0]!, ...XR_READ_ALLOWLIST.slice(2)]))
      .toThrow('XR_READ_ORDER_INVALID');
    expect(() => validateXrReadAllowlist(XR_READ_ALLOWLIST.slice(1))).toThrow();
    expect(() => validateXrReadAllowlist(XR_READ_ALLOWLIST, 'wrong')).toThrow('XR_READ_ALLOWLIST_VERSION_MISMATCH');
  });
  it('does not expose caller paths or operations in records', () => expect(Object.keys(XR_READ_ALLOWLIST[0]!))
    .not.toEqual(expect.arrayContaining(['path', 'operation', 'options'])));
  it('maps IDs explicitly and independently of contract record ordering', () => {
    expect(executablePaths(CONTRACT)).toEqual(paths);
    expect(executablePaths({ ...CONTRACT, records: [...CONTRACT.records].reverse() })).toEqual(paths);
    expect(new Set(TIER_A_RECORDS.map((record) => record.executable))).toEqual(new Set(Object.values(paths)));
  });
});

describe('XR-I complete token authority', () => {
  const binding = Object.freeze({ readId: 'XR-EXEC-GIT' as const, approvedReadContextIdentity: context.identity,
    pass: 'PRE_READ_PASS' as const, operation: 'LSTAT' as const, exactPath: '/usr', callIndex: 1 });
  it('rejects a plain structural forgery', () => expect(() => assertApprovedPathToken({
    kind: 'XR_APPROVED_PATH_TOKEN' } as ApprovedPathToken)).toThrow('XR_PATH_TOKEN_FORGED'));
  it('rejects token reuse', () => { const harness = createApprovedPathTokenTestHarness(binding); harness.consume();
    expect(() => harness.consume()).toThrow('XR_PATH_TOKEN_CONSUMED'); });
  it.each([
    ['operation', { ...binding, operation: 'REALPATH' as const }], ['pass', { ...binding, pass: 'POST_READ_PASS' as const }],
    ['read ID', { ...binding, readId: 'XR-EXEC-SED' as const }],
    ['context', { ...binding, approvedReadContextIdentity: 'wrong' }], ['path', { ...binding, exactPath: '/wrong' }],
    ['call index', { ...binding, callIndex: 2 }],
  ])('rejects wrong %s binding', (_label, expected) => expect(() => createApprovedPathTokenTestHarness(binding)
    .consume(expected)).toThrow('XR_PATH_TOKEN_BINDING_MISMATCH'));
  it('fixture port rejects operation/path/order mismatch', () => { const harness = createApprovedPathTokenTestHarness(binding);
    const port = new ScriptedExactHostReadPort([{ ...entry('XR-EXEC-GIT', 'PRE_READ_PASS', 'REALPATH', '/wrong', 1, '/wrong') }]);
    expect(() => port.lstatExact(harness.token)).toThrow('XR_PATH_TOKEN_BINDING_MISMATCH');
  });
});

describe('XR-I observation, evidence, and mtime policy', () => {
  it('completes four records with full PRE/POST observation', () => { const result = complete();
    expect(result.resultClass).toBe('COMPLETED'); expect(result.evidence.map((value) => value.readId)).toEqual(XR_READ_IDS);
    expect(result.evidence[0]?.primitiveCallCounts).toEqual({ lstat: 6, readlink: 0, realpath: 2, stat: 2, total: 10 }); });
  it('captures ordinary and intermediate symlink chains', () => {
    expect((complete().evidence[0]!.normalizedObservation as { pathComponentChain: unknown[] }).pathComponentChain).toHaveLength(3);
    const result = runApprovedHostReadSequence({ ...context, expectedRealpaths: { ...paths,
      'XR-EXEC-GIT': '/opt/bin/git' } }, CONTRACT, normalPort(linkedGitEntries('/opt/bin')));
    expect((result.evidence[0]!.normalizedObservation as { symlinkChain: unknown[] }).symlinkChain).toHaveLength(1);
  });
  it('resolves relative targets against the current parent', () => { const result = runApprovedHostReadSequence({ ...context,
    expectedRealpaths: { ...paths, 'XR-EXEC-GIT': '/opt/bin/git' } }, CONTRACT, normalPort(linkedGitEntries('../../opt/bin')));
    expect(result.resultClass).toBe('COMPLETED'); });
  it('detects component, symlink target, and final inode identity drift', () => {
    for (const mutate of [(entries: ScriptedReadEntry[]) => { entries[7] = { ...entries[7]!, result: dir(99) }; },
      (entries: ScriptedReadEntry[]) => { entries[9] = { ...entries[9]!, result: '/different' }; },
      (entries: ScriptedReadEntry[]) => { entries[9] = { ...entries[9]!, result: file(99) }; }]) {
      const entries = ordinaryEntries(); mutate(entries); expect(runApprovedHostReadSequence(context, CONTRACT,
        normalPort(entries)).evidence[0]?.failureReason).not.toBe('NONE');
    }
  });
  it('classifies a changed symlink target as baseline drift and emits no observation', () => {
    const entries = linkedGitEntries('/opt/bin'); entries[10] = { ...entries[10]!, result: '/different/bin' };
    entries[11] = { ...entries[11]!, exactPath: '/different' };
    entries[12] = { ...entries[12]!, exactPath: '/different/bin' };
    entries[13] = { ...entries[13]!, exactPath: '/different/bin/git' };
    entries[14] = { ...entries[14]!, result: '/different/bin/git' };
    entries[15] = { ...entries[15]!, exactPath: '/different/bin/git' };
    const result = runApprovedHostReadSequence({ ...context, expectedRealpaths: { ...paths,
      'XR-EXEC-GIT': '/opt/bin/git' } }, CONTRACT, normalPort(entries));
    expect(result.evidence[0]).toMatchObject({ failureReason: 'XR_BASELINE_CHANGED', normalizedObservation: 'NONE' });
  });
  it.each(['component', 'symlink', 'final'] as const)('excludes %s mtime-only drift symmetrically', (kind) => {
    const entries = kind === 'symlink' ? linkedGitEntries('/opt/bin') : ordinaryEntries();
    if (kind === 'component') entries[5] = { ...entries[5]!, result: dir(1, 999) };
    if (kind === 'symlink') entries[8] = { ...entries[8]!, result: dir(1, 999) };
    if (kind === 'final') entries[9] = { ...entries[9]!, result: file(10, 999) };
    const expected = kind === 'symlink' ? { ...paths, 'XR-EXEC-GIT': '/opt/bin/git' } : paths;
    expect(runApprovedHostReadSequence({ ...context, expectedRealpaths: expected }, CONTRACT,
      normalPort(entries)).resultClass).toBe('COMPLETED');
  });
  it('keeps observation separate from executable identity and evidence immutable', () => { const evidence = complete().evidence[0]!;
    const observation = evidence.normalizedObservation as Record<string, unknown>;
    expect(observation.codeSignObservation).toBe('NOT_OBSERVED_BLOCKED_FEASIBILITY_GAP');
    expect(observation).not.toHaveProperty('codeSignature'); expect(Object.isFrozen(observation)).toBe(true);
    expect(JSON.stringify(evidence)).not.toMatch(/raw|buffer|codeSignature/); });
  it('rejects unknown evidence fields', () => expect(() => assertClosedHostReadEvidence({
    ...complete().evidence[0]!, unknown: true })).toThrow('XR_EVIDENCE_SCHEMA_MISMATCH'));
  it('emits bounded failure evidence and stops without retry', () => { const result = runApprovedHostReadSequence(context,
    CONTRACT, normalPort([])); expect(result.evidence).toHaveLength(1); expect(result.evidence[0]).toMatchObject({
      normalizedObservation: 'NONE', resultClass: 'FAILURE', failureReason: 'XR_PATH_TOKEN_BINDING_MISMATCH' }); });
});

describe('XR-I bounded accounting and safety gates', () => {
  it('accepts exactly eight symlink hops per pass', () => { const expected = symlinkDepthEntries(8);
    const final = (expected.find((value) => value.readId === 'XR-EXEC-GIT' && value.operation === 'REALPATH')!.result as string);
    expect(runApprovedHostReadSequence({ ...context, expectedRealpaths: { ...paths, 'XR-EXEC-GIT': final } },
      CONTRACT, normalPort(expected)).resultClass).toBe('COMPLETED');
  });
  it('rejects the ninth symlink before readlink', () => { const entries = symlinkDepthEntries(9);
    const result = runApprovedHostReadSequence(context, CONTRACT, normalPort(entries));
    expect(result.evidence[0]?.failureReason).toBe('XR_SYMLINK_DEPTH_EXCEEDED');
    expect((result.evidence[0]?.primitiveCallCounts.readlink)).toBe(8);
  });
  it('accepts 4096 UTF-8 target bytes and rejects 4097 before accumulation', () => {
    for (const [bytes, expectedReason] of [[4096, 'NONE'], [4097, 'XR_READ_BYTE_CAP_EXCEEDED']] as const) {
      const entries = symlinkDepthEntries(1, bytes); const final = entries.find((value) => value.operation === 'REALPATH')!.result as string;
      const evidence = runApprovedHostReadSequence({ ...context, expectedRealpaths: { ...paths,
        'XR-EXEC-GIT': final } }, CONTRACT, normalPort(entries)).evidence[0]!;
      expect(evidence.failureReason).toBe(expectedReason);
    }
  });
  it('accepts the aggregate byte cap and rejects overflow without partial accumulation', () => {
    const exact = symlinkDepthEntries(8, 2048); const final = exact.find((value) => value.operation === 'REALPATH')!.result as string;
    const accepted = runApprovedHostReadSequence({ ...context, expectedRealpaths: { ...paths,
      'XR-EXEC-GIT': final } }, CONTRACT, normalPort(exact)).evidence[0]!;
    expect(accepted.linkTargetByteCount).toBe(32768); expect(accepted.failureReason).toBe('NONE');
    const overflow = symlinkDepthEntries(8, 2049); const failed = runApprovedHostReadSequence(context, CONTRACT,
      normalPort(overflow)).evidence[0]!; expect(failed.failureReason).toBe('XR_READ_BYTE_CAP_EXCEEDED');
    expect(failed.linkTargetByteCount).toBe(30735);
  });
  it('accepts the operation cap and rejects the next primitive call', () => { const harness = createCallAccountingTestHarness();
    for (let index = 0; index < XR_LIMITS.lstat; index += 1) expect(() => harness.call('lstat')).not.toThrow();
    expect(() => harness.call('lstat')).toThrow('XR_READ_CALL_CAP_EXCEEDED'); });
  it('accepts exactly 52 total primitive calls and rejects the fifty-third', () => {
    const harness = createCallAccountingTestHarness();
    for (const [operation, count] of [['lstat', 32], ['readlink', 16], ['realpath', 2], ['stat', 2]] as const) {
      for (let index = 0; index < count; index += 1) harness.call(operation);
    }
    expect(harness.snapshot().total).toBe(52); expect(() => harness.call('stat')).toThrow('XR_READ_CALL_CAP_EXCEEDED');
  });
  it('calculates evidence size by a bounded convergent fixed point', () => { const value = { a: 'x', normalizedEvidenceByteCount: 0 };
    const size = calculateEvidenceSize(value); expect(size).toBe(new TextEncoder().encode(canonicalize({
      ...value, normalizedEvidenceByteCount: size })).byteLength); });
  it('fails closed when the size calculation cannot converge within eight iterations', () => { let call = 0;
    expect(() => calculateEvidenceSize({}, () => ++call)).toThrow('XR_EVIDENCE_SIZE_NONCONVERGENT'); expect(call).toBe(8); });
  it('accepts evidence-size equality and rejects one-byte overflow', () => {
    expect(() => assertEvidenceSizeWithinCap(32768)).not.toThrow();
    expect(() => assertEvidenceSizeWithinCap(32769)).toThrow('XR_EVIDENCE_CAP_EXCEEDED');
  });
  it('retains closed limits and unresolved gates', () => { expect(XR_LIMITS).toMatchObject({ pathEntriesPerPass: 16,
    symlinkHopsPerPass: 8, lstat: 32, readlink: 16, realpath: 2, stat: 2, total: 52,
    linkTargetBytes: 4096, aggregateLinkTargetBytes: 32768, evidenceBytes: 32768 });
    expect(XR_METADATA_EVIDENCE_EXECUTION_ELIGIBLE).toBe(false); expect(CODE_SIGN_GATE_EFFECT).toBe('BLOCKS_XG_XF_XA_E');
    expect(CODE_SIGN_READ_FEASIBILITY).toBe('BLOCKED_FEASIBILITY_GAP');
    expect(XR_REAL_FILESYSTEM_ADAPTER).toBe('IMPLEMENTED_GATED_NOT_WIRED');
    expect(XR_HOST_READ_EXECUTION).toBe('NOT_PERFORMED'); });
});
