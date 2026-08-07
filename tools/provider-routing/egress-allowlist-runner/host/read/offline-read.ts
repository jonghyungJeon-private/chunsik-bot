import { TIER_A_RECORDS } from '../../allowlist';
import { canonicalize, sha256 } from '../../canonical';
import { AllowlistContract } from '../../contracts';

export const XR_READ_ALLOWLIST_VERSION = 'stage2b-5c-eg-f0-xr-read-allowlist-v1' as const;
export const XR_READ_IDS = Object.freeze(['XR-EXEC-GIT', 'XR-EXEC-SED', 'XR-EXEC-READLINK', 'XR-EXEC-STAT'] as const);
export const XR_METADATA_READ_IMPLEMENTATION_FEASIBLE = true;
export const XR_METADATA_EVIDENCE_EXECUTION_ELIGIBLE = false;
export const CODE_SIGN_READ_FEASIBILITY = 'BLOCKED_FEASIBILITY_GAP';
export const CODE_SIGN_GATE_EFFECT = 'BLOCKS_XG_XF_XA_E';
export const XR_REAL_FILESYSTEM_ADAPTER = 'NOT_IMPLEMENTED';
export const XR_HOST_READ_EXECUTION = 'NOT_PERFORMED';
export const XR_LIMITS = Object.freeze({ pathEntriesPerPass: 16, symlinkHopsPerPass: 8, lstat: 32,
  readlink: 16, realpath: 2, stat: 2, total: 52, linkTargetBytes: 4096,
  aggregateLinkTargetBytes: 32768, evidenceBytes: 32768 } as const);

export type XrReadId = (typeof XR_READ_IDS)[number];
export type XrFailureReason = 'NONE' | 'XR_READ_ID_UNKNOWN' | 'XR_READ_ID_DUPLICATE' | 'XR_READ_ORDER_INVALID' |
  'XR_APPROVED_PATH_UNRESOLVED' | 'XR_PATH_OUTSIDE_APPROVED_CONTEXT' | 'XR_PATH_COMPONENT_LIMIT_EXCEEDED' |
  'XR_SYMLINK_CYCLE' | 'XR_SYMLINK_DEPTH_EXCEEDED' | 'XR_LINK_TARGET_INVALID' | 'XR_REALPATH_MISMATCH' |
  'XR_UNEXPECTED_FILE_TYPE' | 'XR_METADATA_MISMATCH' | 'XR_PERMISSION_DENIED' | 'XR_FILE_MISSING' |
  'XR_UNSUPPORTED_FILESYSTEM_IDENTITY' | 'XR_READ_CALL_CAP_EXCEEDED' | 'XR_READ_BYTE_CAP_EXCEEDED' |
  'XR_EVIDENCE_CAP_EXCEEDED' | 'XR_BASELINE_CHANGED' | 'XR_EVIDENCE_SCHEMA_MISMATCH' | 'XR_READ_TIMEOUT' |
  'COMMAND_SAFETY_BLOCKED';

export interface XrReadRecord { readonly readId: XrReadId; readonly purpose: 'EXECUTABLE_IDENTITY_CAPTURE';
  readonly exactPathSource: 'RESOLVED_STATIC_ALLOWLIST_CONTRACT'; readonly operationPolicy: 'TWO_PASS_COMPONENT_OBSERVATION_V1';
  readonly maximumPathEntriesPerPass: 16; readonly maximumSymlinkHopsPerPass: 8; readonly maximumLstatCalls: 32;
  readonly maximumReadlinkCalls: 16; readonly maximumRealpathCalls: 2; readonly maximumStatCalls: 2;
  readonly maximumTotalPrimitiveCalls: 52; readonly maximumLinkTargetBytes: 4096;
  readonly maximumAggregateLinkTargetBytes: 32768; readonly maximumEvidenceBytes: 32768;
  readonly expectedFinalFileType: 'REGULAR_FILE'; readonly symlinkPolicy: 'ALL_COMPONENTS_DEPTH_8_EXACT_TARGET';
  readonly privilegeClass: 'UNPRIVILEGED'; readonly localDaemonContact: 'NONE'; readonly networkPolicy: 'NONE';
  readonly hostMutation: 'NONE'; readonly normalizedFactSchema: 'HOST_READ_EXECUTABLE_OBSERVATION_V1';
  readonly failureReasons: readonly XrFailureReason[]; readonly dependencies: readonly ['XR_APPROVED_CONTEXT_BOUND'];
  readonly approvalStatus: 'CANDIDATE_ONLY_NOT_APPROVED'; }

