import { describe, expect, it } from 'vitest';
import {
  MAX_ROUTING_TRANSITIONS,
  RoutingExecutionState,
  RoutingExecutionStateMachine,
} from './routing-execution-state';

describe('RoutingExecutionStateMachine', () => {
  it('allows the ratified seven-transition fallback path', () => {
    const machine = new RoutingExecutionStateMachine();
    for (const state of [
      RoutingExecutionState.PRIMARY_READY,
      RoutingExecutionState.PRIMARY_EXECUTING,
      RoutingExecutionState.PRIMARY_VALIDATING,
      RoutingExecutionState.FALLBACK_READY,
      RoutingExecutionState.FALLBACK_EXECUTING,
      RoutingExecutionState.FALLBACK_VALIDATING,
      RoutingExecutionState.TERMINAL,
    ]) {
      machine.transition(state, 'TEST');
    }
    expect(machine.transitions).toHaveLength(MAX_ROUTING_TRANSITIONS);
    expect(machine.state).toBe(RoutingExecutionState.TERMINAL);
  });

  it.each([
    RoutingExecutionState.PRIMARY_READY,
    RoutingExecutionState.FALLBACK_READY,
    RoutingExecutionState.ESCALATION_READY,
  ])('allows a zero-attempt deadline transition from %s', (ready) => {
    const machine = new RoutingExecutionStateMachine();
    if (ready === RoutingExecutionState.PRIMARY_READY) {
      machine.transition(ready, 'PREFLIGHT');
    } else {
      machine.transition(RoutingExecutionState.PRIMARY_READY, 'PREFLIGHT');
      machine.transition(RoutingExecutionState.PRIMARY_EXECUTING, 'DISPATCH');
      machine.transition(RoutingExecutionState.PRIMARY_VALIDATING, 'VALIDATE');
      machine.transition(ready, 'BRANCH');
    }
    machine.transition(RoutingExecutionState.TERMINAL, 'DEADLINE');
    expect(machine.state).toBe(RoutingExecutionState.TERMINAL);
  });

  it('rejects invalid, terminal re-entry, and over-bound transitions', () => {
    const invalid = new RoutingExecutionStateMachine();
    expect(() => invalid.transition(RoutingExecutionState.FALLBACK_READY, 'INVALID')).toThrow(/Invalid/);

    const terminal = new RoutingExecutionStateMachine();
    terminal.transition(RoutingExecutionState.TERMINAL, 'FAIL');
    expect(() => terminal.transition(RoutingExecutionState.TERMINAL, 'AGAIN')).toThrow(/Invalid/);
  });
});
