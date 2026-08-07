import { TIER_A_COMMAND_IDS, TIER_A_RECORDS } from '../allowlist';
import { canonicalize, sha256 } from '../canonical';
import {
  AllowlistContract, AllowlistRecord, COMMAND_EVIDENCE_CONTRACT_VERSION, COMMAND_ORDER_VERSION,
  CommandEvidence, EVIDENCE_SCHEMA_VERSION, ExecutableIdentity, ExitClass, StopReason,
} from '../contracts';
import {
  SymbolResolutionResult, assertClosedEvidence, deriveDependencyState, isDispatchable, isIssuedSymbolResolution,
  validateContract,
} from '../runner';

export const HOST_EXECUTION_ELIGIBILITY = Object.freeze({ mockedImplementation: true, liveAuthorization: false,
  liveExecution: false, toctouGate: 'BLOCKED_FEASIBILITY_GAP_FOR_LIVE_EXECUTION',
  environmentViability: 'EXECUTION_GATE_NOT_EVALUATED' } as const);
export const EXACT_ENVIRONMENT = Object.freeze({ LANG: 'C', LC_ALL: 'C' } as const);
export const MAX_SEGMENT_BYTES = 4096;
export const COMMAND_TIMEOUT_MS = 5000;

export type ProcessSignal = 'NONE' | 'SIGTERM' | 'SIGKILL' | 'UNEXPECTED_SIGNAL';
export type ProcessEvent =
  | Readonly<{ type: 'SPAWN_CONFIRMED' | 'PROCESS_CLOSE' | 'STDOUT_END' | 'STDERR_END' }>
  | Readonly<{ type: 'SPAWN_ERROR' | 'STDOUT_ERROR' | 'STDERR_ERROR'; message: string }>
  | Readonly<{ type: 'PROCESS_EXIT'; exitCode: number | 'NONE'; signal: ProcessSignal }>
  | Readonly<{ type: 'STDOUT_DATA' | 'STDERR_DATA'; chunk: Uint8Array }>;

export interface HostProcessRequest { readonly commandId: string; readonly executable: string;
  readonly argv: readonly string[]; readonly workingDirectory: string; readonly environment: typeof EXACT_ENVIRONMENT;
  readonly timeoutMs: 5000; readonly topology: 'ONE_BOUNDED_CHILD_NO_DESCENDANTS'; }
export interface HostProcessPort {
  dispatch(request: HostProcessRequest, capability: DispatchCapability, emit: (event: ProcessEvent) => void): void;
}
export interface ExecutableIdentityPort {
  verifyExactPath(record: AllowlistRecord, phase: 'INITIAL' | 'PRE_DISPATCH'): ExecutableIdentity | undefined;
}
export interface TerminationPort { signalExactChild(signal: 'SIGTERM' | 'SIGKILL'): boolean; isExactChildClosed(): boolean; }
export type TimerHandle = Readonly<{ id: number }>;
export interface SequencerClock {
  nowMs(): number;
  schedule(delayMs: number, callback: () => void): TimerHandle;
  cancel(handle: TimerHandle): void;
  advanceBy(ms: number): void;
}

interface CapabilityBinding { readonly staticAllowlistDigest: string; readonly executionBaselineDigest: string;
  readonly commandOrderVersion: typeof COMMAND_ORDER_VERSION; readonly sequencerRunId: string;
  readonly sequenceIndex: number; readonly commandId: string; }
export interface DispatchCapability { readonly kind: 'F0_HI_SINGLE_USE_DISPATCH_CAPABILITY'; }
const CAPABILITY_BRAND = new WeakSet<object>();
const CAPABILITY_BINDINGS = new WeakMap<object, CapabilityBinding>();
const CONSUMED_CAPABILITIES = new WeakSet<object>();

