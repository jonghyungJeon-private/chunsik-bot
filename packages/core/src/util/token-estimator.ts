/** Deterministic approximation used for context budgeting without a tokenizer dependency. */
export const ESTIMATED_CHARACTERS_PER_TOKEN = 4;

/**
 * Estimates token usage from JavaScript string length.
 *
 * This intentionally favors predictability over provider-specific accuracy. Any non-empty
 * partial token counts as one token so callers can enforce an upper bound consistently.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / ESTIMATED_CHARACTERS_PER_TOKEN);
}
