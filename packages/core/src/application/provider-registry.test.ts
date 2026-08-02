import { describe, expect, it } from 'vitest';
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
  ReliabilityTier,
  RoutingClass,
  RoutingConfigurationError,
  SupportLevel,
  TimeoutClass,
  adapterId,
  providerId,
} from './provider-routing-contracts';
import { ProviderRegistry } from './provider-registry';

const EVIDENCE = 'a'.repeat(64);

function descriptor(
  id: string,
  options: {
    modelId?: string;
    enabled?: boolean;
    capabilities?: readonly Capability[];
    routingClasses?: readonly RoutingClass[];
    evidenceBindingDigest?: string;
  } = {},
): ProviderDescriptor {
  return {
    providerId: providerId(id),
    adapterId: adapterId('local-text-adapter'),
    modelId: options.modelId ?? `opaque-${id}`,
    capabilities: {
      supportedCapabilities: options.capabilities ?? [Capability.GENERAL_CHAT],
      routingClasses: options.routingClasses ?? [RoutingClass.BALANCED],
      semanticReliability: ReliabilityTier.STANDARD,
      authorityReliability: ReliabilityTier.STANDARD,
      continuityReliability: ReliabilityTier.STANDARD,
      toolUse: SupportLevel.UNSUPPORTED,
      structuredOutput: SupportLevel.SUPPORTED,
      contextCapacity: ContextCapacity.MEDIUM,
      streaming: SupportLevel.UNSUPPORTED,
      executionLocality: ExecutionLocality.LOCAL,
    },
    operationalProfile: {
      latencyTier: LatencyTier.BALANCED,
      timeoutClass: TimeoutClass.STANDARD,
      costTier: CostTier.LOW,
      concurrencyClass: ConcurrencyClass.LIMITED,
      availabilityClass: AvailabilityClass.LOCAL_STABLE,
    },
    enabled: options.enabled ?? true,
    profileVersion: 'profile-v1',
    ...(options.evidenceBindingDigest ? { evidenceBindingDigest: options.evidenceBindingDigest } : {}),
  };
}

const registration = (value: ProviderDescriptor) => ({ providerId: value.providerId, descriptor: value });

