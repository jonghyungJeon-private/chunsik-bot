# Chunsik — Architecture Constitution

> This document is the **permanent architectural authority** for Chunsik.
> All implementation MUST conform to it. Changing this document requires a
> recorded decision in `DECISIONS.md` (ADR). Code that violates this document is
> a defect, regardless of whether it works.

**Status legend** — every concept below is tagged:
`[NOW]` exists in the codebase · `[RESERVE]` a cheap seam to add before business logic ·
`[LATER]` deliberately deferred (do not build yet).

---

## 1. Vision

Chunsik is a **local-first, long-lived personal AI platform** whose first
interface happens to be Discord. It is not a Discord bot. The user converses
naturally; the system decides *what capability* is needed and *which AI engine*
serves it. Models are interchangeable implementation details. The same Core must
power a future **Team Edition** without being rewritten.

We optimize for **longevity and replaceability over short-term convenience.**

---

## 2. Core Principles

1. **Capabilities are above models.** The user asks for an outcome; the system
   maps it to a `Capability`; a router picks an available provider. Users never
   choose Claude/Codex/Ollama, and never normally see which answered.
2. **The Core knows nothing concrete.** No Discord, SQLite, Claude, Codex,
   Ollama, HTTP, or NestJS type may appear in `@chunsik/core`. Core depends only
   on its own ports and domain.
3. **Every infrastructure component is replaceable** behind a port.
4. **Dependencies point inward:** `apps → adapters → core`. Core depends on
   nothing in the workspace.
5. **Chunsik Memory is the source of truth** — never a model's internal memory.
6. **Governance is explicit.** External-impact and destructive actions pass a
   risk-based approval gate. Nothing dangerous runs implicitly.
7. **Personal → Team without Core changes.** Identity, storage, queue, and
   transport are abstracted so the edition is a wiring choice, not a rewrite.
8. **Reserve seams early, build features late.** Concepts that are expensive to
   retrofit are introduced as thin seams before business logic; their behavior
   is implemented later.

---

## 3. Layer Responsibilities

```
Platform (Discord, …)  ─▶  Composition Root (NestJS app)  ─▶  Core
                                                              ├─ Domain (entities, value objects, enums, events)
                                                              ├─ Ports (interfaces + DI tokens)
                                                              └─ Application services (orchestration)
Adapters (one package per concrete provider) implement Ports.
```

- **Domain** — pure data + invariants. No I/O, no framework. `[NOW]`
- **Ports** — the only contracts the outside world implements. `[NOW]`
- **Application services** — orchestration & policy. Deterministic plumbing is
  implemented; model-driven cognition is explicit and isolated. `[NOW]`
- **Composition Root (`apps/chunsik`)** — the ONLY place that imports concrete
  classes and binds them to port tokens. Swapping an implementation is a
  one-line change here. `[NOW]`
- **Adapters** — translate between the outside world and the domain. All
  platform/storage/CLI specifics live here and never leak inward. `[NOW]`

---

## 4. Domain Concept Map

Authoritative list of domain concepts and their status. The relationships are
fixed; the implementations are not.

| Concept | Role | Status |
|---|---|---|
| `Actor` / `Principal` | Platform-independent identity authz hangs off | `[NOW]` |
| `Session` | Conversation aggregate root (thin: identity, lifecycle, pointers) | `[NOW]` |
| `Task` | A unit of work within a session | `[NOW]` |
| `TaskRun` | One execution attempt of a Task (+ `Usage`/cost) | `[NOW]` (Usage `[RESERVE]`) |
| `Intent` | Classified meaning of a message → a `Capability` | `[NOW]` |
| `Plan` / `PlanStep` | **Intra-task** decomposition | `[NOW]` |
| `Workflow` | **Inter-task** orchestration (≠ Plan) | `[LATER]` (field not reserved — YAGNI per ADR-0013; JSON storage makes late-add free) |
| `Capability` | The routing key from need → provider | `[NOW]` |
| `AgentProfile` | Config bundling capability + prompt template + risk + allowed resources | `[RESERVE]` |
| `MemoryRecord` (6 types) | Source-of-truth memory | `[NOW]` |
| `ContextBundle` | Assembled, budgeted context for one run | `[NOW]` |
| `PromptSpec` | Layered, provider-agnostic prompt | `[NOW]` |
| `ResourceRef` | Uniform **input** reference (PDF, URL, ticket, repo file) | `[RESERVE]` |
| `Artifact` (8 kinds) | First-class **output** | `[NOW]` |
| Domain `Event`s | `TaskCreated`, `TaskStatusChanged`, `RunCompleted`, `Approval*` | `[RESERVE]` |
| `WorkspaceRef` | Resolved working directory | `[NOW]` |
| `Approval*` | Governance records | `[NOW]` |

