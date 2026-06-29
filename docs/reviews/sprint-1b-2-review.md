# Sprint 1b-2 Review

## Objective

Execute the composed prompt through the **real Claude CLI** and feed the response
back into the existing pipeline: render `PromptSpec` → run `claude -p` → store the
answer as an Artifact → reply on Discord, with `TaskRun` SUCCEEDED/FAILED handling.
No AI HTTP API; CLI-only via the existing OAuth-authenticated `claude`.

## Scope

- `ClaudeCliProvider.execute` (real) + `isAvailable` (`claude --version`).
- `PromptSpec` → CLI text rendering in the provider (`renderPromptSpec`).
- `claude -p` with the prompt on **stdin**, **neutral cwd**, **timeout**,
  stdout/stderr capture; non-zero/timeout → throw → `TaskRun` FAILED.
- Success → Claude response saved as `MARKDOWN_REPORT` artifact → Discord reply.
- Minimal Vitest suite for the Chief-Architect-named targets.

## Files Changed

**Adapter (`@chunsik/ai-cli`):**
- `prompt-render.ts` *(new)* — `renderPromptSpec(PromptSpec): string` (provider-side rendering).
- `cli-runner.ts` *(new)* — injectable `CliRunner`, `defaultCliRunner` (spawn + stdin
  + cwd + timeout + capture), and `maskSecrets()` for redacting CLI output.
- `index.ts` — real `ClaudeCliProvider.execute`/`isAvailable`/`buildArgs`; Codex/Ollama
  remain stubbed; export render/runner helpers.

**App:**
- `app.module.ts` — `AI_PROVIDERS` → `[ClaudeCliProvider]` (placeholder import removed;
  the file is retained, unused, per the placeholder-location decision).
- `main.ts` — startup log string only.

**Build / tests:**
- `tsconfig.base.json` — `exclude: ["**/*.test.ts"]` (tests run via Vitest, not `tsc`).
- `package.json` — `vitest` devDependency, `test` script, allow `esbuild` build.
- `vitest.config.ts` *(new)* — minimal config; `@chunsik/core` alias → source.
- 5 test files: `risk-policy`, `prompt-composer`, `context-builder`,
  `capability-router`, `ai-cli/index` (ClaudeCliProvider command construction).

## Architecture Impact

Conforms to `ARCHITECTURE.md`. Claude/CLI specifics live entirely in `@chunsik/ai-cli`;
the core still depends only on the `AiProvider` port and selects by capability with
**no provider-id branching**. Prompt assembly stays in `PromptComposer`; the provider
only **renders** the `PromptSpec`. No core contract changed in 1b-2 (the `promptSpec`
field was added in 1b-1). Dependency direction unchanged.

## ADR Impact

No new ADR. **ADR-0014** (recorded in 1b-1) is now *implemented*: `claude -p`, stdin,
no `--bare`, neutral cwd, timeout, stdout/stderr capture, OAuth CLI auth, CLI-only.

## Runtime Flow

```
Discord message (#일반)
└─ DiscordPlatformAdapter → InboundMessage      [log: [discord] message received]
   └─ ChunsikCore.handleInboundMessage
        Actor/Session resolve · recordShortTerm
        IntentClassifier → GENERAL_CHAT          [log: intent classified]
        TaskManager.createTask(actor,session) → PLANNING   [log: task created]
        Planner → 1 step (LOW) → no approval
        executeTask:
          startRun                               [log: run started]
          ContextBuilder.build → ContextBundle
          PromptComposer.compose → PromptSpec
          CapabilityRouter.route(GENERAL_CHAT) → ClaudeCliProvider
          ClaudeCliProvider.execute:
            renderPromptSpec → text
            runner('claude', ['-p'], {cwd: tmpdir, input: text, timeoutMs})
            exit 0 → stdout → MARKDOWN_REPORT artifact
          ArtifactManager.persistAll
          completeRun → COMPLETED                 [log: task completed providerId=claude-cli]
          ResponseComposer → PlatformAdapter.sendMessage → Discord reply (Claude's answer)
```

Failure path: non-zero exit / timeout → `execute` throws → `executeTask` catch →
`failRun` (TaskRun FAILED) → Task FAILED → error logged (secrets masked).

