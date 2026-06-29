import { WorkspaceNotSafeError } from '../errors';
import type { GitStatus, RepositoryInfo } from '../domain';
import type { GitProvider } from '../ports';

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
