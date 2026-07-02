/**
 * Commit-message validation shared by the commit-approval flow (Sprint 2x) and the commit-execution flow +
 * Git capability defensive check (Sprint 2y, ADR-0046). A valid message is a single trimmed line, non-empty,
 * bounded, with no control characters — never AI-generated, never carrying diff/file content.
 */

/** Max commit message length (Sprint 2x/2y). */
export const MAX_COMMIT_MESSAGE_CHARS = 120;

/** True when `message` is a valid bounded single-line commit message (no control chars, trimmed, non-empty). */
export function isValidCommitMessage(message: string): boolean {
  if (typeof message !== 'string') return false;
  const m = message.trim();
  if (m.length === 0 || m.length > MAX_COMMIT_MESSAGE_CHARS) return false;
  return ![...m].some((c) => {
    const code = c.charCodeAt(0);
    return code < 0x20 || code === 0x7f; // control chars incl. newline/CR
  });
}
