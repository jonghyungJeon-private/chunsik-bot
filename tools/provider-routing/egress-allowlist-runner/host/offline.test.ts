import { describe, expect, it } from 'vitest';
import { ALLOWLIST_CONTRACT, TIER_A_COMMAND_IDS, TIER_A_RECORDS } from '../allowlist';
import { canonicalize, sha256 } from '../canonical';
import { AllowlistContract, AllowlistRecord, COMMAND_ORDER_VERSION, ExecutableIdentity, StopReason } from '../contracts';
import { createStaticAllowlistDigest } from '../runner';
import {
  DeterministicProcessEventArbiter, DeterministicTerminationController, DispatchCapability,
  EXACT_ENVIRONMENT, HOST_EXECUTION_ELIGIBILITY, HostProcessPort, OfflineExecutionContext, ProcessEvent,
  SequencerClock, StopOnFirstFailureSequencer, TerminationPort, TimerHandle, assertExactEnvironment,
  createOfflineCapabilityTestHarness, mapStopReasonToExitClass,
} from './offline';

const SYMBOLS = Object.freeze({ APPROVAL_BOUND_HEAD_SHA: '1'.repeat(40),
  APPROVAL_BOUND_ARCHITECTURE_PLAN_BLOB_ID: '2'.repeat(40),
  APPROVAL_BOUND_GIT_VERSION_LINE: 'git version 2.39.5 (Apple Git-154)' });
const STATIC = createStaticAllowlistDigest(SYMBOLS);
const identityFor = (record: AllowlistRecord): ExecutableIdentity => Object.freeze({ realpath: record.expectedRealpath,
  fileType: 'REGULAR_FILE', device: 1, inode: TIER_A_RECORDS.indexOf(record) + 2, mode: 493, uid: 0, gid: 0,
  sizeBytes: 100, codeSignature: 'fixture' });
const IDENTITIES = Object.freeze(Object.fromEntries(STATIC.contract.records.map((record) => [record.commandId, identityFor(record)])));

class FakeClock implements SequencerClock {
  private now = 0; private nextId = 1;
  private readonly timers = new Map<number, { due: number; callback: () => void }>();
  readonly scheduled: number[] = []; readonly cancelled: number[] = [];
  nowMs(): number { return this.now; }
  schedule(delayMs: number, callback: () => void): TimerHandle {
    const handle = Object.freeze({ id: this.nextId++ }); this.timers.set(handle.id, { due: this.now + delayMs, callback });
    this.scheduled.push(handle.id); return handle;
  }
  cancel(handle: TimerHandle): void { this.cancelled.push(handle.id); this.timers.delete(handle.id); }
  advanceBy(ms: number): void {
    this.now += ms;
    for (const [id, timer] of [...this.timers.entries()].sort((a, b) => a[1].due - b[1].due)) {
      if (timer.due <= this.now) { this.timers.delete(id); timer.callback(); }
    }
  }
}
const successEvents = (stdout = new Uint8Array(), stderr = new Uint8Array()): readonly ProcessEvent[] => Object.freeze([
  { type: 'SPAWN_CONFIRMED' }, ...(stdout.byteLength ? [{ type: 'STDOUT_DATA' as const, chunk: stdout }] : []),
  ...(stderr.byteLength ? [{ type: 'STDERR_DATA' as const, chunk: stderr }] : []), { type: 'STDOUT_END' },
  { type: 'STDERR_END' }, { type: 'PROCESS_EXIT', exitCode: 0, signal: 'NONE' }, { type: 'PROCESS_CLOSE' },
]);
const emitAll = (events: readonly ProcessEvent[], emit: (event: ProcessEvent) => void): void => events.forEach(emit);
const identityPort = { verifyExactPath: (record: AllowlistRecord) => IDENTITIES[record.commandId] };
const closedTermination = (): TerminationPort => ({ signalExactChild: () => true, isExactChildClosed: () => true });
const context = (overrides: Partial<OfflineExecutionContext> = {}): OfflineExecutionContext => Object.freeze({
  staticAllowlistDigest: STATIC.digest, executionBaselineDigest: 'b'.repeat(64), sequencerRunId: 'factory-run-1',
  repositoryBranch: 'main', repositoryHead: '1'.repeat(40), canonicalContract: ALLOWLIST_CONTRACT, resolvedContract: STATIC.contract,
  symbolResolution: STATIC.symbolResolution, approvedIdentities: IDENTITIES, observedAt: '2026-08-07T00:00:00Z',
  ...overrides,
});
const run = (port: HostProcessPort, overrides: Partial<OfflineExecutionContext> = {}, clock = new FakeClock()) =>
  new StopOnFirstFailureSequencer(port, identityPort, closedTermination(), clock).run(context(overrides));
