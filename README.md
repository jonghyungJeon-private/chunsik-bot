# Chunsik Local v1

A **local-first, modular personal AI platform** whose first interface is Discord.
Discord is just an adapter; the AI models (Claude / Codex / Ollama CLIs) are
implementation details behind interfaces. The user talks naturally and never
picks a model — **capabilities are above models**.

> This repository is the **v1 scaffold**: clean architecture boundaries, all
> core interfaces, domain models, and a runnable wiring skeleton. Business logic
> (intent classification, planning, CLI execution, the concrete providers) is
> deliberately **not implemented yet** — see [§5](#5-what-is-not-implemented-yet).

---

## 1. Project structure

A **pnpm workspace** monorepo. The dependency rule points strictly inward:
`apps → adapters → core`, and **core depends on nothing**.

```
chunsik-bot-2/
├─ package.json                 # workspace root, scripts
├─ pnpm-workspace.yaml
├─ tsconfig.base.json           # shared strict compiler options
├─ tsconfig.build.json          # project-reference build graph
├─ .env.example
│
├─ packages/
│  ├─ core/                     # @chunsik/core — PURE TS, zero deps (the hexagon)
│  │  └─ src/
│  │     ├─ domain/             #   entities, value objects, enums
│  │     ├─ ports/              #   the 7 provider interfaces + DI tokens
│  │     ├─ application/        #   orchestrator + 11 application services
│  │     └─ util/               #   id/clock helpers
│  │
│  ├─ adapter-discord/          # @chunsik/adapter-discord  → PlatformAdapter
│  ├─ storage-sqlite/           # @chunsik/storage-sqlite   → StorageProvider
│  ├─ queue-local/              # @chunsik/queue-local      → QueueProvider
│  ├─ vector-local/             # @chunsik/vector-local     → VectorProvider
│  ├─ workspace-local/          # @chunsik/workspace-local  → WorkspaceProvider
│  ├─ ai-cli/                   # @chunsik/ai-cli           → AiProvider ×3 (Claude/Codex/Ollama)
│  └─ connectors/               # @chunsik/connectors       → ConnectorProvider (EMPTY in v1)
│
└─ apps/
   └─ chunsik/                  # @chunsik/app — NestJS composition root (wiring + bootstrap)
```

**Why this shape**

- **pnpm workspaces** enforce the boundary *mechanically*: `core` declares no
  adapter as a dependency, so pnpm never links one into its `node_modules` and
  an accidental `core → adapter` import fails to resolve. (Verified — see
  [Verification](#verification).)
- **`core` is framework-agnostic pure TypeScript.** No NestJS, no Discord, no
  SQLite. This is what lets v2 evolve (team/server mode, Postgres, worktrees,
  Telegram) without rewriting the core.
- **NestJS lives only in `apps/chunsik`.** It is the *composition root*: it binds
  each port token to a concrete implementation. Swapping an implementation is a
  one-line change there.

---

## 2. Core interfaces (ports)

Defined in `packages/core/src/ports/`. The core depends only on these — never on
a concrete class. Interfaces are bound at runtime via **injection tokens**
(`ports/tokens.ts`) because TS interfaces don't exist at runtime.

| Port | File | v1 implementation |
|------|------|-------------------|
| `PlatformAdapter` | `platform-adapter.port.ts` | `DiscordPlatformAdapter` |
| `StorageProvider` | `storage-provider.port.ts` | `SqliteStorageProvider` |
| `QueueProvider` | `queue-provider.port.ts` | `LocalQueueProvider` |
| `VectorProvider` | `vector-provider.port.ts` | `LocalVectorProvider` |
| `WorkspaceProvider` | `workspace-provider.port.ts` | `LocalCloneWorkspaceProvider` |
| `AiProvider` | `ai-provider.port.ts` | `Claude/Codex/OllamaCliProvider` |
| `ConnectorProvider` | `connector-provider.port.ts` | *(none — extension point)* |

The key one is **`AiProvider`**: it exposes `capabilities` (an
`AiCapabilityDescriptor[]` of `{capability, priority}`) and `isAvailable()`. The
core selects a provider by **capability + availability + priority** — it never
names a CLI. See [§3](#3-provider-selection--fallback).

---

## 3. Provider selection & fallback

The fallback policy is **data-driven**, encoded as priorities each provider
*advertises* (in `packages/ai-cli/`), not as `if (claude) …` branches in core.

| Capability | Ollama | Claude | Codex | Result |
|---|---|---|---|---|
| GENERAL_CHAT / SUMMARIZATION | **100** | 50 | — | Ollama, else Claude |
| CODE_IMPLEMENTATION | — | 50 | **100** | Codex, else Claude |
| ARCHITECTURE_PLANNING | — | **100** | — | Claude |
| CODE_REVIEW | — | **90** | 60 | Claude, else Codex |
| EMBEDDING | **100** | — | — | Ollama |

`AiProviderManager` filters to *available* providers that support the capability;
`CapabilityRouter` sorts them by priority and picks the top. Ollama being optional
"just works": if it's down, the next-highest (Claude) wins automatically. The
selected provider id is recorded on the `TaskRun` for audit but **never surfaced
to the user**.

---

## 4. Task flow skeleton

Encoded in `packages/core/src/application/orchestrator.ts` (`ChunsikCore`):

```
inbound Discord message
  └─ DiscordPlatformAdapter ── normalizes → InboundMessage
       └─ ChunsikCore.handleInboundMessage
            1. MemoryManager.recordShortTerm           (short-term memory)
            2. IntentClassifier.classify               → Intent  [stub]
            3. if !requiresWork → CapabilityRouter.route → AiProvider.execute → ResponseComposer → reply   (fast path)
            4. else TaskManager.createTask → PENDING → PLANNING
            5. Planner.plan → Plan(+overallRisk)        [stub]
            6. RiskPolicy.requiresApproval?
                 HIGH/CRITICAL → WAITING_APPROVAL → PlatformAdapter.requestApproval → (resume on decision)
                 LOW/MEDIUM    → executeTask:
                     WorkspaceManager.prepare (+ git-status safety)
                     MemoryManager.buildContextFiles → .chunsik/context.md, .chunsik/task.md
                     WorkspaceManager.injectContext
                     CapabilityRouter.route → AiProvider.execute(prompt + contextFiles + workspace)
                     ArtifactManager.persistAll
                     TaskManager.completeRun → COMPLETED
                     ResponseComposer.compose → PlatformAdapter.sendMessage
```

Memory reaches the stateless CLIs **only** through generated context files —
Chunsik Memory is the source of truth, never the CLI's internal memory.

**Implemented now (deterministic plumbing):** risk policy, provider selection,
task status state machine, memory context-file rendering, artifact persistence,
workspace safety guard, response composition, the orchestration sequence itself.

**Stubbed (model-driven cognition):** `IntentClassifier.classify`,
`Planner.plan`, every `AiProvider.execute/isAvailable`, all concrete
providers, and `handleApprovalDecision`. They throw `NotImplementedError`.

---

## 5. What is NOT implemented yet

By design, this is a boundaries-first scaffold:

- ❌ **No business logic** in intent classification, planning, or CLI execution.
- ❌ **No concrete provider internals** — Discord (no `discord.js`), SQLite (no
  `better-sqlite3`), local queue/vector, and workspace fs/git are all skeletons.
- ❌ **No Jira / Slack / Confluence** — `ConnectorProvider` is the only seam;
  `@chunsik/connectors` ships an empty list. Connectors will be **read-only first**.
- ❌ **No Telegram** — but `PlatformAdapter` already allows it.
- ❌ **No git worktree** — `LocalCloneWorkspaceProvider` only; `kind: 'git-worktree'`
  is reserved for a future `GitWorktreeWorkspaceProvider` on the same port.
- ❌ **No AI HTTP API** — v1 is CLI-only.
- ❌ **No Postgres / Redis** — local SQLite + in-process queue + local vectors.

Extension points left open: the 7 ports, the `Capability`/`ArtifactKind` enums,
the connector seam, and the composition root (swap a `useFactory` line).

---

## 6. Architecture warnings

1. **The boundary is enforced by dependency direction, not by a linter.** It
   holds today because `core` declares no adapter deps. Add `eslint-plugin-boundaries`
   (or `import/no-restricted-paths`) before the team grows, so a stray
   `core → adapter` import is caught in CI, not review.
2. **Don't leak provider identity into UX.** The selected CLI is audit-only.
   Resist adding "answered by Claude" to responses — it breaks the "models are
   implementation details" contract and couples UX to the provider set.
3. **Keep platform/storage types inside their adapter.** The mapping
   Discord.js↔domain and rows↔entities must stay in `adapter-discord` /
   `storage-sqlite`. The moment a `Message` or a SQL row type appears in a port
   signature, the boundary is broken.
4. **Memory context-file generation belongs to `MemoryManager`, not providers.**
   Providers only *pass through* `contextFiles`. If a provider starts composing
   memory, the source-of-truth guarantee is lost.
5. **The approval gate must wrap the *external write*, not the planning.** Local
   edits can run automatically (MEDIUM); commit/push/PR/deploy are HIGH/CRITICAL
   and require a decision. `RiskPolicy.assessCommand` already classifies
   dangerous shell patterns — wire it into `WorkspaceProvider.runCommand` before
   enabling any command execution.
6. **`exactOptionalPropertyTypes` is currently `false`.** Turning it on later
   will surface a few optional-field assignments; cheaper to tighten early.

---

## Setup

```bash
pnpm install
cp .env.example .env     # fill in DISCORD_BOT_TOKEN, CHUNSIK_WORKSPACE_ROOT, …
pnpm typecheck           # tsc -b across all packages — must be clean
pnpm build               # emit dist/ for every package
pnpm start               # boots the Nest context (providers throw until implemented)
```

Requires Node ≥ 18.18 and the `claude`, `codex`, and (optionally) `ollama` CLIs
on `PATH`, authenticated.

## Verification

```bash
# 1. Whole graph type-checks
pnpm typecheck                       # exit 0, no errors

# 2. Boundary holds — core cannot even resolve an adapter
node -e "try{require.resolve('@chunsik/adapter-discord',{paths:['packages/core']});console.log('BROKEN')}catch{console.log('ENFORCED')}"
# → ENFORCED
```
