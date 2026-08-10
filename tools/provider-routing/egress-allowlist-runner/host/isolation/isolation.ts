import { canonicalize } from '../../canonical';
import { CHILD_SELF_DEADLINE_PROVES_BOUNDED_EXIT, XR_FCI_CHILD_HARD_LIFETIME_MS, XR_FCI_ENVIRONMENT,
  XR_FCI_FAILURE_PRECEDENCE, XR_FCI_FINAL_PROOF_MS, XR_FCI_MAX_REQUESTS, XR_FCI_RESOURCE_CLAIMS,
  XR_FCI_STDERR_BYTES, XR_FCI_UMASK, XrFciCloseRequest, XrFciEofClass, XrFciFailureReason,
  XrFciOperationRequest, XrFciResponse, XrFciState, XrFciTerminalResult, XrObserverComposition,
  XrObserverFdInvariant, XrObserverIdentity, XrObserverLifecyclePort, XrObserverSpawnRequest } from './contracts';
import { XrFciFrameDecoder, XrFciProtocolError, assertOperationRequest, assertResponse, encodeXrFciFrame } from './protocol';

export class XrFciIsolationError extends Error { constructor(readonly reason: XrFciFailureReason) { super(reason); } }
const sha = /^[0-9a-f]{64}$/;
const nonce = /^[0-9a-f]{32}$/;
const fixedEnvironmentKeys = Object.keys(XR_FCI_ENVIRONMENT).sort();

function validAbsoluteControlPath(value: string): boolean {
  return value.startsWith('/') && value !== '/' && !value.includes('\0') && !value.split('/').includes('..');
}
export function validateObserverIdentity(expected: XrObserverIdentity, observed: XrObserverIdentity): void {
  if (!validAbsoluteControlPath(expected.nodeExecutableRealpath) ||
      !validAbsoluteControlPath(expected.observerEntrypointRealpath) || !sha.test(expected.nodeExecutableSha256) ||
      !sha.test(expected.observerEntrypointSha256) || !sha.test(expected.buildBindingSha256) ||
      !Number.isSafeInteger(expected.observerBundleByteLength) || expected.observerBundleByteLength <= 0 ||
      canonicalize(expected) !== canonicalize(observed)) throw new XrFciIsolationError('OBSERVER_IDENTITY_INVALID');
}
export function validateFdInvariant(value: XrObserverFdInvariant): void {
  if (Object.values(value).some((entry) => entry !== true)) throw new XrFciIsolationError('CHILD_INVARIANT_VIOLATION');
}
function validateComposition(value: XrObserverComposition): void {
  if (!validAbsoluteControlPath(value.sandboxCwd) || value.sandboxCwd === value.expectedIdentity.nodeExecutableRealpath ||
      value.sandboxCwd === value.expectedIdentity.observerEntrypointRealpath || !Number.isSafeInteger(value.credentials.expectedUid) ||
      !Number.isSafeInteger(value.credentials.expectedGid) || value.credentials.expectedSupplementaryGroups.some((group) =>
        !Number.isSafeInteger(group)) || value.credentials.privilegeEscalation !== 'NONE') {
    throw new XrFciIsolationError('SANDBOX_INVALID');
  }
}
export function createSpawnRequest(composition: XrObserverComposition): XrObserverSpawnRequest {
  validateComposition(composition);
  return Object.freeze({ executable: composition.expectedIdentity.nodeExecutableRealpath,
    argv: Object.freeze([composition.expectedIdentity.observerEntrypointRealpath]) as readonly [string], shell: false,
    cwd: composition.sandboxCwd, env: XR_FCI_ENVIRONMENT, stdio: Object.freeze(['pipe', 'pipe', 'pipe']) as
      readonly ['pipe', 'pipe', 'pipe'], extraFds: 'NONE', detached: false, umask: XR_FCI_UMASK,
    credentials: composition.credentials, resourceClaims: XR_FCI_RESOURCE_CLAIMS });
}

