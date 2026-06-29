# Sprint 1f Review

## Objective

"사용자가 로컬 프로젝트를 등록하고, 이후 대화에서 해당 프로젝트 맥락을 사용할 수 있다." — register a
local project from a natural-language message (read-only scan), persist it + a PROJECT
memory, bind it to the session, and feed that context into later answers. Also folds in
the 1e carryover decisions (SHORT_TERM cap = 30/session; current message excluded from
recent context).

## Scope

- `REGISTER_PROJECT` intent (path extracted) → `ProjectManager` (deterministic command).
- `WorkspaceProvider.scanProject` (read-only: exists/name/gitBranch/packageManager/fileTreeSummary).
- Persist `Project` (SQLite) + PROJECT memory (scoped by projectId); set `session.activeProjectId`.
- `ContextBuilder` includes active project memory; `PromptComposer` renders it.
- Memory pruning (30/session) + current-message exclusion (ADR-0017 addendum).

## Files Changed

**Core:**
- `domain`: `IntentType.REGISTER_PROJECT`, `Session.activeProjectId`, `ContextBundle.projectSummary`.
- `ports/workspace-provider.port.ts`: `ProjectScan` + `scanProject`.
- `application/project-manager.ts` *(new)*: scan → persist Project → PROJECT memory → bind session.
- `application/intent-classifier.ts`: detect REGISTER_PROJECT + extract path.
- `application/memory-manager.ts`: `recordProjectMemory`/`projectMemory`; SHORT_TERM pruning (cap 30).
- `application/context-builder.ts`: exclude current message; include project summary.
- `application/prompt-composer.ts`: render project context; system prompt = answer from context, no file/tool access.
- `application/session-manager.ts`: `setActiveProject`. `workspace-manager.ts`: `scan`.
- `application/orchestrator.ts`: REGISTER_PROJECT branch; task `projectId`; exclude current msg;
  **workspace prep gated to filesystem capabilities** (bug fix, below).

**Adapters:** `workspace-local` (`scanProject` read-only fs); `storage-sqlite` (real `projects`
repo + `memories.project_id` column + migration).
**App:** `app.module.ts` (ProjectManager wiring), `main.ts` (startup log).
**Tests:** `project-manager.test.ts` *(new)*, `workspace-local/index.test.ts` *(new)*,
`memory-manager.test.ts` + `context-builder.test.ts` (updated).
**Docs:** ADR-0018, CHANGELOG, CURRENT_STATE, this review.

## Architecture Impact

Conforms to `ARCHITECTURE.md`. Filesystem access (scan) and git/lockfile detection live in
the `workspace-local` adapter; SQL in `storage-sqlite`; Discord in its adapter. Core depends
only on ports. Registration is modeled as a deterministic command (not routed to an AI
provider), documented in ADR-0018.

## ADR Impact

**Added ADR-0018** (local project registration). **ADR-0017 addendum**: SHORT_TERM cap = 30/session;
current message excluded from recent context.

## Runtime Flow

```
"이 프로젝트 등록해줘: /path"
  → IntentClassifier → REGISTER_PROJECT (path)
  → ProjectManager.register: workspace.scan(path) [read-only]
       exists? → Project saved → memory.recordProjectMemory(summary, {projectId, sessionId})
                → sessions.setActiveProject(session, projectId) → reply "등록 완료"
       missing? → friendly failure, nothing persisted

"이 프로젝트가 어떤 구조인지 설명해줘"
  → createTask(projectId = session.activeProjectId)
  → ContextBuilder: recent SHORT_TERM (current msg excluded) + projectMemory(projectId) summary
  → PromptComposer: context = "Active project: …" + recent; system = "answer from context, no file/tool access"
  → CapabilityRouter → ClaudeCliProvider (no workspace prep for chat) → answer from the summary
```

## Persistence Result (live smoke)

| check | result |
|---|---|
| `projects` | 1 — `chunsik-bot-2` @ `/Users/.../demo_Project/chunsik-bot-2` |
| `sessions.activeProjectId` | `966f485c-…` (set) |
| `memories type=PROJECT` | 1 — `scope.projectId=966f485c-…`; content = name/path/branch=main/pm=pnpm/top-level tree |
| structure-question task | COMPLETED, run SUCCEEDED (claude-cli, 28.3s) |

## Tests

`pnpm test` (Vitest) — **10 files, 51 tests, all passed**. New/updated:
- `project-manager.test.ts`: valid register persists Project + PROJECT memory + binds session;
  non-existent path → friendly failure, nothing persisted; empty path rejected.
- `workspace-local/index.test.ts`: invalid path → exists=false; non-git dir → branch 'unknown'
  + package-manager detection; file-tree excludes node_modules/dist/build/coverage.
- `memory-manager.test.ts`: SHORT_TERM pruning to 30/session; PROJECT memory record/read.
- `context-builder.test.ts`: current-message exclusion; project-summary inclusion.

## Typecheck

`pnpm typecheck` → **PASS (exit 0)**.

## Project Registration Test Result

Covered above (component + adapter + storage). Registration path, invalid-path, non-git, and
file-tree-exclusion all green.

## Live Smoke Test

1. `이 프로젝트 등록해줘: /Users/.../chunsik-bot-2` → `✅ 프로젝트 "chunsik-bot-2" 등록 완료!
   (path / git branch: main / 패키지 매니저: pnpm)`.
2. `이 프로젝트가 어떤 구조인지 짧게 설명해줘` → "pnpm 기반 TypeScript 모노레포 … apps/ + packages/ …
   ARCHITECTURE.md/DECISIONS.md/docs/ …" — answered **from the injected PROJECT memory summary**,
   no file access. The second answer references the registered project memory. ✅

### Bugs found & fixed during the live smoke (transparency)

1. **Workspace resolved for chat** — once a task carried `projectId`, `executeTask` called
   `workspace.prepare → resolve` (still a stub) → EXECUTION_FAILED. **Fix:** gate workspace prep to
   filesystem-touching capabilities; chat gets context from PROJECT memory, not a resolved workspace.
2. **Model tried to read files** — Claude attempted to read the real directory (outside its neutral
   cwd) and reported a permission issue instead of using the summary. **Fix:** the system prompt now
   instructs the model to answer from the provided context and not read files / use tools.

## Risks

- The summary is top-level only; deep structure needs file reading (out of scope — no deep indexing).
- The model could still attempt file access despite the instruction (mitigated by neutral cwd + prompt;
  hard tool-disable is a future option).
- `projects`/`memories` grow unbounded (PROJECT memory has no pruning); future retention concern.

## Trade-offs

- Registration is a deterministic command (not an AI Task) — simplest fit; no AiProvider handles it.
- Project context via injected memory summary, not filesystem access — keeps 1f read-only and far from a coding agent.
- Workspace prep gated by capability — chat never needs the (still-stubbed) `resolve`.

## Deferred

- Deep/gated project indexing; multiple projects per session; git-worktree workspaces.
- Tool-restricted CLI execution; PROJECT memory retention.
- Codex/Ollama + multi-provider fallback.

## Questions for Chief Architect

1. **Tool-disable:** should `claude -p` for chat run with tools hard-disabled (deterministic), beyond the prompt instruction?
2. **Re-registration / multiple projects:** re-registering the same path — update vs new project? Support multiple active projects per session?
3. **Next sprint:** deeper project read (gated) toward a coding agent, or Codex/Ollama fallback?