## Persistence Result

Live-smoke SQLite (`./data/chunsik.db`) after one real Discord message:

| table | count | detail |
|---|---|---|
| actors | 1 | identity `discord:…972948` |
| sessions | 1 | `status=ACTIVE` |
| tasks | 1 | `status=COMPLETED`, `capability=GENERAL_CHAT`, actor/session set |
| task_runs | 1 | `status=SUCCEEDED`, **`providerId=claude-cli`**, `attempt=1`, `error=none` |
| artifacts | 1 | `kind=MARKDOWN_REPORT`, `title=claude-response`, linked to task+run, **real Claude text** |

Artifact content (excerpt): `"안녕하세요! 저는 춘식이예요 — … 로컬 우선 AI 어시스턴트입니다. 🦥"`
— the model adopted the PromptSpec `system` identity, confirming render→CLI worked.

## Tests

`pnpm test` (Vitest) — **5 files, 15 tests, all passed**:
- `RiskPolicy` (capability/command risk, approval gate, assessIntent).
- `PromptComposer` (layered spec, empty vs populated context, capability-varied developer).
- `ContextBuilder` (trivial bundle from recent memory, via a fake MemoryManager).
- `CapabilityRouter` (highest-priority available, skips unavailable, throws when none).
- `ClaudeCliProvider` command construction (bin=`claude`, args=`['-p']`, prompt on
  stdin, neutral cwd; non-zero → throws; timeout → throws; `isAvailable`).

## Typecheck

`pnpm typecheck` → **PASS (exit 0)**. Test files excluded from the `tsc` build.

## Live Smoke Test

Real `node dist/main.js` (token from `.env`, never printed), `chunsik-bot#5608`.
A message in `#일반` produced logs `message received → intent classified → task
created → run started → task completed providerId=claude-cli artifacts=1`, the bot
replied with **Claude's actual answer**, and SQLite matched **Persistence Result**.
A pre-flight probe (`claude -p` via stdin in `tmpdir`) returned `exit 0 / "PONG"`.
Bot stopped and temp logs cleaned afterward.

## Risks

- `claude -p` (no `--bare`, OAuth) still auto-loads the **global** `~/.claude/CLAUDE.md`
  and auto-memory; neutral cwd only prevents the **repo** CLAUDE.md from being ingested.
  Acceptable for v1 per the no-`--bare` decision; full isolation is a later question.
- Nested execution depends on the host having an authenticated `claude` CLI; absence
  → `isAvailable=false` and no provider for the capability (NoProviderAvailableError).
- `PlaceholderAiProvider` remains in the app, unused — retained per decision; mild dead-code.
- Latency/cost: each message makes a real model call (timeout-bounded at 120s).

## Trade-offs

- `CliRunner` injected for testability (assert command construction without spawning);
  default uses `node:child_process`.
- `PromptSpec` rendered to a single stdin blob in v1; richer shaping (e.g.
  `--append-system-prompt`, `--output-format json`) deferred.
- Test files excluded from `tsc` (run only under Vitest/esbuild) to keep test infra
  minimal — tests are not statically type-checked by `tsc`.

## Deferred

- Codex/Ollama `execute` (future sprint); fallback across providers.
- Streaming responses; chunked/long replies to Discord.
- Per-provider prompt shaping; richer ContextBuilder (ranking/compression).
- Global-context isolation for `claude` without `--bare`.
- `projects`/`approvals` persistence; approval UI; `handleApprovalDecision` resume.

## Questions for Chief Architect

1. **Global context leakage:** accept that `claude -p` loads `~/.claude/CLAUDE.md` +
   auto-memory (no `--bare`), or pursue isolation later (e.g. `--settings`, a sandbox
   home, or `--append-system-prompt`-only with a flag to skip discovery)?
2. **Output format:** keep default text, or move to `--output-format json` for robust
   parsing + usage/cost capture (feeds ADR-0010 Usage)?
3. **Provider absence UX:** when no AI provider is available, should the user get a
   friendly fallback message rather than a failed Task?
4. **Codex/Ollama:** wire them next (multi-provider routing/fallback), or keep
   Claude-only until a capability needs them?
