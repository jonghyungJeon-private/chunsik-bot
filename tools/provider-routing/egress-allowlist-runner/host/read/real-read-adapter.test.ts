import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Metadata, ScriptedExactHostReadPort, ScriptedReadEntry, XR_LIMITS, XrReadAccounting,
  createApprovedPathTokenTestHarness } from './offline-read';
import {
  BigIntMetadataLike, EXACT_BOUNDED_FILESYSTEM_CANCELLATION, EXPECTED_PLATFORM_PROFILE,
  FILESYSTEM_PROVENANCE_MODEL, LOCAL_FILESYSTEM_PROVENANCE_PREFLIGHT, LogicalDeadlinePort,
  PER_CALL_TARGET_MS, RealFsPrimitivePort, XR_ACTUAL_HOST_READ_APPROVED,
  XR_AX_ELIGIBLE, createRealAdapterTestHarness, normalizeBigIntMetadata, normalizeRealAdapterError,
} from './real-read-adapter';
import { SourceTreePort, assertOfflineSourceBoundary, assertRealAdapterSourceBoundary,
  deriveOfflineProductionSources } from './source-boundary';

const binding = Object.freeze({ readId: 'XR-EXEC-GIT' as const, approvedReadContextIdentity: 'synthetic-context',
  pass: 'PRE_READ_PASS' as const, operation: 'LSTAT' as const, exactPath: '/synthetic/approved', callIndex: 1 });
const metadata = (overrides: Partial<BigIntMetadataLike> = {}): BigIntMetadataLike => ({ dev: 1n, ino: 2n, uid: 501n,
  gid: 20n, mode: 0o100755n, size: 123n, mtimeMs: 456n, isDirectory: () => false, isFile: () => true,
  isSymbolicLink: () => false, ...overrides });
class ImmediateDeadline implements LogicalDeadlinePort { constructor(private now = 0) {} nowMs(): number { return this.now; }
  setNow(value: number): void { this.now = value; }
  async execute<T>(_maximumMs: number, operation: () => Promise<T>) { try { return { kind: 'COMPLETED' as const,
    value: await operation() }; } catch (error) { return { kind: 'FAILED' as const, error }; } } }
const primitives = (overrides: Partial<RealFsPrimitivePort> = {}): RealFsPrimitivePort => ({
  lstat: async () => metadata(), stat: async () => metadata(), readlink: async () => 'synthetic-target',
  realpath: async () => '/synthetic/approved', ...overrides });

