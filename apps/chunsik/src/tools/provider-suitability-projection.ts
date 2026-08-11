import { createHash } from 'node:crypto';
import {
  ProviderDescriptor,
  ProviderRegistry,
  adapterId,
  providerId,
} from '@chunsik/core';
import {
  BENCHMARK_CONTRACT_VERSION,
  BenchmarkCampaignReport,
  BenchmarkScorecard,
} from './provider-benchmark';
import {
  BenchmarkDecision,
  ScorecardDecision,
  STAGE_2A_DECISION_POLICY_VERSION,
} from './provider-benchmark-decision';

export const SUITABILITY_PROJECTION_VERSION = 'stage2c-suitability-projection-v1' as const;
export const SUITABILITY_PROFILE_VERSION = 'stage2c-candidate-provider-profile-v1' as const;

export type ProviderSuitability = 'ELIGIBLE' | 'INELIGIBLE' | 'UNPROVEN';

export interface SuitabilityEvidenceBinding {
  readonly campaignId: string;
  readonly benchmarkContractVersion: typeof BENCHMARK_CONTRACT_VERSION;
  readonly benchmarkConfigurationDigest: string;
  readonly campaignFingerprint: string;
  readonly decisionPolicyVersion: typeof STAGE_2A_DECISION_POLICY_VERSION;
  readonly providerId: string;
  readonly adapterId: string;
  readonly modelId: string;
  readonly descriptorConfigurationDigest: string;
  readonly promptContractVersion: string;
  readonly scenarioContractVersion: string;
  readonly evaluatorContractVersion: string;
  readonly projectionVersion: typeof SUITABILITY_PROJECTION_VERSION;
}

export interface SuitabilityHardFailureSummary {
  readonly promptLeak: boolean;
  readonly multiEntryEcho: boolean;
  readonly containmentOrCleanupFailure: boolean;
  readonly bindingMismatch: boolean;
  readonly promptShaMismatch: boolean;
  readonly downloadMarker: boolean;
}

export interface SuitabilityProjectionInput {
  readonly report: BenchmarkCampaignReport;
  readonly decision: BenchmarkDecision;
  readonly evidenceBinding: SuitabilityEvidenceBinding;
  readonly hardFailures: SuitabilityHardFailureSummary;
  readonly descriptorTemplate: Pick<ProviderDescriptor, 'capabilities' | 'operationalProfile'>;
}

export interface CandidateStaticProviderProfile {
  readonly projectionVersion: typeof SUITABILITY_PROJECTION_VERSION;
  readonly profileVersion: typeof SUITABILITY_PROFILE_VERSION;
  readonly suitability: ProviderSuitability;
  readonly reasonCodes: readonly SuitabilityReasonCode[];
  readonly evidenceDigest: string;
  readonly descriptorConfigurationDigest: string;
  readonly candidateProfileDigest: string;
  readonly descriptorCandidate: ProviderDescriptor;
  readonly ratificationStatus: 'RATIFICATION_REQUIRED';
  readonly runtimeMutation: 'NONE';
}

export type SuitabilityReasonCode =
  | 'QUALIFIED_EVIDENCE'
  | 'CAMPAIGN_PROVISIONAL'
  | 'CAMPAIGN_INCOMPLETE'
  | 'MODEL_EVIDENCE_MISSING'
  | 'MODEL_EVIDENCE_INCOMPLETE'
  | 'DECISION_UNPROVEN'
  | 'AUTOMATED_FAILURE'
  | 'HUMAN_REVIEW_REQUIRED'
  | 'CRITICAL_FAILURE'
  | 'PROMPT_LEAK'
  | 'MULTI_ENTRY_ECHO'
  | 'CONTAINMENT_OR_CLEANUP_FAILURE'
  | 'DOWNLOAD_MARKER';

export class SuitabilityProjectionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SuitabilityProjectionError';
  }
}

const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

export function computeSuitabilityCanonicalDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function computeSuitabilityDescriptorConfigurationDigest(
  template: SuitabilityProjectionInput['descriptorTemplate'],
): string {
  return computeSuitabilityCanonicalDigest(template);
}

export function computeCandidateProfileDigest(
  candidate: Omit<CandidateStaticProviderProfile, 'candidateProfileDigest'>,
): string {
  return computeSuitabilityCanonicalDigest(candidate);
}

function assertSha(value: string, code: string): void {
  if (!SHA256.test(value)) throw new SuitabilityProjectionError(code);
}

