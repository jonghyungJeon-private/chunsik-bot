import { XrObserverLifecyclePort, XrObserverSpawnRequest } from '../egress-allowlist-runner/host/isolation';

export type FakeLifecycleAction = Readonly<{ kind: 'SPAWN'; request: XrObserverSpawnRequest }> |
  Readonly<{ kind: 'WRITE'; frame: Uint8Array }> | Readonly<{ kind: 'CLOSE_REQUEST' | 'TERM' | 'KILL' }> |
  Readonly<{ kind: 'CLEANUP'; cwd: string }>;
export type FakeLifecycleFailure = 'SPAWN' | 'WRITE' | 'CLOSE_REQUEST' | 'TERM' | 'KILL' | 'CLEANUP';

export class FakeObserverLifecycle implements XrObserverLifecyclePort {
  readonly actions: FakeLifecycleAction[] = []; private time = 0; private readonly failures = new Set<FakeLifecycleFailure>();
  nowMs(): number { return this.time; }
  advance(ms: number): void { this.time += ms; }
  fail(action: FakeLifecycleFailure): void { this.failures.add(action); }
  spawn(request: XrObserverSpawnRequest): void { this.throwIf('SPAWN'); this.actions.push(Object.freeze({ kind: 'SPAWN', request })); }
  write(frame: Uint8Array): void { this.throwIf('WRITE'); this.actions.push(Object.freeze({ kind: 'WRITE', frame: frame.slice() })); }
  closeRequestSide(): void { this.throwIf('CLOSE_REQUEST'); this.actions.push(Object.freeze({ kind: 'CLOSE_REQUEST' })); }
  requestTerm(): void { this.throwIf('TERM'); this.actions.push(Object.freeze({ kind: 'TERM' })); }
  requestKill(): void { this.throwIf('KILL'); this.actions.push(Object.freeze({ kind: 'KILL' })); }
  cleanupExactSandbox(cwd: string): void { this.throwIf('CLEANUP'); this.actions.push(Object.freeze({ kind: 'CLEANUP', cwd })); }
  count(kind: FakeLifecycleAction['kind']): number { return this.actions.filter((action) => action.kind === kind).length; }
  private throwIf(action: FakeLifecycleFailure): void { if (this.failures.has(action)) throw new Error(`FAKE_${action}_FAILURE`); }
}
