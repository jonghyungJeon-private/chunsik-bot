import { createHash } from 'node:crypto';
import {
  FAILURE_SIGNATURE_REGISTRY,
  assertKnownFailureSignatures,
  classifyFailureSignatures,
  signaturesForCheck,
} from './provider-failure-signatures';
import type {
  FailureSignatureFamily,
  FailureSignatureId,
} from './provider-failure-signatures';
import { classifyFailure } from './provider-benchmark';
import type { FailureCategory } from './provider-benchmark';
import type {
  CheckOutcome,
  EvidenceRecord,
  ScenarioId,
} from './provider-semantic-validation';

export const TRANSITION_OVERLAY_SCHEMA_VERSION = 'stage2a-transition-overlay-v1';

export interface TransitionRecordPair {
  readonly corpusId: string;
  readonly corpusVersion: string;
  readonly campaignId: string;
  readonly executionId: string;
  readonly response: string;
  readonly baselineCheckerVersion: string;
  readonly candidateCheckerVersion: string;
  readonly baseline: EvidenceRecord;
  readonly candidate: EvidenceRecord;
}

export type TransitionKind = 'CHECK_OUTCOME' | 'FAILURE_TAXONOMY';

export interface TransitionImpact {
  readonly scorecard: boolean;
  readonly ranking: boolean;
  readonly champion: boolean;
  readonly advancement: boolean;
}

export interface SemanticTransition {
  readonly transitionId: string;
  readonly kind: TransitionKind;
  readonly corpusId: string;
  readonly corpusVersion: string;
  readonly campaignId: string;
  readonly executionId: string;
  readonly responseSha256: string;
  readonly scenarioId: ScenarioId;
  readonly checkId: string;
  readonly baselineCheckerVersion: string;
  readonly candidateCheckerVersion: string;
  readonly baselineOutcome: CheckOutcome | null;
  readonly candidateOutcome: CheckOutcome | null;
  readonly baselineFailureFamilies: readonly FailureCategory[];
  readonly candidateFailureFamilies: readonly FailureCategory[];
  readonly failureSignatures: readonly FailureSignatureId[];
  readonly impacts: TransitionImpact;
}

export type TransitionDecision = 'APPROVE' | 'REJECT' | 'INDETERMINATE';
export type TransitionReviewStatus = 'DRAFT' | 'REVIEWED' | 'RATIFIED';

export interface TransitionOverlayEntry {
  readonly transitionId: string;
  readonly transitionDecision: TransitionDecision;
  readonly failureFamily: FailureSignatureFamily | null;
  readonly failureSignatures: readonly FailureSignatureId[];
  readonly rationaleCode: string;
  readonly rationale: string;
  readonly reviewStatus: TransitionReviewStatus;
  readonly overlayVersion: string;
}

export interface TransitionOverlay {
  readonly schemaVersion: typeof TRANSITION_OVERLAY_SCHEMA_VERSION;
  readonly overlayVersion: string;
  readonly corpusVersion: string;
  readonly entries: readonly TransitionOverlayEntry[];
}

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const transitionIdentity = (
  transition: Omit<SemanticTransition, 'transitionId' | 'impacts'>,
): string =>
  JSON.stringify([
    transition.kind,
    transition.corpusVersion,
    transition.corpusId,
    transition.campaignId,
    transition.executionId,
    transition.responseSha256,
    transition.scenarioId,
    transition.checkId,
    transition.baselineCheckerVersion,
    transition.candidateCheckerVersion,
    transition.baselineOutcome,
    transition.candidateOutcome,
    transition.baselineFailureFamilies,
    transition.candidateFailureFamilies,
    transition.failureSignatures,
  ]);

const defaultImpact = (scorecard: boolean): TransitionImpact => ({
  scorecard,
  ranking: false,
  champion: false,
  advancement: false,
});

const checkOutcomeMap = (record: EvidenceRecord): ReadonlyMap<string, CheckOutcome> =>
  new Map(record.checks.map((check) => [check.id, check.outcome]));

const sortedCategories = (record: EvidenceRecord): readonly FailureCategory[] =>
  [...classifyFailure(record)].sort();

