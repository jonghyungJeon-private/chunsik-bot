# Capability — Git (CAP-002)

> V2 is capability-driven. Lightweight doc for the **Git** capability.
> Authority: `ARCHITECTURE.md` (§9) and `DECISIONS.md` (ADR-0023).

## Purpose

Provide a **read-only repository abstraction**: report whether a path is a git work
tree, its working-tree status, and minimal repository metadata (branch / HEAD /
detached). Git is the *repository* abstraction — the trustworthy source of repo state
for future Approval / Patch / Workspace-Write capabilities.

## Responsibilities

- `isRepository(rootPath)` — is the path inside a git work tree.
- `info(rootPath) → RepositoryInfo` — `isRepository`, resolved `rootPath`, `branch`,
  `headSha?`, `detached`. **No remote URLs.**
- `status(rootPath) → GitStatus` — `clean`, `branch`, and `staged` / `unstaged` /
  `untracked` changed-file summaries.
- `GitManager` adds `isClean` and `requireClean` (read-only guard for future writes).
- Execute git **adapter-side only**, via argument-array `spawn`, with a timeout, cwd =
  repository root, and **sanitized stderr**.

## Out of Scope

- ❌ **All writes:** commit, checkout, branch creation, merge, reset, stash, push, pull,
  fetch, tag, add. (Read-only subcommands only.)
- ❌ **Worktree** — no creation, no methods, not even a reserved operation (future only).
- ❌ **Remote URL listing / exposure** — excluded; needs a future masking policy + ADR.
- ❌ Approval, Patch, Command Execution, Codex/Ollama, AI provider changes, connectors.
- ❌ No shell strings / `shell: true`. Core never touches `child_process`.

## Public API

`GitProvider` (port) — `kind`, `isRepository(rootPath)`, `info(rootPath)`,
`status(rootPath)`. Token: `GIT_PROVIDER`. Adapter: `@chunsik/git-local`
(`LocalGitProvider`, injectable `GitRunner`). Core service: `GitManager`
(`isRepository`/`info`/`status`/`isClean`/`requireClean`). Domain: `RepositoryInfo`,
`GitStatus` (`domain/git.ts`).

**Composition:** takes a plain `rootPath`. A CAP-001 Workspace resolves a `WorkspaceRef`
whose `rootPath` is passed to Git — Git imports **no** Workspace type.

## Future Expansion

- **`RepositoryRef`** (non-blocking) — a dedicated domain Value Object
  `{ id, rootPath, provider, metadata }`, the Git sibling of `WorkspaceRef`. The two must
  **never** reference each other; capabilities compose through these sibling refs. 2b uses
  `rootPath: string`; `RepositoryRef` is considered for CAP-003+.
- Populate the reserved `GitStatus` fields (`ahead`/`behind`/`isDetached`/`hasUnmergedPaths`).
- Masked remote info; read-only worktree listing; then, **behind Approval**, worktree
  creation and git writes (commit/checkout/branch).
- Relocate `scanProject`'s git-branch probe (CAP-001) to delegate to `GitProvider`
  (recorded tech debt; a dedicated cleanup sprint, not CAP-002).

## Layering (responsibility split)

`GitRunner` (Infrastructure — argv-array spawn) → `GitProvider` (Port) → `GitManager`
(Application Service). The Manager never spawns; only the adapter Runner runs git.

## Boundaries (capability independence)

- **Git ≠ Workspace** — Git = repository; Workspace = filesystem. Separate ports.
- **Git ≠ Approval** — Git never authorizes; writes will be gated by Approval (CAP-003).
- **Git ≠ Patch** — Git reports state; Patch (CAP-004) transforms code.
- **Git ≠ Worktree** — worktree is a future, separate concern (write).

## Related ADRs

- **ADR-0023** — CAP-002 Git Capability (primary).
- ADR-0022 — CAP-001 Workspace (filesystem; Workspace ≠ Git).
- ADR-0018 — Local project registration (`scanProject` git-branch probe).
- ARCHITECTURE.md §9 — Workspace Rules.