class ExecutionAuthority {
  private revoked = false;
  issue(binding: CapabilityBinding): DispatchCapability {
    if (this.revoked) throw new Error('EXECUTION_AUTHORITY_REVOKED');
    const capability = Object.freeze({ kind: 'F0_HI_SINGLE_USE_DISPATCH_CAPABILITY' as const });
    CAPABILITY_BRAND.add(capability); CAPABILITY_BINDINGS.set(capability, Object.freeze({ ...binding }));
    return capability;
  }
  revoke(): void { this.revoked = true; }
}
function consumeCapability(capability: DispatchCapability, expected: CapabilityBinding): void {
  const value = capability as object; const binding = CAPABILITY_BINDINGS.get(value);
  if (!CAPABILITY_BRAND.has(value) || binding === undefined) throw new Error('DISPATCH_CAPABILITY_FORGED');
  if (CONSUMED_CAPABILITIES.has(value)) throw new Error('DISPATCH_CAPABILITY_CONSUMED');
  CONSUMED_CAPABILITIES.add(value);
  if (canonicalize(binding) !== canonicalize(expected)) throw new Error('DISPATCH_CAPABILITY_BINDING_MISMATCH');
}
/** Internal fixture seam; deliberately omitted from `host/index.ts`. */
export function createOfflineCapabilityTestHarness(binding: CapabilityBinding): Readonly<{
  capability: DispatchCapability; consume(value?: DispatchCapability, expected?: CapabilityBinding): void;
  revoke(): void; issue(): DispatchCapability;
}> {
  const authority = new ExecutionAuthority(); const capability = authority.issue(binding);
  return Object.freeze({ capability,
    consume: (value = capability, expected = binding) => consumeCapability(value, expected),
    revoke: () => authority.revoke(), issue: () => authority.issue(binding) });
}

export function assertExactEnvironment(value: Readonly<Record<string, string>>): void {
  if (canonicalize(value) !== canonicalize(EXACT_ENVIRONMENT)) throw new Error('ENVIRONMENT_POLICY_MISMATCH');
}

export class DeterministicTerminationController {
  constructor(private readonly port: TerminationPort, private readonly clock: SequencerClock) {}
  terminate(alreadyExited: boolean): 'CLOSED' | 'FAILED' {
    if (alreadyExited) return 'CLOSED';
    if (!this.port.signalExactChild('SIGTERM')) return 'FAILED';
    this.clock.advanceBy(500); if (this.port.isExactChildClosed()) return 'CLOSED';
    if (!this.port.signalExactChild('SIGKILL')) return 'FAILED';
    this.clock.advanceBy(500); return this.port.isExactChildClosed() ? 'CLOSED' : 'FAILED';
  }
}

export interface StreamState { readonly byteCount: number; readonly lineCount: number;
  readonly capExceeded: boolean; readonly invalidUtf8: boolean; readonly nonEmpty: boolean;
  readonly normalizedOutput: string; readonly ended: boolean; readonly maxSegmentBytes: number;
  readonly maxPendingSegments: 1; readonly decoderFlushCount: number; }
