import { createHash } from 'node:crypto';
import type { Artifact } from '../domain';
import {
  BoundedProviderArtifact,
  BoundedProviderOutput,
  ResponseValidationReasonCode,
  ROUTING_RESPONSE_RULE_CONTRACT_VERSION,
  RuntimeValidationInputView,
  RuntimeValidationResult,
  RuntimeValidationRule,
  ValidationDisposition,
} from './runtime-response-validation-contracts';
import { ValidationProfileRegistry } from './validation-profile-registry';

const TOKEN_WINDOW_SIZE = 12;
const MIN_ECHO_ENTRY_CHARACTERS = 24;
const MIN_MULTI_ENTRY_ECHO_CHARACTERS = 48;
const MIN_PROMPT_EXACT_CHARACTERS = 16;
const MAX_RECENCY_FACT_CHARACTERS = 4_096;
const MAX_RECENCY_KEYWORDS = 24;
const MIN_RECENCY_RELEVANCE_KEYWORD_CHARACTERS = 3;

const RECENCY_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from', 'has', 'have',
  'i', 'in', 'is', 'it', 'my', 'of', 'on', 'or', 'said', 'says', 'that', 'the', 'this', 'to',
  'turn', 'user', 'was', 'were', 'with', 'you', 'your', 'current', 'previous', 'recent', '그',
  '그거', '그것', '그리고', '가장', '나는', '내가', '너는', '네가', '말', '바로', '사용자', '이',
  '이거', '이것', '저', '저거', '저것', '최근', '현재', '턴',
]);
const KOREAN_SUFFIXES = Object.freeze([
  '에게서', '이라고', '이라는', '으로는', '에서는', '으로', '에서', '에게', '한테', '처럼', '까지',
  '부터', '보다', '하고', '이나', '라도', '이랑', '랑', '로', '은', '는', '이', '가', '을', '를',
  '의', '에', '와', '과', '도', '만', '야',
]);
const EXPLICIT_RECENCY_REFERENCE =
  /(?:그(?:거|것|걸|게|건)|이(?:거|것|걸|게|건)|저(?:거|것|걸|게|건)|방금|아까|위(?:에|에서)|앞서|전에\s*(?:말|얘기)|(?:뭐|무엇|어떻|어디|누구)(?:였|했|였었)?지|\b(?:that|above|earlier|previous(?:ly)?|you said|what (?:i|we|you) said)\b)/iu;
const GREETING_OR_ACKNOWLEDGEMENT =
  /^(?:안녕(?:하세요|하십니까)?|반가워(?:요)?|감사(?:합니다|해요)?|고마워(?:요)?|네|넵|예|응|어|알겠(?:어|어요|습니다)|좋아(?:요)?|okay|ok|thanks?(?: you)?|thank you|hello|hi|hey|got it|sounds good)[\s.!?,~]*$/iu;
const NEGATION =
  /(?:\b(?:not|never|no|isn't|aren't|wasn't|weren't|don't|doesn't|didn't|cannot|can't)\b|(?:^|\s)(?:안|못)\s+(?=\S)|아니(?:야|다|에요|예요|었)|않(?:아|다|아요|았|는|는다))/iu;

const SECRET_PATTERNS = Object.freeze([
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/iu,
  /\bAKIA[A-Z0-9]{16}\b/u,
  /\b(?:ghp_|github_pat_|sk-)[A-Za-z0-9_-]{12,}\b/u,
  /\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*[^\s,;]{8,}/iu,
]);

const CLAIMS_VERIFICATION = /\b(?:i|we)\s+(?:have\s+)?(?:verified|confirmed|checked|validated)\b/iu;
const CURRENT_STATE_CLAIM =
  /\b(?:currently|right now|at present|now)\b.{0,80}\b(?:is|are|has|have|works?|connected|available|healthy|deployed|running|enabled|disabled)\b/iu;
const AUTHORITY_CLAIM =
  /\b(?:officially|definitely|guaranteed|authorized|approved)\b.{0,80}\b(?:is|are|has|have|works?|connected|available|healthy|deployed|running|enabled|disabled)\b/iu;
const EPISTEMIC_GUARD =
  /\b(?:cannot|can't|unable to|not able to|have not|haven't|did not|didn't)\s+(?:independently\s+)?(?:verify|confirm|check|validate)|\b(?:unverified|unknown|uncertain|based on (?:the )?(?:provided|available) (?:context|information))\b/iu;

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
}

