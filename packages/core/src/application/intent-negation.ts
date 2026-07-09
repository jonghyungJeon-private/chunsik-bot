/**
 * Shared negation awareness for deterministic intent matching (Sprint 4c-Follow-up; ADR-0062 draft).
 *
 * The intent classifier (`IntentClassifier.detectTestRun`) and the `ConversationRuntime` mutation gates
 * (commit / push / apply / patch / final-apply / PR / post-apply-validation) match on keyword/regex tokens.
 * Before this module they matched on token PRESENCE regardless of negation, so an explicit prohibition —
 * "커밋하지 마", "테스트 실행하지 마", "do not commit", "do not run tests" — was read as a request FOR that
 * action (this is what BLOCKED Gate 4B Scenario C). These helpers make a matched token count ONLY when it is
 * NOT under an explicit negation in the same clause.
 *
 * Deliberately deterministic and conservative (matching the rest of the routing layer): it recognizes a small,
 * explicit set of KO/EN prohibition markers and suppresses a matched token only when such a marker sits in the
 * SAME clause as the match. Negation only REMOVES a trigger — it never creates a different positive intent. It
 * does NOT resolve contrastive "A 말고 B" ("not A, do B") forms; that is out of scope for this slice.
 */

/** Explicit prohibition markers (KO + EN). Conservative — only forms that unambiguously negate an action, so a
 *  normal positive request ("커밋해줘", "apply patch") never trips them. */
const NEGATION_MARKERS =
  /[가-힣]지\s*마(?:세요|요|라)?(?=[\s.,!?)\]]|$)|[가-힣]지\s*말(?:아|고|것|자|세요|아요)?|말고|없이|금지|\bdo(?:es)?\s+not\b|\bdon['’]?t\b|\bnever\b|\bwithout\b/i;

/** Clause boundaries — sentence punctuation + a few KO/EN coordinating connectives. Splitting on these keeps a
 *  negation in one clause from bleeding into an unrelated one ("do not push, but commit" → commit NOT negated). */
const CLAUSE_SEPARATOR = /[.,;!?\n·]+|\s+(?:그리고|그런데|하지만|또는|또|and|but|then)\s+/gi;

/**
 * Whether the token at `[matchIndex, matchIndex + matchLength)` sits in a clause carrying an explicit negation
 * marker. The clause is the span between the nearest clause separators around the match.
 */
export function isNegated(text: string, matchIndex: number, matchLength: number): boolean {
  const matchEnd = matchIndex + matchLength;
  let clauseStart = 0;
  const sep = new RegExp(CLAUSE_SEPARATOR.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = sep.exec(text)) !== null) {
    const sepStart = m.index;
    const sepEnd = m.index + m[0].length;
    if (sepEnd <= matchIndex) {
      clauseStart = sepEnd; // separator entirely before the match → the clause starts after it
      continue;
    }
    if (sepStart >= matchEnd) {
      // first separator entirely after the match → the clause is [clauseStart, sepStart)
      return NEGATION_MARKERS.test(text.slice(clauseStart, sepStart));
    }
    break; // separator overlaps the match (rare) → fall through to the tail test
  }
  return NEGATION_MARKERS.test(text.slice(clauseStart));
}

function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True iff at least one of `patterns` matches `text` at a position that is NOT negated. A negation-aware,
 * drop-in replacement for `RE.test(text)` and `WORDS.some((w) => text.includes(w))`: for text with no negation
 * marker it returns exactly what those returned (so existing non-negated behavior is unchanged). String patterns
 * are matched case-insensitively as literals; RegExp patterns keep their own flags (a global flag is added so
 * every occurrence is checked, not only the first).
 */
export function unnegatedMatch(text: string, patterns: ReadonlyArray<string | RegExp>): boolean {
  for (const pattern of patterns) {
    const re =
      typeof pattern === 'string'
        ? new RegExp(escapeRegExp(pattern), 'gi')
        : new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (!isNegated(text, m.index, m[0].length)) return true;
      if (m.index === re.lastIndex) re.lastIndex++; // guard against a zero-width match looping forever
    }
  }
  return false;
}