function assertVersion(value: string, code: string): void {
  if (!VERSION.test(value)) throw new SuitabilityProjectionError(code);
}

function validateBinding(input: SuitabilityProjectionInput): void {
  const { evidenceBinding: binding, report, decision } = input;
  assertSha(binding.benchmarkConfigurationDigest, 'BINDING_CONFIGURATION_DIGEST_INVALID');
  assertSha(binding.campaignFingerprint, 'BINDING_CAMPAIGN_FINGERPRINT_INVALID');
  assertSha(binding.descriptorConfigurationDigest, 'BINDING_DESCRIPTOR_DIGEST_INVALID');
  assertVersion(binding.promptContractVersion, 'BINDING_PROMPT_VERSION_INVALID');
  assertVersion(binding.scenarioContractVersion, 'BINDING_SCENARIO_VERSION_INVALID');
  assertVersion(binding.evaluatorContractVersion, 'BINDING_EVALUATOR_VERSION_INVALID');
  if (
    binding.benchmarkContractVersion !== BENCHMARK_CONTRACT_VERSION ||
    binding.projectionVersion !== SUITABILITY_PROJECTION_VERSION ||
    binding.decisionPolicyVersion !== STAGE_2A_DECISION_POLICY_VERSION ||
    binding.campaignId !== report.campaignId ||
    binding.benchmarkConfigurationDigest !== report.configurationDigest ||
    binding.campaignFingerprint !== report.campaignFingerprint ||
    binding.decisionPolicyVersion !== decision.decisionPolicyVersion
  ) {
    throw new SuitabilityProjectionError('EVIDENCE_BINDING_MISMATCH');
  }
  if (
    binding.descriptorConfigurationDigest !==
    computeSuitabilityDescriptorConfigurationDigest(input.descriptorTemplate)
  ) {
    throw new SuitabilityProjectionError('DESCRIPTOR_CONFIGURATION_MISMATCH');
  }
  if (binding.modelId.length === 0 || !report.expectedModels.includes(binding.modelId)) {
    throw new SuitabilityProjectionError('MODEL_BINDING_MISMATCH');
  }
  if (binding.providerId !== `${binding.adapterId}:${binding.modelId}`) {
    throw new SuitabilityProjectionError('PROVIDER_MODEL_IDENTITY_MISMATCH');
  }
  if (input.hardFailures.bindingMismatch) {
    throw new SuitabilityProjectionError('EVIDENCE_BINDING_MISMATCH');
  }
  if (input.hardFailures.promptShaMismatch) {
    throw new SuitabilityProjectionError('PROMPT_SHA_MISMATCH');
  }
}

function uniqueForModel<T extends { readonly model: string }>(
  values: readonly T[],
  model: string,
  code: string,
): T | undefined {
  const matches = values.filter((value) => value.model === model);
  if (matches.length > 1) throw new SuitabilityProjectionError(code);
  return matches[0];
}

function hardFailureReasons(
  scorecard: BenchmarkScorecard | undefined,
  summary: SuitabilityHardFailureSummary,
): SuitabilityReasonCode[] {
  const reasons: SuitabilityReasonCode[] = [];
  if (scorecard?.criticalFailure) reasons.push('CRITICAL_FAILURE');
  if (scorecard !== undefined && scorecard.automatedFailCount > 0) reasons.push('AUTOMATED_FAILURE');
  if (scorecard !== undefined && scorecard.humanReviewRequiredCount > 0) reasons.push('HUMAN_REVIEW_REQUIRED');
  if ((scorecard?.failureDistribution.LEAK ?? 0) > 0 || summary.promptLeak) reasons.push('PROMPT_LEAK');
  if (summary.multiEntryEcho) reasons.push('MULTI_ENTRY_ECHO');
  if ((scorecard?.failureDistribution.CONTAINMENT ?? 0) > 0 || summary.containmentOrCleanupFailure) {
    reasons.push('CONTAINMENT_OR_CLEANUP_FAILURE');
  }
  if (summary.downloadMarker) reasons.push('DOWNLOAD_MARKER');
  return [...new Set(reasons)].sort();
}

