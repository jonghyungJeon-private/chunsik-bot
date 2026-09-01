import { describe, expect, it } from 'vitest';
import type { Actor, ActorRepository, ConnectorProvider, Id, StorageProvider } from '@chunsik/core';
import { WorkSurfaceQuery } from '@chunsik/core';
import type { ActorIdentityMapping } from './config';
import { ActorIdentityProvisioner } from './actor-identity-provisioner';

const createdAt = '2026-09-01T00:00:00.000Z';

function actor(id: string, discordId: string, identities: Actor['identities'] = []): Actor {
  return { id, displayName: id, identities: [{ platform: 'discord', externalId: discordId }, ...identities], createdAt };
}

class FakeActorRepository implements ActorRepository {
  readonly values = new Map<Id, Actor>();
  saveCount = 0;

  constructor(actors: readonly Actor[]) {
    for (const value of actors) this.values.set(value.id, structuredClone(value));
  }

  async get(id: Id): Promise<Actor | null> { return this.values.get(id) ?? null; }
  async save(value: Actor): Promise<Actor> {
    this.saveCount += 1;
    this.values.set(value.id, structuredClone(value));
    return value;
  }
  async delete(id: Id): Promise<void> { this.values.delete(id); }
  async list(): Promise<Actor[]> { return [...this.values.values()]; }
  async findByExternalIdentity(platform: string, externalId: string): Promise<Actor | null> {
    return [...this.values.values()].find((value) =>
      value.identities.some((identity) => identity.platform === platform && identity.externalId === externalId)) ?? null;
  }
}

function provisioner(repository: FakeActorRepository, mappings: readonly ActorIdentityMapping[]): ActorIdentityProvisioner {
  return new ActorIdentityProvisioner({ actors: repository } as unknown as StorageProvider, mappings);
}

function mapping(discordId: string, identities: ActorIdentityMapping['identities']): ActorIdentityMapping {
  return { actor: { platform: 'discord', externalId: discordId }, identities };
}

function connector(source: 'jira' | 'github', available = true): ConnectorProvider {
  return {
    source,
    readOnly: true,
    async isAvailable() { return available; },
    async query(input) {
      const externalId = input.params?.actorExternalId;
      return { source, items: [{ id: `${source}-item`, title: `${source}:${String(externalId)}` }] };
    },
  };
}

describe('ActorIdentityProvisioner', () => {
  it.each([
    ['Jira-only', { jira: 'jira-user' }, ['jira:jira-item']],
    ['GitHub-only', { github: 'octocat' }, ['github:github-item']],
    ['merged', { jira: 'jira-user', github: 'octocat' }, ['github:github-item', 'jira:jira-item']],
  ] as const)('makes the %s personal Work Surface reachable offline', async (_case, identities, expected) => {
    const repository = new FakeActorRepository([actor('actor-1', 'discord-1')]);
    await provisioner(repository, [mapping('discord-1', identities)]).provision();
    const provisioned = await repository.get('actor-1');
    const surface = await new WorkSurfaceQuery({ list: () => [connector('jira'), connector('github')] })
      .forActor(provisioned!);
    expect(surface.items.map((item) => item.resource.identity)).toEqual(expected);
    expect(surface.sources.filter((source) => source.status === 'AVAILABLE').map((source) => source.source))
      .toEqual(Object.keys(identities));
  });

  it('preserves omitted and inbound identities and repeated identical provisioning is an idempotent no-op', async () => {
    const repository = new FakeActorRepository([
      actor('actor-1', 'discord-1', [{ platform: 'jira', externalId: 'stored-jira' }]),
    ]);
    const service = provisioner(repository, [mapping('discord-1', { github: 'octocat' })]);
    await service.provision();
    await service.provision();
    expect((await repository.get('actor-1'))?.identities).toEqual([
      { platform: 'discord', externalId: 'discord-1' },
      { platform: 'jira', externalId: 'stored-jira' },
      { platform: 'github', externalId: 'octocat' },
    ]);
    expect(repository.saveCount).toBe(1);
  });

  it('preflights every mapping before writes and fails closed on a same-Actor platform conflict', async () => {
    const repository = new FakeActorRepository([
      actor('actor-1', 'discord-1', [{ platform: 'jira', externalId: 'stored-jira' }]),
    ]);
    await expect(provisioner(repository, [mapping('discord-1', { jira: 'different-jira' })]).provision())
      .rejects.toThrow('ACTOR_IDENTITY_PROVISIONING_PLATFORM_CONFLICT:jira');
    expect(repository.saveCount).toBe(0);
  });

  it('fails closed when the target identity belongs to another Actor', async () => {
    const repository = new FakeActorRepository([
      actor('actor-1', 'discord-1'),
      actor('actor-2', 'discord-2', [{ platform: 'github', externalId: 'octocat' }]),
    ]);
    await expect(provisioner(repository, [mapping('discord-1', { github: 'octocat' })]).provision())
      .rejects.toThrow('ACTOR_IDENTITY_PROVISIONING_TARGET_CONFLICT:github:octocat');
    expect(repository.saveCount).toBe(0);
  });

  it('fails closed and never creates an Actor when the configured Discord Actor is absent', async () => {
    const repository = new FakeActorRepository([]);
    await expect(provisioner(repository, [mapping('missing', { jira: 'jira-user' })]).provision())
      .rejects.toThrow('ACTOR_IDENTITY_PROVISIONING_ACTOR_NOT_FOUND:discord:missing');
    expect(await repository.list()).toEqual([]);
    expect(repository.saveCount).toBe(0);
  });

  it('keeps connector availability failures separate from identity provisioning failures', async () => {
    const repository = new FakeActorRepository([actor('actor-1', 'discord-1')]);
    await provisioner(repository, [mapping('discord-1', { jira: 'jira-user', github: 'octocat' })]).provision();
    const surface = await new WorkSurfaceQuery({ list: () => [connector('jira'), connector('github', false)] })
      .forActor((await repository.get('actor-1'))!);
    expect(surface.sources).toEqual([
      expect.objectContaining({ source: 'jira', status: 'AVAILABLE' }),
      expect.objectContaining({ source: 'github', status: 'UNAVAILABLE' }),
    ]);
    expect(surface.sources.every((source) => source.status !== 'IDENTITY_MISSING')).toBe(true);
  });
});