interface Proofs { exit: boolean; reap: boolean; streams: boolean; cleanup: boolean; parentConsistency: boolean; }
export class XrRecordIsolationController {
  private stateValue: XrFciState = 'IDLE'; private readonly failures = new Set<XrFciFailureReason>();
  private readonly decoder = new XrFciFrameDecoder(); private sequence = 0; private outstanding?: XrFciOperationRequest;
  private closeSequence?: number; private closeAcknowledged = false; private provisional: XrFciResponse[] = [];
  private readonly proofs: Proofs = { exit: false, reap: false, streams: false, cleanup: false, parentConsistency: false };
  private stderrBytes = 0; private startedAt?: number; private terminal?: XrFciTerminalResult;
  private requestSideClosed = false; private termRequested = false; private killRequested = false;
  constructor(private readonly lifecycle: XrObserverLifecyclePort, private readonly composition: XrObserverComposition,
    private readonly recordNonce: string) {
    if (!nonce.test(recordNonce)) throw new XrFciIsolationError('CHILD_INVARIANT_VIOLATION');
  }
  get state(): XrFciState { return this.stateValue; }
  get provisionalResultCount(): number { return this.provisional.length; }
  get result(): XrFciTerminalResult | undefined { return this.terminal; }
  get childHardLifetimeMs(): number { return XR_FCI_CHILD_HARD_LIFETIME_MS; }
  get selfDeadlineProvesBoundedExit(): false { return CHILD_SELF_DEADLINE_PROVES_BOUNDED_EXIT; }