function tokens(value: string): readonly string[] {
  return normalize(value).match(/[\p{L}\p{N}_-]+/gu) ?? [];
}

function lexicalStem(value: string): string {
  if (!/[\p{Script=Hangul}]/u.test(value)) return value;
  for (const suffix of KOREAN_SUFFIXES) {
    if (value.endsWith(suffix) && value.length - suffix.length >= 2) {
      return value.slice(0, -suffix.length);
    }
  }
  return value;
}

function recencyKeywords(value: string): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens(value)) {
    const stem = lexicalStem(token);
    if (stem.length < 2 || RECENCY_STOPWORDS.has(stem) || seen.has(stem)) continue;
    seen.add(stem);
    result.push(stem);
    if (result.length === MAX_RECENCY_KEYWORDS) break;
  }
  return result;
}

function recencyHardAnchors(value: string): readonly string[] {
  const [, ...candidateSegments] = value.normalize('NFKC').trim().split(/\s+/u);
  const rawTokens = candidateSegments.join(' ').match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return rawTokens
    .filter((token) => /\p{N}/u.test(token) || /^\p{Lu}/u.test(token))
    .map((token) => lexicalStem(normalize(token)))
    .filter((token) => token.length >= 2 && !RECENCY_STOPWORDS.has(token))
    .slice(0, MAX_RECENCY_KEYWORDS);
}

function isRecencyRelevant(currentUserTurn: string, fact: string): boolean {
  const current = normalize(currentUserTurn);
  if (!current || GREETING_OR_ACKNOWLEDGEMENT.test(current)) return false;
  if (EXPLICIT_RECENCY_REFERENCE.test(current)) return true;

  const currentKeywords = new Set(recencyKeywords(current));
  const factKeywords = recencyKeywords(fact);
  const sharedKeywords = factKeywords.filter((keyword) => currentKeywords.has(keyword));
  if (sharedKeywords.filter((keyword) => keyword.length >= MIN_RECENCY_RELEVANCE_KEYWORD_CHARACTERS).length >= 2) {
    return true;
  }

  const currentHardAnchors = new Set(recencyHardAnchors(current));
  return recencyHardAnchors(fact).some((anchor) => currentHardAnchors.has(anchor));
}

function hasRecencyGroundingViolation(
  recencyFact: string | undefined,
  currentUserTurn: string | undefined,
  response: string,
): boolean {
  if (
    recencyFact === undefined ||
    currentUserTurn === undefined ||
    recencyFact.length === 0 ||
    recencyFact.length > MAX_RECENCY_FACT_CHARACTERS ||
    !isRecencyRelevant(currentUserTurn, recencyFact)
  ) {
    return false;
  }
  const fact = recencyFact;
  const keywords = recencyKeywords(fact);
  if (keywords.length === 0) return false;
  const responseKeywords = new Set(recencyKeywords(response));
  const hardAnchors = recencyHardAnchors(fact);
  if (hardAnchors.some((anchor) => !responseKeywords.has(anchor))) return true;
  // Query vocabulary establishes relevance but cannot by itself ground the answer.
  const current = normalize(currentUserTurn);
  const currentKeywords = recencyKeywords(current);
  const groundingKeywords = keywords.filter(
    (keyword) =>
      !current.includes(keyword) &&
      !(
        /[\p{Script=Hangul}]/u.test(keyword) &&
        keyword.length >= MIN_RECENCY_RELEVANCE_KEYWORD_CHARACTERS &&
        currentKeywords.some((currentKeyword) => currentKeyword.startsWith(keyword.slice(0, -1)))
      ),
  );
  const requiredKeywords = groundingKeywords.length === 0 ? keywords : groundingKeywords;
  if (!requiredKeywords.some((keyword) => responseKeywords.has(keyword))) return true;
  return NEGATION.test(fact) !== NEGATION.test(response);
}

function containsTokenWindow(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length < TOKEN_WINDOW_SIZE || haystack.length < TOKEN_WINDOW_SIZE) return false;
  const windows = new Set<string>();
  for (let index = 0; index <= needle.length - TOKEN_WINDOW_SIZE; index += 1) {
    windows.add(needle.slice(index, index + TOKEN_WINDOW_SIZE).join('\u0000'));
  }
  for (let index = 0; index <= haystack.length - TOKEN_WINDOW_SIZE; index += 1) {
    if (windows.has(haystack.slice(index, index + TOKEN_WINDOW_SIZE).join('\u0000'))) return true;
  }
  return false;
}

