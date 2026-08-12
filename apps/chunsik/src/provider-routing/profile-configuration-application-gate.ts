import { createHash } from 'node:crypto';
import { ProviderRegistry, RoutingPolicyEngine } from '@chunsik/core';
import type { ProviderDescriptor, RoutingPolicyConfiguration } from '@chunsik/core';
import {
  GENERAL_CHAT,
  DEFAULT_PROVIDER_DEADLINE_POLICY,
  DeadlineClass,
} from '@chunsik/core';
import {
  PRODUCTION_ROUTING_CONFIGURATION_VERSION,
} from './production-provider-routing-config';
import type { ProductionProviderRoutingConfiguration } from './production-provider-routing-config';
import {
  BALANCED_PROVIDER_ID,
  SEMANTIC_PROVIDER_ID,
} from './production-provider-routing-config';
import {
  PROVIDER_ROUTING_EGRESS_SCOPE_VERSION,
  PROVIDER_ROUTING_LOOPBACK_ENDPOINT,
} from './provider-routing-activation';
import type { ProviderRoutingEgressScope } from './provider-routing-activation';
import {
  computeSuitabilityCanonicalDigest,
} from '../tools/provider-suitability-projection';
import {
  SUITABILITY_RATIFICATION_CONTRACT_VERSION,
  validateRatifiedSuitabilityProfile,
} from '../tools/provider-suitability-ratification';
import type { RatifiedSuitabilityProfile } from '../tools/provider-suitability-ratification';

export const PROFILE_APPLICATION_CONTRACT_VERSION =
  'stage2c-profile-configuration-application-v1' as const;
export const PROFILE_APPLICATION_MAX_LIFETIME_MS = 24 * 60 * 60 * 1_000;
export const PROFILE_APPLICATION_PROVENANCE_ASSURANCE = 'SELF_CONSISTENT_UNSIGNED' as const;

export interface ProductionRoutingConfigurationDeclaration {
  readonly version: typeof PRODUCTION_ROUTING_CONFIGURATION_VERSION;
  readonly configurationDigest: string;
  readonly providerDescriptors: readonly ProviderDescriptor[];
  readonly routingPolicy: RoutingPolicyConfiguration;
  readonly validationProfile: typeof GENERAL_CHAT;
  readonly deadlineClass: DeadlineClass.STANDARD;
  readonly deadlinePolicyVersion: typeof DEFAULT_PROVIDER_DEADLINE_POLICY.version;
}

export interface ProfileConfigurationApplicationProjectionAssertion {
  readonly providerId: string;
  readonly modelId: string;
  readonly descriptorConfigurationDigest: string;
  readonly ratificationContractVersion: typeof SUITABILITY_RATIFICATION_CONTRACT_VERSION;
}

export interface ProfileConfigurationApplicationGateInput {
  readonly ratifiedProfile: RatifiedSuitabilityProfile;
  readonly targetConfiguration: ProductionRoutingConfigurationDeclaration;
  readonly currentConfiguration: ProductionRoutingConfigurationDeclaration;
  readonly protectedEgressScope: ProviderRoutingEgressScope;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly now: string;
  readonly runtimeApplicationContractVersion: typeof PROFILE_APPLICATION_CONTRACT_VERSION;
  readonly assertedProjection?: ProfileConfigurationApplicationProjectionAssertion;
  readonly assertedApplicationSubjectDigest?: string;
}

export interface ProfileConfigurationApplicationSubject {
  readonly approvedProfileDigest: string;
  readonly targetConfigurationIdentity: string;
  readonly expectedResultConfigurationDigest: string;
  readonly runtimeApplicationContractVersion: typeof PROFILE_APPLICATION_CONTRACT_VERSION;
}

export interface ProfileConfigurationApplicationCandidate
  extends ProfileConfigurationApplicationSubject {
  readonly applicationSubjectDigest: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly descriptorConfigurationDigest: string;
  readonly ratificationContractVersion: typeof SUITABILITY_RATIFICATION_CONTRACT_VERSION;
  readonly provenanceAssuranceLevel: typeof PROFILE_APPLICATION_PROVENANCE_ASSURANCE;
  readonly disposition: 'APPLY_REQUIRED' | 'VERIFIED_NOOP';
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly executionMutation: 'NONE';
}

export type ProfileConfigurationApplicationErrorCode =
  | 'RATIFIED_PROFILE_INVALID'
  | 'RATIFIED_PROFILE_DIGEST_MISMATCH'
  | 'RATIFIED_PROFILE_VERSION_UNSUPPORTED'
  | 'CURRENT_CONFIGURATION_INVALID'
  | 'CURRENT_CONFIGURATION_IDENTITY_MISMATCH'
  | 'EXPECTED_RESULT_DERIVATION_FAILED'
  | 'EGRESS_SCOPE_INCOMPATIBLE'
  | 'APPLICATION_CONTRACT_VERSION_UNSUPPORTED'
  | 'APPLICATION_EXPIRED'
  | 'APPLICATION_EXPIRY_INVALID'
  | 'APPLICATION_SUBJECT_DIGEST_MISMATCH'
  | 'PROJECTION_MISMATCH'
  | 'STALE_CONFIGURATION'
  | 'UNEXPECTED_CONFIGURATION_DIFF';

