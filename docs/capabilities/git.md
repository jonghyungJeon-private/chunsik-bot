# Capability — Git (CAP-002)

> V2 is capability-driven. Doc for the **Git** capability — the product's **local repository** operations
> (read + approval-gated local mutations). Authority: `ARCHITECTURE.md` (§9) and `DECISIONS.md`
> (ADR-0023 read-only; ADR-0044 diff; ADR-0046 commit; ADR-0048 push; ADR-0058 main sync; ADR-0059 local branch
> cleanup). See also `docs/lifecycle-state-machine.md` and `docs/capabilities/repository-hosting.md`.
> Descriptive only; the code is the source of truth.

## Purpose

Own **local repository operations** for the development lifecycle: report repository state, and — **only when
explicitly approved/gated** — perform a small, bounded set of **local** Git mutations. Git is the trustworthy source
of local repo state and the sole executor of local Git commands (adapter-side, argv-only, never a shell).

**Boundary in one line:**

```text
Git owns local repository operations, and may perform approved local Git mutations.
Git does NOT own hosting-provider operations — no PR creation, PR status, PR merge, or remote branch deletion.
RepositoryHosting (CAP-010) owns hosting-provider operations.
```

## Responsibilities

### Read-only observations (ADR-0023, ADR-0044)
- `isRepository(rootPath)` — is the path inside a git work tree.
- `info(rootPath) → RepositoryInfo` — `isRepository`, resolved `rootPath`, `branch`, `headSha?`, `detached`. **No
  remote URLs.**
- `status(rootPath) → GitStatus` — `clean`, `branch`, `staged`/`unstaged`/`untracked`, plus `ahead`/`behind`/
  `upstream` (from the `-b` header; no network fetch) and `isDetached`/`hasUnmergedPaths`.
- `diff(rootPath) → GitDiff` — unified diff of **tracked** staged/unstaged changes vs HEAD; binary files show a
  marker only; adapter size-capped (`truncated`).
- `getLocalRefCommit` / `getRemoteRefCommit` / `isAncestor` — bounded ref reads used by the sync/cleanup preflights
  (`getRemoteRefCommit` reads a remote tip via `ls-remote`; it does not move any local ref).
- `GitManager` adds `isClean` / `requireClean` (read-only guards).

### Approval-gated LOCAL mutations (the only writes Git performs)
Each is a single bounded argv operation, adapter-side, run only after the runtime's full state/context preflight.
None shells out; none touches a remote URL.

- **Exact-file local commit** (Sprint 2y, ADR-0046) — `GitProvider.commitFiles` / `GitManager.commitFiles`. Ref-gated
  (`ApprovalRef.status === APPROVED`, consumed by the Manager, never passed to the provider). Commits **exactly** the
  approved tracked files with the approved message; **no `git add`**, never stages extra paths, never pushes.
- **Approved push to a reviewed upstream** (Sprint 3a, ADR-0048) — `GitProvider.pushApprovedCommit` /
  `GitManager.pushApprovedCommit`. Ref-gated; pushes the approved commit to the approved upstream
  (`git push <remote> HEAD:<branch>`). **The only remote-touching Git operation** (push to an approved upstream) —
  never force, never `-u`/`--tags`/`--all`, never a PR/deploy. Failure is safe (see below).
- **Fast-forward-only local `main` sync** (Sprint 3h, ADR-0058) — `GitProvider.syncMainFastForward` /
  `GitManager.syncMain`. No `ApprovalRef` (a local, non-destructive ref move gated by `PR_MERGED` + an explicit
  command + a conservative preflight). **Fast-forward only** — never a force/`reset --hard`. `checked-out-main` vs
  `ref-only` modes; phase-aware `GitMainSync{Blocked,Unverified}Error`.
- **CAS local merged-branch cleanup** (Sprint 3i, ADR-0059) — `GitProvider.deleteMergedLocalBranch` (+ `isAncestor`
  read) / `GitManager.deleteMergedLocalBranch`. No `ApprovalRef` (a local, recoverable delete gated by `MAIN_SYNCED`
  + an explicit command + a strict preflight). Deletes **exactly one** already-merged **local** branch (the anchored
  PR head branch) via a git-native compare-and-swap `git update-ref -d refs/heads/<target> <expectedBranchCommit>`.
  Never `git branch -d`/`-D`/`--force`, never `main`, never a remote ref, never a wildcard; phase-aware
  `BranchCleanup{Blocked,Unverified}Error`.

### Execution & failure discipline
- Execute git **adapter-side only**, via **argument-array `spawn`** (never a shell string, never `shell: true`), with
  a timeout, `cwd` = repository root, and **sanitized stderr**.
