# Chunsik — Architecture Decision Records

Append-only log of architectural decisions. **Never edit or delete a past
entry**; supersede it with a new entry that references the old one. This file is
the "case law" companion to `ARCHITECTURE.md` (the "constitution"). AI agents and
humans MUST read both before writing code, and must not re-litigate a settled
decision without adding a new superseding ADR.

### Status vocabulary

| Status | Meaning | Build now? |
|---|---|---|
| ✅ **Accepted (v1)** | Adopted; implement when business logic begins | Yes, in v1 |
| 🟡 **Reserved seam (v1)** | Define the thin interface/field now; implement behavior later | Seam yes, behavior no |
| ⛔ **Deferred (v2+)** | Sound concept, intentionally postponed | No |
| ❌ **Rejected** | Not adopting in current form; alternative recorded | No |

> These ADRs record **direction**. They do not by themselves change code. The
> current scaffold remains as built; concepts marked Accepted/Reserved are
> introduced when their slice of work starts, per the decision here.

Seeded 2026-06-28 from the v3 Architecture Review.

---

## ADR-0001 — Conversation Session as a thin aggregate

- **Status:** ✅ Accepted (v1) — introduce early, minimal
- **Date:** 2026-06-28

### Context
Today `ConversationContext` is a value object (channel/thread/user ids) and
`Task` references it; there is no entity that owns a conversation's lifecycle or
groups its tasks. A Session is hard to retrofit because every Task, memory scope,
and context-file path is anchored to a conversation. The review proposal also
loaded Session with "active AI provider", context/memory snapshots, current plan,
artifacts, and task history — making it a god object.

### Decision
Introduce **Session** as the thin conversation aggregate root: `id`,
`conversationContext`, `actorId` (see ADR-0009), optional `projectId`, `status`
(ACTIVE/IDLE/CLOSED), `lastActivityAt`, optional `activeTaskId`. Add `sessionId`
to `MemoryScope`. **Reject** storing on Session: the active provider (violates
capabilities-above-models), and context/memory snapshots (staleness risk —
context is rebuilt per run). Plan/artifacts/history belong to Tasks; Session only
references them.

### Consequences
- + Clean anchor for memory scope and Team-Edition actor binding.
- + Cheap to add now, painful later.
- − One more entity to persist; orchestrator must resolve/open a Session per inbound message.

### V1 / V2
**V1:** thin entity + `sessionId` in `MemoryScope`. **V2:** richer lifecycle (idle/resume policies, team presence).

---

## ADR-0002 — ContextBuilder as a distinct seam

- **Status:** 🟡 Reserved seam (v1)
- **Date:** 2026-06-28

### Context
`MemoryManager.buildContextFiles` currently dumps every memory of each type into
markdown. That conflates the *system of record* (memory CRUD) with *assembling
context for one run* (retrieve → rank → compress → budget). As memory grows and
token budgets bite, those evolve independently; separating them later couples
many callers to MemoryManager's raw output.

### Decision
Define a **ContextBuilder** application service that returns a structured
**ContextBundle**. v1 implementation is trivial (delegate to MemoryManager, no
ranking/compression). ContextBuilder MUST NOT write files — context-file
materialization is a workspace concern. Ranking/compression are pluggable
strategies behind it later.

### Consequences
- + The expensive-to-retrofit seam exists; algorithms are swappable.
- + Restores single-responsibility to MemoryManager.
- − A pass-through layer with little behavior in v1 (acceptable: the interface is the value).

### V1 / V2
**V1:** interface + `ContextBundle` type + trivial impl. **V2:** semantic ranking, compression, token budgeting.

---

## ADR-0003 — PromptComposer and a provider-agnostic PromptSpec

- **Status:** ✅ Accepted (v1) — highest-value addition
- **Date:** 2026-06-28