export class ProfileConfigurationApplicationError extends Error {
  constructor(readonly code: ProfileConfigurationApplicationErrorCode) {
    super(code);
    this.name = 'ProfileConfigurationApplicationError';
  }
}

const SHA256 = /^[0-9a-f]{64}$/;

export function productionRoutingConfigurationDeclaration(
  configuration: ProductionProviderRoutingConfiguration,
): ProductionRoutingConfigurationDeclaration {
  return Object.freeze({
    version: configuration.version,
    configurationDigest: configuration.configurationDigest,
    providerDescriptors: configuration.providerDescriptors,
    routingPolicy: configuration.routingPolicy,
    validationProfile: configuration.validationProfile,
    deadlineClass: configuration.deadlineClass,
    deadlinePolicyVersion: configuration.deadlinePolicy.version,
  });
}

function computeConfigurationDigest(
  declaration: Omit<ProductionRoutingConfigurationDeclaration, 'configurationDigest'>,
): string {
  const registry = new ProviderRegistry(
    declaration.version,
    declaration.providerDescriptors.map((descriptor) => ({
      providerId: descriptor.providerId,
      descriptor,
    })),
  );
  const policy = new RoutingPolicyEngine(declaration.routingPolicy);
  return createHash('sha256').update(JSON.stringify({
    version: declaration.version,
    registryConfigurationDigest: registry.configurationDigest,
    policyConfigurationDigest: policy.policyDigest,
    validationProfile: declaration.validationProfile,
    deadlineClass: declaration.deadlineClass,
    deadlinePolicyVersion: declaration.deadlinePolicyVersion,
  })).digest('hex');
}

function validateConfiguration(
  value: ProductionRoutingConfigurationDeclaration,
): string {
  try {
    if (
      value.version !== PRODUCTION_ROUTING_CONFIGURATION_VERSION ||
      value.validationProfile !== GENERAL_CHAT ||
      value.deadlineClass !== DeadlineClass.STANDARD ||
      value.deadlinePolicyVersion !== DEFAULT_PROVIDER_DEADLINE_POLICY.version ||
      !SHA256.test(value.configurationDigest)
    ) {
      throw new Error('invalid configuration contract');
    }
    const { configurationDigest: _digest, ...payload } = value;
    const derived = computeConfigurationDigest(payload);
    if (derived !== value.configurationDigest) {
      throw new ProfileConfigurationApplicationError('CURRENT_CONFIGURATION_IDENTITY_MISMATCH');
    }
    return derived;
  } catch (error) {
    if (error instanceof ProfileConfigurationApplicationError) throw error;
    throw new ProfileConfigurationApplicationError('CURRENT_CONFIGURATION_INVALID');
  }
}

function validateTime(input: ProfileConfigurationApplicationGateInput): void {
  const parseExact = (value: string): number => {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
      throw new ProfileConfigurationApplicationError('APPLICATION_EXPIRY_INVALID');
    }
    return parsed;
  };
  const issuedAt = parseExact(input.issuedAt);
  const expiresAt = parseExact(input.expiresAt);
  const now = parseExact(input.now);
  if (expiresAt <= issuedAt || expiresAt - issuedAt > PROFILE_APPLICATION_MAX_LIFETIME_MS) {
    throw new ProfileConfigurationApplicationError('APPLICATION_EXPIRY_INVALID');
  }
  if (now > expiresAt) throw new ProfileConfigurationApplicationError('APPLICATION_EXPIRED');
}

function validateEgress(
  scope: ProviderRoutingEgressScope,
  profile: RatifiedSuitabilityProfile,
): void {
  const exactProviderIds = [BALANCED_PROVIDER_ID, SEMANTIC_PROVIDER_ID] as const;
  const exactModelIds = ['llama3.1:8b', 'granite3.3:8b'] as const;
  if (
    scope.contractVersion !== PROVIDER_ROUTING_EGRESS_SCOPE_VERSION ||
    typeof scope.ollamaExecutable !== 'string' ||
    !scope.ollamaExecutable.startsWith('/') ||
    scope.loopbackEndpoint !== PROVIDER_ROUTING_LOOPBACK_ENDPOINT ||
    scope.providerIds.length !== exactProviderIds.length ||
    scope.providerIds.some((value, index) => value !== exactProviderIds[index]) ||
    scope.modelIds.length !== exactModelIds.length ||
    scope.modelIds.some((value, index) => value !== exactModelIds[index]) ||
    !scope.providerIds.includes(profile.approvedDescriptor.providerId as typeof BALANCED_PROVIDER_ID) ||
    !scope.modelIds.includes(profile.modelId as 'llama3.1:8b') ||
    scope.denyNonLoopbackIpv4 !== true ||
    scope.denyNonLoopbackIpv6 !== true ||
    scope.denyDns !== true
  ) {
    throw new ProfileConfigurationApplicationError('EGRESS_SCOPE_INCOMPATIBLE');
  }
}