- **Blocked vs Unverified** for every mutation outcome: a known **pre-mutation** failure → *Blocked* (safe to say the
  operation did not happen); any failure **at/after** the mutating call → *Unverified* (never say it did not happen).
  (Sync/cleanup use the typed `GitMainSync*`/`BranchCleanup*` errors; commit/push surface the same split via the
  runtime's pre-mutation checks + a conservative "could-not-complete / check the remote" reply after the attempt.)
- **`ApprovalRef` is consumed by the `GitManager`** where applicable (commit, push) and is **never** passed to the
  provider/runner.

## Out of Scope

- ❌ **Hosting-provider operations** — PR creation, PR status, PR merge, **remote branch deletion**. Those belong to
  **RepositoryHosting (CAP-010)**. In particular, Git never performs a remote branch delete and never uses
  `git push --delete` (a remote mutation must not be smuggled behind the local capability; ADR-0023/0060).
- ❌ **Destructive/rewriting writes** — no `reset --hard`, no `--force`/force push, no `git branch -D`/force delete, no
  arbitrary/user-named branch deletion, no default/`main` deletion, no bulk/wildcard deletion, no `checkout`
  switching to delete, no merge/rebase/stash/tag/`git add`.
- ❌ **Remote URL listing / exposure** — excluded; `RepositoryInfo` carries no remote URL (a future masking policy +
  ADR would be required).
- ❌ **Deploy / release / tag / package publishing / version bump** — no such path exists in Git.
- ❌ **Worktree** — no creation, no methods (future only).
- ❌ Approval decisioning, Patch, CommandExecution, Codex/Ollama, AI provider changes, connectors.
- ❌ No shell strings / `shell: true`. Core never touches `child_process`; only the adapter runner spawns git argv.

## Public API

`GitProvider` (port) — reads (`isRepository`/`info`/`status`/`diff`/`getLocalRefCommit`/`getRemoteRefCommit`/
`isAncestor`) + the four gated mutations (`commitFiles`/`pushApprovedCommit`/`syncMainFastForward`/
`deleteMergedLocalBranch`). Token: `GIT_PROVIDER`. Adapter: `@chunsik/git-local` (`LocalGitProvider`, injectable
`GitRunner`; argv `spawnSync`). Core service: `GitManager` (orchestrates preflight + a single mutating call; owns the
`ApprovalRef` where applicable + the phase-aware error taxonomy). Domain: `RepositoryInfo`, `GitStatus`, `GitDiff`,
`GitCommitResult`, `GitPushResult`, `GitMainSyncResult`, `GitBranchCleanupResult` + `GitMainSync{Blocked,Unverified}
Error` / `BranchCleanup{Blocked,Unverified}Error` (`domain/git.ts`, `application/git-manager.ts`).

**Composition:** takes a plain `rootPath` (from a CAP-001 Workspace `WorkspaceRef.rootPath`). Git imports **no**
Workspace type. The runtime calls the **`GitManager` only** — never the provider/runner directly — and passes no
shell.

## Layering (responsibility split)

`GitRunner` (Infrastructure — argv-array spawn) → `GitProvider` (Port) → `GitManager` (Application Service). The
Manager never spawns; only the adapter Runner runs git. The runtime composes the Manager into the lifecycle
(`docs/lifecycle-state-machine.md`).

## Boundaries (capability independence)

- **Git ≠ Workspace** — Git = repository; Workspace = filesystem. Separate ports.
- **Git ≠ Approval** — Git never authorizes; its writes are gated by an `ApprovalRef` (commit/push) or by an explicit
  lifecycle state + command + preflight (sync/cleanup) — the Approval capability owns the record.
- **Git ≠ RepositoryHosting** — Git = local repository ops; RepositoryHosting (CAP-010) = hosting-provider ops (PR
  create/status/merge, remote branch cleanup). Remote branch deletion is RepositoryHosting-owned, never a Git
  `push --delete`.
- **Git ≠ Patch / Worktree** — Git reports/mutates repo refs; Patch (CAP-004) transforms code; worktree is future.

## Related ADRs

- **ADR-0023** — CAP-002 Git Capability (read-only foundation; no remote URL exposure).
- **ADR-0044** — read-only working-tree diff extension.
- **ADR-0046** — approved exact-file local commit (first Git mutation).
- **ADR-0048** — approved push to a reviewed upstream.
- **ADR-0058** — post-merge fast-forward-only local `main` sync.
- **ADR-0059** — post-merge CAS local merged-branch cleanup.
- ADR-0060 — remote branch cleanup (RepositoryHosting-owned; documents why Git does **not** delete remote branches).
- ARCHITECTURE.md §9 — Workspace Rules. Lifecycle: `docs/lifecycle-state-machine.md`.
