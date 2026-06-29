# Sprint 1g Review

## Objective

"등록된 프로젝트의 구조를 사용자가 물으면, 봇이 실제 프로젝트 메타데이터 파일을 읽어 근거 있는
구조 설명을 돌려준다." — turn a structure question ("이 프로젝트가 어떤 구조인지 설명해줘") into a
**gated, read-only project analysis** that feeds real (allow-listed) file contents to the AI,
instead of the shallow top-level summary from Sprint 1f.

This sprint resolves the bug found during 1f live verification (the structure question failed),
upgrading the answer from a thin summary to a grounded analysis — **strictly within the
"Project Analysis" boundary, NOT "Deep Project Indexing"** (see ADR-0019 scope boundary).

## Scope

- New `PROJECT_ANALYSIS` intent + capability (deterministic v1 heuristic).
- `ProjectAnalyzer` (core service): guards an active, resolvable project, then performs a
  read-only, size-limited readout — AI summarization runs in the normal task pipeline.
- `WorkspaceProvider.readProjectFiles`: allow-listed metadata files only, 8 KB/file cap, secret
  files always skipped, 2-level tree (root + apps/ + packages/), excludes node_modules/dist/etc.
- `PromptComposer` renders the readout as a read-only section; the analysis result is persisted as
  a `TOOL` memory (`kind: 'analysis'`) for reuse.

## Files Changed

**Core:**
- `domain/enums.ts`: `Capability.PROJECT_ANALYSIS`, `IntentType.PROJECT_ANALYSIS`.
- `ports/workspace-provider.port.ts`: `ProjectFileEntry`, `ProjectReadout`, `readProjectFiles`.
- `application/project-analyzer.ts` *(new)*: `prepare(session)` → guard + readout (`AnalysisPreparation`).
- `application/intent-classifier.ts`: order-independent verb×noun heuristic → PROJECT_ANALYSIS.
- `application/orchestrator.ts`: PROJECT_ANALYSIS branch (guard → readout → task) + pass readout to
  `executeTask`/`promptComposer`; persist analysis as TOOL memory.
- `application/prompt-composer.ts`: `compose(task, bundle, readout?)` renders readout; analysis system prompt.
- `application/memory-manager.ts`: `recordToolMemory(content, scope)`.
- `application/workspace-manager.ts`: `readProjectFiles` passthrough.
- `application/project-manager.ts`: idempotent re-registration (one Project per normalized rootPath).
- `application/risk-policy.ts`: PROJECT_ANALYSIS = LOW. `application/index.ts`: export ProjectAnalyzer.

**Adapters:** `workspace-local` (`readProjectFiles`: allow-list read, secret skip, 8 KB cap, 2-level tree).
**App:** `ai-cli` (Claude advertises PROJECT_ANALYSIS, priority 90); `app.module.ts` (ProjectAnalyzer
wiring — provider + ChunsikCore injection); `main.ts` (startup log).
**Tests:** `project-analyzer.test.ts` *(new)*, `intent-classifier.test.ts` *(new)*,
`workspace-local/index.test.ts` (readProjectFiles cases added).
**Docs:** ADR-0019, CHANGELOG, CURRENT_STATE, this review.

## Architecture Impact

Conforms to `ARCHITECTURE.md`. All filesystem access (the readout) lives in the `workspace-local`
adapter behind `WorkspaceProvider`; core depends only on the port. Analysis is modeled as a normal
Task routed by Capability (no concrete CLI named in core). The deterministic guard/gather is
separated from the AI summarization (the service does no AI work).

## ADR Impact

**Added ADR-0019 (Gated Project Analysis), Accepted.** Explicit non-goals recorded: NOT repository
indexing, NOT vector search, NOT semantic code search; repository-wide indexing remains deferred.
This ADR does not widen ADR-0018's V2.

## Runtime Flow