const arbiterRun = (record: AllowlistRecord, events: readonly ProcessEvent[]) => {
  const arbiter = new DeterministicProcessEventArbiter(record); let result;
  for (const event of events) result = arbiter.accept(event) ?? result;
  return result!;
};
const withCaps = (stdoutMaxBytes: number, stderrMaxBytes: number, stdoutMaxLines = 100, stderrMaxLines = 100): AllowlistRecord =>
  ({ ...TIER_A_RECORDS[0]!, stdoutMaxBytes, stderrMaxBytes, stdoutMaxLines, stderrMaxLines });

describe('F0-HI gates and capability', () => {
  it('accepts only the exact environment', () => { expect(() => assertExactEnvironment(EXACT_ENVIRONMENT)).not.toThrow();
    expect(() => assertExactEnvironment({ ...EXACT_ENVIRONMENT, HOME: '/tmp' })).toThrow('ENVIRONMENT_POLICY_MISMATCH'); });
  it('keeps live execution blocked', () => expect(HOST_EXECUTION_ELIGIBILITY).toMatchObject({ mockedImplementation: true,
    liveAuthorization: false, liveExecution: false, toctouGate: 'BLOCKED_FEASIBILITY_GAP_FOR_LIVE_EXECUTION' }));
  const binding = Object.freeze({ staticAllowlistDigest: STATIC.digest, executionBaselineDigest: 'b'.repeat(64),
    commandOrderVersion: COMMAND_ORDER_VERSION, sequencerRunId: 'factory-run-1', sequenceIndex: 0, commandId: 'F0-GIT-00' });
  it('rejects a genuine structural forgery', () => { const harness = createOfflineCapabilityTestHarness(binding);
    const forged = Object.freeze({ kind: 'F0_HI_SINGLE_USE_DISPATCH_CAPABILITY' as const }) as DispatchCapability;
    expect(() => harness.consume(forged)).toThrow('DISPATCH_CAPABILITY_FORGED'); });
  it('rejects reuse and wrong bindings separately', () => { const harness = createOfflineCapabilityTestHarness(binding);
    harness.consume(); expect(() => harness.consume()).toThrow('DISPATCH_CAPABILITY_CONSUMED');
    expect(() => createOfflineCapabilityTestHarness(binding).consume(undefined, { ...binding, sequenceIndex: 1 }))
      .toThrow('DISPATCH_CAPABILITY_BINDING_MISMATCH'); });
  it('revokes future capability issue', () => { const harness = createOfflineCapabilityTestHarness(binding); harness.revoke();
    expect(() => harness.issue()).toThrow('EXECUTION_AUTHORITY_REVOKED'); });
});

