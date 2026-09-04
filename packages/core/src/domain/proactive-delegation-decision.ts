import { isAgentProfileId } from './agent-profile';
import type { AgentProfileId } from './agent-profile';
import type { Id } from './common';
import { TriggerSource } from './trigger-source';

export enum ProactiveDelegationDisposition {
  DELEGATE = 'DELEGATE',
  NO_ACTION = 'NO_ACTION',
}

export enum ProactiveDelegationReason {
  DELEGATABLE_ACTIVE_WORK_ITEM = 'DELEGATABLE_ACTIVE_WORK_ITEM',
  WORK_ITEM_COMPLETED = 'WORK_ITEM_COMPLETED',
  WORK_ITEM_CANCELED = 'WORK_ITEM_CANCELED',
}

export interface ProactiveDelegationDecisionInput {
  readonly workItemId: Id;
  readonly fromAgentProfileId: AgentProfileId;
  readonly toAgentProfileId: AgentProfileId;
  readonly trigger: TriggerSource;
  readonly disposition: ProactiveDelegationDisposition;
  readonly reason: ProactiveDelegationReason;
}

const VALID_OUTCOMES: Readonly<
  Record<ProactiveDelegationDisposition, readonly ProactiveDelegationReason[]>
> = Object.freeze({
  [ProactiveDelegationDisposition.DELEGATE]: Object.freeze([
    ProactiveDelegationReason.DELEGATABLE_ACTIVE_WORK_ITEM,
  ]),
  [ProactiveDelegationDisposition.NO_ACTION]: Object.freeze([
    ProactiveDelegationReason.WORK_ITEM_COMPLETED,
    ProactiveDelegationReason.WORK_ITEM_CANCELED,
  ]),
});

/** Immutable, non-durable eligibility result. It grants no execution authority. */
export class ProactiveDelegationDecision {
  readonly workItemId: Id;
  readonly fromAgentProfileId: AgentProfileId;
  readonly toAgentProfileId: AgentProfileId;
  readonly trigger: TriggerSource;
  readonly disposition: ProactiveDelegationDisposition;
  readonly reason: ProactiveDelegationReason;

  constructor(input: ProactiveDelegationDecisionInput) {
    if (typeof input !== 'object' || input === null) {
      throw new Error('ProactiveDelegationDecision input must be an object');
    }
    if (typeof input.workItemId !== 'string' || input.workItemId.trim().length === 0) {
      throw new Error('ProactiveDelegationDecision workItemId must be non-empty');
    }
    if (!isAgentProfileId(input.fromAgentProfileId) || !isAgentProfileId(input.toAgentProfileId)) {
      throw new Error('Invalid ProactiveDelegationDecision AgentProfileId');
    }
    if (input.fromAgentProfileId === input.toAgentProfileId) {
      throw new Error('ProactiveDelegationDecision AgentProfiles must differ');
    }
    if (!VALID_OUTCOMES[input.disposition]?.includes(input.reason)) {
      throw new Error('Invalid ProactiveDelegationDecision outcome');
    }

    this.workItemId = input.workItemId;
    this.fromAgentProfileId = input.fromAgentProfileId;
    this.toAgentProfileId = input.toAgentProfileId;
    this.trigger = new TriggerSource(input.trigger);
    this.disposition = input.disposition;
    this.reason = input.reason;
    Object.freeze(this);
  }
}