const FAILURES = Object.freeze(['XR_READ_ID_UNKNOWN', 'XR_READ_ID_DUPLICATE', 'XR_READ_ORDER_INVALID',
  'XR_APPROVED_PATH_UNRESOLVED', 'XR_PATH_OUTSIDE_APPROVED_CONTEXT', 'XR_PATH_COMPONENT_LIMIT_EXCEEDED',
  'XR_SYMLINK_CYCLE', 'XR_SYMLINK_DEPTH_EXCEEDED', 'XR_LINK_TARGET_INVALID', 'XR_REALPATH_MISMATCH',
  'XR_UNEXPECTED_FILE_TYPE', 'XR_METADATA_MISMATCH', 'XR_PERMISSION_DENIED', 'XR_FILE_MISSING',
  'XR_UNSUPPORTED_FILESYSTEM_IDENTITY', 'XR_READ_CALL_CAP_EXCEEDED', 'XR_READ_BYTE_CAP_EXCEEDED',
  'XR_EVIDENCE_CAP_EXCEEDED', 'XR_BASELINE_CHANGED', 'XR_EVIDENCE_SCHEMA_MISMATCH', 'XR_READ_TIMEOUT',
  'COMMAND_SAFETY_BLOCKED'] as XrFailureReason[]);
function record(readId: XrReadId): XrReadRecord { return Object.freeze({ readId, purpose: 'EXECUTABLE_IDENTITY_CAPTURE',
  exactPathSource: 'RESOLVED_STATIC_ALLOWLIST_CONTRACT', operationPolicy: 'TWO_PASS_COMPONENT_OBSERVATION_V1',
  maximumPathEntriesPerPass: 16, maximumSymlinkHopsPerPass: 8, maximumLstatCalls: 32, maximumReadlinkCalls: 16,
  maximumRealpathCalls: 2, maximumStatCalls: 2, maximumTotalPrimitiveCalls: 52, maximumLinkTargetBytes: 4096,
  maximumAggregateLinkTargetBytes: 32768, maximumEvidenceBytes: 32768, expectedFinalFileType: 'REGULAR_FILE',
  symlinkPolicy: 'ALL_COMPONENTS_DEPTH_8_EXACT_TARGET', privilegeClass: 'UNPRIVILEGED', localDaemonContact: 'NONE',
  networkPolicy: 'NONE', hostMutation: 'NONE', normalizedFactSchema: 'HOST_READ_EXECUTABLE_OBSERVATION_V1',
  failureReasons: FAILURES, dependencies: ['XR_APPROVED_CONTEXT_BOUND'] as const,
  approvalStatus: 'CANDIDATE_ONLY_NOT_APPROVED' }); }
export const XR_READ_ALLOWLIST = Object.freeze(XR_READ_IDS.map(record));
export const XR_FIELD_CLASSIFICATION = Object.freeze({ configuredPath: 'IDENTITY_BEARING_APPROVAL_CONTEXT',
  canonicalRealpath: 'IDENTITY_BEARING_PATH', pathComponentChain: 'IDENTITY_BEARING_PATH',
  symlinkChain: 'IDENTITY_BEARING_PATH', deviceAndInode: 'IDENTITY_BEARING_UNDER_REVIEWED_FILESYSTEM_MODEL',
  uidAndGid: 'SECURITY_POLICY_FIELD', mode: 'SECURITY_POLICY_FIELD', fileType: 'SECURITY_POLICY_FIELD',
  size: 'SUPPORTING_INTEGRITY_FIELD_NOT_SUFFICIENT_ALONE', mtime: 'AUDIT_ONLY_AND_RACE_SIGNAL_NOT_SUFFICIENT_ALONE',
  observedAt: 'AUDIT_ONLY', codeSignObservation: 'UNAVAILABLE_ON_PLATFORM' } as const);

export interface Metadata { readonly fileType: 'DIRECTORY' | 'REGULAR_FILE' | 'SYMLINK'; readonly device: number;
  readonly inode: number; readonly uid: number; readonly gid: number; readonly mode: number; readonly size: number;
  readonly mtime: number; }
export interface ApprovedPathToken { readonly kind: 'XR_APPROVED_PATH_TOKEN'; }
const TOKEN_BRAND = new WeakSet<object>(); const TOKEN_PATH = new WeakMap<object, string>();
function token(path: string): ApprovedPathToken { const value = Object.freeze({ kind: 'XR_APPROVED_PATH_TOKEN' as const });
  TOKEN_BRAND.add(value); TOKEN_PATH.set(value, path); return value; }
