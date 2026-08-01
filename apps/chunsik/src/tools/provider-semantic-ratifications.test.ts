import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FAILURE_SIGNATURE_REGISTRY } from './provider-failure-signatures';
import type {
  CriticalRecallLock,
  TransitionOverlay,
} from './provider-semantic-transition';

const ratificationPath = (name: string): string =>
  resolve(__dirname, 'provider-semantic-ratifications', name);

const readJson = <T>(name: string): T =>
  JSON.parse(readFileSync(ratificationPath(name), 'utf8')) as T;

describe('Stage 2A Golden ratification artifacts', () => {
  it('records every reviewed transition with a ratified decision and signature', () => {
    const overlay = readJson<TransitionOverlay>(
      'stage2a-a1-a3-v4-transition-overlay.json',
    );
    const decisions = overlay.entries.map((entry) => entry.transitionDecision);

    expect(overlay.corpusVersion).toBe('stage2a-a1-a3-golden-v1');
    expect(new Set(overlay.entries.map((entry) => entry.transitionId))).toHaveLength(25);
    expect(decisions.filter((decision) => decision === 'APPROVE')).toHaveLength(22);
    expect(decisions.filter((decision) => decision === 'REJECT')).toHaveLength(3);
    expect(decisions).not.toContain('INDETERMINATE');
    for (const entry of overlay.entries) {
      expect(entry.reviewStatus).toBe('RATIFIED');
      expect(entry.failureSignatures.length).toBeGreaterThan(0);
      expect(entry.rationale.length).toBeGreaterThan(0);
      for (const signature of entry.failureSignatures) {
        expect(FAILURE_SIGNATURE_REGISTRY[signature]).toBeDefined();
      }
    }
  });

  it('preserves ratified decisions in the remediation amendment and drafts new deltas', () => {
    const overlay = readJson<TransitionOverlay>(
      'stage2a-a1-a3-v4-transition-overlay-v1.1.0.json',
    );
    const ratified = overlay.entries.filter((entry) => entry.reviewStatus === 'RATIFIED');
    const drafts = overlay.entries.filter((entry) => entry.reviewStatus === 'DRAFT');

    expect(overlay.overlayVersion).toBe(
      'stage2a-a1-a3-v4-transition-overlay-v1.1.0',
    );
    expect(overlay.entries).toHaveLength(25);
    expect(ratified).toHaveLength(23);
    expect(ratified.every((entry) => entry.transitionDecision === 'APPROVE')).toBe(true);
    expect(drafts).toHaveLength(2);
    expect(drafts.every((entry) => entry.transitionDecision === 'INDETERMINATE')).toBe(
      true,
    );
  });

  it('locks only ratified violations that actually occur in the Golden Corpus', () => {
    const locks = readJson<readonly CriticalRecallLock[]>(
      'stage2a-a1-a3-v4-critical-locks.json',
    );
    const absentCorpusSignatures = [
      'PROMPT_LEAK',
      'MULTI_ENTRY_ECHO',
      'PLATFORM_MISATTRIBUTION',
    ];

    expect(locks).toHaveLength(5);
    expect(new Set(locks.map((lock) => lock.lockId))).toHaveLength(5);
    for (const lock of locks) {
      expect(lock.reviewStatus).toBe('RATIFIED');
      expect(lock.expectedOutcome).toBe('FAIL');
      expect(lock.rationale.length).toBeGreaterThan(0);
    }
    expect(locks.map((lock) => lock.failureSignature)).toEqual(
      expect.arrayContaining([
        'CURRENT_STATE_SCOPE',
        'PRIOR_VERIFICATION',
        'AUTHORITY_SCOPE',
        'TARGET_LOSS',
        'TARGET_REQUESTION',
      ]),
    );
    expect(locks.map((lock) => lock.failureSignature)).not.toEqual(
      expect.arrayContaining(absentCorpusSignatures),
    );
  });
});
