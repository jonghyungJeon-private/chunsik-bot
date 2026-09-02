import {
  MAX_AGENT_PROFILE_DISPLAY_NAME_CHARACTERS,
  MAX_AGENT_PROFILE_INSTRUCTIONS_CHARACTERS,
  MAX_AGENT_PROFILE_PURPOSE_CHARACTERS,
  MAX_AGENT_PROFILE_ROLE_CHARACTERS,
  isAgentProfileId,
  type AgentProfile,
  type AgentProfileId,
} from '../domain';

export class AgentProfileConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentProfileConfigurationError';
  }
}

function requireBoundedText(value: string, field: string, maximum: number): string {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || value.length > maximum
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  ) {
    throw new AgentProfileConfigurationError(`Invalid AgentProfile ${field}`);
  }
  return value;
}

function immutableProfile(input: AgentProfile): AgentProfile {
  if (typeof input !== 'object' || input === null || !isAgentProfileId(input.id)) {
    throw new AgentProfileConfigurationError('Invalid AgentProfile id');
  }
  return Object.freeze({
    id: input.id,
    displayName: requireBoundedText(
      input.displayName,
      'displayName',
      MAX_AGENT_PROFILE_DISPLAY_NAME_CHARACTERS,
    ),
    role: requireBoundedText(input.role, 'role', MAX_AGENT_PROFILE_ROLE_CHARACTERS),
    purpose: requireBoundedText(input.purpose, 'purpose', MAX_AGENT_PROFILE_PURPOSE_CHARACTERS),
    instructions: requireBoundedText(
      input.instructions,
      'instructions',
      MAX_AGENT_PROFILE_INSTRUCTIONS_CHARACTERS,
    ),
  });
}

/** Deterministic immutable registry of composition-time AgentProfile configuration. */
export class AgentProfileRegistry {
  private readonly profiles: readonly AgentProfile[];
  private readonly profilesById: ReadonlyMap<AgentProfileId, AgentProfile>;

  constructor(configurations: readonly AgentProfile[] = []) {
    if (!Array.isArray(configurations)) {
      throw new AgentProfileConfigurationError('AgentProfile registry configuration must be an array');
    }

    const seen = new Set<string>();
    const profiles = configurations.map((configuration) => {
      const profile = immutableProfile(configuration);
      if (seen.has(profile.id)) {
        throw new AgentProfileConfigurationError(`Duplicate AgentProfile id: ${profile.id}`);
      }
      seen.add(profile.id);
      return profile;
    });
    profiles.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

    this.profiles = Object.freeze(profiles);
    this.profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
    Object.freeze(this);
  }

  get(id: AgentProfileId): AgentProfile {
    const profile = this.profilesById.get(id);
    if (!profile) throw new AgentProfileConfigurationError('Unknown AgentProfile id');
    return profile;
  }

  list(): readonly AgentProfile[] {
    return this.profiles;
  }
}
