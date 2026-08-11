import type { ProviderDescriptor } from '@chunsik/core';
import {
  CandidateStaticProviderProfile,
  SUITABILITY_PROFILE_VERSION,
  SUITABILITY_PROJECTION_VERSION,
  computeCandidateProfileDigest,
  computeSuitabilityCanonicalDigest,
  computeSuitabilityDescriptorConfigurationDigest,
} from './provider-suitability-projection';

export const SUITABILITY_RATIFICATION_CONTRACT_VERSION =
  'stage2c-suitability-ratification-v1' as const;

export interface SuitabilityRatificationApprovalBinding {
  readonly ratificationContractVersion: typeof SUITABILITY_RATIFICATION_CONTRACT_VERSION;
  readonly approvalId: string;
  readonly authorityId: string;
  readonly decision: 'APPROVED';
  readonly candidateProfileDigest: string;
  readonly evidenceBindingDigest: string;
  readonly descriptorConfigurationDigest: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly projectionVersion: typeof SUITABILITY_PROJECTION_VERSION;
}

export interface SuitabilityRatificationInput {
  readonly candidate: CandidateStaticProviderProfile;
  readonly approval: SuitabilityRatificationApprovalBinding;
}

export interface RatifiedSuitabilityProfile {
  readonly ratificationStatus: 'APPROVED';
  readonly ratificationContractVersion: typeof SUITABILITY_RATIFICATION_CONTRACT_VERSION;
  readonly approvalId: string;
  readonly authorityId: string;
  readonly candidateProfileDigest: string;
  readonly evidenceBindingDigest: string;
  readonly descriptorConfigurationDigest: string;
  readonly providerId: string;
  readonly adapterId: string;
  readonly modelId: string;
  readonly projectionVersion: typeof SUITABILITY_PROJECTION_VERSION;
  readonly profileVersion: typeof SUITABILITY_PROFILE_VERSION;
  readonly approvedDescriptor: ProviderDescriptor;
  readonly approvedProfileDigest: string;
  readonly runtimeMutation: 'NONE';
}

export class SuitabilityRatificationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SuitabilityRatificationError';
  }
}

const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;
const APPROVAL_KEYS = Object.freeze([
  'approvalId', 'authorityId', 'candidateProfileDigest', 'decision',
  'descriptorConfigurationDigest', 'evidenceBindingDigest', 'modelId', 'projectionVersion',
  'providerId', 'ratificationContractVersion',
]);

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateApproval(value: unknown): asserts value is SuitabilityRatificationApprovalBinding {
  if (!isObject(value) || !exactKeys(value, APPROVAL_KEYS)) {
    throw new SuitabilityRatificationError('APPROVAL_BINDING_MALFORMED');
  }
  if (value.ratificationContractVersion !== SUITABILITY_RATIFICATION_CONTRACT_VERSION) {
    throw new SuitabilityRatificationError('RATIFICATION_VERSION_UNSUPPORTED');
  }
  if (value.decision !== 'APPROVED') throw new SuitabilityRatificationError('APPROVAL_DECISION_INVALID');
  for (const field of ['approvalId', 'authorityId', 'providerId', 'modelId'] as const) {
    if (typeof value[field] !== 'string' || !IDENTIFIER.test(value[field])) {
      throw new SuitabilityRatificationError('APPROVAL_BINDING_MALFORMED');
    }
  }
  for (const field of ['candidateProfileDigest', 'evidenceBindingDigest',
    'descriptorConfigurationDigest'] as const) {
    if (typeof value[field] !== 'string' || !SHA256.test(value[field])) {
      throw new SuitabilityRatificationError('APPROVAL_BINDING_MALFORMED');
    }
  }
  if (value.projectionVersion !== SUITABILITY_PROJECTION_VERSION) {
    throw new SuitabilityRatificationError('PROJECTION_VERSION_UNSUPPORTED');
  }
}

