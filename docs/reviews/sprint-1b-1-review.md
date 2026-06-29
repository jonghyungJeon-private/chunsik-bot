# Sprint 1b-1 Review

## Objective

Route a Discord message through the **real `ChunsikCore` pipeline** (replacing the
Sprint 1a echo handler) and persist the full work record — **without any AI call**.
AI execution is deferred to Sprint 1b-2; here a deterministic placeholder provider
stands in so the pipeline and persistence can be validated end to end.

## Scope

- Discord handler → `ChunsikCore.handleInboundMessage`.
- Minimal deterministic `IntentClassifier` (→ `GENERAL_CHAT`, `requiresWork`) and
  `Planner` (single step, risk via `RiskPolicy`).
- Actor/Session-anchored `Task` creation; `Task` / `TaskRun` / `Artifact` SQLite
  persistence (plus `memories` to back `recordShortTerm`).
- Trivial `ContextBuilder` + minimal `PromptComposer` producing a `PromptSpec`.
- `CapabilityRouter` plumbing connected; provider chosen by capability.
- `PlaceholderAiProvider` (deterministic, no AI). **No** Claude/Codex/Ollama,
  Workflow, agent runtime, plugins, connectors, or AI HTTP API.

## Files Changed

**Core (domain/ports/application — depends only on ports/domain):**
- `domain/prompting.ts` *(new)* — `PromptSpec`, `ContextBundle` contracts (ADR-0014).
- `domain/index.ts` — export `prompting`.
- `ports/ai-provider.port.ts` — `AiExecutionRequest.promptSpec?` added; `prompt?` now optional.
- `application/intent-classifier.ts` — minimal deterministic classify.
- `application/planner.ts` — minimal single-step plan via `RiskPolicy`.
- `application/context-builder.ts` *(new)* — trivial context assembly (recent short-term).
- `application/prompt-composer.ts` *(new)* — minimal layered `PromptSpec`.
- `application/memory-manager.ts` — `recentShortTerm(scope, limit)`.
- `application/task-manager.ts` — `createTask` accepts `{ actorId, sessionId, projectId }`.
- `application/orchestrator.ts` — `ChunsikCore` resolves Actor/Session, runs
  ContextBuilder→PromptComposer→router→provider→Artifact; logs via the `Logger` port.
- `application/index.ts` — export new services.

**Adapters:**
- `storage-sqlite/src/index.ts` — implement `tasks`, `taskRuns`, `artifacts`,
  `memories` SQLite repositories + tables (`projects`/`approvals` stay stubbed).

**App (composition root):**
- `placeholder-ai-provider.ts` *(new)* — deterministic 1b-1 test double.
- `app.module.ts` — register `ContextBuilder`/`PromptComposer`; `AI_PROVIDERS` →
  `[PlaceholderAiProvider]`; extend `ChunsikCore` factory (actors/sessions/context/
  prompt/logger).
- `main.ts` — inbound → `core.handleInboundMessage`; wire `onApprovalDecision`.

**Docs:** `DECISIONS.md` (ADR-0014), `CHANGELOG.md`, `CURRENT_STATE.md`, this review.

## Architecture Impact

Conforms to `ARCHITECTURE.md`. Core imports nothing concrete (no Discord/SQLite/
Claude); provider selected by capability with **no provider-id branching**; prompt
assembly lives in `PromptComposer`, rendering is the provider's job. Dependency
direction (`apps → adapters → core`) unchanged. Reserved seams from ADR-0002/0003
(ContextBuilder/PromptComposer) are now realized at a minimal level.

## ADR Impact

- **Added ADR-0014** — concrete `PromptSpec`/`ContextBundle` contracts, additive
  `AiExecutionRequest.promptSpec`, and the Claude CLI invocation contract
  (`claude -p`, stdin, no `--bare`, neutral cwd, timeout, stdout capture; CLI-only).
- No existing ADR amended; ADR-0001/0002/0003/0009/0013 honored.

## Runtime Flow

