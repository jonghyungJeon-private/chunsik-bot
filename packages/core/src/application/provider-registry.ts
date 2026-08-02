import { createHash } from 'node:crypto';
import { Capability } from '../domain';
import {
  AvailabilityClass,
  ConcurrencyClass,
  ContextCapacity,
  CostTier,
  ExecutionLocality,
  LatencyTier,
  ProviderAvailability,
  ProviderDescriptor,
  ProviderId,
  ProviderRegistration,
  ProviderRegistrySnapshot,
  RegisteredProviderSnapshot,
  ReliabilityTier,
  RoutingClass,
  RoutingConfigurationError,
  SupportLevel,
  TimeoutClass,
  isRoutingIdentifier,
} from './provider-routing-contracts';

const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA_256 = /^[a-f0-9]{64}$/;

const enumValues = <T extends string>(value: Record<string, T>): ReadonlySet<string> =>
  new Set(Object.values(value));

const CAPABILITIES = enumValues(Capability);
const ROUTING_CLASSES = enumValues(RoutingClass);
const RELIABILITY_TIERS = enumValues(ReliabilityTier);
const SUPPORT_LEVELS = enumValues(SupportLevel);
const CONTEXT_CAPACITIES = enumValues(ContextCapacity);
const EXECUTION_LOCALITIES = enumValues(ExecutionLocality);
const LATENCY_TIERS = enumValues(LatencyTier);
const TIMEOUT_CLASSES = enumValues(TimeoutClass);
const COST_TIERS = enumValues(CostTier);
const CONCURRENCY_CLASSES = enumValues(ConcurrencyClass);
const AVAILABILITY_CLASSES = enumValues(AvailabilityClass);
const PROVIDER_AVAILABILITIES = enumValues(ProviderAvailability);

function assertEnum(value: string, allowed: ReadonlySet<string>, field: string): void {
  if (!allowed.has(value)) throw new RoutingConfigurationError(`Invalid ${field}: ${value}`);
}

function assertVersion(value: string, field: string): void {
  if (!VERSION.test(value)) throw new RoutingConfigurationError(`Invalid ${field}`);
}

function assertOpaqueBinding(value: string, field: string): void {
  if (value.trim() !== value || value.length === 0 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new RoutingConfigurationError(`Invalid ${field}`);
  }
}

function sortedUnique<T extends string>(values: readonly T[], field: string): T[] {
  if (values.length === 0) throw new RoutingConfigurationError(`${field} must not be empty`);
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length) {
    throw new RoutingConfigurationError(`${field} must not contain duplicates`);
  }
  return sorted;
}

function freezeDescriptor(input: ProviderDescriptor): ProviderDescriptor {
  if (typeof input.enabled !== 'boolean') throw new RoutingConfigurationError('Invalid enabled flag');
  const supportedCapabilities = sortedUnique(input.capabilities.supportedCapabilities, 'supportedCapabilities');
  supportedCapabilities.forEach((value) => assertEnum(value, CAPABILITIES, 'capability'));
  const routingClasses = sortedUnique(input.capabilities.routingClasses, 'routingClasses');
  routingClasses.forEach((value) => assertEnum(value, ROUTING_CLASSES, 'routingClass'));

  assertEnum(input.capabilities.semanticReliability, RELIABILITY_TIERS, 'semanticReliability');
  assertEnum(input.capabilities.authorityReliability, RELIABILITY_TIERS, 'authorityReliability');
  assertEnum(input.capabilities.continuityReliability, RELIABILITY_TIERS, 'continuityReliability');
  assertEnum(input.capabilities.toolUse, SUPPORT_LEVELS, 'toolUse');
  assertEnum(input.capabilities.structuredOutput, SUPPORT_LEVELS, 'structuredOutput');
  assertEnum(input.capabilities.contextCapacity, CONTEXT_CAPACITIES, 'contextCapacity');
  assertEnum(input.capabilities.streaming, SUPPORT_LEVELS, 'streaming');
  assertEnum(input.capabilities.executionLocality, EXECUTION_LOCALITIES, 'executionLocality');
  assertEnum(input.operationalProfile.latencyTier, LATENCY_TIERS, 'latencyTier');
  assertEnum(input.operationalProfile.timeoutClass, TIMEOUT_CLASSES, 'timeoutClass');
  assertEnum(input.operationalProfile.costTier, COST_TIERS, 'costTier');
  assertEnum(input.operationalProfile.concurrencyClass, CONCURRENCY_CLASSES, 'concurrencyClass');
  assertEnum(input.operationalProfile.availabilityClass, AVAILABILITY_CLASSES, 'availabilityClass');
  assertOpaqueBinding(input.adapterId, 'adapterId');
  assertOpaqueBinding(input.modelId, 'modelId');
  assertVersion(input.profileVersion, 'profileVersion');
  if (input.evidenceBindingDigest !== undefined && !SHA_256.test(input.evidenceBindingDigest)) {
    throw new RoutingConfigurationError('Invalid evidenceBindingDigest');
  }

  const capabilities = Object.freeze({
    ...input.capabilities,
    supportedCapabilities: Object.freeze(supportedCapabilities),
    routingClasses: Object.freeze(routingClasses),
  });
  const operationalProfile = Object.freeze({ ...input.operationalProfile });
  return Object.freeze({ ...input, capabilities, operationalProfile });
}