export function assertApprovedPathToken(value: ApprovedPathToken): void {
  if (!TOKEN_BRAND.has(value as object) || !TOKEN_PATH.has(value as object)) throw new Error('XR_PATH_TOKEN_FORGED');
}
export interface ExactHostReadPort { lstatExact(path: ApprovedPathToken): Metadata; readlinkExact(path: ApprovedPathToken): string;
  realpathExact(path: ApprovedPathToken): string; statExact(path: ApprovedPathToken): Metadata; }
export interface ComponentObservation { readonly path: string; readonly metadata: Metadata; }
export interface SymlinkObservation { readonly path: string; readonly target: string; readonly metadata: Metadata; }
export interface HostReadExecutableObservation { readonly configuredPath: string; readonly canonicalRealpath: string;
  readonly pathComponentChain: readonly ComponentObservation[]; readonly symlinkChain: readonly SymlinkObservation[];
  readonly finalTargetMetadata: Metadata; readonly codeSignObservation: 'NOT_OBSERVED_BLOCKED_FEASIBILITY_GAP'; }
export interface PrimitiveCallCounts { readonly lstat: number; readonly readlink: number; readonly realpath: number;
  readonly stat: number; readonly total: number; }
export interface HostReadEvidenceBinding { readonly schemaVersion: 'stage2b-5c-eg-f0-xr-evidence-v1';
  readonly readAllowlistVersion: typeof XR_READ_ALLOWLIST_VERSION; readonly readId: XrReadId;
  readonly approvedReadContextIdentity: string; readonly configuredPath: string; readonly preConsistencyToken: string;
  readonly postConsistencyToken: string; readonly normalizedObservation: HostReadExecutableObservation | 'NONE';
  readonly primitiveCallCounts: PrimitiveCallCounts; readonly linkTargetByteCount: number;
  readonly normalizedEvidenceByteCount: number; readonly resultClass: 'SUCCESS' | 'FAILURE';
  readonly failureReason: XrFailureReason; readonly observedAt: string; }
export interface HostReadSequenceResult { readonly resultClass: 'COMPLETED' | 'FAILED';
  readonly evidence: readonly HostReadEvidenceBinding[]; readonly terminalReadId: XrReadId | 'NONE'; }
export interface ApprovedReadContext { readonly identity: string; readonly observedAt: string;
  readonly expectedRealpaths: Readonly<Record<XrReadId, string>>; }

const EVIDENCE_KEYS = Object.freeze(['schemaVersion', 'readAllowlistVersion', 'readId',
  'approvedReadContextIdentity', 'configuredPath', 'preConsistencyToken', 'postConsistencyToken',
  'normalizedObservation', 'primitiveCallCounts', 'linkTargetByteCount', 'normalizedEvidenceByteCount',
  'resultClass', 'failureReason', 'observedAt'] as const);
export function assertClosedHostReadEvidence(value: Readonly<Record<string, unknown>>): void {
  const keys = Object.keys(value).sort(); const expected = [...EVIDENCE_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index]) ||
      value.schemaVersion !== 'stage2b-5c-eg-f0-xr-evidence-v1' ||
      value.readAllowlistVersion !== XR_READ_ALLOWLIST_VERSION || !XR_READ_IDS.includes(value.readId as XrReadId)) {
    throw new XrError('XR_EVIDENCE_SCHEMA_MISMATCH');
  }
}

class XrError extends Error { constructor(readonly reason: XrFailureReason) { super(reason); } }
class Counts {
  lstat = 0; readlink = 0; realpath = 0; stat = 0; total = 0; linkBytes = 0;
  call(kind: 'lstat' | 'readlink' | 'realpath' | 'stat'): void { const next = this[kind] + 1;
    if (next > XR_LIMITS[kind] || this.total + 1 > XR_LIMITS.total) throw new XrError('XR_READ_CALL_CAP_EXCEEDED');
    this[kind] = next; this.total += 1; }
  snapshot(): PrimitiveCallCounts { return Object.freeze({ lstat: this.lstat, readlink: this.readlink,
    realpath: this.realpath, stat: this.stat, total: this.total }); }
}
function utf8(value: string): number { return new TextEncoder().encode(value).byteLength; }
function normalizeAbsolute(path: string): string {
  if (!path.startsWith('/') || path.includes('\0')) throw new XrError('XR_LINK_TARGET_INVALID');
  const parts: string[] = []; for (const part of path.split('/')) { if (part === '' || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part); } return `/${parts.join('/')}`;
}
function parent(path: string): string { const parts = path.split('/'); parts.pop(); return parts.join('/') || '/'; }
function join(base: string, target: string): string {
  return normalizeAbsolute(target.startsWith('/') ? target : `${base}/${target}`);
}