function safeArtifact(artifact: Artifact): BoundedProviderArtifact {
  return Object.freeze({
    id: artifact.id,
    ...(artifact.taskId === undefined ? {} : { taskId: artifact.taskId }),
    ...(artifact.taskRunId === undefined ? {} : { taskRunId: artifact.taskRunId }),
    kind: artifact.kind,
    title: artifact.title,
    ...(artifact.content === undefined ? {} : { content: artifact.content }),
    ...(artifact.mimeType === undefined ? {} : { mimeType: artifact.mimeType }),
    createdAt: artifact.createdAt,
  });
}

interface CanonicalProviderOutput {
  readonly text: string;
  readonly artifacts: readonly BoundedProviderArtifact[];
}

function canonicalOutput(input: RuntimeValidationInputView['result']): CanonicalProviderOutput {
  if (typeof input.text !== 'string' || (input.artifacts !== undefined && !Array.isArray(input.artifacts))) {
    throw new TypeError('Invalid Provider output shape');
  }
  return Object.freeze({
    text: input.text,
    artifacts: Object.freeze((input.artifacts ?? []).map(safeArtifact)),
  });
}

function outputIdentity(output: CanonicalProviderOutput): { responseSha256: string; byteCount: number } {
  const boundedOutput = JSON.stringify(output);
  const responseIdentity = JSON.stringify({
    text: output.text,
    artifacts: output.artifacts.map((artifact) => ({
      id: artifact.id,
      ...(artifact.taskId === undefined ? {} : { taskId: artifact.taskId }),
      ...(artifact.taskRunId === undefined ? {} : { taskRunId: artifact.taskRunId }),
      kind: artifact.kind,
      title: artifact.title,
      ...(artifact.content === undefined ? {} : { content: artifact.content }),
      ...(artifact.mimeType === undefined ? {} : { mimeType: artifact.mimeType }),
    })),
  });
  return {
    responseSha256: createHash('sha256').update(responseIdentity).digest('hex'),
    byteCount: Buffer.byteLength(boundedOutput, 'utf8'),
  };
}

function searchableOutput(output: CanonicalProviderOutput): string {
  return [output.text, ...output.artifacts.map((artifact) => artifact.content ?? '')].join('\n');
}

function hasPromptLeak(prompt: string, response: string): boolean {
  const normalizedPrompt = normalize(prompt);
  const normalizedResponse = normalize(response);
  if (!normalizedPrompt || !normalizedResponse) return false;
  if (
    normalizedPrompt.length >= MIN_PROMPT_EXACT_CHARACTERS &&
    (normalizedResponse === normalizedPrompt || normalizedResponse.includes(normalizedPrompt))
  ) {
    return true;
  }
  return containsTokenWindow(tokens(normalizedResponse), tokens(normalizedPrompt));
}

function echoedEntries(response: string, corpus: readonly string[]): readonly string[] {
  const normalizedResponse = normalize(response);
  const responseTokens = tokens(response);
  return corpus.filter((entry) => {
    const normalizedEntry = normalize(entry);
    if (normalizedEntry.length < MIN_ECHO_ENTRY_CHARACTERS) return false;
    return normalizedResponse.includes(normalizedEntry) || containsTokenWindow(responseTokens, tokens(entry));
  });
}

function hasAuthorityScopeViolation(response: string): boolean {
  if (EPISTEMIC_GUARD.test(response)) return false;
  return CLAIMS_VERIFICATION.test(response) || CURRENT_STATE_CLAIM.test(response) || AUTHORITY_CLAIM.test(response);
}

function disposition(reasonCodes: readonly ResponseValidationReasonCode[], escalationEnabled: boolean): ValidationDisposition {
  if (
    reasonCodes.some((code) =>
      [
        ResponseValidationReasonCode.PROMPT_LEAK,
        ResponseValidationReasonCode.MULTI_ENTRY_ECHO,
        ResponseValidationReasonCode.SECRET_EXPOSURE_RISK,
        ResponseValidationReasonCode.VALIDATOR_INTERNAL_FAILURE,
      ].includes(code),
    )
  ) {
    return ValidationDisposition.REJECT;
  }
  if (
    escalationEnabled &&
    reasonCodes.some((code) =>
      [
        ResponseValidationReasonCode.AUTHORITY_SCOPE_VIOLATION,
        ResponseValidationReasonCode.RECENCY_GROUNDING_VIOLATION,
      ].includes(code),
    )
  ) {
    return ValidationDisposition.ESCALATE;
  }
  return reasonCodes.length === 0 ? ValidationDisposition.ACCEPT : ValidationDisposition.REJECT;
}

