# Sprint 2b Implementation Plan — CAP-002 Git Capability (read-only inspection)

- **Status:** 🟡 PLAN ONLY — awaiting Chief Architect review. No code, no refactor, no
  commit, no prototype. No existing source file has been modified.
- **Capability:** **CAP-002 — Git** (repository abstraction).
- **Date:** 2026-06-29
- **Process:** V2 architecture-first, Step 1 (Implementation Plan). Plan → review →
  approval → implementation. Do not bypass the planning gate.

---

## 1. Objective

Introduce **CAP-002 Git** as an **independent, read-only** repository-inspection
capability: report whether a path is a git repository, its working-tree status, and
basic repository metadata (branch, HEAD). Git is the *repository* abstraction —
**distinct from CAP-001 Workspace** (the *filesystem* abstraction). This fulfils the
seam ADR-0022 deliberately left as a stub (`gitStatus`) and gives later capabilities
(Approval, Patch, Workspace Write) a trustworthy "is the tree clean / what branch" source.

## 2. Scope (proposed minimal safe scope)

Read-only inspection only, three operations behind a new `GitProvider` port:

1. **`isRepository(rootPath)` → `boolean`** — is the path inside a git work tree.
2. **`status(rootPath)` → `GitStatus`** — `clean`, `branch`, `staged[]`, `unstaged[]`,
   `untracked[]` (reuses the existing `GitStatus` domain type).
3. **`info(rootPath)` → `RepositoryInfo`** — minimal metadata: `isRepository`, `branch`
   (or detached), `headSha?`, `detached`, `rootPath` (the toplevel).

Implementation constraints:
- A new **adapter package `@chunsik/git-local`** (`LocalGitProvider`) runs **read-only**
  git subcommands via **`spawn` with argument arrays** (no shell strings), each with a
  timeout. Whitelisted subcommands only: `rev-parse` (`--is-inside-work-tree`,
  `--show-toplevel`, `--abbrev-ref HEAD`, `HEAD`) and `status --porcelain=v1 -b`.
- **Core stays `child_process`-free and provider-agnostic**: `GitProvider` is a port;
  all git execution lives in the adapter.
- A thin core service **`GitManager`** orchestrates the port (`status`, `info`,
  `isRepository`, `isClean`).
- **`gitStatus` is relocated** off `WorkspaceProvider` onto `GitProvider` (enforcing
  Git ≠ Workspace); the relocated clean-tree guard (`ensureSafe`) moves to `GitManager`.

## 3. Out of Scope (explicit)

- ❌ **Any git write:** no commit, checkout, branch create, merge, reset, stash, push,
  pull, fetch, tag, add. Read-only subcommands only.
- ❌ **Worktree creation** — not in 2b. (A read-only "list worktrees" is mentioned only
  as a *future seam* in §17; nothing is built now.)
- ❌ Approval (CAP-003), Patch (CAP-004), Workspace Write (CAP-005), Command Execution
  (CAP-006), Codex/Ollama (CAP-007/008) — none touched. No AI provider changes.
- ❌ No shell-string commands anywhere; no `shell: true`.
- ❌ No remote-URL / credential exposure (see §13 Security).
- ❌ No change to CAP-001 Workspace behavior (filesystem read/list/diff) beyond removing
  the misplaced `gitStatus` stub from its port.
- ❌ No persistence/SQLite change, no orchestrator/Intent/Capability-routing change, no
  user-facing Discord flow.

## 4. Architecture Impact

- **New capability boundary.** `GitProvider` (port) + `@chunsik/git-local` (adapter) +
  `GitManager` (core service). Git operates on a **`rootPath: string`** — it does **not**
  import `WorkspaceRef` or any Workspace type. Capabilities **compose via the path**, they
  do not depend on each other's types.
- **Core invariants preserved:** core remains dependency-free and `child_process`-free;
  the only new core code is a port interface, a domain VO, and a thin manager.
- **Ports & Adapters intact:** git mechanics isolated in the adapter; selection by DI token.
- **Separation enforced:** the `gitStatus` stub leaves `WorkspaceProvider` (it never had a
  real implementation), making the Workspace port purely filesystem.

## 5. ADR Impact

- **New ADR-0023 — CAP-002 Git Capability (read-only repository inspection).** Records the
  separate `GitProvider` port, the relocation of `gitStatus` from `WorkspaceProvider`, the
  read-only/array-arg/adapter-only execution rule, the no-remote-URL secret rule, and the
  compose-by-rootPath relationship. **Amends/【cross-refs ADR-0022】** (which left `gitStatus`
  a stub "until a future Git capability" — ADR-0023 fulfils it).
