import { canonicalize } from '../canonical';
import {
  AllowlistRecord, COMMAND_ORDER_VERSION, CommandEvidence, ExecutableIdentity, StopReason,
} from '../contracts';

export const HOST_EXECUTION_ELIGIBILITY = Object.freeze({
  mockedImplementation: true,
  liveAuthorization: false,
  liveExecution: false,
  toctouGate: 'BLOCKED_FEASIBILITY_GAP_FOR_LIVE_EXECUTION',
  environmentViability: 'EXECUTION_GATE_NOT_EVALUATED',
} as const);
export const EXACT_ENVIRONMENT = Object.freeze({ LANG: 'C', LC_ALL: 'C' } as const);
export const MAX_SEGMENT_BYTES = 4096;
export const COMMAND_TIMEOUT_MS = 5000;

export type ProcessSignal = 'NONE' | 'SIGTERM' | 'SIGKILL' | 'UNEXPECTED_SIGNAL';
export type ProcessEvent =
  | Readonly<{ type: 'SPAWN_CONFIRMED' | 'PROCESS_CLOSE' | 'STDOUT_END' | 'STDERR_END' | 'TIMEOUT' | 'TERMINATION_REQUESTED' | 'TERMINATION_CONFIRMED' | 'TERMINATION_FAILED' }>
  | Readonly<{ type: 'SPAWN_ERROR' | 'STDOUT_ERROR' | 'STDERR_ERROR'; message: string }>
  | Readonly<{ type: 'PROCESS_EXIT'; exitCode: number | 'NONE'; signal: ProcessSignal }>
  | Readonly<{ type: 'STDOUT_DATA' | 'STDERR_DATA'; chunk: Uint8Array }>;

export interface HostProcessRequest {
  readonly commandId: string;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly workingDirectory: string;
  readonly environment: typeof EXACT_ENVIRONMENT;
  readonly timeoutMs: 5000;
  readonly topology: 'ONE_BOUNDED_CHILD_NO_DESCENDANTS';
}
export interface HostProcessPort { dispatch(request: HostProcessRequest, capability: DispatchCapability): readonly ProcessEvent[]; }
export interface ExecutableIdentityPort { verifyExactPath(record: AllowlistRecord, phase: 'INITIAL' | 'PRE_DISPATCH'): ExecutableIdentity | undefined; }
export interface TerminationPort {
  signalExactChild(signal: 'SIGTERM' | 'SIGKILL'): boolean;
  isExactChildClosed(): boolean;
}
export interface SequencerClock { nowMs(): number; advanceBy(ms: number): void; }

interface CapabilityBinding {
  readonly staticAllowlistDigest: string;
  readonly executionBaselineDigest: string;
  readonly commandOrderVersion: typeof COMMAND_ORDER_VERSION;
  readonly sequencerRunId: string;
  readonly sequenceIndex: number;
  readonly commandId: string;
}
export interface DispatchCapability { readonly kind: 'F0_HI_SINGLE_USE_DISPATCH_CAPABILITY'; }
const CAPABILITY_BRAND = new WeakSet<object>();
const CAPABILITY_BINDINGS = new WeakMap<object, CapabilityBinding>();
const CONSUMED_CAPABILITIES = new WeakSet<object>();

class ExecutionAuthority {
  private revoked = false;
  issue(binding: CapabilityBinding): DispatchCapability {
    if (this.revoked) throw new Error('EXECUTION_AUTHORITY_REVOKED');
    const capability = Object.freeze({ kind: 'F0_HI_SINGLE_USE_DISPATCH_CAPABILITY' as const });
    CAPABILITY_BRAND.add(capability);
    CAPABILITY_BINDINGS.set(capability, Object.freeze({ ...binding }));
    return capability;
  }
  revoke(): void { this.revoked = true; }
}

function consumeCapability(capability: DispatchCapability, expected: CapabilityBinding): void {
  const value = capability as object;
  const binding = CAPABILITY_BINDINGS.get(value);
  if (!CAPABILITY_BRAND.has(value) || binding === undefined) throw new Error('DISPATCH_CAPABILITY_FORGED');
  if (CONSUMED_CAPABILITIES.has(value)) throw new Error('DISPATCH_CAPABILITY_CONSUMED');
  CONSUMED_CAPABILITIES.add(value);
  if (canonicalize(binding) !== canonicalize(expected)) throw new Error('DISPATCH_CAPABILITY_BINDING_MISMATCH');
}

