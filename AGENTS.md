# AGENTS.md — Operating Manual for AI Coding Agents

> **Read `ARCHITECTURE.md` and `DECISIONS.md` before editing.**
> They are the constitution (rules) and case law (why). This file is *how to
> work*; it does not restate them in full. If anything here seems to conflict
> with `ARCHITECTURE.md`, `ARCHITECTURE.md` wins — and you must stop (see
> "Handling uncertainty").

This manual is canonical for **every** AI agent (Claude, Codex, others). It is
practical and enforceable: a change that violates it is a defect even if it
compiles and passes tests.

---

## 0. Before you touch anything

1. Read `ARCHITECTURE.md` (rules) and `DECISIONS.md` (settled decisions).
2. Confirm your change is consistent with both. If it requires deviating from a
   settled decision, you must add a **new superseding ADR** first (see §8) — do
   not silently contradict one.
3. Identify which package you are editing and what it is **allowed to import**
   (§2). Most accidental damage is an import that crosses a boundary.

---

## 1. What this project is

Chunsik is a **local-first, long-lived AI platform**; Discord is just the first
interface. Models are interchangeable implementation details; capabilities are
above models. The Core must work unchanged from Personal Edition to Team Edition.
Optimize for **longevity and replaceability**, not short-term convenience.

---

## 2. Architecture boundary & dependency rules

Dependencies point **inward only**: `apps → adapters → core`. Core depends on
nothing in the workspace.

| You are editing… | You MAY import… | You MUST NOT import… |
|---|---|---|
| `packages/core` | other `core` modules, Node builtins, the `clock`/`id` utils | NestJS, Discord, SQLite, any CLI, any adapter package |
| an adapter (`packages/adapter-*`, `storage-*`, `queue-*`, `vector-*`, `workspace-*`, `ai-cli`, `connectors`) | `@chunsik/core`, that adapter's own library | any *other* adapter; Core internals not exported from `@chunsik/core` |
| `apps/chunsik` (composition root) | everything — this is the ONLY place that wires concrete classes to port tokens | — |

Enforcement is mechanical: pnpm does not link undeclared deps, so a `core →
adapter` import fails to resolve. **Do not "fix" that by adding the dependency.**
If you reach for a cross-boundary import, your design is wrong — reconsider.

Rules:
- New concrete provider → **new adapter package** implementing an existing port;
  wire it in `apps/chunsik/src/app.module.ts`. Do not add it to Core.
- New port → define the interface + a DI token in `packages/core/src/ports`.
- Never let a platform/storage/driver type (e.g. a Discord.js `Message`, a SQL
  row, a CLI buffer) appear in a port signature or any Core type.

---

## 3. Provider rules

- Core depends only on the `AiProvider` interface. **Never** import a concrete
  provider into Core, **never** branch on a provider `id`, **never** assume a
  specific CLI exists.
- Provider selection is **data-driven**: providers advertise
  `capabilities: {capability, priority}[]` + `isAvailable()`. Routing picks the
  highest-priority available provider. Encode new fallback behavior as that data,
  not as `if` statements in Core.
- The selected provider is **audit-only** (`TaskRun.providerId`). Do not surface
  "answered by Claude/Codex/Ollama" to the user as normal behavior.
- Provider-specific prompt shaping lives in the **adapter**, which renders a
  Core-produced `PromptSpec` into CLI args + context files. (See ADR-0003.)
- v1 is **CLI-only** — do not add an AI HTTP API path.

---

## 4. Prompt & context rules

- Memory reaches stateless CLIs **only** through generated context files. Chunsik
  Memory is the source of truth; never rely on a model's internal memory.
- Keep the responsibilities separate (ADR-0002, ADR-0003):
  - `MemoryManager` = memory CRUD/scope.
  - `ContextBuilder` = retrieve → rank → compress → budget → `ContextBundle`.
  - `PromptComposer` = layer `system + developer + context + task` → `PromptSpec`.
  - Context-file **materialization** is a workspace concern, not a memory/context
    concern.
- Do not store context or memory **snapshots** on `Session` — rebuild per run.
- Prompt templates (when introduced) are **runtime assets** under `prompts/`,
  not documentation, and are consumed by `PromptComposer`.

---

## 5. Workspace & governance rules

- Check git status **before** modifying code; a dirty tree blocks automated edits
  unless approved.
- **Never** auto-commit, auto-push, auto-delete, or force-push. Commit / push /
  PR / deploy / connector-write / destructive shell are HIGH/CRITICAL and run
  ONLY after an approval decision. Route command execution through
  `RiskPolicy.assessCommand` first.
- The approval gate wraps the **external/destructive action**, not the planning.

---

## 6. Testing & typecheck expectations

- **Always run `pnpm typecheck` before declaring work done.** It must exit 0 with
  no errors. (It builds via project references; a clean tree is the bar.)
- TypeScript `strict` is non-negotiable (incl. `noUncheckedIndexedAccess`,
  `noImplicitOverride`). Do not weaken `tsconfig` to make an error disappear.
- Deterministic plumbing may be implemented and should be unit-tested. Model-driven
  cognition that isn't built yet stays an explicit `NotImplementedError` — **never
  fake it** with hardcoded output.
- Use the shared `clock`/`id` utilities (not `Date`/`crypto` directly) so tests
  stay deterministic.
- Match the surrounding code's style, naming, and comment density.

---

## 7. Forbidden changes (hard "never")

- ❌ Import a concrete provider / Discord / SQLite / a CLI from `@chunsik/core`.
- ❌ Branch on a provider `id` in Core.
- ❌ Leak a platform/storage/driver type across a port boundary.
- ❌ Pin an AI provider to a Session/Task/Actor.
- ❌ Surface the selected provider to the user as default behavior.
- ❌ Store context/memory snapshots on Session.
- ❌ Merge `Resource` (input) with `Artifact` (output).
- ❌ Auto-commit/push/delete/force-push or any external write without approval.
- ❌ Add a god-interface (`Plugin`, mega-`Session`) instead of narrow ports.
- ❌ Weaken `tsconfig`/lint to bypass an error.
- ❌ Build a deferred concept early (Workflow engine, agent runtime, dynamic
  plugin loader) — see DECISIONS for what's deferred and what's only a reserved seam.

---

## 8. Handling uncertainty

- **If a requirement conflicts with `ARCHITECTURE.md` or a settled ADR:** stop and
  surface the conflict. Do not "work around" the architecture. The fix is either a
  different design or a new superseding ADR — proposed, not assumed.
- **If the right boundary is unclear:** prefer the choice that keeps Core smaller
  and adapters dumber. When still unsure, ask rather than guess.
- **If you must introduce a `[RESERVE]` seam to do your task:** keep it minimal
  (the interface/field), implement only what your task needs, and record the
  decision in `DECISIONS.md`.
- **Never** expand scope silently. Make the smallest change that satisfies the
  task within these rules, and call out anything you intentionally left undone.
