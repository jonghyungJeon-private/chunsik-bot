import { hasCoLocatedUnnegated } from './intent-negation';

export interface ExplicitValidationKinds {
  readonly test: boolean;
  readonly typecheck: boolean;
}

const TEST_NOUN = /(테스트|\btests?\b)/i;
const TYPECHECK_NOUN = /(typecheck|타입\s*체크|type\s*check)/i;

const POLITE_REQUEST_TAIL =
  String.raw`(?:줘|주세요|주십시오|봐(?:\s*주세요)?|보세요|줄래(?:요)?|주실래요?|주시겠어요|줄\s*수\s*있(?:어(?:요)?|나요)|주실\s*수\s*있(?:나요|어요|습니까))`;

/**
 * Request-shaped validation action. A run verb must finish the clause as either a direct imperative or a
 * Korean request construction. The shared tail models the auxiliary structure instead of enumerating whole
 * phrases, so honorific forms remain requests while descriptive forms ("실행 결과", "돌리는 방법",
 * "돌려야 안전하다") remain topics.
 */
const RUN_ACTION_REQUEST = new RegExp(
  String.raw`(?:실행\s*(?:해(?:\s*(?:${POLITE_REQUEST_TAIL}))?|하(?:세요|자|라)|시켜\s*(?:줘|주세요))|실행\s*부탁해|돌려(?:\s*(?:${POLITE_REQUEST_TAIL}|라))?|돌리(?:자|세요)|돌려\s*보자)\s*$|^\s*(?:please\s+|(?:can|could|would|will)\s+you\s+)?run\b`,
  'i',
);

/** Bare imperatives are not requests when their clause is explicitly framed as an information question. */
const INFORMATION_QUESTION = /(?:왜|어떻게|언제|어디서|누가)|\b(?:why|how|when|where|who)\b/i;

/** A named validation operation can naturally use generic Korean "해줘" request semantics. */
const INTERVENING_REQUEST_WORDS = String.raw`(?:(?:를|을|은|는)\s*)?(?:(?:좀|한번|빨리|전체|지금)\s*)*`;
const DIRECT_TEST_REQUEST = new RegExp(
  String.raw`(?:테스트|\btests?\b)\s*${INTERVENING_REQUEST_WORDS}(?:해(?:\s*(?:${POLITE_REQUEST_TAIL}))?|하(?:세요|자|라|십시오)|부탁해(?:요)?)\s*$`,
  'i',
);
const DIRECT_TYPECHECK_REQUEST = new RegExp(
  String.raw`(?:typecheck|타입\s*체크|type\s*check)\s*${INTERVENING_REQUEST_WORDS}(?:해(?:\s*(?:${POLITE_REQUEST_TAIL}))?|하(?:세요|자|라|십시오)|부탁해(?:요)?)\s*$`,
  'i',
);
const DIRECT_PNPM_TEST_REQUEST = new RegExp(
  String.raw`\bpnpm\s+test\b\s*${INTERVENING_REQUEST_WORDS}(?:해(?:\s*(?:${POLITE_REQUEST_TAIL}))?|하(?:세요|자|라)|부탁해)\s*$`,
  'i',
);

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
    hasCoLocatedUnnegated(text, TEST_NOUN, RUN_ACTION_REQUEST, INFORMATION_QUESTION) ||
    hasCoLocatedUnnegated(text, TEST_NOUN, DIRECT_TEST_REQUEST, INFORMATION_QUESTION) ||
    hasCoLocatedUnnegated(text, /\bpnpm\s+test\b/i, DIRECT_PNPM_TEST_REQUEST, INFORMATION_QUESTION);
  const typecheck =
    BARE_PNPM_TYPECHECK.test(text) ||
    hasCoLocatedUnnegated(text, TYPECHECK_NOUN, RUN_ACTION_REQUEST, INFORMATION_QUESTION) ||
    hasCoLocatedUnnegated(text, TYPECHECK_NOUN, DIRECT_TYPECHECK_REQUEST, INFORMATION_QUESTION);

  return { test, typecheck };
}
