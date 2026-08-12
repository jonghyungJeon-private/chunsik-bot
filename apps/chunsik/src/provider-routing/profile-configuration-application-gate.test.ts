import { describe, expect, it } from 'vitest';
import type { ProviderDescriptor } from '@chunsik/core';
import {
  BALANCED_PROVIDER_ID,
  createProductionProviderRoutingConfiguration,
} from './production-provider-routing-config';
import {
  PROVIDER_ROUTING_EGRESS_SCOPE_VERSION,
  PROVIDER_ROUTING_LOOPBACK_ENDPOINT,
} from './provider-routing-activation';
import type { ProviderRoutingEgressScope } from './provider-routing-activation';
import {
  PROFILE_APPLICATION_CONTRACT_VERSION,
  PROFILE_APPLICATION_MAX_LIFETIME_MS,
  ProfileConfigurationApplicationError,
  deriveProfileConfigurationApplicationCandidate,
  productionRoutingConfigurationDeclaration,
} from './profile-configuration-application-gate';
import type {
  ProductionRoutingConfigurationDeclaration,
  ProfileConfigurationApplicationGateInput,
} from './profile-configuration-application-gate';
import {
  SUITABILITY_PROFILE_VERSION,
  SUITABILITY_PROJECTION_VERSION,
  computeSuitabilityCanonicalDigest,
  computeSuitabilityDescriptorConfigurationDigest,
} from '../tools/provider-suitability-projection';
import {
  SUITABILITY_RATIFICATION_CONTRACT_VERSION,
} from '../tools/provider-suitability-ratification';
import type { RatifiedSuitabilityProfile } from '../tools/provider-suitability-ratification';

const ISSUED_AT = '2026-08-12T00:00:00.000Z';
const EXPIRES_AT = '2026-08-12T01:00:00.000Z';

function target(): ProductionRoutingConfigurationDeclaration {
  return productionRoutingConfigurationDeclaration(
    createProductionProviderRoutingConfiguration({ ollamaBin: '/not-executed/ollama' }),
  );
}

function ratified(
  declaration: ProductionRoutingConfigurationDeclaration,
  descriptorOverride: Partial<ProviderDescriptor> = {},
): RatifiedSuitabilityProfile {
  const source = declaration.providerDescriptors.find(
    (descriptor) => descriptor.providerId === BALANCED_PROVIDER_ID,
  ) as ProviderDescriptor;
  const defaultOperationalProfile = {
    ...source.operationalProfile,
    costTier: 'LOW',
  } as ProviderDescriptor['operationalProfile'];
  const approvedDescriptor = {
    ...source,
    ...descriptorOverride,
    capabilities: descriptorOverride.capabilities ?? source.capabilities,
    operationalProfile: descriptorOverride.operationalProfile ?? defaultOperationalProfile,
    enabled: false,
  } as ProviderDescriptor;
  const descriptorConfigurationDigest = computeSuitabilityDescriptorConfigurationDigest({
    capabilities: approvedDescriptor.capabilities,
    operationalProfile: approvedDescriptor.operationalProfile,
  });
  const payload = {
    ratificationStatus: 'APPROVED',
    ratificationContractVersion: SUITABILITY_RATIFICATION_CONTRACT_VERSION,
    approvalId: 'approval-stage2c-slice3b',
    authorityId: 'chief-architect',
    candidateProfileDigest: 'a'.repeat(64),
    evidenceBindingDigest: approvedDescriptor.evidenceBindingDigest as string,
    descriptorConfigurationDigest,
    providerId: approvedDescriptor.providerId,
    adapterId: approvedDescriptor.adapterId,
    modelId: approvedDescriptor.modelId,
    projectionVersion: SUITABILITY_PROJECTION_VERSION,
    profileVersion: SUITABILITY_PROFILE_VERSION,
    approvedDescriptor,
    runtimeMutation: 'NONE',
  } as const;
  return {
    ...payload,
    approvedProfileDigest: computeSuitabilityCanonicalDigest(payload),
  };
}

function scope(): ProviderRoutingEgressScope {
  return {
    contractVersion: PROVIDER_ROUTING_EGRESS_SCOPE_VERSION,
    ollamaExecutable: '/not-executed/ollama',
    loopbackEndpoint: PROVIDER_ROUTING_LOOPBACK_ENDPOINT,
    providerIds: ['ollama-cli:llama3.1:8b', 'ollama-cli:granite3.3:8b'],
    modelIds: ['llama3.1:8b', 'granite3.3:8b'],
    denyNonLoopbackIpv4: true,
    denyNonLoopbackIpv6: true,
    denyDns: true,
  };
}