const sameStrings = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export function detectSemanticTransitions(
  pairs: readonly TransitionRecordPair[],
): readonly SemanticTransition[] {
  const transitions: SemanticTransition[] = [];
  for (const pair of pairs) {
    if (
      pair.baseline.responseSha256 !== pair.candidate.responseSha256 ||
      pair.baseline.scenarioId !== pair.candidate.scenarioId
    ) {
      throw new Error('TRANSITION_RECORD_IDENTITY_MISMATCH');
    }
    const baselineChecks = checkOutcomeMap(pair.baseline);
    const candidateChecks = checkOutcomeMap(pair.candidate);
    const checkIds = [...new Set([...baselineChecks.keys(), ...candidateChecks.keys()])].sort();
    for (const checkId of checkIds) {
      const baselineOutcome = baselineChecks.get(checkId);
      const candidateOutcome = candidateChecks.get(checkId);
      if (baselineOutcome === undefined || candidateOutcome === undefined) {
        throw new Error('TRANSITION_CHECK_SET_MISMATCH');
      }
      if (baselineOutcome === candidateOutcome) continue;
      const failureSignatures = signaturesForCheck(
        pair.baseline.scenarioId,
        checkId,
        pair.response,
      );
      assertKnownFailureSignatures(failureSignatures);
      const partial = {
        kind: 'CHECK_OUTCOME' as const,
        corpusId: pair.corpusId,
        corpusVersion: pair.corpusVersion,
        campaignId: pair.campaignId,
        executionId: pair.executionId,
        responseSha256: pair.baseline.responseSha256,
        scenarioId: pair.baseline.scenarioId,
        checkId,
        baselineCheckerVersion: pair.baselineCheckerVersion,
        candidateCheckerVersion: pair.candidateCheckerVersion,
        baselineOutcome,
        candidateOutcome,
        baselineFailureFamilies: sortedCategories(pair.baseline),
        candidateFailureFamilies: sortedCategories(pair.candidate),
        failureSignatures,
      };
      transitions.push({
        transitionId: sha256(transitionIdentity(partial)),
        ...partial,
        impacts: defaultImpact(true),
      });
    }
    const baselineFamilies = sortedCategories(pair.baseline);
    const candidateFamilies = sortedCategories(pair.candidate);
    if (
      sameStrings(baselineFamilies, candidateFamilies) ||
      transitions.some(
        (transition) =>
          transition.corpusId === pair.corpusId &&
          transition.executionId === pair.executionId &&
          transition.responseSha256 === pair.baseline.responseSha256,
      )
    ) {
      continue;
    }
    const failureSignatures = classifyFailureSignatures({
      scenarioId: pair.baseline.scenarioId,
      response: pair.response,
      checks: pair.candidate.checks,
      promptLeakDetected: pair.candidate.promptLeakDetected,
      leakCategory: pair.candidate.leakCategory,
    });
    const normalizedSignatures =
      failureSignatures.length > 0
        ? failureSignatures
        : (['UNCLASSIFIED_SEMANTIC_CHANGE'] as const);
    assertKnownFailureSignatures(normalizedSignatures);
    const partial = {
      kind: 'FAILURE_TAXONOMY' as const,
      corpusId: pair.corpusId,
      corpusVersion: pair.corpusVersion,
      campaignId: pair.campaignId,
      executionId: pair.executionId,
      responseSha256: pair.baseline.responseSha256,
      scenarioId: pair.baseline.scenarioId,
      checkId: '__failure-taxonomy__',
      baselineCheckerVersion: pair.baselineCheckerVersion,
      candidateCheckerVersion: pair.candidateCheckerVersion,
      baselineOutcome: null,
      candidateOutcome: null,
      baselineFailureFamilies: baselineFamilies,
      candidateFailureFamilies: candidateFamilies,
      failureSignatures: normalizedSignatures,
    };
    transitions.push({
      transitionId: sha256(transitionIdentity(partial)),
      ...partial,
      impacts: defaultImpact(true),
    });
  }
  return transitions.sort((left, right) => left.transitionId.localeCompare(right.transitionId));
}