### Context
The orchestrator currently passes `plan.summary` / raw message text as the
prompt. A long-lived AI platform needs deterministic, layered, testable prompt
assembly. Different CLIs want different shapes (Claude→`CLAUDE.md`,
Codex→`AGENTS.md`, Ollama→small context), which tensions with "Core knows no
provider".

### Decision
Introduce **PromptComposer** producing a **PromptSpec** layered as
`system + developer + context + task`, **provider-agnostic**. The **AiProvider
adapter** renders `PromptSpec` → concrete CLI args + context files. Per-capability
developer instructions live as runtime templates (the `prompts/` assets, ADR-0011),
consumed by the composer.

### Consequences
- + Prompts become reproducible and unit-testable; provider shaping stays in adapters.
- + Boundary preserved: Core emits a spec, never a CLI-specific string.
- − Requires the PromptSpec contract to be designed carefully up front.

### V1 / V2
**V1:** PromptComposer + PromptSpec contract + the prompt templates actually used. **V2:** richer layering, A/B prompt variants per AgentProfile.

---

## ADR-0004 — Workflow deferred; reserve a nullable field

- **Status:** ⛔ Deferred (v2+) — reserve `workflowId` only
- **Date:** 2026-06-28

### Context
A Workflow (multi-task DAG with dependencies, partial failure, resume) is real
over-engineering before single-task execution even works. It also collides
conceptually with `Plan`/`PlanStep`, risking two overlapping decomposition models.

### Decision
**Do not build a Workflow engine in v1.** Fix the boundary: **Plan/PlanStep =
intra-task decomposition; Workflow = inter-task orchestration.** Reserve a
nullable `workflowId?: Id` on `Task` (unused in v1) so the future retrofit is a
one-field change.

### Consequences
- + Avoids a premature orchestration layer and conceptual drift.
- + Cheap retrofit preserved.
- − Multi-task scenarios are unsupported in v1 (acceptable).

### V1 / V2
**V1:** reserve `workflowId` + document the Plan-vs-Workflow distinction. **V2:** Workflow aggregate + execution engine.

---

## ADR-0005 — Resource abstraction, scoped to inputs

- **Status:** 🟡 Reserved seam (v1)
- **Date:** 2026-06-28

### Context
Input references are fragmented (`Project`, `Attachment`, `ConnectorItem`,
`WorkspaceRef`). ContextBuilder otherwise needs N special cases to pull in a PDF,
URL, ticket, or repo file. Risk: an "everything is a Resource" bag that merges
inputs and outputs.

### Decision
Introduce **`ResourceRef`** (`{id, kind, uri, source, metadata}`) + a
**`ResourceResolver`** port for **read-side inputs only**. Keep `Artifact`
(output) strictly separate. `Project` stays its own entity but may be *exposed
as* a Resource. **Connectors are ResourceResolvers** (read), which absorbs much
of the plugin question (ADR-0007).

### Consequences
- + Uniform context-input path; connectors unified under a known port.
- + Input/output lifecycles stay distinct (hard rule).
- − Slight upfront modeling of `kind`/`source` taxonomy.

### V1 / V2
**V1:** `ResourceRef` + `ResourceResolver` port (no concrete resolvers). **V2:** concrete resolvers (PDF, URL, repo, Jira read).

---

## ADR-0006 — Event types + EventBus port; no choreography

- **Status:** 🟡 Reserved seam (v1) — types + port now, heavy usage deferred
- **Date:** 2026-06-28

### Context
A domain event bus enables audit, decoupling, and plugin hooks, but in-core event
choreography becomes implicit, hard-to-trace control flow — a major long-term
debuggability tax. Audit history also cannot be backfilled if events are not
captured from the start.

### Decision
Define **domain event types** now (`TaskCreated`, `TaskStatusChanged`,
`RunCompleted`, `ApprovalRequested`, `ApprovalDecided`) and an **EventBus port**
with an in-process `LocalEventBus` adapter (transport swappable like
`QueueProvider`). Keep the orchestrator's **primary flow explicit and
synchronous**; use events only for side-channels (audit, memory updates, metrics,
plugin hooks).