function input(
  overrides: Partial<ProfileConfigurationApplicationGateInput> = {},
): ProfileConfigurationApplicationGateInput {
  const configuration = target();
  return {
    ratifiedProfile: ratified(configuration),
    targetConfiguration: configuration,
    currentConfiguration: configuration,
    protectedEgressScope: scope(),
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    now: ISSUED_AT,
    runtimeApplicationContractVersion: PROFILE_APPLICATION_CONTRACT_VERSION,
    ...overrides,
  };
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('expected rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(ProfileConfigurationApplicationError);
    expect((error as ProfileConfigurationApplicationError).code).toBe(code);
  }
}

describe('Stage 2C Slice 3B profile configuration application gate', () => {
  it('derives the same immutable APPLY_REQUIRED candidate and digest for exact repeated input', () => {
    const value = input();
    const before = structuredClone(value.targetConfiguration);
    const first = deriveProfileConfigurationApplicationCandidate(value);
    const second = deriveProfileConfigurationApplicationCandidate(value);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      approvedProfileDigest: value.ratifiedProfile.approvedProfileDigest,
      targetConfigurationIdentity: value.targetConfiguration.configurationDigest,
      providerId: BALANCED_PROVIDER_ID,
      modelId: 'llama3.1:8b',
      provenanceAssuranceLevel: 'SELF_CONSISTENT_UNSIGNED',
      disposition: 'APPLY_REQUIRED',
      executionMutation: 'NONE',
    });
    expect(first.applicationSubjectDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(value.targetConfiguration).toEqual(before);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('is independent of object-key insertion order', () => {
    const value = input();
    const reordered = {
      deadlinePolicyVersion: value.targetConfiguration.deadlinePolicyVersion,
      routingPolicy: value.targetConfiguration.routingPolicy,
      providerDescriptors: value.targetConfiguration.providerDescriptors,
      configurationDigest: value.targetConfiguration.configurationDigest,
      deadlineClass: value.targetConfiguration.deadlineClass,
      validationProfile: value.targetConfiguration.validationProfile,
      version: value.targetConfiguration.version,
    } as ProductionRoutingConfigurationDeclaration;
    expect(deriveProfileConfigurationApplicationCandidate({
      ...value,
      targetConfiguration: reordered,
      currentConfiguration: reordered,
    })).toEqual(deriveProfileConfigurationApplicationCandidate(value));
  });

  it('recognizes only the exact derived after-state as VERIFIED_NOOP', () => {
    const value = input();
    const first = deriveProfileConfigurationApplicationCandidate(value);
    const descriptors = value.targetConfiguration.providerDescriptors.map((descriptor) =>
      descriptor.providerId === value.ratifiedProfile.providerId
        ? { ...value.ratifiedProfile.approvedDescriptor, enabled: descriptor.enabled }
        : descriptor,
    );
    const after = {
      ...value.targetConfiguration,
      providerDescriptors: descriptors,
      configurationDigest: first.expectedResultConfigurationDigest,
    };
    expect(deriveProfileConfigurationApplicationCandidate({
      ...value,
      currentConfiguration: after,
    }).disposition).toBe('VERIFIED_NOOP');

    const alternateProfile = ratified(value.targetConfiguration, {
      operationalProfile: {
        ...value.ratifiedProfile.approvedDescriptor.operationalProfile,
        costTier: 'HIGH',
      },
    });
    const alternateCandidate = deriveProfileConfigurationApplicationCandidate({
      ...value,
      ratifiedProfile: alternateProfile,
    });
    const staleDescriptors = value.targetConfiguration.providerDescriptors.map((descriptor) =>
      descriptor.providerId === alternateProfile.providerId
        ? { ...alternateProfile.approvedDescriptor, enabled: descriptor.enabled }
        : descriptor,
    );
    expectCode(() => deriveProfileConfigurationApplicationCandidate({
      ...value,
      currentConfiguration: {
        ...after,
        providerDescriptors: staleDescriptors,
        configurationDigest: alternateCandidate.expectedResultConfigurationDigest,
      },
    }), 'STALE_CONFIGURATION');
  });

  it.each([
    ['provider', { providerIds: ['ollama-cli:other:1b', 'ollama-cli:granite3.3:8b'] }],
    ['model', { modelIds: ['other:1b', 'granite3.3:8b'] }],
  ])('rejects %s expansion outside the exact protected egress scope', (_name, change) => {
    const value = input();
    const protectedEgressScope = { ...value.protectedEgressScope, ...change } as ProviderRoutingEgressScope;
    expectCode(() => deriveProfileConfigurationApplicationCandidate({
      ...value,
      protectedEgressScope,
    }), 'EGRESS_SCOPE_INCOMPATIBLE');
  });

  it.each([
    ['provider', { adapterId: 'alternate-cli', providerId: 'alternate-cli:llama3.1:8b', modelId: 'llama3.1:8b' }],
    ['model', { adapterId: 'ollama-cli', providerId: 'ollama-cli:other:1b', modelId: 'other:1b' }],
  ])('rejects a ratified %s outside the protected egress scope', (_name, identity) => {
    const value = input();
    const outside = ratified(value.targetConfiguration, {
      adapterId: identity.adapterId as ProviderDescriptor['adapterId'],
      providerId: identity.providerId as ProviderDescriptor['providerId'],
      modelId: identity.modelId,
    });
    expectCode(() => deriveProfileConfigurationApplicationCandidate({
      ...value,
      ratifiedProfile: outside,
    }), 'EGRESS_SCOPE_INCOMPATIBLE');
  });

  it('rejects ratified-profile digest tampering and descriptor mismatch', () => {
    const value = input();
    expectCode(() => deriveProfileConfigurationApplicationCandidate({
      ...value,
      ratifiedProfile: { ...value.ratifiedProfile, approvedProfileDigest: 'f'.repeat(64) },
    }), 'RATIFIED_PROFILE_DIGEST_MISMATCH');

    const descriptor = {
      ...value.ratifiedProfile.approvedDescriptor,
      operationalProfile: {
        ...value.ratifiedProfile.approvedDescriptor.operationalProfile,
        availabilityClass: 'AVAILABLE',
      },
    } as ProviderDescriptor;
    const changed = { ...value.ratifiedProfile, approvedDescriptor: descriptor };
    const { approvedProfileDigest: _digest, ...payload } = changed;
    expectCode(() => deriveProfileConfigurationApplicationCandidate({
      ...value,
      ratifiedProfile: {
        ...changed,
        approvedProfileDigest: computeSuitabilityCanonicalDigest(payload),
      },
    }), 'RATIFIED_PROFILE_DIGEST_MISMATCH');
  });

  it('rejects unsupported contracts, expiry failures, and malformed time', () => {
    const value = input();
    expectCode(() => deriveProfileConfigurationApplicationCandidate({
      ...value,
      runtimeApplicationContractVersion: 'future-v2' as typeof PROFILE_APPLICATION_CONTRACT_VERSION,
    }), 'APPLICATION_CONTRACT_VERSION_UNSUPPORTED');
    expectCode(() => deriveProfileConfigurationApplicationCandidate({
      ...value,
      now: '2026-08-12T01:00:00.001Z',
    }), 'APPLICATION_EXPIRED');
    expectCode(() => deriveProfileConfigurationApplicationCandidate({
      ...value,
      expiresAt: new Date(Date.parse(ISSUED_AT) + PROFILE_APPLICATION_MAX_LIFETIME_MS + 1).toISOString(),
    }), 'APPLICATION_EXPIRY_INVALID');
    expectCode(() => deriveProfileConfigurationApplicationCandidate({ ...value, now: 'not-a-time' }),
      'APPLICATION_EXPIRY_INVALID');
  });

  it('rejects projection and application-subject assertions that do not exactly match derivation', () => {
    const value = input();
    expectCode(() => deriveProfileConfigurationApplicationCandidate({
      ...value,
      assertedProjection: {
        providerId: value.ratifiedProfile.providerId,
        modelId: 'other:1b',
        descriptorConfigurationDigest: value.ratifiedProfile.descriptorConfigurationDigest,
        ratificationContractVersion: SUITABILITY_RATIFICATION_CONTRACT_VERSION,
      },
    }), 'PROJECTION_MISMATCH');
    expectCode(() => deriveProfileConfigurationApplicationCandidate({
      ...value,
      assertedApplicationSubjectDigest: 'f'.repeat(64),
    }), 'APPLICATION_SUBJECT_DIGEST_MISMATCH');
  });
});
