import { describe, expect, it } from 'vitest';
import { ALLOWLIST_CONTRACT } from '../../allowlist';
import { createStaticAllowlistDigest } from '../../runner';
import {
  CODE_SIGN_GATE_EFFECT, CODE_SIGN_READ_FEASIBILITY, HostReadSequenceResult, Metadata,
  ScriptedExactHostReadPort, XR_HOST_READ_EXECUTION, XR_LIMITS, XR_METADATA_EVIDENCE_EXECUTION_ELIGIBLE,
  XR_READ_ALLOWLIST, XR_READ_ALLOWLIST_VERSION, XR_READ_IDS, XR_REAL_FILESYSTEM_ADAPTER,
  ApprovedPathToken, assertApprovedPathToken, assertClosedHostReadEvidence, runApprovedHostReadSequence,
  validateXrReadAllowlist,
} from './offline-read';

const SYMBOLS = Object.freeze({ APPROVAL_BOUND_HEAD_SHA: '1'.repeat(40),
  APPROVAL_BOUND_ARCHITECTURE_PLAN_BLOB_ID: '2'.repeat(40),
  APPROVAL_BOUND_GIT_VERSION_LINE: 'git version 2.39.5 (Apple Git-154)' });
const CONTRACT = createStaticAllowlistDigest(SYMBOLS).contract;
const dir = (inode: number): Metadata => Object.freeze({ fileType: 'DIRECTORY', device: 1, inode, uid: 0, gid: 0,
  mode: 493, size: 0, mtime: 1 });
const file = (inode: number): Metadata => Object.freeze({ fileType: 'REGULAR_FILE', device: 1, inode, uid: 0, gid: 0,
  mode: 493, size: 100, mtime: 1 });
const symlink = (inode: number): Metadata => Object.freeze({ fileType: 'SYMLINK', device: 1, inode, uid: 0, gid: 0,
  mode: 511, size: 4, mtime: 1 });
const paths = ['/usr/bin/git', '/usr/bin/sed', '/usr/bin/readlink', '/usr/bin/stat'] as const;
function normalPort(): ScriptedExactHostReadPort { const lstat: Metadata[] = []; const stat: Metadata[] = [];
  const realpath: string[] = []; for (let passRecord = 0; passRecord < 8; passRecord += 1) {
    const recordIndex = Math.floor(passRecord / 2); lstat.push(dir(1), dir(2), file(10 + recordIndex));
    realpath.push(paths[recordIndex]!); stat.push(file(10 + recordIndex)); }
  return new ScriptedExactHostReadPort({ lstat, readlink: [], realpath, stat }); }
const context = Object.freeze({ identity: 'approved-xr-context', observedAt: '2026-08-07T00:00:00Z',
  expectedRealpaths: Object.freeze(Object.fromEntries(XR_READ_IDS.map((id, index) => [id, paths[index]]))) });
const complete = (): HostReadSequenceResult => runApprovedHostReadSequence(context, CONTRACT, normalPort());

describe('XR-I closed read allowlist', () => {
  it('accepts exactly four ordered IDs and version', () => { expect(XR_READ_IDS).toHaveLength(4);
    expect(() => validateXrReadAllowlist(XR_READ_ALLOWLIST, XR_READ_ALLOWLIST_VERSION)).not.toThrow(); });
  it('rejects unknown, duplicate, reordered, missing, and wrong-version allowlists', () => {
    expect(() => validateXrReadAllowlist([{ ...XR_READ_ALLOWLIST[0]!, readId: 'UNKNOWN' } as never,
      ...XR_READ_ALLOWLIST.slice(1)])).toThrow();
    expect(() => validateXrReadAllowlist([XR_READ_ALLOWLIST[0]!, XR_READ_ALLOWLIST[0]!, ...XR_READ_ALLOWLIST.slice(2)])).toThrow('XR_READ_ID_DUPLICATE');
    expect(() => validateXrReadAllowlist([XR_READ_ALLOWLIST[1]!, XR_READ_ALLOWLIST[0]!, ...XR_READ_ALLOWLIST.slice(2)])).toThrow('XR_READ_ORDER_INVALID');
    expect(() => validateXrReadAllowlist(XR_READ_ALLOWLIST.slice(1))).toThrow('XR_READ_ORDER_INVALID');
    expect(() => validateXrReadAllowlist(XR_READ_ALLOWLIST, 'wrong')).toThrow('XR_READ_ORDER_INVALID');
  });
  it('does not accept a caller path or operation in records', () => expect(Object.keys(XR_READ_ALLOWLIST[0]!))
    .not.toEqual(expect.arrayContaining(['path', 'operation', 'options'])));
  it('pins exact 16/8 and 32/16/2/2/52 limits', () => expect(XR_LIMITS).toMatchObject({ pathEntriesPerPass: 16,
    symlinkHopsPerPass: 8, lstat: 32, readlink: 16, realpath: 2, stat: 2, total: 52 }));
});