### Consequences
- + Audit trail + extension hooks without event-soup control flow.
- + Transport can become Redis/Kafka in Team Edition with no Core change.
- − Discipline required to keep events off the critical path.

### V1 / V2
**V1:** event types + port + LocalEventBus + emit-for-audit. **V2:** distributed transport, plugin subscriptions, projections.

---

## ADR-0007 — Plugin system rejected for v1; a plugin is a bundle

- **Status:** ❌ Rejected (v1) for "replace connectors"; concept reserved for v2+
- **Date:** 2026-06-28

### Context
"Plugin" conflates four unrelated extension types (UI adapters, read connectors,
gated actions, AI providers); one `Plugin` interface becomes a god-interface.
Dynamic loading (manifests, sandboxing, versioning, permissions) is heavy
over-engineering for a local-first personal edition, where compile-time
registration in the composition root is safer.

### Decision
**Keep manual registration in the composition root for v1.** A future plugin is a
**packaging bundle that contributes implementations of existing narrow ports**
(`PlatformAdapter`, `ResourceResolver`, `ActionProvider`, `AiProvider`) plus a
capabilities/permissions manifest — never a new Core dependency. Shape for it now
only by: no god-interface, all external actions go through the approval gate, and
providers carry a uniform capability/permission descriptor.

### Consequences
- + Avoids premature plugin infrastructure; governance cannot be bypassed.
- + External writes are modeled as gated `ActionProvider`s, not ad-hoc connector methods.
- − No third-party/hot-loadable plugins in v1 (acceptable).

### V1 / V2
**V1:** manual registration; narrow ports only. **V2+:** plugin bundle model + loader + manifest/permissions.

---

## ADR-0008 — Agent layer deferred; reserve AgentProfile config

- **Status:** ⛔ Deferred runtime (v2+); 🟡 reserve `AgentProfile` config seam (v1)
- **Date:** 2026-06-28

### Context
"Agent" is ambiguous (persona vs autonomous loop vs sub-orchestrator) and most
likely to be redefined as understanding grows. But `capability + developer-prompt
+ provider-hint` is already a proto-agent.

### Decision
**No agent runtime in v1.** Reserve the seam as **configuration, not a service**:
`AgentProfile = {role, capability, promptTemplateRef, riskProfile,
allowedResources}`. Routing becomes **Planner → AgentProfile → Capability →
Provider**. Autonomous loops (plan-act-observe, tool use, sub-agents) are deferred
and MUST sit behind this seam without changing Capability/Provider contracts.

### Consequences
- + Keeps the agent concept from hardening prematurely.
- + Connects naturally to PromptComposer templates (ADR-0003).
- − Single-shot execution only in v1 (acceptable).

### V1 / V2
**V1:** `AgentProfile` config type, consulted by Planner/Router. **V2:** agent runtime / tool-using loops.

---

## ADR-0009 — Actor / Principal model (Personal → Team enabler)

- **Status:** ✅ Accepted (v1) — highest-priority missing concept
- **Date:** 2026-06-28

### Context
Everything currently keys off a raw platform `userId` string. Team Edition needs a
platform-independent identity that authorization hangs off. This touches *every*
entity, making it the **most expensive retrofit of all** — more urgent than
Session, Workflow, or Plugins for the "Personal → Team without changing Core" goal.

### Decision
Introduce a thin **`Actor`** (a.k.a. Principal): platform-independent identity,
optionally a team/org later. `Session` and `Task` reference an `actorId`. In v1
the single Discord user maps to one local Actor. Reserve a `PolicyProvider`
authorization seam (ADR notes; not implemented) tied to Actor for per-actor
permissions beyond risk levels.

### Consequences
- + Authz and multi-actor teams become additive, not a rewrite.
- + Risk levels gate *what's dangerous*; Policy/Actor gate *who may do/approve what* later.
- − Every new entity must carry/derive `actorId` from the start.

