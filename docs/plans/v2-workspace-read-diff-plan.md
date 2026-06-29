# V2 Implementation Plan — Workspace Capability (Read / Diff Foundation)

- **Status:** 🟡 PLAN ONLY — awaiting Chief Architect review (no code written).
- **Date:** 2026-06-29
- **Process:** Version 2 architecture-first, Step 1 (Implementation Plan). No code,
  no commit, no refactoring until APPROVED.
- **Capability:** the **first** V2 capability — Workspace, **read-only** slice
  (Read + Diff). The pre-write foundation for the target flow
  `User → Workspace → Read → Analyze → Plan → Diff → Approval → Write → Execute → Commit → Artifact`.
  This slice delivers **Read** and **Diff** only; everything from Approval onward is
  out of scope.

---

## 1. Objective

Turn the stubbed `WorkspaceProvider` filesystem/git surface into a **production-grade,
read-only Workspace abstraction** that can:

1. **Resolve** a workspace for a registered project (a `WorkspaceRef`).
2. **Read** files and list entries from that workspace — sandboxed, bounded,
   secret-filtered.
3. **Inspect** git state (`gitStatus`) read-only.
4. **Generate diffs** — produce a unified `WorkspaceDiff` for a set of *proposed*
   changes (proposed content vs. current on-disk content) **without writing
   anything**, plus surface the working-tree diff (read-only).

The slice is the stable contract every future coding capability (worktrees, patch
generation, approval-gated write, Codex/Ollama execution) builds on, while changing
**nothing** about how v1 behaves today.

---

## 2. Scope (what this slice delivers)

- Implement the **read-only** `WorkspaceProvider` methods that are currently stubs:
  `resolve`, `gitStatus`, `readFile`, `listFiles`.
- Add a **read-only diff** capability behind the port:
  `diff(ref, changes)` → `WorkspaceDiff` (unified hunks per file; computed from
  current content + proposed content; no write).
- Add the matching **domain value objects** (`WorkspaceListingEntry`,
  `ProposedChange`, `FileDiff`, `WorkspaceDiff`, `DiffChangeKind`).
- Extend **`WorkspaceManager`** (core) with thin, safety-enforcing passthroughs:
  `open(project)`, `read(ref, relPath)`, `list(ref, glob?)`, `diff(ref, changes)`.
- Implement everything in the **`workspace-local` adapter** (`LocalCloneWorkspaceProvider`)
  using `node:fs` + a constrained read-only `git` invocation (status/diff only).
- **Path-sandboxing** guard: every read/list/diff path is resolved and confined to the
  workspace root (reject `..`, absolute escapes, and symlink escapes).
- **Tests:** unit (adapter) + component (core) covering resolve, read, list, diff
  (add/modify/delete), gitStatus, and the sandbox/secret/size guards.
- **Docs (at the Review step, not now):** new ADR; `ARCHITECTURE.md` §9 / `CURRENT_STATE.md`
  status updates.

---

## 3. Out of Scope (explicitly NOT in this slice)

- ❌ `writeFile`, `writeContextFiles`, `runCommand` — stay stubbed (`NotImplementedError`).
- ❌ Any file modification, git write (add/commit/push/checkout), or branch creation.
- ❌ Git **worktree** provider (`GitWorktreeWorkspaceProvider`) — same port later; not now.
- ❌ Patch **application**; the slice generates a diff but never applies it.
- ❌ Approval system, risk-gated execution, `handleApprovalDecision`.
- ❌ New user-facing **Intent/Capability** or any orchestrator behavior change
  ("No AI execution changes"). No `ChunsikCore` flow change.
- ❌ Codex, Ollama, Jira, Slack, Confluence, Vector/semantic search.
- ❌ Changing ADR-0019 gated analysis (the analysis allow-list is untouched and stays
  a distinct, narrower surface).
- ❌ SQLite/schema/persistence changes; performance optimization; unrelated refactor.

---

## 4. Architecture Impact

- **Ports & Adapters preserved.** All `fs`/`git` work stays in the `workspace-local`
  adapter behind `WorkspaceProvider`. Core gains only domain value objects + a port
  contract + thin `WorkspaceManager` orchestration.
- **Core stays dependency-free.** Diff computation may use a small library, but **only
  in the adapter** — `@chunsik/core` keeps its zero-dependency invariant (audit-praised).
  Domain `WorkspaceDiff` is a plain data type; the algorithm lives adapter-side.
- **Capabilities-above-models** unaffected — no provider/AI logic touched.
- **Safety rules (§9, §12) upheld:** the port still exposes no auto-commit/push/delete;
  this slice adds only read + diff. `WorkspaceManager.ensureSafe` (clean-tree guard)
  remains the gate that future write slices must pass.
- **Diff is the Approval bridge.** `WorkspaceDiff` is the artifact a later slice routes
  through the approval gate before any `writeFile`. Designing it now fixes that seam.