describe('XR-I component observation and evidence', () => {
  it('completes four records with two full observations', () => { const result = complete();
    expect(result.resultClass).toBe('COMPLETED'); expect(result.evidence.map((entry) => entry.readId)).toEqual(XR_READ_IDS);
    expect(result.evidence[0]?.primitiveCallCounts).toEqual({ lstat: 6, readlink: 0, realpath: 2, stat: 2, total: 10 }); });
  it('captures ordinary component chains', () => expect((complete().evidence[0]?.normalizedObservation as
    { pathComponentChain: unknown[] }).pathComponentChain).toHaveLength(3));
  it('requires the unresolved code-sign sentinel and no codeSignature', () => { const observation = complete().evidence[0]?.normalizedObservation as Record<string, unknown>;
    expect(observation.codeSignObservation).toBe('NOT_OBSERVED_BLOCKED_FEASIBILITY_GAP');
    expect(observation).not.toHaveProperty('codeSignature'); });
  it('creates equal deterministic pre/post tokens', () => { const evidence = complete().evidence[0]!;
    expect(evidence.preConsistencyToken).toBe(evidence.postConsistencyToken); expect(complete().evidence[0]?.preConsistencyToken).toBe(evidence.preConsistencyToken); });
  it('emits immutable nested evidence with no raw bytes', () => { const evidence = complete().evidence[0]!;
    expect(Object.isFrozen(evidence)).toBe(true); expect(Object.isFrozen(evidence.normalizedObservation)).toBe(true);
    expect(JSON.stringify(evidence)).not.toMatch(/raw|buffer|codeSignature/); });
  it('rejects unknown evidence fields', () => expect(() => assertClosedHostReadEvidence({
    ...complete().evidence[0]!, unknown: true,
  })).toThrow('XR_EVIDENCE_SCHEMA_MISMATCH'));
  it('keeps XR evidence execution-ineligible and gates XG/XF/XA/E', () => {
    expect(XR_METADATA_EVIDENCE_EXECUTION_ELIGIBLE).toBe(false); expect(CODE_SIGN_GATE_EFFECT).toBe('BLOCKS_XG_XF_XA_E');
    expect(CODE_SIGN_READ_FEASIBILITY).toBe('BLOCKED_FEASIBILITY_GAP'); });
  it('keeps real adapter and execution absent', () => { expect(XR_REAL_FILESYSTEM_ADAPTER).toBe('NOT_IMPLEMENTED');
    expect(XR_HOST_READ_EXECUTION).toBe('NOT_PERFORMED'); });
});

