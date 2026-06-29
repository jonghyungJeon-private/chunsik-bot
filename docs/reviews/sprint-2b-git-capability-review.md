# Sprint 2b Review — CAP-002 Git Capability (read-only)

- **Process:** V2 architecture-first. Plan APPROVED WITH CHANGES → implemented the
  approved scope only → validated → this review. **No merge until approved.**
- **Commit message:** `feat(v2-git): add read-only git capability`
- **Branch:** `v2/git-capability` (off `main` / `v1.0.0-rc1`).

## Objective

Introduce **CAP-002 Git** as an independent, **read-only** repository-inspection
capability — `isRepository`, `info`, `status` — separate from CAP-001 Workspace.
**Git ≠ Workspace:** Git owns the *repository* abstraction; Workspace owns the
*filesystem* abstraction.

## Post-review minor improvements (CA final: APPROVED WITH MINOR CHANGES, 99/100)

Applied without adding functionality:
1. **GitStatus reserved fields** — optional `ahead`/`behind`/`isDetached`/`hasUnmergedPaths`
   declared (not populated) to avoid future domain ripple.
2. **GitRunner layering** documented in ADR-0023: `GitRunner` (Infra) → `GitProvider` (Port)
   → `GitManager` (App Service) — a V2 invariant.
3. **RepositoryRef** future direction recorded (non-blocking; sibling of `WorkspaceRef`,
   never cross-referencing) in ADR-0023 + `docs/capabilities/git.md`.

`scanProject` git-branch delegation remains recorded tech debt — intentionally **not** done
in CAP-002 (dedicated cleanup sprint).

## Approved-change compliance (CA review)

| CA decision | Applied |
|---|---|
| Relocate `gitStatus` out of `WorkspaceProvider` → `GitProvider` | ✅ removed from `WorkspaceProvider`; `GitStatus` moved to `domain/git.ts`; `ensureSafe`/`status` → `GitManager` |
| No Git Worktree in 2b (no provider/methods/reserved ops) | ✅ none added; worktree only named as future relationship |
| No remote URL exposure | ✅ `RepositoryInfo` has no remote/url field; stderr sanitized (URL creds masked) |
| Git execution safety (no shell, array spawn, timeout, cwd=root, sanitized stderr, core child_process-free) | ✅ `LocalGitProvider` via array-arg `spawnSync`, 5s timeout, cwd=rootPath, `sanitizeGitStderr`; core has no `child_process` |
| Root-path composition; Git independent of `WorkspaceProvider`/`WorkspaceRef` | ✅ `GitProvider` takes `rootPath: string`; imports no Workspace type |

Out-of-scope (all untouched): commit/checkout/branch/merge/reset/stash/push/pull/fetch/
tag, worktree, remote URL listing, patch, approval, command execution, Codex/Ollama, AI,
Jira/Slack/Confluence.

## Scope Implemented

- **Domain** `git.ts`: `RepositoryInfo` (+ relocated `GitStatus`).
- **Port** `GitProvider` (`isRepository`/`info`/`status`) + `GIT_PROVIDER` token;
  `gitStatus` removed from `WorkspaceProvider`.
- **Core** `GitManager` (`isRepository`/`info`/`status`/`isClean`/`requireClean`);
  `WorkspaceManager` loses `status`/`ensureSafe`.
- **Adapter** new `@chunsik/git-local` (`LocalGitProvider`): argument-array `spawnSync`,
  read-only subcommands (`rev-parse`, `symbolic-ref`, `status --porcelain=v1 -b`), timeout,
  cwd=root, sanitized stderr, injectable `GitRunner`, porcelain parser.
- **Wiring** app.module binds `GIT_PROVIDER → LocalGitProvider` + `GitManager`; monorepo
  `references` + app dep added; `pnpm install` linked the package.

## Architecture Impact

- **Capability independence enforced:** `WorkspaceProvider` no longer mentions git; Git is a
  separate port/adapter/manager. Compose via `rootPath` — zero type coupling.
- **Core invariants preserved:** core stays **dependency-free** and **`child_process`-free**
  (verified); all git execution is adapter-side.
- **No live behavior change:** `gitStatus`/`status`/`ensureSafe` had no live caller; CAP-002
  is not yet wired to any user-facing flow / orchestrator. No DB/persistence change.

## ADR Updates

- **ADR-0023 (Accepted)** — CAP-002 Git Capability: separate from Workspace; read-only in
  2b; worktree excluded; remote URLs excluded; writes require future Approval; git execution
  adapter-only + argument-array. Cross-refs ADR-0022/0018, §9. Capability doc:
  `docs/capabilities/git.md`. CURRENT_STATE + CHANGELOG updated with CAP-IDs.

## Validation

- `pnpm typecheck` → **PASS (exit 0)**.
- `pnpm test` → **16 files / 96 tests PASS** (+15: 12 `git-local` + 3 `git-manager`):
  isRepository (repo/plain/missing), info (normal/non-repo/**detached HEAD**),
  status (clean / untracked+unstaged+staged), **no remote-URL exposure**,
  **argument-array spawn**, **timeout + spawn-failure + non-zero exit** (sanitized),
  porcelain + stderr-sanitizer parsers; GitManager delegation + `isClean`/`requireClean`.
- **Boundary/dependency check:** core `child_process`-free (only doc comments match);
  `git-local` imports only `node:*` + `@chunsik/core`; core imports no adapter; `git-local`
  has no Workspace dependency; `gitStatus` gone from Workspace.
- **No live Discord smoke / no SQLite changes** (per CA).

## Remaining Risks

- `RepositoryInfo` deliberately omits remotes; surfacing them later needs a masking policy + ADR.
- Porcelain parsing is v1 (`--porcelain=v1 -b`); rename handling takes the new path; large
  repos produce large arrays (acceptable for inspection; cap is a future option).
- Real-git unit tests require `git` on PATH (present in CI/dev).

## Technical Debt

- **Flagged (out of 2b):** `scanProject`'s git-branch probe (CAP-001/ADR-0018) still runs git
  inside `workspace-local`; relocate to `GitProvider` in a later cleanup.
- **Future (own ADRs):** masked remotes / ahead-behind; read-only worktree listing; then
  Approval-gated git writes & worktree creation (CAP-003+).

## Deliverables

`git status`, `git log --oneline -3`, `git show --stat --oneline HEAD`, `pnpm typecheck`,
`pnpm test` reported alongside this review.

**Awaiting Chief Architect review. No merge until approved.**