describe('ProviderRegistry', () => {
  it('constructs a validated descriptor-only registry with lookup and enabled enumeration', () => {
    const active = descriptor('provider-b', { evidenceBindingDigest: EVIDENCE });
    const disabled = descriptor('provider-a', { enabled: false });
    const registry = new ProviderRegistry('registry-v1', [registration(active), registration(disabled)]);

    expect(registry.all().map((value) => value.providerId)).toEqual(['provider-a', 'provider-b']);
    expect(registry.enabled().map((value) => value.providerId)).toEqual(['provider-b']);
    expect(registry.get(providerId('provider-b'))).toEqual(active);
    expect(registry.configurationDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects an empty registry, duplicate ids, and descriptor/provider mismatches', () => {
    expect(() => new ProviderRegistry('registry-v1', [])).toThrow(RoutingConfigurationError);
    const value = descriptor('provider-a');
    expect(() => new ProviderRegistry('registry-v1', [registration(value), registration(value)])).toThrow(
      /Duplicate providerId/,
    );
    expect(
      () =>
        new ProviderRegistry('registry-v1', [
          { providerId: providerId('provider-b'), descriptor: value },
        ]),
    ).toThrow(/mismatch/);
  });

  it('rejects invalid binding fields, enum values, versions, and evidence digests', () => {
    expect(() => new ProviderRegistry('', [registration(descriptor('provider-a'))])).toThrow(/registryVersion/);
    expect(() =>
      new ProviderRegistry('registry-v1', [
        registration({ ...descriptor('provider-a'), modelId: '' }),
      ]),
    ).toThrow(/modelId/);
    expect(() =>
      new ProviderRegistry('registry-v1', [
        registration({ ...descriptor('provider-a'), profileVersion: 'bad version' }),
      ]),
    ).toThrow(/profileVersion/);
    expect(() =>
      new ProviderRegistry('registry-v1', [
        registration({ ...descriptor('provider-a'), enabled: 'yes' as unknown as boolean }),
      ]),
    ).toThrow(/enabled/);
    expect(() =>
      new ProviderRegistry('registry-v1', [
        registration(descriptor('provider-a', { evidenceBindingDigest: 'not-a-digest' })),
      ]),
    ).toThrow(/evidenceBindingDigest/);
    const invalid = descriptor('provider-a');
    invalid.capabilities.semanticReliability = 'BEST' as ReliabilityTier;
    expect(() => new ProviderRegistry('registry-v1', [registration(invalid)])).toThrow(/semanticReliability/);
  });

  it('deep-freezes descriptors and snapshots', () => {
    const registry = new ProviderRegistry('registry-v1', [registration(descriptor('provider-a'))]);
    const snapshot = registry.snapshot({ 'provider-a': ProviderAvailability.AVAILABLE });

    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.all())).toBe(true);
    expect(Object.isFrozen(registry.all()[0])).toBe(true);
    expect(Object.isFrozen(registry.all()[0]?.capabilities.supportedCapabilities)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.providers)).toBe(true);
    expect(Object.isFrozen(snapshot.providers[0])).toBe(true);
  });

  it('normalizes registration and semantically unordered capability/class arrays for a stable digest', () => {
    const firstA = descriptor('provider-a', {
      capabilities: [Capability.SUMMARIZATION, Capability.GENERAL_CHAT],
      routingClasses: [RoutingClass.SEMANTIC_HIGH, RoutingClass.BALANCED],
    });
    const firstB = descriptor('provider-b');
    const secondA = descriptor('provider-a', {
      capabilities: [Capability.GENERAL_CHAT, Capability.SUMMARIZATION],
      routingClasses: [RoutingClass.BALANCED, RoutingClass.SEMANTIC_HIGH],
    });
    const secondB = descriptor('provider-b');
    const first = new ProviderRegistry('registry-v1', [registration(firstB), registration(firstA)]);
    const second = new ProviderRegistry('registry-v1', [registration(secondA), registration(secondB)]);

    expect(first.configurationDigest).toBe(second.configurationDigest);
    expect(first.all().map((value) => value.providerId)).toEqual(second.all().map((value) => value.providerId));
  });

  it('changes the digest when a provider binding or capability profile changes', () => {
    const original = new ProviderRegistry('registry-v1', [registration(descriptor('provider-a'))]);
    const changedModel = new ProviderRegistry('registry-v1', [
      registration(descriptor('provider-a', { modelId: 'opaque-revision-2' })),
    ]);
    const changedProfile = new ProviderRegistry('registry-v1', [
      registration(descriptor('provider-a', { routingClasses: [RoutingClass.SEMANTIC_HIGH] })),
    ]);
    expect(changedModel.configurationDigest).not.toBe(original.configurationDigest);
    expect(changedProfile.configurationDigest).not.toBe(original.configurationDigest);
  });

  it('locks the canonical registry digest test vector', () => {
    const registry = new ProviderRegistry('registry-v1', [registration(descriptor('provider-a'))]);
    expect(registry.configurationDigest).toBe(
      '27fd8e70563d2f4981f53446b346c83deb5d13285366501895479c3d9550d6d8',
    );
  });

  it('keeps runtime availability outside the configuration digest', () => {
    const registry = new ProviderRegistry('registry-v1', [registration(descriptor('provider-a'))]);
    const available = registry.snapshot({ 'provider-a': ProviderAvailability.AVAILABLE });
    const unavailable = registry.snapshot({ 'provider-a': ProviderAvailability.UNAVAILABLE });
    expect(available.configurationDigest).toBe(unavailable.configurationDigest);
    expect(available.providers[0]?.availability).toBe(ProviderAvailability.AVAILABLE);
    expect(unavailable.providers[0]?.availability).toBe(ProviderAvailability.UNAVAILABLE);
  });

  it('rejects an invalid availability snapshot enum', () => {
    const registry = new ProviderRegistry('registry-v1', [registration(descriptor('provider-a'))]);
    expect(() => registry.snapshot({ 'provider-a': 'MAYBE' as ProviderAvailability })).toThrow(
      /providerAvailability/,
    );
    expect(() => registry.snapshot({ typo: ProviderAvailability.AVAILABLE })).toThrow(/unknown providerId/);
  });
});