- No other ADR changes. (Outline in §18.)

## 6. Capability ID Usage

**CAP-002** is referenced consistently in: ADR-0023, the Sprint 2b review doc, CHANGELOG,
CURRENT_STATE, `docs/capabilities/git.md`, and this plan. (Per the CA capability-ID
system: CAP-001 Workspace, **CAP-002 Git**, CAP-003 Approval, …)

## 7. Files Likely to Be Modified / Created (plan-only — none touched yet)

**New:**
| Path | Purpose |
|---|---|
| `packages/git-local/package.json` | New adapter package `@chunsik/git-local` (dep: `@chunsik/core`). |
| `packages/git-local/tsconfig.json` | Project reference to core. |
| `packages/git-local/src/index.ts` | `LocalGitProvider` (read-only, array-arg `spawn`). |
| `packages/git-local/src/index.test.ts` | Unit tests over temp git repos. |
| `packages/core/src/ports/git-provider.port.ts` | `GitProvider` port + types. |
| `packages/core/src/domain/git.ts` | `RepositoryInfo` (+ `GitStatus` relocated here). |
| `packages/core/src/application/git-manager.ts` | `GitManager` core service. |
| `packages/core/src/application/git-manager.test.ts` | Component test over a fake provider. |
| `docs/capabilities/git.md` | Capability doc (outline in §19). |

**Modified:**
| Path | Change |
|---|---|
| `packages/core/src/ports/tokens.ts` | Add `GIT_PROVIDER` token. |
| `packages/core/src/ports/index.ts` | Export `git-provider.port`. |
| `packages/core/src/ports/workspace-provider.port.ts` | **Remove** `gitStatus` (+ `GitStatus` import). |
| `packages/core/src/domain/workspace.ts` | Move `GitStatus` out to `domain/git.ts` (re-export if needed). |
| `packages/core/src/domain/index.ts` | Export `domain/git`. |
| `packages/core/src/application/workspace-manager.ts` | Remove `status`/`ensureSafe` (relocate to `GitManager`). |
| `packages/core/src/application/index.ts` | Export `GitManager`. |
| `packages/workspace-local/src/index.ts` | Remove the `gitStatus` stub + its imports. |
| `apps/chunsik/src/app.module.ts` | Wire `GIT_PROVIDER → LocalGitProvider` + `GitManager`. |
| `apps/chunsik/tsconfig.json`, `tsconfig.build.json` | Add reference to `packages/git-local`. |
| `DECISIONS.md` | Add ADR-0023. |
| `CURRENT_STATE.md`, `CHANGELOG.md` | CAP-002 status + entry. |

*(`scanProject`'s git-branch probe in `workspace-local` — see §16 — is intentionally left
as-is in 2b; relocating it to `GitProvider` is flagged as follow-up debt, not 2b scope.)*

## 8. New Domain Concepts

- **`RepositoryInfo`** (`domain/git.ts`): `{ isRepository: boolean; rootPath: string;
  branch: string; headSha?: string; detached: boolean }`. Minimal; no remote URL (§13).
- **`GitStatus`** — already exists (`clean`, `branch`, `staged[]`, `unstaged[]`,
  `untracked[]`); **moved** from `domain/workspace.ts` to `domain/git.ts` for capability
  cohesion (a move, not a shape change; re-export to avoid churn if preferred).
- (Considered, deferred) `RepositoryRef` wrapper — not needed for minimal scope;
  `rootPath: string` is the contract, matching `scanProject`/`readProjectFiles`.

## 9. Ports Affected

- **New `GitProvider`** (read-only): `readonly kind: string`; `isRepository(rootPath)`,
  `status(rootPath): GitStatus`, `info(rootPath): RepositoryInfo`. **No write methods.**
- **New DI token** `GIT_PROVIDER`.
- **`WorkspaceProvider`**: `gitStatus` **removed** (was an unimplemented stub). No other
  Workspace port change.

## 10. Adapters Affected

- **New `@chunsik/git-local`** (`LocalGitProvider`) — depends only on `@chunsik/core`;
  uses `node:child_process.spawn`/`spawnSync` with **array args**, read-only subcommands,
  per-call timeout. Parses `status --porcelain=v1 -b` into `GitStatus`.
