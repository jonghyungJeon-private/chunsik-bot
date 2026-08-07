import { lstat, readlink, realpath, stat } from 'node:fs/promises';
import {
  ApprovedPathToken, ApprovedPathTokenBinding, ExactHostReadPort, Metadata, XrError, XrReadOperation,
  consumeApprovedPathToken,
} from './offline-read';

export const XR_REAL_ADAPTER_IMPLEMENTED = true;
export const REAL_ADAPTER_IMPORT_MANIFEST = Object.freeze({ module: 'node:fs/promises',
  symbols: Object.freeze(['lstat', 'readlink', 'realpath', 'stat'] as const) } as const);
export const XR_REAL_ADAPTER_EXECUTION_APPROVED = false;
export const XR_ACTUAL_HOST_READ_APPROVED = false;
export const LOCAL_FILESYSTEM_PROVENANCE_PREFLIGHT = 'BLOCKED_FEASIBILITY_GAP';
export const EXACT_BOUNDED_FILESYSTEM_CANCELLATION = 'BLOCKED_FEASIBILITY_GAP';
export const XR_READ_CANCELLATION_GUARANTEE = 'BLOCKED_FEASIBILITY_GAP';
export const XR_AX_ELIGIBLE = false;
export const DEFAULT_EXACT_HOST_READ_PORT = 'NONE';
export const PER_CALL_TARGET_MS = 1000;
export const PER_RECORD_TARGET_MS = 10000;
export const EXPECTED_PLATFORM_PROFILE = Object.freeze({ expectedOS: 'darwin', expectedArch: 'arm64',
  expectedNodeMajor: 22, classification: 'EXPECTED_POLICY_NOT_OBSERVED_HOST_FACT' } as const);
export const FILESYSTEM_PROVENANCE_MODEL = Object.freeze({ systemVolume: 'SEALED_READ_ONLY_MACOS_SYSTEM_VOLUME_UNVERIFIED',
  dataVolume: 'DATA_VOLUME_UNVERIFIED', firmlinkCrossing: 'UNVERIFIED', mountIdentity: 'UNVERIFIED',
  filesystemType: 'APFS_UNVERIFIED', localAttachment: 'UNVERIFIED', providerBacking: 'UNVERIFIED',
  daemonMediation: 'UNVERIFIED', networkPolicy: 'NONE', localDaemonContact: 'NONE' } as const);

export type RealAdapterState = 'ACTIVE' | 'CALL_OUTSTANDING' | 'COMPLETED' | 'DEADLINE_EXCEEDED' |
  'OUTSTANDING_IO_QUARANTINED' | 'REVOKED';
export interface BigIntMetadataLike { readonly dev: bigint; readonly ino: bigint; readonly uid: bigint;
  readonly gid: bigint; readonly mode: bigint; readonly size: bigint; readonly mtimeMs: bigint;
  isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean; }
export interface RealFsPrimitivePort { lstat(path: string): Promise<BigIntMetadataLike>; readlink(path: string): Promise<string>;
  realpath(path: string): Promise<string>; stat(path: string): Promise<BigIntMetadataLike>; }
export type DeadlineOutcome<T> = Readonly<{ kind: 'COMPLETED'; value: T }> | Readonly<{ kind: 'FAILED'; error: unknown }> |
  Readonly<{ kind: 'DEADLINE_EXCEEDED' }>;
export interface LogicalDeadlinePort { nowMs(): number;
  execute<T>(maximumMs: number, operation: () => Promise<T>): Promise<DeadlineOutcome<T>>; }

const nodeFsPrimitivePort: RealFsPrimitivePort = Object.freeze({
  lstat: async (path: string) => lstat(path, { bigint: true }),
  readlink: async (path: string) => readlink(path, { encoding: 'utf8' }),
  realpath: async (path: string) => realpath(path, { encoding: 'utf8' }),
  stat: async (path: string) => stat(path, { bigint: true }),
});
void nodeFsPrimitivePort;

function safeNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new XrError('XR_UNSUPPORTED_FILESYSTEM_IDENTITY');
  return Number(value);
}
export function normalizeBigIntMetadata(value: BigIntMetadataLike): Metadata {
  const predicates = [value.isDirectory(), value.isFile(), value.isSymbolicLink()];
  if (predicates.filter(Boolean).length !== 1) throw new XrError('XR_UNSUPPORTED_FILESYSTEM_IDENTITY');
  const fileType = predicates[0] ? 'DIRECTORY' : predicates[1] ? 'REGULAR_FILE' : 'SYMLINK';
  return Object.freeze({ fileType, device: safeNumber(value.dev), inode: safeNumber(value.ino), uid: safeNumber(value.uid),
    gid: safeNumber(value.gid), mode: safeNumber(value.mode), size: safeNumber(value.size), mtime: safeNumber(value.mtimeMs) });
}
export function normalizeRealAdapterError(error: unknown): XrError {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
  const reason = code === 'ENOENT' ? 'XR_FILE_MISSING' : code === 'EACCES' || code === 'EPERM' ? 'XR_PERMISSION_DENIED' :
    code === 'ELOOP' ? 'XR_SYMLINK_CYCLE' : code === 'ENOTDIR' || code === 'EINVAL' ? 'XR_LINK_TARGET_INVALID' :
      code === 'ESTALE' ? 'XR_BASELINE_CHANGED' : code === 'ETIMEDOUT' ? 'XR_FILESYSTEM_PROVENANCE_SUSPECT' :
        code === 'ENAMETOOLONG' ? 'XR_PATH_LENGTH_UNSUPPORTED' : 'COMMAND_SAFETY_BLOCKED';
  return new XrError(reason);
}

