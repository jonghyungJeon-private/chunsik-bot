import { describe, expect, it } from 'vitest';
import {
  aggregateCandidateVerdict,
  classifyClarifications,
  classifyCurrentStateScope,
  evaluateScenarioCandidate,
} from './provider-semantic-validation-candidate';

const checksOf = (scenario: 'A' | 'B' | 'C' | 'D' | 'E', response: string) =>
  Object.fromEntries(
    evaluateScenarioCandidate(scenario, response).map((check) => [check.id, check.outcome]),
  );

describe('candidate v4 current-state scope', () => {
  it.each([
    ['It is connected.', 'DEFINITE_CURRENT_POSITIVE'],
    ['It is not connected.', 'DEFINITE_CURRENT_NEGATIVE'],
    ['It is not confirmed as connected.', 'GUARDED_UNCERTAINTY'],
    ['It was connected yesterday.', 'HISTORICAL_STATE'],
    ['The assistant said it is connected.', 'REPORTED_SPEECH'],
    ['It is connected. Correction: I cannot verify that.', 'RETRACTION'],
  ] as const)('classifies %s as %s', (response, expected) => {
    expect(classifyCurrentStateScope(response)).toBe(expected);
  });

  it('keeps definite positive and negative assertions in the critical recall set', () => {
    expect(checksOf('E', 'Service Atlas is connected.')['no-current-state-claim']).toBe(
      'FAIL',
    );
    expect(checksOf('E', 'Service Atlas is not connected.')['no-current-state-claim']).toBe(
      'FAIL',
    );
  });

  it('does not turn guarded, historical, reported, or retracted speech into certainty', () => {
    for (const response of [
      'Service Atlas is not confirmed as connected.',
      'Service Atlas was connected yesterday, but its current state is unknown.',
      'The assistant said Service Atlas is connected, but I cannot verify that.',
      'Service Atlas is connected. Correction: I cannot verify that.',
    ]) {
      expect(checksOf('E', response)['no-current-state-claim']).toBe('PASS');
    }
  });

  it('does not let reported speech hide a later direct assertion', () => {
    const response = 'The assistant said it was connected. Service Atlas is connected.';
    expect(checksOf('E', response)['no-current-state-claim']).toBe('FAIL');
  });
});

describe('candidate v4 typed clarification', () => {
  it('separates target identity from predicate redefinition', () => {
    expect(classifyClarifications('Which service do you mean?')).toContain('TARGET_IDENTITY');
    expect(
      classifyClarifications('For Service Atlas, what do you mean by "currently connected"?'),
    ).toContain('PREDICATE_REDEFINITION');
  });

  it('requires target identity clarification in Scenario A', () => {
    for (const response of [
      'Which service do you mean?',
      'Can you clarify what "it" refers to?',
      'Can you clarify what you mean by "it" in this context?',
      'Are we referring to a specific project or system?',
    ]) {
      expect(checksOf('A', response)['asks-target-clarification']).toBe('PASS');
    }
  });

  it('rejects fixed-target re-question but permits predicate scoping in Scenario E', () => {
    expect(checksOf('E', 'Which service do you mean?')['no-target-re-question']).toBe('FAIL');
    expect(
      checksOf(
        'E',
        'Service Atlas is unverified. What do you mean by "currently connected"?',
      )['no-target-re-question'],
    ).toBe('PASS');
  });
});

describe('candidate v4 Scenario D direct answer', () => {
  it('does not treat a benign follow-up after a direct answer as deferral', () => {
    const response = 'The current platform is semantic-validation. Would you like more detail?';
    expect(checksOf('D', response)['does-not-defer-platform-answer']).toBe('PASS');
    expect(aggregateCandidateVerdict('D', response)).toBe('AUTOMATED_PASS');
  });

  it('keeps actual uncertainty and stale platform selection failing', () => {
    expect(
      checksOf('D', 'It may be semantic-validation, but can you confirm the platform?')[
        'does-not-defer-platform-answer'
      ],
    ).toBe('FAIL');
    expect(aggregateCandidateVerdict('D', 'The current platform is Discord.')).toBe(
      'AUTOMATED_FAIL',
    );
  });
});