class BoundedStream {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private byteCount = 0; private lineCount = 0; private capExceeded = false; private invalidUtf8 = false;
  private nonEmpty = false; private normalizedOutput = ''; private ended = false; private pendingCr = false;
  private maxSeenSegment = 0; private flushCount = 0;
  constructor(private readonly maxBytes: number, private readonly maxLines: number) {}
  data(chunk: Uint8Array): void {
    if (this.ended) return;
    for (let offset = 0; offset < chunk.byteLength; offset += MAX_SEGMENT_BYTES) {
      const segment = chunk.slice(offset, Math.min(offset + MAX_SEGMENT_BYTES, chunk.byteLength));
      this.maxSeenSegment = Math.max(this.maxSeenSegment, segment.byteLength); this.nonEmpty ||= segment.byteLength > 0;
      this.byteCount += segment.byteLength;
      if (this.byteCount > this.maxBytes) { this.capExceeded = true; continue; }
      try { this.append(this.decoder.decode(segment, { stream: true })); } catch { this.invalidUtf8 = true; }
    }
  }
  end(): void {
    if (this.ended) return; this.flushCount += 1;
    if (!this.capExceeded && !this.invalidUtf8) {
      try { this.append(this.decoder.decode()); } catch { this.invalidUtf8 = true; }
    }
    if (this.pendingCr) { this.normalizedOutput += '\n'; this.lineCount += 1; this.pendingCr = false; }
    if (this.lineCount > this.maxLines) this.capExceeded = true;
    this.ended = true;
  }
  private append(value: string): void {
    for (const character of value) {
      if (this.pendingCr) {
        this.normalizedOutput += '\n'; this.lineCount += 1; this.pendingCr = false;
        if (character === '\n') { if (this.lineCount > this.maxLines) this.capExceeded = true; continue; }
      }
      if (character === '\r') this.pendingCr = true;
      else if (character === '\n') { this.normalizedOutput += '\n'; this.lineCount += 1; }
      else this.normalizedOutput += character;
      if (this.lineCount + (this.normalizedOutput.endsWith('\n') ? 0 : 1) > this.maxLines) this.capExceeded = true;
    }
  }
  state(): StreamState { return Object.freeze({ byteCount: this.byteCount,
    lineCount: this.lineCount + (this.nonEmpty && !this.normalizedOutput.endsWith('\n') ? 1 : 0),
    capExceeded: this.capExceeded, invalidUtf8: this.invalidUtf8, nonEmpty: this.nonEmpty,
    normalizedOutput: this.invalidUtf8 || this.capExceeded ? '' : this.normalizedOutput, ended: this.ended,
    maxSegmentBytes: this.maxSeenSegment, maxPendingSegments: 1, decoderFlushCount: this.flushCount }); }
}

export interface ArbiterResult { readonly completed: boolean; readonly stopReason: StopReason;
  readonly exitCode: number | 'NONE'; readonly signal: ProcessSignal; readonly stdout: StreamState;
  readonly stderr: StreamState; readonly childExited: boolean; }
export class DeterministicProcessEventArbiter {
  private terminal?: ArbiterResult; private spawnConfirmed = false; private closeObserved = false;
  private childExited = false; private exitCode: number | 'NONE' = 'NONE'; private signal: ProcessSignal = 'NONE';
  private readonly stdout: BoundedStream; private readonly stderr: BoundedStream; private disposed = false;
  constructor(record: AllowlistRecord) { this.stdout = new BoundedStream(record.stdoutMaxBytes, record.stdoutMaxLines);
    this.stderr = new BoundedStream(record.stderrMaxBytes, record.stderrMaxLines); }
  accept(event: ProcessEvent | Readonly<{ type: 'TIMEOUT' }>): ArbiterResult | undefined {
    if (this.terminal !== undefined) return this.terminal;
    switch (event.type) {
      case 'SPAWN_CONFIRMED': this.spawnConfirmed = true; break;
      case 'SPAWN_ERROR': return this.finish('PROCESS_SPAWN_FAILED');
      case 'STDOUT_DATA': this.stdout.data(event.chunk); break;
      case 'STDERR_DATA': this.stderr.data(event.chunk); break;
      case 'STDOUT_END': this.stdout.end(); break;
      case 'STDERR_END': this.stderr.end(); break;
      case 'STDOUT_ERROR': case 'STDERR_ERROR': return this.finish('STREAM_READ_FAILED');
      case 'PROCESS_EXIT': this.childExited = true; this.exitCode = event.exitCode; this.signal = event.signal; break;
      case 'PROCESS_CLOSE': this.closeObserved = true; break;
      case 'TIMEOUT': return this.finish('COMMAND_TIMEOUT');
    }
    const stdout = this.stdout.state(); const stderr = this.stderr.state();
    if (stdout.ended && stderr.ended) {
      if (stdout.capExceeded && stderr.capExceeded) return this.finish('BOTH_STREAM_OUTPUT_LIMIT_EXCEEDED');
      if (stderr.capExceeded) return this.finish('STDERR_OUTPUT_LIMIT_EXCEEDED');
      if (stdout.capExceeded) return this.finish('STDOUT_OUTPUT_LIMIT_EXCEEDED');
      if (stdout.invalidUtf8 || stderr.invalidUtf8) return this.finish('INVALID_UTF8');
      if (stderr.nonEmpty) return this.finish('STDERR_NONEMPTY');
    }
    if (this.spawnConfirmed && this.childExited && this.closeObserved && stdout.ended && stderr.ended) {
      if (this.signal !== 'NONE') return this.finish('UNEXPECTED_EXIT');
      return this.finish(this.exitCode === 0 ? 'NONE' : 'NONZERO_EXIT');
    }
    return undefined;
  }
  private finish(stopReason: StopReason): ArbiterResult {
    if (this.terminal !== undefined) return this.terminal; this.disposed = true;
    this.terminal = Object.freeze({ completed: stopReason === 'NONE', stopReason, exitCode: this.exitCode,
      signal: this.signal, stdout: this.stdout.state(), stderr: this.stderr.state(), childExited: this.childExited });
    return this.terminal;
  }
  get isDisposed(): boolean { return this.disposed; }
}