/** Pure synchronous response validation. It performs no I/O and emits no input or output body. */
export class RuntimeResponseValidator {
  constructor(private readonly profiles: ValidationProfileRegistry) {}

  validate(input: RuntimeValidationInputView): RuntimeValidationResult {
    const profile = this.profiles.resolve(input.validationProfile);
    try {
      const output = canonicalOutput(input.result);
      const identity = outputIdentity(output);
      const response = searchableOutput(output);
      const reasonCodes: ResponseValidationReasonCode[] = [];

      for (const rule of profile.rules) {
        if (rule === RuntimeValidationRule.NON_EMPTY && normalize(response).length === 0) {
          reasonCodes.push(ResponseValidationReasonCode.EMPTY_OUTPUT);
        } else if (rule === RuntimeValidationRule.OUTPUT_LIMIT && identity.byteCount > profile.outputLimitBytes) {
          reasonCodes.push(ResponseValidationReasonCode.OUTPUT_LIMIT_VIOLATION);
        } else if (rule === RuntimeValidationRule.PROMPT_LEAK && hasPromptLeak(input.prompt, response)) {
          reasonCodes.push(ResponseValidationReasonCode.PROMPT_LEAK);
        } else if (rule === RuntimeValidationRule.MULTI_ENTRY_ECHO) {
          const echoed = echoedEntries(response, input.contextCorpus ?? []);
          if (echoed.length >= 2 && echoed.reduce((total, entry) => total + normalize(entry).length, 0) >= MIN_MULTI_ENTRY_ECHO_CHARACTERS) {
            reasonCodes.push(ResponseValidationReasonCode.MULTI_ENTRY_ECHO);
          }
        } else if (
          rule === RuntimeValidationRule.SECRET_EXPOSURE_RISK &&
          SECRET_PATTERNS.some((pattern) => pattern.test(response))
        ) {
          reasonCodes.push(ResponseValidationReasonCode.SECRET_EXPOSURE_RISK);
        } else if (
          rule === RuntimeValidationRule.RECENCY_GROUNDING &&
          hasRecencyGroundingViolation(input.recencyFact, input.currentUserTurn, response)
        ) {
          reasonCodes.push(ResponseValidationReasonCode.RECENCY_GROUNDING_VIOLATION);
        } else if (
          rule === RuntimeValidationRule.AUTHORITY_SEMANTIC_SCOPE &&
          hasAuthorityScopeViolation(response)
        ) {
          reasonCodes.push(ResponseValidationReasonCode.AUTHORITY_SCOPE_VIOLATION);
        }
      }

      return Object.freeze({
        disposition: disposition(reasonCodes, profile.escalationEnabled),
        reasonCodes: Object.freeze(reasonCodes),
        ...identity,
        profileVersion: profile.version,
        ruleContractVersion: ROUTING_RESPONSE_RULE_CONTRACT_VERSION,
      });
    } catch {
      const identity = outputIdentity(Object.freeze({ text: '', artifacts: Object.freeze([]) }));
      return Object.freeze({
        disposition: ValidationDisposition.REJECT,
        reasonCodes: Object.freeze([ResponseValidationReasonCode.VALIDATOR_INTERNAL_FAILURE]),
        ...identity,
        profileVersion: profile.version,
        ruleContractVersion: ROUTING_RESPONSE_RULE_CONTRACT_VERSION,
      });
    }
  }
}

export function projectBoundedProviderOutput(
  result: RuntimeValidationInputView['result'],
  validation: RuntimeValidationResult,
): BoundedProviderOutput {
  if (validation.disposition !== ValidationDisposition.ACCEPT) {
    throw new Error('Only accepted Provider output can be projected');
  }
  const output = canonicalOutput(result);
  const identity = outputIdentity(output);
  if (
    identity.responseSha256 !== validation.responseSha256 ||
    identity.byteCount !== validation.byteCount
  ) {
    throw new Error('Provider output does not match validation identity');
  }
  return Object.freeze({ ...output, ...identity });
}
