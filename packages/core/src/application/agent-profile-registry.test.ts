import { describe, expect, it } from 'vitest';
import {
  MAX_AGENT_PROFILE_DISPLAY_NAME_CHARACTERS,
  MAX_AGENT_PROFILE_INSTRUCTIONS_CHARACTERS,
  MAX_AGENT_PROFILE_PURPOSE_CHARACTERS,
  MAX_AGENT_PROFILE_ROLE_CHARACTERS,
  agentProfileId,
  type AgentProfile,
} from '../domain';
import { AgentProfileConfigurationError, AgentProfileRegistry } from './agent-profile-registry';

function profile(id = 'builder'): AgentProfile {
  return {
    id: agentProfileId(id),
    displayName: 'Builder',
    role: 'implementation specialist',
    purpose: 'Implement one bounded task.',
    instructions: 'Follow the approved scope and validate the result.',
  };
}

describe('AgentProfileRegistry', () => {
  it('accepts a valid profile and lists profiles deterministically by stable identity', () => {
    const registry = new AgentProfileRegistry([
      profile('z'),
      profile('I'),
      profile('i'),
      profile('Z'),
      profile('alpha'),
    ]);

    expect(registry.list().map(({ id }) => id)).toEqual(['I', 'Z', 'alpha', 'i', 'z']);
    expect(registry.get(agentProfileId('alpha'))).toEqual(profile('alpha'));
  });

  it('accepts an empty registry without creating a fallback AgentProfile', () => {
    const registry = new AgentProfileRegistry();

    expect(registry.list()).toEqual([]);
  });

  it('rejects duplicate identity atomically', () => {
    expect(() => new AgentProfileRegistry([profile('same'), profile('same')])).toThrow(
      new AgentProfileConfigurationError('Duplicate AgentProfile id: same'),
    );
  });

  it.each(['', ' leading', 'trailing ', 'invalid/id', 'x'.repeat(129)])(
    'rejects invalid AgentProfileId %j',
    (value) => expect(() => agentProfileId(value)).toThrow('Invalid AgentProfileId'),
  );

  it('revalidates identity during atomic registry construction', () => {
    const invalid = { ...profile(), id: 'invalid/id' } as AgentProfile;

    expect(() => new AgentProfileRegistry([profile('valid'), invalid])).toThrow(
      new AgentProfileConfigurationError('Invalid AgentProfile id'),
    );
  });

  it.each([123, { toString: () => 'builder' }])(
    'rejects runtime non-string identity without coercion: %j',
    (id) => {
      const invalid = { ...profile(), id } as unknown as AgentProfile;
      expect(() => new AgentProfileRegistry([invalid])).toThrow(
        new AgentProfileConfigurationError('Invalid AgentProfile id'),
      );
    },
  );

  it.each([
    ['displayName', '', MAX_AGENT_PROFILE_DISPLAY_NAME_CHARACTERS],
    ['role', ' ', MAX_AGENT_PROFILE_ROLE_CHARACTERS],
    ['purpose', '\u0000', MAX_AGENT_PROFILE_PURPOSE_CHARACTERS],
    ['instructions', '\u007f', MAX_AGENT_PROFILE_INSTRUCTIONS_CHARACTERS],
  ] as const)('rejects invalid or empty %s', (field, value) => {
    expect(() => new AgentProfileRegistry([{ ...profile(), [field]: value }])).toThrow(
      `Invalid AgentProfile ${field}`,
    );
  });

  it.each([
    ['displayName', MAX_AGENT_PROFILE_DISPLAY_NAME_CHARACTERS],
    ['role', MAX_AGENT_PROFILE_ROLE_CHARACTERS],
    ['purpose', MAX_AGENT_PROFILE_PURPOSE_CHARACTERS],
    ['instructions', MAX_AGENT_PROFILE_INSTRUCTIONS_CHARACTERS],
  ] as const)('accepts %s at its explicit bound and rejects one character beyond it', (field, maximum) => {
    expect(() => new AgentProfileRegistry([{ ...profile(), [field]: 'x'.repeat(maximum) }])).not.toThrow();
    expect(() => new AgentProfileRegistry([{ ...profile(), [field]: 'x'.repeat(maximum + 1) }])).toThrow(
      `Invalid AgentProfile ${field}`,
    );
  });

  it('fails unknown lookup closed with a bounded deterministic error', () => {
    const registry = new AgentProfileRegistry([profile()]);

    expect(() => registry.get(agentProfileId('unknown'))).toThrow(
      new AgentProfileConfigurationError('Unknown AgentProfile id'),
    );
  });

  it('defensively copies and freezes caller-owned configuration and returned values', () => {
    const mutable = profile() as { -readonly [K in keyof AgentProfile]: AgentProfile[K] };
    const configurations = [mutable];
    const registry = new AgentProfileRegistry(configurations);
    const stored = registry.get(agentProfileId('builder'));

    mutable.displayName = 'Changed outside';
    configurations.push(profile('second'));

    expect(stored.displayName).toBe('Builder');
    expect(registry.list()).toHaveLength(1);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(registry.list())).toBe(true);
    expect(() => {
      (stored as { displayName: string }).displayName = 'Changed through return value';
    }).toThrow(TypeError);
    expect(registry.get(agentProfileId('builder')).displayName).toBe('Builder');
  });
});