describe('XR-AI import and platform gates', () => {
  it('recursively derives and inspects every production source under the runner root', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const paths = assertOfflineSourceBoundary(root);
    expect(paths.map((path) => path.slice(root.length)).sort()).toEqual(expect.arrayContaining([
      'allowlist.ts', 'canonical.ts', 'contracts.ts', 'runner.ts', 'host/offline.ts', 'host/read/offline-read.ts',
      'index.ts', 'host/index.ts', 'host/read/index.ts']));
  });
  it('automatically scans a newly introduced production module and rejects its host access', () => {
    const contents = new Map([['/runner/index.ts', 'export {};'], ['/runner/nested/new-module.ts',
      "export const escaped = import('node:worker_threads');"], ['/runner/nested/ignored.test.ts',
      "import fs from 'node:fs';"], ['/runner/host/read/real-read-adapter.ts', "import fs from 'node:fs';"]]);
    const tree: SourceTreePort = { list: (path) => path === '/runner' ? [
      { name: 'index.ts', directory: false }, { name: 'nested', directory: true }, { name: 'host', directory: true }] :
      path === '/runner/nested' ? [{ name: 'new-module.ts', directory: false }, { name: 'ignored.test.ts', directory: false }] :
      path === '/runner/host' ? [{ name: 'read', directory: true }] :
      path === '/runner/host/read' ? [{ name: 'real-read-adapter.ts', directory: false }] : [],
      read: (path) => contents.get(path) ?? '' };
    expect(deriveOfflineProductionSources('/runner', tree)).toEqual(['/runner/index.ts', '/runner/nested/new-module.ts']);
    expect(() => assertOfflineSourceBoundary('/runner', tree)).toThrow('COMMAND_SAFETY_BLOCKED');
  });
  it('inspects the actual real adapter exact named import', () => {
    const source = readFileSync(new URL('./real-read-adapter.ts', import.meta.url), 'utf8');
    expect(() => assertRealAdapterSourceBoundary(source)).not.toThrow();
  });
  it.each(["import fs from 'node:fs/promises';", "import * as fs from 'node:fs/promises';",
    "import { lstat, readlink, realpath, stat, open } from 'node:fs/promises';",
    "const fs = import('node:fs/promises');", "const fs = require('node:fs/promises');"])
  ('rejects non-exact real adapter source: %s', (source) =>
    expect(() => assertRealAdapterSourceBoundary(source)).toThrow('COMMAND_SAFETY_BLOCKED'));
  it.each([
    ['direct export', 'export { facade };'], ['export alias', 'export { facade as anything };'],
    ['exported value alias', 'export const anything = facade;'],
    ['multiline factory', 'export function createPort() {\n return facade;\n}'],
    ['arrow factory', 'export const createPort = () =>\n facade;'],
    ['renamed facade', 'const renamedProductionFacade = facade; export function make() { return renamedProductionFacade; }'],
  ])('rejects structural production façade escape: %s', (_label, escape) => {
    const source = `import { lstat, readlink, realpath, stat } from 'node:fs/promises';
      const facade = { lstat, readlink, realpath, stat }; ${escape}`;
    expect(() => assertRealAdapterSourceBoundary(source)).toThrow('COMMAND_SAFETY_BLOCKED');
  });
  it('allows an injected test factory that cannot obtain the production façade', () => {
    const source = `import { lstat, readlink, realpath, stat } from 'node:fs/promises';
      const facade = { lstat, readlink, realpath, stat }; void facade;
      export function createTestOnly<T>(injected: T): T { return injected; }`;
    expect(() => assertRealAdapterSourceBoundary(source)).not.toThrow();
  });
  it('keeps expected platform as policy and provenance/cancellation blocked', () => {
    expect(EXPECTED_PLATFORM_PROFILE).toMatchObject({ expectedOS: 'darwin', expectedArch: 'arm64', expectedNodeMajor: 22,
      classification: 'EXPECTED_POLICY_NOT_OBSERVED_HOST_FACT' });
    expect(FILESYSTEM_PROVENANCE_MODEL).toMatchObject({ networkPolicy: 'NONE', localDaemonContact: 'NONE' });
    expect(LOCAL_FILESYSTEM_PROVENANCE_PREFLIGHT).toBe('BLOCKED_FEASIBILITY_GAP');
    expect(EXACT_BOUNDED_FILESYSTEM_CANCELLATION).toBe('BLOCKED_FEASIBILITY_GAP');
    expect(XR_AX_ELIGIBLE).toBe(false); expect(XR_ACTUAL_HOST_READ_APPROVED).toBe(false);
  });
});

describe('XR-AI authority and zero-host-call rejection', () => {
  it.each([
    ['operation', { ...binding, operation: 'STAT' as const }], ['pass', { ...binding, pass: 'POST_READ_PASS' as const }],
    ['read ID', { ...binding, readId: 'XR-EXEC-SED' as const }],
    ['context', { ...binding, approvedReadContextIdentity: 'wrong' }], ['path', { ...binding, exactPath: '/wrong' }],
    ['call index', { ...binding, callIndex: 2 }],
  ])('rejects wrong %s before a primitive call', async (_label, expected) => { let calls = 0;
    const token = createApprovedPathTokenTestHarness(binding).token;
    const port = createRealAdapterTestHarness(primitives({ lstat: async () => { calls += 1; return metadata(); } }),
      new ImmediateDeadline(), [expected]);
    await expect(port.lstatExact(token)).rejects.toThrow('XR_PATH_TOKEN_BINDING_MISMATCH'); expect(calls).toBe(0);
  });
  it('burns a successful token and rejects retry', async () => { let calls = 0; const harness = createApprovedPathTokenTestHarness(binding);
    const port = createRealAdapterTestHarness(primitives({ lstat: async () => { calls += 1; return metadata(); } }),
      new ImmediateDeadline(), [binding, binding]);
    await expect(port.lstatExact(harness.token)).resolves.toMatchObject({ inode: 2 });
    await expect(port.lstatExact(harness.token)).rejects.toThrow('XR_PATH_TOKEN_CONSUMED'); expect(calls).toBe(1);
  });
});

