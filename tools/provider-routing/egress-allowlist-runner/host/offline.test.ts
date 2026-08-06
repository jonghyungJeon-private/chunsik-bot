import { describe, expect, it } from 'vitest';
import { TIER_A_RECORDS } from '../allowlist';
import { COMMAND_ORDER_VERSION, ExecutableIdentity } from '../contracts';
import {
  DeterministicProcessEventArbiter, DeterministicTerminationController, EXACT_ENVIRONMENT,
  HOST_EXECUTION_ELIGIBILITY, StopOnFirstFailureSequencer, assertExactEnvironment,
  createOfflineCapabilityTestHarness,
} from './offline';

const record = TIER_A_RECORDS[0]!;
const identity: ExecutableIdentity = Object.freeze({ realpath: record.expectedRealpath, fileType: 'REGULAR_FILE',
  device: 1, inode: 2, mode: 493, uid: 0, gid: 0, sizeBytes: 100, codeSignature: 'fixture' });
const binding = Object.freeze({ staticAllowlistDigest: 'a'.repeat(64), executionBaselineDigest: 'b'.repeat(64),
  commandOrderVersion: COMMAND_ORDER_VERSION, sequencerRunId: 'factory-run-1', sequenceIndex: 0,
  commandId: record.commandId });
const successEvents = Object.freeze([
  { type: 'SPAWN_CONFIRMED' as const }, { type: 'STDOUT_END' as const }, { type: 'STDERR_END' as const },
  { type: 'PROCESS_EXIT' as const, exitCode: 0, signal: 'NONE' as const }, { type: 'PROCESS_CLOSE' as const },
]);
const clock = { value: 0, nowMs() { return this.value; }, advanceBy(ms: number) { this.value += ms; } };

describe('F0-HI contract and safety gates', () => {
  it('pins the closed environment and rejects additions', () => {
    expect(() => assertExactEnvironment(EXACT_ENVIRONMENT)).not.toThrow();
    expect(() => assertExactEnvironment({ ...EXACT_ENVIRONMENT, HOME: '/tmp' })).toThrow('ENVIRONMENT_POLICY_MISMATCH');
  });
  it('keeps live authorization and execution blocked by TOCTOU', () => {
    expect(HOST_EXECUTION_ELIGIBILITY).toMatchObject({ mockedImplementation: true, liveAuthorization: false,
      liveExecution: false, toctouGate: 'BLOCKED_FEASIBILITY_GAP_FOR_LIVE_EXECUTION' });
  });
});

describe('runtime-unforgeable dispatch capability', () => {
  it('rejects a structural lookalike', () => {
    const harness = createOfflineCapabilityTestHarness(binding);
    expect(() => harness.consume({ ...binding, commandId: 'WRONG' })).toThrow('DISPATCH_CAPABILITY_BINDING_MISMATCH');
  });
  it('is single use', () => {
    const harness = createOfflineCapabilityTestHarness(binding); harness.consume();
    expect(() => harness.consume()).toThrow('DISPATCH_CAPABILITY_CONSUMED');
  });
  it('rejects wrong index, run, command, and baseline bindings', () => {
    for (const wrong of [{ ...binding, sequenceIndex: 1 }, { ...binding, sequencerRunId: 'other' },
      { ...binding, commandId: 'other' }, { ...binding, executionBaselineDigest: 'c'.repeat(64) }]) {
      expect(() => createOfflineCapabilityTestHarness(binding).consume(wrong)).toThrow('DISPATCH_CAPABILITY_BINDING_MISMATCH');
    }
  });
  it('prevents issue after authority revocation', () => {
    const harness = createOfflineCapabilityTestHarness(binding); harness.revoke();
    expect(() => harness.issue()).toThrow('EXECUTION_AUTHORITY_REVOKED');
  });
});