describe('host arbiter stream contract', () => {
  it('segments stdout at 4096 bytes with one pending segment', () => { const bytes = new Uint8Array(9000);
    const result = arbiterRun(withCaps(9000, 0), successEvents(bytes));
    expect(result.stdout).toMatchObject({ maxSegmentBytes: 4096, maxPendingSegments: 1, byteCount: 9000 }); });
  it('segments the same oversized fixture deterministically', () => { const events = successEvents(new Uint8Array(8193));
    expect(arbiterRun(withCaps(9000, 0), events).stdout).toEqual(arbiterRun(withCaps(9000, 0), events).stdout); });
  it('decodes UTF-8 split across segments', () => { const encoded = new TextEncoder().encode('a'.repeat(4095) + '가');
    expect(arbiterRun(withCaps(encoded.length, 0), successEvents(encoded)).stdout.invalidUtf8).toBe(false); });
  it('normalizes split CRLF and CR-only input', () => { const encoder = new TextEncoder();
    const events: readonly ProcessEvent[] = [{ type: 'SPAWN_CONFIRMED' }, { type: 'STDOUT_DATA', chunk: encoder.encode('a\r') },
      { type: 'STDOUT_DATA', chunk: encoder.encode('\nb\r') }, { type: 'STDOUT_DATA', chunk: encoder.encode('c\n') },
      { type: 'STDOUT_END' }, { type: 'STDERR_END' }, { type: 'PROCESS_EXIT', exitCode: 0, signal: 'NONE' },
      { type: 'PROCESS_CLOSE' }];
    expect(arbiterRun(withCaps(32, 0), events).stdout.normalizedOutput).toBe('a\nb\nc\n'); });
  it('tracks byte and line caps independently', () => { const encoder = new TextEncoder();
    const result = arbiterRun(withCaps(32, 0, 1), successEvents(encoder.encode('a\nb')));
    expect(result.stdout).toMatchObject({ byteCount: 3, lineCount: 2, capExceeded: true });
    expect(result.stopReason).toBe('STDOUT_OUTPUT_LIMIT_EXCEEDED'); });
  it('accepts exact stdout cap equality', () => expect(arbiterRun(withCaps(3, 0),
    successEvents(new TextEncoder().encode('abc'))).completed).toBe(true));
  it('accepts exact zero stderr cap only when stderr is empty', () => expect(arbiterRun(withCaps(0, 0),
    successEvents()).completed).toBe(true));
  it('classifies one byte over stdout cap', () => expect(arbiterRun(withCaps(2, 0),
    successEvents(new TextEncoder().encode('abc'))).stopReason).toBe('STDOUT_OUTPUT_LIMIT_EXCEEDED'));
  it('classifies one byte over stderr cap', () => expect(arbiterRun(withCaps(0, 2),
    successEvents(new Uint8Array(), new TextEncoder().encode('abc'))).stopReason).toBe('STDERR_OUTPUT_LIMIT_EXCEEDED'));
  it('preserves both, stderr, stdout cap precedence', () => {
    expect(arbiterRun(withCaps(0, 0), successEvents(new Uint8Array([1]), new Uint8Array([1]))).stopReason).toBe('BOTH_STREAM_OUTPUT_LIMIT_EXCEEDED');
    expect(arbiterRun(withCaps(1, 0), successEvents(new Uint8Array(), new Uint8Array([1]))).stopReason).toBe('STDERR_OUTPUT_LIMIT_EXCEEDED');
    expect(arbiterRun(withCaps(0, 1), successEvents(new Uint8Array([1]))).stopReason).toBe('STDOUT_OUTPUT_LIMIT_EXCEEDED');
  });
  it('rejects invalid and incomplete terminal UTF-8', () => { for (const bytes of [new Uint8Array([0xff]), new Uint8Array([0xe2, 0x82])])
    expect(arbiterRun(withCaps(8, 0), successEvents(bytes)).stopReason).toBe('INVALID_UTF8'); });
  it('makes bounded non-empty stderr terminal even at exit zero', () => expect(arbiterRun(withCaps(0, 8),
    successEvents(new Uint8Array(), new TextEncoder().encode('warn'))).stopReason).toBe('STDERR_NONEMPTY'));
  it('exposes bounded states but no raw stream property', () => { const result = arbiterRun(withCaps(8, 0), successEvents());
    expect(Object.keys(result)).not.toEqual(expect.arrayContaining(['stdoutRaw', 'stderrRaw', 'stdoutChunks', 'stderrChunks'])); });
});