describe('XR-I fail-closed paths', () => {
  it('rejects forged approved path tokens', () => expect(() => assertApprovedPathToken({ kind: 'XR_APPROVED_PATH_TOKEN' } as ApprovedPathToken))
    .toThrow('XR_PATH_TOKEN_FORGED'));
  it('rejects a seventeenth component before a port call', () => { const long = `/${Array.from({ length: 17 }, (_, i) => `p${i}`).join('/')}`;
    const modified = { ...CONTRACT, records: CONTRACT.records.map((entry) => entry.executable === '/usr/bin/git' ? { ...entry, executable: long } : entry) };
    const port = new ScriptedExactHostReadPort({ lstat: Array.from({ length: 16 }, (_, i) => dir(i)), readlink: [], realpath: [], stat: [] });
    const result = runApprovedHostReadSequence({ ...context, expectedRealpaths: { ...context.expectedRealpaths, 'XR-EXEC-GIT': long } }, modified, port);
    expect(result.evidence[0]?.failureReason).toBe('XR_PATH_COMPONENT_LIMIT_EXCEEDED'); expect(port.calls).toHaveLength(16); });
  it('accepts exactly sixteen components per pass', () => { const long = `/${Array.from({ length: 16 }, (_, i) => `p${i}`).join('/')}`;
    const modified = { ...CONTRACT, records: CONTRACT.records.map((entry) => entry.executable === '/usr/bin/git' ? { ...entry, executable: long } : entry) };
    const remaining = remainingPortScript(); const metadata = Array.from({ length: 16 }, (_, index) => index === 15 ? file(index) : dir(index));
    const port = new ScriptedExactHostReadPort({ lstat: [...metadata, ...metadata, ...remaining.lstat], readlink: [],
      realpath: [long, long, ...remaining.realpath], stat: [file(15), file(15), ...remaining.stat] });
    const result = runApprovedHostReadSequence({ ...context, expectedRealpaths: { ...context.expectedRealpaths,
      'XR-EXEC-GIT': long } }, modified, port);
    expect(result.resultClass).toBe('COMPLETED'); expect(result.evidence[0]?.primitiveCallCounts.lstat).toBe(32);
  });
  it('rejects a NUL-containing configured path before a fixture call', () => { const bad = '/usr/bin/bad\0path';
    const modified = { ...CONTRACT, records: CONTRACT.records.map((entry) => entry.executable === '/usr/bin/git' ? { ...entry, executable: bad } : entry) };
    const port = new ScriptedExactHostReadPort({ lstat: [], readlink: [], realpath: [], stat: [] });
    expect(runApprovedHostReadSequence({ ...context, expectedRealpaths: { ...context.expectedRealpaths,
      'XR-EXEC-GIT': bad } }, modified, port).evidence[0]?.failureReason).toBe('XR_LINK_TARGET_INVALID');
    expect(port.calls).toHaveLength(0);
  });
  it('rejects manual path versus realpath mismatch', () => { const port = normalPort();
    (port as unknown as { script: { realpath: string[] } }).script.realpath[0] = '/wrong';
    expect(runApprovedHostReadSequence(context, CONTRACT, port).evidence[0]?.failureReason).toBe('XR_REALPATH_MISMATCH'); });
  it('rejects unexpected final file type', () => { const port = normalPort();
    (port as unknown as { script: { stat: Metadata[] } }).script.stat[0] = dir(9);
    expect(runApprovedHostReadSequence(context, CONTRACT, port).evidence[0]?.failureReason).toBe('XR_UNEXPECTED_FILE_TYPE'); });
  it('converts missing fixture data to bounded internal failure', () => { const result = runApprovedHostReadSequence(context, CONTRACT,
    new ScriptedExactHostReadPort({ lstat: [], readlink: [], realpath: [], stat: [] }));
    expect(result.evidence[0]).toMatchObject({ resultClass: 'FAILURE', failureReason: 'COMMAND_SAFETY_BLOCKED', normalizedObservation: 'NONE' }); });
  it('stops without retry after component identity drift', () => { const port = normalPort();
    (port as unknown as { script: { lstat: Metadata[] } }).script.lstat[3] = dir(999);
    const result = runApprovedHostReadSequence(context, CONTRACT, port); expect(result.evidence[0]?.failureReason).toBe('XR_BASELINE_CHANGED');
    expect(result.evidence).toHaveLength(1); });
  it('rejects final target inode drift and discards observations', () => { const port = normalPort();
    (port as unknown as { script: { stat: Metadata[] } }).script.stat[1] = file(999);
    const result = runApprovedHostReadSequence(context, CONTRACT, port); expect(result.evidence[0]).toMatchObject({
      failureReason: 'XR_BASELINE_CHANGED', normalizedObservation: 'NONE' });
  });
});