**Hard rule:** `Resource` is an **input** the system reads; `Artifact` is an
**output** the system produces. They never merge.

---

## 5. Provider Rules

1. Core depends only on the `AiProvider` interface. It MUST NOT import a concrete
   provider, branch on a provider `id`, or assume a specific CLI exists.
2. **Selection is data-driven.** Providers advertise
   `capabilities: {capability, priority}[]` and `isAvailable()`. The router picks
   the highest-priority *available* provider for a capability. The fallback
   policy lives in that data, never in `if` statements in Core.
3. The selected provider `id` is **audit-only** (on `TaskRun`). It MUST NOT be
   surfaced to the user by default.
4. **Provider-specific prompt shaping happens in the adapter.** Core emits a
   provider-agnostic `PromptSpec`; the adapter renders it to CLI args + context
   files (`CLAUDE.md`, `AGENTS.md`, …).
5. v1 is **CLI-only**; no AI HTTP API. New engines are new adapters, not Core
   changes.
6. Transports (queue, event bus, vector store, storage) follow the same rule:
   abstraction in Core, transport in a provider (in-process now, distributed in
   Team Edition).

---

## 6. Memory Principles

1. **Chunsik Memory is authoritative.** Never rely on a model's internal memory.
2. Memory reaches stateless CLIs **only** through generated context files.
3. Memory types are fixed: `SHORT_TERM`, `WORKING`, `LONG_TERM`, `PROJECT`,
   `TOOL`, `CONNECTOR`. Scope includes `sessionId` once Session lands.
4. **Separation of duties** (do not conflate):
   - `MemoryManager` = system of record (CRUD, scope). `[NOW]`
   - `ContextBuilder` = retrieve → (rank/compress/budget `[LATER]`) → `ContextBundle`. `[NOW]`
   - `PromptComposer` = layer (system + developer + context + task) → `PromptSpec`. `[NOW]`
   - Context-file **materialization** belongs to the workspace layer, not the
     memory or context layer.
5. Embedding **generation** is an `AiProvider` capability (e.g. Ollama), not a
   property of the vector store. The `VectorProvider` only stores/queries.

---

## 7. Capability Principles

1. A `Capability` is the stable contract between *intent* and *engine*. Adding a
   model never adds a capability; adding a skill might.
2. Risk is a function of capability + concrete operation (see Workspace Rules).
3. Routing order: **Intent → Capability → (AgentProfile) → Provider.** Capability
   is the routing key; `AgentProfile` (when introduced) sits above capability as
   the "who/how," provider below as the "which engine."

---

## 8. Agent Principles

1. v1 has **no agent runtime.** Execution is single-shot: PromptComposer →
   Provider → Artifact.
2. The agent seam is **configuration, not a service**: an `AgentProfile` bundles
   `{role, capability, promptTemplateRef, riskProfile, allowedResources}`.
3. Autonomous loops (plan-act-observe, tool use, sub-agents) are `[LATER]` and
   MUST sit behind the `AgentProfile` seam without changing Capability/Provider
   contracts.

---

## 9. Workspace Rules