export function createDraftTransitionOverlay(
  corpusVersion: string,
  transitions: readonly SemanticTransition[],
  overlayVersion = 'stage2a-transition-overlay-v1.0.0-draft',
): TransitionOverlay {
  return {
    schemaVersion: TRANSITION_OVERLAY_SCHEMA_VERSION,
    overlayVersion,
    corpusVersion,
    entries: transitions.map((transition) => ({
      transitionId: transition.transitionId,
      transitionDecision: 'INDETERMINATE',
      failureFamily:
        FAILURE_SIGNATURE_REGISTRY[transition.failureSignatures[0] ?? 'UNCLASSIFIED_SEMANTIC_CHANGE']
          .family,
      failureSignatures: transition.failureSignatures,
      rationaleCode: 'HUMAN_REVIEW_REQUIRED',
      rationale: 'Changed outcome requires independent transition review.',
      reviewStatus: 'DRAFT',
      overlayVersion,
    })),
  };
}

export function validateTransitionOverlay(
  overlay: TransitionOverlay,
  transitions: readonly SemanticTransition[],
): void {
  if (
    overlay.schemaVersion !== TRANSITION_OVERLAY_SCHEMA_VERSION ||
    overlay.overlayVersion.length === 0
  ) {
    throw new Error('TRANSITION_OVERLAY_SCHEMA_INVALID');
  }
  const transitionById = new Map(transitions.map((transition) => [transition.transitionId, transition]));
  const seen = new Set<string>();
  for (const entry of overlay.entries) {
    if (seen.has(entry.transitionId)) throw new Error('TRANSITION_OVERLAY_DUPLICATE');
    seen.add(entry.transitionId);
    const transition = transitionById.get(entry.transitionId);
    if (transition === undefined) throw new Error('TRANSITION_OVERLAY_ORPHAN');
    if (overlay.corpusVersion !== transition.corpusVersion) {
      throw new Error('TRANSITION_OVERLAY_CORPUS_MISMATCH');
    }
    if (entry.overlayVersion !== overlay.overlayVersion) {
      throw new Error('TRANSITION_OVERLAY_VERSION_MISMATCH');
    }
    assertKnownFailureSignatures(entry.failureSignatures);
    if (
      entry.failureSignatures.some(
        (signature) => !transition.failureSignatures.includes(signature),
      )
    ) {
      throw new Error('TRANSITION_OVERLAY_SIGNATURE_MISMATCH');
    }
    if (entry.rationaleCode.length === 0 || entry.rationale.length === 0) {
      throw new Error('TRANSITION_OVERLAY_RATIONALE_MISSING');
    }
  }
  if (seen.size !== transitions.length) throw new Error('TRANSITION_OVERLAY_ENTRY_MISSING');
}

export interface CriticalRecallLock {
  readonly lockId: string;
  readonly corpusId: string;
  readonly campaignId: string;
  readonly executionId: string;
  readonly responseSha256: string;
  readonly scenarioId: ScenarioId;
  readonly checkId: string;
  readonly failureSignature: FailureSignatureId;
  readonly expectedOutcome: 'FAIL';
  readonly rationale: string;
  readonly reviewStatus: 'RATIFIED';
}

export interface CriticalRecallSummary {
  readonly total: number;
  readonly retained: number;
  readonly regressed: number;
  readonly recallPercent: number | null;
  readonly missingRequiredSignatures: readonly FailureSignatureId[];
}

export const REQUIRED_CRITICAL_SIGNATURES: readonly FailureSignatureId[] = Object.freeze([
  'PROMPT_LEAK',
  'MULTI_ENTRY_ECHO',
  'CURRENT_STATE_SCOPE',
  'PRIOR_VERIFICATION',
  'AUTHORITY_SCOPE',
  'TARGET_LOSS',
  'TARGET_REQUESTION',
  'PLATFORM_MISATTRIBUTION',
]);