describe('XR-I intermediate and leaf symlinks', () => {
  function symlinkPort(target: string): ScriptedExactHostReadPort {
    const remaining = remainingPortScript();
    return new ScriptedExactHostReadPort({
      lstat: [dir(1), symlink(2), dir(3), dir(4), file(5), dir(1), symlink(2), dir(3), dir(4), file(5),
        ...remaining.lstat], readlink: [target, target],
      realpath: ['/opt/bin/git', '/opt/bin/git', ...remaining.realpath], stat: [file(5), file(5), ...remaining.stat] });
  }
  it.each([['absolute', '/opt/bin'], ['relative', '../../opt/bin']] as const)('captures %s intermediate symlink targets', (_kind, target) => {
    const port = symlinkPort(target); const expected = { ...context.expectedRealpaths, 'XR-EXEC-GIT': '/opt/bin/git' };
    const result = runApprovedHostReadSequence({ ...context, expectedRealpaths: expected }, CONTRACT, port);
    expect(result.resultClass, JSON.stringify(result)).toBe('COMPLETED');
    expect((result.evidence[0]?.normalizedObservation as { symlinkChain: unknown[] }).symlinkChain).toHaveLength(1); });
  it('captures a leaf symlink', () => { const remaining = remainingPortScript();
    const port = new ScriptedExactHostReadPort({ lstat: [dir(1), dir(2), symlink(3), dir(4), file(5),
      dir(1), dir(2), symlink(3), dir(4), file(5), ...remaining.lstat], readlink: ['/opt/git', '/opt/git'],
      realpath: ['/opt/git', '/opt/git', ...remaining.realpath], stat: [file(5), file(5), ...remaining.stat] });
    const result = runApprovedHostReadSequence({ ...context, expectedRealpaths: { ...context.expectedRealpaths,
      'XR-EXEC-GIT': '/opt/git' } }, CONTRACT, port);
    expect((result.evidence[0]?.normalizedObservation as { symlinkChain: unknown[] }).symlinkChain).toHaveLength(1);
  });
  it('rejects a symlink cycle before the repeated readlink', () => {
    const port = new ScriptedExactHostReadPort({ lstat: [dir(1), symlink(2), dir(1), symlink(2)],
      readlink: ['/usr/bin'], realpath: [], stat: [] });
    const result = runApprovedHostReadSequence(context, CONTRACT, port);
    expect(result.evidence[0]?.failureReason).toBe('XR_SYMLINK_CYCLE'); expect(port.calls.filter((call) => call === 'readlink')).toHaveLength(1);
  });
  it('rejects NUL link targets before accumulation', () => { const port = symlinkPort('bad\0target');
    expect(runApprovedHostReadSequence(context, CONTRACT, port).evidence[0]?.failureReason).toBe('XR_LINK_TARGET_INVALID'); });
  it('accepts 4096-byte target cap and rejects 4097 bytes', () => { expect(XR_LIMITS.linkTargetBytes).toBe(4096);
    const port = symlinkPort('a'.repeat(4097)); expect(runApprovedHostReadSequence(context, CONTRACT, port).evidence[0]?.failureReason)
      .toBe('XR_READ_BYTE_CAP_EXCEEDED'); });
});

function remainingPortScript(): { lstat: Metadata[]; readlink: string[]; realpath: string[]; stat: Metadata[] } {
  const lstat: Metadata[] = []; const realpath: string[] = []; const stat: Metadata[] = [];
  for (let recordIndex = 1; recordIndex < paths.length; recordIndex += 1) {
    for (let pass = 0; pass < 2; pass += 1) {
      lstat.push(dir(1), dir(2), file(10 + recordIndex)); realpath.push(paths[recordIndex]!);
      stat.push(file(10 + recordIndex));
    }
  }
  return { lstat, readlink: [], realpath, stat };
}