const EXIT_CLASS_BY_STOP_REASON: Readonly<Record<StopReason, ExitClass>> = Object.freeze({
  NONE: 'SUCCESS', ALLOWLIST_UNRESOLVED: 'ALLOWLIST_UNRESOLVED', EXPECTED_NOT_FOUND: 'EXPECTED_NOT_FOUND',
  BASELINE_MISMATCH: 'BASELINE_MISMATCH', EXECUTABLE_MISMATCH: 'EXECUTABLE_MISMATCH',
  GIT_IDENTITY_NOT_ESTABLISHED: 'DEPENDENCY_UNSATISFIED', NONZERO_EXIT: 'EXECUTION_ERROR',
  UNEXPECTED_EXIT: 'UNEXPECTED_EXIT', PERMISSION_DENIED: 'PERMISSION_DENIED', STDERR_NONEMPTY: 'STDERR_NONEMPTY',
  STDERR_OUTPUT_LIMIT_EXCEEDED: 'OUTPUT_LIMIT_EXCEEDED', STDOUT_OUTPUT_LIMIT_EXCEEDED: 'OUTPUT_LIMIT_EXCEEDED',
  BOTH_STREAM_OUTPUT_LIMIT_EXCEEDED: 'OUTPUT_LIMIT_EXCEEDED', SCHEMA_MISMATCH: 'SCHEMA_MISMATCH',
  INVALID_UTF8: 'SCHEMA_MISMATCH', PATTERN_MISMATCH: 'SCHEMA_MISMATCH', OUTPUT_TRUNCATED: 'OUTPUT_LIMIT_EXCEEDED',
  NORMALIZATION_FAILED: 'SCHEMA_MISMATCH', DEPENDENCY_NOT_ESTABLISHED: 'DEPENDENCY_UNSATISFIED',
  LOCAL_DAEMON_CONTACT_DETECTED: 'COMMAND_SAFETY_BLOCKED', NETWORK_ACTIVITY_DETECTED: 'COMMAND_SAFETY_BLOCKED',
  COMMAND_SAFETY_BLOCKED: 'COMMAND_SAFETY_BLOCKED', COMMAND_TIMEOUT: 'EXECUTION_ERROR',
  PROCESS_SPAWN_FAILED: 'EXECUTION_ERROR', STREAM_READ_FAILED: 'EXECUTION_ERROR',
  PROCESS_TERMINATION_FAILED: 'EXECUTION_ERROR',
});
export function mapStopReasonToExitClass(reason: StopReason): ExitClass { return EXIT_CLASS_BY_STOP_REASON[reason]; }

