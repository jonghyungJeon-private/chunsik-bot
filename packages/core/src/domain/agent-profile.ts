declare const agentProfileIdBrand: unique symbol;

/** Stable QuirkyBot-owned identity for an AgentProfile configuration value. */
export type AgentProfileId = string & { readonly [agentProfileIdBrand]: true };

export const MAX_AGENT_PROFILE_ID_CHARACTERS = 128;
export const MAX_AGENT_PROFILE_DISPLAY_NAME_CHARACTERS = 128;
export const MAX_AGENT_PROFILE_ROLE_CHARACTERS = 128;
export const MAX_AGENT_PROFILE_PURPOSE_CHARACTERS = 1_024;
export const MAX_AGENT_PROFILE_INSTRUCTIONS_CHARACTERS = 16_384;

const AGENT_PROFILE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Configuration-only value; it is not an Actor, Provider, aggregate, or authority grant. */
export interface AgentProfile {
  readonly id: AgentProfileId;
  readonly displayName: string;
  readonly role: string;
  readonly purpose: string;
  readonly instructions: string;
}

export function isAgentProfileId(value: unknown): value is AgentProfileId {
  return typeof value === 'string' && AGENT_PROFILE_IDENTIFIER.test(value);
}

export function agentProfileId(value: string): AgentProfileId {
  if (!isAgentProfileId(value)) {
    throw new Error('Invalid AgentProfileId');
  }
  return value as AgentProfileId;
}
