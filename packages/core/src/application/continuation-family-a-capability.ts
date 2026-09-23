import { Capability } from '../domain';

const SUPPORTED: readonly Capability[] = Object.freeze([
  Capability.GENERAL_CHAT, Capability.SUMMARIZATION, Capability.DOCUMENT_ANALYSIS,
  Capability.CODE_REVIEW, Capability.ARCHITECTURE_PLANNING, Capability.READONLY_LOOKUP,
  Capability.PROJECT_ANALYSIS,
]);
/** Existing Product invariant; reusable revalidation, never execution authority. */
export function isFamilyACapability(value: Capability): boolean { return SUPPORTED.includes(value); }
