import {
  V4_CHECKER_CONTRACT_VERSION,
  evaluateScenarioV4,
} from './provider-semantic-validation-candidate';
import {
  V3_CHECKER_CONTRACT_VERSION,
  evaluateScenarioV3,
} from './provider-semantic-validation';
import type { SemanticEvaluator } from './provider-semantic-validation';

export type SemanticCheckerVersion =
  | typeof V3_CHECKER_CONTRACT_VERSION
  | typeof V4_CHECKER_CONTRACT_VERSION;

export const V3_SEMANTIC_EVALUATOR: SemanticEvaluator = Object.freeze({
  checkerContractVersion: V3_CHECKER_CONTRACT_VERSION,
  evaluateScenario: evaluateScenarioV3,
});

export const V4_SEMANTIC_EVALUATOR: SemanticEvaluator = Object.freeze({
  checkerContractVersion: V4_CHECKER_CONTRACT_VERSION,
  evaluateScenario: evaluateScenarioV4,
});

export const DEFAULT_SEMANTIC_EVALUATOR = V4_SEMANTIC_EVALUATOR;
export const CHECKER_CONTRACT_VERSION = V4_CHECKER_CONTRACT_VERSION;

export function evaluatorForVersion(version: SemanticCheckerVersion): SemanticEvaluator {
  return version === V3_CHECKER_CONTRACT_VERSION
    ? V3_SEMANTIC_EVALUATOR
    : V4_SEMANTIC_EVALUATOR;
}
