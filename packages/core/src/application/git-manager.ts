import { WorkspaceNotSafeError } from '../errors';
import { ApprovalStatus } from '../domain';
import type { ApprovalRef, GitCommitResult, GitDiff, GitMainSyncResult, GitPushResult, GitStatus, RepositoryInfo } from '../domain';
import type { GitProvider } from '../ports';
import { isValidCommitMessage } from './commit-message';
import { isSafePushBranch, isSafePushRemote } from './push-target';

/** SHA-shape guard for the sync commits (mirrors the push commitHash gate). */
const SYNC_SHA_SHAPED = /^[0-9a-f]{7,40}$/i;

/**
 * A post-merge local `main` sync failed **before the local main ref-update was attempted** (invalid input, dirty/
 * detached/mid-merge tree, missing local main, remote read failure, remote tip != expected, non-fast-forward, or
 * the local main moved before the update). Definitively **no** local ref was moved — a caller may safely say
 * "로컬 main을 동기화하지 않았어요" (CAP-002, ADR-0058, Sprint 3h — mirrors RepositoryHostingBlockedError).
 */
export class GitMainSyncBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitMainSyncBlockedError';
  }
}

/**
 * The local `main` ref-update was **attempted** but could not be completed/verified. The local ref **may** have
 * moved — a caller must **not** claim it was not synchronized; say "동기화 결과를 확인하지 못했어요" instead (CAP-002,
 * ADR-0058, Sprint 3h — mirrors RepositoryHostingUnverifiedError).
 */
export class GitMainSyncUnverifiedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitMainSyncUnverifiedError';
  }
}

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

  /**
   * Approved git push (CAP-002, ADR-0048 — the first remote mutation). Ref-gated (mirrors commitFiles):
   * validates `approvalRef.status === APPROVED` + defensive inputs (non-empty rootPath, conservative-safe
   * remote/branch, SHA-shaped commitHash) BEFORE delegating. The runtime performs the full context/state
   * re-validation first; this is the capability-level backstop. The provider runs the argv-only
   * `git push <remote> HEAD:<branch>` and returns the reported target. The ApprovalRef is consumed here and
   * NOT passed to the provider. No generic push method is exposed.
   */
  async pushApprovedCommit(input: {
    rootPath: string;
    remote: string;
    branch: string;
    commitHash: string;
    approvalRef: ApprovalRef;
  }): Promise<GitPushResult> {
    if (input.approvalRef.status !== ApprovalStatus.APPROVED) {
      throw new Error(`git push requires an APPROVED approval (got ${input.approvalRef.status})`);
    }
    if (!input.rootPath.trim()) throw new Error('git push requires a rootPath');
    if (!isSafePushRemote(input.remote)) throw new Error('git push rejects an unsafe remote');
    if (!isSafePushBranch(input.branch)) throw new Error('git push rejects an unsafe branch');
    if (!/^[0-9a-f]{7,40}$/i.test(input.commitHash)) throw new Error('git push rejects an invalid commitHash');
    return this.provider.pushApprovedCommit(input.rootPath, input.remote, input.branch, input.commitHash);
  }

  /**
   * Post-merge local `main` synchronization (CAP-002, ADR-0058 — Sprint 3h). Fast-forward ONLY; no ApprovalRef
   * (a local, non-destructive ref move gated by PR_MERGED + explicit command + this conservative preflight). Runs
   * the local + remote preflight, then makes at most ONE mutating call (`syncMainFastForward`). **Phase-aware
   * failure classification (CA change 2): the Manager does NOT blanket-convert every provider throw to Unverified.**
   *   1. defensive validation                                → GitMainSyncBlockedError (no read, no mutation)
   *   2. isRepository + status (clean/untracked/staged/unstaged/unmerged) + info (detached) → dirty/detached → Blocked
   *   3. getLocalRefCommit('main') → null → Blocked; else record previousMainCommit (the CAS base)
   *   4. getRemoteRefCommit → throws → Blocked; tip != expectedRemoteCommit → Blocked
   *   5. SINGLE syncMainFastForward(…, previousMainCommit): a provider GitMainSyncBlockedError (pre-ref-update)
   *      propagates as Blocked; a GitMainSyncUnverifiedError propagates as Unverified; any OTHER throw → Unverified
   *      (conservative — at/around the mutation). Result-integrity (syncedCommitHash === expected) → Unverified.
   */
  async syncMain(input: {
    rootPath: string;
    remote: string;
    branch: string;
    expectedRemoteCommit: string;
  }): Promise<GitMainSyncResult> {
    const { rootPath, remote, branch, expectedRemoteCommit } = input;
    // ── 1. Defensive validation BEFORE any git call. All → Blocked (no mutation). ───────────────────────────
    if (!rootPath.trim()) throw new GitMainSyncBlockedError('git main sync requires a rootPath');
    if (!isSafePushRemote(remote)) throw new GitMainSyncBlockedError('git main sync rejects an unsafe remote');
    if (!isSafePushBranch(branch)) throw new GitMainSyncBlockedError('git main sync rejects an unsafe branch');
    if (!SYNC_SHA_SHAPED.test(expectedRemoteCommit)) throw new GitMainSyncBlockedError('git main sync rejects an invalid expected commit');

    // ── 2. Local repository safety (read-only). Any dirty/detached/mid-merge → Blocked. ─────────────────────
    if (!(await this.provider.isRepository(rootPath))) {
      throw new GitMainSyncBlockedError('git main sync: not a git repository');
    }
    let status: GitStatus;
    let info: RepositoryInfo;
    try {
      status = await this.provider.status(rootPath);
      info = await this.provider.info(rootPath);
    } catch {
      throw new GitMainSyncBlockedError('git main sync: could not read local repository state');
    }
    if (!status.clean) throw new GitMainSyncBlockedError('git main sync: working tree is not clean');
    if (status.untracked.length > 0) throw new GitMainSyncBlockedError('git main sync: untracked files present');
    if (status.staged.length > 0) throw new GitMainSyncBlockedError('git main sync: staged changes present');
    if (status.unstaged.length > 0) throw new GitMainSyncBlockedError('git main sync: uncommitted changes present');
    if (status.hasUnmergedPaths) throw new GitMainSyncBlockedError('git main sync: unmerged paths present');
    if (info.detached || status.isDetached) throw new GitMainSyncBlockedError('git main sync: HEAD is detached');

    // ── 3. Local main must exist; record the CAS base. ──────────────────────────────────────────────────────
    let local: { commitHash: string } | null;
    try {
      local = await this.provider.getLocalRefCommit(rootPath, branch);
    } catch {
      throw new GitMainSyncBlockedError('git main sync: could not read local main');
    }
    if (!local) throw new GitMainSyncBlockedError('git main sync: local main does not exist');
    const previousMainCommit = local.commitHash;

    // ── 4. Observe the remote main tip (read-only) BEFORE any mutation; must equal the expected merge commit. ─
    let remoteTip: { commitHash: string };
    try {
      remoteTip = await this.provider.getRemoteRefCommit(rootPath, remote, branch);
    } catch {
      throw new GitMainSyncBlockedError('git main sync: could not observe remote main; not synchronized');
    }
    if (remoteTip.commitHash !== expectedRemoteCommit) {
      throw new GitMainSyncBlockedError('git main sync: remote main does not match the expected merge commit; not synchronized');
    }

    // ── 5. SINGLE fast-forward mutation. Phase-aware: provider Blocked → Blocked; Unverified/other → Unverified. ─
    let result: GitMainSyncResult;
    try {
      result = await this.provider.syncMainFastForward(rootPath, remote, branch, expectedRemoteCommit, previousMainCommit);
    } catch (err) {
      if (err instanceof GitMainSyncBlockedError) throw err; // pre-ref-update — definitively not synced
      if (err instanceof GitMainSyncUnverifiedError) throw err; // at/after ref update — unknown
      throw new GitMainSyncUnverifiedError('git main sync: could not verify the local main synchronization');
    }
    if (result.syncedCommitHash !== expectedRemoteCommit) {
      throw new GitMainSyncUnverifiedError('git main sync: local main sync result could not be verified');
    }
    return result;
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