function expectedResult(
  target: ProductionRoutingConfigurationDeclaration,
  profile: RatifiedSuitabilityProfile,
): ProductionRoutingConfigurationDeclaration {
  const index = target.providerDescriptors.findIndex(
    (descriptor) => descriptor.providerId === profile.providerId,
  );
  if (index < 0) {
    throw new ProfileConfigurationApplicationError('EXPECTED_RESULT_DERIVATION_FAILED');
  }
  const before = target.providerDescriptors[index] as ProviderDescriptor;
  if (before.adapterId !== profile.adapterId || before.modelId !== profile.modelId) {
    throw new ProfileConfigurationApplicationError('UNEXPECTED_CONFIGURATION_DIFF');
  }
  const applied = Object.freeze({
    ...profile.approvedDescriptor,
    enabled: before.enabled,
  });
  const descriptors = Object.freeze(
    target.providerDescriptors.map((descriptor, descriptorIndex) =>
      descriptorIndex === index ? applied : descriptor,
    ),
  );
  try {
    const payload = {
      version: target.version,
      providerDescriptors: descriptors,
      routingPolicy: target.routingPolicy,
      validationProfile: target.validationProfile,
      deadlineClass: target.deadlineClass,
      deadlinePolicyVersion: target.deadlinePolicyVersion,
    } as const;
    return Object.freeze({ ...payload, configurationDigest: computeConfigurationDigest(payload) });
  } catch {
    throw new ProfileConfigurationApplicationError('EXPECTED_RESULT_DERIVATION_FAILED');
  }
}

export function deriveProfileConfigurationApplicationCandidate(
  input: ProfileConfigurationApplicationGateInput,
): ProfileConfigurationApplicationCandidate {
  if (input.runtimeApplicationContractVersion !== PROFILE_APPLICATION_CONTRACT_VERSION) {
    throw new ProfileConfigurationApplicationError('APPLICATION_CONTRACT_VERSION_UNSUPPORTED');
  }
  try {
    validateRatifiedSuitabilityProfile(input.ratifiedProfile);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code.includes('VERSION')) {
      throw new ProfileConfigurationApplicationError('RATIFIED_PROFILE_VERSION_UNSUPPORTED');
    }
    if (code.includes('DIGEST') || code.includes('DESCRIPTOR_MISMATCH')) {
      throw new ProfileConfigurationApplicationError('RATIFIED_PROFILE_DIGEST_MISMATCH');
    }
    throw new ProfileConfigurationApplicationError('RATIFIED_PROFILE_INVALID');
  }
  validateTime(input);
  validateEgress(input.protectedEgressScope, input.ratifiedProfile);
  const targetIdentity = validateConfiguration(input.targetConfiguration);
  const currentIdentity = validateConfiguration(input.currentConfiguration);
  const expected = expectedResult(input.targetConfiguration, input.ratifiedProfile);
  const disposition = currentIdentity === targetIdentity
    ? 'APPLY_REQUIRED'
    : currentIdentity === expected.configurationDigest
      ? 'VERIFIED_NOOP'
      : null;
  if (disposition === null) {
    throw new ProfileConfigurationApplicationError('STALE_CONFIGURATION');
  }
  const profile = input.ratifiedProfile;
  const projection = {
    providerId: profile.providerId,
    modelId: profile.modelId,
    descriptorConfigurationDigest: profile.descriptorConfigurationDigest,
    ratificationContractVersion: profile.ratificationContractVersion,
  } as const;
  if (
    input.assertedProjection !== undefined &&
    computeSuitabilityCanonicalDigest(input.assertedProjection) !==
      computeSuitabilityCanonicalDigest(projection)
  ) {
    throw new ProfileConfigurationApplicationError('PROJECTION_MISMATCH');
  }
  const subject = Object.freeze({
    approvedProfileDigest: profile.approvedProfileDigest,
    targetConfigurationIdentity: targetIdentity,
    expectedResultConfigurationDigest: expected.configurationDigest,
    runtimeApplicationContractVersion: PROFILE_APPLICATION_CONTRACT_VERSION,
  });
  const applicationSubjectDigest = computeSuitabilityCanonicalDigest(subject);
  if (
    input.assertedApplicationSubjectDigest !== undefined &&
    input.assertedApplicationSubjectDigest !== applicationSubjectDigest
  ) {
    throw new ProfileConfigurationApplicationError('APPLICATION_SUBJECT_DIGEST_MISMATCH');
  }
  return Object.freeze({
    ...subject,
    applicationSubjectDigest,
    ...projection,
    provenanceAssuranceLevel: PROFILE_APPLICATION_PROVENANCE_ASSURANCE,
    disposition,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    executionMutation: 'NONE',
  });
}
