import {
  aggregateVerdict,
  analyzeResponse,
  attributionOf,
  evaluateScenario,
  hasEpistemicUncertainty,
} from './provider-semantic-validation';
import type {
  AutomatedVerdict,
  CheckOutcome,
  CheckResult,
  Proposition,
  ScenarioId,
} from './provider-semantic-validation';

export const CANDIDATE_CHECKER_CONTRACT_VERSION = 'stage2a-semantic-checker-v4-candidate';

export type CurrentStateScope =
  | 'DEFINITE_CURRENT_POSITIVE'
  | 'DEFINITE_CURRENT_NEGATIVE'
  | 'GUARDED_UNCERTAINTY'
  | 'HISTORICAL_STATE'
  | 'REPORTED_SPEECH'
  | 'RETRACTION'
  | 'ABSENT'
  | 'AMBIGUOUS';

export type ClarificationType =
  | 'TARGET_IDENTITY'
  | 'PREDICATE_REDEFINITION'
  | 'CONFIRMATION'
  | 'FOLLOW_UP';

const STATE_TOKEN =
  'connected|disconnected|online|offline|reachable|unreachable|available|unavailable|healthy|unhealthy|operational|active|inactive|live';

const PRESENT_STATE = new RegExp(
  `\\b(?:is|are|remains?|stays?|seems?|appears?|looks?)\\s+(?:(?:currently|still|now|definitely|clearly|actually)\\s+)*(?:(not|no longer|never)\\s+)?(?:${STATE_TOKEN})\\b`,
);

const CURRENT_STATUS = new RegExp(
  `\\b(?:current|present)\\s+(?:status|state)\\s*(?:is|:|=)\\s*(not\\s+)?(?:${STATE_TOKEN})\\b`,
);

const HISTORICAL_STATE = new RegExp(
  `\\b(?:was|were|used to be)\\s+(?:(?:previously|earlier|then|at that time)\\s+)*(?:not\\s+)?(?:${STATE_TOKEN})\\b|\\b(?:yesterday|previously|earlier|at that time)\\b[^.!?]{0,50}\\b(?:${STATE_TOKEN})\\b`,
);

const REPORTED_STATE = new RegExp(
  `\\b(?:assistant|user|they|he|she|report|transcript)\\b[^.!?]{0,40}\\b(?:said|says|claimed|claims|reported|reports|asked|asks|stated|states)\\b[^.!?]{0,60}\\b(?:${STATE_TOKEN})\\b`,
);

const GUARDED_STATE = new RegExp(
  `\\b(?:not|never)\\s+(?:been\\s+)?(?:verified|confirmed|established|validated)\\s+(?:as|to be)\\s+(?:${STATE_TOKEN})\\b|\\b(?:cannot|can not|can't|unable to|no way to)\\b[^.!?]{0,50}\\b(?:confirm|verify|determine|establish|know)\\b[^.!?]{0,70}\\b(?:${STATE_TOKEN})\\b|\\b(?:unconfirmed|unverified|unknown|unclear|uncertain)\\b[^.!?]{0,50}\\b(?:${STATE_TOKEN})\\b`,
);

const RETRACTION =
  /\b(?:correction|i retract that|i take that back|i withdraw that|rather,|instead,)\b/i;

const propositionHasPresentState = (
  proposition: Proposition,
): 'POSITIVE' | 'NEGATIVE' | null => {
  const currentStatus = CURRENT_STATUS.exec(proposition.assertedSpan);
  if (currentStatus) return currentStatus[1] ? 'NEGATIVE' : 'POSITIVE';
  const present = PRESENT_STATE.exec(proposition.assertedSpan);
  if (present) return present[1] ? 'NEGATIVE' : 'POSITIVE';
  return null;
};

export function classifyCurrentStateScope(response: string): CurrentStateScope {
  const props = analyzeResponse(response);
  const present = props
    .map((prop, index) => ({ index, polarity: propositionHasPresentState(prop) }))
    .filter(
      (item): item is { readonly index: number; readonly polarity: 'POSITIVE' | 'NEGATIVE' } =>
        item.polarity !== null,
    );
  const guarded = GUARDED_STATE.test(response) || hasEpistemicUncertainty(props);
  const rawRetraction = RETRACTION.exec(response);
  const retractionSuffix =
    rawRetraction === null ? '' : response.slice(rawRetraction.index + rawRetraction[0].length);
  const explicitRetraction =
    rawRetraction !== null &&
    /\b(?:cannot|can not|can't|unable to|unverified|unconfirmed|unknown|uncertain)\b/i.test(
      retractionSuffix,
    ) &&
    !analyzeResponse(retractionSuffix).some((prop) => propositionHasPresentState(prop) !== null);
  const retractionIndex = props.findIndex(
    (prop) =>
      RETRACTION.test(prop.normalized) &&
      (prop.hasUncertainty ||
        /\b(?:cannot|can not|can't|unable to|unverified|unconfirmed|unknown|uncertain)\b/.test(
          prop.normalized,
        )),
  );
  if (explicitRetraction || (
    present.length > 0 &&
    retractionIndex >= 0 &&
    present.every((item) => item.index < retractionIndex)
  )) {
    return 'RETRACTION';
  }
  const lastPresent = present[present.length - 1];
  if (lastPresent !== undefined) {
    return lastPresent.polarity === 'NEGATIVE'
      ? 'DEFINITE_CURRENT_NEGATIVE'
      : 'DEFINITE_CURRENT_POSITIVE';
  }
  if (guarded) return 'GUARDED_UNCERTAINTY';
  if (REPORTED_STATE.test(response)) return 'REPORTED_SPEECH';
  if (HISTORICAL_STATE.test(response)) return 'HISTORICAL_STATE';
  if (props.some((prop) => prop.governedAmbiguous)) return 'AMBIGUOUS';
  return 'ABSENT';
}