function classify(
  report: BenchmarkCampaignReport,
  scorecard: BenchmarkScorecard | undefined,
  decision: ScorecardDecision | undefined,
  hardReasons: readonly SuitabilityReasonCode[],
): { suitability: ProviderSuitability; reasonCodes: readonly SuitabilityReasonCode[] } {
  if (hardReasons.length > 0) {
    return { suitability: 'INELIGIBLE', reasonCodes: Object.freeze([...hardReasons]) };
  }
  const unproven: SuitabilityReasonCode[] = [];
  if (report.provisional) unproven.push('CAMPAIGN_PROVISIONAL');
  if (!report.campaignComplete) unproven.push('CAMPAIGN_INCOMPLETE');
  if (scorecard === undefined || decision === undefined) unproven.push('MODEL_EVIDENCE_MISSING');
  else {
    if (!scorecard.complete) unproven.push('MODEL_EVIDENCE_INCOMPLETE');
    if (!decision.acceptanceQualified) unproven.push('DECISION_UNPROVEN');
  }
  if (unproven.length > 0) {
    return { suitability: 'UNPROVEN', reasonCodes: Object.freeze([...new Set(unproven)].sort()) };
  }
  return { suitability: 'ELIGIBLE', reasonCodes: Object.freeze(['QUALIFIED_EVIDENCE']) };
}

function boundedScorecard(scorecard: BenchmarkScorecard | undefined): unknown {
  if (scorecard === undefined) return null;
  return {
    model: scorecard.model,
    sampleCount: scorecard.sampleCount,
    automatedFailCount: scorecard.automatedFailCount,
    humanReviewRequiredCount: scorecard.humanReviewRequiredCount,
    criticalFailure: scorecard.criticalFailure,
    complete: scorecard.complete,
    failureDistribution: scorecard.failureDistribution,
  };
}

function projectValidatedProviderSuitability(
  input: SuitabilityProjectionInput,
): CandidateStaticProviderProfile {
  validateBinding(input);
  const { report, decision, evidenceBinding: binding } = input;
  if (decision.provisional !== report.provisional) {
    throw new SuitabilityProjectionError('DECISION_REPORT_STATUS_MISMATCH');
  }
  const scorecard = uniqueForModel(report.scorecards, binding.modelId, 'DUPLICATE_MODEL_SCORECARD');
  const scorecardDecision = uniqueForModel(
    decision.scorecards,
    binding.modelId,
    'DUPLICATE_MODEL_DECISION',
  );
  const hardReasons = hardFailureReasons(scorecard, input.hardFailures);
  const classification = classify(report, scorecard, scorecardDecision, hardReasons);
  const evidencePayload = {
    binding,
    decision: {
      decisionPolicyVersion: decision.decisionPolicyVersion,
      provisional: decision.provisional,
      modelDecision: scorecardDecision ?? null,
    },
    scorecard: boundedScorecard(scorecard),
    hardFailures: input.hardFailures,
  };
  const evidenceDigest = computeSuitabilityCanonicalDigest(evidencePayload);
  const descriptorCandidate: ProviderDescriptor = {
    providerId: providerId(binding.providerId),
    adapterId: adapterId(binding.adapterId),
    modelId: binding.modelId,
    capabilities: input.descriptorTemplate.capabilities,
    operationalProfile: input.descriptorTemplate.operationalProfile,
    enabled: false,
    profileVersion: SUITABILITY_PROFILE_VERSION,
    evidenceBindingDigest: evidenceDigest,
  };
  const validatedDescriptor = new ProviderRegistry(SUITABILITY_PROFILE_VERSION, [
    { providerId: descriptorCandidate.providerId, descriptor: descriptorCandidate },
  ]).all()[0];
  if (validatedDescriptor === undefined) throw new SuitabilityProjectionError('CANDIDATE_PROFILE_INVALID');
  const candidatePayload = {
    projectionVersion: SUITABILITY_PROJECTION_VERSION,
    profileVersion: SUITABILITY_PROFILE_VERSION,
    suitability: classification.suitability,
    reasonCodes: classification.reasonCodes,
    evidenceDigest,
    descriptorConfigurationDigest: binding.descriptorConfigurationDigest,
    descriptorCandidate: validatedDescriptor,
    ratificationStatus: 'RATIFICATION_REQUIRED',
    runtimeMutation: 'NONE',
  } as const;
  return Object.freeze({
    ...candidatePayload,
    reasonCodes: Object.freeze([...classification.reasonCodes]),
    candidateProfileDigest: computeCandidateProfileDigest(candidatePayload),
  });
}

export function projectProviderSuitability(
  input: SuitabilityProjectionInput,
): CandidateStaticProviderProfile {
  try {
    return projectValidatedProviderSuitability(input);
  } catch (error) {
    if (error instanceof SuitabilityProjectionError) throw error;
    throw new SuitabilityProjectionError('MALFORMED_SUITABILITY_EVIDENCE');
  }
}
