import type { AiProvider } from '../ports';
import {
  ProviderId,
  RoutingConfigurationError,
  isRoutingIdentifier,
} from './provider-routing-contracts';

export interface ExecutableProviderBinding {
  providerId: ProviderId;
  provider: AiProvider;
}

/** Immutable binding container; Provider instances themselves remain adapter-owned. */
export class ProviderBindingRegistry {
  private readonly bindings: readonly ExecutableProviderBinding[];

  constructor(bindings: readonly ExecutableProviderBinding[]) {
    if (bindings.length === 0) {
      throw new RoutingConfigurationError('Provider binding registry must not be empty');
    }
    const seen = new Set<string>();
    const validated = bindings.map((binding) => {
      if (!isRoutingIdentifier(binding.providerId)) {
        throw new RoutingConfigurationError('Invalid executable providerId');
      }
      if (binding.provider.id !== binding.providerId) {
        throw new RoutingConfigurationError('Executable Provider binding mismatch');
      }
      if (seen.has(binding.providerId)) {
        throw new RoutingConfigurationError(`Duplicate executable providerId: ${binding.providerId}`);
      }
      seen.add(binding.providerId);
      return Object.freeze({ ...binding });
    });
    validated.sort((a, b) => a.providerId.localeCompare(b.providerId));
    this.bindings = Object.freeze(validated);
    Object.freeze(this);
  }

  all(): readonly ExecutableProviderBinding[] {
    return this.bindings;
  }

  get(id: ProviderId): AiProvider | undefined {
    return this.bindings.find((binding) => binding.providerId === id)?.provider;
  }
}