function validateCandidate(candidate: CandidateStaticProviderProfile): void {
  if (candidate.projectionVersion !== SUITABILITY_PROJECTION_VERSION ||
      candidate.profileVersion !== SUITABILITY_PROFILE_VERSION) {
    throw new SuitabilityRatificationError('CANDIDATE_VERSION_UNSUPPORTED');
  }
  if (!SHA256.test(candidate.candidateProfileDigest) || !SHA256.test(candidate.evidenceDigest) ||
      !SHA256.test(candidate.descriptorConfigurationDigest)) {
    throw new SuitabilityRatificationError('CANDIDATE_DIGEST_INVALID');
  }
  const { candidateProfileDigest: _digest, ...payload } = candidate;
  if (computeCandidateProfileDigest(payload) !== candidate.candidateProfileDigest) {
    throw new SuitabilityRatificationError('CANDIDATE_DIGEST_MISMATCH');
  }
  if (candidate.descriptorCandidate.evidenceBindingDigest !== candidate.evidenceDigest) {
    throw new SuitabilityRatificationError('EVIDENCE_BINDING_MISMATCH');
  }
  if (computeSuitabilityDescriptorConfigurationDigest({
    capabilities: candidate.descriptorCandidate.capabilities,
    operationalProfile: candidate.descriptorCandidate.operationalProfile,
  }) !== candidate.descriptorConfigurationDigest) {
    throw new SuitabilityRatificationError('DESCRIPTOR_CONFIGURATION_MISMATCH');
  }
  if (candidate.descriptorCandidate.providerId !==
      `${candidate.descriptorCandidate.adapterId}:${candidate.descriptorCandidate.modelId}`) {
    throw new SuitabilityRatificationError('PROVIDER_MODEL_IDENTITY_MISMATCH');
  }
  if (candidate.suitability !== 'ELIGIBLE') {
    throw new SuitabilityRatificationError('CANDIDATE_NOT_ELIGIBLE');
  }
  if (candidate.ratificationStatus !== 'RATIFICATION_REQUIRED') {
    throw new SuitabilityRatificationError('CANDIDATE_RATIFICATION_STATUS_INVALID');
  }
  if (candidate.runtimeMutation !== 'NONE') {
    throw new SuitabilityRatificationError('CANDIDATE_RUNTIME_MUTATION_INVALID');
  }
  if (candidate.descriptorCandidate.enabled !== false) {
    throw new SuitabilityRatificationError('CANDIDATE_DESCRIPTOR_ENABLED');
  }
}

function assertApprovalMatches(
  candidate: CandidateStaticProviderProfile,
  approval: SuitabilityRatificationApprovalBinding,
): void {
  const descriptor = candidate.descriptorCandidate;
  if (approval.candidateProfileDigest !== candidate.candidateProfileDigest) {
    throw new SuitabilityRatificationError('APPROVAL_CANDIDATE_MISMATCH');
  }
  if (approval.evidenceBindingDigest !== candidate.evidenceDigest) {
    throw new SuitabilityRatificationError('APPROVAL_EVIDENCE_MISMATCH');
  }
  if (approval.descriptorConfigurationDigest !== candidate.descriptorConfigurationDigest) {
    throw new SuitabilityRatificationError('APPROVAL_DESCRIPTOR_CONFIGURATION_MISMATCH');
  }
  if (approval.providerId !== descriptor.providerId || approval.modelId !== descriptor.modelId) {
    throw new SuitabilityRatificationError('APPROVAL_PROVIDER_MODEL_MISMATCH');
  }
  if (approval.projectionVersion !== candidate.projectionVersion) {
    throw new SuitabilityRatificationError('APPROVAL_PROJECTION_VERSION_MISMATCH');
  }
}

function freezeApprovedDescriptor(descriptor: ProviderDescriptor): ProviderDescriptor {
  return Object.freeze({
    ...descriptor,
    capabilities: Object.freeze({
      ...descriptor.capabilities,
      supportedCapabilities: Object.freeze([...descriptor.capabilities.supportedCapabilities]),
      routingClasses: Object.freeze([...descriptor.capabilities.routingClasses]),
    }),
    operationalProfile: Object.freeze({ ...descriptor.operationalProfile }),
  });
}

export function ratifySuitabilityProfile(
  input: SuitabilityRatificationInput,
): RatifiedSuitabilityProfile {
  try {
    validateApproval(input.approval);
    validateCandidate(input.candidate);
    assertApprovalMatches(input.candidate, input.approval);
    const descriptor = freezeApprovedDescriptor(input.candidate.descriptorCandidate);
    const payload = {
      ratificationStatus: 'APPROVED',
      ratificationContractVersion: SUITABILITY_RATIFICATION_CONTRACT_VERSION,
      approvalId: input.approval.approvalId,
      authorityId: input.approval.authorityId,
      candidateProfileDigest: input.candidate.candidateProfileDigest,
      evidenceBindingDigest: input.candidate.evidenceDigest,
      descriptorConfigurationDigest: input.candidate.descriptorConfigurationDigest,
      providerId: descriptor.providerId,
      adapterId: descriptor.adapterId,
      modelId: descriptor.modelId,
      projectionVersion: input.candidate.projectionVersion,
      profileVersion: input.candidate.profileVersion,
      approvedDescriptor: descriptor,
      runtimeMutation: 'NONE',
    } as const;
    return Object.freeze({ ...payload, approvedProfileDigest: computeSuitabilityCanonicalDigest(payload) });
  } catch (error) {
    if (error instanceof SuitabilityRatificationError) throw error;
    throw new SuitabilityRatificationError('RATIFICATION_INPUT_MALFORMED');
  }
}