/** Internal fixture seam; deliberately not re-exported by the package or host index. */
export function createOfflineCapabilityTestHarness(binding: CapabilityBinding): Readonly<{
  capability: DispatchCapability; consume(expected?: CapabilityBinding): void; revoke(): void; issue(): DispatchCapability;
}> {
  const authority = new ExecutionAuthority();
  const capability = authority.issue(binding);
  return Object.freeze({ capability, consume: (expected = binding) => consumeCapability(capability, expected),
    revoke: () => authority.revoke(), issue: () => authority.issue(binding) });
}

export function assertExactEnvironment(value: Readonly<Record<string, string>>): void {
  if (canonicalize(value) !== canonicalize(EXACT_ENVIRONMENT)) throw new Error('ENVIRONMENT_POLICY_MISMATCH');
}

export class DeterministicTerminationController {
  constructor(private readonly port: TerminationPort, private readonly clock: SequencerClock) {}
  terminate(input: Readonly<{ alreadyExited: boolean }>): 'CLOSED' | 'FAILED' {
    if (input.alreadyExited) return 'CLOSED';
    if (!this.port.signalExactChild('SIGTERM')) return 'FAILED';
    this.clock.advanceBy(500);
    if (this.port.isExactChildClosed()) return 'CLOSED';
    if (!this.port.signalExactChild('SIGKILL')) return 'FAILED';
    this.clock.advanceBy(500);
    return this.port.isExactChildClosed() ? 'CLOSED' : 'FAILED';
  }
}

interface StreamState { readonly bytes: number; readonly text: string; readonly ended: boolean; readonly failed: boolean; }
class BoundedStream {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private byteCount = 0;
  private value = '';
  private ended = false;
  private failed = false;
  private flushCount = 0;
  constructor(private readonly maxBytes: number, private readonly maxLines: number) {}
  data(chunk: Uint8Array): void {
    if (this.ended || this.failed) return;
    for (let offset = 0; offset < chunk.byteLength; offset += MAX_SEGMENT_BYTES) {
      const segment = chunk.slice(offset, Math.min(offset + MAX_SEGMENT_BYTES, chunk.byteLength));
      this.byteCount += segment.byteLength;
      if (this.byteCount > this.maxBytes) { this.failed = true; return; }
      try { this.value += this.decoder.decode(segment, { stream: true }); } catch { this.failed = true; return; }
    }
    const normalized = this.value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.length === 0 ? 0 : normalized.split('\n').length - (normalized.endsWith('\n') ? 1 : 0);
    if (lines > this.maxLines) this.failed = true;
  }
  end(): void {
    if (this.ended || this.failed) return;
    this.flushCount += 1;
    try { this.value += this.decoder.decode(); } catch { this.failed = true; }
    this.value = this.value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    this.ended = true;
  }
  error(): void { this.failed = true; }
  state(): StreamState { return Object.freeze({ bytes: this.byteCount, text: this.value, ended: this.ended, failed: this.failed }); }
  get decoderFlushCount(): number { return this.flushCount; }
}

export interface ArbiterResult {
  readonly completed: boolean;
  readonly stopReason: StopReason;
  readonly exitCode: number | 'NONE';
  readonly signal: ProcessSignal;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
}

