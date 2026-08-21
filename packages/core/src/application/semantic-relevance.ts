const KEYWORD_PATTERN = /[\p{L}\p{N}]+/gu;

/** Extracts stable, case-insensitive Unicode keywords without duplicate weighting. */
export function extractSemanticKeywords(text: string): string[] {
  const keywords = text.toLocaleLowerCase('und').match(KEYWORD_PATTERN) ?? [];
  return [...new Set(keywords)];
}

/**
 * Scores candidate text by the share of query keywords it contains.
 * Empty queries and candidates have no semantic relevance.
 */
export function scoreSemanticRelevance(query: string, candidate: string): number {
  const queryKeywords = extractSemanticKeywords(query);
  if (queryKeywords.length === 0) return 0;

  const candidateKeywords = new Set(extractSemanticKeywords(candidate));
  if (candidateKeywords.size === 0) return 0;

  const overlap = queryKeywords.reduce(
    (count, keyword) => count + (candidateKeywords.has(keyword) ? 1 : 0),
    0,
  );
  return overlap / queryKeywords.length;
}
