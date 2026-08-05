import { describe, expect, it, vi } from 'vitest';
import type { RuntimeProviderRouting } from '@chunsik/core';
import {
  BALANCED_PROVIDER_ID,
  OLLAMA_ADAPTER_ID,
  ProviderCandidateRole,
  SEMANTIC_PROVIDER_ID,
  buildProductionProviderRoutingConfiguration,
} from './production-provider-routing-config';
import type { ProductionProviderDefinition } from './production-provider-routing-config';
import {
  ProviderRoutingActivationErrorCode,
  createProductionRuntimeProviderRoutingActivation,
} from './provider-routing-activation';
import type {
  ProviderRoutingEgressEnforcement,
  ProviderRoutingEgressScope,
} from './provider-routing-activation';

const fakeProviders = (): readonly [ProductionProviderDefinition, ProductionProviderDefinition] => [
  {
    providerId: BALANCED_PROVIDER_ID,
    adapterId: OLLAMA_ADAPTER_ID,
    modelId: 'llama3.1:8b',
    candidateRole: ProviderCandidateRole.BALANCED_PRIMARY,
    provider: {
      id: BALANCED_PROVIDER_ID,
      capabilities: [],
      isAvailable: vi.fn(async () => true),
      execute: vi.fn(async () => ({ text: 'unused' })),
    },
  },
  {
    providerId: SEMANTIC_PROVIDER_ID,
    adapterId: OLLAMA_ADAPTER_ID,
    modelId: 'granite3.3:8b',
    candidateRole: ProviderCandidateRole.SEMANTIC_CANDIDATE,
    provider: {
      id: SEMANTIC_PROVIDER_ID,
      capabilities: [],
      isAvailable: vi.fn(async () => true),
      execute: vi.fn(async () => ({ text: 'unused' })),
    },
  },
];

function verifiedEnforcement(): ProviderRoutingEgressEnforcement {
  return { verifyExactScope: vi.fn((scope) => ({ status: 'verified', exactScope: scope })) };
}

describe('Stage 2B Slice 5C-I dormant production routing activation', () => {
  it('returns undefined for parsed legacy without enforcement or production construction', () => {
    const enforcement = verifiedEnforcement();
    const createConfiguration = vi.fn();

    expect(
      createProductionRuntimeProviderRoutingActivation({
        mode: 'legacy',
        ollama: { ollamaBin: '/approved/ollama' },
        enforcement,
        createConfiguration,
      }),
    ).toBeUndefined();
    expect(enforcement.verifyExactScope).not.toHaveBeenCalled();
    expect(createConfiguration).not.toHaveBeenCalled();
  });

  it('blocks missing enforcement before production configuration construction', () => {
    const createConfiguration = vi.fn();
    expect(() =>
      createProductionRuntimeProviderRoutingActivation({
        mode: 'stage2b-general-chat-v1',
        ollama: { ollamaBin: '/approved/ollama' },
        createConfiguration,
      }),
    ).toThrow(ProviderRoutingActivationErrorCode.ENFORCEMENT_UNAVAILABLE);
    expect(createConfiguration).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'unverified'] as const)(
    'blocks %s enforcement before production configuration construction',
    (status) => {
      const createConfiguration = vi.fn();
      expect(() =>
        createProductionRuntimeProviderRoutingActivation({
          mode: 'stage2b-general-chat-v1',
          ollama: { ollamaBin: '/approved/ollama' },
          enforcement: { verifyExactScope: () => ({ status }) },
          createConfiguration,
        }),
      ).toThrow(
        status === 'unavailable'
          ? ProviderRoutingActivationErrorCode.ENFORCEMENT_UNAVAILABLE
          : ProviderRoutingActivationErrorCode.ENFORCEMENT_UNVERIFIED,
      );
      expect(createConfiguration).not.toHaveBeenCalled();
    },
  );

  it('blocks a mismatched verified scope before production configuration construction', () => {
    const createConfiguration = vi.fn();
    expect(() =>
      createProductionRuntimeProviderRoutingActivation({
        mode: 'stage2b-general-chat-v1',
        ollama: { ollamaBin: '/approved/ollama' },
        enforcement: {
          verifyExactScope: (scope) => ({
            status: 'verified',
            exactScope: { ...scope, ollamaExecutable: '/different/ollama' },
          }),
        },
        createConfiguration,
      }),
    ).toThrow(ProviderRoutingActivationErrorCode.ENFORCEMENT_SCOPE_MISMATCH);
    expect(createConfiguration).not.toHaveBeenCalled();
  });

  it('verifies the versioned exact scope, constructs once, and returns the exact collaborator without I/O', () => {
    const definitions = fakeProviders();
    const configuration = buildProductionProviderRoutingConfiguration(definitions);
    const enforcement = verifiedEnforcement();
    const createConfiguration = vi.fn(() => configuration);
    const collaborator: RuntimeProviderRouting = { execute: vi.fn() };
    const createRoutingService = vi.fn(() => collaborator);

    const result = createProductionRuntimeProviderRoutingActivation({
      mode: 'stage2b-general-chat-v1',
      ollama: { ollamaBin: '/approved/ollama' },
      enforcement,
      createConfiguration,
      createRoutingService,
    });

    expect(enforcement.verifyExactScope).toHaveBeenCalledTimes(1);
    const scope = vi.mocked(enforcement.verifyExactScope).mock.calls[0]?.[0] as ProviderRoutingEgressScope;
    expect(scope).toEqual({
      contractVersion: 'stage2b-provider-routing-egress-scope-v1',
      ollamaExecutable: '/approved/ollama',
      loopbackEndpoint: 'http://127.0.0.1:11434',
      providerIds: [BALANCED_PROVIDER_ID, SEMANTIC_PROVIDER_ID],
      modelIds: ['llama3.1:8b', 'granite3.3:8b'],
      denyNonLoopbackIpv4: true,
      denyNonLoopbackIpv6: true,
      denyDns: true,
    });
    expect(createConfiguration).toHaveBeenCalledOnce();
    expect(createConfiguration).toHaveBeenCalledWith({ ollamaBin: '/approved/ollama' });
    expect(createRoutingService).toHaveBeenCalledOnce();
    expect(createRoutingService).toHaveBeenCalledWith(configuration);
    expect(result).toBe(collaborator);
    expect(configuration.providerDescriptors.map((descriptor) => descriptor.providerId).sort()).toEqual(
      [BALANCED_PROVIDER_ID, SEMANTIC_PROVIDER_ID].sort(),
    );
    for (const definition of definitions) {
      expect(definition.provider.isAvailable).not.toHaveBeenCalled();
      expect(definition.provider.execute).not.toHaveBeenCalled();
    }
  });
});