describe('XR-AI error and metadata normalization', () => {
  it.each([
    ['ENOENT', 'XR_FILE_MISSING'], ['EACCES', 'XR_PERMISSION_DENIED'], ['EPERM', 'XR_PERMISSION_DENIED'],
    ['ELOOP', 'XR_SYMLINK_CYCLE'], ['ENOTDIR', 'XR_LINK_TARGET_INVALID'], ['EINVAL', 'XR_LINK_TARGET_INVALID'],
    ['ESTALE', 'XR_BASELINE_CHANGED'], ['ETIMEDOUT', 'XR_FILESYSTEM_PROVENANCE_SUSPECT'],
    ['ENAMETOOLONG', 'XR_PATH_LENGTH_UNSUPPORTED'], ['UNKNOWN', 'COMMAND_SAFETY_BLOCKED'],
  ])('maps %s without retaining host error details', (code, reason) => { const normalized = normalizeRealAdapterError({
    code, message: 'secret host detail', stack: 'secret stack', path: '/secret' }); expect(normalized.reason).toBe(reason);
    expect(Object.keys(normalized)).not.toEqual(expect.arrayContaining(['code', 'path', 'stack'])); });
  it('projects safe bigint metadata and no host-specific fields', () => expect(normalizeBigIntMetadata(metadata()))
    .toEqual({ fileType: 'REGULAR_FILE', device: 1, inode: 2, uid: 501, gid: 20, mode: 0o100755,
      size: 123, mtime: 456 }));
  it('rejects bigint overflow and unsupported special types', () => {
    expect(() => normalizeBigIntMetadata(metadata({ ino: BigInt(Number.MAX_SAFE_INTEGER) + 1n })))
      .toThrow('XR_UNSUPPORTED_FILESYSTEM_IDENTITY');
    expect(() => normalizeBigIntMetadata(metadata({ isFile: () => false }))).toThrow('XR_UNSUPPORTED_FILESYSTEM_IDENTITY');
  });
  it('normalizes symlink metadata', () => expect(normalizeBigIntMetadata(metadata({ isFile: () => false,
    isSymbolicLink: () => true }))).toMatchObject({ fileType: 'SYMLINK', uid: 501, gid: 20, mode: 0o100755 }));
});

