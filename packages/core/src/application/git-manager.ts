import { WorkspaceNotSafeError } from '../errors';
import { ApprovalStatus } from '../domain';
import type { ApprovalRef, GitCommitResult, GitDiff, GitStatus, RepositoryInfo } from '../domain';
import type { GitProvider } from '../ports';
import { isValidCommitMessage } from './commit-message';

/** Reject an absolute / `..` traversal / empty commit pathspec (ADR-0046 defensive gate). */
function isUnsafeCommitPath(p: string): boolean {
  const t = typeof p === 'string' ? p.trim() : '';
  if (t.length === 0) return true;
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(t)) return true; // absolute (POSIX or Windows)
  return t === '..' || t.split(/[\\/]/).includes('..'); // traversal
}

/**
 * Thin orchestration over the GitProvider — the **repository** abstraction
 * (CAP-002, ADR-0023). Read-only in Sprint 2b. Git ≠ Workspace; this composes
 * with a workspace purely through `rootPath`. The provider keeps all git
 * execution adapter-side; core stays child_process-free.
 */
export class GitManager {
  constructor(private readonly provider: GitProvider) {}

  /** True when `rootPath` is inside a git work tree. */
  async isRepository(rootPath: string): Promise<boolean> {
    return this.provider.isRepository(rootPath);
  }

  /** Read-only repository metadata (branch / HEAD / detached). No remote URLs. */
  async info(rootPath: string): Promise<RepositoryInfo> {
    return this.provider.info(rootPath);
  }

  /** Working-tree status (clean/branch + staged/unstaged/untracked). */
  async status(rootPath: string): Promise<GitStatus> {
    return this.provider.status(rootPath);
  }

  /**
   * Read-only unified diff of tracked staged/unstaged changes vs HEAD (ADR-0044). Read-only — delegates to
   * the provider's read-only `git diff`; never mutates. Untracked contents are excluded (see `status`).
   */
  async diff(rootPath: string): Promise<GitDiff> {
    return this.provider.diff(rootPath);
  }

  /**
   * Approved exact-file git commit (CAP-002, ADR-0046 — the first Git mutation). Ref-gated (mirrors
   * WorkspaceWriteManager): validates `approvalRef.status === APPROVED` + defensive inputs (non-empty
   * rootPath/files, all safe relative paths, unique after trim, valid bounded single-line message) BEFORE
   * delegating to the provider. The runtime performs the full context/scope re-validation first; this is the
   * capability-level backstop. The provider owns the argv details and commits exactly `files` (no `git add`,
   * no push). The ApprovalRef is consumed here and NOT passed to the provider.
   */
  async commitFiles(input: {
    rootPath: string;
    files: string[];
    message: string;
    approvalRef: ApprovalRef;
  }): Promise<GitCommitResult> {
    if (input.approvalRef.status !== ApprovalStatus.APPROVED) {
      throw new Error(`git commit requires an APPROVED approval (got ${input.approvalRef.status})`);
    }
    if (!input.rootPath.trim()) throw new Error('git commit requires a rootPath');
    if (input.files.length === 0) throw new Error('git commit requires at least one file');
    const cleaned = input.files.map((f) => (typeof f === 'string' ? f.trim() : ''));
    if (cleaned.some(isUnsafeCommitPath)) throw new Error('git commit rejects an unsafe file path');
    if (new Set(cleaned).size !== cleaned.length) throw new Error('git commit rejects duplicate files');
    if (!isValidCommitMessage(input.message)) throw new Error('git commit rejects an invalid message');
    return this.provider.commitFiles(input.rootPath, cleaned, input.message);
  }

  /** Convenience: whether the working tree is clean. */
  async isClean(rootPath: string): Promise<boolean> {
    return (await this.provider.status(rootPath)).clean;
  }

  /**
   * Guard for future write capabilities: throw if the tree is dirty. Read-only
   * itself — it only inspects status. (Write/commit remain a future Approval-gated
   * capability.)
   */
  async requireClean(rootPath: string): Promise<void> {
    const status = await this.provider.status(rootPath);
    if (!status.clean) {
      throw new WorkspaceNotSafeError(
        `branch ${status.branch} has uncommitted changes ` +
          `(${status.unstaged.length} unstaged, ${status.untracked.length} untracked)`,
      );
    }
  }
}
