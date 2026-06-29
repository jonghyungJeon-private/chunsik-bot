# Capability — Workspace

> Version 2 is capability-driven. This is the lightweight doc for the **Workspace**
> capability. Authority: `ARCHITECTURE.md` (§9) and `DECISIONS.md` (ADR-0022).

## Purpose

Provide a **production-grade, read-only filesystem abstraction** over a project's
local working directory — the foundation every future coding capability builds on
(`Read → Analyze → Plan → Diff → Approval → Write → Execute → Commit`). Sprint 2a
delivers the **Read + Diff** foundation only.

## Responsibilities

- **Resolve** a workspace from a core-built `WorkspaceRef` (stable `id`, `rootPath`,
  provider `kind`, optional `metadata`).
- **Read** a single file's text — sandboxed, size- and binary-guarded.
- **List** file paths under the root — read-only, ignore/secret-filtered, optional glob.
- **Diff** a set of proposed changes (current file → proposed content) into a unified
  `WorkspaceDiff`, including `estimatedChangedLines` for later Approval sizing.
- Enforce read-only access rules via a `WorkspacePolicy` (ignored dirs, secret
  exclusion, max file size, binary handling).

All filesystem interaction lives in the `workspace-local` adapter; `@chunsik/core`
stays filesystem-agnostic and dependency-free.

## Out of Scope

Workspace owns **filesystem** abstraction only. It is **not** Git, Approval, or Patch:

- ❌ No write / delete / rename, no `writeFile`/`writeContextFiles`.
- ❌ No shell / `runCommand`, no `child_process`.
- ❌ **No Git** — no `gitStatus`, no working-tree diff, no repository state. *(Workspace
  ≠ Git; a separate Git capability owns the repository abstraction.)*
- ❌ No Approval / authorization (Approval capability), no patch application (Patch
  capability), no AI execution, no persistence change.

The diff compares **current file → proposed content** only — never git history.

## Public API

`WorkspaceProvider` (port) — read-only methods (Sprint 2a):

| Method | Description |
|---|---|
| `resolve(ref: WorkspaceRef): WorkspaceRef` | Validate/prepare a core-built ref (provider never queries storage). |
| `readFile(ref, relPath): string` | Read one file's text, sandboxed; refuses secret/binary/oversized. |
| `listFiles(ref, glob?): string[]` | List relative file paths; excludes ignored dirs/secrets; optional glob. |
| `diff(ref, changes: ProposedChange[]): WorkspaceDiff` | Unified diff of proposed changes vs current content. |

`gitStatus` / `writeFile` / `writeContextFiles` / `runCommand` remain
`NotImplementedError` stubs (future capabilities).

Core orchestration — `WorkspaceManager`: `open(project)` (builds the `WorkspaceRef`),
`read`, `list`, `diff`. Domain value objects: `WorkspaceRef`, `ProposedChange`,
`FileDiff`, `WorkspaceDiff`, `DiffChangeKind`. Adapter value object:
`WorkspacePolicy` (+ `DEFAULT_WORKSPACE_POLICY`).

Guards: path sandbox (reject absolute, `..`, symlink escape); secret exclusion;
256 KB per-file size guard; binary flagging; 5000-entry list cap.

## Future Expansion

- **Configurable `WorkspacePolicy`** — per-project readable/ignored/maxSize, lifted to
  a core domain VO when projects need different policies.
- **More providers** under the same port — Git Worktree, Docker, SSH, Remote
  (`WorkspaceRef.metadata` carries provider-specific data).
- **Write path** (separate slices): approval-gated `writeFile`, patch application,
  `runCommand` execution — each behind the Approval capability.
- **Git capability** (separate): `gitStatus`, working-tree diff, branch/commit.

## Related ADRs

- **ADR-0022** — Workspace Capability (Read/Diff foundation). *(primary)*
- ADR-0018 — Local project registration (`scanProject`).
- ADR-0019 — Gated project analysis (distinct, narrower read surface).
- ARCHITECTURE.md §9 — Workspace Rules (incl. Workspace ≠ Git).