describe('XR-AI deadline, quarantine, parity, and freshness', () => {
  it('starts a fresh record budget at beginRecord, not construction', async () => { let now = 0; let received = 0;
    const deadline: LogicalDeadlinePort = { nowMs: () => now, execute: async (ms, operation) => { received = ms;
      return { kind: 'COMPLETED', value: await operation() }; } };
    const port = createRealAdapterTestHarness(primitives(), deadline, [binding], false); now = 50000;
    port.beginRecord(binding.readId, binding.approvedReadContextIdentity);
    await port.lstatExact(createApprovedPathTokenTestHarness(binding).token); expect(received).toBe(PER_CALL_TARGET_MS);
    port.endRecord(); expect(port.state).toBe('COMPLETED');
  });
  it('rejects overlapping record scope and revokes', () => { const port = createRealAdapterTestHarness(primitives(),
    new ImmediateDeadline(), [binding], false); port.beginRecord(binding.readId, binding.approvedReadContextIdentity);
    expect(() => port.beginRecord(binding.readId, binding.approvedReadContextIdentity)).toThrow('COMMAND_SAFETY_BLOCKED');
    expect(port.revoked).toBe(true);
  });
  it('revokes a reentrant call without starting a second primitive', async () => { let calls = 0;
    let release!: (value: BigIntMetadataLike) => void;
    const pending = new Promise<BigIntMetadataLike>((resolve) => { release = resolve; });
    const second = { ...binding, callIndex: 2 };
    const port = createRealAdapterTestHarness(primitives({ lstat: async () => { calls += 1; return pending; } }),
      new ImmediateDeadline(), [binding, second]);
    const firstCall = port.lstatExact(createApprovedPathTokenTestHarness(binding).token);
    await Promise.resolve();
    await expect(port.lstatExact(createApprovedPathTokenTestHarness(second).token)).rejects.toThrow('COMMAND_SAFETY_BLOCKED');
    expect(calls).toBe(1); expect(port.revoked).toBe(true); release(metadata()); await firstCall;
    expect(port.revoked).toBe(true);
  });
  it('uses the per-call target when the record has more time', async () => { let received = 0;
    const deadline: LogicalDeadlinePort = { nowMs: () => 0, execute: async (ms, operation) => { received = ms;
      return { kind: 'COMPLETED', value: await operation() }; } };
    const harness = createApprovedPathTokenTestHarness(binding); await createRealAdapterTestHarness(primitives(), deadline,
      [binding]).lstatExact(harness.token); expect(received).toBe(PER_CALL_TARGET_MS);
  });
  it('uses remaining record time when it is shorter', async () => { let received = 0; const clock = new ImmediateDeadline(0);
    const harness = createApprovedPathTokenTestHarness(binding); let now = 0;
    const deadline: LogicalDeadlinePort = { nowMs: () => now, execute: async (ms, operation) => { received = ms;
      return { kind: 'COMPLETED', value: await operation() }; } };
    const port = createRealAdapterTestHarness(primitives(), deadline, [binding]); now = 9500;
    await port.lstatExact(harness.token); expect(received).toBe(500); void clock;
  });
  it('quarantines outstanding I/O, revokes the adapter, and prohibits later calls', async () => {
    const deadline: LogicalDeadlinePort = { nowMs: () => 0, execute: async () => ({ kind: 'DEADLINE_EXCEEDED' }) };
    const harness = createApprovedPathTokenTestHarness(binding); const port = createRealAdapterTestHarness(primitives(), deadline,
      [binding]); await expect(port.lstatExact(harness.token)).rejects.toThrow('XR_READ_TIMEOUT');
    expect(port).toMatchObject({ state: 'OUTSTANDING_IO_QUARANTINED', outstandingCalls: 1, revoked: true });
    await expect(port.lstatExact(createApprovedPathTokenTestHarness(binding).token)).rejects.toThrow('COMMAND_SAFETY_BLOCKED');
  });
  it.each(['fulfillment', 'rejection'] as const)('ignores late %s after quarantine', async (kind) => {
    let settle!: (value: BigIntMetadataLike) => void; let fail!: (error: unknown) => void;
    const pending = new Promise<BigIntMetadataLike>((resolve, reject) => { settle = resolve; fail = reject; });
    const deadline: LogicalDeadlinePort = { nowMs: () => 0, execute: async (_ms, operation) => {
      void operation().catch(() => undefined); return { kind: 'DEADLINE_EXCEEDED' }; } };
    const port = createRealAdapterTestHarness(primitives({ lstat: async () => pending }), deadline, [binding]);
    await expect(port.lstatExact(createApprovedPathTokenTestHarness(binding).token)).rejects.toThrow('XR_READ_TIMEOUT');
    if (kind === 'fulfillment') settle(metadata()); else fail(new Error('late'));
    await Promise.resolve(); expect(port).toMatchObject({ state: 'OUTSTANDING_IO_QUARANTINED', revoked: true,
      outstandingCalls: 1 });
  });
  it('matches fixture metadata and does not cache PRE for POST', async () => { let calls = 0;
    const post = { ...binding, pass: 'POST_READ_PASS' as const, callIndex: 2 }; const first = createApprovedPathTokenTestHarness(binding);
    const second = createApprovedPathTokenTestHarness(post); const real = createRealAdapterTestHarness(primitives({
      lstat: async () => { calls += 1; return metadata(); } }), new ImmediateDeadline(), [binding, post]);
    const realPre = await real.lstatExact(first.token); const realPost = await real.lstatExact(second.token);
    const fixtureEntries: ScriptedReadEntry[] = [{ ...binding, result: realPre }, { ...post, result: realPost }];
    const fixture = new ScriptedExactHostReadPort(fixtureEntries);
    expect(fixture.lstatExact(createApprovedPathTokenTestHarness(binding).token)).toEqual(realPre); expect(calls).toBe(2);
  });
  it('defensively copies and freezes fixture values', () => { const mutable = { fileType: 'REGULAR_FILE', device: 1,
    inode: 2, uid: 3, gid: 4, mode: 5, size: 6, mtime: 7 } as Metadata; const fixture = new ScriptedExactHostReadPort([
      { ...binding, result: mutable }]); mutable.inode = 999; const result = fixture.lstatExact(
      createApprovedPathTokenTestHarness(binding).token); expect(result.inode).toBe(2); expect(Object.isFrozen(result)).toBe(true); });
});