```
Discord message (#일반)
└─ DiscordPlatformAdapter.messageCreate → InboundMessage  [log: [discord] message received]
   └─ ChunsikCore.handleInboundMessage
        ActorManager.resolveFromContext      → Actor (find or create)
        SessionManager.openForContext/touch  → Session (reuse or create)
        MemoryManager.recordShortTerm
        IntentClassifier.classify            → GENERAL_CHAT, requiresWork  [log: intent classified]
        TaskManager.createTask(actorId,sessionId) → PENDING → PLANNING     [log: task created]
        Planner.plan                         → 1 step, risk LOW
        RiskPolicy.requiresApproval(LOW)=false
        executeTask:
          TaskManager.startRun               → RUNNING                     [log: run started]
          ContextBuilder.build               → ContextBundle
          PromptComposer.compose             → PromptSpec
          CapabilityRouter.route(GENERAL_CHAT) → PlaceholderAiProvider
          provider.execute({promptSpec})     → text + Artifact (renders PromptSpec)
          ArtifactManager.persistAll
          TaskManager.completeRun → COMPLETED                              [log: task completed]
          ResponseComposer.compose → PlatformAdapter.sendMessage → Discord reply
```

## Persistence Result

Live-smoke SQLite (`./data/chunsik.db`) after one real Discord message:

| table | count | detail |
|---|---|---|
| actors | 1 | `displayName`=Discord userId (1b TODO: enrich), identity `discord:…972948` |
| sessions | 1 | `status=ACTIVE`, bound to the channel + actor |
| tasks | 1 | `status=COMPLETED`, `capability=GENERAL_CHAT`, `risk=LOW`, `actorId`/`sessionId` set |
| task_runs | 1 | `status=SUCCEEDED`, `providerId=placeholder`, `attempt=1`, `artifactIds=1` |
| artifacts | 1 | `kind=MARKDOWN_REPORT`, `title=placeholder-response`, linked to task + run |

## Tests

- **Component test** (Nest context + `PlaceholderAiProvider` + real SQLite, Discord
  adapter inert): two inbound messages → **actors=1, sessions=1 (reused)**,
  **tasks=2 (both COMPLETED)**, each with **1 TaskRun (SUCCEEDED:placeholder)** and
  **1 Artifact (MARKDOWN_REPORT)**; `actorId`/`sessionId` set on every task. Temp
  harness + temp DB removed after the run.
- (No permanent test runner yet — see Deferred.)

## Typecheck

`pnpm typecheck` → **PASS (exit 0)**, no errors.

## Live Smoke Test

Real `node dist/main.js` (token from `.env`, never printed) connected as
`chunsik-bot#5608`. A message in `#일반` produced:
- adapter log `[discord] message received messageId=1520969446091657216`;
- core logs `intent classified` → `task created` → `run started` → `task completed
  providerId=placeholder artifacts=1`;
- Discord reply: `🐹 (Sprint 1b-1 placeholder) 메시지를 처리했어요. 실제 AI 응답은 1b-2에서 연결됩니다.`;
- SQLite rows exactly as in **Persistence Result**.

Bot process stopped and temp logs cleaned after verification.

## Risks

- `PlaceholderAiProvider` lives in the app layer and is wired as the only provider;
  1b-2 must remember to swap `AI_PROVIDERS` back to the CLI providers (still imported).
- Every message becomes a Task (`requiresWork=true` always) — heavier than a chat
  fast-path; acceptable for 1b but revisit.
- `memories.findByScope` filters by channel (not strict thread `IS NULL`) when no
  thread is present — fine for v1, may over-include thread memories.
- `claude -p` nested execution + OAuth auth is only provable in 1b-2 live smoke.

## Trade-offs

- `prompt?` and `promptSpec?` both optional (a caller must supply one) — chosen for
  additive, backward-compatible port evolution over a stricter union type.
- `ChunsikCore` depends on the `Logger` **port** (not console) for milestone logs —
  keeps core pure while giving observability.
- Provider renders `PromptSpec` to a plain string in 1b; per-provider shaping (e.g.
  `--append-system-prompt`) deferred.

## Deferred

- Real Claude CLI execution (Sprint 1b-2, per ADR-0014).
- A permanent test runner (e.g. Vitest) + committed unit/component tests.
- `ContextBuilder` ranking/compression/token budgeting; richer `PromptSpec` layers.
- Chat fast-path (skip Task for trivial chat); `projects`/`approvals` persistence;
  approval UI; `handleApprovalDecision` resume.

## Questions for Chief Architect

1. Should a trivial **chat fast-path** (no Task) exist, or is "every message is a
   Task" acceptable for auditability in v1?
2. For 1b-2, prefer passing the **full `PromptSpec` to the CLI** (e.g. system via
   `--append-system-prompt`, task via stdin) vs. a single concatenated stdin prompt?
3. When should we introduce a **permanent test runner** — fold into 1b-2, or a
   dedicated infra ADR/sprint?
4. Confirm the **placeholder-in-app** approach is acceptable as a temporary test
   double, vs. a dedicated `@chunsik/ai-fake` package.