```
"이 프로젝트가 어떤 구조인지 설명해줘"
  → IntentClassifier → PROJECT_ANALYSIS (requiresWork)
  → ProjectAnalyzer.prepare(session)
       no active project → friendly "register first", nothing run
       active + resolvable → readProjectFiles(rootPath) [read-only, allow-list, 8 KB cap, no secrets]
  → createTask(projectId) → PLANNING → (LOW risk, no approval)
  → executeTask: ContextBuilder + PromptComposer.compose(task, bundle, readout)
       system = "summarize only from the shown files/tree; do not invent files"
  → CapabilityRouter → ClaudeCliProvider → grounded structural answer
  → persist TOOL memory (kind=analysis, scope.projectId) → reply
```

## Live Smoke Test (real `node dist/main.js`, Discord)

1. `이 프로젝트 등록해줘: /Users/.../chunsik-bot-2` → `✅ … 재등록(업데이트) 완료` (idempotent).
2. `이 프로젝트가 어떤 구조인지 짧게 설명해줘` → grounded answer naming the **7 ports**, the exact
   package→port mapping, the tech stack (TS 5.4 / Node ≥18.18 / pnpm 10), the conventions, and the
   honest v1-scaffold caveat — read from real `ARCHITECTURE.md`/`DECISIONS.md`/`package.json`. ✅

**Log evidence:**
```
intent classified capability=PROJECT_ANALYSIS requiresWork=true
task created … sessionId=…
run started … capability=PROJECT_ANALYSIS
task completed … providerId=claude-cli artifacts=1
```
**DB evidence:** `memories` → `TOOL | project_id=966f485c… | kind=analysis | 2158 bytes`;
counts `PROJECT=2 SHORT_TERM=10 TOOL=1`. Secrets never read (allow-list only).

## Tests

`pnpm test` (Vitest) — **12 files, 62 tests, all passed** (51 → 62; +11):
- `project-analyzer.test.ts`: no active project → not ready (asks to register); active project
  missing → not ready; resolvable → ready + readout.
- `intent-classifier.test.ts`: structure/analysis questions → PROJECT_ANALYSIS (KO + EN, both
  orders); registration command → REGISTER_PROJECT (not analysis); ordinary question → CHAT.
- `workspace-local/index.test.ts`: allow-list only (source code excluded); secret/.env files never
  read; 8 KB cap + truncation flag; 2-level tree excludes node_modules; non-existent path → empty.

## Typecheck

`pnpm typecheck` → **PASS (exit 0)**.

## Risks

- The allow-list is intentionally narrow; a project documenting itself elsewhere (e.g. `docs/`) is
  summarized from the listed files + tree only. Widening is a deliberate, reviewable change.
- The v1 classifier heuristic can over-match (a general question mentioning a noun+verb may route to
  analysis); the active-project guard bounds the harm (no project → "register first"). AI-driven
  classification is deferred.
- 8 KB/file truncation can clip large manifests (flagged `truncated`).
- `memories` (incl. TOOL) grow unbounded — retention is a future concern (carried from 1f).

## Trade-offs

- Deterministic guard/gather + AI summarize — keeps file I/O in the adapter and the decision in core.
- Allow-list (not crawl) + secret skip — the smallest read that answers a structure question, far
  from indexing/embeddings.
- Analysis persisted as TOOL memory for reuse, without building any retrieval layer.

## Deferred (NOT in this sprint — each needs its own ADR)

- Repository-wide indexing, vector search, semantic code search.
- Configurable/auto-discovered read sets, deeper tree, tool-restricted live file reads under approval.
- Codex/Ollama providers + multi-provider fallback; PROJECT/TOOL memory retention.

## Questions for Chief Architect

1. **Classifier precision:** keep the broad v1 heuristic (guard-bounded), or move classification to a
   small AI step sooner to cut false positives?
2. **Readout allow-list:** is the current set (package.json/pnpm-workspace/README/ARCHITECTURE/
   DECISIONS/tsconfig*) the right v1 boundary, or should `docs/` index files be added?
3. **Next sprint:** Codex/Ollama fallback, or memory retention/pruning for PROJECT+TOOL?
