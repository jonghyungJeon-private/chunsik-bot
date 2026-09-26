import { Capability, IntentType } from '../domain';
import type { AgentProfile, ExecutionPlan, IntentType as IntentTypeT, WorkHandoff } from '../domain';

/**
 * R2 continuation prompt authoring contracts (ADR-0089 / Production Continuation Receiver).
 *
 * PromptComposer owns continuation prompt authorship exactly as it owns conversation and
 * code-generation authorship. The receiver never assembles Provider prompt strings, and Provider
 * adapters never author continuation semantics. A bounded validation corpus travels ALONGSIDE the
 * PromptSpec (never inside PromptSpec / AiRequest / RoutingContext) and is consumed only by the
 * Gateway's RuntimeResponseValidator (MULTI_ENTRY_ECHO) via request.contextFiles content.
 *
 * All bounds fail closed: an over-limit input is rejected, never silently truncated (§17, §20).
 */

/** §17 architecture-reviewed bounds. Existing stricter domain limits still apply on top of these. */
export const CONTINUATION_PROMPT_BOUNDS = Object.freeze({
  maxRefsPerCategory: 16,
  maxRefsTotal: 48,
  maxRefBytes: 256,
  maxPlanSteps: 16,
  maxRenderedPromptBytes: 32 * 1024,
  corpus: Object.freeze({
    maxEntries: 8,
    maxEntryBytes: 4 * 1024,
    maxTotalBytes: 16 * 1024,
  }),
});

export type ContinuationPromptFailureCode =
  | 'INVALID_CONTINUATION_FACTS'
  | 'UNSUPPORTED_CONTINUATION_CAPABILITY'
  | 'UNSUPPORTED_CONTINUATION_INTENT'
  | 'CONTINUATION_REF_LIMIT_EXCEEDED'
  | 'CONTINUATION_REF_TOO_LARGE'
  | 'CONTINUATION_PLAN_STEP_LIMIT_EXCEEDED'
  | 'CONTINUATION_PROMPT_TOO_LARGE'
  | 'CONTINUATION_CORPUS_LIMIT_EXCEEDED';

/** Deterministic, bounded pre-dispatch failure. It carries a code only — never prompt/ref content. */
export class ContinuationPromptError extends Error {
  constructor(readonly code: ContinuationPromptFailureCode) {
    super(code);
    this.name = 'ContinuationPromptError';
  }
}

/**
 * Canonical R2 continuation prompt inputs (§13). Identifiers only — R2 never resolves ref content,
 * performs no Artifact/ExecutionReceipt/resource lookup, and never treats objective/plan as authority.
 */
export interface ContinuationPromptInput {
  readonly handoff: WorkHandoff;
  readonly destinationAgentProfile: AgentProfile;
  readonly plan: ExecutionPlan;
  readonly boundTaskFacts: {
    readonly capability: Capability;
    readonly intentType: IntentTypeT;
  };
}

/** A bounded echo/leak-detection corpus entry (§19/§20). Provenance is persona/directive material. */
export interface ContinuationValidationCorpusEntry {
  readonly source: 'AGENT_PROFILE_INSTRUCTIONS' | 'AGENT_PROFILE_PURPOSE' | 'PROMPT_SYSTEM_DIRECTIVE';
  readonly content: string;
}

export interface ContinuationValidationCorpus {
  readonly entries: readonly ContinuationValidationCorpusEntry[];
}

const REQUIRED_CAPABILITY = Capability.GENERAL_CHAT;
const REQUIRED_INTENT = IntentType.CHAT;

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/** §22 fail-closed preflight of the canonical continuation prompt facts, before any authoring. */
export function assertContinuationFacts(input: ContinuationPromptInput): void {
  const facts = input.boundTaskFacts;
  if (
    !facts ||
    !Object.values(Capability).includes(facts.capability) ||
    !Object.values(IntentType).includes(facts.intentType)
  ) {
    throw new ContinuationPromptError('INVALID_CONTINUATION_FACTS');
  }
  if (facts.capability !== REQUIRED_CAPABILITY) {
    throw new ContinuationPromptError('UNSUPPORTED_CONTINUATION_CAPABILITY');
  }
  if (facts.intentType !== REQUIRED_INTENT) {
    throw new ContinuationPromptError('UNSUPPORTED_CONTINUATION_INTENT');
  }
  if (!input.handoff || !input.destinationAgentProfile || !input.plan) {
    throw new ContinuationPromptError('INVALID_CONTINUATION_FACTS');
  }
}

/** Bound one identifier category (count + per-ref bytes). Never truncates; fails closed. */
export function assertRefCategory(refs: readonly string[]): void {
  if (refs.length > CONTINUATION_PROMPT_BOUNDS.maxRefsPerCategory) {
    throw new ContinuationPromptError('CONTINUATION_REF_LIMIT_EXCEEDED');
  }
  for (const ref of refs) {
    if (byteLength(ref) > CONTINUATION_PROMPT_BOUNDS.maxRefBytes) {
      throw new ContinuationPromptError('CONTINUATION_REF_TOO_LARGE');
    }
  }
}

export function assertRefTotal(total: number): void {
  if (total > CONTINUATION_PROMPT_BOUNDS.maxRefsTotal) {
    throw new ContinuationPromptError('CONTINUATION_REF_LIMIT_EXCEEDED');
  }
}

export function assertPlanSteps(stepCount: number): void {
  if (stepCount > CONTINUATION_PROMPT_BOUNDS.maxPlanSteps) {
    throw new ContinuationPromptError('CONTINUATION_PLAN_STEP_LIMIT_EXCEEDED');
  }
}

export function assertRenderedPromptBytes(rendered: string): void {
  if (byteLength(rendered) > CONTINUATION_PROMPT_BOUNDS.maxRenderedPromptBytes) {
    throw new ContinuationPromptError('CONTINUATION_PROMPT_TOO_LARGE');
  }
}

/**
 * §19/§20 bounded corpus: at most maxEntries; each entry ≤ maxEntryBytes; total ≤ maxTotalBytes. An
 * entry exceeding the maximum is EXCLUDED by the explicit documented rule below (it is dropped from
 * the echo corpus, never truncated); count/total caps still fail closed. Whole-prompt leak validation
 * is independent of this corpus, so excluding an over-limit entry never weakens PROMPT_LEAK.
 */
export function buildContinuationValidationCorpus(
  candidates: readonly ContinuationValidationCorpusEntry[],
): ContinuationValidationCorpus {
  const bounds = CONTINUATION_PROMPT_BOUNDS.corpus;
  // Documented exclusion rule: an individual entry over maxEntryBytes is meaningless for echo
  // detection (a legitimate answer cannot restate 4 KiB verbatim) and is excluded, not truncated.
  const withinEntryBound = candidates.filter(
    (entry) => entry.content.length > 0 && byteLength(entry.content) <= bounds.maxEntryBytes,
  );
  if (withinEntryBound.length > bounds.maxEntries) {
    throw new ContinuationPromptError('CONTINUATION_CORPUS_LIMIT_EXCEEDED');
  }
  let total = 0;
  for (const entry of withinEntryBound) {
    total += byteLength(entry.content);
  }
  if (total > bounds.maxTotalBytes) {
    throw new ContinuationPromptError('CONTINUATION_CORPUS_LIMIT_EXCEEDED');
  }
  return Object.freeze({
    entries: Object.freeze(withinEntryBound.map((entry) => Object.freeze({ ...entry }))),
  });
}
