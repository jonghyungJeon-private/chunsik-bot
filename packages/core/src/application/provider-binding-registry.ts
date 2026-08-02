import { createHash } from 'node:crypto';
import type { AiProvider } from '../ports';
import {
  AdapterId,
  ProviderId,
  ProviderRegistrySnapshot,
  RoutingConfigurationError,
  isRoutingIdentifier,
} from './provider-routing-contracts';

const SHA_256 = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export enum ProviderBindingFailureCode {
  INVALID_PROVIDER_BINDING = 'INVALID_PROVIDER_BINDING',
  DUPLICATE_PROVIDER_BINDING = 'DUPLICATE_PROVIDER_BINDING',
  UNKNOWN_PROVIDER_BINDING = 'UNKNOWN_PROVIDER_BINDING',
  PROVIDER_BINDING_NOT_FOUND = 'PROVIDER_BINDING_NOT_FOUND',
  PROVIDER_BINDING_MISMATCH = 'PROVIDER_BINDING_MISMATCH',
  PROVIDER_DISABLED = 'PROVIDER_DISABLED',
  ROUTING_CONFIGURATION_MISMATCH = 'ROUTING_CONFIGURATION_MISMATCH',
}

export class ProviderBindingConfigurationError extends RoutingConfigurationError {
  constructor(
    readonly code: ProviderBindingFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderBindingConfigurationError';
  }
}

export interface ExecutableProviderBinding {
  providerId: ProviderId;
  adapterId: AdapterId;
  modelId: string;
  bindingVersion: string;
  provider: AiProvider;
}

export interface ProviderBindingIdentity {
  providerId: ProviderId;
  bindingVersion: string;
  bindingDigest: string;
}

export interface ValidatedExecutableProviderBinding {
  providerId: ProviderId;
  identity: ProviderBindingIdentity;
  provider: AiProvider;
}

interface DescriptorBindingFacts {
  providerId: ProviderId;
  adapterId: AdapterId;
  modelId: string;
  profileVersion: string;
  enabled: boolean;
}

function fail(code: ProviderBindingFailureCode, message: string): never {
  throw new ProviderBindingConfigurationError(code, message);
}

function validOpaque(value: string): boolean {
  return value.trim() === value && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

function bindingDigest(binding: ExecutableProviderBinding, descriptor: DescriptorBindingFacts): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        providerId: binding.providerId,
        adapterId: binding.adapterId,
        modelId: binding.modelId,
        bindingVersion: binding.bindingVersion,
        profileVersion: descriptor.profileVersion,
      }),
    )
    .digest('hex');
}

/** Immutable executable bindings validated against one descriptor snapshot. */
export class ProviderBindingRegistry {
  private readonly bindings: readonly ValidatedExecutableProviderBinding[];
  readonly registryVersion: string;
  readonly registryConfigurationDigest: string;

  constructor(snapshot: ProviderRegistrySnapshot, bindings: readonly ExecutableProviderBinding[]) {
    if (!VERSION.test(snapshot.version) || !SHA_256.test(snapshot.configurationDigest)) {
      fail(ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Invalid Provider Registry identity');
    }
    if (bindings.length === 0) {
      fail(ProviderBindingFailureCode.INVALID_PROVIDER_BINDING, 'Provider binding registry must not be empty');
    }

    const descriptors = new Map<ProviderId, DescriptorBindingFacts>();
    for (const entry of snapshot.providers) {
      const descriptor = entry.descriptor;
      if (
        !isRoutingIdentifier(descriptor.providerId) ||
        !isRoutingIdentifier(descriptor.adapterId) ||
        !validOpaque(descriptor.modelId) ||
        !VERSION.test(descriptor.profileVersion) ||
        typeof descriptor.enabled !== 'boolean' ||
        descriptors.has(descriptor.providerId)
      ) {
        fail(ProviderBindingFailureCode.ROUTING_CONFIGURATION_MISMATCH, 'Invalid descriptor snapshot identity');
      }
      descriptors.set(
        descriptor.providerId,
        Object.freeze({
          providerId: descriptor.providerId,
          adapterId: descriptor.adapterId,
          modelId: descriptor.modelId,
          profileVersion: descriptor.profileVersion,
          enabled: descriptor.enabled,
        }),
      );
    }

    const seen = new Set<string>();
    const validated = bindings.map((binding): ValidatedExecutableProviderBinding => {
      if (
        !isRoutingIdentifier(binding.providerId) ||
        !isRoutingIdentifier(binding.adapterId) ||
        !VERSION.test(binding.bindingVersion) ||
        !validOpaque(binding.modelId) ||
        typeof binding.provider?.id !== 'string'
      ) {
        fail(ProviderBindingFailureCode.INVALID_PROVIDER_BINDING, 'Invalid executable Provider binding');
      }
      if (seen.has(binding.providerId)) {
        fail(ProviderBindingFailureCode.DUPLICATE_PROVIDER_BINDING, 'Duplicate executable Provider binding');
      }
      seen.add(binding.providerId);

      const descriptor = descriptors.get(binding.providerId);
      if (!descriptor) {
        fail(ProviderBindingFailureCode.UNKNOWN_PROVIDER_BINDING, 'Executable binding has no descriptor');
      }
      if (!descriptor.enabled) {
        fail(ProviderBindingFailureCode.PROVIDER_DISABLED, 'Disabled Provider cannot be executable');
      }
      if (
        descriptor.providerId !== binding.providerId ||
        binding.provider.id !== binding.providerId ||
        descriptor.adapterId !== binding.adapterId ||
        descriptor.modelId !== binding.modelId
      ) {
        fail(ProviderBindingFailureCode.PROVIDER_BINDING_MISMATCH, 'Executable Provider binding mismatch');
      }

      const identity = Object.freeze({
        providerId: binding.providerId,
        bindingVersion: binding.bindingVersion,
        bindingDigest: bindingDigest(binding, descriptor),
      });
      return Object.freeze({ providerId: binding.providerId, identity, provider: binding.provider });
    });

    validated.sort((a, b) => a.providerId.localeCompare(b.providerId));
    this.registryVersion = snapshot.version;
    this.registryConfigurationDigest = snapshot.configurationDigest;
    this.bindings = Object.freeze(validated);
    Object.freeze(this);
  }

  all(): readonly ValidatedExecutableProviderBinding[] {
    return this.bindings;
  }

  get(id: ProviderId): ValidatedExecutableProviderBinding | undefined {
    return this.bindings.find((binding) => binding.providerId === id);
  }

  matchesSnapshot(snapshot: ProviderRegistrySnapshot): boolean {
    return (
      snapshot.version === this.registryVersion &&
      snapshot.configurationDigest === this.registryConfigurationDigest
    );
  }
}