### V1 / V2
**V1:** thin `Actor` + `actorId` references; single mapped local actor. **V2:** multi-actor teams, `PolicyProvider`, approval authority rules.

---

## ADR-0010 — Usage / Cost tracking on TaskRun

- **Status:** 🟡 Reserved seam (v1)
- **Date:** 2026-06-28

### Context
For an AI platform, cost (which provider, wall-time, tokens) is **domain data**.
If not captured from run #1, historical cost/quality data is permanently lost.
`TaskRun` records `providerId` (audit) but no usage.

### Decision
Add a **`Usage`** value object to `TaskRun` (e.g. `provider`, `durationMs`,
optional `inputTokens`/`outputTokens`/`costEstimate`) and reserve a
**`TelemetryProvider`** port for tracing/metrics. CLI providers populate what
they can measure; unknown fields stay optional.

### Consequences
- + Cost/perf analysis and provider comparison become possible from day one.
- + Telemetry transport is swappable per edition.
- − CLIs may not expose token counts; fields remain optional/best-effort.

### V1 / V2
**V1:** `Usage` on `TaskRun` (duration + provider at minimum) + `TelemetryProvider` port. **V2:** dashboards, budgets, per-actor cost.

---

## ADR-0011 — AI-native documentation strategy

- **Status:** ✅ Accepted (v1)
- **Date:** 2026-06-28

### Context
An AI-native repo needs agents to behave correctly without re-deriving intent.
The v3 proposal mixed three different file kinds (human docs, agent instructions,
runtime assets) and fragmented agent instructions across CLAUDE/CODEX/OLLAMA.md,
which guarantees drift. `PROMPTS/*.md` are runtime data, not documentation.

### Decision
- **Constitution + case law:** `ARCHITECTURE.md` (rules) + `DECISIONS.md` (why),
  both required reading before coding.
- **One agent manual:** `AGENTS.md` is canonical; `CLAUDE.md` is a thin pointer.
  **Do not create `CODEX.md`/`OLLAMA.md`** — provider behavior lives in adapters,
  provider notes live as a section in `AGENTS.md`.
- **Runtime templates ≠ docs:** prompt templates belong under a `prompts/` asset
  path owned by the PromptComposer (ADR-0003), not the doc root. Do not move them
  until they exist.
- **Minimum AI-native set before business logic:** `README.md` (exists),
  `ARCHITECTURE.md`, `DECISIONS.md`, `AGENTS.md`, `CLAUDE.md`. Everything else
  (ROADMAP detail, CONTRIBUTING, prompt templates) is added when its work starts —
  no placeholders.

### Consequences
- + Agents read one consistent source; settled decisions are not re-litigated.
- + No empty/placeholder docs to rot.
- − Requires discipline to record every decision here before dependent code merges.

### V1 / V2
**V1:** the four-file minimum set + this log. **V2:** ROADMAP detail, CONTRIBUTING, populated `prompts/`.

---

## ADR-0012 — Repository operating model & Charter reconciliation

- **Status:** ✅ Accepted (v1) — extends ADR-0011
- **Date:** 2026-06-28

### Context
The Project Charter v1 proposed a collaboration/governance model and a larger
documentation tree. A Principal-Architect review found three problems: (1) it
hard-coded a specific AI vendor (ChatGPT) as Chief Architect/decision-maker —
self-contradictory for a project whose first principle is "models are
implementation details"; (2) a full `docs/{architecture,adr,sprints,reviews,…}`
tree would create placeholders, violating ADR-0011; (3) ADRs were split across
`docs/adr/` and `DECISIONS.md`. The Product Owner reviewed and approved a
reconciled, minimal version.

### Decision
- **Collaboration model is role-based, not vendor-based** (in `AGENTS.md` §9):
  Product Owner (final decision), Chief Architect, Architecture Reviewer,
  Implementation Engineer, Review Engineer. No AI vendor is hard-coded into
  governance. **Reviewer ≠ implementer**; any role may propose an ADR; only the PO
  ratifies.
