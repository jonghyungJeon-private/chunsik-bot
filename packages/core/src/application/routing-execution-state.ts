export const MAX_ROUTING_TRANSITIONS = 7 as const;

export enum RoutingExecutionState {
  INITIAL = 'INITIAL',
  PRIMARY_READY = 'PRIMARY_READY',
  PRIMARY_EXECUTING = 'PRIMARY_EXECUTING',
  PRIMARY_VALIDATING = 'PRIMARY_VALIDATING',
  FALLBACK_READY = 'FALLBACK_READY',
  FALLBACK_EXECUTING = 'FALLBACK_EXECUTING',
  FALLBACK_VALIDATING = 'FALLBACK_VALIDATING',
  ESCALATION_READY = 'ESCALATION_READY',
  ESCALATION_EXECUTING = 'ESCALATION_EXECUTING',
  ESCALATION_VALIDATING = 'ESCALATION_VALIDATING',
  TERMINAL = 'TERMINAL',
}

export interface RoutingTransitionAudit {
  readonly sequence: number;
  readonly from: RoutingExecutionState;
  readonly to: RoutingExecutionState;
  readonly cause: string;
}

const ALLOWED: Readonly<Record<RoutingExecutionState, ReadonlySet<RoutingExecutionState>>> = Object.freeze({
  [RoutingExecutionState.INITIAL]: new Set([RoutingExecutionState.PRIMARY_READY, RoutingExecutionState.TERMINAL]),
  [RoutingExecutionState.PRIMARY_READY]: new Set([RoutingExecutionState.PRIMARY_EXECUTING, RoutingExecutionState.TERMINAL]),
  [RoutingExecutionState.PRIMARY_EXECUTING]: new Set([
    RoutingExecutionState.PRIMARY_VALIDATING,
    RoutingExecutionState.FALLBACK_READY,
    RoutingExecutionState.TERMINAL,
  ]),
  [RoutingExecutionState.PRIMARY_VALIDATING]: new Set([
    RoutingExecutionState.FALLBACK_READY,
    RoutingExecutionState.ESCALATION_READY,
    RoutingExecutionState.TERMINAL,
  ]),
  [RoutingExecutionState.FALLBACK_READY]: new Set([RoutingExecutionState.FALLBACK_EXECUTING, RoutingExecutionState.TERMINAL]),
  [RoutingExecutionState.FALLBACK_EXECUTING]: new Set([RoutingExecutionState.FALLBACK_VALIDATING, RoutingExecutionState.TERMINAL]),
  [RoutingExecutionState.FALLBACK_VALIDATING]: new Set([RoutingExecutionState.TERMINAL]),
  [RoutingExecutionState.ESCALATION_READY]: new Set([RoutingExecutionState.ESCALATION_EXECUTING, RoutingExecutionState.TERMINAL]),
  [RoutingExecutionState.ESCALATION_EXECUTING]: new Set([RoutingExecutionState.ESCALATION_VALIDATING, RoutingExecutionState.TERMINAL]),
  [RoutingExecutionState.ESCALATION_VALIDATING]: new Set([RoutingExecutionState.TERMINAL]),
  [RoutingExecutionState.TERMINAL]: new Set<RoutingExecutionState>(),
});

export class RoutingExecutionStateMachine {
  private currentState = RoutingExecutionState.INITIAL;
  private readonly records: RoutingTransitionAudit[] = [];

  get state(): RoutingExecutionState {
    return this.currentState;
  }

  get transitions(): readonly RoutingTransitionAudit[] {
    return Object.freeze([...this.records]);
  }

  transition(to: RoutingExecutionState, cause: string): void {
    if (!ALLOWED[this.currentState].has(to) || this.records.length >= MAX_ROUTING_TRANSITIONS) {
      throw new Error('Invalid or excessive routing state transition');
    }
    const record = Object.freeze({
      sequence: this.records.length + 1,
      from: this.currentState,
      to,
      cause,
    });
    this.records.push(record);
    this.currentState = to;
  }
}
