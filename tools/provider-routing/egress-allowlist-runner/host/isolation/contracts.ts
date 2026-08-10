import type { Metadata, XrReadOperation, XrReadPass } from '../read/offline-read';

export const XR_FCI_PROTOCOL_VERSION = 1 as const;
export const XR_FCI_MAX_FRAME_BYTES = 8192;
export const XR_FCI_MAX_AGGREGATE_BYTES = 65536;
export const XR_FCI_MAX_REQUESTS = 52;
export const XR_FCI_STDERR_BYTES = 4096;
export const XR_FCI_CHILD_HARD_LIFETIME_MS = 4000;
export const XR_FCI_TERM_GRACE_MS = 250;
export const XR_FCI_FINAL_PROOF_MS = 1000;
export const XR_FCI_UMASK = 0o077;
export const OBSERVER_IDENTITY_PRESPAWN_TOCTOU = 'NOT_CLOSED_BY_PURE_NODE_PLAN' as const;
export const CHILD_SELF_DEADLINE_PROVES_BOUNDED_EXIT = false;
export const SELF_WATCHDOG_PROVES_FULL_ADR_CONTAINMENT = false;
export const UNINTERRUPTIBLE_WAIT_RESIDUAL = 'ACCEPTED_BY_CHIEF_ARCHITECT' as const;
export const XR_OBSERVER_STDIN_WRITER_INVARIANT = 'PROCESS_WIDE' as const;

export type XrFciOperation = XrReadOperation;
export type XrFciPass = XrReadPass;
export type XrFciPrimitiveValue = string | Metadata;

export interface XrFciOperationRequest {
  readonly protocolVersion: typeof XR_FCI_PROTOCOL_VERSION;
  readonly recordNonce: string;
  readonly sequenceIndex: number;
  readonly pass: XrFciPass;
  readonly operation: XrFciOperation;
  readonly exactPath: string;
}
export interface XrFciCloseRequest { readonly protocolVersion: typeof XR_FCI_PROTOCOL_VERSION;
  readonly recordNonce: string; readonly sequenceIndex: number; readonly close: true; }
export interface XrFciOkResponse { readonly protocolVersion: typeof XR_FCI_PROTOCOL_VERSION;
  readonly recordNonce: string; readonly sequenceIndex: number; readonly status: 'OK';
  readonly result: XrFciPrimitiveValue; }
export type XrFciPrimitiveError = 'ENOENT' | 'ENOTDIR' | 'ELOOP' | 'EACCES' | 'EPERM' | 'EINVAL' |
  'ENAMETOOLONG' | 'IO_UNCLASSIFIED';
export interface XrFciErrorResponse { readonly protocolVersion: typeof XR_FCI_PROTOCOL_VERSION;
  readonly recordNonce: string; readonly sequenceIndex: number; readonly status: 'ERROR';
  readonly error: XrFciPrimitiveError; }
export interface XrFciClosedResponse { readonly protocolVersion: typeof XR_FCI_PROTOCOL_VERSION;
  readonly recordNonce: string; readonly sequenceIndex: number; readonly status: 'CLOSED'; }
export type XrFciResponse = XrFciOkResponse | XrFciErrorResponse | XrFciClosedResponse;

export interface XrObserverIdentity { readonly contractVersion: 1; readonly protocolVersion: 1;
  readonly nodeExecutableRealpath: string; readonly nodeExecutableSha256: string;
  readonly observerEntrypointRealpath: string; readonly observerEntrypointSha256: string;
  readonly observerBundleByteLength: number; readonly buildBindingSha256: string; }
export interface XrObserverFdInvariant { readonly parentIsSoleWriter: boolean; readonly childHasNoWriter: boolean;
  readonly noSiblingHelperOrDescendantWriter: boolean; readonly noDuplicateOrTransferredWriter: boolean;
  readonly unrelatedSpawnsCloseOnExec: boolean; readonly childCreatesNoDescendants: boolean; }
export interface XrObserverCredentialPolicy { readonly expectedUid: number; readonly expectedGid: number;
  readonly expectedSupplementaryGroups: readonly number[]; readonly privilegeEscalation: 'NONE'; }
export interface XrObserverComposition { readonly expectedIdentity: XrObserverIdentity; readonly sandboxCwd: string;
  readonly credentials: XrObserverCredentialPolicy; }