- **`workspace-local`** — remove the `gitStatus` stub (and now-unused imports). No change
  to `scanProject`/`readProjectFiles`/`resolve`/`readFile`/`listFiles`/`diff`.

## 11. Blast Radius

- **Compile-time:** removing `gitStatus` from `WorkspaceProvider` forces updates in the one
  implementer (`workspace-local`), `WorkspaceManager` (`status`/`ensureSafe` relocate), and
  app wiring; moving `GitStatus`'s definition updates its import sites. All typed, caught by
  `tsc`. New package adds monorepo `references` entries.
- **Runtime (live behavior):** **near-zero.** `gitStatus`/`status`/`ensureSafe` are not on
  any live user path today (no capability reaches them). v1/CAP-001 behavior is untouched.
- **Data:** none (no schema/DB).
- **Dependencies:** no new third-party dependency (git is invoked via `child_process`, no npm lib).
- Net: **Medium** (new package + a port relocation with a single implementer and no live caller).

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Command injection via paths/args | High | `spawn` with **array args only**, never `shell: true`, never string interpolation; pass repo path via `-C <rootPath>`. |
| Git not installed / path not a repo / empty (unborn) repo / detached HEAD | Med | `isRepository` guards; `info`/`status` handle unborn branch (`HEAD`)/detached; non-repo → clear result, not a crash; timeouts. |
| Relocating `gitStatus` breaks `WorkspaceManager.ensureSafe`/wiring | Med | Move `status`/`ensureSafe` to `GitManager` in the same change; typed; no live caller depends on it. |
| Huge repos → large status arrays | Low | Cap parsed entries (e.g. first N) with a documented truncation flag if needed. |
| `GitStatus` move ripples imports | Low | Pure move; optional re-export from `domain/workspace.ts` for one release. |

## 13. Security Considerations

- **Adapter-only git, array-arg `spawn`, no shell** — eliminates command injection.
- **Read-only subcommand whitelist** — physically cannot write the repo.
- **No remote-URL / credential exposure:** `RepositoryInfo` deliberately **excludes remote
  URLs** (e.g. `git remote get-url`), because HTTPS remotes can embed
  `https://user:token@host` credentials. If remotes are ever surfaced (future), they must be
  masked. v1 exposes only branch/HEAD/status — no secret surface.
- **Per-call timeout** on every git invocation; bounded output.
- **Core remains `child_process`-free** and provider-agnostic.
- Path is used only as `-C <rootPath>`; git itself confines operations to that repo.

## 14. Validation Strategy

- `pnpm typecheck` — exit 0 (port relocation must ripple cleanly).
- `pnpm test` (Vitest):
  - **Adapter unit (`git-local`):** over **temporary real git repos** created in test setup
    (test code may run git): `isRepository` true/false; `status` clean vs dirty
    (staged/unstaged/untracked); `info` branch + headSha; **detached HEAD**; **unborn**
    (no commits); **non-repo dir**; never executes a write subcommand (assert via the
    command whitelist / a spy on the runner).
  - **Component (core, `GitManager`):** over a fake `GitProvider` — `isClean`, delegation,
    `requireClean` throws on dirty.
- **No SQLite changes** (N/A). **No live smoke** (no user-facing flow / no AI change).
- **Working tree status** reported at the review step.

## 15. Rollback Strategy

- Mostly **additive** (new package, port, domain VO, `GitManager`); the one subtractive
  change is removing the `gitStatus` stub from `WorkspaceProvider` (+ relocating
  `status`/`ensureSafe`).
- **Rollback = `git revert` the implementation commit** + remove the new package. The
  `gitStatus` stub returns; `GitStatus` location reverts. **No data/schema/migration**;
  no live path depends on any of it → behavior-neutral rollback.

## 16. Relationship with CAP-001 Workspace

- **Compose via `rootPath`.** A Workspace resolves a `WorkspaceRef` (which carries
  `rootPath`); a caller passes that `rootPath` to Git. Git does **not** import `WorkspaceRef`
  or any Workspace type — zero type coupling.
- **`gitStatus` moves home:** it currently sits (as a stub) on `WorkspaceProvider`; CAP-002
  relocates it to `GitProvider`. `WorkspaceManager.ensureSafe` (clean-tree guard) moves to
  `GitManager.requireClean` — Git owns repository state.
