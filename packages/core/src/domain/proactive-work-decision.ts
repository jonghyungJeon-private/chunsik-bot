import { isAgentProfileId } from './agent-profile';
import type { AgentProfileId } from './agent-profile';
import type { Id } from './common';
import { TriggerSource } from './trigger-source';

export enum ProactiveWorkDisposition {
  CONTINUE = 'CONTINUE',
  NO_ACTION = 'NO_ACTION',
}

export enum ProactiveWorkReason {
  ACTIVE_WORK_ITEM = 'ACTIVE_WORK_ITEM',
  WORK_ITEM_COMPLETED = 'WORK_ITEM_COMPLETED',
  WORK_ITEM_CANCELED = 'WORK_ITEM_CANCELED',
}

export interface ProactiveWorkDecisionInput {
  readonly workItemId: Id;
  readonly agentProfileId: AgentProfileId;
  readonly trigger: TriggerSource;
  readonly disposition: ProactiveWorkDisposition;
  readonly reason: ProactiveWorkReason;
}

const VALID_OUTCOMES: Readonly<Record<ProactiveWorkDisposition, readonly ProactiveWorkReason[]>> =
  Object.freeze({
    [ProactiveWorkDisposition.CONTINUE]: Object.freeze([
      ProactiveWorkReason.ACTIVE_WORK_ITEM,
    ]),
    [ProactiveWorkDisposition.NO_ACTION]: Object.freeze([
      ProactiveWorkReason.WORK_ITEM_COMPLETED,
      ProactiveWorkReason.WORK_ITEM_CANCELED,
    ]),
  });

/** Immutable, non-durable result of one read-only proactive-work evaluation. */
export class ProactiveWorkDecision {
  readonly workItemId: Id;
  readonly agentProfileId: AgentProfileId;
  readonly trigger: TriggerSource;
  readonly disposition: ProactiveWorkDisposition;
  readonly reason: ProactiveWorkReason;

  constructor(input: ProactiveWorkDecisionInput) {
    if (typeof input !== 'object' || input === null) {
      throw new Error('ProactiveWorkDecision input must be an object');
    }
    if (typeof input.workItemId !== 'string' || input.workItemId.trim().length === 0) {
      throw new Error('ProactiveWorkDecision workItemId must be non-empty');
    }
    if (!isAgentProfileId(input.agentProfileId)) {
      throw new Error('Invalid ProactiveWorkDecision agentProfileId');
    }
    const trigger = new TriggerSource(input.trigger);
    if (!VALID_OUTCOMES[input.disposition]?.includes(input.reason)) {
      throw new Error('Invalid ProactiveWorkDecision outcome');
    }

    this.workItemId = input.workItemId;
    this.agentProfileId = input.agentProfileId;
    this.trigger = trigger;
    this.disposition = input.disposition;
    this.reason = input.reason;
    Object.freeze(this);
  }
}