- **One contract change:** `resolve` needs the project's root path (see §10/§ "Open
  Questions"); the adapter must NOT depend on storage. This is the one
  constitution-relevant decision and is ADR-gated.

---

## 5. ADR Impact

- **New: ADR-0022 — Workspace Read/Diff foundation.** Records: the read-only method set
  now implemented; the `resolve(project)` input change and why the adapter must not read
  storage; the path-sandbox security model; the read-only-git decision; `WorkspaceDiff`
  as the pre-approval representation; diff-library-in-adapter to keep core dep-free.
- **Cross-references:** ADR-0018 (`scanProject`), ADR-0019 (analysis allow-list — kept
  distinct), ARCHITECTURE.md §9 (Workspace Rules) and §13 (worktree evolution path).
- **No amendment** to ADR-0019; the general workspace read is a separate surface from the
  analysis allow-list.
- Confirms the §9 invariant for the future: write/commit only after approval.

---

## 6. Files to Modify (planned — not yet touched)

| File | Change |
|---|---|
| `packages/core/src/domain/workspace.ts` | Add `WorkspaceListingEntry`, `DiffChangeKind`, `ProposedChange`, `FileDiff`, `WorkspaceDiff`. |
| `packages/core/src/ports/workspace-provider.port.ts` | Refine `resolve` input (carry rootPath); add `diff(ref, changes)`; mark read methods as implemented. |
| `packages/core/src/application/workspace-manager.ts` | Add `open(project)`, `read`, `list`, `diff`; keep `ensureSafe`/read-only guards. |
| `packages/workspace-local/src/index.ts` | Implement `resolve`, `gitStatus`, `readFile`, `listFiles`, `diff`; add path-sandbox + read-only git helpers. Keep write/runCommand stubbed. |
| `packages/workspace-local/package.json` | (If chosen) add a diff library dependency. |
| `packages/workspace-local/src/index.test.ts` | New cases: resolve, read, list, diff, gitStatus, sandbox/secret/size. |
| `packages/core/src/application/workspace-manager.test.ts` *(new)* | Component tests over a fake provider (safety/passthrough/path-guard semantics). |
| `DECISIONS.md` | Add ADR-0022 (at implementation/review step). |
| `ARCHITECTURE.md`, `CURRENT_STATE.md` | Status updates (at review step). |

*No `apps/chunsik` wiring change is required (the providers are already bound); no
orchestrator change.*

---

## 7. New Domain Concepts

All plain, I/O-free value objects in `@chunsik/core/domain/workspace.ts`:

- **`WorkspaceListingEntry`** `{ path: string; kind: 'file' | 'dir' }` — one `listFiles` row.
- **`DiffChangeKind`** `'add' | 'modify' | 'delete'`.
- **`ProposedChange`** `{ path: string; newContent?: string; delete?: boolean }` — the
  **input** to diff generation (proposed end-state; `newContent` omitted + `delete` ⇒ removal).
- **`FileDiff`** `{ path; changeKind: DiffChangeKind; unified: string; oldSize?; newSize?; binary: boolean }`
  — one file's unified-diff text (empty/flagged for binary).
- **`WorkspaceDiff`** `{ refId: Id; files: FileDiff[]; truncated: boolean }` — the whole
  proposed change set; the future Approval input / `ArtifactKind.CODE_DIFF` source.

No new entities, aggregates, repositories, or enums beyond the small union types above.
Reuses existing `WorkspaceRef`, `GitStatus`.

---

## 8. Ports Affected

