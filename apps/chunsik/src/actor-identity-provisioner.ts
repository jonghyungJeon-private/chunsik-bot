import type { Actor, ExternalIdentity, StorageProvider } from '@chunsik/core';
import type { ActorIdentityMapping } from './config';

/** App-private startup service for explicit, additive links to existing Actors. */
export class ActorIdentityProvisioner {
  constructor(
    private readonly storage: StorageProvider,
    private readonly mappings: readonly ActorIdentityMapping[],
  ) {}

  async provision(): Promise<void> {
    const plans = new Map<string, { actor: Actor; additions: ExternalIdentity[]; targets: Map<string, string> }>();
    const claimedTargets = new Map<string, string>();

    for (const mapping of this.mappings) {
      const actor = await this.storage.actors.findByExternalIdentity(
        mapping.actor.platform,
        mapping.actor.externalId,
      );
      if (!actor) {
        throw new Error(`ACTOR_IDENTITY_PROVISIONING_ACTOR_NOT_FOUND:discord:${mapping.actor.externalId}`);
      }
      const plan = plans.get(actor.id) ?? { actor, additions: [], targets: new Map<string, string>() };
      plans.set(actor.id, plan);

      for (const platform of ['jira', 'github'] as const) {
        const externalId = mapping.identities[platform];
        if (externalId === undefined) continue;
        const planned = plan.targets.get(platform);
        if (planned !== undefined && planned !== externalId) {
          throw new Error(`ACTOR_IDENTITY_PROVISIONING_PLATFORM_CONFLICT:${platform}`);
        }
        plan.targets.set(platform, externalId);

        const existingForPlatform = actor.identities.filter((identity) => identity.platform === platform);
        if (existingForPlatform.some((identity) => identity.externalId !== externalId)) {
          throw new Error(`ACTOR_IDENTITY_PROVISIONING_PLATFORM_CONFLICT:${platform}`);
        }

        const targetKey = `${platform}\u0000${externalId}`;
        const claimedBy = claimedTargets.get(targetKey);
        if (claimedBy !== undefined && claimedBy !== actor.id) {
          throw new Error(`ACTOR_IDENTITY_PROVISIONING_TARGET_CONFLICT:${platform}:${externalId}`);
        }
        claimedTargets.set(targetKey, actor.id);

        const owner = await this.storage.actors.findByExternalIdentity(platform, externalId);
        if (owner && owner.id !== actor.id) {
          throw new Error(`ACTOR_IDENTITY_PROVISIONING_TARGET_CONFLICT:${platform}:${externalId}`);
        }
        if (!existingForPlatform.some((identity) => identity.externalId === externalId)
          && !plan.additions.some((identity) => identity.platform === platform && identity.externalId === externalId)) {
          plan.additions.push({ platform, externalId });
        }
      }
    }

    // All mappings are preflighted before the first write, so configuration conflicts cannot partially apply.
    for (const plan of [...plans.values()].sort((left, right) => left.actor.id.localeCompare(right.actor.id))) {
      if (plan.additions.length === 0) continue;
      await this.storage.actors.save({
        ...plan.actor,
        identities: [...plan.actor.identities, ...plan.additions],
      });
    }
  }
}