export function validateXrReadAllowlist(records: readonly XrReadRecord[], version = XR_READ_ALLOWLIST_VERSION): void {
  if (version !== XR_READ_ALLOWLIST_VERSION || records.length !== 4) throw new XrError('XR_READ_ORDER_INVALID');
  const ids = records.map((entry) => entry.readId);
  if (new Set(ids).size !== ids.length) throw new XrError('XR_READ_ID_DUPLICATE');
  if (ids.some((id, index) => id !== XR_READ_IDS[index])) throw new XrError('XR_READ_ORDER_INVALID');
  if (records.some((entry) => canonicalize(entry) !== canonicalize(XR_READ_ALLOWLIST[XR_READ_IDS.indexOf(entry.readId)]))) {
    throw new XrError('XR_READ_ORDER_INVALID');
  }
}

function executablePaths(contract: AllowlistContract): Readonly<Record<XrReadId, string>> {
  const unique = [...new Set(contract.records.map((entry) => entry.executable))];
  if (unique.length !== 4 || unique.some((path) => !path.startsWith('/'))) throw new XrError('XR_APPROVED_PATH_UNRESOLVED');
  return Object.freeze(Object.fromEntries(XR_READ_IDS.map((id, index) => [id, unique[index]!])) as unknown as Record<XrReadId, string>);
}

function observe(configuredPath: string, port: ExactHostReadPort, counts: Counts): HostReadExecutableObservation {
  let pending = normalizeAbsolute(configuredPath).split('/').filter(Boolean); let resolved: string[] = [];
  const components: ComponentObservation[] = []; const links: SymlinkObservation[] = []; const seen = new Set<string>();
  let entries = 0; let hops = 0;
  while (pending.length > 0) {
    if (entries >= XR_LIMITS.pathEntriesPerPass) throw new XrError('XR_PATH_COMPONENT_LIMIT_EXCEEDED');
    const part = pending.shift()!; const candidate = `/${[...resolved, part].join('/')}`; entries += 1; counts.call('lstat');
    const pathToken = token(candidate); const metadata = port.lstatExact(pathToken);
    if (metadata.fileType === 'SYMLINK') {
      if (hops >= XR_LIMITS.symlinkHopsPerPass) throw new XrError('XR_SYMLINK_DEPTH_EXCEEDED');
      if (seen.has(candidate)) throw new XrError('XR_SYMLINK_CYCLE'); seen.add(candidate); hops += 1; counts.call('readlink');
      const target = port.readlinkExact(pathToken); const bytes = utf8(target);
      if (bytes > XR_LIMITS.linkTargetBytes || counts.linkBytes + bytes > XR_LIMITS.aggregateLinkTargetBytes) {
        throw new XrError('XR_READ_BYTE_CAP_EXCEEDED');
      }
      counts.linkBytes += bytes; links.push(Object.freeze({ path: candidate, target, metadata }));
      const next = join(parent(candidate), target); pending = [...next.split('/').filter(Boolean), ...pending]; resolved = [];
    } else { components.push(Object.freeze({ path: candidate, metadata })); resolved.push(part); }
  }
  const manual = `/${resolved.join('/')}`; counts.call('realpath'); const realpath = normalizeAbsolute(port.realpathExact(token(configuredPath)));
  if (manual !== realpath) throw new XrError('XR_REALPATH_MISMATCH'); counts.call('stat'); const finalMetadata = port.statExact(token(manual));
  if (finalMetadata.fileType !== 'REGULAR_FILE') throw new XrError('XR_UNEXPECTED_FILE_TYPE');
  return deepFreeze({ configuredPath, canonicalRealpath: realpath, pathComponentChain: components,
    symlinkChain: links, finalTargetMetadata: finalMetadata, codeSignObservation: 'NOT_OBSERVED_BLOCKED_FEASIBILITY_GAP' });
}
function consistency(context: ApprovedReadContext, observation: HostReadExecutableObservation): string {
  const { mtime: _mtime, ...target } = observation.finalTargetMetadata;
  return sha256(canonicalize({ approvedReadContextIdentity: context.identity, configuredPath: observation.configuredPath,
    pathComponentChain: observation.pathComponentChain, symlinkChain: observation.symlinkChain,
    canonicalRealpath: observation.canonicalRealpath, finalTargetMetadata: target,
    policy: { readAllowlistVersion: XR_READ_ALLOWLIST_VERSION, limits: XR_LIMITS } }));
}
function deepFreeze<T>(value: T): T { if (value !== null && typeof value === 'object') {
  for (const child of Object.values(value as object)) deepFreeze(child); Object.freeze(value); } return value; }

