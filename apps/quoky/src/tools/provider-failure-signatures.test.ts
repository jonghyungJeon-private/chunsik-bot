import { describe, expect, it } from 'vitest';
import {
  FAILURE_SIGNATURE_REGISTRY,
  classifyFailureSignatures,
  signaturesForCheck,
} from './provider-failure-signatures';

describe('failure signature registry', () => {
  it('uses one shared vocabulary across all four comparison layers', () => {
    for (const definition of Object.values(FAILURE_SIGNATURE_REGISTRY)) {
      expect(definition.layers).toEqual(['Provider', 'Prompt', 'Evaluator', 'Benchmark']);
    }
  });

  it('classifies predicate redefinition without losing target-requestion context', () => {
    expect(
      signaturesForCheck(
        'E',
        'no-target-re-question',
        'Service Atlas is unverified. What do you mean by "currently connected"?',
      ),
    ).toEqual(expect.arrayContaining(['PREDICATE_REDEFINITION', 'TARGET_REQUESTION']));
  });

  it('classifies Provider response failures using the same signature ids', () => {
    expect(
      classifyFailureSignatures({
        scenarioId: 'B',
        response: 'The assistant said it is connected.',
        checks: [{ id: 'no-assistant-authority-grounding', outcome: 'FAIL' }],
      }),
    ).toEqual(expect.arrayContaining(['AUTHORITY_SCOPE', 'REPORTED_SPEECH']));
  });

  it('keeps prompt leak and multi-entry echo as critical signatures', () => {
    const signatures = classifyFailureSignatures({
      scenarioId: 'A',
      response: 'bounded response',
      checks: [],
      promptLeakDetected: true,
      leakCategory: 'MULTI_ENTRY_ECHO',
    });
    expect(signatures).toEqual(expect.arrayContaining(['PROMPT_LEAK', 'MULTI_ENTRY_ECHO']));
    expect(FAILURE_SIGNATURE_REGISTRY.PROMPT_LEAK.critical).toBe(true);
    expect(FAILURE_SIGNATURE_REGISTRY.MULTI_ENTRY_ECHO.critical).toBe(true);
  });
});