export class RealExactHostReadPort implements ExactHostReadPort {
  private stateValue: RealAdapterState = 'ACTIVE'; private readonly startedAt: number; private outstanding = 0;
  private revokedValue = false;
  private constructor(private readonly primitives: RealFsPrimitivePort, private readonly deadline: LogicalDeadlinePort,
    private readonly expectedBindings: ApprovedPathTokenBinding[]) { this.startedAt = deadline.nowMs(); }
  get state(): RealAdapterState { return this.stateValue; } get outstandingCalls(): number { return this.outstanding; }
  get revoked(): boolean { return this.revokedValue; }
  lstatExact(token: ApprovedPathToken): Promise<Metadata> { return this.metadata('LSTAT', token); }
  statExact(token: ApprovedPathToken): Promise<Metadata> { return this.metadata('STAT', token); }
  readlinkExact(token: ApprovedPathToken): Promise<string> { return this.path('READLINK', token); }
  realpathExact(token: ApprovedPathToken): Promise<string> { return this.path('REALPATH', token); }
  revoke(): void { this.revokedValue = true; this.stateValue = 'REVOKED'; }
  private expected(operation: XrReadOperation, token: ApprovedPathToken): ApprovedPathTokenBinding {
    if (this.stateValue !== 'ACTIVE') throw new XrError('COMMAND_SAFETY_BLOCKED');
    const expected = this.expectedBindings.shift(); if (expected === undefined || expected.operation !== operation) {
      this.revoke(); throw new XrError('XR_PATH_TOKEN_BINDING_MISMATCH');
    }
    try { return consumeApprovedPathToken(token, expected); } catch (error) { this.revoke(); throw error; }
  }
  static createTestOnly(primitives: RealFsPrimitivePort, deadline: LogicalDeadlinePort,
    expectedBindings: ApprovedPathTokenBinding[]): RealExactHostReadPort {
    return new RealExactHostReadPort(primitives, deadline, expectedBindings);
  }
  private async metadata(operation: 'LSTAT' | 'STAT', token: ApprovedPathToken): Promise<Metadata> {
    const binding = this.expected(operation, token); const result = await this.invoke(() => operation === 'LSTAT' ?
      this.primitives.lstat(binding.exactPath) : this.primitives.stat(binding.exactPath));
    try { return normalizeBigIntMetadata(result); } catch (error) { this.revoke(); throw error; }
  }
  private async path(operation: 'READLINK' | 'REALPATH', token: ApprovedPathToken): Promise<string> {
    const binding = this.expected(operation, token); const result = await this.invoke(() => operation === 'READLINK' ?
      this.primitives.readlink(binding.exactPath) : this.primitives.realpath(binding.exactPath));
    if (result.includes('\0')) { this.revoke(); throw new XrError('XR_LINK_TARGET_INVALID'); }
    return `${result}`;
  }
  private async invoke<T>(operation: () => Promise<T>): Promise<T> {
    const remaining = PER_RECORD_TARGET_MS - (this.deadline.nowMs() - this.startedAt);
    if (remaining <= 0) { this.revokedValue = true; this.stateValue = 'DEADLINE_EXCEEDED';
      throw new XrError('XR_READ_TIMEOUT'); }
    this.stateValue = 'CALL_OUTSTANDING'; this.outstanding += 1;
    const outcome = await this.deadline.execute(Math.min(PER_CALL_TARGET_MS, remaining), operation);
    if (outcome.kind === 'DEADLINE_EXCEEDED') { this.revokedValue = true; this.stateValue = 'OUTSTANDING_IO_QUARANTINED';
      throw new XrError('XR_READ_TIMEOUT'); }
    this.outstanding -= 1;
    if (outcome.kind === 'FAILED') { this.revoke(); throw normalizeRealAdapterError(outcome.error); }
    this.stateValue = this.expectedBindings.length === 0 ? 'COMPLETED' : 'ACTIVE'; return outcome.value;
  }
}

/** Test-only creation seam. Production construction authority is deliberately absent in XR-AI. */
export function createRealAdapterTestHarness(primitives: RealFsPrimitivePort, deadline: LogicalDeadlinePort,
  expectedBindings: readonly ApprovedPathTokenBinding[]): RealExactHostReadPort {
  return RealExactHostReadPort.createTestOnly(primitives, deadline, [...expectedBindings]);
}