- **Known overlap (flagged, not fixed in 2b):** `scanProject` (CAP-001/ADR-0018) detects the
  git branch via `git rev-parse` inside `workspace-local`. To preserve the boundary long-term
  it should delegate to `GitProvider`; doing so now is out of 2b's minimal scope → recorded as
  follow-up tech debt.

## 17. Explicit Separation from Workspace

| | CAP-001 Workspace | CAP-002 Git |
|---|---|---|
| Owns | **Filesystem** abstraction | **Repository** abstraction |
| Operates on | `WorkspaceRef` (file I/O within root) | `rootPath` (git inspection) |
| Reads | file contents, listings, diffs | branch, status, HEAD, is-repo |
| Uses git? | **No** | Yes (read-only, adapter) |
| Uses `child_process`? | **No** | Yes (adapter only) |
| Port | `WorkspaceProvider` | `GitProvider` (separate) |

They never merge; neither imports the other's types. **Workspace ≠ Git** holds.

## 18. Future Relationship with Approval / Patch / Worktree

- **Approval (CAP-003):** Git read (`status`/`isClean`) is LOW-risk, no approval. Future git
  **writes** (commit/push) will be gated by Approval — not in this capability.
- **Patch (CAP-004):** Patch turns a `WorkspaceDiff` (CAP-001) into a change set; Git
  `isClean`/`status` tells whether the tree is safe to apply to (read input to the
  Approval→Write flow). Patch application itself is a write, gated, later.
- **Worktree:** worktree **creation is a write** → deferred. A future read-only "list
  worktrees" could extend `GitProvider`; a write-capable `GitWorktreeProvider` would sit
  behind Approval. **Nothing worktree is built in 2b** (mentioned only as a future seam).
- **Workspace Write (CAP-005) / Command Execution (CAP-006):** consume Git's clean-tree
  guard before mutating; both gated by Approval.

---

## 19. Proposed ADR-0023 — outline

> **Title:** ADR-0023 — CAP-002 Git Capability (read-only repository inspection)
> **Status:** (Proposed → Accepted on approval) · **Date:** 2026-06-…

- **Context:** ADR-0022 left `gitStatus` a stub "until a future Git capability"; Approval/
  Patch/Write need trustworthy repository state. Git must be a *separate* capability.
- **Decision:**
  - New `GitProvider` port (read-only: `isRepository`, `status`, `info`) + `GIT_PROVIDER`
    token; new `@chunsik/git-local` adapter (array-arg `spawn`, read-only subcommands,
    timeouts); new `GitManager` core service.
  - Relocate `gitStatus` from `WorkspaceProvider` → `GitProvider`; move `GitStatus` to
    `domain/git.ts`; relocate `ensureSafe` → `GitManager.requireClean`.
  - Compose by `rootPath`; Git imports no Workspace type. Core stays `child_process`-free
    and provider-agnostic.
  - **No writes**, **no worktree creation**, **no remote-URL exposure** (credential safety).
- **Consequences:** + clean Git/Workspace separation, a trustworthy repo-state source for
  future gated writes; − a port relocation (single implementer, no live caller); − `scanProject`
  git-branch overlap remains as flagged debt.
- **Capability:** CAP-002. **Relates:** ADR-0018 (`scanProject`), ADR-0022 (CAP-001), §9.

## 20. Proposed `docs/capabilities/git.md` — outline

> Sections (same template as `workspace.md`):
- **Purpose** — repository abstraction; read-only inspection (branch/status/metadata).
- **Responsibilities** — `isRepository`, `status` (clean/staged/unstaged/untracked),
  `info` (branch/HEAD/detached); clean-tree guard via `GitManager`.
- **Out of Scope** — all writes (commit/checkout/branch/merge/reset/stash/push), worktree
  creation, Approval, Patch, AI; no remote-URL exposure; no shell strings.
- **Public API** — `GitProvider` (port) methods; `GitManager` (core); `RepositoryInfo`,
  `GitStatus` (domain). Composition: takes `rootPath` (from a CAP-001 `WorkspaceRef`).
- **Future Expansion** — read-only worktree listing; ahead/behind; masked remotes; then
  (behind Approval) git writes / worktree creation.
- **Related ADRs** — ADR-0023 (primary), ADR-0022 (Workspace), ADR-0018 (registration).

---

## Next Step

Per the V2 process: **stop here and wait for Chief Architect review.** On approval I will
implement **only** the approved scope (minimal read-only Git), then validate and produce the
Sprint 2b review. No code, refactor, commit, or prototype until then.