export function evaluateCriticalRecall(
  pairs: readonly TransitionRecordPair[],
  locks: readonly CriticalRecallLock[],
): CriticalRecallSummary {
  const seenIds = new Set<string>();
  let retained = 0;
  for (const lock of locks) {
    if (seenIds.has(lock.lockId)) throw new Error('CRITICAL_LOCK_DUPLICATE');
    seenIds.add(lock.lockId);
    if (!FAILURE_SIGNATURE_REGISTRY[lock.failureSignature].critical) {
      throw new Error('CRITICAL_LOCK_SIGNATURE_NOT_CRITICAL');
    }
    const pair = pairs.find(
      (candidate) =>
        candidate.corpusId === lock.corpusId &&
        candidate.campaignId === lock.campaignId &&
        candidate.executionId === lock.executionId &&
        candidate.candidate.responseSha256 === lock.responseSha256 &&
        candidate.candidate.scenarioId === lock.scenarioId,
    );
    if (pair === undefined) throw new Error('CRITICAL_LOCK_ORPHAN');
    const safetyRetained =
      lock.failureSignature === 'PROMPT_LEAK'
        ? pair.candidate.promptLeakDetected
        : lock.failureSignature === 'MULTI_ENTRY_ECHO'
          ? pair.candidate.leakCategory === 'MULTI_ENTRY_ECHO'
          : undefined;
    const checkRetained = pair.candidate.checks.find((check) => check.id === lock.checkId)?.outcome;
    if (safetyRetained === true || (safetyRetained === undefined && checkRetained === 'FAIL')) {
      retained += 1;
    }
  }
  const represented = new Set(locks.map((lock) => lock.failureSignature));
  const missingRequiredSignatures = REQUIRED_CRITICAL_SIGNATURES.filter(
    (signature) => !represented.has(signature),
  );
  return {
    total: locks.length,
    retained,
    regressed: locks.length - retained,
    recallPercent:
      locks.length === 0 ? null : Number(((retained / locks.length) * 100).toFixed(4)),
    missingRequiredSignatures,
  };
}

export type SignatureDistribution = Readonly<Record<FailureSignatureId, number>>;

const emptyDistribution = (): Record<FailureSignatureId, number> =>
  Object.fromEntries(
    Object.keys(FAILURE_SIGNATURE_REGISTRY).map((signature) => [signature, 0]),
  ) as Record<FailureSignatureId, number>;

export function buildFailureSignatureDistribution(
  pairs: readonly TransitionRecordPair[],
  evaluator: 'baseline' | 'candidate',
): SignatureDistribution {
  const distribution = emptyDistribution();
  for (const pair of pairs) {
    const record = pair[evaluator];
    const signatures = classifyFailureSignatures({
      scenarioId: record.scenarioId,
      response: pair.response,
      checks: record.checks,
      promptLeakDetected: record.promptLeakDetected,
      leakCategory: record.leakCategory,
    });
    for (const signature of signatures) distribution[signature] += 1;
  }
  return Object.freeze(distribution);
}

export interface FailureSignatureDelta {
  readonly signature: FailureSignatureId;
  readonly baseline: number;
  readonly candidate: number;
  readonly delta: number;
}

export function compareFailureSignatureDistributions(
  baseline: SignatureDistribution,
  candidate: SignatureDistribution,
): readonly FailureSignatureDelta[] {
  return (Object.keys(FAILURE_SIGNATURE_REGISTRY) as FailureSignatureId[]).map(
    (signature) => ({
      signature,
      baseline: baseline[signature],
      candidate: candidate[signature],
      delta: candidate[signature] - baseline[signature],
    }),
  );
}

export interface SemanticChangeSummary {
  readonly fixed: number | null;
  readonly newFalsePositives: number | null;
  readonly newFalseNegatives: number | null;
  readonly newAbstentions: number;
  readonly removedFailureFamilies: readonly FailureCategory[];
  readonly introducedFailureFamilies: readonly FailureCategory[];
  readonly criticalRecall: CriticalRecallSummary;
  readonly transitionCount: number;
  readonly ratifiedTransitionCount: number;
  readonly signatureDistribution: readonly FailureSignatureDelta[];
}

