# Sprint 2a Review — Workspace Capability (Read / Diff Foundation)

- **Process:** Version 2 architecture-first. Plan APPROVED WITH CHANGES → implemented
  the approved scope only → validated → this review. **No merge until approved.**
- **Commit message:** `feat(v2-workspace): add read-only workspace capability`
- **Branch:** `v2/workspace-read-diff` (off `v1.0.0-rc1` / `main`).

## Objective

Turn the stubbed `WorkspaceProvider` filesystem surface into a **production-grade,
read-only Workspace foundation**: resolve a workspace, read files, list files, and
generate a unified diff of proposed changes — the pre-approval base for every future
coding capability. **Workspace ≠ Git** (ADR-0022).

## Post-review minor improvements (CA: APPROVED WITH MINOR CHANGES, 99/100)

Applied without adding scope:
1. **WorkspaceRef** — kept stable `id`; added optional `metadata` (future docker/ssh/
   remote providers); documented `kind` as the provider discriminator.
2. **WorkspaceDiff.estimatedChangedLines** — added; computed once by the provider for
   future Approval sizing.
3. **WorkspacePolicy** — consolidated ignore/secret/maxSize/binary rules into a named
   value object (`DEFAULT_WORKSPACE_POLICY`); per-project config deferred.
4. **Capability doc** — `docs/capabilities/workspace.md` added.

## Approved-change compliance (CA review)

| CA decision | Applied |
|---|---|
| 1. `resolve(workspaceRef)`; core builds the ref; provider never queries storage | ✅ `WorkspaceManager.open(project)` builds the `WorkspaceRef` (kind from `provider.kind`); `resolve(ref)` only validates. |
| 2. Remove Git entirely (no git status/diff/command) | ✅ `node:fs` only; no `child_process` in the new methods; `gitStatus` left a stub. |
| 3. Mature diff library, adapter-only, core dep-free, replaceable | ✅ `diff` (jsdiff v9) added to **workspace-local** only; `@chunsik/core` stays zero-dep. |
| 4. Diff source = current file → proposed content (no git/repo state) | ✅ `diff(ref, changes)` reads current file + proposed content; no repository state. |
| 5. Surface = `resolve`/`readFile`/`listFiles`/`diff`; drop `gitStatus` | ✅ exactly those four implemented; `gitStatus` not implemented. |

Read-only guarantee: **no write/delete/rename, no shell, no git, no child_process, no
repository mutation** in the new code paths.

## Scope Implemented

- `WorkspaceProvider` port: `resolve(ref)` (signature changed from `(projectId, options)`),
  new `diff(ref, changes)`, read methods documented as implemented; `ResolveOptions`
  (git-branch) removed.
- Domain: `DiffChangeKind`, `ProposedChange`, `FileDiff`, `WorkspaceDiff` (pure VOs).
- `WorkspaceManager`: `open(project)`, `read`, `list`, `diff`; `prepare(task)` deferred
  (honest `NotImplementedError` — a Task carries no rootPath; callers use `open`).
- `LocalCloneWorkspaceProvider`: `resolve`/`readFile`/`listFiles`/`diff` over `node:fs`,
  with a path sandbox (`resolveWithin`: rejects absolute, `..`, symlink escape), secret
  + ignored-dir exclusion, a 256 KB size guard, binary detection, and a list cap. A
  zero-dep `matchGlob` powers the optional `listFiles` filter; `createTwoFilesPatch`
  (jsdiff) produces unified diffs.

## Architecture Impact

- **Ports & Adapters preserved**; all fs work is in the adapter, core is filesystem-agnostic.
- **Core remains dependency-free** — the diff library lives only in `workspace-local`.
- **No orchestrator / AI / DB change.** No new Intent/Capability; the foundation is
  infrastructure for later slices. `resolve`'s signature change ripples only through the
  single implementer + `WorkspaceManager` (typed, caught by `tsc`); **no live path** uses
  it today (`needsWorkspace` covers only not-yet-reachable capabilities).
- `WorkspaceDiff` is the explicit **pre-approval** representation, designed before any write.

## ADR Updates

- **ADR-0022 (Accepted)** — Workspace Capability (Read/Diff). Emphasizes **Workspace ≠
  Git**, the `resolve(ref)` decision, read-only-fs-only, diff-source = current→proposed,
  diff-lib-in-adapter, and the sandbox/guards.
- `ARCHITECTURE.md` §9 gains rule 6 (Workspace ≠ Git; read-only slice). `CURRENT_STATE.md`
  updated (phase 2a; Implemented += Workspace read-only; test counts).

## Validation

- `pnpm typecheck` → **PASS (exit 0)**.
- `pnpm test` → **14 files / 81 tests PASS** (+15 vs rc1: 12 adapter + 3 manager).
  - **Workspace unit:** resolve real/non-dir; readFile within-root.
  - **Path traversal:** `../../../etc/passwd` and absolute paths rejected; symlink-escape
    guard in `resolveWithin`.
  - **Secret exclusion:** `readFile('.env')` refused; `listFiles` omits `.env`/secrets.
  - **Diff generation:** add/modify/delete produce correct unified hunks.
  - **Large-file guard:** 300 KB file → `readFile` throws; `diff` marks `truncated`,
    empty unified.
  - **Binary guard:** binary `readFile` throws; `diff` flags `binary:true`.
  - **Component (core):** `open()` builds the ref from `provider.kind`; read/list/diff
    delegate; `prepare` returns undefined w/o project, defers otherwise.
- **Live smoke:** not required (CA) — no user-facing flow / no AI execution change.
- **SQLite:** unchanged (CA) — no persistence touched.

## Remaining Risks

- The read surface refuses secret-named files and follows no symlinks — conservative;
  a future capability may need to relax this deliberately (own ADR).
- `matchGlob` is a minimal matcher (`*`/`**`/`?`); sufficient for the foundation, not a
  full globber. Documented; replaceable.
- `diff` (jsdiff) is a new adapter dependency (supply-chain surface) — isolated to
  workspace-local and replaceable per ADR-0022.

## Technical Debt

- **Immediate:** none introduced.
- **V2 (later slices, each its own ADR):** task→workspace wiring (`prepare`/`open` from the
  orchestrator); **Git Capability** (`gitStatus`, working-tree diff); approval-gated
  `writeFile`/patch application; `runCommand` execution; worktree provider.

## Deliverables (git + validation evidence)

See the command outputs reported alongside this review: `git status`,
`git log --oneline -3`, `git show --stat --oneline HEAD`, `pnpm typecheck`, `pnpm test`.

**Awaiting Chief Architect review. No merge until approved.**