export type SequencerResultClass = 'COMPLETED' | 'BASELINE_FAILED' | 'COMMAND_SAFETY_FAILED' |
  'COMMAND_EXECUTION_FAILED' | 'EVIDENCE_VALIDATION_FAILED' | 'PROCESS_TERMINATION_FAILED';
export interface SequencerResult { readonly resultClass: SequencerResultClass; readonly terminalCommandId: string | 'NONE';
  readonly terminalSequenceIndex: number | 'NONE'; readonly staticAllowlistDigest: string;
  readonly executionBaselineDigest: string; readonly acceptedEvidenceCount: number;
  readonly terminalEvidence: CommandEvidence | 'NONE'; readonly orderedEvidence: readonly CommandEvidence[]; }
export interface OfflineExecutionContext { readonly staticAllowlistDigest: string; readonly executionBaselineDigest: string;
  readonly sequencerRunId: string; readonly repositoryBranch: string; readonly repositoryHead: string;
  readonly resolvedContract: AllowlistContract; readonly symbolResolution: SymbolResolutionResult;
  readonly approvedIdentities: Readonly<Record<string, ExecutableIdentity>>; readonly observedAt: string; }

export class StopOnFirstFailureSequencer {
  private consumed = false;
  constructor(private readonly processPort: HostProcessPort, private readonly identityPort: ExecutableIdentityPort,
    private readonly terminationPort: TerminationPort | undefined, private readonly clock: SequencerClock | undefined) {}
  run(context: OfflineExecutionContext): SequencerResult {
    if (this.consumed) throw new Error('EXECUTION_CONTEXT_CONSUMED'); this.consumed = true;
    const contractError = this.validateExecutionContract(context);
    if (contractError !== undefined) return this.fail('BASELINE_FAILED', contractError, context, [], TIER_A_RECORDS[0]!, 0);
    const records = context.resolvedContract.records; const authority = new ExecutionAuthority();
    const accepted: CommandEvidence[] = [];
    if (this.terminationPort === undefined || this.clock === undefined) {
      authority.revoke(); return this.fail('COMMAND_SAFETY_FAILED', 'COMMAND_SAFETY_BLOCKED', context, accepted, records[0]!, 0);
    }
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]!;
      const dependency = deriveDependencyState({ symbolResolution: context.symbolResolution, priorEvidence: accepted,
        allowlistDigest: context.staticAllowlistDigest, executionBaselineDigest: context.executionBaselineDigest,
        sequencerRunId: context.sequencerRunId, sequenceIndex: index, repositoryHead: context.repositoryHead,
        workingDirectory: record.workingDirectory });
      const dispatchable = isDispatchable(record, dependency, { allowlistDigest: context.staticAllowlistDigest,
        executionBaselineDigest: context.executionBaselineDigest, sequencerRunId: context.sequencerRunId,
        sequenceIndex: index, repositoryHead: context.repositoryHead, workingDirectory: record.workingDirectory });
      if (!dispatchable.dispatchable) { authority.revoke();
        return this.fail('COMMAND_SAFETY_FAILED', dispatchable.reason, context, accepted, record, index); }
      const approved = context.approvedIdentities[record.commandId]; const initial = this.identityPort.verifyExactPath(record, 'INITIAL');
      const preDispatch = this.identityPort.verifyExactPath(record, 'PRE_DISPATCH');
      if (approved === undefined || initial === undefined || preDispatch === undefined ||
          canonicalize(initial) !== canonicalize(approved) || canonicalize(preDispatch) !== canonicalize(approved)) {
        authority.revoke(); return this.fail('COMMAND_SAFETY_FAILED', 'EXECUTABLE_MISMATCH', context, accepted, record, index);
      }
      const binding = Object.freeze({ staticAllowlistDigest: context.staticAllowlistDigest,
        executionBaselineDigest: context.executionBaselineDigest, commandOrderVersion: COMMAND_ORDER_VERSION,
        sequencerRunId: context.sequencerRunId, sequenceIndex: index, commandId: record.commandId });
      const capability = authority.issue(binding); consumeCapability(capability, binding);
      const arbiter = new DeterministicProcessEventArbiter(record); let outcome: ArbiterResult | undefined;
      const timer = this.clock.schedule(COMMAND_TIMEOUT_MS, () => { outcome = arbiter.accept({ type: 'TIMEOUT' }) ?? outcome; });
      const startedAt = this.clock.nowMs();
      try { this.processPort.dispatch(Object.freeze({ commandId: record.commandId, executable: record.executable,
        argv: Object.freeze([...record.argv]), workingDirectory: record.workingDirectory, environment: EXACT_ENVIRONMENT,
        timeoutMs: 5000, topology: 'ONE_BOUNDED_CHILD_NO_DESCENDANTS' }), capability,
      (event) => { outcome = arbiter.accept(event) ?? outcome; }); }
      catch { outcome = arbiter.accept({ type: 'SPAWN_ERROR', message: 'FIXTURE_DISPATCH_ERROR' }); }
      if (outcome === undefined) this.clock.advanceBy(Math.max(0, COMMAND_TIMEOUT_MS - (this.clock.nowMs() - startedAt)));
      this.clock.cancel(timer);
      if (outcome === undefined) throw new Error('SCHEDULED_TIMEOUT_DID_NOT_TERMINALIZE');
      const finalOutcome = outcome;
      if (!finalOutcome.completed) {
        authority.revoke(); let reason = finalOutcome.stopReason;
        if (this.requiresTermination(reason) &&
            new DeterministicTerminationController(this.terminationPort, this.clock).terminate(finalOutcome.childExited) === 'FAILED') {
          reason = 'PROCESS_TERMINATION_FAILED';
        }
        return this.fail(reason === 'PROCESS_TERMINATION_FAILED' ? 'PROCESS_TERMINATION_FAILED' : 'COMMAND_EXECUTION_FAILED',
          reason, context, accepted, record, index, approved, finalOutcome);
      }
      const built = this.buildEvidence(context, record, index, approved, finalOutcome, 'NONE');
      try { assertClosedEvidence(built as unknown as Readonly<Record<string, unknown>>); }
      catch { authority.revoke(); return this.fail('EVIDENCE_VALIDATION_FAILED', 'SCHEMA_MISMATCH', context, accepted, record, index, approved, finalOutcome); }
      accepted.push(built);
    }
    return this.result('COMPLETED', context, accepted, 'NONE', 'NONE', 'NONE', accepted.length);
  }
  private validateExecutionContract(context: OfflineExecutionContext): StopReason | undefined {
    if (!isIssuedSymbolResolution(context.symbolResolution)) return 'BASELINE_MISMATCH';
    try { validateContract(context.resolvedContract); } catch { return 'SCHEMA_MISMATCH'; }
    if (context.resolvedContract.commandOrderVersion !== COMMAND_ORDER_VERSION || context.resolvedContract.records.length !== 16 ||
        context.resolvedContract.records.some((record, index) => record.commandId !== TIER_A_COMMAND_IDS[index]) ||
        canonicalize(context.resolvedContract) !== canonicalize(context.symbolResolution.contract) ||
        sha256(canonicalize(context.resolvedContract)) !== context.staticAllowlistDigest) return 'BASELINE_MISMATCH';
    return undefined;
  }
  private requiresTermination(reason: StopReason): boolean { return ['COMMAND_TIMEOUT', 'STREAM_READ_FAILED',
    'STDOUT_OUTPUT_LIMIT_EXCEEDED', 'STDERR_OUTPUT_LIMIT_EXCEEDED', 'BOTH_STREAM_OUTPUT_LIMIT_EXCEEDED',
    'INVALID_UTF8', 'STDERR_NONEMPTY'].includes(reason); }
  private buildEvidence(context: OfflineExecutionContext, record: AllowlistRecord, index: number,
    identity: ExecutableIdentity, outcome: ArbiterResult, reason: StopReason): CommandEvidence {
    const failed = reason !== 'NONE';
    return Object.freeze({ contractVersion: COMMAND_EVIDENCE_CONTRACT_VERSION, schemaVersion: EVIDENCE_SCHEMA_VERSION,
      allowlistDigest: context.staticAllowlistDigest, executionBaselineDigest: context.executionBaselineDigest,
      sequencerRunId: context.sequencerRunId, commandOrderVersion: COMMAND_ORDER_VERSION, sequenceIndex: index,
      commandId: record.commandId, executableRealpath: identity.realpath, executableIdentity: identity,
      argvDigest: sha256(canonicalize(record.argv)), workingDirectory: record.workingDirectory,
      repositoryBranch: context.repositoryBranch, repositoryHead: context.repositoryHead,
      privilegeClass: record.privilegeClass, localDaemonContact: record.localDaemonContact,
      exitClass: mapStopReasonToExitClass(reason), stopReason: reason, processExitCode: outcome.exitCode,
      processSignal: outcome.signal, stdoutByteCount: outcome.stdout.byteCount, stderrByteCount: outcome.stderr.byteCount,
      normalizedFacts: Object.freeze(failed ? {} : { ...record.expectedNormalizedFacts }), redactionCount: 0,
      outputTruncated: outcome.stdout.capExceeded || outcome.stderr.capExceeded,
      normalizationResult: failed ? 'REJECTED' : 'SUCCESS', evidenceClass: record.evidenceClass,
      observedAt: context.observedAt });
  }
  private fail(kind: SequencerResultClass, reason: StopReason, context: OfflineExecutionContext,
    successes: readonly CommandEvidence[], record: AllowlistRecord, index: number,
    identity = context.approvedIdentities[record.commandId] ?? Object.freeze({ realpath: record.expectedRealpath,
      fileType: 'REGULAR_FILE' as const, device: 0, inode: 0, mode: 0, uid: 0, gid: 0, sizeBytes: 0,
      codeSignature: 'FIXTURE_UNAVAILABLE' }), outcome: ArbiterResult = Object.freeze({ completed: false, stopReason: reason,
      exitCode: 'NONE', signal: 'NONE', stdout: emptyStream(), stderr: emptyStream(), childExited: false })): SequencerResult {
    const terminal = this.buildEvidence(context, record, index, identity, outcome, reason);
    try { assertClosedEvidence(terminal as unknown as Readonly<Record<string, unknown>>); }
    catch { return this.result('EVIDENCE_VALIDATION_FAILED', context, successes, record.commandId, index, 'NONE', successes.length); }
    return this.result(kind, context, [...successes, terminal], record.commandId, index, terminal, successes.length);
  }
  private result(kind: SequencerResultClass, context: OfflineExecutionContext, ordered: readonly CommandEvidence[],
    commandId: string | 'NONE', index: number | 'NONE', terminal: CommandEvidence | 'NONE', successCount: number): SequencerResult {
    return Object.freeze({ resultClass: kind, terminalCommandId: commandId, terminalSequenceIndex: index,
      staticAllowlistDigest: context.staticAllowlistDigest, executionBaselineDigest: context.executionBaselineDigest,
      acceptedEvidenceCount: successCount, terminalEvidence: terminal, orderedEvidence: Object.freeze([...ordered]) });
  }
}

function emptyStream(): StreamState { return Object.freeze({ byteCount: 0, lineCount: 0, capExceeded: false,
  invalidUtf8: false, nonEmpty: false, normalizedOutput: '', ended: false, maxSegmentBytes: 0,
  maxPendingSegments: 1, decoderFlushCount: 0 }); }
