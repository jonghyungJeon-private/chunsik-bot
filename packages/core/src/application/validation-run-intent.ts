import { hasCoLocatedUnnegated, unnegatedMatch } from './intent-negation';

export interface ExplicitValidationKinds {
  readonly test: boolean;
  readonly typecheck: boolean;
}

const TEST_NOUN = /(테스트|\btests?\b)/i;
const TYPECHECK_NOUN = /(typecheck|타입\s*체크|type\s*check)/i;

/**
 * Request-shaped validation action. The expression is deliberately anchored to the end of a clause:
 * descriptive forms such as "실행 결과", "돌리는 방법", and "돌려야 안전하다" are topics, not commands.
 */
const RUN_ACTION_REQUEST =
  /(?:실행\s*(?:해(?:\s*(?:줘|주세요|봐|보세요|줄래|주실래요?))?|하(?:세요|자|라)|시켜\s*(?:줘|주세요))?|실행\s*부탁해|돌려(?:\s*(?:줘|주세요|봐|보세요|줄래|주실래요?|라))?|돌려\s*줄\s*수\s*있어(?:요)?|돌리(?:자|세요)|돌려\s*보자)\s*$|^\s*(?:please\s+|(?:can|could|would|will)\s+you\s+)?run\b/i;

/** A named validation operation can naturally use generic Korean "해줘" request semantics. */
const DIRECT_TYPECHECK_REQUEST =
  /(?:typecheck|타입\s*체크|type\s*check)\s*(?:를|을|은|는)?\s*(?:해(?:\s*(?:줘|주세요|봐|보세요|줄래|주실래요?))?|하(?:세요|자|라)|부탁해)\s*$/i;
const DIRECT_PNPM_TEST_REQUEST =
  /\bpnpm\s+test\b\s*(?:를|을|은|는)?\s*(?:해(?:\s*(?:줘|주세요|봐|보세요|줄래|주실래요?))?|하(?:세요|자|라)|부탁해)\s*$/i;

/** A bare, exact allow-listed command string is itself an unambiguous execution request. */
const BARE_PNPM_TEST = /^\s*pnpm\s+test\s*$/i;
const BARE_PNPM_TYPECHECK = /^\s*pnpm\s+typecheck\s*$/i;

/**
 * Detect explicit test/typecheck execution semantics without deciding how a caller handles both kinds.
 * Both IntentClassifier and the WORKSPACE_APPLIED runtime gate use this function so neither path can fall
 * back to topic-keyword presence.
 */
export function detectExplicitValidationKinds(text: string): ExplicitValidationKinds {
  const test =
    BARE_PNPM_TEST.test(text) ||
    hasCoLocatedUnnegated(text, TEST_NOUN, RUN_ACTION_REQUEST) ||
    unnegatedMatch(text, [DIRECT_PNPM_TEST_REQUEST]);
  const typecheck =
    BARE_PNPM_TYPECHECK.test(text) ||
    hasCoLocatedUnnegated(text, TYPECHECK_NOUN, RUN_ACTION_REQUEST) ||
    unnegatedMatch(text, [DIRECT_TYPECHECK_REQUEST]);

  return { test, typecheck };
}