export function buildSemanticChangeSummary(input: {
  readonly transitions: readonly SemanticTransition[];
  readonly overlay: TransitionOverlay;
  readonly criticalRecall: CriticalRecallSummary;
  readonly baselineDistribution: SignatureDistribution;
  readonly candidateDistribution: SignatureDistribution;
}): SemanticChangeSummary {
  validateTransitionOverlay(input.overlay, input.transitions);
  const entries = new Map(input.overlay.entries.map((entry) => [entry.transitionId, entry]));
  const fullyRatified = input.overlay.entries.every(
    (entry) => entry.reviewStatus === 'RATIFIED',
  );
  let fixed = 0;
  let newFalsePositives = 0;
  let newFalseNegatives = 0;
  let newAbstentions = 0;
  const removed = new Set<FailureCategory>();
  const introduced = new Set<FailureCategory>();
  for (const transition of input.transitions) {
    for (const family of transition.baselineFailureFamilies) {
      if (!transition.candidateFailureFamilies.includes(family)) removed.add(family);
    }
    for (const family of transition.candidateFailureFamilies) {
      if (!transition.baselineFailureFamilies.includes(family)) introduced.add(family);
    }
    if (transition.candidateOutcome === 'INDETERMINATE') newAbstentions += 1;
    const entry = entries.get(transition.transitionId);
    if (entry?.reviewStatus !== 'RATIFIED') continue;
    if (entry.transitionDecision === 'APPROVE') {
      fixed += 1;
    } else if (transition.baselineOutcome === 'PASS' && transition.candidateOutcome === 'FAIL') {
      newFalsePositives += 1;
    } else if (
      transition.baselineOutcome === 'FAIL' &&
      (transition.candidateOutcome === 'PASS' || transition.candidateOutcome === 'INDETERMINATE')
    ) {
      newFalseNegatives += 1;
    }
  }
  return {
    fixed: fullyRatified ? fixed : null,
    newFalsePositives: fullyRatified ? newFalsePositives : null,
    newFalseNegatives: fullyRatified ? newFalseNegatives : null,
    newAbstentions,
    removedFailureFamilies: [...removed].sort(),
    introducedFailureFamilies: [...introduced].sort(),
    criticalRecall: input.criticalRecall,
    transitionCount: input.transitions.length,
    ratifiedTransitionCount: input.overlay.entries.filter(
      (entry) => entry.reviewStatus === 'RATIFIED',
    ).length,
    signatureDistribution: compareFailureSignatureDistributions(
      input.baselineDistribution,
      input.candidateDistribution,
    ),
  };
}

export interface PromotionGateResult {
  readonly eligible: boolean;
  readonly provisional: true;
  readonly reasons: readonly string[];
  readonly champions: {
    readonly semanticChampion: null;
    readonly latencyChampion: null;
    readonly overallChampion: null;
  };
  readonly advancement: readonly never[];
}

export function evaluateShadowPromotionGate(input: {
  readonly integrityPassed: boolean;
  readonly deterministic: boolean;
  readonly transitions: readonly SemanticTransition[];
  readonly overlay: TransitionOverlay;
  readonly summary: SemanticChangeSummary;
}): PromotionGateResult {
  validateTransitionOverlay(input.overlay, input.transitions);
  const reasons: string[] = [];
  if (!input.integrityPassed) reasons.push('CORPUS_INTEGRITY_FAILED');
  if (!input.deterministic) reasons.push('REPLAY_NOT_DETERMINISTIC');
  if (input.summary.criticalRecall.total === 0) reasons.push('CRITICAL_LOCKS_MISSING');
  if (input.summary.criticalRecall.missingRequiredSignatures.length > 0) {
    reasons.push('CRITICAL_LOCK_FAMILIES_INCOMPLETE');
  }
  if (input.summary.criticalRecall.regressed > 0) reasons.push('CRITICAL_RECALL_REGRESSION');
  if (input.overlay.entries.some((entry) => entry.reviewStatus !== 'RATIFIED')) {
    reasons.push('UNREVIEWED_TRANSITION');
  }
  if (input.overlay.entries.some((entry) => entry.transitionDecision === 'REJECT')) {
    reasons.push('REJECTED_TRANSITION_PRESENT');
  }
  if (input.overlay.entries.some((entry) => entry.transitionDecision === 'INDETERMINATE')) {
    reasons.push('INDETERMINATE_TRANSITION_PRESENT');
  }
  if ((input.summary.newFalsePositives ?? 0) > 0) reasons.push('NEW_FALSE_POSITIVE');
  if ((input.summary.newFalseNegatives ?? 0) > 0) reasons.push('NEW_FALSE_NEGATIVE');
  if (input.summary.newAbstentions > 0) reasons.push('NEW_ABSTENTION');
  return {
    eligible: reasons.length === 0,
    provisional: true,
    reasons,
    champions: {
      semanticChampion: null,
      latencyChampion: null,
      overallChampion: null,
    },
    advancement: [],
  };
}