describe('canonical sequencer order ownership', () => {
  const zeroDispatch = (contract: AllowlistContract) => { let calls = 0;
    const result = run({ dispatch: () => { calls += 1; } }, { resolvedContract: contract,
      staticAllowlistDigest: sha256(canonicalize(contract)) }); return { calls, result }; };
  it.each([
    ['short', { ...STATIC.contract, records: STATIC.contract.records.slice(0, 15) }],
    ['reordered', { ...STATIC.contract, records: [STATIC.contract.records[1]!, STATIC.contract.records[0]!, ...STATIC.contract.records.slice(2)] }],
    ['duplicate', { ...STATIC.contract, records: [STATIC.contract.records[0]!, STATIC.contract.records[0]!, ...STATIC.contract.records.slice(2)] }],
    ['missing', { ...STATIC.contract, records: STATIC.contract.records.filter((record) => record.commandId !== 'F0-GIT-05') }],
    ['extra', { ...STATIC.contract, records: [...STATIC.contract.records, STATIC.contract.records[0]!] }],
    ['unknown', { ...STATIC.contract, records: [{ ...STATIC.contract.records[0]!, commandId: 'UNKNOWN' }, ...STATIC.contract.records.slice(1)] }],
    ['order-version', { ...STATIC.contract, commandOrderVersion: 'wrong' }],
    ['invalid', { ...STATIC.contract, contractVersion: 'v1' }],
  ])('rejects %s contract before dispatch', (_name, contract) => { const outcome = zeroDispatch(contract as AllowlistContract);
    expect(outcome.calls).toBe(0); expect(outcome.result.resultClass).toBe('BASELINE_FAILED'); });
  it('has no caller-provided records field in execution context', () => expect(Object.keys(context())).not.toContain('records'));
  it('completes all exact 16 canonical records in order', () => { const calls: string[] = [];
    const result = run({ dispatch: (request, _capability, emit) => { calls.push(request.commandId); emitAll(successEvents(), emit); } });
    expect(result.resultClass).toBe('COMPLETED'); expect(result.acceptedEvidenceCount).toBe(16);
    expect(calls).toEqual(TIER_A_COMMAND_IDS); expect(result.orderedEvidence.map((entry) => entry.commandId)).toEqual(TIER_A_COMMAND_IDS);
  });
});

describe('terminal evidence, dependencies, and mappings', () => {
  it.each<[StopReason, string]>([['COMMAND_TIMEOUT', 'EXECUTION_ERROR'], ['PROCESS_SPAWN_FAILED', 'EXECUTION_ERROR'],
    ['STREAM_READ_FAILED', 'EXECUTION_ERROR'], ['PROCESS_TERMINATION_FAILED', 'EXECUTION_ERROR'],
    ['STDERR_NONEMPTY', 'STDERR_NONEMPTY'], ['STDOUT_OUTPUT_LIMIT_EXCEEDED', 'OUTPUT_LIMIT_EXCEEDED'],
    ['INVALID_UTF8', 'SCHEMA_MISMATCH'], ['EXECUTABLE_MISMATCH', 'EXECUTABLE_MISMATCH'],
    ['DEPENDENCY_NOT_ESTABLISHED', 'DEPENDENCY_UNSATISFIED'], ['BASELINE_MISMATCH', 'BASELINE_MISMATCH']])
  ('maps %s deterministically', (reason, exitClass) => expect(mapStopReasonToExitClass(reason)).toBe(exitClass));
  it('creates exactly one validated bounded spawn-failure evidence record with actual context values', () => {
    const result = run({ dispatch: (_request, _capability, emit) => emit({ type: 'SPAWN_ERROR', message: 'fixture' }) });
    expect(result.orderedEvidence).toHaveLength(1); expect(result.terminalEvidence).not.toBe('NONE');
    expect(result.terminalEvidence).toMatchObject({ exitClass: 'EXECUTION_ERROR', stopReason: 'PROCESS_SPAWN_FAILED',
      normalizationResult: 'REJECTED', normalizedFacts: {}, repositoryHead: '1'.repeat(40),
      executionBaselineDigest: 'b'.repeat(64), sequencerRunId: 'factory-run-1', processExitCode: 'NONE' });
    expect((result.terminalEvidence as { argvDigest: string }).argvDigest).toBe(sha256(canonicalize(TIER_A_RECORDS[0]!.argv)));
  });
  it('rejects a canonical record mismatch before dispatch', () => { let calls = 0;
    const canonicalContract = { ...ALLOWLIST_CONTRACT, records: ALLOWLIST_CONTRACT.records.map((record, index) =>
      index === 0 ? { ...record, timeoutMs: record.timeoutMs + 1 } : record) };
    const result = run({ dispatch: () => { calls += 1; } }, { canonicalContract });
    expect(calls).toBe(0); expect(result.resultClass).toBe('BASELINE_FAILED');
  });
  it('stops before dispatch on a missing dependency', () => { const contract = { ...STATIC.contract,
    records: STATIC.contract.records.map((record, index) => index === 0 ? { ...record, explicitDependencies: ['MISSING:SUCCESS'] } : record) };
    let calls = 0; const result = run({ dispatch: () => { calls += 1; } }, { resolvedContract: contract,
      staticAllowlistDigest: sha256(canonicalize(contract)) }); expect(calls).toBe(0); expect(result.terminalEvidence).not.toBe('NONE'); });
  it('never points terminal evidence at the last prior success', () => { let calls = 0;
    const result = run({ dispatch: (_request, _capability, emit) => { calls += 1;
      emitAll(calls === 2 ? [{ type: 'SPAWN_ERROR', message: 'fixture' }] : successEvents(), emit); } });
    expect(result.acceptedEvidenceCount).toBe(1); expect(result.orderedEvidence).toHaveLength(2);
    expect((result.terminalEvidence as { commandId: string }).commandId).toBe('F0-GIT-01');
  });
  it('contains no evidence placeholders or raw streams', () => { const result = run({ dispatch: (_r, _c, emit) => emitAll(successEvents(), emit) });
    expect(JSON.stringify(result)).not.toMatch(/mocked-by-offline-boundary|mocked-context|stdoutChunks|stderrChunks/); });
});