describe('XR-AV shared accounting authority', () => {
  it('drives the fake real adapter through 52 shared-authority tokens and blocks 53 before a primitive', async () => {
    const accounting = new XrReadAccounting(); let primitiveCalls = 0;
    const operations = [...Array(32).fill('LSTAT'), ...Array(16).fill('READLINK'),
      ...Array(2).fill('REALPATH'), ...Array(2).fill('STAT')] as ('LSTAT' | 'READLINK' | 'REALPATH' | 'STAT')[];
    const bindings = operations.map((operation) => ({ ...binding, operation, callIndex: accounting.call(
      operation.toLowerCase() as 'lstat' | 'readlink' | 'realpath' | 'stat') }));
    const fake = primitives({ lstat: async () => { primitiveCalls += 1; return metadata(); },
      readlink: async () => { primitiveCalls += 1; return 'synthetic-target'; },
      realpath: async () => { primitiveCalls += 1; return '/synthetic/approved'; },
      stat: async () => { primitiveCalls += 1; return metadata(); } });
    const port = createRealAdapterTestHarness(fake, new ImmediateDeadline(), bindings);
    for (const expected of bindings) { const approved = createApprovedPathTokenTestHarness(expected).token;
      if (expected.operation === 'LSTAT') await port.lstatExact(approved);
      else if (expected.operation === 'READLINK') await port.readlinkExact(approved);
      else if (expected.operation === 'REALPATH') await port.realpathExact(approved);
      else await port.statExact(approved);
    }
    expect(primitiveCalls).toBe(52);
    expect(() => accounting.call('stat')).toThrow('XR_READ_CALL_CAP_EXCEEDED'); expect(primitiveCalls).toBe(52);
    port.endRecord();
  });
  it('permits exactly 52 calls and rejects the 53rd before any adapter call', () => {
    const accounting = new XrReadAccounting();
    for (let index = 0; index < XR_LIMITS.lstat; index += 1) accounting.call('lstat');
    for (let index = 0; index < XR_LIMITS.readlink; index += 1) accounting.call('readlink');
    for (let index = 0; index < XR_LIMITS.realpath; index += 1) accounting.call('realpath');
    for (let index = 0; index < XR_LIMITS.stat; index += 1) accounting.call('stat');
    expect(accounting.snapshot().total).toBe(52);
    expect(() => accounting.call('stat')).toThrow('XR_READ_CALL_CAP_EXCEEDED');
  });
  it('enforces individual and aggregate link target byte caps', () => {
    const individual = new XrReadAccounting(); individual.addLinkTarget('a'.repeat(4096));
    expect(() => individual.addLinkTarget('b'.repeat(4097))).toThrow('XR_READ_BYTE_CAP_EXCEEDED');
    const aggregate = new XrReadAccounting();
    for (let index = 0; index < 8; index += 1) aggregate.addLinkTarget('a'.repeat(4096));
    expect(() => aggregate.addLinkTarget('b')).toThrow('XR_READ_BYTE_CAP_EXCEEDED');
  });
  it('resets path and hop accounting for PRE and POST while sharing record call totals', () => {
    const accounting = new XrReadAccounting();
    accounting.beginPass(); for (let index = 0; index < 16; index += 1) accounting.observePathEntry();
    for (let index = 0; index < 8; index += 1) accounting.observeSymlinkHop(); accounting.call('lstat');
    accounting.beginPass(); for (let index = 0; index < 16; index += 1) accounting.observePathEntry();
    for (let index = 0; index < 8; index += 1) accounting.observeSymlinkHop(); accounting.call('lstat');
    expect(accounting.snapshot()).toMatchObject({ lstat: 2, total: 2 });
  });
  it('accepts 16 path entries and rejects the 17th before the next primitive', () => {
    const accounting = new XrReadAccounting(); let primitiveCalls = 0; accounting.beginPass();
    for (let index = 0; index < 16; index += 1) { accounting.observePathEntry(); primitiveCalls += 1; }
    expect(primitiveCalls).toBe(16);
    expect(() => accounting.observePathEntry()).toThrow('XR_PATH_COMPONENT_LIMIT_EXCEEDED');
    expect(primitiveCalls).toBe(16);
  });
  it('counts UTF-8 bytes rather than JavaScript characters', () => {
    const accounting = new XrReadAccounting(); accounting.addLinkTarget('가'.repeat(1365));
    expect(accounting.linkBytes).toBe(4095);
    expect(() => accounting.addLinkTarget('가'.repeat(1366))).toThrow('XR_READ_BYTE_CAP_EXCEEDED');
  });
});
