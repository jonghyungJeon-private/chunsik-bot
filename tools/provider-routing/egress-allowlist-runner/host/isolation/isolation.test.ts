import { describe, expect, it } from 'vitest';
import { FakeObserverLifecycle } from '../../../egress-allowlist-runner-test-support/fake-observer-lifecycle';
import { XR_FCI_CHILD_HARD_LIFETIME_MS, XrFciOperationRequest, XrObserverComposition, XrObserverFdInvariant,
  XrObserverIdentity } from './contracts';
import { XrFciIsolationError, XrIsolationAttemptGate, XrRecordIsolationController } from './isolation';
import { encodeXrFciFrame, okResponse } from './protocol';

const identity: XrObserverIdentity = Object.freeze({ contractVersion: 1, protocolVersion: 1,
  nodeExecutableRealpath: '/control/node', nodeExecutableSha256: 'a'.repeat(64),
  observerEntrypointRealpath: '/control/observer.js', observerEntrypointSha256: 'b'.repeat(64),
  observerBundleByteLength: 123, buildBindingSha256: 'c'.repeat(64) });
const composition: XrObserverComposition = Object.freeze({ expectedIdentity: identity, sandboxCwd: '/sandbox/record-1',
  credentials: Object.freeze({ expectedUid: 501, expectedGid: 20, expectedSupplementaryGroups: Object.freeze([20]),
    privilegeEscalation: 'NONE' }) });
const fdInvariant: XrObserverFdInvariant = Object.freeze({ parentIsSoleWriter: true, childHasNoWriter: true,
  noSiblingHelperOrDescendantWriter: true, noDuplicateOrTransferredWriter: true, unrelatedSpawnsCloseOnExec: true,
  childCreatesNoDescendants: true });
const request: XrFciOperationRequest = Object.freeze({ protocolVersion: 1, recordNonce: 'd'.repeat(32), sequenceIndex: 1,
  pass: 'PRE_READ_PASS', operation: 'LSTAT', exactPath: '/private/exact' });
const harness = () => { const lifecycle = new FakeObserverLifecycle();
  const controller = new XrRecordIsolationController(lifecycle, composition, request.recordNonce);
  controller.start(identity, fdInvariant); return { lifecycle, controller }; };
const respond = (controller: XrRecordIsolationController, item = request) =>
  controller.receive(encodeXrFciFrame(okResponse(item, { fileType: 'REGULAR_FILE', device: 1, inode: 2, uid: 501,
    gid: 20, mode: 0o100755, size: 3, mtime: 4 })));
const proveTerminal = (controller: XrRecordIsolationController, consistent = false) => { controller.onExitObserved();
  controller.onReapProven(); controller.onStreamsClosed(); if (consistent) controller.onParentConsistencySucceeded();
  controller.cleanup(); return controller.finish(); };