function canonicalDescriptor(descriptor: ProviderDescriptor): unknown {
  return {
    providerId: descriptor.providerId,
    adapterId: descriptor.adapterId,
    modelId: descriptor.modelId,
    capabilities: {
      supportedCapabilities: [...descriptor.capabilities.supportedCapabilities],
      routingClasses: [...descriptor.capabilities.routingClasses],
      semanticReliability: descriptor.capabilities.semanticReliability,
      authorityReliability: descriptor.capabilities.authorityReliability,
      continuityReliability: descriptor.capabilities.continuityReliability,
      toolUse: descriptor.capabilities.toolUse,
      structuredOutput: descriptor.capabilities.structuredOutput,
      contextCapacity: descriptor.capabilities.contextCapacity,
      streaming: descriptor.capabilities.streaming,
      executionLocality: descriptor.capabilities.executionLocality,
    },
    operationalProfile: {
      latencyTier: descriptor.operationalProfile.latencyTier,
      timeoutClass: descriptor.operationalProfile.timeoutClass,
      costTier: descriptor.operationalProfile.costTier,
      concurrencyClass: descriptor.operationalProfile.concurrencyClass,
      availabilityClass: descriptor.operationalProfile.availabilityClass,
    },
    enabled: descriptor.enabled,
    profileVersion: descriptor.profileVersion,
    evidenceBindingDigest: descriptor.evidenceBindingDigest ?? null,
  };
}

function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Descriptor-only registry. Executable AiProvider bindings belong to a later Gateway slice. */
export class ProviderRegistry {
  private readonly descriptors: readonly ProviderDescriptor[];
  readonly version: string;
  readonly configurationDigest: string;

  constructor(version: string, registrations: readonly ProviderRegistration[]) {
    assertVersion(version, 'registryVersion');
    if (registrations.length === 0) throw new RoutingConfigurationError('Provider registry must not be empty');

    const seen = new Set<string>();
    const descriptors = registrations.map((registration) => {
      if (!isRoutingIdentifier(registration.providerId)) {
        throw new RoutingConfigurationError('Invalid providerId');
      }
      if (!isRoutingIdentifier(registration.descriptor.adapterId)) {
        throw new RoutingConfigurationError('Invalid adapterId');
      }
      if (registration.providerId !== registration.descriptor.providerId) {
        throw new RoutingConfigurationError('Descriptor/provider binding mismatch');
      }
      if (seen.has(registration.providerId)) {
        throw new RoutingConfigurationError(`Duplicate providerId: ${registration.providerId}`);
      }
      seen.add(registration.providerId);
      return freezeDescriptor(registration.descriptor);
    });
    descriptors.sort((a, b) => a.providerId.localeCompare(b.providerId));

    this.version = version;
    this.descriptors = Object.freeze(descriptors);
    this.configurationDigest = sha256Canonical({
      version,
      providers: this.descriptors.map(canonicalDescriptor),
    });
    Object.freeze(this);
  }

  all(): readonly ProviderDescriptor[] {
    return this.descriptors;
  }

  enabled(): readonly ProviderDescriptor[] {
    return Object.freeze(this.descriptors.filter((descriptor) => descriptor.enabled));
  }

  get(id: ProviderId): ProviderDescriptor | undefined {
    return this.descriptors.find((descriptor) => descriptor.providerId === id);
  }

  snapshot(availability: Readonly<Record<string, ProviderAvailability>> = {}): ProviderRegistrySnapshot {
    const knownIds = new Set(this.descriptors.map((descriptor) => descriptor.providerId));
    for (const [id, value] of Object.entries(availability)) {
      if (!knownIds.has(id as ProviderId)) {
        throw new RoutingConfigurationError(`Availability references unknown providerId: ${id}`);
      }
      assertEnum(value, PROVIDER_AVAILABILITIES, 'providerAvailability');
    }
    const providers: RegisteredProviderSnapshot[] = this.descriptors.map((descriptor) =>
      Object.freeze({
        descriptor,
        availability: availability[descriptor.providerId] ?? ProviderAvailability.UNKNOWN,
      }),
    );
    return Object.freeze({
      version: this.version,
      configurationDigest: this.configurationDigest,
      providers: Object.freeze(providers),
    });
  }
}