describe('deterministic process-event arbiter', () => {
  it('does not finalize on exit or close alone', () => {
    expect(new DeterministicProcessEventArbiter(record).accept({ type: 'PROCESS_EXIT', exitCode: 0, signal: 'NONE' })).toBeUndefined();
    expect(new DeterministicProcessEventArbiter(record).accept({ type: 'PROCESS_CLOSE' })).toBeUndefined();
  });
  it('finalizes once only after spawn, exit, both streams, and close', () => {
    const arbiter = new DeterministicProcessEventArbiter(record); let result;
    for (const event of successEvents) result = arbiter.accept(event) ?? result;
    expect(result).toMatchObject({ completed: true, exitCode: 0, signal: 'NONE' });
    expect(arbiter.accept({ type: 'TIMEOUT' })).toBe(result);
    expect(arbiter.isDisposed).toBe(true);
  });
  it('distinguishes spawn, stream, timeout, and nonzero failures', () => {
    expect(new DeterministicProcessEventArbiter(record).accept({ type: 'SPAWN_ERROR', message: 'fixture' })?.stopReason).toBe('PROCESS_SPAWN_FAILED');
    expect(new DeterministicProcessEventArbiter(record).accept({ type: 'STDOUT_ERROR', message: 'fixture' })?.stopReason).toBe('STREAM_READ_FAILED');
    expect(new DeterministicProcessEventArbiter(record).accept({ type: 'TIMEOUT' })?.stopReason).toBe('COMMAND_TIMEOUT');
    const arbiter = new DeterministicProcessEventArbiter(record); let result;
    for (const event of successEvents.map((event) => event.type === 'PROCESS_EXIT' ?
      { type: 'PROCESS_EXIT' as const, exitCode: 7, signal: 'NONE' as const } : event)) result = arbiter.accept(event) ?? result;
    expect(result?.stopReason).toBe('NONZERO_EXIT');
  });
});

describe('mock exact-child termination', () => {
  it('sends no signal to an already exited child', () => {
    const signals: string[] = []; const controller = new DeterministicTerminationController({ signalExactChild: (s) => { signals.push(s); return true; }, isExactChildClosed: () => false }, clock);
    expect(controller.terminate({ alreadyExited: true })).toBe('CLOSED');
    expect(signals).toEqual([]);
  });
  it('uses SIGTERM once and SIGKILL once only when required', () => {
    const signals: string[] = []; let checks = 0; const controller = new DeterministicTerminationController({ signalExactChild: (s) => { signals.push(s); return true; }, isExactChildClosed: () => ++checks === 2 }, clock);
    expect(controller.terminate({ alreadyExited: false })).toBe('CLOSED');
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });
  it('makes close-confirmation failure operator visible', () => {
    const controller = new DeterministicTerminationController({ signalExactChild: () => true, isExactChildClosed: () => false }, clock);
    expect(controller.terminate({ alreadyExited: false })).toBe('FAILED');
  });
});

describe('stop-on-first-failure sequencer', () => {
  const context = Object.freeze({ staticAllowlistDigest: binding.staticAllowlistDigest,
    executionBaselineDigest: binding.executionBaselineDigest, sequencerRunId: binding.sequencerRunId,
    records: Object.freeze([record]), approvedIdentities: Object.freeze({ [record.commandId]: identity }) });
  const identityPort = { verifyExactPath: () => identity } as const;
  it('blocks dispatch without termination authority', () => {
    let calls = 0; const sequencer = new StopOnFirstFailureSequencer({ dispatch: () => { calls += 1; return successEvents; } }, identityPort, undefined);
    expect(sequencer.run(context).resultClass).toBe('COMMAND_SAFETY_FAILED'); expect(calls).toBe(0);
  });
  it('stops after the first failed command and cannot restart', () => {
    let calls = 0; const sequencer = new StopOnFirstFailureSequencer({ dispatch: () => { calls += 1; return [{ type: 'SPAWN_ERROR', message: 'fixture' }]; } }, identityPort, { signalExactChild: () => true, isExactChildClosed: () => true }, clock);
    expect(sequencer.run(context).resultClass).toBe('COMMAND_EXECUTION_FAILED'); expect(calls).toBe(1);
    expect(() => sequencer.run(context)).toThrow('EXECUTION_CONTEXT_CONSUMED');
  });
  it('rejects identity drift before dispatch', () => {
    let calls = 0; const sequencer = new StopOnFirstFailureSequencer({ dispatch: () => { calls += 1; return successEvents; } },
      { verifyExactPath: (_record, phase) => phase === 'INITIAL' ? identity : { ...identity, inode: 3 } }, { signalExactChild: () => true, isExactChildClosed: () => true }, clock);
    expect(sequencer.run(context).resultClass).toBe('COMMAND_SAFETY_FAILED'); expect(calls).toBe(0);
  });
});
