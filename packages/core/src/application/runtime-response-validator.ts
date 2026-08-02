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
    reasonCodes.includes(ResponseValidationReasonCode.AUTHORITY_SCOPE_VIOLATION)
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