describe('XR-FCI identity, spawn request, and process-wide FD invariant', () => {
  it('validates identity before producing a fixed no-shell/no-PATH spawn request', () => {
    const { lifecycle, controller } = harness(); expect(controller.state).toBe('ACTIVE'); expect(lifecycle.count('SPAWN')).toBe(1);
    const action = lifecycle.actions[0]; expect(action?.kind).toBe('SPAWN');
    if (action?.kind !== 'SPAWN') throw new Error('missing spawn');
    expect(action.request).toMatchObject({ executable: '/control/node', argv: ['/control/observer.js'], shell: false,
      cwd: '/sandbox/record-1', env: { LANG: 'C', LC_ALL: 'C', NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
      extraFds: 'NONE', detached: false, umask: 0o077 });
    expect(Object.keys(action.request.env).sort()).toEqual(['LANG', 'LC_ALL', 'NO_COLOR']);
    expect(JSON.stringify(action.request)).not.toContain('/private/exact');
  });
  it('blocks lifecycle spawn on every observer identity mismatch', () => {
    for (const observed of [{ ...identity, nodeExecutableSha256: 'f'.repeat(64) },
      { ...identity, observerEntrypointRealpath: '/control/alternate.js' }, { ...identity, buildBindingSha256: '0'.repeat(64) }]) {
      const lifecycle = new FakeObserverLifecycle(); const controller = new XrRecordIsolationController(lifecycle, composition,
        request.recordNonce); expect(() => controller.start(observed, fdInvariant)).toThrow('OBSERVER_IDENTITY_INVALID');
      expect(lifecycle.count('SPAWN')).toBe(0); expect(controller.state).toBe('UNCERTAIN_TERMINAL');
    }
  });
  it('fails duplicate/inherited writer proof before readiness and never waits for EOF', () => {
    for (const key of Object.keys(fdInvariant) as (keyof XrObserverFdInvariant)[]) {
      const lifecycle = new FakeObserverLifecycle(); const controller = new XrRecordIsolationController(lifecycle, composition,
        request.recordNonce); expect(() => controller.start(identity, { ...fdInvariant, [key]: false })).toThrow(
          'CHILD_INVARIANT_VIOLATION'); expect(lifecycle.count('SPAWN')).toBe(0);
    }
  });
  it('normalizes a lifecycle-port spawn exception without leaking host error text', () => {
    const lifecycle = new FakeObserverLifecycle(); lifecycle.fail('SPAWN');
    const controller = new XrRecordIsolationController(lifecycle, composition, request.recordNonce);
    expect(() => controller.start(identity, fdInvariant)).toThrow('SPAWN_REQUEST_FAILED');
    expect(controller.result?.primaryFailure).toBe('SPAWN_REQUEST_FAILED');
  });
});

describe('XR-FCI normal close and provisional result lifecycle', () => {
  it('reaches normal CLEAN_TERMINAL without TERM/KILL and keeps result provisional until proofs', () => {
    const { lifecycle, controller } = harness(); controller.send(request); respond(controller);
    expect(controller.provisionalResultCount).toBe(1); expect(controller.result).toBeUndefined(); controller.beginNormalClose();
    controller.receive(encodeXrFciFrame({ protocolVersion: 1, recordNonce: request.recordNonce, sequenceIndex: 2,
      status: 'CLOSED' })); expect(controller.onParentPipeEof()).toBe('NORMAL_CLOSE_EOF');
    const result = proveTerminal(controller, true); expect(result).toMatchObject({ state: 'CLEAN_TERMINAL', outcome: 'SUCCESS',
      primaryFailure: 'NONE', provisionalResultCount: 1 }); expect(lifecycle.count('TERM')).toBe(0);
    expect(lifecycle.count('KILL')).toBe(0); expect(lifecycle.count('CLEANUP')).toBe(1);
  });
  it('does not finalize a result before exit/reap/streams/cleanup and parent consistency', () => {
    const { controller } = harness(); controller.send(request); respond(controller); controller.beginNormalClose();
    expect(controller.finish()).toMatchObject({ state: 'UNCERTAIN_TERMINAL', outcome: 'FAILED', primaryFailure: 'EXIT_UNPROVEN' });
  });
});

describe('XR-FCI EOF classification and required self-watchdog', () => {
  it('keeps parent-containment EOF in containment rather than orphan classification', () => {
    const { lifecycle, controller } = harness(); controller.onParentDeadline();
    expect(controller.onParentPipeEof()).toBe('PARENT_CONTAINMENT_EOF');
    expect(controller.result).toBeUndefined(); expect(lifecycle.count('TERM')).toBe(1);
  });
  it.each(['idle', 'outstanding', 'provisional'] as const)('fails closed when parent disappears while %s', (phase) => {
    const { lifecycle, controller } = harness(); if (phase !== 'idle') controller.send(request);
    if (phase === 'provisional') respond(controller); expect(controller.onParentPipeEof()).toBe('UNEXPECTED_PARENT_LOSS_EOF');
    expect(controller.state).toBe('WATCHDOG_FAILED'); expect(controller.provisionalResultCount).toBe(0);
    expect(lifecycle.count('CLOSE_REQUEST')).toBe(1); expect(lifecycle.count('TERM')).toBe(1);
  });
  it('arms a fixed independent lifetime and expires into fail-closed without proving exit', () => {
    const { lifecycle, controller } = harness(); expect(controller.childHardLifetimeMs).toBe(XR_FCI_CHILD_HARD_LIFETIME_MS);
    lifecycle.advance(XR_FCI_CHILD_HARD_LIFETIME_MS); controller.checkChildHardLifetime();
    expect(controller.state).toBe('WATCHDOG_FAILED'); expect(controller.selfDeadlineProvesBoundedExit).toBe(false);
    expect(controller.result).toBeUndefined();
  });
  it.each(['EOF_FIRST', 'DEADLINE_FIRST'] as const)('makes EOF/deadline race monotonic: %s', (order) => {
    const { lifecycle, controller } = harness(); if (order === 'EOF_FIRST') { controller.onParentPipeEof(); controller.onSelfDeadline(); }
    else { controller.onSelfDeadline(); expect(controller.onParentPipeEof()).toBe('PARENT_CONTAINMENT_EOF'); }
    expect(controller.state).toBe('WATCHDOG_FAILED'); expect(lifecycle.count('TERM')).toBe(1);
  });
  it.each(['LOSS_FIRST', 'RESULT_FIRST'] as const)('invalidates parent-loss/result race in both orders: %s', (order) => {
    const { controller } = harness(); controller.send(request);
    if (order === 'LOSS_FIRST') { controller.onParentPipeEof(); respond(controller); }
    else { respond(controller); expect(controller.provisionalResultCount).toBe(1); controller.onParentPipeEof(); }
    expect(controller.provisionalResultCount).toBe(0); expect(controller.state).toBe('WATCHDOG_FAILED');
  });
  it('preserves unavailable proof when watchdog cannot progress or terminal completion is uncertain', () => {
    const { controller } = harness(); controller.onSelfDeadline();
    expect(controller.onFinalProofTimer()).toMatchObject({ state: 'UNCERTAIN_TERMINAL', outcome: 'FAILED' });
    expect(controller.result?.failures).toEqual(expect.arrayContaining(['EXIT_UNPROVEN', 'REAP_UNPROVEN',
      'STREAM_CLOSE_UNPROVEN', 'CLEANUP_FAILED']));
  });
});

describe('XR-FCI failure containment and proof separation', () => {
  it('handles deadline -> TERM -> clean exit/reap without KILL', () => {
    const { lifecycle, controller } = harness(); controller.onParentDeadline(); const result = proveTerminal(controller);
    expect(result).toMatchObject({ state: 'CLEAN_TERMINAL', outcome: 'FAILED', primaryFailure: 'DEADLINE_EXPIRED' });
    expect(lifecycle.count('TERM')).toBe(1); expect(lifecycle.count('KILL')).toBe(0);
  });
  it('handles deadline -> TERM grace -> KILL -> proven clean containment', () => {
    const { lifecycle, controller } = harness(); controller.onParentDeadline(); controller.onTermGraceExpired();
    const result = proveTerminal(controller); expect(result.state).toBe('CLEAN_TERMINAL'); expect(lifecycle.count('KILL')).toBe(1);
  });
  it.each(['TERM', 'KILL'] as const)('%s failure remains uncertain even if later proofs arrive', (failure) => {
    const { lifecycle, controller } = harness(); lifecycle.fail(failure); controller.onParentDeadline();
    if (failure === 'KILL') controller.onTermGraceExpired(); const result = proveTerminal(controller);
    expect(result.state).toBe('UNCERTAIN_TERMINAL'); expect(result.failures).toContain(`${failure}_FAILED`);
  });
  it.each([
    ['exit absent', (controller: XrRecordIsolationController) => controller.finish(), 'EXIT_UNPROVEN'],
    ['reap absent', (controller: XrRecordIsolationController) => { controller.onExitObserved(); return controller.finish(); }, 'REAP_UNPROVEN'],
    ['streams absent', (controller: XrRecordIsolationController) => { controller.onExitObserved(); controller.onReapProven();
      return controller.finish(); }, 'STREAM_CLOSE_UNPROVEN'],
  ] as const)('keeps %s proof uncertainty absorbing', (_label, action, reason) => {
    const { controller } = harness(); controller.onParentDeadline(); const result = action(controller);
    expect(result.state).toBe('UNCERTAIN_TERMINAL'); expect(result.failures).toContain(reason);
    controller.onExitObserved(); expect(controller.state).toBe('UNCERTAIN_TERMINAL');
  });
  it('classifies cleanup failure as uncertain', () => {
    const { lifecycle, controller } = harness(); controller.onParentDeadline(); controller.onExitObserved();
    controller.onReapProven(); controller.onStreamsClosed(); lifecycle.fail('CLEANUP'); controller.cleanup();
    const result = controller.finish(); expect(result.state).toBe('UNCERTAIN_TERMINAL');
    expect(result.failures).toContain('CLEANUP_FAILED');
  });
  it('final timer alone never proves exit, reap, or CLEAN_TERMINAL', () => {
    const { controller } = harness(); controller.onParentDeadline(); const result = controller.onFinalProofTimer();
    expect(result.state).toBe('UNCERTAIN_TERMINAL'); expect(result.failures).toContain('EXIT_UNPROVEN');
    expect(result.failures).toContain('REAP_UNPROVEN'); expect(result.state).not.toBe('CLEAN_TERMINAL');
  });
  it('caps stderr and never persists diagnostic content', () => {
    const { controller } = harness(); controller.observeStderr(4097); expect(controller.state).toBe('TERMINATING');
    expect(controller.finish().failures).toContain('STDERR_CAP_EXCEEDED');
  });
});

describe('XR-FCI response ordering and one unresolved child rule', () => {
  it('rejects a runtime operation/schema escape before lifecycle write', () => {
    const { lifecycle, controller } = harness(); const writes = lifecycle.count('WRITE');
    expect(() => controller.send({ ...request, operation: 'READ_FILE', arbitraryRpc: true } as unknown as
      XrFciOperationRequest)).toThrow('UNEXPECTED_OPERATION');
    expect(lifecycle.count('WRITE')).toBe(writes); expect(controller.state).toBe('TERMINATING');
  });
  it('rejects duplicate and late responses with deterministic codes', () => {
    const first = harness(); first.controller.send(request); respond(first.controller); respond(first.controller);
    expect(first.controller.state).toBe('TERMINATING');
    const second = harness(); second.controller.send(request); const late = { ...request, sequenceIndex: 2 };
    respond(second.controller, late); expect(second.controller.state).toBe('TERMINATING');
  });
  it('rejects multiple responses in one read and malformed protocol', () => {
    const multiple = harness(); multiple.controller.send(request); const encoded = encodeXrFciFrame(okResponse(request,
      { fileType: 'REGULAR_FILE', device: 1, inode: 2, uid: 501, gid: 20, mode: 1, size: 1, mtime: 1 }));
    const joined = new Uint8Array(encoded.length * 2); joined.set(encoded); joined.set(encoded, encoded.length);
    multiple.controller.receive(joined); expect(multiple.controller.state).toBe('TERMINATING');
    const malformed = harness(); malformed.controller.send(request); malformed.controller.receive(new Uint8Array([0, 0, 0, 1, 0xff]));
    expect(malformed.controller.state).toBe('TERMINATING');
  });
  it('halts after one unresolved child and permits next only after CLEAN_TERMINAL', () => {
    const gate = new XrIsolationAttemptGate(); gate.beginRecord(); expect(gate.canBeginNextRecord).toBe(false);
    expect(() => gate.beginRecord()).toThrow(XrFciIsolationError); const uncertain = harness().controller.onFinalProofTimer();
    gate.completeRecord(uncertain); expect(gate.canBeginNextRecord).toBe(false);
    const clean = harness(); clean.controller.onParentDeadline(); const result = proveTerminal(clean.controller);
    const next = new XrIsolationAttemptGate(); next.beginRecord(); next.completeRecord(result); expect(next.canBeginNextRecord).toBe(true);
  });
});