export class DeterministicProcessEventArbiter {
  private terminal?: ArbiterResult;
  private spawnConfirmed = false;
  private closeObserved = false;
  private exitCode: number | 'NONE' = 'NONE';
  private signal: ProcessSignal = 'NONE';
  private readonly stdout: BoundedStream;
  private readonly stderr: BoundedStream;
  private disposed = false;
  constructor(record: AllowlistRecord) {
    this.stdout = new BoundedStream(record.stdoutMaxBytes, record.stdoutMaxLines);
    this.stderr = new BoundedStream(record.stderrMaxBytes, record.stderrMaxLines);
  }
  accept(event: ProcessEvent): ArbiterResult | undefined {
    if (this.terminal !== undefined) return this.terminal;
    switch (event.type) {
      case 'SPAWN_CONFIRMED': this.spawnConfirmed = true; break;
      case 'SPAWN_ERROR': return this.finish('PROCESS_SPAWN_FAILED');
      case 'STDOUT_DATA': this.stdout.data(event.chunk); break;
      case 'STDERR_DATA': this.stderr.data(event.chunk); break;
      case 'STDOUT_END': this.stdout.end(); break;
      case 'STDERR_END': this.stderr.end(); break;
      case 'STDOUT_ERROR': this.stdout.error(); return this.finish('STREAM_READ_FAILED');
      case 'STDERR_ERROR': this.stderr.error(); return this.finish('STREAM_READ_FAILED');
      case 'PROCESS_EXIT': this.exitCode = event.exitCode; this.signal = event.signal; break;
      case 'PROCESS_CLOSE': this.closeObserved = true; break;
      case 'TIMEOUT': return this.finish('COMMAND_TIMEOUT');
      case 'TERMINATION_FAILED': return this.finish('PROCESS_TERMINATION_FAILED');
      case 'TERMINATION_REQUESTED': case 'TERMINATION_CONFIRMED': break;
    }
    const stdout = this.stdout.state(); const stderr = this.stderr.state();
    if (stdout.failed || stderr.failed) return this.finish('STREAM_READ_FAILED');
    if (this.spawnConfirmed && this.closeObserved && stdout.ended && stderr.ended &&
        (this.exitCode !== 'NONE' || this.signal !== 'NONE')) {
      return this.finish(this.exitCode === 0 && this.signal === 'NONE' ? 'NONE' : 'NONZERO_EXIT');
    }
    return undefined;
  }
  private finish(stopReason: StopReason): ArbiterResult {
    if (this.terminal !== undefined) return this.terminal;
    this.disposed = true;
    const stdout = this.stdout.state(); const stderr = this.stderr.state();
    this.terminal = Object.freeze({ completed: stopReason === 'NONE', stopReason, exitCode: this.exitCode,
      signal: this.signal, stdoutBytes: stdout.bytes, stderrBytes: stderr.bytes });
    return this.terminal;
  }
  get isDisposed(): boolean { return this.disposed; }
}

export type SequencerResultClass = 'COMPLETED' | 'BASELINE_FAILED' | 'COMMAND_SAFETY_FAILED' |
  'COMMAND_EXECUTION_FAILED' | 'EVIDENCE_VALIDATION_FAILED' | 'PROCESS_TERMINATION_FAILED';
export interface SequencerResult {
  readonly resultClass: SequencerResultClass;
  readonly terminalCommandId: string | 'NONE';
  readonly terminalSequenceIndex: number | 'NONE';
  readonly staticAllowlistDigest: string;
  readonly executionBaselineDigest: string;
  readonly acceptedEvidenceCount: number;
  readonly terminalEvidence: CommandEvidence | 'NONE';
  readonly orderedEvidence: readonly CommandEvidence[];
}
export interface OfflineExecutionContext {
  readonly staticAllowlistDigest: string;
  readonly executionBaselineDigest: string;
  readonly sequencerRunId: string;
  readonly records: readonly AllowlistRecord[];
  readonly approvedIdentities: Readonly<Record<string, ExecutableIdentity>>;
}