export function runApprovedHostReadSequence(context: ApprovedReadContext, contract: AllowlistContract,
  port: ExactHostReadPort, records: readonly XrReadRecord[] = XR_READ_ALLOWLIST): HostReadSequenceResult {
  validateXrReadAllowlist(records); const paths = executablePaths(contract); const evidence: HostReadEvidenceBinding[] = [];
  for (const record of records) { const counts = new Counts(); const path = paths[record.readId];
    try { const pre = observe(path, port, counts); const post = observe(path, port, counts);
      if (pre.canonicalRealpath !== context.expectedRealpaths[record.readId]) throw new XrError('XR_REALPATH_MISMATCH');
      const preToken = consistency(context, pre); const postToken = consistency(context, post);
      if (preToken !== postToken) throw new XrError('XR_BASELINE_CHANGED');
      const base = { schemaVersion: 'stage2b-5c-eg-f0-xr-evidence-v1' as const,
        readAllowlistVersion: XR_READ_ALLOWLIST_VERSION, readId: record.readId,
        approvedReadContextIdentity: context.identity, configuredPath: path, preConsistencyToken: preToken,
        postConsistencyToken: postToken, normalizedObservation: pre, primitiveCallCounts: counts.snapshot(),
        linkTargetByteCount: counts.linkBytes, normalizedEvidenceByteCount: 0, resultClass: 'SUCCESS' as const,
        failureReason: 'NONE' as const, observedAt: context.observedAt };
      let size = 0; for (;;) { const next = utf8(canonicalize({ ...base, normalizedEvidenceByteCount: size }));
        if (next === size) break; size = next; }
      if (size > XR_LIMITS.evidenceBytes) throw new XrError('XR_EVIDENCE_CAP_EXCEEDED');
      const binding = deepFreeze({ ...base, normalizedEvidenceByteCount: size });
      assertClosedHostReadEvidence(binding as unknown as Readonly<Record<string, unknown>>); evidence.push(binding);
    } catch (error) { const reason = error instanceof XrError ? error.reason : 'COMMAND_SAFETY_BLOCKED';
      const failure = deepFreeze({ schemaVersion: 'stage2b-5c-eg-f0-xr-evidence-v1' as const,
        readAllowlistVersion: XR_READ_ALLOWLIST_VERSION, readId: record.readId,
        approvedReadContextIdentity: context.identity, configuredPath: path, preConsistencyToken: '', postConsistencyToken: '',
        normalizedObservation: 'NONE' as const, primitiveCallCounts: counts.snapshot(), linkTargetByteCount: counts.linkBytes,
        normalizedEvidenceByteCount: 0, resultClass: 'FAILURE' as const, failureReason: reason, observedAt: context.observedAt });
      assertClosedHostReadEvidence(failure as unknown as Readonly<Record<string, unknown>>);
      return deepFreeze({ resultClass: 'FAILED', evidence: [...evidence, failure], terminalReadId: record.readId });
    }
  }
  return deepFreeze({ resultClass: 'COMPLETED', evidence, terminalReadId: 'NONE' });
}

/** Fixture-only scripted port. It never imports a host API. */
export class ScriptedExactHostReadPort implements ExactHostReadPort {
  readonly calls: string[] = [];
  constructor(private readonly script: { lstat: Metadata[]; readlink: string[]; realpath: string[]; stat: Metadata[] }) {}
  private take<T>(kind: keyof typeof this.script, tokenValue: ApprovedPathToken): T { assertApprovedPathToken(tokenValue);
    this.calls.push(kind); const value = this.script[kind].shift(); if (value === undefined) throw new Error('FIXTURE_MISSING'); return value as T; }
  lstatExact(path: ApprovedPathToken): Metadata { return this.take('lstat', path); }
  readlinkExact(path: ApprovedPathToken): string { return this.take('readlink', path); }
  realpathExact(path: ApprovedPathToken): string { return this.take('realpath', path); }
  statExact(path: ApprovedPathToken): Metadata { return this.take('stat', path); }
}