export const XR_FCI_ENVIRONMENT = Object.freeze({ LANG: 'C', LC_ALL: 'C', NO_COLOR: '1' } as const);
export const XR_FCI_RESOURCE_CLAIMS = Object.freeze({ wallTime: 'PARENT_AND_CHILD_BOUNDED',
  requestCount: 'ENFORCED', protocolBytes: 'ENFORCED', stderrBytes: 'ENFORCED', concurrentChildren: 'ENFORCED',
  fileWrites: 'STATIC_SEMANTIC_DEFENSE', cpuRlimit: 'NOT_AVAILABLE_NOT_CLAIMED',
  rssRlimit: 'NOT_AVAILABLE_NOT_CLAIMED', nofileRlimit: 'NOT_AVAILABLE_NOT_CLAIMED',
  fileSizeRlimit: 'NOT_AVAILABLE_NOT_CLAIMED' } as const);

export interface XrObserverSpawnRequest { readonly executable: string; readonly argv: readonly [string];
  readonly shell: false; readonly cwd: string; readonly env: typeof XR_FCI_ENVIRONMENT;
  readonly stdio: readonly ['pipe', 'pipe', 'pipe']; readonly extraFds: 'NONE'; readonly detached: false;
  readonly umask: typeof XR_FCI_UMASK; readonly credentials: XrObserverCredentialPolicy;
  readonly resourceClaims: typeof XR_FCI_RESOURCE_CLAIMS; }

export type XrFciFailureReason = 'OBSERVER_IDENTITY_INVALID' | 'CHILD_INVARIANT_VIOLATION' |
  'SANDBOX_INVALID' | 'SPAWN_REQUEST_FAILED' | 'PROTOCOL_WRITE_FAILED' | 'PROTOCOL_READ_FAILED' |
  'PROTOCOL_INVALID' | 'UNEXPECTED_OPERATION' | 'RESPONSE_CAP_EXCEEDED' | 'STDERR_CAP_EXCEEDED' |
  'STDERR_NONEMPTY' | 'DEADLINE_EXPIRED' | 'TERM_FAILED' | 'KILL_FAILED' | 'EXIT_UNPROVEN' |
  'REAP_UNPROVEN' | 'STREAM_CLOSE_UNPROVEN' | 'CLEANUP_FAILED' | 'UNEXPECTED_EXIT' |
  'DUPLICATE_RESPONSE' | 'LATE_RESPONSE' | 'UNEXPECTED_PARENT_LOSS' | 'SELF_DEADLINE_EXPIRED';

export type XrFciState = 'IDLE' | 'IDENTITY_VALIDATED' | 'ACTIVE' | 'CLOSING' | 'TERMINATING' |
  'WATCHDOG_FAILED' | 'EXIT_OBSERVED' | 'REAP_PROVEN' | 'STREAMS_CLOSED' | 'CLEANING' |
  'CLEAN_TERMINAL' | 'UNCERTAIN_TERMINAL';
export type XrFciEofClass = 'NORMAL_CLOSE_EOF' | 'PARENT_CONTAINMENT_EOF' | 'UNEXPECTED_PARENT_LOSS_EOF';
export type XrFciOutcome = 'SUCCESS' | 'FAILED';
export interface XrFciTerminalResult { readonly state: 'CLEAN_TERMINAL' | 'UNCERTAIN_TERMINAL';
  readonly outcome: XrFciOutcome; readonly primaryFailure: XrFciFailureReason | 'NONE';
  readonly failures: readonly XrFciFailureReason[]; readonly provisionalResultCount: number; }

export interface XrObserverLifecyclePort {
  nowMs(): number;
  spawn(request: XrObserverSpawnRequest): void;
  write(frame: Uint8Array): void;
  closeRequestSide(): void;
  requestTerm(): void;
  requestKill(): void;
  cleanupExactSandbox(cwd: string): void;
}

export const XR_FCI_FAILURE_PRECEDENCE: readonly XrFciFailureReason[] = Object.freeze([
  'OBSERVER_IDENTITY_INVALID', 'CHILD_INVARIANT_VIOLATION', 'SANDBOX_INVALID', 'SPAWN_REQUEST_FAILED',
  'PROTOCOL_INVALID', 'DUPLICATE_RESPONSE', 'LATE_RESPONSE', 'UNEXPECTED_OPERATION', 'PROTOCOL_WRITE_FAILED',
  'PROTOCOL_READ_FAILED', 'RESPONSE_CAP_EXCEEDED', 'STDERR_CAP_EXCEEDED', 'STDERR_NONEMPTY',
  'UNEXPECTED_PARENT_LOSS', 'SELF_DEADLINE_EXPIRED', 'DEADLINE_EXPIRED', 'UNEXPECTED_EXIT', 'TERM_FAILED',
  'KILL_FAILED', 'EXIT_UNPROVEN', 'REAP_UNPROVEN', 'STREAM_CLOSE_UNPROVEN', 'CLEANUP_FAILED',
]);