**`WorkspaceProvider`** (the only port touched):
- `resolve(...)` — input refined to carry the project root path (decision in §"Open
  Questions"); returns `WorkspaceRef`.
- `gitStatus(ref)` — implement (read-only `git status --porcelain -b`).
- `readFile(ref, relPath)` — implement (sandboxed read).
- `listFiles(ref, glob?)` — implement (sandboxed, excludes ignored dirs).
- **New** `diff(ref, changes: ProposedChange[]): Promise<WorkspaceDiff>` — read-only.
- `writeFile`, `writeContextFiles`, `runCommand` — **unchanged stubs.**

No other port (Storage, AiProvider, Platform, Queue, Vector, Connector, Logger) changes.

---

## 9. Adapters Affected

**`workspace-local` (`LocalCloneWorkspaceProvider`)** — the only adapter:
- Implements the read-only methods + `diff`.
- Adds private helpers: `resolveWithin(root, relPath)` (sandbox), `runGitReadonly(args)`
  (constrained, array-arg, timeout, **read-only** git: `status`, `diff`), and unified-diff
  generation.
- Reuses existing `TREE_EXCLUDE` / `isSecretName` / size-cap conventions.
- `GitWorktreeWorkspaceProvider` is **not** added (future slice; same port).

---

## 10. Blast Radius

- **Compile-time:** changing `resolve`'s input + adding `diff` to the port forces all
  implementers to conform — but `LocalCloneWorkspaceProvider` is the **only** one, and
  `WorkspaceManager.prepare`/`open` are the only callers. Contained, typed, caught by
  `tsc`.
- **Runtime (live behavior):** **near-zero.** `resolve`/read/diff are not on any live
  user path today (`needsWorkspace` only covers CODE_IMPLEMENTATION/TEST_EXECUTION, which
  are not yet reachable). v1 chat, registration, and analysis are untouched.
- **Data:** none — no schema, no migration, no DB access added (adapter reads FS/git only).
- **Dependencies:** at most one new **adapter** dependency (diff lib); core unchanged.
- Net: **Low–Medium** (a port-shape change with a single implementer and no live caller).

---

## 11. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Path traversal / symlink escape** (read outside the workspace) | High | `resolveWithin`: `realpath`-resolve and assert the result is inside the workspace root; reject `..`, absolute paths, and symlinks pointing outside. Unit-tested. |
| **Secret exposure** via general read (broader than the ADR-0019 allow-list) | Med | Keep `isSecretName` filtering + size caps on `readFile`/`listFiles`; document that general read is sandboxed but not allow-listed; never read `.git/` internals. |
| **"No shell execution" vs read-only git** for `gitStatus`/working-tree diff | Med | Use a constrained, array-arg, read-only git invocation (precedented by `scanProject`'s `git rev-parse`); never a shell string, never a write subcommand. **Flagged for CA decision** (Q2). |
| **Scope creep toward write** | Med | Write methods stay stubbed; `diff` takes proposed content and returns text only — it physically cannot write. |
| **`resolve` needs rootPath without a storage dep in the adapter** | Med | Caller (core) supplies the project root; adapter stays storage-free (Q1). |
| **Binary / very large files** in read & diff | Low | Detect binary (NUL byte) → `binary:true`, skip unified text; enforce per-file size cap + total `truncated` flag. |
| **Core zero-dep invariant regression** | Low | Diff lib (if any) is an **adapter** dependency only; core imports nothing new. |

---

## 12. Validation Strategy

- `pnpm typecheck` — exit 0 (port-shape change must ripple cleanly).
- `pnpm test` (Vitest):
  - **Adapter unit:** resolve returns a `local-clone` ref at the project root; `readFile`
    reads within root and **rejects** `../etc/passwd`, absolute paths, and out-of-root
    symlinks; `listFiles` excludes `node_modules/dist/.git/...`; `gitStatus` parses
    clean vs dirty (staged/unstaged/untracked); `diff` yields correct unified hunks for
    **add / modify / delete** and flags binary.
  - **Component (core):** `WorkspaceManager.open/read/list/diff` over a temp git repo;
    `ensureSafe` still throws on a dirty tree.
- **Component tests** (per process): the core service exercised over a fake provider for
  safety/passthrough semantics.
- **Live smoke:** N/A for this slice (no user-facing flow / no AI execution change).
  Optional: a throwaway script resolving this repo, reading a file, and diffing a
  proposed edit — to demonstrate, not wired into Discord.
- **SQLite verification:** N/A (no persistence change).
- **Working tree status** reported at the Review step; only planned files changed.

---

## 13. Rollback Strategy

- The change is **additive + stub-filling**: new domain types, implemented read methods,
  a new `diff` method, thin manager passthroughs. No data, schema, migration, or config
  change; no live capability depends on it.
- **Rollback = `git revert` the implementation commit.** The read methods return to
  throwing `NotImplementedError`; the `resolve` signature reverts; domain types drop out.
  Because nothing live calls these paths, revert is behavior-neutral for v1.
- No forward-incompatible artifacts are produced (diffs are ephemeral, not persisted in
  this slice), so there is nothing to clean up on rollback.

---

## Open Questions for Chief Architect (decide before/with approval)

1. **`resolve` input.** The adapter must not import storage (cross-adapter dep is
   forbidden), so it cannot map `projectId → rootPath` itself. Proposed: change the
   contract to `resolve(project: { id: Id; rootPath: string }, options?)` and have the
   **core** supply the root (from the `Project` it already holds). Acceptable, or prefer
   an injected read-only project lookup into `WorkspaceManager`?
2. **Read-only git.** Does `gitStatus` / working-tree `git diff` (constrained, array-arg,
   no shell string, read-only subcommands) satisfy the "no shell execution" rule, given
   `scanProject` already runs `git rev-parse`? Or should the slice be **pure-fs only**
   (no git at all) and defer all git to a later slice?
3. **Diff engine.** Use a mature library (e.g. `diff`/jsdiff) **in the adapter**, or
   hand-roll a minimal zero-dep unified diff? (Core stays dep-free either way.)
4. **Diff source.** Confirm the slice generates diffs from **proposed content** (the
   pre-write/approval seam) and optionally surfaces the **working-tree** diff — vs.
   working-tree only.

---

## Next Step

Per the V2 process: **stop here and wait for review.** No code, commit, or refactor
until the plan is APPROVED / APPROVED WITH CHANGES. On approval I will implement
**only** the approved scope, then run Validation (Step 4) and produce the Review (Step 5).