export class StopOnFirstFailureSequencer {
  private consumed = false;
  constructor(private readonly processPort: HostProcessPort, private readonly identityPort: ExecutableIdentityPort,
    private readonly terminationPort: TerminationPort | undefined, private readonly clock?: SequencerClock) {}
  run(context: OfflineExecutionContext): SequencerResult {
    if (this.consumed) throw new Error('EXECUTION_CONTEXT_CONSUMED');
    this.consumed = true;
    if (this.terminationPort === undefined || this.clock === undefined) {
      return this.result('COMMAND_SAFETY_FAILED', context, [], 'NONE', 'NONE');
    }
    const authority = new ExecutionAuthority();
    const accepted: CommandEvidence[] = [];
    for (let index = 0; index < context.records.length; index += 1) {
      const record = context.records[index]!;
      const approved = context.approvedIdentities[record.commandId];
      const initial = this.identityPort.verifyExactPath(record, 'INITIAL');
      const preDispatch = this.identityPort.verifyExactPath(record, 'PRE_DISPATCH');
      if (approved === undefined || initial === undefined || preDispatch === undefined ||
          canonicalize(initial) !== canonicalize(approved) || canonicalize(preDispatch) !== canonicalize(approved)) {
        authority.revoke(); return this.result('COMMAND_SAFETY_FAILED', context, accepted, record.commandId, index);
      }
      const binding = Object.freeze({ staticAllowlistDigest: context.staticAllowlistDigest,
        executionBaselineDigest: context.executionBaselineDigest, commandOrderVersion: COMMAND_ORDER_VERSION,
        sequencerRunId: context.sequencerRunId, sequenceIndex: index, commandId: record.commandId });
      const capability = authority.issue(binding);
      consumeCapability(capability, binding);
      const request: HostProcessRequest = Object.freeze({ commandId: record.commandId, executable: record.executable,
        argv: Object.freeze([...record.argv]), workingDirectory: record.workingDirectory, environment: EXACT_ENVIRONMENT,
        timeoutMs: 5000, topology: 'ONE_BOUNDED_CHILD_NO_DESCENDANTS' });
      let events: readonly ProcessEvent[];
      try { events = this.processPort.dispatch(request, capability); }
      catch { authority.revoke(); return this.result('COMMAND_EXECUTION_FAILED', context, accepted, record.commandId, index); }
      const arbiter = new DeterministicProcessEventArbiter(record);
      let outcome: ArbiterResult | undefined;
      for (const event of events) outcome = arbiter.accept(event) ?? outcome;
      if (outcome === undefined || !outcome.completed) {
        authority.revoke();
        if (outcome?.stopReason === 'COMMAND_TIMEOUT' || outcome?.stopReason === 'STREAM_READ_FAILED') {
          if (!this.terminate()) return this.result('PROCESS_TERMINATION_FAILED', context, accepted, record.commandId, index);
        }
        const kind = outcome?.stopReason === 'PROCESS_TERMINATION_FAILED' ? 'PROCESS_TERMINATION_FAILED' : 'COMMAND_EXECUTION_FAILED';
        return this.result(kind, context, accepted, record.commandId, index);
      }
      accepted.push(Object.freeze({
        contractVersion: 'stage2b-5c-eg-f0-command-evidence-v1', schemaVersion: 'stage2b-5c-eg-f0-command-evidence-schema-v2',
        allowlistDigest: context.staticAllowlistDigest, executionBaselineDigest: context.executionBaselineDigest,
        sequencerRunId: context.sequencerRunId, commandOrderVersion: COMMAND_ORDER_VERSION, sequenceIndex: index,
        commandId: record.commandId, executableRealpath: approved.realpath, executableIdentity: approved,
        argvDigest: 'mocked-by-offline-boundary', workingDirectory: record.workingDirectory, repositoryBranch: 'main',
        repositoryHead: 'mocked-context', privilegeClass: 'UNPRIVILEGED', localDaemonContact: 'NONE', exitClass: 'SUCCESS',
        stopReason: 'NONE', processExitCode: outcome.exitCode, processSignal: outcome.signal, stdoutByteCount: outcome.stdoutBytes,
        stderrByteCount: outcome.stderrBytes, normalizedFacts: Object.freeze({}), redactionCount: 0,
        outputTruncated: false, normalizationResult: 'SUCCESS', evidenceClass: record.evidenceClass,
        observedAt: 'MOCKED_AUDIT_ONLY',
      }));
    }
    return this.result(accepted.length === 16 ? 'COMPLETED' : 'EVIDENCE_VALIDATION_FAILED', context, accepted, 'NONE', 'NONE');
  }
  private terminate(): boolean {
    if (this.terminationPort === undefined || this.clock === undefined) return false;
    return new DeterministicTerminationController(this.terminationPort, this.clock).terminate({ alreadyExited: false }) === 'CLOSED';
  }
  private result(resultClass: SequencerResultClass, context: OfflineExecutionContext, evidence: readonly CommandEvidence[],
    commandId: string | 'NONE', index: number | 'NONE'): SequencerResult {
    const ordered = Object.freeze([...evidence]);
    return Object.freeze({ resultClass, terminalCommandId: commandId, terminalSequenceIndex: index,
      staticAllowlistDigest: context.staticAllowlistDigest, executionBaselineDigest: context.executionBaselineDigest,
      acceptedEvidenceCount: ordered.length, terminalEvidence: ordered.at(-1) ?? 'NONE', orderedEvidence: ordered });
  }
}
