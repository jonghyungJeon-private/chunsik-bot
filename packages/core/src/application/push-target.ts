/**
 * Conservative git remote/branch name validation shared by the push-execution flow (Sprint 3a, ADR-0048)
 * — the runtime's pre-mutation guard (CA #3), the `GitManager.pushApprovedCommit` backstop, and the
 * adapter's `assertSafePushTarget` (CA #4/#5). A safe target never reaches `git push <remote> HEAD:<branch>`
 * unless these pass; argv-safety is NOT a substitute for git ref-name rules.
 */

/** Max displayed/accepted git ref length (defensive bound). */
const MAX_REMOTE_LEN = 100;
const MAX_BRANCH_LEN = 200;

function hasControlChar(s: string): boolean {
  return [...s].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);
}

/**
 * True when `remote` is a conservative-safe git remote name (Sprint 3a, CA #4): non-empty, bounded, no
 * leading '-', no '/'/':'/whitespace, no control chars.
 */
export function isSafePushRemote(remote: string): boolean {
  if (typeof remote !== 'string') return false;
  if (remote.length === 0 || remote.length > MAX_REMOTE_LEN) return false;
  if (remote.startsWith('-')) return false;
  if (/[\s/:]/.test(remote)) return false;
  if (hasControlChar(remote)) return false;
  return true;
}

/**
 * True when `branch` is a conservative-safe git branch name (Sprint 3a, CA #4): non-empty, bounded, may
 * contain single '/'; rejects a leading '-'/'/', whitespace, control chars, and the git-unsafe sequences
 * `:` `~` `^` `?` `*` `[` `\` `..` `@{`, consecutive `//`, a trailing '/', and a `.lock` suffix.
 */
export function isSafePushBranch(branch: string): boolean {
  if (typeof branch !== 'string') return false;
  if (branch.length === 0 || branch.length > MAX_BRANCH_LEN) return false;
  if (branch.startsWith('-') || branch.startsWith('/')) return false;
  if (branch.endsWith('/') || branch.endsWith('.lock')) return false;
  if (/\s/.test(branch)) return false;
  if (hasControlChar(branch)) return false;
  if (/[:~^?*[\\]/.test(branch)) return false;
  if (branch.includes('..') || branch.includes('@{') || branch.includes('//')) return false;
  return true;
}