- **Documentation = single source of truth; prompts are temporary.** Architecture
  changes happen **only through an approved ADR**, never via an ad-hoc prompt or
  silently in code.
- **Add only immediately-useful docs** (no `docs/` subtree, no empty folders):
  `ROADMAP.md`, `CURRENT_STATE.md`, `CHANGELOG.md` (Keep a Changelog), and a single
  `docs/templates/ADR_TEMPLATE.md`. `DECISIONS.md` stays the canonical ADR log at
  root (migrate to `docs/adr/` only if it grows; not now).
- **Conventional Commits** is the repository commit standard.
- Vision gains **Hosted/SaaS Edition**; multi-tenancy is a **v3** scope dimension
  layered on Actor/Session — no multi-tenant abstractions now (YAGNI).

### Consequences
- + Governance is self-consistent with the product philosophy and tool-agnostic.
- + Doc set stays minimal and maintainable; no placeholder rot.
- + Clear change-control: docs win over prompts, ADR-gated changes.
- − Requires discipline: every sprint updates `CURRENT_STATE.md` + `CHANGELOG.md`,
  and architecture edits must carry an ADR.

### V1 / V2
**V1:** all of the above. **V2:** CONTRIBUTING.md, `docs/adr/` migration if volume warrants, populated `prompts/`.

---

## ADR-0013 — Sprint sequencing (split the first vertical slice) & YAGNI on seams

- **Status:** ✅ Accepted (v1)
- **Date:** 2026-06-28

### Context
The Charter's Sprint 1 lit up six still-stubbed components at once (Discord,
Session, Intent, Planner, ContextBuilder, PromptComposer, Claude CLI, SQLite) — a
high-blast-radius first real sprint. The Charter also proposed reserving seams for
~11 future capabilities, most of which existing ports already absorb.

### Decision
- **Split Sprint 1** into thin slices:
  - **Sprint 1a — walking skeleton:** Discord adapter + minimal Session + SQLite
    persistence + **echo** reply. Validates I/O, persistence, and boundaries with
    **no cognition**.
  - **Sprint 1b — first cognitive flow:** Intent classification + Planner +
    ContextBuilder + PromptComposer + capability routing + Claude CLI execution.
    Natural language only; **provider chosen by the router, never hardcoded** even
    in the skeleton.
  - **Future sprint:** memory improvements, Codex, Ollama, connectors (read-only).
- **YAGNI on reserved seams:** reserve a seam only when retrofit is expensive.
  Future capabilities (MCP, plugins, multi-agent, remote workspace, local model
  manager, multimodal, search, scheduler, notification, feedback learning, feature
  registry) map onto **existing ports / prior ADRs** or require **no action now**
  (see `ROADMAP.md` → Deferred capabilities). No new Core seams are added for them.

### Consequences
- + Lower risk per sprint; the skeleton proves the architecture before cognition.
- + Avoids premature abstraction; existing ports carry future load.
- − Two sprints to reach a full NL flow instead of one (intended trade-off).

### V1 / V2
**V1:** Sprint 1a then 1b. **V2:** the future sprint and beyond, per `ROADMAP.md`.

---

## ADR-0014 — Prompt/Context contracts, AiProvider promptSpec, and Claude CLI invocation

- **Status:** ✅ Accepted (v1) — elaborates ADR-0002 / ADR-0003
- **Date:** 2026-06-29

### Context
Sprint 1b needs concrete shapes for context assembly and prompting, and a defined
way for the CLI provider to run. ADR-0002 (ContextBuilder) and ADR-0003
(PromptComposer/PromptSpec) decided the seams; this records the concrete v1 contracts.

### Decision
- **ContextBundle (minimal):** `{ taskId, summary, recentMessages: string[] }`.
  Ranking / compression / resources are deferred behind this shape.
