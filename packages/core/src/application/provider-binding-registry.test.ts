import { describe, expect, it, vi } from 'vitest';
import { Capability } from '../domain';
import type { AiProvider } from '../ports';
import {
  AdapterId,
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
  SupportLevel,
  TimeoutClass,
  adapterId,
  providerId,
} from './provider-routing-contracts';
import { ProviderRegistry } from './provider-registry';
import {
  ExecutableProviderBinding,
  ProviderBindingConfigurationError,
  ProviderBindingFailureCode,
  ProviderBindingRegistry,
} from './provider-binding-registry';

function descriptor(
  id: string,
  options: { adapter?: AdapterId; modelId?: string; profileVersion?: string; enabled?: boolean } = {},
): ProviderDescriptor {
  return {
    providerId: providerId(id),
    adapterId: options.adapter ?? adapterId('local-text-adapter'),
    modelId: options.modelId ?? `opaque-${id}`,
    capabilities: {
      supportedCapabilities: [Capability.GENERAL_CHAT],
      routingClasses: [RoutingClass.BALANCED],
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
    profileVersion: options.profileVersion ?? 'profile-v1',
  };
}

function snapshot(descriptors: readonly ProviderDescriptor[]) {
  const registry = new ProviderRegistry(
    'registry-v1',
    descriptors.map((value) => ({ providerId: value.providerId, descriptor: value })),
  );
  return registry.snapshot(
    Object.fromEntries(descriptors.map((value) => [value.providerId, ProviderAvailability.AVAILABLE])),
  );
}

function provider(id: string): AiProvider {
  return {
    id,
    capabilities: [{ capability: Capability.GENERAL_CHAT, priority: 1 }],
    isAvailable: vi.fn(async () => true),
    execute: vi.fn(async () => ({ text: id })),
  };
}

function binding(
  value: AiProvider,
  options: { providerId?: string; adapter?: AdapterId; modelId?: string; bindingVersion?: string } = {},
): ExecutableProviderBinding {
  const id = options.providerId ?? value.id;
  return {
    providerId: providerId(id),
    adapterId: options.adapter ?? adapterId('local-text-adapter'),
    modelId: options.modelId ?? `opaque-${id}`,
    bindingVersion: options.bindingVersion ?? 'binding-v1',
    provider: value,
  };
}

describe('ProviderBindingRegistry provenance', () => {
  it('locks the deterministic binding digest and ignores binding registration order', () => {
    const registry = snapshot([descriptor('provider-a'), descriptor('provider-b')]);
    const a = binding(provider('provider-a'));
    const b = binding(provider('provider-b'));
    const first = new ProviderBindingRegistry(registry, [b, a]);
    const second = new ProviderBindingRegistry(registry, [a, b]);

    expect(first.get(providerId('provider-a'))?.identity.bindingDigest).toBe(
      '11a6b2a89d935ef767613a3a57330fbe8b9056e0b2708d6e7d41323eaf141a3e',
    );
    expect(first.all().map((value) => value.providerId)).toEqual(['provider-a', 'provider-b']);
    expect(first.all().map((value) => value.identity)).toEqual(second.all().map((value) => value.identity));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.all())).toBe(true);
    expect(Object.isFrozen(first.all()[0]?.identity)).toBe(true);
  });

  it('changes the digest when provider, adapter, model, binding version, or profile version changes', () => {
    const digest = (d: ProviderDescriptor, b: ExecutableProviderBinding) =>
      new ProviderBindingRegistry(snapshot([d]), [b]).all()[0]?.identity.bindingDigest;
    const original = digest(descriptor('provider-a'), binding(provider('provider-a')));
    expect(digest(descriptor('provider-b'), binding(provider('provider-b')))).not.toBe(original);
    expect(
      digest(
        descriptor('provider-a', { adapter: adapterId('adapter-v2') }),
        binding(provider('provider-a'), { adapter: adapterId('adapter-v2') }),
      ),
    ).not.toBe(original);
    expect(
      digest(
        descriptor('provider-a', { modelId: 'opaque-model-v2' }),
        binding(provider('provider-a'), { modelId: 'opaque-model-v2' }),
      ),
    ).not.toBe(original);
    expect(
      digest(descriptor('provider-a'), binding(provider('provider-a'), { bindingVersion: 'binding-v2' })),
    ).not.toBe(original);
    expect(
      digest(descriptor('provider-a', { profileVersion: 'profile-v2' }), binding(provider('provider-a'))),
    ).not.toBe(original);
  });

  it('rejects unknown, disabled, duplicate, executable-id, adapter, and model mismatches', () => {
    const active = snapshot([descriptor('provider-a')]);
    const unknownExecutable = provider('provider-b');
    const disabledExecutable = provider('provider-a');
    const captureCode = (action: () => unknown, code: ProviderBindingFailureCode) => {
      try {
        action();
        throw new Error('expected binding rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderBindingConfigurationError);
        expect((error as ProviderBindingConfigurationError).code).toBe(code);
      }
    };

    captureCode(
      () => new ProviderBindingRegistry(active, [binding(unknownExecutable)]),
      ProviderBindingFailureCode.UNKNOWN_PROVIDER_BINDING,
    );
    captureCode(
      () => new ProviderBindingRegistry(snapshot([descriptor('provider-a', { enabled: false })]), [binding(disabledExecutable)]),
      ProviderBindingFailureCode.PROVIDER_DISABLED,
    );
    captureCode(
      () => new ProviderBindingRegistry(active, [binding(provider('provider-a')), binding(provider('provider-a'))]),
      ProviderBindingFailureCode.DUPLICATE_PROVIDER_BINDING,
    );
    captureCode(
      () => new ProviderBindingRegistry(active, [binding(provider('provider-b'), { providerId: 'provider-a' })]),
      ProviderBindingFailureCode.PROVIDER_BINDING_MISMATCH,
    );
    captureCode(
      () => new ProviderBindingRegistry(active, [binding(provider('provider-a'), { adapter: adapterId('wrong-adapter') })]),
      ProviderBindingFailureCode.PROVIDER_BINDING_MISMATCH,
    );
    captureCode(
      () => new ProviderBindingRegistry(active, [binding(provider('provider-a'), { modelId: 'wrong-model' })]),
      ProviderBindingFailureCode.PROVIDER_BINDING_MISMATCH,
    );
    captureCode(
      () => new ProviderBindingRegistry(active, [binding(provider('provider-a'), { bindingVersion: '' })]),
      ProviderBindingFailureCode.INVALID_PROVIDER_BINDING,
    );
    expect(unknownExecutable.execute).not.toHaveBeenCalled();
    expect(disabledExecutable.execute).not.toHaveBeenCalled();
  });

  it('copies descriptor provenance so later source snapshot mutation cannot change binding identity', () => {
    const sourceDescriptor = descriptor('provider-a');
    const frozen = snapshot([sourceDescriptor]);
    const mutableDescriptor = { ...frozen.providers[0]!.descriptor };
    const mutableSnapshot = {
      ...frozen,
      providers: [{ descriptor: mutableDescriptor, availability: ProviderAvailability.AVAILABLE }],
    };
    const bindings = new ProviderBindingRegistry(mutableSnapshot, [binding(provider('provider-a'))]);
    const before = bindings.get(providerId('provider-a'))?.identity.bindingDigest;

    mutableDescriptor.modelId = 'mutated-after-validation';
    mutableDescriptor.adapterId = adapterId('mutated-adapter');
    expect(bindings.get(providerId('provider-a'))?.identity.bindingDigest).toBe(before);
  });
});