1. v1 uses `LocalCloneWorkspaceProvider` on an existing local clone.
2. **Check git status before modifying code.** A dirty tree blocks automated
   edits unless explicitly overridden by approval.
3. **Never auto-commit, auto-push, auto-delete, or force-push.** These are
   HIGH/CRITICAL and run only after an approval decision.
4. `GitWorktreeWorkspaceProvider` will implement the **same port** later; Core is
   unaffected. `[LATER]`
5. All command execution is risk-assessed (`RiskPolicy.assessCommand`) before it
   runs.

---

## 10. Risk & Approval

| Level | Examples | Default |
|---|---|---|
| LOW | chat, summary, explanation, read-only lookup | auto |
| MEDIUM | local code modification, local test/file generation | auto (local only) |
| HIGH | git commit/push/PR, connector writes (Jira/Slack/Confluence) | **approval** |
| CRITICAL | deploy, DB migration, destructive shell, force push, secret access | **approval** |

The approval gate wraps the **external write / destructive action**, not the
planning. Approval requests and decisions are persisted as governance records.

---

## 11. Coding Rules

1. TypeScript `strict` (+ `noUncheckedIndexedAccess`, `noImplicitOverride`).
2. **Core is pure**: no NestJS decorators, no Node-framework deps; injection is
   explicit (constructor + DI tokens in the composition root).
3. **One concrete provider concern per adapter package.** Adapter packages depend
   only on `@chunsik/core`.
4. Cross-boundary types are domain types only — no Discord.js/SQL/CLI types in
   port signatures.
5. Deterministic plumbing may be implemented; model-driven cognition is isolated
   and explicitly stubbed until built (`NotImplementedError`), never faked.
6. Time and ids come from the shared `clock`/`id` utilities (swappable for tests).
7. Every architectural decision is recorded in `DECISIONS.md` before the code
   that depends on it merges.

---

## 12. Forbidden Rules (hard "never")

- ❌ Importing a concrete provider, Discord, SQLite, or a CLI from `@chunsik/core`.
- ❌ Branching on a provider `id` anywhere in Core.
- ❌ Letting any platform/storage/driver type cross a port boundary.
- ❌ Pinning an AI provider to a Session/Task/Actor.
- ❌ Surfacing the selected provider to the user as a normal behavior.
- ❌ Storing context/memory **snapshots** on Session (rebuild per run).
- ❌ Merging `Resource` (input) and `Artifact` (output).
- ❌ Auto-commit / auto-push / auto-delete / force-push / external write without
  an approval decision.
- ❌ Relying on a model's internal memory as a substitute for Chunsik Memory.
- ❌ Adding a god-interface (`Plugin`, mega-`Session`) instead of narrow ports.
- ❌ Turning the main execution flow into implicit event choreography.

---

## 13. Future Expansion Strategy

| Axis | v1 (Personal, local) | Evolution | Mechanism |
|---|---|---|---|
| Identity | one local Actor ↔ Discord user | multi-actor teams | `Actor` seam `[RESERVE]` |
| Storage | SQLite | Postgres | `StorageProvider` swap |
| Queue / Events | in-process | Redis / Kafka | `QueueProvider` / `EventBus` port |
| Platform | Discord | + Telegram, web | `PlatformAdapter` |
| Workspace | local clone | git worktrees, sandboxes | `WorkspaceProvider` |
| Connectors | none | Jira/Slack/Confluence (read-first) | `ResourceResolver` + `ActionProvider`, gated |
| Extensibility | manual registration | plugin bundles + manifest | bundle of existing ports `[LATER]` |
| Orchestration | single task | workflows | `workflowId` reserve → engine `[LATER]` |
| Execution | single-shot | agentic loops | `AgentProfile` seam → runtime `[LATER]` |

**Rule of evolution:** an evolution step is valid only if it changes adapters,
wiring, or `[RESERVE]`/`[LATER]` seams — **never the Core contracts above.** If a
desired feature forces a Core-contract change, that is an architectural event and
requires a `DECISIONS.md` entry amending this constitution first.
```