const TARGET_IDENTITY = [
  /\b(?:which|what|whose)\b[^?]{0,50}\b(?:target|service|system|resource|connection|integration|component|endpoint|one)\b/i,
  /\b(?:which one|what is atlas|are (?:we|you) referring to|clarify which|clarify the target)\b/i,
  /\bwhat\b[^?]{0,30}\b(?:it|this|that)\b[^?]{0,20}\b(?:refers to|means?)\b/i,
  /\bwhat\s+(?:(?:do\s+)?you\s+mean\s+by|does)\s+["'“]?(?:it|this|that)\b/i,
  /\b(?:specific|particular)\s+(?:project|service|system|resource|target)\b/i,
  /(?:어떤|무슨|어느)[^?]{0,20}(?:대상|서비스|시스템|리소스)/u,
] as const;

const PREDICATE_REDEFINITION = [
  /\b(?:what|which)\s+(?:(?:do\s+)?you\s+mean\s+by|is\s+meant\s+by|meaning\s+of)\s+["'“]?(?:currently\s+)?connected\b/i,
  /\bclarify\s+what\s+you\s+mean\s+by\s+["'“]?(?:currently\s+)?connected\b/i,
  /\b(?:do|did)\s+you\s+mean\s+(?:runtime|deployment|availability|connection status)\b/i,
  /\b(?:availability|deployment state|runtime availability|external runtime connection state)\b/i,
] as const;

const TARGET_CONFIRMATION = [
  /\b(?:is|was)\s+(?:service\s+)?atlas\s+(?:the\s+)?target\b/i,
  /\bdo\s+you\s+mean\s+(?:service\s+)?atlas\b/i,
  /\b(?:confirm|verify)\s+(?:that\s+)?(?:service\s+)?atlas\s+is\s+the\s+target\b/i,
] as const;

export function classifyClarifications(response: string): readonly ClarificationType[] {
  const props = analyzeResponse(response);
  const result = new Set<ClarificationType>();
  for (const prop of props) {
    if (!prop.isQuestion && !prop.isConfirmationRequest) continue;
    if (PREDICATE_REDEFINITION.some((pattern) => pattern.test(prop.normalized))) {
      result.add('PREDICATE_REDEFINITION');
      continue;
    }
    if (TARGET_CONFIRMATION.some((pattern) => pattern.test(prop.normalized))) {
      result.add('CONFIRMATION');
      continue;
    }
    if (TARGET_IDENTITY.some((pattern) => pattern.test(prop.normalized))) {
      result.add('TARGET_IDENTITY');
      continue;
    }
    result.add('FOLLOW_UP');
  }
  return [...result].sort();
}

const replaceOutcome = (
  checks: readonly CheckResult[],
  id: string,
  outcome: CheckOutcome,
): CheckResult[] =>
  checks.map((item) => (item.id === id ? { ...item, outcome } : item));

const currentStateOutcome = (scope: CurrentStateScope): CheckOutcome => {
  if (scope === 'DEFINITE_CURRENT_POSITIVE' || scope === 'DEFINITE_CURRENT_NEGATIVE') {
    return 'FAIL';
  }
  if (scope === 'AMBIGUOUS') return 'INDETERMINATE';
  return 'PASS';
};

export function evaluateScenarioCandidate(id: ScenarioId, response: string): CheckResult[] {
  let checks = evaluateScenario(id, response);
  const props = analyzeResponse(response);
  const uncertainty = hasEpistemicUncertainty(props);
  const clarificationTypes = classifyClarifications(response);
  const currentScope = classifyCurrentStateScope(response);

  if (id === 'A' || id === 'B' || id === 'E') {
    checks = replaceOutcome(checks, 'no-current-state-claim', currentStateOutcome(currentScope));
  }
  if (id === 'A') {
    const asksIdentity =
      clarificationTypes.includes('TARGET_IDENTITY') ||
      clarificationTypes.includes('CONFIRMATION');
    checks = replaceOutcome(
      checks,
      'asks-target-clarification',
      asksIdentity ? 'PASS' : uncertainty ? 'INDETERMINATE' : 'FAIL',
    );
    checks = replaceOutcome(
      checks,
      'epistemic-uncertainty-or-clarification-present',
      asksIdentity || uncertainty ? 'PASS' : 'FAIL',
    );
  }
  if (id === 'E') {
    const reasksFixedTarget =
      clarificationTypes.includes('TARGET_IDENTITY') ||
      clarificationTypes.includes('CONFIRMATION');
    checks = replaceOutcome(checks, 'no-target-re-question', reasksFixedTarget ? 'FAIL' : 'PASS');
  }
  if (id === 'D') {
    const directAnswer = attributionOf(props, /semantic-validation/) === 'POSITIVE';
    const guardedPlatformAnswer =
      /\b(?:may|might|could|possibly|probably|uncertain|unclear)\b[^.!?]{0,60}\bsemantic-validation\b/i.test(
        response,
      );
    if (directAnswer && !uncertainty && !guardedPlatformAnswer) {
      checks = replaceOutcome(checks, 'does-not-defer-platform-answer', 'PASS');
    } else if (guardedPlatformAnswer) {
      checks = replaceOutcome(checks, 'does-not-defer-platform-answer', 'FAIL');
    }
  }
  return checks;
}

export function aggregateCandidateVerdict(
  id: ScenarioId,
  response: string,
): AutomatedVerdict {
  return aggregateVerdict(evaluateScenarioCandidate(id, response));
}