  start(observedIdentity: XrObserverIdentity, fdInvariant: XrObserverFdInvariant): void {
    if (this.stateValue !== 'IDLE') throw new XrFciIsolationError('CHILD_INVARIANT_VIOLATION');
    try { validateObserverIdentity(this.composition.expectedIdentity, observedIdentity); validateFdInvariant(fdInvariant);
      this.stateValue = 'IDENTITY_VALIDATED'; const request = createSpawnRequest(this.composition);
      this.lifecycle.spawn(request); this.startedAt = this.lifecycle.nowMs(); this.stateValue = 'ACTIVE';
    } catch (error) { const reason = error instanceof XrFciIsolationError ? error.reason : 'SPAWN_REQUEST_FAILED';
      this.failBeforeSpawnOrReadiness(reason); throw new XrFciIsolationError(reason); }
  }
  private failBeforeSpawnOrReadiness(reason: XrFciFailureReason): void {
    this.failures.add(reason); this.stateValue = 'UNCERTAIN_TERMINAL'; this.setTerminal('FAILED');
  }
  send(request: XrFciOperationRequest): void {
    try { assertOperationRequest(request); } catch { this.enterContainment('UNEXPECTED_OPERATION');
      throw new XrFciIsolationError('UNEXPECTED_OPERATION'); }
    if (this.stateValue !== 'ACTIVE' || this.outstanding !== undefined || request.recordNonce !== this.recordNonce ||
        request.sequenceIndex !== this.sequence + 1 || request.sequenceIndex > XR_FCI_MAX_REQUESTS) {
      this.enterContainment('CHILD_INVARIANT_VIOLATION'); throw new XrFciIsolationError('CHILD_INVARIANT_VIOLATION');
    }
    try { this.lifecycle.write(encodeXrFciFrame(request)); this.sequence = request.sequenceIndex; this.outstanding = request; }
    catch { this.enterContainment('PROTOCOL_WRITE_FAILED'); throw new XrFciIsolationError('PROTOCOL_WRITE_FAILED'); }
  }
  receive(chunk: Uint8Array): void {
    if (this.stateValue === 'WATCHDOG_FAILED' || this.stateValue === 'TERMINATING' || this.isTerminal()) {
      this.failures.add('LATE_RESPONSE'); return;
    }
    let values: readonly unknown[];
    try { values = this.decoder.push(chunk); }
    catch (error) { this.enterContainment(error instanceof XrFciProtocolError && error.code === 'RESPONSE_CAP_EXCEEDED' ?
      'RESPONSE_CAP_EXCEEDED' : 'PROTOCOL_INVALID'); return; }
    if (values.length > 1) { this.enterContainment('DUPLICATE_RESPONSE'); return; }
    for (const value of values) {
      try { assertResponse(value); } catch { this.enterContainment('PROTOCOL_INVALID'); return; }
      this.acceptResponse(value);
    }
  }
  private acceptResponse(response: XrFciResponse): void {
    if (this.stateValue === 'CLOSING') {
      if (this.closeAcknowledged || response.status !== 'CLOSED' || response.recordNonce !== this.recordNonce ||
          response.sequenceIndex !== this.closeSequence) { this.enterContainment(this.closeAcknowledged ?
          'DUPLICATE_RESPONSE' : 'LATE_RESPONSE'); return; }
      this.closeAcknowledged = true; return;
    }
    if (this.stateValue !== 'ACTIVE' || this.outstanding === undefined) {
      this.enterContainment(this.provisional.some((entry) => entry.sequenceIndex === response.sequenceIndex) ?
        'DUPLICATE_RESPONSE' : 'LATE_RESPONSE'); return;
    }
    if (response.recordNonce !== this.recordNonce || response.sequenceIndex !== this.outstanding.sequenceIndex ||
        response.status === 'CLOSED') { this.enterContainment('PROTOCOL_INVALID'); return; }
    this.provisional.push(response); this.outstanding = undefined;
  }
  beginNormalClose(): void {
    if (this.stateValue !== 'ACTIVE' || this.outstanding !== undefined) {
      this.enterContainment('CHILD_INVARIANT_VIOLATION'); return;
    }
    const request: XrFciCloseRequest = Object.freeze({ protocolVersion: 1, recordNonce: this.recordNonce,
      sequenceIndex: this.sequence + 1, close: true }); this.closeSequence = request.sequenceIndex;
    try { this.lifecycle.write(encodeXrFciFrame(request)); this.stateValue = 'CLOSING'; }
    catch { this.enterContainment('PROTOCOL_WRITE_FAILED'); }
  }
  onParentPipeEof(): XrFciEofClass {
    if (this.stateValue === 'CLOSING' && this.closeAcknowledged) return 'NORMAL_CLOSE_EOF';
    if (this.stateValue === 'TERMINATING' || this.stateValue === 'WATCHDOG_FAILED') return 'PARENT_CONTAINMENT_EOF';
    this.enterWatchdog('UNEXPECTED_PARENT_LOSS'); return 'UNEXPECTED_PARENT_LOSS_EOF';
  }
  onSelfDeadline(): void { if (!this.isTerminal() && this.stateValue !== 'TERMINATING' &&
    this.stateValue !== 'WATCHDOG_FAILED') this.enterWatchdog('SELF_DEADLINE_EXPIRED'); }
  checkChildHardLifetime(): void { if (this.startedAt !== undefined &&
    this.lifecycle.nowMs() - this.startedAt >= XR_FCI_CHILD_HARD_LIFETIME_MS) this.onSelfDeadline(); }
  onParentDeadline(): void { if (!this.isTerminal()) this.enterContainment('DEADLINE_EXPIRED'); }
  private invalidate(): void { this.provisional = []; this.outstanding = undefined; }
  private closeRequestSide(): void { if (!this.requestSideClosed) { this.requestSideClosed = true;
    try { this.lifecycle.closeRequestSide(); } catch { this.failures.add('PROTOCOL_WRITE_FAILED'); } } }
  private enterWatchdog(reason: 'UNEXPECTED_PARENT_LOSS' | 'SELF_DEADLINE_EXPIRED'): void {
    if (this.isTerminal()) return; this.failures.add(reason); this.invalidate(); this.stateValue = 'WATCHDOG_FAILED';
    this.closeRequestSide(); this.requestTerm();
  }
  private enterContainment(reason: XrFciFailureReason): void {
    if (this.isTerminal()) return; this.failures.add(reason); this.invalidate(); this.stateValue = 'TERMINATING';
    this.closeRequestSide(); this.requestTerm();
  }
  private requestTerm(): void { if (this.termRequested) return; this.termRequested = true;
    try { this.lifecycle.requestTerm(); } catch { this.failures.add('TERM_FAILED'); } }
  onTermGraceExpired(): void { if (this.proofs.exit || this.isTerminal()) return; if (!this.termRequested) {
    this.enterContainment('CHILD_INVARIANT_VIOLATION'); return; } if (this.killRequested) return; this.killRequested = true;
    try { this.lifecycle.requestKill(); } catch { this.failures.add('KILL_FAILED'); } }
  onExitObserved(): void { if (this.isTerminal()) return; this.proofs.exit = true; this.stateValue = 'EXIT_OBSERVED'; }
  onReapProven(): void { if (this.isTerminal() || !this.proofs.exit) { this.markUncertain('EXIT_UNPROVEN'); return; }
    this.proofs.reap = true; this.stateValue = 'REAP_PROVEN'; }
  onStreamsClosed(): void { if (this.isTerminal() || !this.proofs.reap) { this.markUncertain('REAP_UNPROVEN'); return; }
    this.proofs.streams = true; this.stateValue = 'STREAMS_CLOSED'; }
  onParentConsistencySucceeded(): void { if (!this.isTerminal()) this.proofs.parentConsistency = true; }
  cleanup(): void { if (this.isTerminal() || !this.proofs.streams) { this.markUncertain('STREAM_CLOSE_UNPROVEN'); return; }
    this.stateValue = 'CLEANING'; try { this.lifecycle.cleanupExactSandbox(this.composition.sandboxCwd); this.proofs.cleanup = true; }
    catch { this.markUncertain('CLEANUP_FAILED'); } }
  finish(): XrFciTerminalResult {
    if (this.terminal !== undefined) return this.terminal;
    if (this.failures.has('TERM_FAILED') || this.failures.has('KILL_FAILED')) {
      this.stateValue = 'UNCERTAIN_TERMINAL'; return this.setTerminal('FAILED');
    }
    if (!this.proofs.exit) return this.markUncertain('EXIT_UNPROVEN');
    if (!this.proofs.reap) return this.markUncertain('REAP_UNPROVEN');
    if (!this.proofs.streams) return this.markUncertain('STREAM_CLOSE_UNPROVEN');
    if (!this.proofs.cleanup) return this.markUncertain('CLEANUP_FAILED');
    const success = this.failures.size === 0 && this.closeAcknowledged && this.proofs.parentConsistency;
    if (this.failures.size === 0 && !success) return this.markUncertain('CHILD_INVARIANT_VIOLATION');
    this.stateValue = 'CLEAN_TERMINAL'; return this.setTerminal(success ? 'SUCCESS' : 'FAILED');
  }
  onFinalProofTimer(): XrFciTerminalResult { if (!this.proofs.exit) this.failures.add('EXIT_UNPROVEN');
    if (!this.proofs.reap) this.failures.add('REAP_UNPROVEN'); if (!this.proofs.streams) this.failures.add('STREAM_CLOSE_UNPROVEN');
    if (!this.proofs.cleanup) this.failures.add('CLEANUP_FAILED'); this.stateValue = 'UNCERTAIN_TERMINAL';
    return this.setTerminal('FAILED'); }
  observeStderr(byteLength: number): void { if (byteLength <= 0 || this.isTerminal()) return; this.stderrBytes += byteLength;
    this.enterContainment(this.stderrBytes > XR_FCI_STDERR_BYTES ? 'STDERR_CAP_EXCEEDED' : 'STDERR_NONEMPTY'); }
  unexpectedExit(): void { if (!this.isTerminal()) { this.failures.add('UNEXPECTED_EXIT'); this.invalidate(); this.onExitObserved(); } }
  protocolEof(): void { try { this.decoder.finish(); } catch { this.enterContainment('PROTOCOL_READ_FAILED'); } }
  private markUncertain(reason: XrFciFailureReason): XrFciTerminalResult {
    this.failures.add(reason); this.invalidate(); this.stateValue = 'UNCERTAIN_TERMINAL'; return this.setTerminal('FAILED');
  }
  private setTerminal(outcome: 'SUCCESS' | 'FAILED'): XrFciTerminalResult {
    if (this.terminal !== undefined) return this.terminal;
    const ordered = XR_FCI_FAILURE_PRECEDENCE.filter((reason) => this.failures.has(reason));
    this.terminal = Object.freeze({ state: this.stateValue as 'CLEAN_TERMINAL' | 'UNCERTAIN_TERMINAL', outcome,
      primaryFailure: ordered[0] ?? 'NONE', failures: Object.freeze(ordered), provisionalResultCount: this.provisional.length });
    return this.terminal;
  }
  private isTerminal(): boolean { return this.stateValue === 'CLEAN_TERMINAL' || this.stateValue === 'UNCERTAIN_TERMINAL'; }
}

export class XrIsolationAttemptGate {
  private unresolved = false;
  beginRecord(): void { if (this.unresolved) throw new XrFciIsolationError('CHILD_INVARIANT_VIOLATION'); this.unresolved = true; }
  completeRecord(result: XrFciTerminalResult): void { if (result.state !== 'CLEAN_TERMINAL') return; this.unresolved = false; }
  get canBeginNextRecord(): boolean { return !this.unresolved; }
}

export const XR_FCI_FIXED_ENVIRONMENT_KEYS = Object.freeze(fixedEnvironmentKeys);
export const XR_FCI_FINAL_TIMER_MS = XR_FCI_FINAL_PROOF_MS;