describe('scheduled fake timeout and termination integration', () => {
  it.each([
    ['before spawn', []],
    ['after spawn', [{ type: 'SPAWN_CONFIRMED' }]],
    ['after exit', [{ type: 'SPAWN_CONFIRMED' }, { type: 'PROCESS_EXIT', exitCode: 0, signal: 'NONE' }]],
    ['after streams', [{ type: 'SPAWN_CONFIRMED' }, { type: 'STDOUT_END' }, { type: 'STDERR_END' },
      { type: 'PROCESS_EXIT', exitCode: 0, signal: 'NONE' }]],
  ] as const)('times out %s exactly once', (_name, events) => { const clock = new FakeClock();
    const result = run({ dispatch: (_r, _c, emit) => emitAll(events as readonly ProcessEvent[], emit) }, {}, clock);
    expect((result.terminalEvidence as { stopReason: string }).stopReason).toBe('COMMAND_TIMEOUT');
    expect(clock.scheduled).toHaveLength(1); expect(clock.cancelled).toEqual(clock.scheduled);
  });
  it('cancels timers on success and non-timeout failure', () => { for (const events of [successEvents(),
    [{ type: 'SPAWN_ERROR' as const, message: 'fixture' }]]) { const clock = new FakeClock();
    run({ dispatch: (_r, _c, emit) => emitAll(events, emit) }, {}, clock);
    expect(clock.cancelled).toEqual(clock.scheduled); } });
  it('ignores a late timeout and never reuses a handle', () => { const clock = new FakeClock();
    const result = run({ dispatch: (_r, _c, emit) => emitAll(successEvents(), emit) }, {}, clock); clock.advanceBy(5000);
    expect(result.resultClass).toBe('COMPLETED'); expect(new Set(clock.scheduled).size).toBe(16); });
  it('uses the same termination controller for stream safety failures', () => { const signals: string[] = [];
    const clock = new FakeClock(); const termination = { signalExactChild: (signal: 'SIGTERM' | 'SIGKILL') => { signals.push(signal); return true; },
      isExactChildClosed: () => true }; const sequencer = new StopOnFirstFailureSequencer({ dispatch: (_r, _c, emit) =>
      emitAll(successEvents(new Uint8Array(129)), emit) }, identityPort, termination, clock);
    const result = sequencer.run(context()); expect(result.resultClass).toBe('COMMAND_EXECUTION_FAILED');
    expect(signals).toEqual(['SIGTERM']); });
  it('reports termination failure with one terminal evidence and no later command', () => { let calls = 0;
    const clock = new FakeClock(); const sequencer = new StopOnFirstFailureSequencer({ dispatch: (_r, _c, emit) => {
      calls += 1; emitAll(successEvents(new Uint8Array(129)), emit); } }, identityPort,
    { signalExactChild: () => true, isExactChildClosed: () => false }, clock); const result = sequencer.run(context());
    expect(result.resultClass).toBe('PROCESS_TERMINATION_FAILED'); expect(calls).toBe(1);
    expect(result.orderedEvidence).toHaveLength(1); expect((result.terminalEvidence as { stopReason: string }).stopReason)
      .toBe('PROCESS_TERMINATION_FAILED'); });
  it('sends no signal for an already-exited child', () => { const signals: string[] = []; const clock = new FakeClock();
    const controller = new DeterministicTerminationController({ signalExactChild: (signal) => { signals.push(signal); return true; },
      isExactChildClosed: () => true }, clock); expect(controller.terminate(true)).toBe('CLOSED'); expect(signals).toEqual([]); });
});
