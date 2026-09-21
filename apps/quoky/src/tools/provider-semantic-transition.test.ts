import { describe, expect, it } from 'vitest';
import type { EvidenceRecord } from './provider-semantic-validation';
import {
  buildFailureSignatureDistribution,
  buildSemanticChangeSummary,
  createDraftTransitionOverlay,
  detectSemanticTransitions,
  evaluateCriticalRecall,
  evaluateShadowPromotionGate,
  validateTransitionOverlay,
} from './provider-semantic-transition';
import type {
  CriticalRecallLock,
  TransitionOverlay,
  TransitionRecordPair,
} from './provider-semantic-transition';

const record = (
  response: string,
  outcome: 'PASS' | 'FAIL' | 'INDETERMINATE',
): EvidenceRecord => ({
  scenarioId: 'E',
  callOrdinal: 1,
  head: 'a'.repeat(40),
  providerId: 'ollama-cli',
  model: 'synthetic:model',
  promptBytes: 1,
  promptSha256: 'b'.repeat(64),
  responseBytes: Buffer.byteLength(response),
  responseSha256: 'c'.repeat(64),
  responsePreview: response,
  previewTruncated: false,
  durationMs: 1,
  exitCode: 0,
  checks: [
    { id: 'preserves-atlas-target', outcome: 'PASS' },
    { id: 'no-target-re-question', outcome },
    { id: 'no-current-state-claim', outcome: 'PASS' },
    { id: 'status-uncertainty-present', outcome: 'PASS' },
  ],
  automatedVerdict:
    outcome === 'FAIL'
      ? 'AUTOMATED_FAIL'
      : outcome === 'INDETERMINATE'
        ? 'HUMAN_REVIEW_REQUIRED'
        : 'AUTOMATED_PASS',
  humanVerdict: 'PENDING',
  promptLeakDetected: false,
  leakCategory: null,
});

const pair = (): TransitionRecordPair => {
  const response = 'Service Atlas is unverified. What do you mean by "currently connected"?';
  return {
    corpusId: 'A3',
    corpusVersion: 'golden-v1',
    campaignId: 'campaign-a3',
    executionId: 'execution-1',
    response,
    baselineCheckerVersion: 'v3',
    candidateCheckerVersion: 'v4',
    baseline: record(response, 'FAIL'),
    candidate: record(response, 'PASS'),
  };
};

describe('transition approval layer', () => {
  it('extracts changed outcomes with one or more registered failure signatures', () => {
    const transitions = detectSemanticTransitions([pair()]);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      baselineOutcome: 'FAIL',
      candidateOutcome: 'PASS',
      checkId: 'no-target-re-question',
    });
    expect(transitions[0]?.failureSignatures).toEqual(
      expect.arrayContaining(['TARGET_REQUESTION', 'PREDICATE_REDEFINITION']),
    );
  });

  it('creates a complete draft overlay and blocks provisional promotion', () => {
    const pairs = [pair()];
    const transitions = detectSemanticTransitions(pairs);
    const overlay = createDraftTransitionOverlay('golden-v1', transitions);
    expect(() => validateTransitionOverlay(overlay, transitions)).not.toThrow();
    const criticalRecall = evaluateCriticalRecall(pairs, []);
    const summary = buildSemanticChangeSummary({
      transitions,
      overlay,
      criticalRecall,
      baselineDistribution: buildFailureSignatureDistribution(pairs, 'baseline'),
      candidateDistribution: buildFailureSignatureDistribution(pairs, 'candidate'),
    });
    expect(summary).toMatchObject({
      fixed: null,
      newFalsePositives: null,
      newFalseNegatives: null,
      transitionCount: 1,
      ratifiedTransitionCount: 0,
    });
    expect(
      evaluateShadowPromotionGate({
        integrityPassed: true,
        deterministic: true,
        transitions,
        overlay,
        summary,
      }),
    ).toMatchObject({
      eligible: false,
      provisional: true,
      advancement: [],
      champions: {
        semanticChampion: null,
        latencyChampion: null,
        overallChampion: null,
      },
    });
  });

  it('requires every transition and overlay signature to match', () => {
    const transitions = detectSemanticTransitions([pair()]);
    const draft = createDraftTransitionOverlay('golden-v1', transitions);
    const invalid: TransitionOverlay = { ...draft, entries: [] };
    expect(() => validateTransitionOverlay(invalid, transitions)).toThrow(
      'TRANSITION_OVERLAY_ENTRY_MISSING',
    );
  });

  it('counts a ratified critical FAIL to PASS transition as recall regression', () => {
    const source = pair();
    const lock: CriticalRecallLock = {
      lockId: 'lock-1',
      corpusId: source.corpusId,
      campaignId: source.campaignId,
      executionId: source.executionId,
      responseSha256: source.candidate.responseSha256,
      scenarioId: 'E',
      checkId: 'no-target-re-question',
      failureSignature: 'TARGET_REQUESTION',
      expectedOutcome: 'FAIL',
      rationale: 'Synthetic fixed-target re-question lock.',
      reviewStatus: 'RATIFIED',
    };
    expect(evaluateCriticalRecall([source], [lock])).toMatchObject({
      total: 1,
      retained: 0,
      regressed: 1,
      recallPercent: 0,
    });
  });

  it('reports absent lock families without requiring fabricated Golden violations', () => {
    const overlay: TransitionOverlay = {
      schemaVersion: 'stage2a-transition-overlay-v1',
      overlayVersion: 'overlay-v1.0.0',
      corpusVersion: 'golden-v1',
      entries: [],
    };
    const summary = {
      fixed: 0,
      newFalsePositives: 0,
      newFalseNegatives: 0,
      newAbstentions: 0,
      removedFailureFamilies: [],
      introducedFailureFamilies: [],
      criticalRecall: {
        total: 1,
        retained: 1,
        regressed: 0,
        recallPercent: 100,
        missingRequiredSignatures: ['PROMPT_LEAK' as const],
      },
      transitionCount: 0,
      ratifiedTransitionCount: 0,
      signatureDistribution: [],
    };
    expect(
      evaluateShadowPromotionGate({
        integrityPassed: true,
        deterministic: true,
        transitions: [],
        overlay,
        summary,
      }),
    ).toMatchObject({ eligible: true, reasons: [] });
  });
});