- **PromptSpec (minimal, layered):** `{ system, developer, context, task }`,
  provider-agnostic. The PromptComposer (core) builds it; an AiProvider adapter
  RENDERS it. The core NEVER renders provider-specific text.
- **`AiExecutionRequest.promptSpec?` added** (additive, optional); `prompt?` becomes
  the optional pre-rendered fallback. Providers prefer `promptSpec`.
- **Claude CLI invocation contract** (implemented in Sprint 1b-2):
  - Use `claude -p` (non-interactive print).
  - Pass the prompt safely via **stdin** (never shell-interpolated into args).
  - **Do NOT use `--bare`** — it requires `ANTHROPIC_API_KEY` and ignores OAuth;
    we preserve authenticated-CLI usage.
  - Run in a **neutral cwd** so the repo's `CLAUDE.md`/`AGENTS.md` are not auto-ingested.
  - Apply a **timeout**; **capture stdout** as the response.
- **v1 is CLI-only — no AI HTTP API path** anywhere.

### Consequences
- + Concrete, testable prompt/context contracts; provider rendering stays in adapters.
- + The additive request field keeps existing call sites valid.
- + Claude invocation is deterministic, leaks no repo context, and needs no API key.
- − Both `prompt` and `promptSpec` optional means a caller must supply one (enforced by
  usage/convention, not the type).

### V1 / V2
**V1:** the above; ClaudeCliProvider implements the invocation in Sprint 1b-2.
**V2:** richer PromptSpec layers, ContextBuilder ranking/compression, per-provider
rendering refinements.

---

## ADR-0015 — Claude global-context acceptance & CLI failure taxonomy

- **Status:** ✅ Accepted (v1)
- **Date:** 2026-06-29

### Context
`claude -p` with OAuth (no `--bare`) auto-loads the **global** `~/.claude/CLAUDE.md`
and auto-memory; the neutral cwd only prevents the **repo** CLAUDE.md from being
ingested. Separately, the product must fail gracefully when the CLI is missing,
unauthenticated, slow, or errors — not crash or go silent.

### Decision
- **Global context (Chief-Architect decision 1):** v1 **accepts** that `claude -p`
  loads global `~/.claude/CLAUDE.md` + auto-memory. We keep the **neutral cwd**
  (blocks the repo CLAUDE.md) and do **not** use `--bare` (it requires
  `ANTHROPIC_API_KEY` and breaks OAuth). A future **isolated mode** is left open
  (dedicated HOME/settings or a discovery-skip flag) for team/SaaS editions.
- **Failure taxonomy:** `AiFailureKind` = `UNAVAILABLE | AUTH_REQUIRED | TIMEOUT |
  EXECUTION_FAILED | EMPTY_OUTPUT`. The provider throws `AiProviderError(kind,
  masked technical message)`; the core maps the kind to a friendly Discord message
  (the **core owns the UX text**, not the provider) and stores `kind: summary` on
  the TaskRun.
- **TaskRun on failure:** status `FAILED`, `error` summary stored, `durationMs`
  recorded; no artifact. The user **always** gets a reply; the run is never lost.
- **Secrets:** the prompt is passed via **stdin** (never argv); stderr is
  **secret-masked** before being logged or stored; user messages never carry
  technical detail.
- **Output/usage:** text output retained; usage tracking is minimal (`providerId`
  + `durationMs`). `--output-format json` and token/cost tracking are deferred.

### Consequences
- + Product-grade, classified failure UX; auditable FAILED runs with timing.
- + No secret leakage into logs, storage, or user messages.
- − Global `~/.claude` context may inject unintended instructions/memory into
  user-facing answers in v1 (accepted risk; revisit for team/SaaS).
- − No Codex/Ollama fallback yet: when Claude is unavailable the user gets the
  UNAVAILABLE message rather than an alternate provider.

### V1 / V2
**V1:** the above. **V2/V3:** isolated Claude-context mode; multi-provider fallback;
`--output-format json` + token/cost usage.
