import { describe, expect, it } from 'vitest';
import { Metadata, OFFLINE_ENGINE_HOST_IMPORTS, ScriptedExactHostReadPort, ScriptedReadEntry,
  createApprovedPathTokenTestHarness } from './offline-read';
import {
  BigIntMetadataLike, EXACT_BOUNDED_FILESYSTEM_CANCELLATION, EXPECTED_PLATFORM_PROFILE,
  FILESYSTEM_PROVENANCE_MODEL, LOCAL_FILESYSTEM_PROVENANCE_PREFLIGHT, LogicalDeadlinePort,
  PER_CALL_TARGET_MS, REAL_ADAPTER_IMPORT_MANIFEST, RealFsPrimitivePort, XR_ACTUAL_HOST_READ_APPROVED,
  XR_AX_ELIGIBLE, createRealAdapterTestHarness, normalizeBigIntMetadata, normalizeRealAdapterError,
} from './real-read-adapter';

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
  it('keeps the offline engine host-import manifest empty', () => expect(OFFLINE_ENGINE_HOST_IMPORTS).toEqual([]));
  it('allows exactly four read-only fs/promises symbols in the real adapter', () => expect(REAL_ADAPTER_IMPORT_MANIFEST)
    .toEqual({ module: 'node:fs/promises', symbols: ['lstat', 'readlink', 'realpath', 'stat'] }));
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
