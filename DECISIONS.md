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

### Amendment (RC, 2026-06-29)
The nullable `workflowId` field is **not** reserved on `Task` after all. Under
ADR-0013 ("YAGNI on seams") and the JSON-blob storage model (entities serialize to
a `data` column; adding a field needs **no migration**), a late add is free — so the
reservation bought nothing. The **Plan-vs-Workflow conceptual boundary still holds**;
only the empty placeholder field is dropped. Surfaced by the V1 architecture audit
(drift W-2) and reconciled here.

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

### Amendment (RC, 2026-06-29)
Realized **minimally**: `TaskRun` records `providerId`, `durationMs`, and `error`
(ADR-0015) — duration + provider, the stated v1 minimum. A structured `Usage` value
object and a `TelemetryProvider` port are **not** built (no token/cost capture yet,
and the CLIs don't expose token counts). Deferred to V2 under ADR-0013's YAGNI; the
JSON storage model makes adding `usage` later migration-free. Surfaced by the V1
architecture audit (drift W-3).

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

---

## ADR-0016 — Discord response delivery policy

- **Status:** ✅ Accepted (v1)
- **Date:** 2026-06-29

### Context
Discord caps a message at 2000 chars; Claude answers are often longer (a smoke
answer was 5351 chars). Sends can fail or be rate-limited, and the "is typing…"
indicator only lasts ~10s while runs take ~50–70s. Delivery is a Discord-specific
concern and must not leak into the core.

### Decision
- **Chunking (adapter):** split at `DISCORD_SAFE_LIMIT = 1900` (headroom under
  2000), preferring newline → space boundaries; an over-long token is hard-cut.
  Pure `chunkText` lives in the Discord adapter; the core stays Discord-free.
- **Sequential delivery:** chunks are sent in order, awaiting each before the next.
- **Send-failure handling:** on the first chunk failure, **stop** (partial delivery)
  and report/log (secret-masked). **No resend** → no duplicate messages. Rate-limit
  backoff is delegated to **discord.js's REST layer**. Task-level retry remains a
  future RetryPolicy ADR.
- **Typing indicator:** refresh every ~8s (under the ~10s TTL) while processing;
  cleared by the next `sendMessage` to that target, or a safety cap (~128s).
  Adapter-internal (the TTL is a Discord detail).
- **Response format:** `ResponseComposer` trims and supplies a non-empty fallback.
- **File attachment for very long responses:** **policy/seam only**
  (`FILE_ATTACHMENT_CHUNK_THRESHOLD`) — DEFERRED; v1 still sends chunks and logs
  when the threshold is exceeded.

### Consequences
- + Long responses are delivered reliably; the typing indicator stays continuous.
- + No duplicate messages; partial delivery on failure is reported, not retried.
- − On a mid-sequence send failure the user keeps the chunks already sent (logged;
  the AI run itself is unaffected and remains COMPLETED).
- − Very long responses produce many messages until the file-attachment seam is built.

### V1 / V2
**V1:** the above. **V2:** file-attachment delivery for long responses; optional
chunk numbering; bounded delivery resend under a RetryPolicy ADR.

---

## ADR-0017 — Conversation memory policy (short-term)

- **Status:** ✅ Accepted (v1)
- **Date:** 2026-06-29

### Context
Within one session, a follow-up like "방금 답변 한 줄로 줄여줘" must see the previous
turn. We need the **minimum** continuity — no vector search, no long-term auto-save,
no summarization.

### Decision
- **Store both turns as SHORT_TERM memory:** the inbound USER message and the
  assistant RESPONSE, each scoped by `sessionId` (plus userId/channelId/threadId),
  with `role` (`user`/`assistant`) in `metadata`. **No provider id is stored in memory.**
- **ContextBuilder** includes the most recent **N = 10** SHORT_TERM turns for the
  **same session**, each **simply truncated** (`MAX_MEMORY_CHARS = 400`, no summarization).
  `PromptComposer` renders them into the conversation/context layer (`role: text`).
- **Retrieval is session-scoped** (falls back to channel/thread only if a task has
  no session).
- **Out of scope:** vector search, long-term memory auto-save, summarization memory.
- **Masking:** reuse the existing policy (CLI stderr masking). Memory content is the
  user's own local conversation, stored raw in local SQLite and never logged.

### Consequences
- + Natural multi-turn continuity within a session (verified live: a follow-up
  shortened the prior answer).
- + Bounded prompt growth via the N cap + per-memory truncation.
- − Truncation can drop detail from very long prior turns (acceptable in v1).
- − The `memories` table grows unbounded (no pruning yet) — a future retention/cleanup
  concern; privacy is acceptable for a personal, local-first edition.

### V1 / V2
**V1:** the above. **V2/V3:** vector recall, long-term + summarized memory, retention
/ pruning policy, cross-session/project memory.

> Pruning addendum (Chief Architect): SHORT_TERM memory is capped at **30 per
> session** (oldest pruned). No TTL or total-size cap yet. Also: the current inbound
> user message is excluded from recent context (it already appears in the task layer).

---

## ADR-0018 — Local project registration policy

- **Status:** ✅ Accepted (v1)
- **Date:** 2026-06-29

### Context
Before any coding agent, a user must be able to register a local project and have
its context flow into later answers — read-only, no deep indexing.

### Decision
- **Registration is a deterministic command, not an AI task.** A message like
  "이 프로젝트 등록해줘: /path" classifies as `REGISTER_PROJECT` (path extracted) and
  is handled by `ProjectManager` (risk ≤ MEDIUM, auto-run).
- **Read-only scan** via `WorkspaceProvider.scanProject(path)`: `exists`, `name`
  (basename), `gitBranch` ('unknown' when not a git repo), `packageManager` (lockfile
  detection), `fileTreeSummary` (top-level only; **excludes** node_modules, dist,
  build, .git, coverage). The scan never modifies anything.
- **Persistence:** a `Project` entity (SQLite `projects`); a PROJECT-type memory
  holding the rendered summary, scoped by `projectId` (+ sessionId); the session's
  `activeProjectId` is set.
- **Use in chat:** later tasks carry `projectId = session.activeProjectId`;
  `ContextBuilder` includes the PROJECT memory summary; `PromptComposer` renders it and
  instructs the model to answer from the provided context (not read files / use tools).
- **Failure UX:** a non-existent path → friendly failure, nothing persisted. Path must
  be a local directory.
- **Workspace gating:** only filesystem-touching capabilities (CODE_IMPLEMENTATION /
  TEST_EXECUTION) resolve a workspace; a chat about a project does NOT — its context
  comes from PROJECT memory, not a resolved working directory.

### Consequences
- + Project context is available in conversation, read-only, with a bounded summary.
- + Registration is auditable (project + PROJECT memory + session link) and safe.
- − The summary is top-level only (shallow); deep structure isn't known without
  reading files (deliberately out of scope — no deep indexing / coding agent yet).
- − The model could still attempt file access despite the instruction; mitigated by a
  neutral cwd + the system prompt. A hard tool-disable is a future option.

### V1 / V2
**V1:** the above. **V2:** deeper (gated) project indexing, multiple projects per
session, git-worktree workspaces, and tool-restricted execution.

---

## ADR-0019 — Gated Project Analysis

- **Status:** ✅ Accepted (v1)
- **Date:** 2026-06-29
- **Scope boundary:** this ADR is **NOT** an approval of "Deep Project Indexing."
  It delivers a narrow, gated, read-only *analysis* of allow-listed project
  metadata files only. Repository-wide indexing remains deferred (see the explicit
  non-goals in Decision below). It does not widen ADR-0018's V2.

### Context
After registering a project (ADR-0018), the only context available in chat is a
**top-level file-tree summary** held as PROJECT memory. That is enough to name a
project but not to describe its architecture. A user asking "what's the structure
of this project?" gets a thin, often unhelpful answer because the model was never
shown any file contents — and (by ADR-0018) it must not read files itself.

### Decision

**What this ADR is (and explicitly is not):**
- This ADR introduces a gated read-only project analysis capability.
- Only an allow-list of project metadata files may be read.
- This ADR explicitly does **NOT** introduce repository indexing.
- This ADR does **NOT** introduce vector search.
- This ADR does **NOT** introduce semantic code search.
- Repository-wide indexing remains deferred.

The current implementation scope is **Project Analysis**, not **Deep Project
Indexing**. The mechanics below stay strictly inside that boundary.

**Mechanics:**
- **A new intent + capability `PROJECT_ANALYSIS`.** A message that asks to
  analyze/explain a project's structure classifies deterministically: an analysis
  verb (분석/설명/알려/analyze/explain/describe/overview) co-occurring with a
  project/structure noun (프로젝트/레포/패키지/구조/아키텍처/repo/project/structure/
  architecture), in either order — or "분석/analyze" alone — maps to
  `PROJECT_ANALYSIS` (risk LOW, `requiresWork: true` → runs as a Task). This is a
  minimal v1 heuristic; AI-driven classification is deferred.
- **Deterministic guard + gather, AI summarizes.** `ProjectAnalyzer.prepare(session)`
  guards an **active, resolvable project** exists (else a friendly "register first"
  message, nothing run). It then performs a **read-only, size-limited** read via
  `WorkspaceProvider.readProjectFiles(rootPath)`. The AI summarization runs in the
  normal task pipeline; the service does no AI work itself.
- **Allow-list, not crawl.** Only specific files may be read in full:
  `package.json`, `pnpm-workspace.yaml`, `README.md`, `ARCHITECTURE.md`,
  `DECISIONS.md`, and `tsconfig*.json`. Each is capped at **8 KB** (`truncated`
  flagged). A **2-level tree** (root + `apps/` + `packages/`, ≤60 entries/dir) is
  included. `node_modules`/`dist`/`build`/`.git`/`coverage` are excluded.
- **Never read secrets.** Any `.env*` or name matching
  `secret|token|key|credential|password` is skipped unconditionally — independent
  of the allow-list. No shell or git commands are run during analysis.
- **Prompt seam.** `PromptComposer.compose(task, bundle, readout?)` renders the
  readout as a clearly-delimited read-only section and instructs the model to
  summarize **only** from the shown files/tree and not invent files.
- **Reuse.** A completed analysis is persisted as a **TOOL-type** memory
  (`kind: 'analysis'`) scoped by `projectId` (+ sessionId) for later reuse.
- **No workspace resolution.** `PROJECT_ANALYSIS` is not filesystem-touching in the
  workspace sense (no clone/cwd); `needsWorkspace` stays limited to
  CODE_IMPLEMENTATION / TEST_EXECUTION (ADR-0018). The readout is the only file I/O.

### Consequences
- + Structural questions get a grounded answer from real files, still read-only and
  bounded — no deep indexing, no tool execution, no secret exposure.
- + The guard keeps the failure UX kind (no active project → ask to register).
- − The allow-list is intentionally narrow; a project that documents itself
  elsewhere (e.g. `docs/`) is summarized only from the listed files + tree. Widening
  the list is a deliberate, reviewable change.
- − 8 KB/file truncation can clip large manifests; acceptable for a summary, flagged
  as `truncated` so the model knows.

### V1 / V2
**V1:** the above (fixed allow-list, 2-level tree, single active project).
**Deferred (NOT approved by this ADR; each needs its own ADR):** repository-wide
indexing, vector search, semantic code search, configurable/auto-discovered read
sets, and tool-restricted live file reads under approval.

---

## ADR-0020 — SQLite schema versioning & a minimal migration runner

- **Status:** ✅ Accepted (v1, RC)
- **Date:** 2026-06-29

### Context
v1 applied schema at startup with `CREATE TABLE IF NOT EXISTS` plus defensive
`ALTER TABLE … ADD COLUMN` wrapped in try/catch. There was **no schema version**, so
the DB could not tell which changes it had seen, and the silent catch could mask a
real `ALTER` error. The V1 architecture audit flagged this (W-9) as a freeze-blocker
for safe future schema evolution.

### Decision
Introduce a **minimal, forward-only migration runner** in `@chunsik/storage-sqlite`
(`migrations.ts`), keyed on SQLite's native `PRAGMA user_version`:
- `MIGRATIONS` is an ordered list of `{ version, name, up(db) }`. **Version 1 is the
  current baseline** — identical DDL to the pre-RC inline schema — so existing
  databases are unchanged.
- `runMigrations(db)` reads `user_version`, applies each migration with a higher
  version **inside its own transaction**, advances `user_version`, and returns the
  `{from, to, applied}` transition.
- Each `up` MUST be **idempotent** (`IF NOT EXISTS`, column-existence-guarded
  `ADD COLUMN`). A legacy DB (`user_version = 0`) re-runs the baseline as a no-op and
  is stamped forward — **fully backward compatible**.

This is **not** a persistence redesign: tables, columns, the JSON-`data` row model,
and all queries are unchanged. It only changes *how* schema is applied and adds a
version stamp. No new application functionality.

### Consequences
- + Schema evolution is ordered, versioned, transactional, and auditable.
- + Backward compatible with every existing `chunsik.db`.
- − Migrations must stay idempotent and append-only (forward-only; no down-migrations
  in v1 — acceptable for a local, single-file DB).

### V1 / V2
**V1:** `user_version`-keyed runner + baseline migration. **V2:** indexed/FK
migrations, and a richer migration history table if multi-node storage arrives.

---

## ADR-0021 — Logger / observability port

- **Status:** ✅ Accepted (v1, RC)
- **Date:** 2026-06-29

### Context
A `Logger` port (`info/warn/error(message, fields?)`) and a `ConsoleLogger` adapter
were introduced during the Sprint 1a observability cleanup (structured logs, no
`console.log`, secrets masked) but never recorded as a decision. §11.7 requires every
architectural seam to have an ADR; the V1 audit flagged the gap (W-4).

### Decision
Record the existing seam: **`@chunsik/core` defines a `Logger` port**; core services
log through it and never touch `console`. The composition root constructs a concrete
`ConsoleLogger` and passes it in (core via `ChunsikCoreDeps.logger`; adapters receive
their own instance). Logging is **structured** (message + typed fields), secrets are
masked before they reach the logger (ADR-0015), and full prompts/tokens are never
logged. The logger is wired by **direct construction**, not a DI token — acceptable
for a leaf, always-present cross-cutting concern.

### Consequences
- + Observability is swappable (file/JSON/remote transport later) without touching core.
- + No platform/console types leak into core.
- − No `LOGGER` token yet; if a future provider needs token-based override, add one
  then (cheap).

### V1 / V2
**V1:** `Logger` port + `ConsoleLogger`, direct-wired. **V2:** structured/JSON sink,
correlation ids, and a `TelemetryProvider` (see ADR-0010) if metrics are added.

---

## ADR-0022 — Workspace Capability (Read / Diff foundation)

- **Status:** ✅ Accepted (v2, Sprint 2a)
- **Date:** 2026-06-29

### Context
Version 2 is the first **architecture-first** capability work, and the foundation for
all future coding capabilities is the **Workspace**. v1 left the filesystem surface
(`resolve`/`readFile`/`listFiles`/`writeFile`/`gitStatus`/`runCommand`) as stubs. The
target flow is `Read → Analyze → Plan → Diff → Approval → Write → Execute → Commit`;
this ADR delivers only the **read-only Read + Diff** foundation. (Chief Architect review:
APPROVED WITH CHANGES.)

### Decision

**Workspace Capability ≠ Git Capability.** The Workspace owns the **filesystem**
abstraction; a future, separate **Git Capability** will own the **repository**
abstraction. They stay independent. This ADR introduces **no git** at all.

- **Read-only surface only:** implement `resolve`, `readFile`, `listFiles`, and a new
  `diff` on `WorkspaceProvider`. `writeFile`, `writeContextFiles`, `runCommand`, and
  `gitStatus` remain unimplemented stubs (write/exec are gated behind future approval
  slices; `gitStatus` belongs to the future Git capability).
- **`resolve(ref: WorkspaceRef)`** — the **core** (`WorkspaceManager.open(project)`)
  builds the pure `WorkspaceRef` (id + projectId + rootPath + `kind` from the bound
  provider). The provider receives only the ref and **never queries storage / resolves
  project ids** (cross-adapter dependency stays forbidden). A worktree provider later
  implements the same contract.
- **No git, no `child_process`, no shell** in this capability. Read/list/diff use
  `node:fs` only. (`scanProject`'s pre-existing git-branch probe is v1 registration code,
  ADR-0018, and is out of this capability's scope.)
- **Diff source = current file → proposed content → unified diff.** `diff(ref, changes)`
  reads each current file (read-only) and emits a unified `WorkspaceDiff`. It does **not**
  compare against git, repository history, or any repo state. This seam exists to feed the
  **Approval** gate in a later slice.
- **Diff engine is a mature library in the adapter** (`diff`/jsdiff), kept out of
  `@chunsik/core` so the **core remains dependency-free** and the engine stays replaceable
  with no provider-specific assumptions.
- **Sandbox + guards:** every read/list/diff path is confined to the workspace root
  (reject absolute paths, `..` traversal, and symlink escapes); secret-named and ignored
  entries (`node_modules/dist/build/.git/coverage`, `.env*`, secret/token/key/...) are
  excluded; per-file size guard (256 KB) and a list cap protect against large/runaway
  inputs; binary files are flagged, not diffed.

### Consequences
- + A production-grade, read-only Workspace foundation; later capabilities (worktree,
  patch, approval-gated write, Codex/Ollama execution) build on the same port.
- + Core stays filesystem-agnostic and dependency-free; all fs work is in the adapter.
- + `WorkspaceDiff` is the explicit pre-approval representation, designed before any write.
- − `WorkspaceManager.prepare(task)` cannot build a ref (a `Task` carries no rootPath); it
  is deferred (throws `NotImplementedError`) until the task→workspace wiring slice — callers
  with a `Project` use `open(project)`. No live path depends on it.
- − The read surface refuses secret-named files; a later capability may refine this.

### V1 / V2
**This slice (2a):** read-only `resolve`/`readFile`/`listFiles`/`diff`.
**Later V2 slices (separate ADRs):** Git Capability (`gitStatus`/working-tree diff),
worktree provider, approval-gated `writeFile`, `runCommand` execution, patch application.

### Amendment (Sprint 2a review — APPROVED WITH MINOR CHANGES, 2026-06-29)
Applied the Chief Architect's minor improvements (no scope added):
- **`WorkspaceRef`** keeps its stable `id`; added optional `metadata` for future
  providers (docker/ssh/remote). `kind` is the provider discriminator.
- **`WorkspaceDiff.estimatedChangedLines`** — total added+removed lines, computed once
  by the provider so future **Approval** workflows can size a change (5 vs 5000 lines)
  without recomputation.
- **`WorkspacePolicy`** value object (adapter; `DEFAULT_WORKSPACE_POLICY`) consolidates
  readable/ignored/secret/maxFileBytes/binary rules in one place; per-project/core-level
  configurable policies are a deliberate future extension.
- **Capability independence** (must hold throughout V2): Workspace owns *filesystem*,
  Git owns *repository*, Approval owns *authorization*, Patch owns *code transformation*
  — kept independent. Capability doc: `docs/capabilities/workspace.md`.

---

## ADR-0023 — CAP-002 Git Capability (read-only repository inspection)

- **Status:** ✅ Accepted (v2, Sprint 2b)
- **Date:** 2026-06-29
- **Capability:** CAP-002 — Git.

### Context
ADR-0022 deliberately left `gitStatus` a stub on `WorkspaceProvider` "until a future
Git capability." Approval/Patch/Workspace-Write will need trustworthy repository state
(branch, clean/dirty). Git must be a **separate** capability — `WorkspaceProvider` must
not know git exists. (Chief Architect review: APPROVED WITH CHANGES.)

### Decision
- **Git Capability is separate from Workspace Capability.** New `GitProvider` port
  (CAP-002) + `GIT_PROVIDER` token + `@chunsik/git-local` adapter (`LocalGitProvider`) +
  `GitManager` core service. **Workspace ≠ Git.**
- **Read-only in Sprint 2b.** Exactly three operations: `isRepository(rootPath)`,
  `info(rootPath) → RepositoryInfo`, `status(rootPath) → GitStatus`. **No** commit,
  checkout, branch, merge, reset, stash, push, pull, fetch, tag, add.
- **Worktree is NOT part of Sprint 2b** — no WorktreeProvider, no worktree methods, no
  reserved worktree operations. Mentioned only as a future relationship.
- **Remote URLs are intentionally excluded.** `RepositoryInfo` carries no remote/url
  field (HTTPS remotes can embed `user:token@host` credentials). Surfacing remotes needs
  a future masking policy + its own ADR. Stderr is sanitized before it surfaces.
- **Write operations require the future Approval capability** (CAP-003). Nothing in
  CAP-002 mutates a repository.
- **Git execution is adapter-only and argument-array based.** `LocalGitProvider` runs git
  via `spawnSync` with an **argv array** (never a shell string, never `shell: true`), a
  timeout, and the repository root as cwd. **Core stays `child_process`-free** and
  provider-agnostic.
- **Compose via `rootPath`.** `GitProvider` takes a plain path and imports **no** Workspace
  type (`WorkspaceRef`/`WorkspaceProvider`). Composition happens above both capabilities.
- **Relocation:** the `gitStatus` stub is **removed** from `WorkspaceProvider`; `GitStatus`
  moves to `domain/git.ts`; `WorkspaceManager.ensureSafe/status` move to
  `GitManager.requireClean/status`.

### Consequences
- + Clean Git/Workspace separation; a trustworthy repository-state source for future
  gated writes; no secret/remote surface in v1.
- + Core remains dependency-free and `child_process`-free; git isolated in one adapter.
- − A port relocation (single implementer, **no live caller**) + a new package.
- − `scanProject`'s git-branch probe (CAP-001/ADR-0018) still runs git inside
  `workspace-local`; relocating it to `GitProvider` is flagged follow-up debt, not 2b scope.

### Capability / Relations
**CAP-002.** Relates: ADR-0022 (CAP-001 Workspace), ADR-0018 (`scanProject`),
ARCHITECTURE.md §9. Capability doc: `docs/capabilities/git.md`.

### V1 / V2
**This slice (2b):** read-only `isRepository`/`info`/`status`.
**Later (separate ADRs):** masked remotes / ahead-behind; worktree (read then,
behind Approval, write); git writes (commit/checkout/branch) under Approval (CAP-003).

### Layering (responsibility split — stable for all of V2)
```
GitRunner    → Infrastructure   (argv-array spawn; the only thing that touches git/child_process)
GitProvider  → Port             (read-only contract: isRepository / info / status)
GitManager   → Application Service (orchestration: isClean / requireClean; composes by rootPath)
```
This split is an architectural invariant: the Manager never spawns, the Port never knows
the concrete runner, and only the adapter's Runner runs git.

### Amendment (final review — APPROVED WITH MINOR CHANGES, 2026-06-29)
- **GitStatus reserved fields** added as optional (`ahead`, `behind`, `isDetached`,
  `hasUnmergedPaths`) — declared now, **not populated** in 2b, to avoid future domain
  ripple for Approval/Patch/Workspace-Write.
- **RepositoryRef (future, non-blocking):** 2b passes `rootPath: string` (accepted). A
  dedicated `RepositoryRef { id, rootPath, provider, metadata }` may be introduced later
  as the Git sibling of `WorkspaceRef`. **`RepositoryRef` and `WorkspaceRef` must never
  reference each other** — sibling domain references; capabilities compose through them.
  Considered for CAP-003+, not built here.

---

## ADR-0024 — CAP-003 Planning Capability (deterministic ExecutionPlan)

- **Status:** ✅ Accepted (v2, Sprint 2c)
- **Date:** 2026-06-29
- **Capability:** CAP-003 — Planning.
- **Roadmap:** revised — Planning now precedes Approval. CAP-001 Workspace ✅ → CAP-002
  Git ✅ → **CAP-003 Planning** → CAP-004 Approval → CAP-005 Patch → CAP-006 Workspace
  Write → CAP-007 Command Execution → CAP-008 Codex → CAP-009 Ollama.

### Context
Every future execution flow (Approval → Patch → Write) needs a single, reviewable,
deterministic blueprint produced *before* any approval or code change. (Chief Architect
review: APPROVED WITH CHANGES, 98/100 — "treat Planning with the same importance as
Workspace and Git.")

### Decision
- **`ExecutionPlan` is the cross-capability execution contract** — produced by Planning,
  consumed by Approval (CAP-004) and Patch (CAP-005). Pure data; no behavior. Reserved
  shape: `id, goal, summary, steps, requiredCapabilities, requiredResources,
  estimatedChanges, approvalRequired, overallRisk, expectedArtifacts, status` (+ optional
  `projectId`, `createdAt`). `ExecutionStep { id, title, description, capability, status }`
  carries per-step `status` (future per-step approval/execution). `ExecutionStatus`
  reserves the lifecycle (PENDING/APPROVED/REJECTED/EXECUTING/COMPLETED/FAILED).
- **Strategy behind a port (no God Object):**
  `PlanningManager → ExecutionPlanner (Port) → DeterministicPlanner`. The strategy is
  replaceable; v2 ships **only `DeterministicPlanner`**. `AIPlanner`/`HybridPlanner` are
  future implementations behind the same port.
- **Deterministic only (Q1).** Planning is deterministic and **AI-free** in CAP-003. AI
  may *assist* later but **must never be the source of truth** — Planning owns the plan.
- **Composition by request (Q2).** `PlanningManager` receives all read-only context via
  `PlanningRequest`; it **must not import** `WorkspaceManager`/`GitManager`/any capability
  manager. Composition happens above Planning.
- **Distinct from the v1 `Plan` (Q3).** The v1 `Plan`/`Planner` remain the intra-task
  decomposition for the chat pipeline; `ExecutionPlan` is the V2 code-change contract.
  Not merged.
- **No persistence (Q4).** `ExecutionPlan` is in-memory only in CAP-003; persistence
  begins with Approval (CAP-004).
- **No orchestrator integration (Q5).** CAP-003 delivers only the domain model, the
  planner strategy, and the contracts — no user-facing wiring.
- **Ref model.** `ExecutionPlanRef { id, goal }` is how downstream capabilities reference
  a plan (sibling of `WorkspaceRef`/`RepositoryRef`) — communicate via refs, not imports.
- **Reuses `RiskPolicy`** for `overallRisk` (max over required capabilities) and
  `approvalRequired` (`requiresApproval`). No new risk model.

### Layering (responsibility split — stable for V2)
```
PlanningManager   → Application Service (thin: validate + delegate; no manager imports)
ExecutionPlanner  → Port               (replaceable strategy)
DeterministicPlanner → Strategy        (pure, deterministic, AI-free; reuses RiskPolicy)
```

### Consequences
- + A single, deterministic, testable contract upstream of all execution; strategy is
  swappable without touching the Manager; core stays pure and dependency-free.
- + `ExecutionPlan` becomes a project-wide contract (see `docs/execution-plan.md`).
- − A second plan concept beside the v1 `Plan` (bounded: distinct lifecycle/consumers).
- − v1 deterministic plans are only as rich as their inputs; AI-assisted enrichment is a
  future strategy (never the source of truth).

### Capability / Relations
**CAP-003.** Relates: ADR-0004 (Plan vs Workflow), ADR-0022 (Workspace), ADR-0023 (Git).
Docs: `docs/capabilities/planning.md`, `docs/execution-plan.md`.

### V1 / V2
**This slice (2c):** `ExecutionPlan` contract + `DeterministicPlanner` + `PlanningManager`.
**Later (separate ADRs/capabilities):** AIPlanner/HybridPlanner; persistence (CAP-004);
per-step approval; orchestrator/Intent wiring.

---

## ADR-0025 — CAP-004 Approval Capability (+ Aggregate Ownership Rule)

- **Status:** ✅ Accepted (v2, Sprint 2d)
- **Date:** 2026-06-29
- **Capability:** CAP-004 — Approval. The governance gate between an `ExecutionPlan`
  (CAP-003) and any code-changing capability. **First persisted V2 aggregate.**

### Aggregate Ownership Rule (project-wide principle)
> Each capability owns exactly one aggregate.
> Only the owning capability may mutate that aggregate.
> Other capabilities may reference, read, or consume it, but must not modify it.

For CAP-004: Approval owns `ApprovalRequest`; Approval may reference `ExecutionPlanRef`;
Approval must **not** mutate `ExecutionPlan`. (Owners: Planning→ExecutionPlan,
Approval→ApprovalRequest, Patch→PatchSet, Workspace Write→WorkspaceChange, Command
Execution→CommandExecution.) An ARCHITECTURE.md write-up may follow in a doc-refinement
sprint; the rule is binding from now.

### Decision
- **`ApprovalRequest` aggregate (Approval-owned), ExecutionPlan-based.** References the plan
  via `executionPlanRef`; persists `id, executionPlanRef, status, riskLevel, reason,
  requestedBy, decision?, decidedBy?, decidedAt?, comment?, createdAt, updatedAt` (+ optional
  `taskId` for v1 compat — **not** task-first, Q2). `ApprovalStatus = PENDING | APPROVED |
  REJECTED`.
- **`ApprovalRef` is plan-scoped** (`{ id, status, executionPlanRef }`) — amended per the
  CAP-005 review. It carries the `ExecutionPlanRef` so a downstream capability can verify an
  approval belongs to the plan it is acting on (referential integrity) without loading the
  aggregate. CAP-004 and CAP-005 share this contract.
- **Approval never mutates `ExecutionPlan` (Q1).** `ExecutionPlan` is an immutable planning
  output after creation; **approval state lives only on `ApprovalRequest`**. No
  `PLANNED → APPROVED` mutation of the plan. A global execution-state projection, if ever
  needed, is a separate model.
- **Deterministic `ApprovalPolicy`** — reuses `RiskPolicy.requiresApproval` (HIGH/CRITICAL).
  Required output: `requiresApproval, reason, riskLevel, requestedBy`. Reserved (NOT
  implemented): `approverRole?, expiresAt?, policyVersion?` — no role-based authorization,
  no expiry enforcement (Q4).
- **`ApprovalManager`** owns the aggregate: `requestFor(plan, requestedBy)` (auto-APPROVED
  when policy needs none, else PENDING), `decide(id, decision)`, `get`, `isApproved(planId)`.
  Reads the plan; never mutates it. No imports of other capability managers.
- **Persistence (first V2 aggregate):** `ApprovalRepository` port (`findByExecutionPlan`) +
  `SqliteApprovalRepository`, created by **migration v2** (`approvals` table) via the
  ADR-0020 runner. The old generic `approvals` stub is removed.
- **No `ExecutionStatus` change (Q3)** — recorded as a follow-up doc/refinement task.
- **No UI / orchestrator wiring (Q5)** — domain + policy + manager + persistence only. The
  orchestrator's dead V1 approval branch is neutralized (un-wired) to compile, not rewired.

### Consequences
- + The governance backbone for all future writes; strict aggregate ownership prevents
  drift; first real persisted V2 aggregate exercising the migration runner.
- + ExecutionPlan stays a pure, immutable planning output.
- − Approval state and plan state live in separate aggregates (by design) — consumers read
  both. A unified execution-state projection is deferred.

### Capability / Relations
**CAP-004.** Relates: ADR-0024 (Planning/ExecutionPlan), ADR-0020 (migrations), ADR-0010.
Docs: `docs/capabilities/approval.md`, `docs/execution-plan.md`.

### V1 / V2
**This slice (2d):** `ApprovalRequest`/`ApprovalRef`/`ApprovalStatus`, `ApprovalPolicy`,
`ApprovalManager`, `ApprovalRepository` + SQLite + migration v2.
**Later:** Discord approval UI + orchestrator wiring; approver roles; expiry; per-step
approval; the Aggregate Ownership Rule in ARCHITECTURE.md.

---

## ADR-0026 — CAP-005 Patch Capability (generate, never apply)

- **Status:** ✅ Accepted (v2, Sprint 2e)
- **Date:** 2026-06-29
- **Capability:** CAP-005 — Patch. Turns an approved plan's proposed changes into a
  durable, reviewable, **immutable** `PatchSet`.

### Most important rule (permanent separation)
> **Patch represents modifications. Patch never applies modifications.
> Workspace Write (CAP-006) applies approved `PatchSet`s.**
These capabilities must never be merged.

### Decision
- **Patch owns `PatchSet`, `PatchOperation`, `PatchRef`.** It does **not** own filesystem,
  repository, execution, approval, or workspace mutation.
- **Generation only (Q1).** `PatchManager.generate` creates a `PatchSet`; it never applies it,
  never writes files, never touches git. The `PatchSet` is **immutable** after creation
  (no `updatedAt`).
- **`PatchStatus` is minimal: `GENERATED` only (Q2).** `APPLIED`/`FAILED`/`EXECUTED` belong to
  Workspace Write / Command Execution, never to Patch.
- **Approval enforced on the passed Ref (Q3).** `generate` requires
  `approvalRef.status === APPROVED` (deterministic check); `PatchManager` does **not** query
  `ApprovalManager`. Composition happens above Patch; capability managers stay independent.
- **Referential integrity (CAP-005 review).** `ApprovalRef` is **plan-scoped**
  (`{ id, status, executionPlanRef }`); `generate` additionally requires
  `approvalRef.executionPlanRef.id === input.executionPlanRef.id` and rejects an approval
  from a different plan. This guarantees the approval governs the plan being patched.
- **Explicit inputs (Q4).** `changes: ProposedChange[]` and `diff: WorkspaceDiff` are received
  **independently** (not pre-merged) so future generators can use them differently. v1 maps
  each change to its `FileDiff` to build a `PatchOperation` (path, operation, diff, metadata?).
- **`PatchOperation`** is a value object: `path`, `operation` (`add`/`update`/`delete`),
  `diff` (unified text), optional `metadata` — no filesystem mechanics, no raw `newContent`.
  CAP-001's `modify` maps to `update`.
- **Persistence (Q5):** `PatchSet` persists exactly `id (PatchRef)`, `executionPlanRef`,
  `approvalRef`, `operations[]`, `status`, `createdAt` — nothing more. `PatchRepository` +
  `SqlitePatchRepository` + **migration v3** (`patches` table).
- **Aggregate Ownership (ADR-0025):** Patch owns `PatchSet`; references `ExecutionPlanRef` /
  `ApprovalRef` (read-only); never mutates them. Ref-based communication only.
- **Immutability for downstream:** Workspace Write must consume the `PatchSet` exactly as
  produced — never regenerate or reinterpret it — preserving deterministic execution.

### Consequences
- + Clean Patch/Write separation; an immutable, reviewable, persisted change unit; reuses
  CAP-001's diff and the ADR-0020 migration runner.
- + Patch performs no I/O beyond persistence; cannot mutate the workspace.
- − A `PatchSet` carries unified diffs (not raw content); Workspace Write applies the diff.

### Capability / Relations
**CAP-005.** Relates: ADR-0022 (WorkspaceDiff), ADR-0024 (ExecutionPlan), ADR-0025
(Approval + Aggregate Ownership), ADR-0020 (migrations). Docs: `docs/capabilities/patch.md`.

### Out of Scope (deferred)
Patch application, file writing, git apply/commit, workspace mutation, execution, rollback,
AI provider integration, command execution — all later capabilities.

---

## ADR-0027 — CAP-006 Workspace Write Capability (apply, not generate)

- **Status:** ✅ Accepted (v2, Sprint 2f)
- **Date:** 2026-06-30
- **Capability:** CAP-006 — Workspace Write. **The first capability that mutates the
  filesystem.** Owns the `WorkspaceChange` **Execution History** aggregate.

### Most important rule
> **Patch generates. Workspace Write applies.** Workspace Write consumes an immutable
> `PatchSet` and applies its operations to the workspace; it never generates patches,
> never calls git, never runs commands.

### Decision
- **Owns `WorkspaceChange`** (+ `WorkspaceChangeRef`, `WorkspaceChangeStatus`,
  `FileChangeResult`). Mutates only this aggregate. **Never mutates** `PatchSet`/
  `ExecutionPlan`/`ApprovalRequest` (Aggregate Ownership Rule, ADR-0025) — references via Refs.
- **Apply flow:** `WorkspaceWriteManager.apply({ patchSet, approvalRef, workspaceRef })` →
  `WorkspaceChange` → `WorkspaceWriter` (port/adapter). The writer never generates patches.
- **Approval (Ref only):** requires `approvalRef.status === APPROVED` **and**
  `approvalRef.executionPlanRef.id === patchSet.executionPlanRef.id` (plan-scoped referential
  integrity, ADR-0025/0026). Does **not** query `ApprovalManager`.
- **Repository independence:** **no git, no commit, no repo mutation, no `child_process`** in
  Workspace Write. The `WorkspaceWriter` adapter uses `node:fs` only.
- **PatchSet is immutable**, consumed exactly as produced (no regenerate/reinterpret).
- **Patch revision contract (CAP-006 review).** `WorkspaceChange` persists `patchHash` — a
  deterministic content hash of the applied PatchSet's operations (pure `contentHash`, no
  `node:crypto`). The Execution History records EXACTLY which patch revision it applied
  (basis for conflict detection / resume / rollback / audit). Re-applying the **same**
  revision keeps status-based idempotency; a **different** revision for the same PatchSet id
  is **refused** (`WorkspaceChange` is not reused across revisions).

### CA Planning-review changes (Round 2)
- **Best-effort, not stop-on-first-failure.** Every operation is attempted; each yields a
  `FileChangeResult` (`applied`/`failed`/`skipped`). Final status is derived after all attempts.
- **`WorkspaceChangeStatus` = `PENDING | APPLYING | APPLIED | PARTIALLY_APPLIED | FAILED`**
  (Rollback-capability-stable).
- **Idempotency is status-based.** One `WorkspaceChange` per `PatchSet`: `APPLIED` → no-op;
  `FAILED`/`PARTIALLY_APPLIED`/`APPLYING` → re-attempt on the same aggregate.
- **Atomic unit = file** (temp-write + rename, or unlink). A PatchSet is not a transaction.
- **`FileChangeResult` = `{ path, operation, status, message, durationMs }`** — the
  Execution-History record.

### Consequences
- + A complete, auditable execution record (best-effort, per-file); clean apply/generate
  separation; reuses CAP-001 diff (jsdiff `applyPatch`) + the ADR-0020 migration runner (v4).
- + Repository-independent — git recovery/rollback handled by future capabilities, not here.
- − Multi-file apply is not atomic (file is the atomic unit); partial state is precisely
  recorded for a future Rollback capability.

### Out of Scope (deferred — Non-blocking, CA-confirmed)
**Rollback** (future capability, may use Git capability), **Resume** (CAP-006 records only,
no resume engine), git recovery, command execution, AI provider integration. Workspace Write
stays Repository-Independent. `WorkspaceChange` is the **Execution History** starting point
that CAP-007 Command Execution may later consume.

**Reserved (NOT implemented now — future candidates):** a `ROLLBACK_REQUIRED`
`WorkspaceChangeStatus` (added when the Rollback capability lands); `startedAt`/`finishedAt`
on `FileChangeResult` (the VO is kept open for this). Recorded here per the CAP-006 review;
no code added.

### Capability / Relations
**CAP-006.** Relates: ADR-0026(Patch), ADR-0025(Approval/Ownership), ADR-0022(Workspace diff),
ADR-0020(migrations). Docs: `docs/capabilities/workspace-write.md`.

## ADR-0028 — CAP-007 Command Execution Capability (run, gated)

- **Status:** ✅ Accepted (v2, Sprint 2g)
- **Date:** 2026-06-30
- **Capability:** CAP-007 — Command Execution. **The riskiest capability** (arbitrary
  process execution) and the **last aggregate of the Execution Ledger**. Owns the
  `CommandExecution` Execution-History aggregate.

### Most important rule
> **Workspace Write applies files. Command Execution runs commands.** Command Execution
> runs ONE command inside a workspace via an argv array (never a shell); it never edits
> files, generates patches, calls git, or calls AI. Every run passes three deterministic
> gates BEFORE the runner is invoked.

### Decision
- **Owns `CommandExecution`** (+ `CommandExecutionRef`, `CommandExecutionStatus`). Mutates
  only this aggregate. **Never mutates** `ExecutionPlan`/`ApprovalRequest`/`PatchSet`/
  `WorkspaceChange` (Aggregate Ownership Rule, ADR-0025) — references via Refs.
- **Run flow:** `CommandExecutionManager.run({ executionPlanRef, approvalRef?, workspaceRef,
  workspaceChangeRef?, command, args, timeoutMs? })` → three gates → `CommandRunner`
  (port/adapter) → record a `CommandExecution`.
- **Execution Ledger:** `ExecutionPlan → ApprovalRequest → PatchSet → WorkspaceChange →
  CommandExecution`. CommandExecution may reference the `WorkspaceChange` it follows.
- **Adapter isolation:** all process execution in `@chunsik/command-local`
  (`node:child_process`, **argv array, `shell:false`, required timeout, cwd = workspace
  root, minimal env by default, masked + size-capped output**). **Core stays `child_process`-free.**
- **Four-part execution-safety boundary** (CA Architecture Note): (1) command allow-list,
  (2) dangerous-arg blocking, (3) minimal child env, (4) output masking + size cap.
- **`runCommand` relocated off `WorkspaceProvider`** → the `CommandRunner` port (mirrors the
  CAP-002 `gitStatus` move). Workspace ≠ Command Execution.

### CA Planning-review — Merge-Blocking changes (Round 1)
- **MB-1 Command Identity.** `CommandExecution.commandHash` = a deterministic content hash
  of `command` + `args` (pure `contentHash`, no `node:crypto`). The Execution History
  identifies EXACTLY what ran — the basis for audit / duplicate detection / resume, and for
  a future Execution Orchestrator's retry. (Reuses the CAP-006 revision-contract pattern.)
- **MB-2 Approval policy (deterministic, Ref-only).** `RiskPolicy.assessCommand` classifies
  the command: **LOW/MEDIUM → no approval**; **HIGH → an APPROVED, plan-scoped `ApprovalRef`
  is required** (referential integrity: `approvalRef.executionPlanRef.id === executionPlanRef.id`,
  no `ApprovalManager` query); **CRITICAL (destructive pattern) → refused outright, regardless
  of approval.**
- **MB-3 Allow-list.** v2 permits only **`pnpm` / `npm` / `node`** (exact match, fails closed —
  e.g. `/usr/bin/node` and `git` are refused). Enforced in the manager BEFORE the runner runs.

### CA Implementation-review — Merge-Blocking changes (Round 2)
- **Minimal child env (not full `process.env`).** The runner must NOT pass the full parent
  environment to a child by default (an allow-listed `node` could read local secrets, e.g.
  `node -e "console.log(process.env)"`). `defaultRawRunner` passes a **minimal env (PATH/HOME)**
  when none is supplied; callers may override with an explicit allow-listed env. Contract:
  *Command Execution must not pass the full parent process environment to child processes by default.*
- **Allow-list is command + dangerous-arg aware (not command-name only).** A command-name-only
  allow-list is bypassable via eval-style flags (`node -e "…"` runs arbitrary JS). The manager
  refuses eval-style `node` args (`-e` / `--eval` / `-p` / `--print`, incl. `=value` and short
  clusters like `-pe`) BEFORE the runner. Contract: *Allow-list must be command + dangerous-arg
  aware, not command-name only.*

### Non-blocking (CA-confirmed; NOT implemented now)
ExitCode-as-Value-Object (kept a plain `number`, structure open); explicit Runner →
CommandResult → CommandExecution responsibility split (already separated); streaming output
(future ADR); **retry (Execution Orchestrator's responsibility, not CAP-007)**; background /
long-lived processes (out of scope); a higher Execution-History aggregate; externalizing the
command policy (allow-list / env) to config. (Round-2 review confirmed these stay deferred.)

### Consequences
- + A complete, auditable, identity-stamped execution record; the project's primary
  execution-safety boundary (no shell, allow-list, risk + approval gating, masked output).
- + Reuses `CommandResult` (CAP-001), `RiskPolicy.assessCommand`/`requiresApproval`, the
  ADR-0020 migration runner (v5 `command_executions`), and the secret-masking approach.
- − Allow-list + CRITICAL refusal are conservative by design; widening them is a future
  policy decision (config/per-project), not a code change to the gate.

### Capability / Relations
**CAP-007.** Relates: ADR-0027(Workspace Write), ADR-0026(Patch), ADR-0025(Approval/Ownership),
ADR-0023(Git relocation precedent), ADR-0020(migrations). Docs:
`docs/capabilities/command-execution.md`.

## ADR-0029 — CAP-008 AI Code Generation Capability (Codex; propose, never apply)

- **Status:** ✅ Accepted (v2, Sprint 2h)
- **Date:** 2026-06-30
- **Capability:** CAP-008 — AI Code Generation. **The first AI Layer capability.** "Codex" is
  the first *provider*; the capability is provider-agnostic. Owns the `CodeGeneration` (run) and
  `CodeProposal` (output) aggregates.

### Most important rule
> **The AI proposes; it does not decide, approve, apply, or execute.** AI Code Generation asks a
> code-capable provider to author a **proposal** (`ProposedChange[]`); Decision/Approval/Apply/
> Execution stay with the existing capabilities (Planning/Approval/Patch/Workspace Write/Command).
> The AI is never a source of truth.

### Decision
- **Owns `CodeGeneration` (run) + `CodeProposal` (output)** — the AI Layer owns BOTH (CA Round-1).
  `CodeGeneration` holds only a `CodeProposalRef`; the heavy data (`ProposedChange[]`, providerId,
  usage?, artifacts?) lives on `CodeProposal`. Mutates only these; references plan/workspace via Refs.
- **Generate flow:** `PromptComposer` (authorship) → `PromptSpec` → **`PromptRenderer`** (rendering)
  → **`AiRequest`** → (`ProviderSelector`) → `AiProvider.execute` → parse → `CodeGeneration`
  (+ `CodeProposal`). Exactly ONE generation per call (no retry — Orchestrator's concern).
- **Reuses the `AiProvider` port, input narrowed to `AiRequest` (CA Round-1 MB-2):** the provider
  no longer renders prompts or sees a `PromptSpec`; rendering moved from the CLI adapter
  (`renderPromptSpec`) to the core `PromptRenderer`.
- **Codex adapter execution is DEFERRED (implementation-review MB-1).** `CodexCliProvider.execute()`
  stays **NotImplemented**: the Codex CLI has no deterministic suggest-only / no-tool / no-exec mode
  (`codex exec --sandbox read-only` is read-only AGENT execution — a tool loop — not proposal-only),
  which would cross the CAP-008 boundary. Because `isAvailable()` also throws, the provider is
  treated as unavailable and never selected. Real Codex execution awaits a verified suggest-only
  contract (future PR / Agent Runtime). The capability is provider-agnostic and runs on any
  suggest-only `AiProvider` (proven via a fake provider in tests).
- **No workspace bypass (implementation-review MB-2).** The AI Code Generation `AiRequest` carries
  **no workspace cwd** — handing a provider the workspace root would let it read/traverse the repo
  itself, bypassing the Workspace Read capability (CAP-001). Read-only context flows only via
  `contextFiles`/`prompt`; the `workspaceRef` is recorded on the aggregate but never given to the
  provider. Direct workspace access is future Agent-Runtime scope.
- **`ProviderSelector` (CA Round-1 MB-3):** provider selection extracted from `CapabilityRouter`
  (now its implementation, method `select`); the capability depends on the selection contract.
- **Provider-agnostic proposal parsing** in core (`parseCodeProposal`): one fenced ```json
  envelope → `ProposedChange[]`; malformed output → FAILED. Identical for Codex and Ollama.
- **Adapter isolation:** the provider owns all external AI interaction (process/auth/timeout/
  transport-retry/masking/failure classification, ADR-0015). **Core stays HTTP/`child_process`-free.**
- **Persistence:** `CodeGenerationRepository` + `CodeProposalRepository` + Sqlite + **migration v6**
  (`code_generations`, `code_proposals`).

### AI-Layer Aggregate Ownership Rule (CA Round-1 MB-4)
> Planning owns ExecutionPlan · Approval owns ApprovalRequest · Patch owns PatchSet ·
> Workspace owns WorkspaceChange · Command owns CommandExecution ·
> **AI owns CodeGeneration (and CodeProposal)** · **AI never owns any downstream aggregate.**

### Non-blocking (CA-confirmed; NOT implemented now)
`generationHash` (the planned `promptHash` was dropped), `providerVersion`/`modelVersion`,
Proposal Lifecycle, Prompt Version; Provider Cost, Token Usage accounting (`CodeProposal.usage?`
is a reserved passthrough only), Provider Capability modelling, Failure-Taxonomy extension;
tool-calling/agentic loops, conversation state, generation-level retry, streaming.

### Consequences
- + A clean, provider-agnostic AI Code Generation seam (Codex now; Ollama adds only an adapter,
  CAP-009) with a strict propose-only boundary; reuses `AiProvider`/`ProviderSelector`/`PromptRenderer`,
  the ADR-0015 failure taxonomy, and the ADR-0020 migration runner (v6).
- − Narrowing `AiProvider` to `AiRequest` touched the existing Claude/chat path (rendering moved to
  `PromptRenderer`; orchestrator renders before `execute`); guarded by the regression suite.

### Capability / Relations
**CAP-008.** Relates: ADR-0014(CLI providers), ADR-0015(AI failure taxonomy), ADR-0003(prompt
layering), ADR-0024(Planning), ADR-0026(Patch), ADR-0025(Aggregate Ownership), ADR-0020(migrations).
Docs: `docs/capabilities/code-generation.md`.

## ADR-0030 — CAP-009 Ollama AI Code Generation Provider (second adapter; suggest-only)

- **Status:** ✅ Accepted (v2, Sprint 2i)
- **Date:** 2026-06-30
- **Scope:** CAP-009 is **not a new capability.** It is the **second `AiProvider` adapter** for the
  CAP-008 AI Code Generation capability (ADR-0029). It is the *proof* that the AI Layer contract is
  provider-agnostic: a different backend authors a `CodeProposal` with **no Core-contract change**.

### Most important rule
> **CAP-009 stays a Provider Adapter — never expand it into a new capability.** Ollama serves the
> existing AI Code Generation capability through the existing `AiProvider` port. No new aggregate,
> manager, port, repository, or migration. The AI still only *proposes*.

### Decision
- **Implement `OllamaCliProvider.execute(AiRequest)` + `isAvailable()`** in `@chunsik/ai-cli`,
  behind the **existing** `AiProvider` port (via `BaseCliAiProvider` + `CliRunner`). No Core change.
- **Suggest-only is honest for Ollama (the key distinction from Codex, ADR-0029).** `ollama run
  <model>` is **single-shot text generation** — no tools, no exec, no file access, no plan-act
  loop — so it cannot autonomously act and satisfies the propose-only boundary by construction.
  (Codex's CLI has no deterministic suggest-only mode → it stays NotImplemented/unavailable.)
- **Invocation:** `ollama run <model>` with the prompt on **stdin** (never an argv), in a
  **neutral cwd** (`tmpdir()`) — a local model never needs the repo and must not ingest it
  (defense in depth atop CAP-008's no-workspace `AiRequest`). Output masked (`maskSecrets`).
- **Failure taxonomy (ADR-0015):** `timedOut → TIMEOUT`; spawn failure (`code === null`) →
  `UNAVAILABLE`; non-zero exit → `EXECUTION_FAILED`; empty stdout → `EMPTY_OUTPUT`. **No
  `AUTH_REQUIRED`** — Ollama is local and auth-free.
- **Selection data:** Ollama advertises `CODE_IMPLEMENTATION` at **priority 40** — *below* Claude's
  50 — so Claude is preferred for code when available and Ollama is the local/offline fallback.
  (Codex advertises 100 but is unavailable, so it never competes.) Selection stays data-driven via
  `ProviderSelector`; Core never names `'ollama-cli'` or branches on `id`.
- **Wiring:** `OllamaCliProvider` is added to `AI_PROVIDERS` (`app.module.ts`), constructed from the
  existing `OLLAMA_CLI_BIN`/`OLLAMA_MODEL` config seam. **`isAvailable()`-gated:** an environment
  without `ollama` sees no runtime change (provider treated as unavailable, never selected).
- **`parseCodeProposal` is unchanged** — the provider-agnostic parser already handles Ollama output
  identically (CAP-008 parity).

### Runtime consequence (intentional, surfaced)
- Ollama already advertises `GENERAL_CHAT`/`SUMMARIZATION`/`EMBEDDING` at priority **100** (> Claude
  50, pre-existing data). Implementing `execute()` + wiring therefore means that **on a machine where
  `ollama` is available, the live chat/summarization path prefers Ollama** (local-first; Claude
  remains the fallback). These priorities are pre-existing and left unchanged (CA decision #5 keeps
  the `EMBEDDING` descriptor; the embedding *execution* path is out of scope). No environment without
  `ollama` is affected.

### Not implemented (CA-confirmed out of scope)
New capability/aggregate/manager/port/repository/migration; any Core-contract change; **any change to
Codex** (stays NotImplemented); tool calling, Agent Runtime, embedding/vector path, streaming, model-
pull UX, per-request model override, generation retry, orchestrator/Discord wiring of code generation.

### Consequences
- + A second, **local-first** code-generation provider behind the same contract — the
  provider-independence of CAP-008 is now demonstrated, not just asserted. Smallest capability
  increment in V2: one adapter method pair + one `capabilities[]` entry + one wiring line.
- − Where `ollama` is present, chat/summarization now route to it by priority (see Runtime
  consequence); guarded by the regression suite and `isAvailable()`.

### Capability / Relations
**CAP-009** (provider adapter for CAP-008). Relates: **ADR-0029**(CAP-008 AI Code Generation —
primary), ADR-0014(CLI providers), ADR-0015(AI failure taxonomy), ADR-0003(prompt layering).
Supersedes nothing. Docs: `docs/capabilities/code-generation.md`.

## ADR-0031 — Execution Orchestrator (Application-layer capability composition)

- **Status:** ✅ Accepted (v2, Phase 2, Sprint 2j)
- **Date:** 2026-07-01
- **Scope:** The **first Application-layer composition** (Phase 2). Phase 1 (Capability Layer,
  CAP-001…009) is closed. This is **not a new capability** — it composes the completed
  capabilities into one safe execution flow: `Intent Resolver → Execution Orchestrator →
  Capability Managers`. Planning review approved over two rounds (Round-1 Merge-Blocking:
  Capability Selection, ExecutionContext, Cancellation Contract — all applied; Round-2 APPROVED).

### Most important rule
> **The Execution Orchestrator composes capabilities; it never does their work, and it owns no
> aggregate.** Capability managers stay **mutually unaware** — only the orchestrator composes them.
> Provider selection stays with `ProviderSelector` (orchestration-level **Capability Selection** is
> a different concern: *which capability stages run*). It is intra-task composition — **not** the
> `Workflow` engine and **not** the Agent Runtime.

### Decision
- **Capability Selection is the orchestrator's first responsibility** (Round-1 MB-1). `selectStages`
  maps a request's `requiredCapabilities` to an **ordered subset** of the canonical stages
  (`PLANNING → CODE_GENERATION → WORKSPACE_DIFF → APPROVAL → PATCH → WORKSPACE_WRITE →
  COMMAND_EXECUTION`); a given execution runs **only** the selected stages. The pipeline is
  **dynamic, not fixed** (analyze-only → `[PLANNING]`; run-tests → `[PLANNING, APPROVAL,
  COMMAND_EXECUTION]`; code-change → the full chain).
- **Stateless / aggregate-free** (CA-confirmed). No `ExecutionFlow` aggregate, no table, no
  repository. The `ExecutionPlan` is the **correlation root** (every downstream aggregate carries
  `executionPlanRef`); progress is derived from the capabilities' aggregates. The orchestrator
  returns a **transient `ExecutionOutcome`** read-model and persists nothing.
- **Ref-threading composition.** Each stage calls one existing manager and passes the Ref the next
  consumer needs (`ExecutionPlanRef`, plan-scoped `ApprovalRef`, `ProposedChange[]` + `WorkspaceDiff`,
  `PatchSet`, `WorkspaceChange`). The orchestrator depends on **narrow public method interfaces**, not
  concrete managers; managers never import each other.
- **ExecutionContext** (Round-1 MB-2): a transient, per-invocation Application-layer context
  (`executionPlanRef`, `workspaceRef`, `projectId`, `requestedBy`, `selectedStages`, `logger`,
  `cancelToken?`). **Not an aggregate, never persisted**, rebuilt on each `run`/`resume`.
- **Approval halt + resume** (CA-confirmed). When `ApprovalManager.requestFor` returns PENDING
  (HIGH/CRITICAL), the orchestrator returns `AWAITING_APPROVAL` and **halts** — it **never calls
  `decide`**. `resume(request, priorOutcome, cancelToken?)` re-reads the approval aggregate and, only
  if APPROVED, reconstructs the proposal/diff from refs and runs Patch→Write→Command; PENDING ⇒
  re-halt, REJECTED ⇒ `DENIED`. Resume **wiring** (who triggers it) is deferred (Conversation Runtime).
- **Cancellation Contract** (Round-1 MB-3). `RUNNING → CANCELLED → TERMINAL`: a cooperative
  `cancelToken` is checked at each **stage boundary** (and during the approval wait); on signal the
  orchestrator **stops without calling the next capability** and returns `CANCELLED`. **No
  compensation/rollback** — already-applied changes remain. `CANCELLED` lives on `ExecutionOutcome`
  only; **no capability aggregate** gains a cancelled status from the orchestrator.
- **Failure rule.** A failed stage (a FAILED/!success aggregate status, or a thrown manager error) ⇒
  `STOPPED_ON_FAILURE` naming the stage; the next capability is **not** called. **No retry** (the
  future Agent Runtime's concern).
- **Intent Resolver** (Application service): maps a classified `Intent` (execution capabilities only)
  to an `ExecutionRequest`, else `null`. It does not classify (`IntentClassifier`) or plan (Planning).

### Not implemented (CA-confirmed out of scope)
Workflow Engine · Conversation Runtime · Agent Runtime · Retry · Event Bus · Parallel Execution ·
Telemetry · Memory · Discord Integration. Also **not** wired into `ChunsikCore`/composition root yet
(standalone Application services; wiring is the future Conversation Runtime slice). **Non-blocking
(future):** Execution Hooks (`beforeCapability`/`afterCapability`); ExecutionOutcome-based pipeline
visualization (a Presentation-layer concern).

### Consequences
- + The Execution Ledger capabilities (CAP-003…009), previously unwired, now have a safe
  composition layer — the first step toward an end-to-end flow — with no Core-contract change and no
  new aggregate.
- − Resume/cancel are contracts without runtime wiring yet (no UI signals them); covered by
  fake-manager tests, exercised end-to-end only once the Conversation Runtime lands.

### Capability / Relations
**Sprint 2j** (Application Layer; not a capability). Relates: ADR-0024(Planning), ADR-0025(Approval +
Aggregate Ownership), ADR-0026(Patch), ADR-0027(Workspace Write), ADR-0028(Command Execution),
ADR-0029(AI Code Generation), ADR-0013(YAGNI on `Workflow`/seams). Supersedes nothing.
Plan: `docs/plans/sprint-2j-execution-orchestrator-plan.md`.

## ADR-0032 — Conversation Runtime (Application-Layer runtime entry; stateless composition)

- **Status:** ✅ Accepted (v2, Phase 2, Sprint 2k — first **Product Construction** sprint)
- **Date:** 2026-07-01
- **Scope:** The **conversation entry point** of 춘식봇 — an Application-Layer Runtime that turns one
  user message into one natural assistant response by **composing** existing Application/Capability
  services. It is **not** a new execution engine, **not** a Capability, and **not** a new Aggregate.

### Invariants (must always hold)
> - **Conversation Runtime must not persist runtime state.**
> - **Approval-awaiting state is derived from existing Session / Task / ExecutionPlan / ApprovalRequest state.**
> - **Session must not store runtime snapshots.**

### Decision
- **Runtime entry / `ChunsikCore` relationship.** `ConversationRuntime` owns the full per-message
  flow; **`ChunsikCore` is a thin facade** that delegates to it and performs platform delivery:
  `Platform Adapter → ChunsikCore (facade) → ConversationRuntime.handle() → OutboundMessage → ChunsikCore delivers`.
  There is exactly ONE entry — no parallel `ChunsikCore`/`ConversationRuntime` paths.
- **Owns (flow + transient state only):** per-message flow; Session open/touch ordering; short-term
  memory record order; intent branching; **approval halt/resume routing**; outcome→response mapping;
  a **transient** `TurnResult`. **Does NOT own:** capability execution, approval policy, planning,
  patch, workspace mutation, command execution, provider selection, retry, autonomous loops, or any
  **persistent** runtime state. It is a **composer**, never a decider/executor.
- **Full conversational flow ownership.** One runtime branches internally across: chat ·
  project-analysis · register · execution · approval-resume · failure/cancel response. The user
  experiences a conversational assistant, not an "execution runtime".
- **Transient runtime model (NO new aggregate).** `RuntimeTurnStatus =
  RESPONDED | AWAITING_APPROVAL | DENIED | FAILED | CANCELLED`; `ConversationRuntime.handle(message:
  InboundMessage): Promise<TurnResult>`; `TurnResult` carries the status + the `OutboundMessage` +
  `sessionId` (+ optional `ExecutionOutcome`). **No `Turn`/`Conversation`/`Message` aggregate, no
  `RuntimeState` table, no `TurnRepository`, no migration.**
- **Stateless approval resume — fixed correlation source (the ONE source):**
  `Session.activeTaskId → Task.planId → approvals.findByExecutionPlan(planId) → PENDING ApprovalRequest`.
  An execution turn that halts anchors itself to the in-focus `Task` (existing `Task.planId` =
  the produced `ExecutionPlan` id; existing `Session.activeTaskId` = that task). The runtime
  **persists nothing itself** and stores **no snapshot on `Session`**; it re-derives the pending
  approval from these existing aggregates each turn (via the injected `ApprovalFlow` collaborator).
  Forbidden: `Session.runtimeState`, approval snapshot on `Session`, a `ConversationRuntimeState`
  repository, or recovering pending approval by parsing memory text.
- **`StatelessApprovalFlow` (production `ApprovalFlow`).** On a halt it **anchors** the in-flight
  `{request, prior}` on the in-focus **`Task.metadata`** (the Task capability's own field — not a
  Session snapshot, no new store) with `Task.planId` = the plan id, and points `Session.activeTaskId`
  at it. `reconstructResume` reads that back (validating `Task.planId === approval.executionPlanRef.id`)
  to supply the `{request, prior}` that `ExecutionOrchestrator.resume` requires — so resume is
  genuinely functional (no orchestrator-contract change). The approve path **reconstructs FIRST and
  only calls `ApprovalManager.decide` once reconstruction succeeds** — never record a decision that
  cannot be acted on; if reconstruction fails the runtime re-asks.
- **Approval-decision interpretation (only when pending).** The runtime interprets a user message as
  an approval decision **only** when a PENDING approval is derived for the session. Minimal,
  platform-agnostic contract: approve = {승인, 진행, 좋아, yes, y, ok}; deny = {거절, 아니, no, n};
  cancel = {취소, 중단, 그만}; otherwise **ambiguous** → re-send the approval notice, **no `resume`**.
  When pending, the decision interpretation takes priority over normal intent; with no pending
  approval, those same words are ordinary intent. The decision itself is owned by
  `ApprovalManager.decide`; resume goes through `ExecutionOrchestrator.resume` (its contract is
  **unchanged** — the runtime supplies `{request, prior}` via the injected `reconstructResume`
  collaborator). The runtime never judges approval policy; the orchestrator never parses the message.
- **Short-term memory only.** Reuse existing short-term conversation memory: record the user turn,
  record the assistant turn, read history, request context via `ContextBuilder`. **No** long-term /
  vector / working memory, no memory repository/schema/format change.
- **Platform delivery boundary.** The runtime's essential output is an **`OutboundMessage`**;
  platform-specific delivery stays **outside** the runtime (the `ChunsikCore` facade calls
  `PlatformAdapter.sendMessage`).
- **ResponseComposer boundary.** The runtime never builds natural-language text; it maps outcomes via
  `ResponseComposer` (`composeExecutionResult` + `composeApprovalRequired` added this sprint, alongside
  `composeApprovalNotice` / `composeError` / `compose`). A fresh execution that halts at
  `AWAITING_APPROVAL` (only a plan-scoped ref in hand) replies via `composeApprovalRequired`.

### Not implemented (CA-confirmed out of scope)
Agent Runtime; Tool Calling; Retry / loop / reflection; Workflow Engine; Background Task; Discord UI
(buttons/interaction-ids); Telemetry/Metrics; any new memory subsystem; **new aggregate / repository
/ migration / capability**; any Core-contract change; any change to a capability manager or to the
`ExecutionOrchestrator` contract.

### Consequences
- + 춘식봇 has a single coherent conversation entry that composes the whole stack (chat → execution →
  approval → resume → response) with **no new structure** — the first Product-Construction step.
- − Cross-turn resume reconstruction (`StatelessApprovalFlow`) anchors `{request, prior}` on
  `Task.metadata`; the platform UI (approval buttons) and richer failure recovery mature with later
  Product sprints.

### Relations
ADR-0001 (Session, thin), ADR-0017 (short-term memory), ADR-0031 (Execution Orchestrator),
ADR-0025 (Approval), ADR-0015 (failure taxonomy / kind replies), ADR-0003 (prompt/context layering).
Supersedes nothing. Plan: `docs/plans/sprint-2k-conversation-runtime-plan.md`.

## ADR-0033 — Live Test Execution (first reachable execution Product slice)

- **Status:** ✅ Accepted (v2, Phase 2, Sprint 2l — Product Construction)
- **Date:** 2026-07-01
- **Scope:** Open the (already-built but unreachable) execution pipeline for the smallest, safest
  Product slice: a user asking to run tests. **Reuse only** — no new capability/aggregate/repository/
  migration, no Core or `ExecutionOrchestrator` contract change.

### Most important rule
> **Only two fixed, allow-listed commands are ever produced — `pnpm test` and `pnpm typecheck`.** The
> bot never runs a user-supplied command, a shell string, or a synthesized command; the classifier
> emits only an intent + a `raw.kind` tag, and the resolver maps that tag to one of the two commands.

### Decision
- **First reachable execution slice.** `IntentClassifier` gains deterministic **`RUN_TESTS`**
  recognition (same style as REGISTER_PROJECT / PROJECT_ANALYSIS) → `IntentType.RUN_TESTS` +
  `Capability.TEST_EXECUTION` (both **reused**, no new enum) + `raw.kind: 'test' | 'typecheck'`.
- **Command ownership.** The classifier emits **intent + `raw.kind` only**; the **`IntentResolver`
  owns the fixed command mapping**: `typecheck → ['pnpm','typecheck']`, else `['pnpm','test']`. No
  user text is ever concatenated into a command; the `CommandExecution` allow-list re-checks it.
- **Workspace.** An active project is **required**. `ConversationRuntime` reads
  `session.activeProjectId`, loads the `Project` (`storage.projects.get`), and resolves the
  `WorkspaceRef` via the **existing `WorkspaceManager.open`** (workspace ownership stays with the
  Workspace capability), passing it into the resolver context / `ExecutionRequest.workspaceRef`.
- **Risk (CA change #1).** `pnpm test`/`pnpm typecheck` are **bounded, allow-listed project commands.
  They are lower-risk than patch/write/deploy commands, but NOT guaranteed non-mutating** — a package
  script may execute arbitrary project-defined logic. **Risk level: MEDIUM; approval halt: not
  required** for Sprint 2l (user-requested local project command, allow-listed shape, active project
  required, no bot-generated arbitrary command). `RiskPolicy`/`ApprovalManager` unchanged.
- **Result framing (CA change #2 + Q5).** `ConversationRuntime` may frame TEST_EXECUTION output by
  reading the existing `CommandExecution` result **through an existing application read path**
  (`CommandExecutionManager.get(refs.commandExecutionId)`). It introduces **no new repository/port**
  and does **not** change the `ExecutionOrchestrator` contract or move `CommandExecution` ownership.
  - Command **ran** with a clean exit → a **product test result**: `SUCCEEDED` (exit 0) → tests
    passed; `FAILED` (exit ≠ 0) → tests failed — **reported as a result, not a bot/system error.**
  - Command **could not run** (`TIMED_OUT`, allow-list refusal, workspace-open failure, spawn/system
    error) → an **execution/system-failure** reply.
- **ResponseComposer boundary.** The runtime builds **no** user-facing text. Added (minimal):
  `composeTestResult`, `composeNeedsProject`, `composeWorkspaceUnavailable`, `composeCommandUnavailable`.

### Not implemented (out of scope)
Code change · patch · workspace write · AI code-generation live execution · Agent Runtime ·
tool-calling loop · retry/reflection · Discord UI · telemetry · new capability/aggregate/repository/
migration · Core-contract change · `ExecutionOrchestrator` contract change · free-form/AI-generated/
shell commands.

### Consequences
- + First time a user's message ("테스트 돌려줘") flows all the way through
  `Runtime → Orchestrator → CommandExecution` to a real action + natural result — the pipeline is now
  reachable, with the smallest safe slice.
- − Test execution runs project-defined scripts (bounded but not provably side-effect-free); mitigated
  by the fixed allow-listed command shape, MEDIUM risk, and active-project requirement.

### Relations
ADR-0032 (Conversation Runtime), ADR-0031 (Execution Orchestrator), ADR-0028 (Command Execution /
allow-list), ADR-0024 (Planning), ADR-0025 (Approval), ADR-0015 (failure taxonomy / kind replies),
ADR-0018 (project registration). Supersedes nothing. Plan:
`docs/plans/sprint-2l-live-test-execution-plan.md`.

## ADR-0034 — Test Result Detail UX (CommandExecution facts → useful reply)

- **Status:** ✅ Accepted (v2, Phase 2, Sprint 2m — Product Construction), Chief Architect Review:
  APPROVED WITH CHANGES.
- **Date:** 2026-07-01
- **Scope:** Sprint 2m is **result-detail UX, not command expansion**. `CommandExecution` (Sprint 2l,
  ADR-0028/0033) already carries `command`, `args`, `exitCode`, `stdout`, `stderr`, `durationMs`,
  `status`; the user-facing reply only used `status` + `args`. This sprint spends the already-existing
  facts on a safer, more useful reply — no new read path, no command-surface change.

### Decision
- **`TestResultDetail` is an Application-layer DTO, not domain.** Defined in `response-composer.ts`
  alongside the existing `ExecutionReplyStatus` local type — not persisted, not an aggregate, no
  `CommandExecutionStatus` inside it (status stays a Runtime branch concern, never re-interpreted by
  the Composer).
- **Runtime frames raw facts only.** `ConversationRuntime.frameTestResult` decides which of three
  cases applies (`SUCCEEDED`/`FAILED` → ran; `TIMED_OUT` → killed; no `CommandExecution` → never ran)
  and assembles `TestResultDetail` from the aggregate it already reads. It performs **no** string
  truncation and writes **no** text.
- **`ResponseComposer` owns summarization and all wording**, including the excerpt cut, stream
  choice, duration formatting, and Korean phrasing — consistent with the ADR-0032 invariant that
  reply text is built only by `ResponseComposer`.
- **Output-stream choice:** prefer `stdout`; fall back to `stderr` only if `stdout` is empty — a
  single stream, never merged. **CA-required:** when `stdout` is chosen and `stderr` is also
  non-empty, the reply says so (`"stderr 출력도 있었지만, 여기서는 stdout 마지막 부분만 보여드려요."`)
  — stdout-preference must never make stderr's existence invisible.
- **Summary bound:** last `MAX_SUMMARY_LINES = 20` lines, then capped at `MAX_SUMMARY_CHARS = 1200`
  chars (tail preserved either way) — headroom under Discord's 2000-char message limit. The full
  rendered reply is additionally defended at `MAX_MESSAGE_CHARS = 1900`.
- **No second masking pass.** `packages/command-local`'s `maskCommandOutput` (ADR-0028) already
  redacts secret-shaped substrings and caps each stream at 100k chars **before** `CommandExecution`
  is ever populated. This sprint's summarization is a length transform only, over already-safe text.
  **CA-required constraint:** the reply must never assert a completeness/security guarantee (no
  "전체 로그는 안전합니다" / "민감정보는 완전히 제거됐습니다" wording) — we trust the boundary
  internally but do not claim it to the user.
- **Timeout is not a test failure.** `composeTestTimedOut` (new) never phrases a `TIMED_OUT` run as
  "테스트 실패", never shows an exit code (none exists — the process was killed, not evaluated), and
  never claims a "configured timeout" value (`TestResultDetail` carries only the actual elapsed
  `durationMs`, not the limit that was set).
- **`ResponseComposer` API change.** `composeTestResult(context, passed, kind)` →
  `composeTestResult(context, detail: TestResultDetail & { passed: boolean })` (single call site,
  changed directly, no back-compat shim). New: `composeTestTimedOut(context, detail)`.
  `composeCommandUnavailable` is unchanged — it remains the reply for the one case with no facts to
  show (command never ran at all).
- **No Core/Orchestrator contract change; no new aggregate/repository/migration/capability/port.**

### Not implemented (out of scope)
Command-surface expansion · user-supplied command · shell string · arbitrary/AI-generated command or
summary · retry · patch/write/code modification · GitHub Actions integration · Discord rich UI · new
aggregate/repository/migration/capability/port · Core-contract change · `ExecutionOrchestrator`
contract change.

### Consequences
- + A user running tests/typecheck now sees command, exit code, duration, and a bounded, safe
  excerpt of the actual output — not just pass/fail — while a killed (`TIMED_OUT`) run is clearly
  distinguished from a failing test.
- − The reply is longer per turn; bounded by `MAX_MESSAGE_CHARS` to stay within the Discord limit.

### Relations
ADR-0033 (Live Test Execution), ADR-0032 (Conversation Runtime), ADR-0028 (Command Execution /
masking-and-capping). Supersedes nothing (extends ADR-0033's `composeTestResult`/`frameTestResult`).
Plan: `docs/plans/sprint-2m-test-result-detail-ux-plan.md`.

## ADR-0035 — Live Code Change Planning (code-change intent → Planning/Approval halt, no mutation)

- **Status:** ✅ Accepted (v2, Phase 2, Sprint 2n — Product Construction), Chief Architect Review:
  APPROVED WITH CHANGES (Round 1).
- **Date:** 2026-07-01
- **Scope:** Sprint 2n is **live code-change planning, not live code-change execution.** It opens the
  (already-built but unreachable) `CODE_IMPLEMENTATION` pipeline to a real user intent for the first
  time, and stops it at `Planning → Approval → AWAITING_APPROVAL` — no AI Code Generation, no
  `WorkspaceDiff`, no `Patch`, no `WorkspaceWrite`, no `CommandExecution`.

### Most important rule
> **A code-change request never mutates anything this sprint.** Not because it is denied at the last
> moment, but because `CODE_GENERATION`/`WORKSPACE_DIFF`/`PATCH`/`WORKSPACE_WRITE`/`COMMAND_EXECUTION`
> are never selected into the pipeline for this request in the first place — the no-mutation guarantee
> rests on **stage selection**, not on the risk/approval gate alone (which is a second, reinforcing
> layer, not the only one).

### Decision
- **Reused, no new enum.** `IntentType.IMPLEMENT_CODE` + `Capability.CODE_IMPLEMENTATION` — both
  pre-existing (Sprint 2j) and already load-bearing in `IntentResolver.EXECUTION_CAPABILITIES`,
  `ConversationRuntime.needsWorkspace`, and `ExecutionOrchestrator.selectStages`, but never reachable
  because `IntentClassifier` never emitted `IMPLEMENT_CODE`.
- **Classifier stays command/codegen-free.** `IntentClassifier` gains deterministic code-change
  detection (same style as `RUN_TESTS`/`REGISTER_PROJECT`) → `IntentType.IMPLEMENT_CODE` +
  `Capability.CODE_IMPLEMENTATION` + `raw.kind: 'fix' | 'change' | 'refactor'`. The classifier never
  produces an implementation instruction, a target-file guess, a patch hint, or a command — only a
  classification tag, same shape/spirit as ADR-0033's `raw.kind`.
- **`planningOnly` — a narrow, single-purpose execution mode, not a general stage-override system.**
  `ExecutionRequest` gains one optional field, `planningOnly?: boolean`. When set, `selectStages`
  selects `[PLANNING, APPROVAL]` only for a `CODE_IMPLEMENTATION` request — `CODE_GENERATION`,
  `WORKSPACE_DIFF`, `PATCH`, `WORKSPACE_WRITE`, `COMMAND_EXECUTION` are never included. When unset
  (every existing caller/test), behavior is byte-for-byte identical to the pre-Sprint-2n pipeline.
  **Constraint (binding on all future changes):** `planningOnly` may be set **only** by
  `IntentResolver`, and **only** when `intent.capability === Capability.CODE_IMPLEMENTATION` on this
  live code-change-planning path. It must never be set from user input, never by `IntentClassifier`,
  and must never be generalized into an arbitrary-capability or externally-controlled stage override.
  Any future change that widens its scope must revisit this ADR.
- **`RiskPolicy.CAPABILITY_RISK[CODE_IMPLEMENTATION]`: `MEDIUM → HIGH`.** This is a **global policy
  change** (`RiskPolicy` is shared/capability-agnostic, ADR-0024/0025), not a capability-ownership
  change. Rationale: `CODE_IMPLEMENTATION` is `HIGH` by default because even suggest-only or
  planning-stage code-change requests are precursors to mutation. `TEST_EXECUTION` remains `MEDIUM`
  (Sprint 2l, unaffected). This makes `ApprovalPolicy.evaluate` return `requiresApproval: true` for
  any `CODE_IMPLEMENTATION` plan, so `ApprovalManager.requestFor` creates a `PENDING` (not
  auto-`APPROVED`) request, and `ExecutionOrchestrator.run` halts and returns `AWAITING_APPROVAL`.
- **Three-layer no-mutation guarantee — Layer 1 is the proof, Layers 2-3 are reinforcement:**
  1. **Stage selection (primary).** `PATCH`/`WORKSPACE_WRITE`/`COMMAND_EXECUTION` are absent from
     `selectedStages` for a `planningOnly` request — `runMutatingStages`'s `if
     (selectedStages.includes(STAGE))` guards make those calls unreachable code, independent of
     approval status.
  2. **Risk/Approval gate.** `CODE_IMPLEMENTATION` → `HIGH` → `PENDING` approval → `AWAITING_APPROVAL`
     halt before any mutating stage would have run, had one been selected.
  3. **Aggregate-level guard.** `PatchManager.generate`/`WorkspaceWriteManager.apply` both throw
     synchronously without an `APPROVED` `ApprovalRef`, regardless of stage selection.
- **Workspace resolution reused unchanged (ADR-0033 pattern).** `ConversationRuntime` reads
  `session.activeProjectId`, loads the `Project`, resolves the `WorkspaceRef` via the existing
  `WorkspaceManager.open` (read-only). No new mechanism.
- **Approval prompt is code-change-specific.** New `ResponseComposer.composeCodeChangeApprovalRequired`
  states that approval is required, that this is a code-change request, and that this stage does not
  modify any file yet — selected by `ConversationRuntime` (facts only: `intent.capability`) instead of
  the generic `composeApprovalRequired` used by other capabilities.
- **Approval resume never claims completion.** New `ResponseComposer.composePlanningOnlyApproved`
  replies to "승인" on a `planningOnly` request without implying code was fixed/generated/written —
  selected by `ConversationRuntime` when the resumed request's `planningOnly` flag is set, instead of
  the generic `composeExecutionResult('COMPLETED')`, which would otherwise be misleading (nothing
  mutates on this path). "거절"/"취소" are unaffected — they never claimed completion.
- **`ConversationRuntime` frames facts only; `ResponseComposer` owns all text (ADR-0032 §10,
  unchanged invariant).** Both new Runtime branches only select which composer method applies, based
  on facts already on hand (`intent.capability`, `request.planningOnly`) — no inline text, no new
  persisted state, no new aggregate.
- **No Core/Orchestrator contract change beyond the one additive, non-breaking `planningOnly` field.
  No new aggregate/repository/migration/capability/port.**

### Not implemented (out of scope)
AI Code Generation call · `ProviderSelector`/Claude/Ollama/Codex invocation · `WorkspaceDiff` ·
`Patch` generation · `WorkspaceWrite` · `CommandExecution` · file mutation · command execution ·
retry · agent loop · autonomous coding · Discord button UI · new aggregate/repository/migration/
capability/port · Core-contract change · a general-purpose execution-stage override system.

### Consequences
- + A user's code-change request ("이 버그 고쳐줘") now flows through `Runtime → Orchestrator →
  Planning → Approval` for the first time and halts safely — no code is ever touched, but the product
  surface for code-change requests now exists, ready for a future sprint to turn `planningOnly` off.
- + The no-mutation guarantee is structural (stage selection), not merely policy-based — a future
  regression in `RiskPolicy` alone cannot, by itself, cause a mutation on this path.
- − "승인" on a `planningOnly` request does nothing observable yet (by design) — `composePlanningOnlyApproved`
  makes this explicit to the user rather than implying completion.
- − `CODE_IMPLEMENTATION`'s risk escalation to `HIGH` is global; any future non-`planningOnly` caller of
  `CODE_IMPLEMENTATION` will also require human approval (intentional — see rationale above).

### Relations
ADR-0033 (Live Test Execution — `raw.kind` classifier pattern, workspace resolution), ADR-0032
(Conversation Runtime — text-ownership invariant), ADR-0031 (Execution Orchestrator — stage
selection), ADR-0025 (Approval Capability), ADR-0024 (Planning Capability). Supersedes nothing.
Plan: `docs/plans/sprint-2n-live-code-change-planning-plan.md`.

## ADR-0036 — Code Change Scope Collection (validated target file before Planning/Approval)

- **Status:** ✅ Accepted (v2, Phase 2, Sprint 2o — Product Construction), Chief Architect Review:
  APPROVED WITH CHANGES (Round 1).
- **Date:** 2026-07-01
- **Scope:** Sprint 2o is **scope collection, not code generation.** It inserts one gate in front of
  Sprint 2n's `IMPLEMENT_CODE → planningOnly → Planning → Approval` path: a code-change request must
  name a real, Workspace-validated target file before it may reach `ExecutionOrchestrator.run` at all.
  Insufficient scope creates **no** `ExecutionPlan` and **no** `ApprovalRequest` — the gate runs before
  the orchestrator is ever invoked, not inside it.

### Most important rule
> **The Workspace boundary is the authoritative security check, not the extraction regex.** Candidate
> extraction (`target-scope.ts`) is a permissive, best-effort heuristic; it may over-accept. The only
> thing that may ever populate `ExecutionRequest.targetFiles` is a path `WorkspaceManager.list` (CAP-001,
> ADR-0022) actually returned for the active project's workspace, verified by exact-match comparison —
> never the raw candidate string, and never trusted on `hits.length > 0` alone.

### Decision
- **Reused, no new enum/capability/port.** `IntentClassifier` stays target-free — it still only emits
  `IntentType.IMPLEMENT_CODE` + `Capability.CODE_IMPLEMENTATION` + `raw.kind` (ADR-0035), never a
  target guess. `IntentResolver.resolve()` is **unchanged** — it already forwarded
  `context.targetFiles` into `ExecutionRequest.targetFiles` before this sprint existed.
- **`target-scope.ts` is a pure Application-layer parser helper — not a capability, not a domain
  service, not a port/adapter/repository.** No class, no DI, no Workspace access, no AI. It exports
  `extractTargetPathCandidates` (deterministic, requires a `/` in the candidate — rejects bare
  filenames, `Node.js`, `e.g.`, `v1.2.3` at zero Workspace-call cost) and `normalizeRelativePath` (used
  only to verify an exact match between a candidate and a Workspace-returned hit).
- **`ConversationRuntime` owns the pre-execution scope gate.** Gated strictly on
  `intent.capability === Capability.CODE_IMPLEMENTATION`, inserted after the existing
  workspace-resolution step and before `IntentResolver.resolve()`. For each of up to
  `MAX_TARGET_CANDIDATES = 5` extracted candidates, it calls the existing `WorkspaceManager.list(ref,
  candidate)` and accepts a hit **only if** `normalizeRelativePath(hit) === normalizeRelativePath
  (candidate)` — `list()`'s glob semantics are never assumed to be exact-match. `targetFiles` is
  populated from the **Workspace-returned hit**, never the raw candidate.
- **No new Workspace port or capability.** `ConversationRuntimeDeps.workspace`'s narrow structural
  interface widens to include `list`, a method the real `WorkspaceManager` (CAP-001) already
  implements — this is a structural interface widening, not a new port, and required no DI change.
- **Insufficient scope stops before any Execution-layer aggregate exists.** No target validated →
  `ConversationRuntime` replies with `ResponseComposer.composeTargetScopeClarification` and returns —
  `IntentResolver.resolve()`, `ExecutionOrchestrator.run`, `ExecutionPlan`, and `ApprovalRequest` are
  all skipped entirely. Stronger than Sprint 2n's in-orchestrator halt: this halts before the
  orchestrator is ever called.
- **Clarification wording (CA-required) asks for a file path as the sufficient ask, not natural-
  language module/area text.** It also instructs the user to re-send the **full** request together
  with the path (e.g. "packages/core/src/application/foo.ts 파일에서 이 버그 고쳐줘") — compensating for
  the sprint's deliberate absence of multi-turn memory.
- **No multi-turn clarification-answer correlation this sprint.** Building one would need a new,
  persisted, stateless-correlation mechanism analogous to `ApprovalFlow` — but `ApprovalFlow` derives
  its state from an existing aggregate (`Task`/`ExecutionPlan`/`ApprovalRequest`), and an
  insufficient-scope request creates none of those. Inventing a new aggregate/repository/migration
  just to remember "a clarification is pending" is explicitly out of scope; the clarification wording
  compensates by teaching the correct single-turn shape instead.
- **`planningOnly` and `CODE_IMPLEMENTATION`'s `HIGH` risk (ADR-0035) are untouched.** A code-change
  request with a validated `targetFiles` still stops at `PLANNING → APPROVAL` — this sprint decides
  only *whether* a request may reach that point, never *what happens once it does*. No AI Code
  Generation, `WorkspaceDiff`, `Patch`, `WorkspaceWrite`, or `CommandExecution` this sprint.
- **No Core/Orchestrator contract change; no new aggregate/repository/migration/capability/port.**

### Not implemented (out of scope)
AI Code Generation · `ProviderSelector`/Claude/Ollama/Codex invocation · semantic search · repository
indexing · AI target-file guessing · directory scope · natural-language module/area text as sufficient
target · patch generation · `WorkspaceWrite` · command execution · retry · autonomous agent loop ·
Discord button UI · multi-turn clarification-answer persistence · new aggregate/repository/migration/
capability/port · Core-contract change · `ExecutionOrchestrator` contract change · a general-purpose
execution-stage override system.

### Consequences
- + A code-change request that names no real file now gets a specific, actionable clarification
  instead of silently reaching `AWAITING_APPROVAL` for an unknown target — closing a real Product gap
  Sprint 2n left open.
- + The no-mutation guarantee for an insufficient-scope request is even stronger than Sprint 2n's: the
  orchestrator is never invoked at all, not merely halted inside it.
- − No memory across turns: a bare follow-up reply naming only a path (no verb) is not recognized as
  answering the clarification — mitigated by wording that teaches the correct single-message shape,
  not by a new correlation mechanism.
- − Bare root-level filenames (e.g. `foo.ts`, `README.md`) are not accepted as sufficient scope this
  sprint — a deliberate, conservative exclusion, not a limitation of the underlying mechanism.

### Relations
ADR-0035 (Live Code Change Planning — `planningOnly`, `CODE_IMPLEMENTATION` risk, the halt this sprint
gates in front of), ADR-0032 (Conversation Runtime — text-ownership invariant), ADR-0022 (Workspace
Capability — the read-only sandbox this sprint's validation reuses entirely). Supersedes nothing.
Plan: `docs/plans/sprint-2o-code-change-scope-collection-plan.md`.

## ADR-0037 — Multi-turn Code Scope Clarification (Task reused as inert conversation anchor)

- **Status:** ✅ Accepted (v2, Phase 2, Sprint 2p — Product Construction), Chief Architect Review:
  APPROVED WITH CHANGES (Round 1).
- **Date:** 2026-07-01
- **Scope:** Sprint 2p is **multi-turn scope clarification, not code generation.** Sprint 2o already
  asks for a target file and stops when one is missing; this sprint makes the user's very next reply —
  even a bare file path with no verb — resume that same request, without inventing a new aggregate.

### Most important rule
> **The Task created by `ScopeClarificationFlow` is an inert conversation anchor, never an execution
> task.** It must never enter Planning, `ExecutionOrchestrator`, `Patch`, `WorkspaceWrite`, or
> `CommandExecution` by itself, and it is never transitioned past `TaskStatus.PENDING`. It exists
> solely to hold `PendingScopeClarification` facts across exactly one follow-up turn.

### Decision
- **No new aggregate/repository/migration/capability/port.** Four options were evaluated
  (`docs/plans/sprint-2p-multiturn-code-scope-clarification-plan.md` §2): a new Application-layer
  correlation model was rejected as needless duplication of an already-shipped pattern; short-term
  memory was rejected because recovering typed state by parsing free text is exactly what ADR-0032
  already forbade for the approval case; `Session.metadata` was rejected because ADR-0032 explicitly
  states *"Session must not store runtime snapshots."* `Task.metadata` was selected — `Task` is
  already the accepted pending-work anchor for `ConversationRuntime` (`StatelessApprovalFlow` already
  creates one purely to hold an anchor payload), and `Task.planId` is optional, so a Task can exist one
  step earlier than usual, before any `ExecutionPlan`.
- **Two independent signals distinguish the scope anchor from the approval anchor** — `planId`
  absence (structural) **and** an explicit metadata discriminator, `kind: 'code-scope-clarification'`
  (CA Round 1: `planId` absence alone was judged too implicit — a future feature could create an
  unrelated plan-less Task and be silently misread as a scope anchor). `findPending` and `clear` both
  require both signals before treating a Task as this flow's own.
- **`clear()` is safe by construction.** It routes through the same "is this our anchor?" check as
  `findPending` and is a no-op unless `session.activeTaskId` still points at a genuine
  scope-clarification anchor — it must never clear an approval anchor sharing the same pointer slot
  (CA Round 1).
- **Field naming avoids collision.** `PendingScopeClarification.kind` is the anchor discriminator;
  the classifier's intent tag is stored separately as `rawKind`. The two `kind`s are never the same
  field (CA Round 1).
- **`Session` stores only the `activeTaskId` pointer — never a snapshot.** Identical to the approval
  case (ADR-0032). `ConversationRuntime` never directly reads/writes `storage.tasks`/
  `storage.sessions` — `ScopeClarificationFlow` owns anchoring/derivation.
- **Ordering is load-bearing.** `ConversationRuntime.handle()` checks `approvalFlow.findPending` first,
  `scopeClarificationFlow.findPending` second, and only then classifies. An approval-pending session
  can never be routed into scope-clarification handling.
- **Anchoring is tightly scoped to one call site.** `scopeClarificationFlow.anchor` is called only from
  the existing Sprint 2o gate, only for a fresh `CODE_IMPLEMENTATION` request, only after an active
  project exists and the workspace opened successfully, and only when no candidate validated. It is
  never called for `TEST_EXECUTION`/`PROJECT_ANALYSIS`/`CHAT`, and never when there is no active
  project or the workspace failed to open.
- **Invalidation is next-turn-only — an explicit, documented Product trade-off, not an oversight.** The
  anchor is consumed unconditionally on the first follow-up check, regardless of outcome; an invalid
  reply does not re-anchor, so a third message is not recovered even if it is itself a valid bare path.
  Unbounded clarification retry would require a future plan. `createdAt` is stored for
  observability/future policy only — it is **not** used for expiration in Sprint 2p.
- **Project-change auto-clears the anchor.** If `session.activeProjectId` no longer matches the
  anchor's stored `projectId`, `findPending` clears it (via the same safe `clear()`) and returns
  `null` — the message is then handled as an ordinary fresh turn.
- **Recovery uses the original request's summary, never the follow-up's text.** The recovered
  `Intent.summary` is always `pending.summary` (the first message), so `ExecutionRequest.goal`/
  `instruction` reflect what the user originally asked for, not the file path they replied with.
- **A recovered, validated request enters the existing `planningOnly` flow unchanged** — reusing
  Sprint 2o's `extractTargetPathCandidates`/`WorkspaceManager.list`/`normalizeRelativePath` validation
  and the same shared `runResolvedExecution` tail a fresh sufficient-scope request already uses.
  `IntentResolver.resolve()`, `planningOnly` (ADR-0035), and `CODE_IMPLEMENTATION`'s `HIGH` risk
  (ADR-0036) are all unchanged.
- **New `ResponseComposer.composeScopeClarificationCancelled`.** Replaces reuse of the generic
  `composeExecutionResult('CANCELLED')`, whose "작업을 취소했어요" wording could be misread as
  cancelling an execution that never existed (CA Round 1). `ConversationRuntime` still builds no text
  of its own.
- **No Core/Orchestrator contract change; no new aggregate/repository/migration/capability/port.**

### Not implemented (out of scope)
AI Code Generation · `ProviderSelector`/Claude/Ollama/Codex invocation · semantic search · repository
indexing · AI target-file guessing · directory scope · module/area text as sufficient target ·
multi-file target selection · patch generation · `WorkspaceWrite` · command execution · retry loop ·
autonomous agent loop · Discord button UI · unbounded/persisted multi-turn clarification retry beyond
one follow-up · new aggregate/repository/migration/capability/port · Core-contract change ·
`ExecutionOrchestrator` contract change.

### Consequences
- + A bare file-path reply ("packages/core/src/application/foo.ts") now correctly resumes a code-
  change request that Sprint 2o would otherwise have silently dropped as ordinary chat.
- + The recovery mechanism is a direct generalization of an already-shipped, CA-approved pattern
  (`StatelessApprovalFlow`) rather than new infrastructure — no new aggregate, no new store.
- − Only one follow-up attempt is recovered; a second failed attempt requires the user to restate the
  full request, verb included. This is an intentional Product trade-off, not a bug.
- − Scope-clarification anchor Tasks, like approval-anchor Tasks before them, accumulate as inert
  historical records rather than being cleaned up — an accepted, pre-existing pattern (ADR-0032), not
  a new concern this sprint introduces.

### Relations
ADR-0036 (Code Change Scope Collection — the single-turn gate this sprint extends to two turns),
ADR-0035 (Live Code Change Planning — `planningOnly`, `CODE_IMPLEMENTATION` risk, both unchanged),
ADR-0032 (Conversation Runtime — `StatelessApprovalFlow`'s Task-anchor pattern, generalized here).
Supersedes nothing. Plan: `docs/plans/sprint-2p-multiturn-code-scope-clarification-plan.md`.

## ADR-0038 — AI Code Generation Preview (proposal text only, no Patch/Write)

- **Status:** ✅ Accepted (v2, Phase 2, Sprint 2q — Product Construction), Chief Architect Review:
  APPROVED WITH CHANGES (Round 1).
- **Date:** 2026-07-01
- **Scope:** Sprint 2q is **AI CodeGeneration preview, not Patch/Write.** After a user approves a
  `planningOnly` `CODE_IMPLEMENTATION` request, `ConversationRuntime` runs the existing AI Code
  Generation capability (CAP-008) once, in preview mode, and shows the proposed change as bounded
  text. No `Patch`, no `WorkspaceWrite`, no `CommandExecution`, no file mutation.

### Most important rule
> **`targetFiles` is the only allowed scope source, and it is untrusted from the AI's side.**
> `CodeGenerationManager.generate()` is called only when `executionPlanRef`, `workspaceRef`, and a
> non-empty `targetFiles` are all present. Whatever the AI proposes is then filtered against that same
> `targetFiles` set (normalized exact-match, not raw string comparison) — anything outside it is
> dropped from the rendered content and surfaced only as a warning. If nothing survives filtering, the
> turn is reported as a failure, never as a successful proposal.

### Decision
- **`ConversationRuntime` composes `CodeGenerationManager` directly — `ExecutionOrchestrator` is not
  touched.** `ExecutionOrchestrator.run()`'s stage order has always meant "`CODE_GENERATION`, if
  selected, runs before `APPROVAL`" (pre-approval authoring). Sprint 2q's preview runs *after*
  approval, with nothing following it — forcing this into the Orchestrator's stage-selection model
  would give `selectedStages` two different meanings depending on whether `run()` or `resume()` is
  executing it. `ConversationRuntime` is already an Application-layer composer of capability managers
  outside the Orchestrator (it already reads `CommandExecutionManager` directly for
  `frameTestResult`) — calling `CodeGenerationManager.generate()`/`getProposal()` directly is the same
  shape of composition. No new `ExecutionStage`, no `ExecutionOrchestrator` contract change, no
  resume-only stage override.
- **`planningOnly`'s meaning is unchanged — no rename.** It remains scoped to the Orchestrator:
  `ExecutionOrchestrator` selects `PLANNING`+`APPROVAL` only for a `planningOnly` request, exactly as
  ADR-0035 defined. The new preview step is a `ConversationRuntime`-level addition entirely outside
  that flag's scope of meaning.
- **Every guard is explicit, before any `generate()` call.** `executionPlanRef` (from the resume
  outcome), `workspaceRef`, and a **non-empty** `targetFiles` (both from the reconstructed
  `ExecutionRequest` — already anchored/reconstructed by `StatelessApprovalFlow`, zero new plumbing)
  must all be present. Missing any one of them means `generate()` is never called at all.
- **AI-proposed paths are untrusted; `targetFiles` is authoritative.** The proposal is filtered using
  the same `normalizeRelativePath` exact-match discipline Sprint 2o/2p already established for
  user-supplied paths — never a raw string comparison. The rendered path is always the validated
  `targetFiles` value, never the AI's raw string. Anything outside `targetFiles` is dropped from
  rendered content and surfaced only as a bounded warning list. **If every proposed path is out of
  scope, the turn is not presented as a successful preview** — a distinct
  `composeCodeGenerationPreviewNoValidChange` reply is used instead.
- **Preview text is bounded and safe against Markdown breakage.** Per-file excerpts are capped; the
  full rendered message reuses the existing `MAX_MESSAGE_CHARS`/`clampToMessageBudget` guard (ADR-0034);
  code fences are rendered with a backtick run longer than any backtick sequence already present in
  the (untrusted) AI content.
- **Preview text repeats, not merely mentions once, that nothing was applied.** Forbidden wording:
  "적용했어요"/"수정했어요"/"반영했어요"/"변경 완료" — anything that could read as a completed mutation.
- **Failure — including the all-out-of-scope case — reports `RuntimeTurnStatus.FAILED`, never
  `RESPONDED`.** A genuinely failed attempt to produce a usable preview must not look like an ordinary
  successful reply at the Runtime-status level. A successful preview's `TurnResult` preserves
  `executionOutcome`, matching every other successful execution-outcome reply in this codebase.
- **`composePlanningOnlyApproved` (ADR-0035) is retained but no longer reached in production** for an
  approved `planningOnly` `CODE_IMPLEMENTATION` request — the non-`COMPLETED` resume-outcome branch now
  calls the existing generic `replyForOutcome`, not `composePlanningOnlyApproved`. It is not deleted;
  its own tests still pass; becoming unreachable in production is an accepted, explicit consequence of
  this sprint, not an oversight.
- **No Core/Orchestrator contract change; no new aggregate/repository/migration/capability/port.**

### Not implemented (out of scope)
`Patch` generation · `PatchSet` application · `WorkspaceWrite` · file mutation · git mutation · command
execution · test execution after generation · retry loop · autonomous agent loop · directory scope ·
module scope as sufficient target · semantic repository search · repository indexing · AI target-file
guessing · multi-file selection · Discord button UI · `ExecutionOrchestrator` contract change ·
general-purpose execution-stage override system · `Core` contract change.

### Consequences
- + The AI Code Generation capability (CAP-008) is reachable from a live user turn for the first
  time, at the exact narrow boundary the product has been building toward since Sprint 2n — a
  proposal the user can read, never a mutation they didn't ask to apply.
- + The untrusted-output-vs-validated-scope pattern established in Sprint 2o/2p (regex extraction vs.
  Workspace) generalizes cleanly to AI output vs. `targetFiles`, reusing the same normalization
  primitive rather than inventing a second one.
- − `composePlanningOnlyApproved` becomes effectively dead code in production (still tested, not
  deleted) — an accepted, explicit trade-off rather than a cleanup left undone.
- − No unified-diff-style preview against current file content this sprint (would require a
  `WorkspaceManager.diff` read) — deferred as a low-risk future enhancement, not a limitation of the
  chosen design.

### Relations
ADR-0029 (AI Code Generation, CAP-008 — the capability this sprint finally activates), ADR-0035 (Live
Code Change Planning — `planningOnly`, unchanged), ADR-0036 (Code Change Scope Collection —
`normalizeRelativePath`, reused), ADR-0037 (Multi-turn Code Scope Clarification — `targetFiles`
preservation through approval resume, reused), ADR-0031 (Execution Orchestrator — the stage-selection
model this sprint deliberately does not extend), ADR-0034 (Test Result Detail UX —
`MAX_MESSAGE_CHARS`/`clampToMessageBudget`, reused). Supersedes nothing.
Plan: `docs/plans/sprint-2q-ai-code-generation-preview-plan.md`.

## ADR-0039 — Unified Diff Preview (current content vs. proposed content, still no Patch/Write)

- **Status:** ✅ Accepted (v2, Phase 2, Sprint 2r — Product Construction), Chief Architect Review:
  APPROVED WITH CHANGES (Round 1).
- **Date:** 2026-07-01
- **Scope:** Sprint 2r replaces Sprint 2q's plain-excerpt code-change preview with a **unified-diff-style**
  preview — current workspace file content vs. the AI's proposed content — for a successful in-scope
  proposal. Still preview only: no `Patch`, no `WorkspaceWrite`, no `CommandExecution`, no file mutation,
  no git mutation, no `ExecutionOrchestrator` change.

### Most important rule
> **The diff is computed deterministically from current workspace content and the AI's proposed
> content — never from AI- or provider-authored diff text — and only for paths already validated
> against `targetFiles`.** `ConversationRuntime` calls the existing `WorkspaceManager.diff()` (CAP-001,
> ADR-0022) directly with `filterInScopeChanges`'s in-scope subset only. Anything less than a clean,
> complete diff of every in-scope file — a missing current file (`changeKind: 'add'`), an empty result,
> or a read failure — is reported as a failed preview, never as a partial or degraded success.

### Decision
- **Reuses `WorkspaceManager.diff()`/`WorkspaceProvider.diff()` unchanged — no new capability, port, or
  provider.** This read already existed for `ExecutionOrchestrator`'s `WORKSPACE_DIFF` stage
  (pre-Approval, mutating flow); Sprint 2r is the first caller to reuse it for a post-approval,
  non-mutating preview. `ConversationRuntime` calls `workspace.diff()` directly, for the identical
  reason ADR-0038 gave for calling `CodeGenerationManager` directly: `planningOnly`'s `selectStages()`
  is `[PLANNING, APPROVAL]` only (ADR-0035) and never includes `WORKSPACE_DIFF`, so routing this through
  `ExecutionOrchestrator` would require a resume-only stage override — the same shape of problem
  ADR-0038 already rejected. No new `ExecutionStage`; `ExecutionOrchestrator` is not touched;
  `planningOnly` remains Orchestrator-scoped.
- **No `app.module.ts` change.** The `WorkspaceManager` instance already injected into
  `ConversationRuntimeDeps.workspace` already implements `.diff()` — widening the dependency's
  *declared* structural type in `conversation-runtime.ts` is the only code change at that seam.
- **`filterInScopeChanges` (extracted from Sprint 2q's `toCodeChangePreview`) is the single shared
  normalized-path filter** both the retained text-excerpt path and the new diff path use — comparison
  is `normalizeRelativePath` exact-match, never a raw string compare, and only the validated
  `targetFiles` value is ever passed to `workspace.diff()`. AI-proposed paths outside `targetFiles` are
  never read, never diffed, never rendered — surfaced only as a bounded warning, unchanged from
  ADR-0038. The extraction preserves each `ProposedChange`'s `delete`/`newContent` shape via object
  spread + a single overridden field, never a reconstruction that could default one differently from
  what the AI returned.
- **`changeKind: 'add'` is treated as a failure this sprint, not a successful "new file" diff (CA Round
  1).** `targetFiles` are Workspace-validated existing files (ADR-0036); a `WorkspaceDiff` entry
  reporting `'add'` for one of them means its current content could not be found/read at diff time —
  reported as `composeCodeGenerationPreviewFailed`, `RuntimeTurnStatus.FAILED`.
- **An empty `WorkspaceDiff.files` result is also a failure, never a vacuous success (CA Round 1).**
  Guarded explicitly before the success DTO is built.
- **Binary and size-skipped files render an explicit "diff를 표시할 수 없어요" notice (CA Round 1) —**
  never phrased as if a diff had been shown, and each such line reaffirms the file was not modified.
- **Diff rendering is budget-aware, not merely length-capped (CA Round 1).** The header, the
  out-of-scope warning (if any), and the closing "not applied" line are reserved budget computed
  *before* any file block is rendered; file blocks are dropped (with a bounded "N개 생략" notice) once
  that budget is exhausted, so the mandatory safety wording always survives — the pre-existing
  `clampToMessageBudget` call is now a defensive backstop, not the primary guarantee. The per-file cap
  is lowered (`MAX_DIFF_CHARS_PER_FILE` = 1000) to leave headroom for this reservation.
- **`composeCodeDiffPreview` supersedes `composeCodeGenerationPreview` for a successful in-scope
  proposal.** `composeCodeGenerationPreview`/`CodeChangePreview`/`toCodeChangePreview` (ADR-0038) are
  **retained, not deleted** — their own tests keep passing; they are simply no longer reached from
  `runCodeGenerationPreview`'s success branch. The same accepted "unreached in production, not deleted"
  status ADR-0038 already gave `composePlanningOnlyApproved`, applied a second time.
- **Failure — including `changeKind: 'add'`, an empty diff, and a `workspace.diff()` read error — reports
  `RuntimeTurnStatus.FAILED` via the existing `composeCodeGenerationPreviewFailed` reply.** No new
  failure-wording composer method; the required behavior is identical in shape to Sprint 2q's existing
  generation-failure handling.
- **No Core/Orchestrator contract change; no new aggregate/repository/migration/capability/port.**

### Not implemented (out of scope)
Preview → Apply · `Patch` generation · `Patch` application · `WorkspaceWrite` · file mutation · git
mutation · command execution · test execution after generation · retry loop · autonomous agent loop ·
multi-file selection · directory scope · module scope as sufficient target · semantic repository search
· repository indexing · AI target-file guessing · provider-specific diff generation · a successful diff
preview for `changeKind: 'add'` · a new `PatchSet` type · `ExecutionOrchestrator` contract change ·
`Core` contract change.

### Consequences
- + The code-change preview now shows what actually changes in the real file, not just the proposed
  content in isolation — a materially more useful pre-Apply review, using a read the codebase already
  had (`WorkspaceManager.diff()`) for a purpose it was never wired into.
- + The untrusted-output-vs-validated-scope pattern (ADR-0036/0037/0038) generalizes a third time:
  `filterInScopeChanges` is the one shared gate both the retained text preview and the new diff preview
  pass through before touching the workspace or rendering anything.
- + Treating `changeKind: 'add'`/an empty diff/a read failure as failures (rather than degraded
  successes) keeps the "never look like an ordinary successful reply when something's actually wrong"
  discipline ADR-0038 established, extended to a new failure surface this sprint introduces.
- − `composeCodeGenerationPreview` becomes dead code in production a second way (already unreached via
  `composePlanningOnlyApproved`'s precedent) — still tested, not deleted, an accepted trade-off.
- − A validated target file that is genuinely a new addition (not yet created) cannot get a successful
  preview this sprint — deferred; Sprint 2o/2p's scope-collection flow currently assumes an existing
  file, so this is expected to be rare in practice, not a common-case regression.

### Relations
ADR-0038 (AI Code Generation Preview — the text-excerpt preview this sprint supersedes for the success
case, but does not delete), ADR-0022 (Workspace read-only diff — `WorkspaceManager.diff()`, reused
unchanged), ADR-0036 (Code Change Scope Collection — `normalizeRelativePath`, `targetFiles` validation,
reused), ADR-0037 (Multi-turn Code Scope Clarification — `targetFiles` preservation through approval
resume, reused), ADR-0035 (Live Code Change Planning — `planningOnly`, unchanged), ADR-0031 (Execution
Orchestrator — the stage-selection model this sprint deliberately does not extend), ADR-0034 (Test
Result Detail UX — `MAX_MESSAGE_CHARS`/`clampToMessageBudget`, reused). Supersedes nothing.
Plan: `docs/plans/sprint-2r-unified-diff-preview-plan.md`.

## ADR-0040 — Explicit Preview Apply Approval (second gate, still no mutation)

- **Status:** ✅ Accepted (v2, Phase 2, Sprint 2s — Product Construction), Chief Architect Review:
  APPROVED WITH CHANGES (Round 1).
- **Date:** 2026-07-02
- **Scope:** Sprint 2s separates **"approved a preview"** from **"approved modifying files."** After
  Sprint 2r's diff preview, an **explicit** apply phrase ("적용해줘"/"반영해줘"/"이대로 진행해") creates a
  *second*, HIGH-risk `ApprovalRequest` and halts at `AWAITING_APPROVAL`. Still no `Patch`, no
  `WorkspaceWrite`, no `CommandExecution`, no file/git mutation — actual apply is a future sprint's job,
  and this sprint's job is to preserve, not destroy, the context that sprint will need.

### Most important rule
> **Two things this sprint discovered by reading the existing code, not by assumption, before any design
> could be trusted: (1) a second `ApprovalRequest` referencing the same `executionPlanRef` would be
> silently swallowed by `StatelessApprovalFlow.findPending`'s plan-scoped lookup unless its anchoring
> Task is deliberately kept plan-less; and (2) `ExecutionPlan` is documented as in-memory-only — by the
> time a user says "적용해줘," the object `ApprovalManager.requestFor` needs no longer exists.** Both are
> resolved by construction, not by convention: a third, plan-less anchor flow (mirroring
> `StatelessScopeClarificationFlow` exactly), and one small additive method, `ApprovalManager.
> requestForRisk`, for approvals with a known risk and no live plan to re-evaluate.

### Decision
- **The apply-preview anchor Task never carries a `planId`.** `StatelessApprovalFlow.findPending`
  discovers the first approval solely via `Session.activeTaskId → Task.planId → approvals.
  findByExecutionPlan(planId) → PENDING`. If the second approval's anchor Task carried the same
  `planId` (the same `executionPlanRef.id` the new approval must still reference), that existing flow
  would discover it as if it were its own and misroute its `approve` branch into `reconstructResume`,
  which would fail (wrong anchor key) and loop into an unrelated re-ask prompt — the apply approval could
  never actually be decided. Keeping the anchor Task's `planId` `undefined` — exactly like
  `StatelessScopeClarificationFlow`'s anchor already is — makes `StatelessApprovalFlow.findPending`'s
  very first guard skip it unconditionally.
- **A new, plan-less third flow — `ApplyPreviewFlow`/`StatelessApplyPreviewFlow` — owns finding,
  anchoring, and clearing this anchor**, discriminated the same way scope-clarification is: `!task.
  planId` **and** an explicit `kind: 'code-preview-apply'` metadata discriminator. Structurally identical
  to `StatelessScopeClarificationFlow` (ADR-0037) — same store shape, same technique, applied a second
  time to a new problem of the same shape.
- **The anchor carries an explicit three-state lifecycle: `ELIGIBLE → AWAITING_APPROVAL → APPROVED`.**
  `ELIGIBLE` is written once, right after a successful diff preview (Sprint 2r), recording
  `{executionPlanRef, workspaceRef, targetFiles, codeGenerationRef, codeProposalRef, instruction}`. An
  explicit apply phrase moves it to `AWAITING_APPROVAL` (creating the second `ApprovalRequest`).
  **Approving moves it to `APPROVED` — it does NOT clear the anchor.** `ApprovalRequest` itself carries
  no `workspaceRef`/`targetFiles`/`codeProposalRef`; clearing the anchor on approve would have made the
  approved decision unrecoverable to a future Apply sprint. Denying or cancelling **does** clear it —
  there is nothing left worth preserving. This was a required correction in CA Round 1 review; the
  original draft cleared on every decision, including approve.
- **An explicit apply phrase with no eligible anchor (or a stale one) gets a direct, honest reply — it is
  never reinterpreted as a new, unscoped code-change request.** "적용해줘" is a different intent from "새
  코드 변경을 해줘," even though both might otherwise reach the same classifier keywords. This was a
  required correction in CA Round 1 review; the original draft's answer here ("falls through to normal
  classification") was rejected as conflating two distinct user intents.
- **Once `AWAITING_APPROVAL`, every turn is intercepted for a decision — not only messages matching an
  apply phrase** — exactly like the first approval's pending-decision behavior. `ELIGIBLE`/`APPROVED`
  anchors, by contrast, are a soft, optional follow-up opportunity: anything that isn't an explicit apply
  phrase falls through to ordinary conversation untouched, proven by a dedicated non-"좋아" ordinary-chat
  test case.
- **`ApprovalManager.requestForRisk` is additive, narrowly constrained, and does not replace `requestFor`
  for the normal planning-approval path.** It always creates `PENDING` (never auto-approves) and never
  calls `ApprovalPolicy` — it exists solely because `ExecutionPlan` (ADR-0024) is in-memory-only and does
  not survive to this later turn; the caller supplies the risk level directly because it already knows a
  mutation-step approval must require one. Because it bypasses policy evaluation it validates its own
  inputs (CA Round 1 implementation review): a non-empty `reason` and `requestedBy` are required, and
  **only `HIGH`/`CRITICAL` risk is accepted** — a mutation-step approval below `HIGH` would be a caller
  error, not something to persist silently. This sprint's only caller always passes `RiskLevel.HIGH`.
- **`APPLY_WORDS` (적용/반영/이대로 진행) is a dedicated word-set, deliberately never sharing anything
  with `APPROVE_WORDS`.** "좋아"/"오케이"/"확인"/"괜찮네" — already sufficient to decide the *first*
  approval — must never be sufficient to authorize file modification. The two word-sets are
  non-overlapping by construction: `APPROVE_WORDS`' bare "진행" is distinct from `APPLY_WORDS`' multi-word
  "이대로 진행."
- **Approval #2's `reason` carries `codeProposalRef.id`/`codeGenerationRef.id`, not just target file
  names**, for auditability — `ApprovalRequest` has no metadata field, so this machine-facing string is
  the only trace on the aggregate itself pointing back to which proposal was approved (the anchor remains
  the actual source of rich, structured context).
- **The diff itself is never persisted.** Source of truth remains the anchored refs
  (`workspaceRef`/`targetFiles`/`codeProposalRef`); a future Apply sprint recomputes the diff on demand
  (Sprint 2r's `workspace.diff`) and must revalidate against the latest file content before any mutation
  — this sprint's approval wording already tells the user that will happen.
- **No Core/Orchestrator contract change; no new aggregate/repository/migration/capability/port.**

### Not implemented (out of scope)
Actual `WorkspaceWrite` apply · `PatchSet` generation/application · `CommandExecution` · test execution
after apply · git mutation · file mutation · retry loop · autonomous agent loop · multi-file selection ·
directory/module scope · semantic repository search · repository indexing · AI target-file guessing ·
new-file creation/`changeKind: 'add'` support · provider-specific apply behavior · treating the first
(preview) approval as permission to mutate files · `ExecutionOrchestrator` contract change · `Core`
contract change.

### Consequences
- + File modification now requires a second, explicit, HIGH-risk human decision — distinct from and
  strictly later than the decision that only authorized generating a preview. The two risks (seeing AI
  output vs. letting it touch a real file) are no longer conflated into one approval.
- + The plan-less-Task collision-avoidance pattern established for scope-clarification (ADR-0037)
  generalizes cleanly to a second, unrelated problem — the same technique, not a new one, each time a new
  kind of conversation-anchored fact set needs to coexist with the original approval flow.
- + Approving preserves exactly the context (`workspaceRef`/`targetFiles`/`codeProposalRef`) a future
  Apply sprint needs, rather than requiring that sprint to invent its own recovery mechanism from
  scratch.
- − `ApprovalManager` gains a second construction path (`requestForRisk`) alongside `requestFor` — an
  accepted, narrowly-scoped exception to the "zero Capability-layer changes" precedent Sprint 2q/2r held,
  forced by `ExecutionPlan`'s documented non-persistence (ADR-0024), not a design preference.
- − An approved-but-never-decided-by-a-future-sprint apply anchor persists indefinitely as an inert Task
  — the same accepted "historical record" trade-off already made for approval/scope-clarification anchors
  (ADR-0032/0037), now made a third time.

### Relations
ADR-0037 (Multi-turn Code Scope Clarification — the plan-less anchor + discriminator technique reused a
second time), ADR-0032 (Conversation Runtime — `StatelessApprovalFlow`'s Task-anchor pattern, the
collision this sprint had to design around), ADR-0025 (CAP-004 Approval Capability + Aggregate Ownership
Rule — `requestForRisk` stays inside `ApprovalManager`, the aggregate's sole owner), ADR-0024 (CAP-003
Planning Capability — `ExecutionPlan`'s in-memory-only nature, the reason `requestForRisk` exists),
ADR-0038/0039 (AI Code Generation Preview / Unified Diff Preview — the `codeGenerationRef`/
`codeProposalRef`/`workspaceRef`/`targetFiles` this sprint's anchor threads through, unchanged),
ADR-0035 (Live Code Change Planning — `planningOnly`, unchanged). Supersedes nothing.
Plan: `docs/plans/sprint-2s-explicit-apply-approval-plan.md`.

## ADR-0041 — Approved Apply Context → PatchSet Preview (representation only, still no mutation)

- **Status:** ✅ Accepted (v2, Phase 2, Sprint 2t — Product Construction), Chief Architect Review:
  APPROVED WITH CHANGES (Round 1).
- **Date:** 2026-07-02
- **Scope:** Sprint 2t turns an **APPROVED** apply anchor (Sprint 2s) into a `PatchSet` **representation**
  via the existing Patch capability (CAP-005), and shows a PatchSet **preview**. After an explicit patch
  command, the runtime recovers the approved context, re-validates against the latest workspace content,
  and calls `PatchManager.generate`. Still no `WorkspaceWrite`, no file mutation, no `CommandExecution`, no
  git mutation. Actual apply is Sprint 2u.

### Most important rule
> **PatchSet generation ≠ file apply. `PATCH_READY` means a PatchSet representation exists — patchRef
> available, no workspace file modified, no command run, no git operation — NOT "applied" or "ready to
> apply."** The Patch capability stays representation-only: `PatchManager` validates only the passed
> `ApprovalRef` (status + plan-scope) and never queries `ApprovalManager` or touches the
> filesystem/git/WorkspaceWrite/CommandExecution. The Application layer recovers the `ApprovalRef`
> (`anchor.approvalId → approvals.get → approvalRef(request)`) and injects it.

### Decision
- **Reuses `PatchManager`/`PatchSet` (CAP-005, ADR-0026) unchanged — representation-only, verified against
  source (CA Q1):** `PatchManager.generate` validates `input.approvalRef.status === APPROVED` and the
  plan-scope match, maps each in-scope `ProposedChange` to a `PatchOperation` using the matching
  `FileDiff`, and `storage.patches.save`s the set. It imports no other capability manager and never
  touches the filesystem/git — persisting a `PatchSet` is representation storage, not mutation.
- **`ConversationRuntime` composes it directly** (like `CodeGenerationManager`/`WorkspaceManager.diff`
  before it): on an explicit patch command with an `APPROVED` anchor, it loads the `CodeProposal` by
  `codeProposalRef.id` (`storage.codeProposals.get` — the source of truth, never rendered diff text or
  chat history), re-filters against the authoritative `targetFiles` (`filterInScopeChanges`), **re-runs
  `WorkspaceManager.diff` against the current content** (CA Q6 — staleness/add/binary/empty check), derives
  the `ApprovalRef` and calls `PatchManager.generate({executionPlanRef, approvalRef, changes: inScope,
  diff})`. No `ExecutionOrchestrator` call, no new `ExecutionStage`.
- **The Application layer recovers and injects the `ApprovalRef`; `PatchManager` never queries
  `ApprovalManager` (CA Q2).** `PatchManager.generate` independently re-validates the ref as a
  belt-and-suspenders check.
- **Latest content is re-validated before generation, and anything unrenderable rejects the whole set
  (CA Q7).** `workspace.diff` throwing, an empty `diff.files`, any `changeKind: 'add'`, any binary, or any
  empty `unified` (oversized/size-skipped) yields no PatchSet and a `composePatchGenerationFailed` reply —
  a `PatchOperation` carrying an unapplyable diff would be unsafe for a future `WorkspaceWrite`.
- **New anchor state `PATCH_READY` + `patchRef?: PatchRef`, narrowly defined (CA Round 1 Required Change
  #1).** After generation the apply anchor is re-anchored `PATCH_READY`, preserving `patchRef` plus every
  prior ref (`executionPlanRef`, `workspaceRef`, `targetFiles`, `codeProposalRef`, `approvalId`) as the
  Sprint 2u handoff (CA Q12). `PATCH_READY` asserts only that a PatchSet representation exists — **not**
  that anything was applied; the enum carries this in its doc comment and the preview wording reinforces
  it. A repeated patch command at `PATCH_READY` is idempotent (`composePatchAlreadyGenerated`, no
  regeneration). `StatelessApplyPreviewFlow` needs no logic change (its status→`TaskStatus` mapping only
  special-cases `AWAITING_APPROVAL`; `PATCH_READY` is an inert `PENDING` anchor).
- **Explicit patch trigger, narrowed (CA Round 1 Required Change #2).** A dedicated `PATCH_WORDS` set of
  explicit patch phrases (`'패치 만들어'`, `'패치 생성'`, `'패치로 만들어'`, `'patch 만들어'`, `'generate
  patch'`, `'patchset 만들어'`, `'다음 단계 진행'`) — the ambiguous standalone `'계속 진행'` is deliberately
  excluded, and `'좋아'`/`'오케이'`/`'확인'` never match. Non-overlapping with `APPROVE_WORDS`/`APPLY_WORDS`
  by construction. Generation only fires on an `APPROVED` anchor: explicit patch phrase + `APPROVED` ⇒
  generation; a bare "continue" ⇒ never generation.
- **User-facing wording uses "패치 미리보기" framing (CA Round 1 Required Change #3)** and repeats "아직
  실제 파일에는 적용하지 않았어요 / 파일은 수정되지 않았어요"; forbidden: "적용했어요"/"반영했어요"/
  "수정했어요"/"변경 완료"/"적용 완료".
- **Generation failures are logged, structured, without diff/file content (CA Round 1 Required Change
  #4)** — `logger.warn('PatchSet generation failed', {reason, sessionId, executionPlanId, approvalId,
  codeProposalId, targetFiles})` — so operators can trace failures while the user sees only a safe reply.
- **No Core/Orchestrator contract change; no new aggregate/repository/migration/capability/port.**
  `PatchManager` is already a registered provider (reused, not newly registered).

### Not implemented (out of scope)
Actual `WorkspaceWrite` apply · filesystem mutation · git mutation · `CommandExecution` · test execution
after patch generation · autonomous agent loop · retry loop · multi-file selection · directory/module
scope · semantic repository search · repository indexing · AI target-file guessing · new-file creation/
`changeKind: 'add'` support · provider-specific patch behavior · treating PatchSet generation as file
application · `PatchManager` querying `ApprovalManager` · generating a PatchSet for binary/oversized/
unrenderable changes · `ExecutionOrchestrator` contract change · `Core` contract change.

### Consequences
- + The approved modification now has a concrete, deterministic, scope-filtered `PatchSet` representation —
  the last safe artifact before actual mutation — built from the existing Patch capability with zero
  changes to it.
- + The "recover refs from a plan-less anchor → compose a capability directly" pattern (Sprint 2q/2r/2s)
  extends once more; `PatchManager` stays representation-only because the Application layer, not the
  capability, recovers the `ApprovalRef`.
- + Re-running `WorkspaceManager.diff` immediately before generation makes staleness a first-class,
  tested rejection rather than a latent risk carried into a future apply.
- − A fourth anchor state (`PATCH_READY`) and a `patchRef` field are added to `ApplyPreviewAnchor` — a
  justified extension (Sprint 2u handoff + repeat-command idempotency), not scope creep.
- − A generated-but-never-applied `PatchSet` persists in `storage.patches` as representation history — the
  same accepted "inert record" trade-off as prior anchors; a future Rollback/GC concern, not this sprint's.

### Relations
ADR-0026 (CAP-005 Patch Capability — `PatchManager`/`PatchSet`/`PatchGenerationInput`/`patchRef`, reused
representation-only), ADR-0040 (Explicit Preview Apply Approval — the `APPROVED` apply anchor + `approvalId`
this sprint consumes and extends to `PATCH_READY`), ADR-0025 (CAP-004 Approval — `approvalRef` derivation,
`ApprovalManager.get`; the boundary `PatchManager` must not cross), ADR-0039 (Unified Diff Preview —
`WorkspaceManager.diff` re-run + bounded/backtick-safe rendering, reused), ADR-0036 (Code Change Scope
Collection — `filterInScopeChanges`/`targetFiles` authority, reused), ADR-0029 (AI Code Generation —
`CodeProposal` content source via `storage.codeProposals`), ADR-0031 (Execution Orchestrator — deliberately
not extended). Supersedes nothing.
Plan: `docs/plans/sprint-2t-approved-apply-to-patchset-preview-plan.md`.

## ADR-0042 — PatchRef → WorkspaceWrite Apply (first real file mutation, WorkspaceWrite only)

- **Status:** ✅ Accepted (v2, Phase 2, Sprint 2u — Product Construction), Chief Architect Review:
  APPROVED WITH CHANGES (Round 1).
- **Date:** 2026-07-02
- **Scope:** Sprint 2u performs the product's **first real workspace file mutation.** From a `PATCH_READY`
  apply anchor (Sprint 2t), an explicit final workspace-apply command recovers the `PatchSet` by
  `patchRef`, verifies its integrity, and applies **exactly one `update` operation** through the existing
  WorkspaceWrite capability (CAP-006). Still no git mutation, no `CommandExecution`, no test execution, no
  `ExecutionOrchestrator` change.

### Most important rule
> **WorkspaceWrite is the only thing that mutates files, and Sprint 2u applies exactly one `update`
> operation, in-scope, from an integrity-verified PatchSet.** The PatchSet (loaded by `patchRef`) is the
> applied artifact — never the AI `CodeProposal`, rendered diff, or chat memory. Its embedded `approvalRef`
> authorizes the write (no `ApprovalManager` on the apply path). `WORKSPACE_APPLIED` means workspace files
> were mutated — **not** committed, pushed, tested, deployed, or a clean working tree.

### Decision
- **Reuses `WorkspaceWriteManager`/`WorkspaceChange`/`LocalWorkspaceWriter` (CAP-006, ADR-0027) unchanged**
  — verified against source (CA Q1). `apply({patchSet, approvalRef, workspaceRef})` is Ref-gated (validates
  `approvalRef.status === APPROVED` + plan-scope, never queries `ApprovalManager`), delegates each op to the
  `WorkspaceWriter` port, and persists a `WorkspaceChange`. File writes are **atomic-per-file, best-effort,
  with no cross-file rollback**.
- **`ConversationRuntime` composes it directly** (like every capability since Sprint 2q): on an explicit
  final-apply command with a `PATCH_READY` anchor, it loads the `PatchSet` via `patch.get(anchor.patchRef.id)`,
  runs the integrity gate, calls `workspaceWrite.apply`, checks the result, and re-anchors. No
  `ExecutionOrchestrator` call, no new `ExecutionStage`.
- **`update`-only, single-op this sprint (CA Round 1 #1/Q9).** The pre-write gate rejects unless the
  PatchSet has exactly one operation whose `operation === 'update'`, non-binary, whose path is within the
  user-approved `targetFiles`. This rejects multi-op (no partial-apply ambiguity given no cross-file
  rollback), `add`/new-file, `delete`, and binary. **`delete` is specifically rejected because
  `LocalWorkspaceWriter`'s delete path does not diff-check against current content** — only `update`/`add`
  run `applyPatch(current, op.diff)`; add is out anyway, so `update` is the only op with a genuine
  latest-content check.
- **Pre-write identity + scope checks (CA Round 1 #2):** `patchSet.id === anchor.patchRef.id`, and the op's
  path normalizes (`normalizeRelativePath`) to one of `anchor.targetFiles`. Plus `status === GENERATED`,
  `approvalRef.status === APPROVED`, `approvalRef.id === anchor.approvalId`, `executionPlanRef.id` match.
- **Latest-content revalidation is WorkspaceWrite's own `applyPatch` (CA Round 1 #4/Q6), for `update`
  only.** A stale diff no longer applies cleanly → `FileChangeResult.failed`, file left unchanged. No
  separate Application-layer re-diff (it would need lossy `newContent` reconstruction). A stale update
  therefore means WorkspaceWrite *is* called, returns a non-clean/`FAILED` result, the file is unchanged,
  and no `WORKSPACE_APPLIED` is set — it is not a "revalidation failure before WorkspaceWrite."
- **Post-write result-integrity gate (CA Round 1 #3):** `WORKSPACE_APPLIED` is set only if the returned
  `WorkspaceChange` is `APPLIED` **and** fully matches the artifact/context — `patchRef.id`/`approvalRef.id`/
  `executionPlanRef.id`/`workspaceRef.id`, `results.length === 1`, `results[0].status === 'applied'`,
  `results[0].path === op.path`. Anything else → safe failure, no re-anchor.
- **New anchor state `WORKSPACE_APPLIED` + `workspaceChangeRef?` (CA Q8/Round 1 #6).** Preserves the
  `WorkspaceChange` record for a future git/test sprint. It means files were mutated **only** — not
  committed/pushed/tested/deployed, and not a clean working tree; the enum comment and the reply copy say so.
- **Explicit final trigger, distinct from all prior word-sets (CA Round 1 #7/Q3).** `FINAL_APPLY_WORDS`
  (`'최종 적용'`, `'파일에 적용'`, `'패치 적용'`, `'workspace에 적용'`, `'apply patch'`, `'apply to
  workspace'`) — qualified phrases only. A bare "적용"/"좋아"/"오케이"/"확인"/"다음 단계 진행" never triggers
  a file write. Checked **before** apply-intent so "패치 적용해줘" (which also contains the apply-word "적용")
  routes to the file-apply path, not Sprint 2s's apply-intent.
- **`WORKSPACE_APPLIED` never hides the applied state (CA Round 1 #8).** A final/patch/apply intent at
  `WORKSPACE_APPLIED` all route to `composeWorkspaceAlreadyApplied` — never `handlePatchAlreadyGeneratedTurn`
  ("preview generated") or `handleApplyAlreadyApprovedTurn` ("not yet applied"), which would understate the
  stronger state.
- **Precise git wording (CA Round 1 #5).** After a write the working tree holds the change, so the copy
  never says "git 변경 없음"; it says the file was modified, git **commands** were not run, commit/push were
  not performed, tests were not run, and the working tree may now show the change. Forbidden across all
  replies: "git 변경 없음"/committed/pushed/deployed/테스트 통과/검증 완료.
- **Structured, no-content failure log** for operability (mirrors Sprint 2t): sessionId, executionPlanId,
  approvalId, patchId, targetFiles — never diff/file content.
- **No Core/Orchestrator contract change; no new aggregate/repository/migration/capability/port.**
  `WorkspaceWriteManager` is already a registered provider (reused). `PatchManager` gains no apply behavior.

### Not implemented (out of scope)
`git add`/`commit`/`push` (or any git call) · `CommandExecution` · test execution after apply · shell
commands · autonomous agent loop · retry loop · AI regeneration · AI target-file guessing · multi-file/
multi-op apply · directory/module scope · semantic repository search · repository indexing · `add`/
new-file/`changeKind:add` · `delete` operations · binary operations · applying an unapproved/out-of-scope
PatchSet · applying without a `PATCH_READY` anchor · `ExecutionOrchestrator` contract change · `Core`
contract change · `PatchManager` gaining apply behavior · treating apply success as git success.

### Consequences
- + The product can, for the first time, turn an approved, previewed, patch-represented change into a real
  edit of one existing file — behind five prior safety gates and one explicit final command — reusing the
  battle-tested WorkspaceWrite capability with zero changes to it.
- + Restricting to a single in-scope `update` op makes the first mutation sprint maximally safe: no
  partial-apply ambiguity, no unchecked delete, no new-file/binary surprises; staleness is caught by
  WorkspaceWrite's own clean-apply check.
- + The pre-write (identity/scope) and post-write (result-integrity) gates make the anchor→PatchSet→
  WorkspaceChange chain verifiable end-to-end before `WORKSPACE_APPLIED` is trusted.
- − A `WORKSPACE_APPLIED` anchor and a `workspaceChangeRef` field are added to `ApplyPreviewAnchor` — a
  justified extension (git/test-sprint handoff), not scope creep.
- − After a successful apply the working tree is dirty but git is untouched — an intentional, clearly-worded
  state; committing/testing is a separate future sprint.
- − `add`/`delete`/binary/multi-file apply are deferred; a future sprint must make delete's stale-content
  check explicit before allowing it.

### Relations
ADR-0027 (CAP-006 Workspace Write — `WorkspaceWriteManager`/`WorkspaceChange`/`LocalWorkspaceWriter`, reused
as the sole file mutator), ADR-0041 (Approved Apply Context → PatchSet Preview — the `PATCH_READY` anchor +
`patchRef` this sprint consumes and extends to `WORKSPACE_APPLIED`), ADR-0026 (CAP-005 Patch — `PatchSet`/
`PatchManager.get`, representation-only, gains no apply behavior), ADR-0025 (CAP-004 Approval — the embedded
`approvalRef` authorizes the write; `ApprovalManager` untouched on the apply path), ADR-0036 (Code Change
Scope Collection — `normalizeRelativePath`/`targetFiles` authority, reused for the op-path scope check),
ADR-0031 (Execution Orchestrator — deliberately not extended). Supersedes nothing.
Plan: `docs/plans/sprint-2u-patchref-to-workspacewrite-apply-plan.md`.

## ADR-0043 — Post-Apply Validation Command (WORKSPACE_APPLIED → explicit validation via CommandExecution)

- **Status:** ✅ Accepted (v2, Phase 2, Sprint 2v — Product Construction), Chief Architect Review:
  APPROVED WITH CHANGES (7 required changes applied) → PROCEED.
- **Date:** 2026-07-02
- **Scope:** After Sprint 2u leaves a `WORKSPACE_APPLIED` apply anchor (a real file mutation happened;
  git/tests were NOT run), a later turn with an **explicit validation command** runs **exactly one**
  pre-approved validation command (`pnpm test` or `pnpm typecheck`) through the existing **CommandExecution**
  capability (CAP-007), against the workspace the file was applied to, and shows the result. Still **no git,
  no commit/push, no additional file mutation, no rollback, no `ExecutionOrchestrator` change.**

### Most important rule
> **CommandExecution is the only thing that runs a command, and Sprint 2v runs exactly one derived,
> allow-listed validation command (`pnpm test`/`pnpm typecheck`) per turn, only on an explicit request, only
> on a `WORKSPACE_APPLIED` anchor, against `anchor.workspaceRef`.** The command + args are DERIVED from the
> detected validation intent — never copied from user text. `WORKSPACE_APPLIED` stays `WORKSPACE_APPLIED`; a
> passing validation is **point-in-time only** (no `WORKSPACE_VALIDATED` state).

### Decision
- **Reuses `CommandExecutionManager`/`CommandExecution`/`CommandExecutionRef` (CAP-007, ADR-0028) unchanged**
  — the sole command runner: allow-list (`{'pnpm','npm','node'}`) + dangerous-arg + risk + Ref-only approval
  gates before the `CommandRunner` port (argv array, no shell, cwd = workspace root, timeout). `pnpm test`/
  `pnpm typecheck` are MEDIUM risk (`RiskPolicy.assessCommand`) → **no approval** required. Reuses the Sprint
  2m/2n bounded-output rendering helpers.
- **`ConversationRuntime` composes it directly** (like every capability since Sprint 2q): on an explicit
  post-apply validation command with a `WORKSPACE_APPLIED` anchor, it calls `command.run({executionPlanRef:
  anchor.executionPlanRef, workspaceRef: anchor.workspaceRef, workspaceChangeRef: anchor.workspaceChangeRef,
  command:'pnpm', args:['test'|'typecheck']})`. **No `ExecutionOrchestrator` call, no new `ExecutionStage`.**
  Direct call (not the orchestrator) is required so the run reuses `anchor.executionPlanRef` and can carry
  `workspaceChangeRef` (the orchestrator's `COMMAND_EXECUTION` stage mints its own plan and omits
  `workspaceChangeRef`).
- **Validation is explicit; never automatic.** A `WORKSPACE_APPLIED` anchor being created (Sprint 2u apply
  success) runs zero commands. Validation only fires on a later turn with an explicit validation phrase.
- **Trigger (CA Round 1 #1/#2).** `interpretPostApplyValidationIntent`: `typecheck`/`타입체크`/`type check` →
  `pnpm typecheck`; (`테스트`|`test`)+action-verb or `pnpm test` → `pnpm test`; **both requested → clarify
  (never a silent pick)**; bare `검증`/`validate` → clarify; **a validation phrase carrying a dangerous/
  arbitrary command fragment → unsupported/reject (no run)** via a small deterministic denylist
  (`rm -rf`/git/curl/cat/grep/npm|pnpm install/pnpm build/node -e/`;`/`&&`/`||`/`|`/`>`); a message with no
  validation token → falls through. "좋아"/"오케이"/"확인"/"다음 단계 진행"/"계속 진행" never trigger. Command
  + args are DERIVED, never user text. **One command per turn.**
- **Post-apply flow is gated on `WORKSPACE_APPLIED` (CA Round 1 #7).** With no such anchor, the existing
  Sprint 2l general Live Test Execution flow (classifier → `IntentResolver` → orchestrator `TEST_EXECUTION`)
  is unchanged; the detector is consulted only inside the `WORKSPACE_APPLIED` routing guard.
- **Clarify/unsupported are NORMAL responses (CA Round 1 #3)** — `RESPONDED`, record the assistant reply,
  never `failComposed`; nothing runs, the anchor is not re-anchored, no ref is set.
- **`postApplyValidationRef` preserved only when a `CommandExecution` exists (CA Round 1 #4/#6).** On a
  terminal run (SUCCEEDED/FAILED/TIMED_OUT) the anchor is re-anchored with
  `postApplyValidationRef = commandExecutionRef(execution)` — **latest only** (replaces any prior; no history
  on the anchor — CommandExecution storage owns history). A throw before an aggregate exists → no re-anchor,
  no ref. `status` stays `WORKSPACE_APPLIED`. **No `WORKSPACE_VALIDATED`** — a pass can go stale; VALIDATED
  would overstate durability.
- **Failure/timeout do not rollback (CA Q10/Q11).** No WorkspaceWrite, no git; failure shows the project's
  result (not a bot error); timeout is distinct from a failure verdict (no exit code); the anchor is kept.
- **Precise wording on all terminal outcomes (CA Round 1 #5).** Passed/failed/timeout all state git commands
  were NOT run **and** commit/push were NOT performed; success is "이번 실행 기준으로 통과했어요"; failure adds
  that no rollback happened; timeout adds that validation did not complete. Forbidden across all replies:
  git 변경 없음 / clean tree / committed / pushed / deployed / 완전히 검증됐어요 / 배포 가능해요 / 영구적으로
  안전.
- **Validation may create tool/runtime artifacts, but the product makes no clean-tree claim (CA Constraint
  5).** `pnpm test`/`pnpm typecheck` may write tool caches / build info inside the workspace as a property of
  the existing CommandExecution environment; this is NOT source mutation — **WorkspaceWrite remains the only
  source mutator** — and the product never runs git, inspects the tree, or claims it is clean.
- **No Core/Orchestrator contract change; no new aggregate/repository/migration/capability/port/anchor
  status.** `CommandExecutionManager` is already a registered provider (reused, unchanged); `PatchManager`
  gains no behavior and is not called on this path.

### Not implemented (out of scope)
`git status`/`git diff`/`git add`/`git commit`/`git push` (or any git call) · deployment · `pnpm install`/
`npm install` · `pnpm build` · `rm`/`cat`/`grep`/`curl`/arbitrary shell · `node arbitrary.js` · any
user-supplied shell text · command composition/chaining · automatic validation after apply · AI deciding
which validation to run · running both test and typecheck in one turn · re-running CodeGeneration ·
regenerating PatchSet · `WorkspaceWrite`/any further file mutation · rollback · `ExecutionOrchestrator` stage
change or new stage · `Core` contract change · `CommandExecutionManager` behavior change · a
`WORKSPACE_VALIDATED` anchor state · claiming committed/pushed/tested-forever/verified/deployed/clean tree.

### Consequences
- + After applying a change, the user can, for the first time, run a bounded validation command (`pnpm
  test`/`pnpm typecheck`) against the exact workspace the file was modified in — reusing the built, gated
  CommandExecution capability with zero changes to it, behind an explicit-command gate.
- + One-command-per-turn + derived-args + a denylist keep the riskiest capability narrow: no arbitrary
  shell, no both-at-once ambiguity, no destructive fragment slipping through.
- + The run is tied to the applied change (`workspaceChangeRef`) and preserved as `postApplyValidationRef`,
  keeping the Execution Ledger chain (Plan → Approval → PatchSet → WorkspaceChange → CommandExecution)
  verifiable, without inventing a new aggregate or a durable "validated" state.
- − `ApplyPreviewAnchor` gains one optional field (`postApplyValidationRef?`) — a justified extension
  (validation-result handoff), latest-only, not a history store.
- − A validation pass is point-in-time; the product deliberately does not claim durable verification, a
  clean tree, or deploy-readiness. Git/commit and any test-automation-after-apply remain separate future
  sprints.

### Relations
ADR-0028 (CAP-007 Command Execution — `CommandExecutionManager`/`CommandExecution`/`CommandExecutionRef`,
reused as the sole command runner, unchanged), ADR-0033/0034 (Live Test Execution + Test Result Detail UX —
`TestResultDetail`, `composeTestResult`/`composeTestTimedOut`, bounded-output helpers reused; the Sprint 2l
general flow preserved when no `WORKSPACE_APPLIED` anchor exists), ADR-0042 (PatchRef → WorkspaceWrite Apply
— the `WORKSPACE_APPLIED` anchor + `workspaceRef`/`workspaceChangeRef` this sprint consumes and extends with
`postApplyValidationRef`), ADR-0025/0026 (Approval/Patch Refs — validation is MEDIUM, no approval; Patch
untouched), ADR-0031 (Execution Orchestrator — deliberately not extended or called on this path). Supersedes
nothing. Plan: `docs/plans/sprint-2v-post-apply-validation-command-plan.md`.

## ADR-0044 — Post-Validation Git Status Preview (WORKSPACE_APPLIED → read-only Git status/diff preview)

- **Status:** ✅ Accepted (v2, Phase 2, Sprint 2w — Product Construction), Chief Architect Review:
  APPROVED WITH CHANGES (10 required changes applied) → PROCEED.
- **Date:** 2026-07-02
- **Scope:** After Sprint 2u leaves a `WORKSPACE_APPLIED` anchor (real file mutation) and Sprint 2v optionally
  records a `postApplyValidationRef`, a later turn with an **explicit git-preview command** returns a
  **bounded, read-only** summary of the current working tree through the **Git** capability (CAP-002),
  against `anchor.workspaceRef`. Still **no git mutation, no CommandExecution, no WorkspaceWrite, no file
  mutation, no `ExecutionOrchestrator` change.**

### Most important rule
> **Sprint 2w is read-only. The Git capability is the only thing that touches git; the runtime never shells
> out; only `status` and a new read-only `diff` run — never add/commit/push/reset/checkout/stash/branch/tag/
> merge/rebase.** A git-MUTATION phrase is rejected with a read-only reminder. Nothing is persisted (no
> `GIT_PREVIEWED` state, no ref, no re-anchor). Output is bounded and truncation-labeled; the product never
> claims committed/pushed/deployed/safe-to-commit/verified/clean beyond what Git reports.

### Decision
- **Reuses `GitManager.status`/`GitProvider.status`/`GitStatus` (CAP-002, ADR-0023) unchanged** for the
  status/changed-files preview. Read-only; takes a plain `rootPath`; adapter runs read-only subcommands via
  argument-array `spawnSync`, timeout, masked stderr.
- **Adds the minimal read-only `diff` extension (CA #1, approved):** `GitDiff` domain type +
  `GitProvider.diff` + `GitManager.diff` + `LocalGitProvider.diff`. Read-only, **argument-array only**:
  `git --no-pager diff --no-ext-diff --no-color [--name-only] HEAD` (files from `--name-only`, unified from
  the plain form); unborn-HEAD fallback drops `HEAD`. Never a mutating subcommand, never a shell string,
  never user args/pathspec. Hard adapter cap (`MAX_DIFF_CHARS = 20 000`) sets `truncated`. No aggregate/Ref/
  storage; ADR-0023's mutation boundary is unchanged (extended read-only).
- **`ConversationRuntime` composes it directly** (like every capability since Sprint 2q): on an explicit
  git-preview command with a `WORKSPACE_APPLIED` anchor, it calls `git.status`/`git.diff` against
  `anchor.workspaceRef.rootPath`. **No `ExecutionOrchestrator` call, no new `ExecutionStage`.**
- **Preview is explicit; never automatic.** Neither apply success (2u) nor validation success (2v) runs git.
  Only a later turn with an explicit git-preview phrase does.
- **Trigger (CA #5/#6).** `interpretGitPreviewIntent`: **mutating git phrases checked FIRST** (precedence
  over diff/status) → reject; `diff`/`디프` → diff; `git 상태`/`깃 상태`/`변경 파일`/`변경사항`/`바뀐 파일`/
  `커밋 전` → status; else null. Korean "커밋 전에 변경사항 요약" is status (커밋 without an action verb);
  **English `commit` stays conservative** (any `commit` token → mutating). "좋아"/"오케이"/"확인"/"다음 단계
  진행"/"검증됐네" → null.
- **Gated on `WORKSPACE_APPLIED` (CA Q3).** With no such anchor, neither git detector is consulted and **no
  broad general git handling** is created; the message falls through unchanged.
- **Diff preview reads BOTH status and diff (CA #2).** `git diff HEAD` excludes untracked file *contents*, so
  a diff preview also reads `status` (branch/clean + untracked paths) and states "diff는 추적 중인 파일
  변경만 포함해요. untracked 파일은 상태 목록에만 표시돼요." Binary files show git's marker line only, never
  binary content (CA #3).
- **Layered, labeled bounds (CA #4).** changed files ≤ 30; diff files displayed ≤ 5; diff display ≤ 3000
  chars before the final `MAX_MESSAGE_CHARS` (1900) clamp; adapter hard cap upstream. Any truncation at any
  layer is user-facing-labeled.
- **Validation context is display-only and never fails the preview (CA Q8/#8).** If `postApplyValidationRef`
  resolves via the existing read-only `commandExecutions.get`, show "최근 검증 기록: {command} {status}
  (이번에 다시 실행하진 않았어요)"; a null/throwing lookup → "최근 검증 기록을 불러올 수 없어요." and the
  preview still proceeds; no ref → "검증 기록 없음". No validation is ever re-run; no CommandExecution.
- **No persistence / no re-anchor (CA #9).** No `GIT_PREVIEWED`, no `postApplyGitPreviewRef`, no
  `GitStatusRef`/`GitDiffRef`, no storage; the apply anchor is never re-anchored on this path.
- **Git read failure → safe failure, no fallback (CA #7/Q10).** A `git.status`/`git.diff` throw →
  `composeGitPreviewUnavailable`; **no CommandExecution, no shell, no workspace re-resolution**. On a diff
  preview, `git.status` is read first; if it throws, `git.diff` is not called. **(CA Implementation Review)**
  Because a read-only git subcommand *was* attempted on this path, the failure copy must **not** claim "git
  명령은 실행하지 않았어요"; it states no git add/commit/push, no file mutation, and no CommandExecution/shell
  fallback.
- **Read-only-vs-mutation wording (CA #10).** Every successful preview states "읽기 전용 Git 미리보기 / git
  add·commit·push 안 함 / 파일 수정 안 함 / 명령 실행 안 함." Forbidden: 커밋 준비 완료 / push 가능 / 배포
  가능 / 안전함 / 검증 완료 / committed / pushed / deployed / safe to commit / verified forever. "현재 Git
  기준 변경 파일이 없어요." only when Git reports clean; never infers tests passed.
- **No Core/Orchestrator contract change beyond the read-only `GitProvider` method; no new aggregate/
  repository/migration/capability/anchor state.** CommandExecution/WorkspaceWrite/Patch untouched and
  uncalled on this path.

### Not implemented (out of scope)
`git add`/`commit`/`push`/`reset`/`checkout`/`stash`/`branch`/`tag`/`merge`/`rebase` (any git mutation) ·
branch/PR creation · deployment · CommandExecution (or a shell git through it) · runtime shelling out to git
· WorkspaceWrite/file mutation · automatic git preview after apply or validation · AI deciding whether to
commit · commit-message generation · multi-command git workflow · broad general git handling outside the
`WORKSPACE_APPLIED` path · `ExecutionOrchestrator` change/new stage · a `GIT_PREVIEWED` state / git-preview
persistence / re-anchor · remote-URL exposure · clean-tree/deploy/commit overclaim.

### Consequences
- + After applying (and optionally validating) a change, the user can inspect the working tree ("무슨 파일이
  바뀌었지 / diff 보여줘") through the built, read-only Git capability — behind an explicit-command gate,
  against the exact workspace the file was modified in.
- + The diff extension is genuinely read-only (argv-only `git diff`, `--no-ext-diff`), following the existing
  adapter pattern; the ADR-0023 mutation boundary is unchanged.
- + Reading both status+diff makes untracked files honest (never silently omitted, never dumped as binary),
  and layered bounds keep the chat message safe.
- − Git capability gains a read-only `diff` method (+ `GitDiff` type) — a justified read-only extension, not
  a mutation surface.
- − A validation pass shown in context is record-only and point-in-time; the product deliberately does not
  claim durable validity, a clean tree, or deploy-readiness. Git mutation (add/commit/push) remains a
  separate future sprint.

### Relations
ADR-0023 (CAP-002 Git — `GitManager`/`GitProvider`/`GitStatus`/`LocalGitProvider`, reused read-only; extended
with a read-only `diff`), ADR-0042 (WorkspaceWrite Apply — the `WORKSPACE_APPLIED` anchor + `workspaceRef`
this sprint reads against), ADR-0043 (Post-Apply Validation — the `postApplyValidationRef` shown as read-only
context via the existing `commandExecutions.get`), ADR-0034 (Test Result Detail UX — message-budget/fence
helpers reused), ADR-0031 (Execution Orchestrator — deliberately not extended or called). Supersedes nothing.
Plan: `docs/plans/sprint-2w-post-validation-git-status-preview-plan.md`.

## ADR-0045 — Explicit Git Commit Approval (WORKSPACE_APPLIED → commit approval halt, NO git mutation)

- **Status:** ✅ Accepted (v2, Phase 2, Sprint 2x — Product Construction), Chief Architect Review:
  APPROVED WITH CHANGES (14 required changes applied) → PROCEED.
- **Date:** 2026-07-02
- **Scope:** After Sprint 2u leaves a `WORKSPACE_APPLIED` anchor (real file mutation) — optionally validated
  (2v) and previewed read-only (2w) — an explicit commit request **plans** a git commit: read-only
  `git.status` → in-scope candidate files → deterministic commit message → **HIGH `ApprovalRequest`** → halt
  at a commit-approval-pending state. **This sprint performs NO git mutation** — no `git add`/`commit`/`push`,
  not even after the user approves (execution is a future Sprint 2y). It only creates the approval gate.

### Most important rule
> **A git commit is a repository mutation, so Sprint 2x stops before it.** The runtime reads only
> `git.status` (never `git.diff`), creates a HIGH `ApprovalRequest`, and halts; nothing git-mutating runs —
> not on request, not on approval. `COMMIT_APPROVED` means the commit was **approved, not performed**; there
> is no `COMMITTED`/`GIT_COMMITTED` state and no overclaim (safe-to-commit / ready-to-push / deployed / committed).

### Decision
- **Reuses `ApprovalManager.requestForRisk`/`decide`/`get` (CAP-004)** and the Sprint 2s approval-#2 runtime
  pattern (`interpretDecision`/`decisionOf`/`APPROVE|DENY|CANCEL_WORDS`/`composeApprovalNotice`). `requestForRisk`
  creates a PENDING HIGH `ApprovalRequest` (never auto-approves). **`GitManager.status` (read-only, 2w `git`
  dep) is the only git call; `git.diff` is never called (CA #1).** No new capability/port/aggregate/dep.
- **`ConversationRuntime` composes it directly.** New anchor statuses `COMMIT_APPROVAL_PENDING` (a real HIGH
  approval pending — intercepts every turn) and `COMMIT_APPROVED` (approved; context preserved for Sprint 2y),
  plus fields `commitApprovalId`/`proposedCommitMessage`/`commitCandidateFiles`. **No `COMMITTED`/`GIT_COMMITTED`.**
- **Plan-less anchor ↔ `StatelessApprovalFlow`.** The apply/commit anchor Task carries no `planId`, so
  `findPending` (which needs `task.planId`) never returns the commit approval — it is handled solely via the
  `COMMIT_APPROVAL_PENDING` interception. `StatelessApplyPreviewFlow` maps that status to `WAITING_APPROVAL`
  (observability); the task stays plan-less.
- **Trigger (CA #3).** `interpretCommitIntent`: commit words → `'commit'`; a commit bundled with push/add/
  reset/… companion → `'commit-with-forbidden'` (rejected, priority over commit); push/add/reset-**only** (no
  commit word) → null (Sprint 2w mutating-reject handles it, unchanged); "커밋 전에 변경사항 요약" (no action
  verb) → 2w status. Bare 좋아/오케이/확인/다음 단계/진행해/이대로 해 → null.
- **Candidate files + defensive safety (CA #6/#14).** candidates = changed (`staged ∪ unstaged ∪ untracked`)
  ∩ `targetFiles`, each path through `safeRelativePath` (absolute/`..`/empty/non-normalizable → unsafe →
  out-of-scope). Clean tree → no approval; any out-of-scope/unsafe path OR empty in-scope set → bounded
  warning, no approval. Lists bounded (out-of-scope ≤10, candidates ≤30).
- **Commit message (CA #6/#7/#8).** Deterministic template (`chore: update <targetFiles>`), ≤120 chars, no
  AI; a user-provided message is accepted only if exactly one quoted segment, single-line, ≤120,
  control-char-free, trimmed (backticks/punctuation allowed within bounds) — else `composeCommitMessageInvalid`,
  no approval. No diff interpolation.
- **Approval reason (CA #4/#11).** operation "git commit approval planning" · workspaceRef id · bounded
  candidate files · commit message · validation context · risk HIGH · "no git add/commit/push has been
  performed" · "records permission only; actual commit deferred to a later step". **No raw diff / file content.**
- **Strict decision guards (CA #2/#3).** Before deciding: the pending context must be complete (status
  `COMMIT_APPROVAL_PENDING` + `commitApprovalId` + `proposedCommitMessage` + non-empty `commitCandidateFiles`
  + `workspaceRef` + `workspaceChangeRef` + `executionPlanRef`), and `approvals.get(commitApprovalId)` must
  exist, be PENDING, and match `anchor.executionPlanRef.id`. Any failure → safe failure, no `decide`, no git,
  no re-anchor. Ambiguous decision → re-prompt, preserving pending context (no decide/new approval).
- **After decision (CA #9/#10/#11/#12).** Approve → `decide` APPROVED, re-anchor `COMMIT_APPROVED`,
  `composeCommitApprovalRecorded` ("승인 기록; 아직 실제 커밋 안 함" — never "커밋 완료"/committed). Deny/cancel
  → `decide` REJECTED, **revert to `WORKSPACE_APPLIED` clearing only the commit fields** (preserving
  `workspaceRef`/`workspaceChangeRef`/`postApplyValidationRef`/`targetFiles`), with **commit-specific**
  replies ("이미 적용된 파일 변경은 그대로 있어요") — never the generic `composeExecutionResult`.
- **Read failure wording (CA #9/#12).** A `git.status` throw → `composeCommitStatusUnavailable` (a read was
  attempted; never "git 명령은 실행하지 않았어요"), no approval, no CommandExecution/shell fallback. Wrong
  state / incomplete pending context → the distinct `composeCommitUnavailable`.
- **Validation context (CA #10/Q10).** Displayed via the read-only `commandExecutions.get` (2w helper);
  a lookup failure never blocks the approval; validation is not required.
- **No Core/Orchestrator contract change; no `app.module.ts` change** (no new dep/provider). No `GitProvider`
  mutation method. No CommandExecution/shell git, no WorkspaceWrite/Patch/CodeGeneration/Orchestrator.

### Not implemented (out of scope)
`git add`/`commit`/`push`/`reset`/`checkout`/`stash`/`branch`/`tag`/`merge`/`rebase` · **actual commit
execution even after approval** (Sprint 2y) · automatic commit · AI commit messages · `GitProvider`
add/commit/push · `git.diff` on this path · CommandExecution-based git · runtime shell-out · WorkspaceWrite ·
Patch · CodeGeneration · ExecutionOrchestrator change · PR creation · deployment · a `COMMITTED`/`GIT_COMMITTED`
state · persisting raw diff · overclaim (safe-to-commit/ready-to-push/deploy/committed).

### Consequences
- + The user can, for the first time, request a git commit of the bot-applied change and get a bounded,
  read-only summary + a deterministic commit message + a HIGH approval gate — behind an explicit request,
  with zero git mutation.
- + Reusing the proven approval-halt pattern (2s) and the plan-less anchor keeps the design small and keeps
  `findPending` from hijacking the commit approval.
- − `ApplyPreviewAnchor` gains two statuses + three commit fields — a justified extension for the Sprint 2y
  executor, not scope creep; nothing is persisted beyond refs/message/candidate paths (no raw diff).
- − Approval is recorded but the commit is deliberately not performed; git mutation (add/commit/push) remains
  a separate, individually-reviewed future sprint.

### Relations
ADR-0025 (CAP-004 Approval — `ApprovalManager.requestForRisk`/`decide`/`get`, reused), ADR-0040 (Sprint 2s
explicit apply approval — the approval-#2 halt pattern + plan-less anchor reused), ADR-0044 (Post-Validation
Git Status Preview — read-only `git.status` reused; `git.diff` deliberately not used here), ADR-0043
(Post-Apply Validation — `postApplyValidationRef` shown as display-only context via `commandExecutions.get`),
ADR-0023 (CAP-002 Git — read-only; **no mutation method added**), ADR-0031 (Execution Orchestrator —
deliberately not extended or called). Supersedes nothing. Plan:
`docs/plans/sprint-2x-explicit-git-commit-approval-plan.md`.

## ADR-0046 — Approved Git Commit Execution (COMMIT_APPROVED → single exact-file `git commit`, first Git mutation)

- **Status:** ✅ Accepted (v2, Phase 2, Sprint 2y — Product Construction), Chief Architect Review:
  APPROVED WITH CHANGES (14 required changes applied) → PROCEED.
- **Date:** 2026-07-03
- **Scope:** After Sprint 2x leaves a `COMMIT_APPROVED` anchor (a HIGH commit approval was granted, but
  nothing was committed), an explicit commit-**execution** command ("승인된 커밋 실행해줘") re-reads git status,
  re-verifies the live approval + exact candidate scope against the fresh working tree, and performs **a
  single exact-file `git commit`** via the Git capability. This is the product's **FIRST real git mutation**.
  **NO `git add`, NO push, NO PR, NO deployment, NO rollback, NO CommandExecution/shell, NO
  WorkspaceWrite/Patch/CodeGeneration, NO ExecutionOrchestrator change.**

### Most important rule
> **The commit is executed only when the approved scope still exactly matches a freshly-read working tree.**
> The runtime re-reads `git.status`, re-verifies the live `ApprovalRequest` (exists, APPROVED, same plan) and
> that the in-scope tracked-changed set **equals** the approved candidate set, then commits exactly those
> tracked files through the Ref-gated `GitManager.commitFiles`. `GIT_COMMITTED` means **committed locally,
> never pushed/deployed** — every reply says so. Any scope drift, stale approval, untracked candidate, or
> result-integrity mismatch → **safe failure, no commit** (a new approval is required).

### Decision
- **First mutating Git API (Q1, CA #1/#6/#7/#8/#13).** `GitCommitResult {commitHash, committedFiles, message}`
  (domain) + `GitProvider.commitFiles(rootPath, files, message)` (the **first** mutating port method) +
  `GitManager.commitFiles({rootPath, files, message, approvalRef})`. The **manager** is Ref-gated
  (`approvalRef.status === APPROVED`, mirrors `WorkspaceWriteManager.apply`) **plus** defensive input
  validation (non-empty rootPath/files, safe relative paths, unique after trim, valid bounded single-line
  message); the **provider** independently validates + de-dups paths (absolute/`..`/empty rejected **before
  any git runs**) and is argv-only. **`ApprovalRef` goes to the manager, not the provider (CA #13).**
- **No pre-commit `git add`; tracked-file exact commit only (Q2, CA #1/#2).** The adapter runs a single
  `git commit --only -m <message> -- <files>` of the exact **tracked** pathspecs, then `rev-parse HEAD` for
  the sha. A separate `git add` was rejected: it would persist a partial stage if the commit then failed, and
  Sprint 2y has **no rollback**. **Untracked approved candidates are blocked** with a DISTINCT reply
  (`composeCommitExecutionUntrackedUnsupported`, CA #3) — a new-file commit needs a separate future step.
- **`ConversationRuntime` composes it directly.** New anchor status `GIT_COMMITTED` (a commit was executed) +
  fields `commitHash`/`committedFiles`. **No `GitCommit` aggregate** (Q9) — the hash + files live on the anchor.
- **Trigger + routing (§5.4, CA #4).** `interpretCommitExecutionIntent`: a push/reset/… phrase →
  `'push-unsupported'` (checked first); an explicit execution phrase ("승인된 커밋 실행"/"커밋 실행"/"이제 실제
  커밋"/"execute commit"/…) → `'execute'`; bare 좋아/오케이/확인/진행해/다음 단계 → null. Execution handling is
  **gated to commit-relevant states only** — inside `COMMIT_APPROVED` (execute → run) and `GIT_COMMITTED`
  (execute → already-committed) blocks, checked **before** the 2x commit-intent so "이제 실제 커밋해줘" executes
  rather than re-printing already-approved. An explicit `'execute'` phrase with no commit-relevant anchor →
  scoped `composeCommitExecutionUnavailable`. push-only outside commit states is left to existing 2w/2x handling.
- **Exact-scope re-validation against fresh status (§5.5, Q3/Q4/Q5/Q6, CA #2/#11).** Sets are normalized via
  `safeRelativePath` + de-duplicated (a candidate in BOTH staged and unstaged is still eligible). Block (→
  new approval required) on: an unsafe/out-of-`targetFiles` approved candidate; any unsafe changed path; a
  candidate no longer a tracked change (`missing`, Q5); an extra in-scope tracked change beyond the candidates
  (`extraInScope`, Q6); any changed file (tracked or untracked) outside `targetFiles` (`outOfScope`, Q4); any
  staged file outside the candidates (`stagedOutsideCandidates`, Q3). An untracked approved candidate → the
  DISTINCT untracked-unsupported reply. The approved message is re-checked with `isValidCommitMessage`;
  invalid → new approval required (Q7). Never regenerate, ask AI, or accept a new message at execution.
- **Result-integrity gate BEFORE trusting the commit (Q10, CA #8).** After `git.commitFiles`: `commitHash`
  non-empty + SHA-shaped (`/^[0-9a-f]{7,40}$/i`); `committedFiles` (normalized) **exactly equal** the approved
  candidates; `message` **equals** the approved message. Any mismatch → safe failure
  (`composeCommitExecutionFailed`), **`GIT_COMMITTED` not set**, do not claim committed.
- **On success (Q9/Q10, CA #9).** Re-anchor `GIT_COMMITTED` storing `commitHash` + `committedFiles`;
  **preserve `commitApprovalId`** (audit/threading) + `workspaceRef`/`workspaceChangeRef`/`targetFiles`/
  `executionPlanRef`/`postApplyValidationRef` (a future push sprint needs them); **clear**
  `proposedCommitMessage` + `commitCandidateFiles` (replaced by `committedFiles`/hash). Reply: short hash +
  bounded files + **no push**. Repeat execution at `GIT_COMMITTED` → `composeCommitAlreadyCommitted` (hash
  shown), **no new commit** (Q11).
- **Failure wording (Q8, CA #10).** A `git commit` throw or integrity mismatch → `composeCommitExecutionFailed`,
  which states **not committed + no push + rollback NOT performed + re-check git state**; it MUST NOT claim
  변경 없음 / 원상복구 완료 / index unchanged / 안전하게 되돌렸어요. Raw stderr never reaches the reply (adapter
  masks). A `git.status` read throw reuses `composeCommitStatusUnavailable` (2x).
- **No Core/Orchestrator contract change; no `app.module.ts` change** (the `git` runtime dep already carries
  the already-registered `GitManager`; `commitFiles` is a type-only widening). No CommandExecution/shell git,
  no WorkspaceWrite/Patch/CodeGeneration/Orchestrator, no runtime shell-out.

### Not implemented (out of scope)
`git add`/`push`/`reset`/`checkout`/`stash`/`branch`/`tag`/`merge`/`rebase` · untracked/new-file commit ·
automatic commit · AI commit messages · accepting a new message at execution · a `GitCommit` aggregate ·
CommandExecution-based git · runtime shell-out · WorkspaceWrite · Patch · CodeGeneration ·
ExecutionOrchestrator change · PR creation · deployment · rollback/revert · pushing/deploying the commit ·
overclaim (pushed/deployed/ready-to-push/safe-to-deploy).

### Consequences
- + The user can, for the first time, execute a git commit of the bot-applied change — behind an explicit
  execution command, gated by a still-valid HIGH approval and an exact-scope re-check against a freshly-read
  working tree, committing exactly the approved tracked files and nothing else.
- + Ref-gating the manager (mirroring `WorkspaceWriteManager`) plus independent provider path validation and a
  post-commit result-integrity gate keeps the first git mutation conservative and auditable; a mismatch never
  claims success.
- + Reusing the plan-less anchor + status interception keeps `findPending` from hijacking the flow and adds no
  new capability/port/aggregate/dep.
- − `ApplyPreviewAnchor` gains one status + two fields; `GitProvider`/`GitManager` gain one mutating method
  each — a justified, individually-reviewed extension, not scope creep. Nothing is persisted beyond the hash +
  committed paths on the anchor (no raw diff, no aggregate).
- − Only a commit is performed; **push/deploy remain a separate, individually-reviewed future sprint**, and
  untracked/new-file commits are deliberately deferred (no `git add` this sprint).

### Relations
ADR-0045 (Explicit Git Commit Approval — provides the `COMMIT_APPROVED` anchor + `commitApprovalId`/
`proposedCommitMessage`/`commitCandidateFiles` this sprint consumes; the plan-less anchor + status-interception
pattern reused), ADR-0042 (PatchRef → WorkspaceWrite Apply — the **Ref-gate model** `GitManager.commitFiles`
mirrors `WorkspaceWriteManager.apply`), ADR-0025 (CAP-004 Approval — `ApprovalManager.get`/`approvalRef`
reused), ADR-0044 (Post-Validation Git Status Preview — read-only `git.status` reused for the fresh re-read),
ADR-0023 (CAP-002 Git — **extended from read-only with its first mutating method**, argv-only, no push),
ADR-0031 (Execution Orchestrator — deliberately not extended or called). Supersedes nothing. Plan:
`docs/plans/sprint-2y-approved-git-commit-execution-plan.md`.

## ADR-0047 — Explicit Git Push Approval (GIT_COMMITTED → push approval halt, NO remote mutation)

- **Status:** ✅ Accepted (v2, Phase 2, Sprint 2z — Product Construction), Chief Architect Review:
  APPROVED WITH CHANGES (14 required changes applied) → proceed.
- **Date:** 2026-07-03
- **Scope:** After Sprint 2y leaves a `GIT_COMMITTED` anchor (a local commit exists, nothing pushed), an
  explicit git-**push** request ("푸시해줘"/"원격에 올려줘"/"git push 해줘"/"push this commit") **plans** a
  push: re-verifies the committed context, performs the read-only Git inspection needed to prepare a push,
  creates a **CRITICAL `ApprovalRequest`**, and halts at `PUSH_APPROVAL_PENDING` → approve → `PUSH_APPROVED`.
  **This sprint performs NO remote mutation** — no `git push`, not even after approval (execution is a future
  Sprint 3a+). It only creates the approval gate.

### Most important rule
> **`git push` mutates a remote, shared repository, so Sprint 2z stops before it.** The runtime reads only
> `git.info` + `git.status` (read-only, **no network fetch**, no CommandExecution/shell), creates a CRITICAL
> `ApprovalRequest`, and halts. Nothing push-mutating runs — not on request, not on approval. `PUSH_APPROVED`
> means the push was **approved, not performed**, and is a **point-in-time snapshot** (future push execution
> must re-read HEAD/upstream/ahead/behind before mutating). There is **no `GIT_PUSHED`/`PUSHED` state** and no
> overclaim (pushed / ready-to-push / push-safe / deployed / PR-created).

### Decision
- **Push is a remote repository mutation; Sprint 2z creates the approval gate only.** Reuses
  `ApprovalManager.requestForRisk`/`decide`/`get` + `approvalRef()` (CAP-004) and the 2x/2y approval-halt
  pattern (plan-less anchor + status interception, `interpretDecision`/`decisionOf`/`composeApprovalNotice`).
  `requestForRisk` creates a PENDING **CRITICAL** request (never auto-approves; `RiskPolicy.requiresApproval`
  is true for CRITICAL). **Risk is CRITICAL** — remote shared-state mutation, a larger blast radius than a
  local commit (HIGH in 2x).
- **`GIT_COMMITTED` required; explicit push phrase required; NO global/no-anchor push handling (CA #1).**
  Push handling is anchored to `GIT_COMMITTED` (plan a push) / `PUSH_APPROVAL_PENDING` (intercept → decision)
  / `PUSH_APPROVED` (already approved) only. `WORKSPACE_APPLIED` (2w mutating reject), `COMMIT_APPROVED` (2y
  `composeCommitPushUnsupported`), `COMMIT_APPROVAL_PENDING` (2x decision), and **no anchor** (existing
  classification/fallback) are all UNCHANGED. No automatic push after a local commit or after approval.
- **New anchor statuses `PUSH_APPROVAL_PENDING` / `PUSH_APPROVED`.** No `GIT_PUSHED`/`PUSHED`. Push context is
  **distinct** from commit context (CA #3): `pushApprovalId`/`pushCommitHash`/`pushRemote`/`pushBranch`/
  `pushUpstreamRef` — **preserved at `PUSH_APPROVED` (CA #8)**; cleared only on deny/cancel (revert to
  `GIT_COMMITTED`); commit context preserved throughout.
- **Trigger detection (CA #2).** `interpretPushIntent`: a forbidden-companion is classified **only when a
  push word is present** — a bare "배포"/"branch"/"tag"/"reset" is NOT push handling. push + force/PR/deploy/
  tag/branch/reset/checkout/stash/merge/rebase → `composePushUnsupportedCompanion` (no approval); a plain
  push word → push approval; else null (→ existing fallback).
- **Read-only inspection (CA #1-Q1).** Reuses `GitManager.info` (branch/headSha/detached) + `GitManager.status`,
  with a read-only **parser extension**: `git status --porcelain=v1 -b` already fetches the
  `## <branch>...<remote>/<branch> [ahead N, behind M]` header, so the parser now populates the reserved
  `GitStatus.ahead`/`behind` **plus a new `GitStatus.upstream?`** — **no new git subcommand, no new spawn, no
  network fetch**. No `GitProvider`/`GitManager` push method (CA #14). The runtime `git` dep is widened with
  `info` (type-only). No upstream ⇒ `upstream`/`ahead`/`behind` all `undefined` (distinct from `0`, CA #12).
- **Pre-approval verification (Constraint 8, CA #5/#10/#11).** Block (no approval) on: incomplete committed
  context; commitHash not SHA-shaped; `git.info`/`git.status` read failure (`composePushStatusUnavailable`);
  **detached HEAD or HEAD ≠ committed hash** (`composePushHeadMovedUnavailable`); **dirty working tree**
  (`composePushDirtyWorkingTree`, CA #10); **no or unparseable upstream** (`composePushNoUpstream`; upstream
  must parse to `<remote>/<branch>` with non-empty parts, no control chars, bounded, remote whitespace-free —
  CA #5); branch not ahead (`composePushNothingToPush`); behind > 0 diverged (`composePushDiverged`, no force).
  Remote/branch are **derived from the upstream, never user-provided** (Constraint 7); split on the FIRST `/`
  (branch may contain `/`, e.g. `feature/x`). All facts are point-in-time.
- **Approval reason (CA #4/#6/#7/#13).** operation "git push approval planning" · commit sha · **bounded**
  remote/branch/upstream · ahead count · risk CRITICAL · "no git push has been performed" · "records
  permission only; actual git push is NOT executed in Sprint 2z — future execution requires a separate step" ·
  "point-in-time snapshot; re-read Git state before pushing". **No raw diff/file content; NO validation/test
  "push-ready" context (CA #13).**
- **Strict decision guards (CA #3/#9).** Before deciding: complete pending context (`PUSH_APPROVAL_PENDING` +
  `pushApprovalId` + `pushCommitHash` + `pushRemote` + `pushBranch` + `pushUpstreamRef` + `commitHash` +
  `workspaceRef` + `executionPlanRef`) and `approvals.get(pushApprovalId)` exists/PENDING/same-plan. Any
  failure → safe failure, no `decide`/git/re-anchor. **A push/force/deploy phrase while pending is ambiguous
  → re-prompt** (never routed to unsupported-companion; the pending approval stays primary). Approve →
  `PUSH_APPROVED` preserving all context; deny/cancel → `GIT_COMMITTED` clearing only push fields. NO git push.
- **No Core/Orchestrator contract change; no `app.module.ts` change.** No CommandExecution/shell git; runtime
  never shells out. No `GitProvider`/`GitManager` push method.

### Not implemented (out of scope)
Actual `git push` execution (Sprint 3a+) · `GitProvider.push`/`GitManager.push`/a push dep method · force
push (`--force`/`-f`/강제) · PR creation · deployment · automatic push · push from any state other than
`GIT_COMMITTED` · a global/no-anchor push handler · user-provided/arbitrary remote or branch · upstream
creation · tags · branch creation · `reset`/`checkout`/`stash`/`merge`/`rebase` · a `GIT_PUSHED`/`PUSHED`
state · durable push-ready/deploy-ready/clean-tree semantics · `GitCommit` aggregate · CommandExecution git ·
runtime shell-out · WorkspaceWrite/Patch/CodeGeneration · ExecutionOrchestrator change.

### Consequences
- + The user can, for the first time, request a git push of the local commit and get a bounded, read-only
  push-target summary + a CRITICAL approval gate — behind an explicit request, gated by a clean tree, an
  existing upstream, and an ahead-not-diverged branch, with zero remote mutation.
- + Reusing the read-only `-b` header data (already fetched) for upstream/ahead/behind keeps the surface
  minimal (no new git command, no network fetch); the CRITICAL gate matches push's blast radius.
- − `ApplyPreviewAnchor` gains two statuses + five push fields; `GitStatus` gains `upstream?`; a justified
  extension for the future push-execution sprint, not scope creep; nothing new is persisted.
- − Approval is recorded but the push is deliberately not performed and is not durable push-ready; actual
  `git push` remains a separate, individually-reviewed future sprint that must re-read Git state first.

### Relations
ADR-0046 (Approved Git Commit Execution — provides the `GIT_COMMITTED` anchor + `commitHash`/`committedFiles`
this sprint consumes), ADR-0045 (Explicit Git Commit Approval — the approval-halt + plan-less anchor +
status-interception pattern reused, and the distinct-approval-id discipline), ADR-0044 (Post-Validation Git
Status Preview — read-only `git.status` reused; the `-b` parser extended for upstream/ahead/behind), ADR-0025
(CAP-004 Approval — `ApprovalManager`/`approvalRef` reused, risk CRITICAL), ADR-0023 (CAP-002 Git — read-only
`info`/`status` reused, **no push mutation added**), ADR-0031 (Execution Orchestrator — deliberately not
extended or called). Supersedes nothing. Plan:
`docs/plans/sprint-2z-explicit-git-push-approval-plan.md`.

## ADR-0048 — Approved Git Push Execution (PUSH_APPROVED → exact approved `git push`, first remote mutation)

- **Status:** ✅ Accepted (v2, Phase 3, Sprint 3a — Product Construction), Chief Architect Review:
  APPROVED WITH CHANGES (16 required changes applied) → proceed.
- **Date:** 2026-07-03
- **Scope:** After Sprint 2z leaves a `PUSH_APPROVED` anchor (a CRITICAL push approval is recorded, nothing
  pushed), an explicit push-**execution** command ("승인된 push 실행해줘"/"push 실행해줘"/"이제 실제 push
  해줘"/"execute approved push"/"push approved commit") performs **the exact approved push**: re-verifies the
  live approval + the persisted approved target, **re-reads Git state**, re-validates HEAD/upstream/ahead/
  behind/clean-tree against the approved snapshot, then pushes exactly the approved commit to the exact
  approved upstream and re-anchors `GIT_PUSHED`. This is the product's **FIRST real remote mutation**.

### Most important rule
> **A push is only ever the exact approved commit to the exact approved upstream, and only after the approved
> Git snapshot is re-proven against a fresh read.** Any drift → **no push, safe failure**. `GIT_PUSHED` means
> pushed to the approved upstream — **never PR-created, never deployed, never ready-to-push/push-safe/
> deploy-ready.** Because a push mutates a remote that may already have changed by result-validation time,
> the wording never claims "remote unchanged" unless provable and **never rolls back**.

### Decision
- **Second mutating Git method; first REMOTE mutation (Q1/Q2, CA #1/#4/#15).** `GitPushResult
  {remote,branch,upstreamRef,commitHash}` (domain) + `GitProvider.pushApprovedCommit(rootPath,remote,branch,
  commitHash)` + `GitManager.pushApprovedCommit({rootPath,remote,branch,commitHash,approvalRef})`. Mirrors
  the 2y commit template: the **manager** is Ref-gated (`approvalRef.status === APPROVED`) + defensive
  validation (safe remote/branch, SHA-shaped commitHash); the **provider** independently validates the
  target and is argv-only. **`ApprovalRef` → manager, not provider.** **No generic `push` API** (CA #15).
  **`GitPushResult` is the provider-reported successful target after `git push` exited 0 — NOT an independent
  remote verification (CA #1);** the runtime uses it only for local result-integrity checking; replies never
  overclaim (verified-forever / push-safe / deploy-ready).
- **Exact command (Q3, CA #5).** `git --no-pager push <remote> HEAD:<branch>` — argv only, one refspec
  element. **Never** bare `git push`/`--all`/`--tags`/`--force`/`-f`/`-u`/`--set-upstream`, no arbitrary
  refspec, no user-provided remote/branch. `HEAD:<branch>` pushes the current HEAD (runtime-verified ==
  `commitHash`) to the approved branch on the approved remote.
- **Conservative git ref validation (Q4, CA #4).** A shared `push-target.ts` (`isSafePushRemote` /
  `isSafePushBranch`) reused by the runtime pre-mutation guard, the manager backstop, and the adapter's
  `assertSafePushTarget`. remote: non-empty, bounded, no leading `-`, no `/`/`:`/whitespace/control. branch:
  may contain single `/`; rejects leading `-`/`/`, whitespace, control, `:` `~` `^` `?` `*` `[` `\`, `..`,
  `@{`, `//`, trailing `/`, `.lock` suffix. An unsafe branch **never reaches argv** (adapter throws first,
  CA #5); shell escaping is not a substitute.
- **`ConversationRuntime` composes it directly.** New anchor status `GIT_PUSHED` + fields
  `pushedCommitHash`/`pushedRemote`/`pushedBranch`/`pushedUpstreamRef`. **No `GitPush` aggregate** (Q11).
  Runtime `git` dep widened with `pushApprovedCommit` (type-only).
- **Trigger + routing (CA #7/#8/#9).** `interpretPushExecutionIntent`: a forbidden-companion is classified
  only when a push/exec word is present (2z CA #2 lesson); an explicit execution phrase → `'execute'`; a
  bare push word (no exec word) → null (→ 2z already-approved). Execution handling is **gated to
  `PUSH_APPROVED` (execute) and `GIT_PUSHED` (already-pushed) only**. `GIT_COMMITTED` + a push-execution
  phrase stays the **2z push-APPROVAL** flow (both "이제 실제 push 해줘" and "execute approved push" contain
  a push word → CRITICAL approval, not execute — CA #8); `PUSH_APPROVAL_PENDING` stays the 2z decision flow
  (ambiguous → re-prompt — CA #9). `GIT_PUSHED` + execution/push phrase → already pushed (CA #7); + PR/deploy
  phrase → already-pushed + future-sprint (CA #13).
- **Re-validation before mutation (Constraint 3/4, Q5-Q9, CA #3/#6).** Block (no push) on: incomplete
  context; **unsafe/malformed persisted target** (CA #3); approval not APPROVED/plan-mismatched/missing;
  `git.info`/`git.status` read failure; detached HEAD or `HEAD !== pushCommitHash` or `commitHash !==
  pushCommitHash`; dirty working tree; `upstream` missing/`!== pushUpstreamRef` or parsed remote/branch `!==`
  the approved; ahead < 1; behind > 0. **The approved target is the upstream ref, not the local branch name;
  `info.branch` is used only for detached detection + logging — local branch is NOT required to equal
  `pushBranch` (CA #6).**
- **Result integrity + remote-mutation safety (Q10, CA #2/#10/#11/#16).** After a successful provider push,
  a result-integrity gate checks `remote`/`branch`/`upstreamRef`/`commitHash` == the approved; a mismatch →
  `composePushResultUnverified` ("push may have been attempted; result could not be verified; check the
  remote; no rollback"), **keep `PUSH_APPROVED`, no `GIT_PUSHED`**. A provider throw →
  `composePushExecutionFailed` ("push did not complete; check the remote if unsure; no rollback"; never
  "remote unchanged"), **keep `PUSH_APPROVED`, no `GIT_PUSHED`**. Pre-push failures may state git push was
  **not attempted**. **Remote rollback is not attempted in Sprint 3a; any remote correction requires a
  separate CA-gated plan.**
- **On success (Q12, CA #12/#14).** Re-anchor `GIT_PUSHED`, store the pushed target, **preserve the full
  audit context** (`pushApprovalId`/`pushCommitHash`/`pushRemote`/`pushBranch`/`pushUpstreamRef`/
  `commitApprovalId`/`commitHash`/`committedFiles`/`workspaceRef`/`workspaceChangeRef`/`targetFiles`/
  `executionPlanRef`/`postApplyValidationRef`). Reply: short hash + remote/branch + **no PR/deployment**, no
  readiness claims.
- **No Core/Orchestrator contract change; no `app.module.ts` change** (the `git` dep carries the
  already-registered GitManager). No CommandExecution/shell git; runtime never shells out and never builds
  low-level push argv (the capability owns it).

### Not implemented (out of scope)
force push (`--force`/`-f`/강제) · bare `git push`/`--all`/`--tags`/`-u`/`--set-upstream` · arbitrary
refspec/remote/branch · user-provided remote/branch · upstream/branch creation · tags · PR creation ·
deployment · automatic push · push from any state other than `PUSH_APPROVED` · a generic `push` API ·
CommandExecution-based git · runtime shell-out · reset/checkout/stash/merge/rebase · **remote-mutation
rollback** · a `GitPush` aggregate · ExecutionOrchestrator change · WorkspaceWrite/Patch/CodeGeneration.

### Consequences
- + The user can, for the first time, execute a git push of the approved local commit — behind an explicit
  execution command, gated by a still-valid CRITICAL approval and an exact-snapshot re-check against a
  freshly-read Git state, pushing exactly the approved commit to the exact approved upstream and nothing else.
- + Mirroring the 2y Ref-gate + provider-argv + result-integrity template, plus conservative ref validation
  and the "provider result is not independent remote verification" framing, keeps the first remote mutation
  conservative and honest under partial-failure uncertainty.
- − `ApplyPreviewAnchor` gains one status + four pushed fields; `GitProvider`/`GitManager` gain one mutating
  method each; a shared ref validator is added — a justified, individually-reviewed extension. Nothing is
  persisted beyond the pushed target on the anchor (no aggregate).
- − Only a push is performed; **PR creation and deployment remain separate, individually-reviewed future
  sprints**, and remote rollback is deliberately not attempted.

### Relations
ADR-0047 (Explicit Git Push Approval — provides the `PUSH_APPROVED` anchor + `pushApprovalId`/`pushCommitHash`/
`pushRemote`/`pushBranch`/`pushUpstreamRef` this sprint consumes), ADR-0046 (Approved Git Commit Execution —
the Ref-gate + provider-argv + result-integrity template mirrored), ADR-0044/ADR-0047 (read-only `info`/
`status` + upstream/ahead/behind parser + `parsePushUpstream` reused for the fresh re-validation), ADR-0025
(CAP-004 Approval — `ApprovalManager.get`/`approvalRef` reused, risk CRITICAL), ADR-0023 (CAP-002 Git —
**second mutating method, the first remote**, argv-only), ADR-0031 (Execution Orchestrator — deliberately not
extended or called). Supersedes nothing. Plan:
`docs/plans/sprint-3a-approved-git-push-execution-plan.md`.

## ADR-0049 — Explicit Pull Request Creation Approval (GIT_PUSHED → CRITICAL PR-creation approval halt, no PR creation)

- **Status:** ✅ Accepted (v2, Phase 3, Sprint 3b — Product Construction), Chief Architect Review:
  APPROVED WITH CHANGES (16 required changes applied) → proceed.
- **Date:** 2026-07-03
- **Scope:** After Sprint 3a leaves a `GIT_PUSHED` anchor (the approved commit was pushed to the approved
  upstream), an explicit PR-creation phrase ("PR 만들어줘"/"pull request 만들어줘"/"GitHub PR 열어줘"/"깃허브 PR
  만들어줘"/"open a PR"/"create pull request"/"merge request 만들어줘") records a **CRITICAL Pull-Request-creation
  approval**: verify the persisted pushed context, derive a deterministic PR target (head = pushed branch,
  base = fixed policy `main`) + a bounded deterministic title/body, create one CRITICAL `ApprovalRequest`,
  re-anchor `PR_APPROVAL_PENDING`, and return `AWAITING_APPROVAL`. On "승인" the approval is **recorded only**
  → `PR_APPROVED`. **No Pull Request is created.**

### Most important rule
> **A Pull Request is a repository-hosting/platform mutation, not a local Git operation.** Sprint 3b adds an
> **approval gate only** — no PR creation, no GitHub API call, no provider/manager PR method. `PR_APPROVED`
> means the user granted permission to create a PR; it **never** means a PR was created, deployed, merged,
> released, or made production-ready. Approval is based on the pushed context currently recorded by ChunsikBot;
> it does **not** verify the branch on the hosting provider and does **not** guarantee a PR can be created.

### Decision
- **PR creation is NOT a Git capability responsibility (Q1, CA #1/#13).** No PR/hosting surface exists in the
  repo today. For approval-only 3b, **no provider is added** — no `GitHubProvider`/`RepositoryHosting`, no
  `GitManager.createPullRequest`/`GitProvider.createPullRequest`, no `createPullRequest` of any kind. The
  entire flow lives in `ConversationRuntime` + `ApprovalManager` (CAP-004) + `ResponseComposer` + the
  apply-preview anchor. Actual PR creation belongs to a **future Repository-Hosting/GitHub capability** (3c+).
- **Two new anchor states + distinct PR context (Q2/Q3, CA #3/#15/#16).** `PR_APPROVAL_PENDING` / `PR_APPROVED`
  (no `PR_CREATED`/`PULL_REQUEST_CREATED`). New fields **distinct** from push/commit/apply ids: `prApprovalId`,
  `prPushedCommitHash`, `prHeadBranch`, `prBaseBranch`, `prTitle`, `prBodyPreview`. Set at
  `PR_APPROVAL_PENDING`; **all** preserved at `PR_APPROVED`; on deny/cancel **only** these PR fields are
  cleared (pushed/commit/workspace context preserved) and the anchor reverts to `GIT_PUSHED`.
- **Trigger discipline (Q4/Q5, CA #1/#2/#3).** `interpretPrIntent`: a PR-ish noun (`PR`/`pull request`/`풀
  리퀘`/`merge request`/`MR`, incl. `깃허브 PR`) is **not** sufficient — an explicit create/open verb
  (`만들`/`생성`/`열`/`올려`/`open`/`create`) is **required**; a bare noun → null (no PR approval). A
  forbidden companion (deploy/배포, merge/머지/병합, release/릴리즈, auto-merge/자동 머지, force/강제, reset/
  checkout/stash/rebase/tag/branch-creation) is classified only when a PR word is present (2z CA #2 lesson) →
  `'pr-unsupported'`. `merge request` is a PR synonym (needs a verb), distinct from a bundled `merge`
  (`\bmerge\b(?!\s*request)`, rejected). Gated to `GIT_PUSHED` / `PR_APPROVAL_PENDING` / `PR_APPROVED` only;
  every other state keeps existing behavior and creates no PR approval.
- **Deterministic PR target (Q6/Q7/Q8, CA #6/#10/#11).** `prBaseBranch` = single named constant
  `PR_BASE_BRANCH_POLICY = "main"` — a **stated ChunsikBot V2 product policy**, since `RepositoryInfo` exposes
  no default branch and no configured default-branch source exists; never inferred, never user-provided.
  `prHeadBranch` = `anchor.pushedBranch`, re-validated with `isSafePushBranch`. If `head === base` → **no
  approval**, worded as a **product/base-policy limitation** (not a Git error, not a PR-creation attempt).
- **Deterministic bounded title/body (Q8, CA #4/#5).** `proposedCommitMessage` is cleared at `GIT_COMMITTED`,
  so the commit message is unavailable at `GIT_PUSHED`; `prTitle` = sanitized `instruction` (strip control
  chars, remove backticks + leading markdown heading markers, collapse whitespace, bound to `MAX_PR_TITLE`),
  fallback "Apply approved changes". `prBodyPreview` = generated-by-ChunsikBot + short hash + head→base +
  committed-file **count only (NO file paths)** + "no deployment"; **no** raw diff, **no** file content, **no**
  secrets. Nothing leaves the system in 3b (surfaced locally + stored on the anchor only).
- **CRITICAL approval + explicit reason (Constraint 4, CA #6).** `RiskLevel.CRITICAL` (PR creation mutates
  shared collaboration state: CI, notifications, reviews, branch protections, automations, deploy pipelines).
  `buildPrApprovalReason` explicitly states: no PR created, **no deployment performed, no merge performed**,
  permission only, not performed in Sprint 3b, **future execution requires a separate repository-hosting
  step**, includes pushedCommitHash + head/base, and the "not verified on hosting / not guaranteed creatable"
  discipline.
- **No fresh Git read (CA #12).** 3b uses the `GIT_PUSHED` anchor as the source of truth and re-validates the
  persisted target strings (SHA-shaped `pushedCommitHash == pushCommitHash == commitHash`; safe `pushedRemote`/
  `pushedBranch`; `pushedUpstreamRef` parses and its parsed remote/branch match) — it does **not** call
  `git.info`/`git.status`, because nothing is mutated. **Actual PR-creation execution (future) MUST re-validate
  hosting/branch state before mutating.**
- **Decision flow mirrors 2z (CA #7/#14).** `PR_APPROVAL_PENDING` intercepts every turn: a PR-creation /
  PR+forbidden / deploy-only phrase is a premature request → **ambiguous re-prompt** (no decide, no PR); a
  bare "승인"/"거절"/"취소" decides after verifying the referenced `ApprovalRequest` exists/PENDING/plan-matches.
  Approve → `PR_APPROVED` (record only); deny/cancel → `GIT_PUSHED` clearing only PR fields. NO PR creation on
  any path.
- **State-appropriate deploy-only wording (CA #8).** A bare deploy phrase (배포/deploy, no PR): at `GIT_PUSHED`
  → `composePushPrDeployUnsupported` (deploy-only, "이미 push된 상태예요"); at `PR_APPROVED` →
  `composePrApprovedDeployUnsupported` ("PR 승인은 기록됐지만 배포는 아직 지원 안 함; PR도 배포도 하지 않음").

### Consequences
- + The product gains an explicit, auditable, CRITICAL approval gate before any repository-hosting mutation,
  keeping remote-collaboration side effects behind human approval — consistent with the commit/push gates.
- + Reuses the 2z push-approval template (request → `*_APPROVAL_PENDING` → decision → `*_APPROVED`) and the 3a
  pushed context + ref validators; adds no capability and no provider.
- − `ApplyPreviewAnchor` gains two statuses + six PR fields; `ConversationRuntime`/`ResponseComposer` gain the
  PR-approval flow. Nothing is persisted beyond the PR context on the anchor; no external system is touched.
- − Only approval is recorded; **actual PR creation, deployment, and merge remain separate, individually-
  reviewed future sprints** owned by a future Repository-Hosting/GitHub capability.

### Relations
ADR-0048 (Approved Git Push Execution — provides the `GIT_PUSHED` anchor + `pushedCommitHash`/`pushedRemote`/
`pushedBranch`/`pushedUpstreamRef` this sprint consumes; **its `GIT_PUSHED` PR-phrase behavior is superseded**
— a PR-creation phrase now records an approval, while deploy-only phrases remain unsupported/future), ADR-0047
(Explicit Git Push Approval — the CRITICAL request → `*_APPROVAL_PENDING` → decision → `*_APPROVED` template
mirrored), ADR-0045 (Explicit Git Commit Approval — decision-flow structure), ADR-0025 (CAP-004 Approval —
`requestForRisk`/`get`/`decide`, risk CRITICAL), ADR-0023 (CAP-002 Git — read-only reuse only; **no** PR/
hosting method added), ADR-0031 (Execution Orchestrator — not extended or called). **Supersedes ADR-0048's
`GIT_PUSHED` PR-phrase behavior only.** Plan:
`docs/plans/sprint-3b-explicit-pr-creation-approval-plan.md`.

## ADR-0050 — Repository Hosting Capability (design-only; CAP-010; future PR creation execution boundary)

- **Status:** ✅ Accepted (v2, Phase 3, Sprint 3c — Product Construction, **design-only / plan-only**), Chief
  Architect review: APPROVED WITH CHANGES (all applied) → CONFIRMED/ACCEPTED as the architecture direction. **No
  implementation** was produced by Sprint 3c; this ADR records the accepted design a future implementation
  sprint (3d-B/3d-C) will build against. Backfilled into `DECISIONS.md` in PR #25 (Sprint 3d-A) per CA
  Implementation Review, since ADR-0051 is a config-only subset of this design.
- **Date:** 2026-07-03
- **Scope:** The capability boundary for **actual Pull Request creation execution**. Sprint 3b (ADR-0049)
  settled that PR creation is a repository-hosting/platform mutation, not a Git operation; this ADR designs the
  independent capability that will own it. Sprint 3c is design-only — no code, no branch, no PR, no GitHub API.

### Most important rule
> **Pull Request creation is a repository-hosting/platform mutation, not a local Git operation.** It must never
> be added to `GitProvider`/`GitManager`/`CommandExecution`/runtime shell/`ExecutionOrchestrator`/
> `WorkspaceWrite`/`PatchManager`/`CodeGeneration`. A new independent **Repository Hosting** capability owns it —
> provider-agnostic at the domain/port level, GitHub (github.com only) as the first adapter. **Actual PR
> creation execution is blocked until a reviewed `RepositoryIdentity` configuration source exists** (delivered
> by Sprint 3d-A / ADR-0051); execution itself is a further sprint (3d-C).

### Decision (accepted design; not implemented in 3c)
- **RepositoryHosting is CAP-010.** Owns `RepositoryIdentity`, `RepositoryIdentityConfig`,
  `PullRequestCreationInput`, `PullRequestResult`, `PullRequestRef`, `RepositoryHostingProvider` (port),
  `RepositoryHostingManager` (application), `GitHubRepositoryHostingProvider` (adapter,
  `@chunsik/repository-hosting-github`). Does **not** own local git status/commit/push, workspace file
  mutation, code generation, deployment, merge, or release.
- **Provider-independent core (Q2).** core/domain/port carry no GitHub-specific shape; **GitHub is the first
  adapter only**, **github.com only** for the first implementation (GitHub Enterprise deferred to a later
  CA-approved sprint). Auth token, host, and URL rules live only inside the adapter package.
- **Git capability unchanged (Q4)** — no `GitManager.createPullRequest`, no `GitProvider.createPullRequest`.
  **`ExecutionOrchestrator` unchanged (Q5)** — the future flow stays `ConversationRuntime`-composed.
- **Repository identity (Q9).** Required from a **reviewed configuration source**; the codebase had **no** safe
  identity source before Sprint 3d-A (`RepositoryInfo` intentionally excludes remote URLs — ADR-0023). **No
  remote-URL parsing, no `RepositoryInfo.remoteUrl`, no raw pasted URL, no unbounded per-request owner/repo, no
  ChatGPT/GitHub connector in runtime product code, no `CommandExecution`/shell.** Actual PR creation is blocked
  until this identity config exists.
- **Approval consumed at the Manager (Q7/Q14, mirrors `GitManager`).** `RepositoryHostingManager` owns approval
  gating, input validation, **call ordering**, and result-integrity validation; the `ApprovalRef` is consumed
  at the Manager and **never** passed to the provider; the provider receives no `ApprovalRef` and no raw
  diff/file content, and owns **hosting API calls only**. No second approval when `PR_APPROVED` is live and the
  exact context (incl. `RepositoryIdentity`) matches, but an explicit PR-execution phrase is still required.
- **Mandatory future hosting-state checks (Q8).** `repositoryExists`, `branchExists(head)`, `branchExists(base)`,
  `findOpenPullRequest(head, base)` when the provider supports it, and `head != base`. **Existing-open-PR reuse
  is preferred (Q12)** — return it, validate its integrity like a new PR, anchor `PR_CREATED` with
  `pullRequestReused: true`; **no non-idempotent creation by default**. Commit reachability is deferred unless a
  provider method is added, and must not be overclaimed.
- **`PullRequestResult` is provider-reported, not independent truth (mirrors `GitPushResult`).** The Manager
  validates integrity against returned fields but must not overclaim. `PullRequestRef` includes
  `provider/owner/repo` (a PR number is repository-scoped).
- **`PR_CREATED` is a future state only (Q11).** Stores repository identity + `pullRequestRef`/number/url/head/
  base/`pullRequestCommitHash` (required) + `pullRequestReused`. **No merge/deploy/release semantics** —
  created/opened only. On failure: no fake success, no `PR_CREATED`, keep `PR_APPROVED`, no rollback, and an
  ambiguous provider response must not claim no PR was created.
- **Token/auth discipline.** Adapter-local only; never in domain types / `ApprovalRequest.reason` / the anchor /
  logs; provider errors sanitized. **Failure taxonomy** distinguishes not-configured / approval-invalid /
  hosting-unavailable / branch-missing / existing-PR-reused / creation-failed / creation-result-unverified.

### Consequences
- + Establishes the capability boundary and the hard identity prerequisite before any hosting mutation exists,
  keeping remote-collaboration side effects behind an explicit, reviewed, provider-agnostic surface.
- + Mirrors the CAP-002 Git Port/Manager/Adapter/Token pattern and the `GitPushResult` provider-reported
  discipline; adds no capability code in 3c.
- − This is design-only: no `RepositoryHostingProvider`/`Manager`/adapter, no `PR_CREATED`, no GitHub API, no
  PR creation exists yet; those are separate CA-gated implementation sprints (3d-B skeleton, 3d-C execution),
  each blocked until the reviewed `RepositoryIdentity` configuration (Sprint 3d-A / ADR-0051) is accepted.

### Relations
ADR-0049 (Sprint 3b — provides the `PR_APPROVED` anchor + PR context this design consumes; reaffirms "PR
creation is not Git capability responsibility"), ADR-0048 (Sprint 3a — `GIT_PUSHED` + the provider-reported
discipline mirrored by `PullRequestResult`), ADR-0047/ADR-0045 (approval-halt template lineage), ADR-0025
(CAP-004 Approval — reused unchanged), ADR-0023 (CAP-002 Git — the Port/Manager/Adapter pattern mirrored, and
the remote-URL-exclusion decision that grounds the identity problem). **Succeeded by ADR-0051** (Sprint 3d-A —
the config-only subset delivering the reviewed `RepositoryIdentity` source this design requires). Plan:
`docs/plans/sprint-3c-repository-hosting-capability-plan.md`.

## ADR-0051 — Repository Identity Configuration (safe reviewed `provider/owner/repo` source; no hosting mutation)

- **Status:** ✅ Accepted (v2, Phase 3, Sprint 3d-A — Product Construction), Chief Architect plan review:
  APPROVED WITH CHANGES (all 10 required changes applied) → implemented.
- **Date:** 2026-07-03
- **Scope:** The **config-only subset of the future Repository Hosting capability** (ADR-0050, Sprint 3c accepted
  design): the safe, reviewed source of `provider/owner/repo` a **future** PR-creation execution sprint (3d-C)
  will consume. It adds the `RepositoryIdentity`/`RepositoryIdentityConfig` domain types, exact validators, a
  pure `RepositoryIdentityResolver` (the safe missing-identity **detection path**), and the single env-reading
  config-loading path in `apps/chunsik/src/config.ts`. It performs **no** hosting mutation.

### Most important rule
> **Repository identity is explicit reviewed configuration** — a validated `{ provider:'github', owner, repo }`.
> It is **never** parsed from a git remote, **never** carries a token, and **never** widens `RepositoryInfo`
> (ADR-0023 stands — remote URLs stay excluded). This Sprint does **not** by itself satisfy PR-execution
> readiness: it implements no `RepositoryHostingProvider`, no hosting-state verification, no GitHub auth, no
> GitHub API call, and no PR creation. **Actual PR creation remains blocked until later Repository Hosting
> implementation Sprints (3d-B/3d-C) are accepted.**

### Decision
- **Where identity lives (Q1).** `apps/chunsik/src/config.ts` (the single documented env-reading site) reads
  **only** `CHUNSIK_GITHUB_OWNER` / `CHUNSIK_GITHUB_REPO` into a raw `RepositoryIdentityConfig`; it reads
  **no** `CHUNSIK_GITHUB_PROVIDER` and **no** token env var (`provider` is fixed to `'github'`). Framework-
  agnostic types, validators, and the resolver live in `packages/core`. `loadConfig(env = process.env)` gains
  an injectable `env` param (default `process.env`) for narrow testability (CA change 8) — env reading stays
  in this one file.
- **Global, not per-project (Q2).** Global runtime config for the first-narrow implementation. Grounded:
  `Project`/`ProjectManager.register(path, session)` capture a local path only with no reviewed identity
  field, and `Project.metadata` is an untyped unbounded `Record` (an unsafe identity source). Per-project
  identity is deferred to a later Sprint that adds a **reviewed typed** identity field to project registration
  — never the untyped `metadata` bag.
- **Validation (Q3, CA changes 1/4/5/6).** `isSupportedHostingProvider` (`github` only; GHE deferred);
  `isSafeRepoOwner` (`/^[A-Za-z0-9](?:-?[A-Za-z0-9])*$/`, ≤39 — no leading/trailing/consecutive hyphen);
  `isSafeRepoName` (`[A-Za-z0-9._-]`, ≤100; not `.`/`..`; **no leading dot**; **no `.git` suffix**). A
  conservative `looksLikeSecret` (case-insensitive) additionally rejects GitHub token prefixes (`ghp_`,
  `github_pat_`, `gho_`, `ghu_`, `ghs_`, `ghr_`) and credential-like substrings (`token`, `secret`,
  `password`, `pat_`) — **false rejection is acceptable** for identity config. Whitespace/control/URL are
  rejected by the character classes.
- **Exposure (Q4).** Future Repository Hosting receives a validated **`RepositoryIdentity`** — not the raw
  `RepositoryIdentityConfig` (pre-validation) and not a `Ref` (no persisted aggregate exists or is needed for
  a tiny immutable value). The resolver returns `{ status:'resolved', identity }` or `{ status:'missing',
  reason }` where `reason ∈ { not-configured, unsupported-provider, invalid-owner, invalid-repo }` — a fixed
  enum, never an echoed input value.
- **No secrets (Q5, CA change 1).** `RepositoryIdentity`/`RepositoryIdentityConfig` have **no** token field
  and **no** remoteUrl field; the resolver copies **only** `provider`/`owner`/`repo` (never spreads config, so
  an incidental extra key cannot leak); the resolver never logs and never throws (constructor arity 0). The
  app config reads no token env var. Sprint 3d-A adds no anchor field and no approval-reason text, so a token
  cannot reach the anchor / `ApprovalRequest.reason` / logs.
- **Missing identity fails safely (Q8).** `RepositoryIdentityResolver.resolve` returns a safe `missing` result
  (both owner+repo absent → `not-configured`; one present → `invalid-owner`/`invalid-repo`), which a future
  execution sprint maps to a "PR 생성 대상 저장소가 설정되지 않았어요. PR은 만들지 않았어요." response. 3d-A provides
  only the detection path — it wires nothing into `ConversationRuntime`.
- **Git unchanged (Q6).** No `RepositoryInfo.remoteUrl`, no `GitProvider.info` remote-URL exposure, no git
  remote parsing.
- **Repository Hosting not implemented (Q7).** No `RepositoryHostingProvider`/`RepositoryHostingManager`/
  `GitHubRepositoryHostingProvider`, no `PR_CREATED` state, no GitHub API call, no PR creation, no merge/
  deploy/release, no reviewer/label/assignee mutation, no `CommandExecution`, no runtime shell-out, no
  ChatGPT/GitHub connector in product code.

### Consequences
- + The blocking prerequisite ADR-0050 identified (a reviewed `RepositoryIdentity` source) now exists, without
  any hosting mutation surface — a future 3d-B/3d-C can consume a validated identity or fail safely when absent.
- + Reuses the single env-reading config path and the framework-agnostic domain/validator/value-object
  conventions; adds no provider/adapter package and no runtime wiring.
- − `ChunsikConfig` gains an optional `repositoryHosting`; `vitest.config.ts` `test.include` gains
  `apps/**/src/**/*.test.ts` (narrowest change enabling the config-loader test, CA change 8). Nothing is wired
  into `ConversationRuntime`/`ResponseComposer`/the apply anchor/`ApprovalRequest`.
- − This Sprint does **not** satisfy PR-execution readiness; actual PR creation remains blocked until 3d-B/3d-C
  are accepted.

### Relations
ADR-0050 (Sprint 3c — Repository Hosting capability design; this is its accepted config-only subset,
satisfying the "blocked until a reviewed RepositoryIdentity configuration source exists" prerequisite),
ADR-0049 (Sprint 3b — `PR_APPROVED` anchor a future execution sprint consumes alongside this identity),
ADR-0023 (CAP-002 Git — the remote-URL-exclusion decision this Sprint upholds; `RepositoryInfo` unchanged),
ADR-0025 (CAP-004 Approval — the no-secret-in-reason discipline mirrored). Plan:
`docs/plans/sprint-3d-a-repository-identity-configuration-plan.md`.

## ADR-0052 — RepositoryHosting Skeleton (CAP-010 domain/port/manager/token; NO real provider, NO mutation)

- **Status:** ✅ Accepted (v2, Phase 3, Sprint 3d-B — Product Construction), Chief Architect plan review:
  APPROVED WITH CHANGES (all 12 required changes applied) → implemented.
- **Date:** 2026-07-03
- **Scope:** The **non-mutating skeleton** of CAP-010 Repository Hosting (the design accepted in ADR-0050,
  reusing the identity source from ADR-0051): the provider-independent domain types +
  `RepositoryHostingProvider` port + `RepositoryHostingManager` + `REPOSITORY_HOSTING_PROVIDER` token,
  exercised only by **fake providers in unit tests**.

### Most important rule
> **RepositoryHosting is a hosting/platform capability. It is not Git.** No PR method is added to
> `GitProvider`/`GitManager`/`LocalGitProvider`/`CommandExecution`/runtime shell/`ExecutionOrchestrator`/
> `WorkspaceWrite`/`PatchManager`/`CodeGeneration`. `RepositoryHostingProvider.createPullRequest` exists as a
> **port shape only** — Sprint 3d-B ships **no real provider implementation**, no GitHub adapter, no DI
> binding, and **no product-runtime path can reach it**; only fake providers in unit tests may implement or
> call it. A successful `RepositoryHostingManager` unit test means the **manager boundary behaves correctly
> with a fake provider** — it does **not** mean product PR creation works. **Actual product PR creation
> remains blocked** until a real adapter + runtime flow are separately planned, implemented, reviewed, merged,
> and accepted.

### Decision
- **Types added** (`packages/core/src/domain/repository-hosting.ts`): `PullRequestCreationInput`,
  `PullRequestResult`, `PullRequestRef` (+ `pullRequestRef()`), `MAX_PR_TITLE`/`MAX_PR_BODY`,
  `normalizePrTitle`, `isSafeGitHubPullRequestUrl`. **Reuses** `RepositoryIdentity`/
  `RepositoryHostingProviderKind` from ADR-0051 — not duplicated.
- **`PullRequestCreationInput`** carries only `identity/headBranch/baseBranch/title/body/expectedCommitHash` —
  **no** `ApprovalRef` (Manager input only), token, raw diff, file content, GitHub SDK type, git remote URL, or
  `pushedRemote` (remote/upstream context belongs to the prior Git push anchor, not a hosting input).
- **`PullRequestResult`** is **provider-reported, not independent truth** (mirrors `GitPushResult`). The
  Manager validates it against the request and finalizes `reused` by the taken path.
- **`RepositoryHostingProvider` port**: `repositoryExists` / `branchExists` / `findOpenPullRequest` /
  `createPullRequest`; `readonly kind`; takes **no** `ApprovalRef`.
- **`RepositoryHostingManager`** owns approval gating (`ApprovalRef.status === APPROVED`), **`provider.kind ===
  identity.provider`** matching before any provider call, input validation, deterministic title normalization
  (collapse whitespace + trim; empty → reject; provider receives the normalized title), call ordering
  (`repositoryExists` → `branchExists(head)` → `branchExists(base)` → `findOpenPullRequest` → a **single**
  `createPullRequest` only if all pass and no existing PR), **manager-owned `reused`** (true via the
  existing-PR path, false via the create path — the provider-reported flag is not trusted), and result
  integrity — incl. `pullRequestCommitHash === expectedCommitHash` and `isSafeGitHubPullRequestUrl` (https /
  github.com / exact `/<owner>/<repo>/pull/<number>` / exact casing / no credentials / no query / no fragment /
  no percent-encoding / bounded). The `ApprovalRef` is consumed here and **never** passed to the provider; the
  provider receives only the bounded `PullRequestCreationInput`.
- **Non-idempotent creation blocked by default**: if `findOpenPullRequest` throws (unsupported), the Manager
  blocks and does not call `createPullRequest`. A valid existing open PR is returned with `reused: true` and no
  create; an invalid existing result fails safe (no fallback create).
- **Reused helpers**: `isSafePushBranch` (head/base) + the SHA-shape guard; identity validators (ADR-0051).
  **`isSafePushRemote` is NOT used** — RepositoryHosting works with identity + branch names, not git remotes.
- **Deterministic capability errors**: the Manager throws bounded internal messages; **raw provider errors are
  never forwarded or embedded**.
- **No token binding / no wiring**: `REPOSITORY_HOSTING_PROVIDER` token added, but `app.module.ts` binds **no**
  real or fake provider; an exported-but-unbound manager is acceptable. `ConversationRuntime`,
  `ApplyPreviewAnchor` (no `PR_CREATED`), `ResponseComposer` (no PR-created wording), `ExecutionOrchestrator`,
  and Git capability are unchanged.

### Consequences
- + Establishes the validated RepositoryHosting seam (domain/port/manager/token) a future GitHub adapter and
  PR-execution flow plug into, with all approval/validation/ordering/integrity discipline in place and proven
  by fake-provider unit tests.
- + Mirrors the CAP-002 Git Port/Manager/Token pattern and the `GitPushResult` provider-reported discipline;
  reuses ADR-0051 identity + ADR-0048 branch/SHA guards.
- − No real adapter, no GitHub API, no PR creation, no `PR_CREATED`, no runtime wiring exist yet; actual
  PR-creation execution remains a separate CA-gated sprint (3d-C+), and the product flow still stops at
  `PR_APPROVED`.

### Relations
ADR-0050 (Sprint 3c — the RepositoryHosting design this skeleton realizes), ADR-0051 (Sprint 3d-A —
`RepositoryIdentity`/validators reused), ADR-0048 (Sprint 3a — `isSafePushBranch` + SHA guard reused; the
provider-reported `GitPushResult` discipline mirrored by `PullRequestResult`), ADR-0046/ADR-0025 (the
`GitManager` Ref-gating template the manager mirrors; `ApprovalRef` consumed at the manager, never the
provider). Plan: `docs/plans/sprint-3d-b-repository-hosting-skeleton-plan.md`.

## ADR-0053 — GitHub RepositoryHosting Adapter (adapter-only; real GitHub REST via fetch; runtime execution deferred to 3d-D)

- **Status:** ✅ Accepted (v2, Phase 3, Sprint 3d-C — Product Construction), Chief Architect plan review:
  APPROVED WITH CHANGES (all 18 required changes applied) → implemented.
- **Date:** 2026-07-03
- **Scope:** `GitHubRepositoryHostingProvider` in a new `@chunsik/repository-hosting-github` package — the real
  GitHub REST implementation of the CAP-010 `RepositoryHostingProvider` port (ADR-0052), via the Node 22
  built-in `fetch`. **Adapter-only:** it is **not wired into `app.module.ts`** and **no product-runtime path
  reaches it**; every unit test injects a fake `fetch` (no live network). Actual runtime PR-creation execution
  (`PR_CREATED`, execution intent, `ConversationRuntime`/`ResponseComposer`, DI wiring) is **deferred to Sprint
  3d-D**, so the product flow still stops at `PR_APPROVED`.

### Most important rule
> **`createPullRequest` now has a REAL GitHub-mutating implementation inside the adapter package** — but in
> Sprint 3d-C it is **not wired into runtime and is exercised only with a fake `fetch` in tests**, so no product
> path can create a Pull Request. This is the key difference from 3d-B (where the method was a port shape with
> no implementation). Actual product PR creation remains **deferred to 3d-D**.

### Decision
- **Q1 — adapter-only (3d-C1).** Split from runtime execution (3d-D), because bundling the first
  product-reachable remote mutation with the largest diff (a new package + `ConversationRuntime` state-machine
  changes + DI wiring) could not be proven narrow/guarded (`conversation-runtime.ts` is 3163 lines; its DI
  factory ~69 wiring lines). The unwired adapter keeps the mutation surface closed.
- **Transport (Q3):** Node 22 built-in **`fetch`** + `AbortSignal.timeout`; **no octokit/SDK**; no
  `gh`/`hub`/`curl`/`CommandExecution`/shell/`git request-pull`.
- **Auth (Q2):** token is **adapter-local constructor config only** (`GitHubHostingConfig.token`); **3d-C does
  NOT read `CHUNSIK_GITHUB_TOKEN` in `config.ts`** (no runtime binding → no secret surface before it is needed;
  3d-D decides the env read). The constructor **rejects a blank/whitespace token** (no fetch). The token is
  used only as an `Authorization: Bearer` header value and **never** enters core/domain/`RepositoryIdentity`/
  `ApprovalRequest.reason`/`ApplyPreviewAnchor`/`ResponseComposer`/logs/errors.
- **Fixed host (github.com only):** API base is fixed to `https://api.github.com` with **no override option**;
  GitHub Enterprise is deferred. Headers: `Authorization: Bearer <token>`, `Accept:
  application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: chunsik-bot`.
- **Endpoints (Q4):** `repositoryExists` → `GET /repos/{owner}/{repo}`; `branchExists` → `GET
  /repos/{owner}/{repo}/branches/{branch}`; `findOpenPullRequest` → `GET /repos/{owner}/{repo}/pulls?state=open&
  head={owner}:{headBranch}&base={baseBranch}`; `createPullRequest` → `POST /repos/{owner}/{repo}/pulls`. Path
  segments (incl. slash branches) are `encodeURIComponent`-encoded; the POST body carries **raw** branch
  strings, minimal keys ONLY `{ title, head, base, body }` (no draft/maintainer_can_modify/issue/labels/
  assignees/reviewers/milestone).
- **HTTP status handling (Q11):** exists checks `200 → true`, `404 → false`, `401/403 → sanitized "unavailable
  (auth)"`, other non-2xx → sanitized error; `findOpenPullRequest` `404 → throw` (not "no PR"); `createPullRequest`
  **201 only** (`200`/`4xx` → error). **One `fetch` per method — no retry** (mutation retry needs separate
  review).
- **Existing-PR reuse (Q5):** same-repository head only (`{owner}:{headBranch}`); forks unsupported (mapping
  requires `head.repo.owner.login === owner` and `head.repo.name === repo`, else rejected); `0 → null`, `1 →
  mapped`, **`>1 → deterministic ambiguous safe failure`** (never choose first).
- **Result mapping (Q6/Q7):** `pullRequestCommitHash` = provider-reported **`head.sha`** (missing/not-SHA-shaped
  → reject); `pullRequestNumber` = `number` (must be a positive safe integer); `pullRequestUrl` = `html_url`
  validated by `isSafeGitHubPullRequestUrl` (https/github.com/exact path/exact casing/no creds/no query/no
  fragment/no percent-encoding); `head.ref`/`base.ref` mapped; everything else ignored (no raw diff/file
  content/secrets fetched). `PullRequestResult` is **provider-reported, not independent truth**; `reused` is
  finalized by the Manager (unchanged from ADR-0052).
- **Sanitized errors (Q13 provider portion):** deterministic bounded messages (operation label + HTTP status)
  — **never** the token, the `Authorization` header, the raw response body, or the request body.
- **No wiring / no side effects (Q15/Q16):** no `app.module` import/binding; `REPOSITORY_HOSTING_PROVIDER`
  stays unbound; `ConversationRuntime`/`ApplyPreviewAnchor`/`ResponseComposer`/`ExecutionOrchestrator`/Git
  capability unchanged; no `PR_CREATED`; no merge/deploy/release/reviewer/label/assignee/branch-creation/force
  push.

### Consequences
- + The product now has a real, tested GitHub REST adapter behind the CAP-010 port, ready for 3d-D to wire — with
  full auth/host/encoding/status/reuse/mapping/sanitization discipline, validated by fake-`fetch` unit tests
  (no live network).
- + No new external dependency (built-in `fetch`); mirrors the `git-local` adapter package shape.
- − A real GitHub-mutating `createPullRequest` implementation now exists in the repo, but is unreachable in
  product runtime (unwired) and never invoked live in tests. Actual PR-creation execution + `PR_CREATED` +
  runtime/composer changes remain **deferred to 3d-D**; the product flow still stops at `PR_APPROVED`.

### Relations
ADR-0052 (Sprint 3d-B — the `RepositoryHostingProvider` port this adapter implements + `RepositoryHostingManager`
that will consume it in 3d-D; `isSafeGitHubPullRequestUrl`/`PullRequestResult` reused), ADR-0051 (`RepositoryIdentity`
consumed), ADR-0050 (RepositoryHosting design), ADR-0048 (provider-reported `GitPushResult` discipline mirrored;
`git-local` adapter template), ADR-0023 (Git stays local-only). **Runtime execution succeeds in Sprint 3d-D.**
Plan: `docs/plans/sprint-3d-c-github-pr-creation-execution-plan.md`.

## ADR-0054 — Actual PR Creation Execution (PR_APPROVED → wired GitHub adapter → PR_CREATED)

- **Status:** ✅ Accepted (v2, Phase 3, Sprint 3d-D — Product Construction), Chief Architect plan review:
  APPROVED WITH CHANGES (all 15 required changes applied) → implemented. **The first product-reachable
  repository-hosting mutation.**
- **Date:** 2026-07-03
- **Scope:** Wire the GitHub adapter (ADR-0053) through `REPOSITORY_HOSTING_PROVIDER` →
  `RepositoryHostingManager` (ADR-0052) into `ConversationRuntime`, and add the `PR_CREATED` state + explicit
  execution trigger + safe-failure taxonomy, so a live `PR_APPROVED` anchor + an explicit PR create/open phrase
  creates an actual Pull Request (or connects an existing open one).

### Most important rule
> Actual PR creation is a high-risk remote platform mutation. It fires ONLY on: a live `PR_APPROVED` anchor, an
> explicit PR create/open phrase **at `PR_APPROVED`**, a resolved+validated `RepositoryIdentity` that **matches
> the identity approved at PR-approval time**, a live-verified `ApprovalRef` (via `ApprovalManager.get`,
> STRUCTURED fields only — `ApprovalRequest.reason` is NEVER parsed), and exact PR/pushed context match — then
> `RepositoryHostingManager.createPullRequest`. The runtime calls the **manager only, never the
> `GitHubRepositoryHostingProvider` directly**, and receives **no token**. It never fires on approval alone, a
> bare "PR" noun, "승인"/"진행해"/"좋아", or deploy/merge/release.

### Decision
- **`PR_CREATED` state (Q1).** Added after `PR_APPROVED`. Means a provider-reported PR was created — or an
  existing open PR was safely connected — **during this run**. NOT merged/deployed/released/reviewed/CI-passed/
  safe-forever/independently-re-verified. Anchor stores `repositoryIdentity` + `pullRequestRef`/`Number`/`Url`/
  `HeadBranch`/`BaseBranch`/`CommitHash`/`Reused` and preserves the full causal chain; NO token/raw response/
  raw diff/file content/remoteUrl (Q2/CA change 8), with `pullRequestCommitHash === prPushedCommitHash`,
  head/base == approved, `repositoryIdentity` == approved.
- **Identity bound at APPROVAL time (CA change 1/9).** `handlePrApprovalTurn` (from `GIT_PUSHED`) now REQUIRES a
  resolved `RepositoryIdentity` — if absent, it creates **no** `PR_APPROVAL_PENDING` and **no** `ApprovalRequest`
  (safe "not configured"). The identity is stored on the `PR_APPROVAL_PENDING`/`PR_APPROVED` anchor; at
  execution the runtime re-resolves it and requires an **exact match** with `anchor.repositoryIdentity`
  (mismatch/absent → safe failure, no manager/provider call). Old `PR_APPROVED` anchors without
  `repositoryIdentity` fail safe.
- **State-driven trigger (Q3).** Reuses `interpretPrIntent === 'create'` at `PR_APPROVED` (same grammar that
  requested approval at `GIT_PUSHED`; the state disambiguates). Bare noun/승인/진행해/좋아/deploy/merge/release do
  not execute. `PR_APPROVAL_PENDING` still intercepts decisions — execution never bypasses approval (Q13).
- **Token wiring (CA change 3/4/6).** `apps/chunsik/src/config.ts` reads `CHUNSIK_GITHUB_TOKEN` **only** to
  construct `GitHubRepositoryHostingProvider` at the composition root; the token is **adapter-local** and never
  enters `@chunsik/core`/`ConversationRuntime` deps/anchors/`ApprovalRequest.reason`/responses/logs. When the
  token is **absent/blank**, the composition root constructs **no** adapter and injects **no** manager
  (`ConversationRuntime` receives `RepositoryHostingManager | undefined`, never the token); PR creation then
  fails safe as "not configured" at runtime **without crashing unrelated non-PR flows** (no startup crash).
- **Ownership split (Q8/CA change 7).** Runtime owns conversation state, trigger, approval+context
  verification, identity resolution+match, response, anchor transition. The **manager** owns provider.kind
  match, input validation, `repositoryExists`/`branchExists(head)`/`branchExists(base)`/`findOpenPullRequest`,
  existing-PR reuse, the single `createPullRequest`, and result integrity — the runtime does **not** duplicate
  these and never calls/imports the provider.
- **Typed manager errors (CA change 6).** `RepositoryHostingBlockedError` (pre-mutation: approval/input/repo/
  branch/find/existing-invalid — definitively no PR → "PR은 만들지 않았어요") vs `RepositoryHostingUnverifiedError`
  (the `createPullRequest` call was attempted but failed/unverified — a PR may exist → "PR 생성 완료를 확인하지
  못했어요", must NOT claim no PR). Post-attempt ambiguity never overclaims.
- **Reuse (Q9).** `pullRequestReused: true` → "기존에 열려 있던 PR을 연결했어요" (never "새 PR을 만들었어요");
  `false` → "PR을 만들었어요". Body is re-derived deterministically (count only, no file paths/diff/token —
  CA change 11).
- **Unchanged.** Git capability (no `GitProvider`/`GitManager` PR method), `ExecutionOrchestrator`,
  `WorkspaceWrite`/`Patch`/`CodeGeneration`/`CommandExecution`. No merge/auto-merge/deploy/release/reviewer/
  label/assignee/draft/branch-creation/force-push. Tests use a fake manager / fake fetch — no live GitHub
  network, no `CHUNSIK_GITHUB_TOKEN` required (CA change 15).

### Consequences
- + The product flow can now move past `PR_APPROVED` to an actual PR — behind a live approval, exact
  identity/context match, an explicit execution phrase, and the manager's hosting-state + result-integrity
  checks, with a safe-failure taxonomy that never overclaims.
- + Reuses the accepted adapter/manager/identity unchanged in contract; the runtime touches the provider only
  through the manager.
- − `ConversationRuntime`/`ApplyPreviewAnchor`/`ResponseComposer` gained the `PR_CREATED` state + execution
  flow + composers; `app.module.ts` binds the adapter when a token is present; the manager gained a typed-error
  surface. Superseded prior-sprint absence guards (3d-A/3d-B/3d-C "not wired") were updated to their enduring
  invariants (runtime never imports the adapter; Git unchanged).
- − Actual GitHub side effects now occur when configured + explicitly requested; merge/deploy/release remain
  out of scope and forbidden.

### Relations
ADR-0053 (adapter wired via `REPOSITORY_HOSTING_PROVIDER`), ADR-0052 (`RepositoryHostingManager` consumed; typed
errors added), ADR-0051 (`RepositoryIdentity`/resolver reused), ADR-0049 (`PR_APPROVED` anchor + PR context
consumed; its "PR_APPROVED + create → already approved" behavior is **superseded** — that phrase now executes),
ADR-0048/0046/0025 (approval-halt + Ref-gating lineage), ADR-0023 (Git stays local-only). Plan:
`docs/plans/sprint-3d-d-pr-creation-execution-plan.md`.

## ADR-0055 — Pull Request Status Preview (read-only, point-in-time hosting status from PR_CREATED)

- **Status:** ✅ Accepted (v2, Phase 3, Sprint 3e — Product Construction), Chief Architect plan review:
  APPROVED WITH CHANGES (all 10 required changes applied) → implemented.
- **Date:** 2026-07-03
- **Scope:** A **read-only** repository-hosting status preview on an existing `PR_CREATED` anchor — at
  `PR_CREATED`, an explicit PR/CI/check/review status phrase returns a bounded, point-in-time,
  provider-reported `PullRequestStatusPreview`. No mutation, no new anchor state.

### Most important rule
> A PR status preview is a **read-only, point-in-time hosting observation — never a durable guarantee.** It is
> **not** "PR verification" / "CI verification" / "safe-to-merge" / "merge readiness" (naming discipline), and
> performs **no** merge/auto-merge/deploy/release/CI-rerun/check-rerun/review-mutation/reviewer/label/assignee/
> metadata/PR-close-reopen/draft-convert. The runtime calls `RepositoryHostingManager` only (never the adapter),
> passes **no** token, requires **no** `ApprovalRef`, and **keeps `PR_CREATED`** (no re-anchor, no new state).

### Decision
- **No new state (Q2).** Keep `PR_CREATED`; no `PR_STATUS_PREVIEWED`/`PR_VERIFIED`/`READY_TO_MERGE`/`PR_MERGED`/
  `PR_CLOSED`. A provider-reported merged/closed state is *reported* but never re-anchors or infers deploy/release.
- **Domain (Q3/CA change 3).** `PullRequestStatusPreview { ref: PullRequestRef; state; headBranch; baseBranch;
  headCommitHash; isDraft?; checks{state,total/success/failure/pending}; reviews?{state,approved/changes}; observedAt }`
  — provider-independent, bounded; **`observedAt` is generated internally at read time (adapter clock), never
  caller/user-supplied**; no raw provider response / token / check logs / review body / file paths / diff /
  file content.
- **Method (Q4/Q5/CA change 1).** `getPullRequestStatus` added to `RepositoryHostingProvider` +
  `RepositoryHostingManager` — **read-only, no `ApprovalRef`**. Input carries a **`PullRequestRef`** (not a bare
  number); the manager validates `provider.kind`, identity, `ref` (provider/owner/repo == identity, safe
  positive number, canonical github.com URL), safe head/base, SHA-shaped commit **before** the provider read,
  then validates result integrity (ref/head/base/commit match the request; non-negative integer counts). A
  mismatch is a **stale/unattributable** read → the runtime words it "could not check current status", **never**
  "checks failed" (CA change 8).
- **Anchored PR only (Q1/CA change 2).** Triggered only at `PR_CREATED` by an explicit PR/CI/check/review status
  phrase (`interpretPrStatusIntent` — a status noun AND a query verb; a bare "상태" does not trigger; merge/
  deploy/release/reviewer/label route to the companion-unsupported reply). The query target is **always
  `anchor.pullRequestRef`** — a user-supplied PR number/URL is never parsed or used.
- **GitHub adapter (Q11/CA changes 4/5/9).** Read-only, github.com only: bounded `GET` pull /
  `GET commits/{sha}/check-runs?per_page=100` / `GET pulls/{n}/reviews?per_page=100` — **one call each, no
  pagination loop, no retry**. **check-runs only** (legacy commit statuses may be unrepresented — documented;
  the response says checks are provider-reported and may be partial). Empty check-runs → `unknown` (never
  rendered as success — CA change 10). Reviews summarized latest-per-reviewer (a current signal, **not** a merge
  approval gate — CA change 6; no review body text). Sanitized errors (no token/Authorization/raw body).
- **Token boundary (Q7)** identical to ADR-0054 — adapter-local only; missing token/identity → safe
  not-configured, no state change, no crash.
- **Unchanged (Q12/Q13).** `GitProvider`/`GitManager`/`LocalGitProvider`/`RepositoryInfo`,
  `ExecutionOrchestrator`, `WorkspaceWrite`/`Patch`/`CodeGeneration`/`CommandExecution`. No GitHub write verb.
- **Future (Q14).** 3e unlocks no mutation; merge-approval / merge-execution / deployment each remain separate
  future CA-gated sprints.

### Consequences
- + Users get useful post-creation feedback (state/checks/reviews) as a point-in-time preview, with no new
  mutation surface and no new state.
- + Reuses the port/manager/adapter/anchor/token boundary unchanged in contract; adds only read-only methods.
- − Adds a `PullRequestStatusPreview` type, a read-only `getPullRequestStatus` (port/manager/adapter), a
  `PR_CREATED` status route + handler + 4 composers. Nothing mutates; the anchor never changes.

### Relations
ADR-0054 (reads the `PR_CREATED` anchor; runtime-calls-manager-only + token boundary reused), ADR-0053 (adapter
gains a read-only `GET` method), ADR-0052 (port/manager gain a read-only method; `isSafeGitHubPullRequestUrl`
reused), ADR-0051 (`RepositoryIdentity`), ADR-0023 (Git stays local-only). Plan:
`docs/plans/sprint-3e-pr-status-preview-plan.md`.

## ADR-0056 — Explicit Pull Request Merge Approval (approval gate only; NO merge, NO GitHub write)

- **Status:** ✅ Accepted (v2, Phase 3, Sprint 3f — Product Construction), Chief Architect plan review:
  APPROVED WITH CHANGES (all 7 required changes applied) → implemented.
- **Date:** 2026-07-03
- **Scope:** A `RiskLevel.CRITICAL` **merge-approval gate** on an existing `PR_CREATED` anchor — an explicit
  merge / merge-approval phrase records permission to merge a specific PR context and halts. Mirrors the
  Sprint 3b PR-creation-approval flow (ADR-0049), applied to merge. **No merge execution, no GitHub write API.**

### Most important rule
> **A merge approval is a permission record — not a merge.** `MERGE_APPROVED` means permission recorded only —
> **never** merged/deployed/released/safe-to-merge/CI-passed/reviews-approved/GitHub-mergeable/branch-deleted/
> production-ready. Sprint 3f adds **only** the approval states + decision flow: no merge, no GitHub write API,
> no `RepositoryHosting`/`GitProvider`/`GitManager` merge method, no `CommandExecution`/shell, no
> `ExecutionOrchestrator` change. Actual merge execution is a future, separate, CA-reviewed sprint.

### Decision
- **States (Q2).** Add `MERGE_APPROVAL_PENDING`, `MERGE_APPROVED` after `PR_CREATED` (no `PR_MERGED`/`MERGED`/
  `DEPLOY_APPROVAL_PENDING`/`DEPLOYED`/`RELEASED`). New fields: `mergeApprovalId`, `mergeApprovalRequestedAt`,
  `mergeApprovedAt`, and **`mergeApprovalDecisionBy` (required on `MERGE_APPROVED`** — CA change 2). Both states
  preserve the full `PR_CREATED` causal chain (identity/pullRequestRef/head/base/commit/push/commit/workspace).
  No token/raw response/diff/file content/check logs/review body/remoteUrl stored.
- **Trigger (Q1).** From `PR_CREATED`, `interpretMergeIntent` (checked after the 3e status intent) returns
  `'merge'` for a merge word + a request/approval/execution verb → `handleMergeApprovalTurn`. A merge
  safety/possibility **question** ("머지 가능해?/안전해?"), a bare "진행해"/"좋아"/"승인" (no merge word), a PR
  **status** phrase (→ 3e preview), and deploy/release phrases do **not** create a merge approval. An explicit
  merge-execution phrase ("머지해줘"/"merge this PR") records **approval only**, and the reply says it does not
  merge (CA-approved).
- **Approval reason.** Deterministic bounded `buildMergeApprovalReason`: `operation` + `repository: owner/repo`
  + `pull request: #n url` + head/base + short commit + **`pr source: created|connected-existing`** (renamed
  from "status" — CA change 6) + "no merge/deployment/release has been performed" + "merge is not guaranteed
  safe or mergeable by this approval; checks/reviews/hosting state are not verified" (CA change 6). Never says
  "merge creation" (CA change 1), never a positive checks-passed/reviews-approved/mergeable/safe-to-merge
  claim, no token/diff/file/check/review payload. **Never parsed later** — structured fields + `ApprovalRef`
  are authority (CA change 3).
- **Pending (Q7).** `MERGE_APPROVAL_PENDING` intercepts every turn (`handleMergeApprovalDecisionTurn`): a
  merge/deploy/status phrase → ambiguous re-prompt (no decide, no merge); **"진행해" approves only while
  pending** (CA change 4); approve requires `ApprovalManager.get` exists + PENDING + `executionPlanRef` match
  (structured only).
- **Deny/cancel (Q8) → `PR_CREATED`**, clearing **only** merge fields (`mergeApprovalId`/`RequestedAt`/
  `ApprovedAt`/`DecisionBy`); PR/push/commit/workspace preserved. **Approve (Q9) → `MERGE_APPROVED`** (+
  `mergeApprovedAt`, `mergeApprovalDecisionBy`); all context preserved; **still no merge.**
- **`MERGE_APPROVED` follow-up (Q10/Q11).** A merge phrase → already-approved (future execution only); deploy/
  release/reviewer/label/assignee → unsupported future step; a **status phrase → the 3e read-only status
  preview, keeping `MERGE_APPROVED`** (never re-anchored), with a reminder line "머지 승인은 기록되어 있지만,
  아직 머지는 하지 않았어요" so the preview never implies the approval was consumed/cleared (CA change 5). A
  merge phrase at `MERGE_APPROVED` performs no merge/provider/Git/command/shell call (CA change 7).
- **Fresh status not required (Q5).** Approval records permission without a fresh preview; the reason/response
  avoid implying checks/reviews/mergeability safety. **Future merge execution (Q14, deferred)** must
  re-validate: live `MERGE_APPROVED`, identity, pullRequestRef, head/base/commit, PR open + not-merged +
  not-closed, current head SHA, mergeability if exposed, checks/reviews per future CA policy — **none
  implemented in 3f.**
- **Unchanged (Q4/Q12/Q13).** `RepositoryHostingProvider`/`RepositoryHostingManager`/
  `GitHubRepositoryHostingProvider` (no merge method), Git capability, `ExecutionOrchestrator`, `WorkspaceWrite`/
  `Patch`/`CodeGeneration`/`CommandExecution`.

### Consequences
- + A CRITICAL, auditable merge-permission gate before any (future) merge mutation, consistent with the
  commit/push/PR-creation approval gates; reuses the accepted approval-halt template + CAP-004.
- − `ConversationRuntime`/`ApplyPreviewAnchor`/`ResponseComposer` gain the two states + merge flow + 7
  composers; the 3e status preview widens to also serve `MERGE_APPROVED` (read-only, no re-anchor). Nothing
  mutates GitHub; no merge occurs.

### Relations
ADR-0054 (reads/preserves the `PR_CREATED` chain), ADR-0055 (read-only status preview reused from
`MERGE_APPROVED`), ADR-0049 (CRITICAL request → `*_APPROVAL_PENDING` → decision → `*_APPROVED` template
mirrored), ADR-0025 (CAP-004 Approval — `requestForRisk`/`get`/`decide`, CRITICAL), ADR-0023 (Git local-only).
Plan: `docs/plans/sprint-3f-explicit-pr-merge-approval-plan.md`.

## ADR-0057 — Pull Request Merge Execution Preflight (actual merge from MERGE_APPROVED, live-preflight-guarded)

- **Status:** ✅ Accepted (v2, Phase 3, Sprint 3g — Product Construction), Chief Architect plan review:
  APPROVED WITH CHANGES (all 5 required changes applied) → implemented.
- **Date:** 2026-07-03
- **Scope:** The first repository-hosting mutation AFTER PR creation — an explicit merge-execution command at a
  live `MERGE_APPROVED` anchor executes an actual PR merge on the hosting provider, but only after a full live
  preflight and only via a new `RepositoryHostingManager`/`RepositoryHostingProvider` merge method. Mirrors the
  Sprint 3d-D PR-creation-execution safety model (ADR-0054), applied to merge.

### Most important rule
> **A merge execution mutates exactly ONE approved PR — and nothing else.** `PR_MERGED` means only: the approved
> PR was merged on the hosting provider during this run, or the exact approved head was observed already merged
> during this run. It does **NOT** mean deployed / released / production-ready / branch-deleted / CI-permanently-
> verified / local-main-synced. No deploy/release/tag/branch-deletion/force-merge/auto-merge/PR-branch-update/
> PR-close-reopen/reviewer-label-assignee/check-rerun/workflow-dispatch, no local git mutation, no
> `CommandExecution`/shell, no `ExecutionOrchestrator`/`WorkspaceWrite`/`Patch`/`CodeGeneration` change. The
> hosting token stays adapter-local (never core/domain/anchor/reason/response/logs). Unknown post-attempt errors
> are **unverified**, never "not merged".

### Decision
- **State (Q1).** Add only `PR_MERGED` (terminal) after `MERGE_APPROVED` — no `MERGE_EXECUTION_PENDING` (the 3f
  `MERGE_APPROVED` gate is the approval; execution needs no second approval), no `DEPLOYED`/`RELEASED`/
  `BRANCH_DELETED`. New anchor fields: `mergedAt` (**runtime record/observe timestamp** — `now()`, not the
  provider's original merge time, CA change 3), `mergeExecutedBy`, `mergedHeadSha` (required on `PR_MERGED`),
  `mergeCommitHash?` (provider-reported, optional). `PR_MERGED` preserves the full chain + the 3f approval
  evidence.
- **Trigger (Q3, CA change 1).** Only at `MERGE_APPROVED`/`PR_MERGED`. `interpretMergeExecutionIntent` = a merge
  word + a request/execution verb (`해줘`/`실행`/`실제`/`지금`/`승인된`/`now`/`execute`/`merge this`/`approved`), with the
  MERGE_QUESTION status/check/possibility guard taking precedence. **`머지해줘`/`이 PR 머지해줘`/`merge this PR`
  EXECUTE** — the user already passed the 3f CRITICAL gate, so a direct merge imperative is a valid execution
  command; safety comes from state + approval revalidation + live preflight + expected head SHA + mergeability,
  not a magic wording. A bare `머지`/`merge` noun → `composeMergeAlreadyApproved` (ask to merge explicitly, CA
  change 4); `머지 상태 확인해줘`/`머지 체크해줘` → read-only 3e status path (`interpretMergeStatusIntent`); `PR_CREATED
  + 머지해줘` → approval (3f), `MERGE_APPROVAL_PENDING + 머지해줘` → re-prompt (3f), `MERGE_APPROVED + 배포/릴리즈` →
  unsupported companion.
- **Live preflight (16 checks).** Runtime re-validates the approval evidence (`mergeApprovalId` →
  `approvals.get` → `APPROVED` → `executionPlanRef.id` match) + the anchored context (identity matches resolved
  identity + ref; pullRequestRef/number/url/head/base/commit present); the Manager backstop-validates then reads
  the LIVE PR immediately before mutation via `getMergePreflight`, checking (integrity **always**, before the
  already-merged branch — CA change 2) ref/head/base/`headCommitHash == expectedHeadSha`, then state (open) +
  mergeability. Any pre-mutation failure → `RepositoryHostingBlockedError` ("not merged").
- **Mergeability (Q6).** Normalized provider-independent `PullRequestMergeability = MERGEABLE|BLOCKED|
  CONFLICTING|UNKNOWN|STALE_HEAD`; only `MERGEABLE` proceeds; everything else blocks (never merge on
  uncertainty). No force merge, no branch-protection bypass, no PR-branch auto-update. Raw→normalized mapping
  (e.g. GitHub `mergeable`/`mergeable_state`) lives adapter-side only; the core never sees the payload.
- **Already-merged idempotency (CA change 2).** Live state `merged` at the EXACT approved head (integrity passed)
  → `PR_MERGED`, `alreadyMerged=true`, no mutating call. Merged at a DIFFERENT head → Blocked/Stale, stays
  `MERGE_APPROVED` (never claims the approved head was merged when a different head may have been).
- **Capability (Q5).** New `RepositoryHostingManager.mergePullRequest` (consumes/validates the `ApprovalRef`,
  never forwarded) + `RepositoryHostingProvider.getMergePreflight` (read-only) + `.mergePullRequest` (the only
  new mutating method; receives hosting-safe refs + expected head SHA only, no `ApprovalRef`). `alreadyMerged` is
  Manager-owned (mirrors `reused`). Merge is a **hosting** mutation — `GitProvider`/`GitManager` gain no method
  (ADR-0023).
- **GitHub adapter.** `getMergePreflight` → read-only `GET /repos/{o}/{r}/pulls/{n}`; `mergePullRequest` → single
  `PUT /repos/{o}/{r}/pulls/{n}/merge` with `{ sha: expectedHeadSha, merge_method: 'merge' }` (the `sha` guard
  refuses a moved head). Built-in fetch, github.com only, sanitized errors, token adapter-local.
- **Failure semantics (Q7, extends ADR-0054).** Known pre-mutation block → Blocked ("not merged"); any throw or
  result-integrity failure at/after the mutating call → Unverified ("could not verify — check PR status", never
  "not merged"); live-already-merged at the exact head → idempotent `PR_MERGED`. Every failure keeps
  `MERGE_APPROVED`.
- **Unchanged.** `CommandExecution`/`ExecutionOrchestrator`/`WorkspaceWrite`/`Patch`/`CodeGeneration`, Git
  capability, deploy/release/tag/branch-deletion/auto-merge/reviewer-label-assignee/check-rerun/workflow-dispatch/
  local-post-merge-sync (all out of scope).

### Consequences
- + The product now owns a verified `PR_MERGED` state — the first remote mutation after PR creation — behind the
  existing CRITICAL 3f approval gate + a conservative live preflight, reusing the ADR-0054 Blocked-vs-Unverified
  safety rule and the ADR-0055 integrity-checked read shape.
- − `domain`/`port`/`RepositoryHostingManager`/`ConversationRuntime`/`ResponseComposer`/`GitHubRepositoryHosting
  Provider` each gain the merge preflight + execution surface (one new state, two provider methods, one manager
  method, one runtime handler, six composers). Nothing deploys/releases; merge occurs only on
  `MERGE_APPROVED` + an explicit execution command + all 16 preflight checks passing.

### Relations
ADR-0056 (consumes the `MERGE_APPROVED` anchor + `mergeApprovalId` approval evidence as the sole trigger source),
ADR-0054 (reads/preserves the `PR_CREATED` chain; extends the remote-mutation Blocked-vs-Unverified rule),
ADR-0055 (mirrors the integrity-checked point-in-time read; the read-only status preview also serves `PR_MERGED`),
ADR-0052/0053 (extends the `RepositoryHostingProvider` port + Manager + GitHub adapter), ADR-0025 (CAP-004
Approval — `get`/`APPROVED`/`ApprovalRef`), ADR-0023 (Git local-only; merge is a hosting mutation).
Plan: `docs/plans/sprint-3g-pr-merge-execution-preflight-plan.md`.

## ADR-0058 — Post-Merge Local Main Synchronization (fast-forward-only local main sync from PR_MERGED)

- **Status:** ✅ Accepted (v2, Phase 3, Sprint 3h — Product Construction), Chief Architect plan review:
  APPROVED WITH CHANGES (all 6 required changes applied) → implemented.
- **Date:** 2026-07-04
- **Scope:** From a live `PR_MERGED` anchor, an explicit sync command synchronizes the **local** workspace
  repository's `main` ref to the expected post-merge remote `main` commit — **fast-forward only**, via the **Git**
  capability (CAP-002), never a shell. Closes the "remote main advanced but the local workspace is on an old head"
  gap. Mirrors the ADR-0054 remote-mutation safety model, applied to local Git.

### Most important rule
> **A local main sync is a fast-forward of the LOCAL `main` ref — and nothing else.** `MAIN_SYNCED` means local
> main reached the expected commit this run; it does **NOT** mean deployed / released / production-ready /
> branch-deleted / remote-branch-cleaned / CI-permanently-verified / current-feature-branch-merged, and it does
> **not** unlock deploy/release. No force/`--force`/`reset --hard` (no hard reset), no branch deletion (local/
> remote/GitHub), no remote push, no PR mutation, no `CommandExecution`/shell, no `ExecutionOrchestrator`/
> `WorkspaceWrite`/`Patch`/`CodeGeneration` change. If a fast-forward is not possible → **block, never force**.
> Unknown failure after the local ref-update attempt is **unverified**, never "not synced".

### Decision
- **State (Q1, CA change 1).** Add `MAIN_SYNCED` only (terminal). New anchor fields (required on `MAIN_SYNCED`):
  `syncedMainCommit`, `mainSyncedAt` (**runtime record timestamp**, `now()`), `mainSyncBranch` ('main'), `syncMode`
  (`checked-out-main` | `ref-only`), `workingTreeUpdated`, `previousMainCommit` (CAS base). Preserves the full
  `PR_MERGED` chain + merge evidence.
- **Trigger (Q3).** Only at `PR_MERGED`/`MAIN_SYNCED`. `interpretMainSyncIntent` = a sync verb (동기화/최신화/받아와/
  sync/pull/update main) AND a main target; a bare "sync"/"main" alone does not trigger. Checked BEFORE the 3g
  already-merged routing so "머지된 main 받아와줘" syncs (not read as a merge phrase). A sync phrase in any other
  state never syncs.
- **Ownership (Q2).** The **Git capability** owns the sync primitives; `ConversationRuntime` only composes. New:
  `GitProvider.getRemoteRefCommit` (read-only `ls-remote`), `GitProvider.getLocalRefCommit` (read-only
  `rev-parse`), `GitProvider.syncMainFastForward` (the single mutating primitive), `GitManager.syncMain`
  (orchestrates the preflight + the single mutation; **no ApprovalRef** — a local, non-destructive, ff-only ref
  move gated by PR_MERGED + explicit command + preflight). No new capability, no shell, no ExecutionOrchestrator.
- **Strategy (Q4, CA change 1) — mode split + CAS (CA change 3).** Fast-forward only; no hard reset, no force.
  `current==main` → **checked-out-main** ff (working tree/index moved by `git merge --ff-only`); `current!=main`
  → **ref-only** ff of `refs/heads/main` (`git update-ref <new> <old>` CAS; no checkout switch, no working-tree
  change); detached HEAD → Block; non-ff → Block. The local ref update is compare-and-swap against the observed
  `previousMainCommit`; moved-before → Block, moved-during/after → Unverified.
- **Expected remote tip (Q5, CA change 4).** The expected remote `main` tip is `PR_MERGED.mergeCommitHash`;
  **absent → Block, with NO fallback to `mergedHeadSha`** ("ChunsikBot cannot prove which remote main commit
  should be synchronized"). A future sprint may add a bounded ancestry policy.
- **Preflight (14 checks).** Runtime: `PR_MERGED` + identity match + base=='main' + `mergedHeadSha` +
  `mergeCommitHash` + rootPath. Manager: isRepository + clean/no-untracked/no-staged/no-unstaged/no-unmerged +
  not-detached + local main exists (CAS base) + remote main observed + remote tip == expected + bounded. All
  pre-ref-update failures → *Blocked*.
- **Failure semantics (Q5, CA change 2) — phase-aware.** KNOWN pre-ref-update failure → `GitMainSyncBlockedError`
  ("not synced"); any failure AT/AFTER the local ref-update attempt → `GitMainSyncUnverifiedError` (never "not
  synced"). The provider throws phase-aware typed errors; the Manager propagates Blocked as Blocked and
  Unverified/unknown as Unverified — it does **not** blanket-convert. Every failure keeps `PR_MERGED`.
- **Response wording (Q8, CA change 5).** Mode-aware: ref-only says "local main ref synchronized, current checkout
  unchanged, working tree remained clean"; checked-out-main says "checked-out main fast-forwarded, working tree
  updated, clean after sync". Never "workspace synced"/"working tree is now main". Every path states what was NOT
  done (deploy/release/branch deletion). Composers: `composeMainSyncSucceeded`/`Blocked`/`Unverified`/`Unavailable`.
- **Out of scope (Q6/Q7).** No branch deletion (local/remote/GitHub), no deploy/release/tag, no force/reset/push,
  no PR mutation, no RepositoryHosting change, no CommandExecution/shell, no ExecutionOrchestrator/WorkspaceWrite/
  Patch/CodeGeneration change. `MAIN_SYNCED` does not unlock deploy/release.

### Consequences
- + The product can now bring the local workspace's `main` to the merged commit safely (ff-only, mode-split,
  CAS-guarded, phase-aware), closing the post-merge local-state gap without any destructive Git operation.
- − `domain`/`GitProvider`/`GitManager`/`ConversationRuntime`/`ResponseComposer`/`git-local` gain the sync surface
  (one new terminal state, three provider methods, one manager method + two typed errors, one runtime handler,
  four composers). Nothing deploys/releases/deletes; `main` is never force-moved.

### Relations
ADR-0057 (consumes the `PR_MERGED` anchor + `mergeCommitHash`/`mergedHeadSha`/`pullRequestBaseBranch`/
`repositoryIdentity` as the sole trigger source + sync evidence), ADR-0054/0048/0046 (extends the remote-mutation
Blocked-vs-Unverified rule; the third Git mutation, single bounded argv, adapter-side, no shell), ADR-0055 (mirrors
the point-in-time read shape; the read-only status preview also serves `MAIN_SYNCED`), ADR-0023/0047 (Git =
local-only repository capability; `GitStatus` fields reused). Plan:
`docs/plans/sprint-3h-post-merge-local-main-sync-plan.md`.

## ADR-0059 — Post-Merge Branch Cleanup (safe LOCAL merged-branch delete from MAIN_SYNCED; remote deletion deferred)

- **Status:** ✅ Accepted (v2, Phase 3, Sprint 3i — Product Construction), Chief Architect plan review:
  APPROVED WITH CHANGES (all 6 required changes applied) → implemented.
- **Date:** 2026-07-04
- **Scope:** From a live `MAIN_SYNCED` anchor, an explicit **local** cleanup command deletes the already-merged
  feature branch (the anchored PR head branch) — via the **Git** capability (CAP-002), **CAS delete only**
  (`git update-ref -d refs/heads/<t> <expected>`, never `-D`/force), never a shell. **Remote branch deletion is
  DEFERRED** to a future, separately-gated sprint. Mirrors the ADR-0058 local-Git safety model, applied to deletion.

### Most important rule
> **A branch cleanup deletes exactly ONE already-merged LOCAL branch — the anchored PR head branch — and nothing
> else.** `BRANCH_CLEANED` means the completed feature branch's LOCAL ref was deleted (or was already absent) this
> run; it does **NOT** mean deployed / released / tagged / production-ready / remote-branch-deleted /
> all-branches-cleaned / repository-fully-cleaned. No remote deletion (deferred), no `-D`/force delete, no deleting
> `main`, no bulk/wildcard, no deleting an unmerged or checked-out branch, no `reset --hard`/force push, no PR
> mutation, no deploy/release/tag, no `CommandExecution`/shell, no `ExecutionOrchestrator`/`WorkspaceWrite`/`Patch`/
> `CodeGeneration` change. If not fully merged / checked out / `main` / unsafe → **block, never force**. Unknown
> failure after the ref-delete attempt is **unverified**, never "not deleted".

### Decision
- **State (Q1).** Add `BRANCH_CLEANED` only (terminal). Fields (required on `BRANCH_CLEANED`): `branchCleanupMode`
  (**'local' in 3i**; 'remote'/'local-and-remote' reserved for a future gated sprint), `cleanedBranch`,
  `branchCleanedAt` (runtime ts), `branchCleanedBy`, `cleanedLocalBranch`, `cleanedRemoteBranch` (**always false in
  3i**). Preserves the full `MAIN_SYNCED` chain + merge/sync evidence.
- **Trigger (Q3, CA change 1).** Only at `MAIN_SYNCED`/`BRANCH_CLEANED`. A REMOTE-cleanup phrase
  (`interpretRemoteBranchCleanupIntent`: cleanup verb + branch word + 원격/remote/origin/github) is checked FIRST →
  `composeRemoteBranchCleanupUnsupported` (NEVER a local delete side effect). A LOCAL phrase
  (`interpretBranchCleanupIntent`: cleanup verb + branch word; rejects bulk/wildcard, `main`-target, and any remote
  qualifier) → local cleanup. The deletion TARGET is always the **anchored PR head branch** — never a user-named
  branch. Bare `정리해줘`/`배포해줘`/`main 삭제해줘`/`브랜치 다 삭제해줘` never trigger.
- **Ownership (Q2) + strategy (CA change 3).** Local deletion → the Git capability via
  `git update-ref -d refs/heads/<target> <expectedBranchCommit>` — a git-native CAS delete that does **not** depend
  on the current `HEAD`/checkout (Sprint 3h ref-only mode may leave a non-main checkout); no `git branch -d`.
  **Remote deletion → DEFERRED** (a remote mutation needing its own explicit gate). New `GitProvider.isAncestor`
  (read) + `GitProvider.deleteMergedLocalBranch(rootPath, branch, expectedBranchCommit)` (CAS delete);
  `GitManager.deleteMergedLocalBranch` orchestrates the preflight + single delete; **no ApprovalRef** (local,
  recoverable, gated by `MAIN_SYNCED` + explicit command + preflight).
- **Preflight (Q4) + CAS (CA change 2/4).** Runtime: `MAIN_SYNCED` + `syncedMainCommit` + `mainSyncBranch=='main'`
  + target==`pullRequestHeadBranch`==`pushedBranch` + target!='main' + safe name + identity match. Manager:
  isRepository + status(no mid-op) + info(target not checked out) + **local main exists AND == `syncedMainCommit`
  (CA change 4)** + target branch exists (absent → idempotent) + `isAncestor(targetCommit, syncedMainCommit)`
  (fully merged). The provider CAS-deletes against the observed `targetCommit` (moved-before → Blocked).
- **Failure semantics (Q5, CA change 5).** Phase-aware: pre-ref-delete → `BranchCleanupBlockedError` ("not
  deleted"); at/after the ref-delete → `BranchCleanupUnverifiedError` (never "not deleted"); target already absent
  → idempotent `BRANCH_CLEANED` (cleanedLocalBranch=false, "already absent; nothing deleted; remote not deleted;
  main not changed"). Manager does not blanket-convert provider throws. Every failure keeps `MAIN_SYNCED`.
- **Approval (Q6).** Local cleanup: **no new CRITICAL approval**. Remote cleanup: **deferred** — a future sprint
  must add an explicit approval gate before any remote deletion.
- **Response (Q7).** Mode-aware: local-deleted vs already-absent; every path states main + remote were not touched;
  never implies deploy/release/tag/all-cleaned/repo-cleaned/remote-deleted. Composers:
  `composeBranchCleanupSucceeded`/`Blocked`/`Unverified`/`Unavailable` + `composeRemoteBranchCleanupUnsupported`.
- **Out of scope (Q8).** No remote deletion (deferred), no `-D`/force, no `main`/arbitrary/bulk/wildcard, no
  reset/force-push, no PR mutation, no deploy/release/tag, no shell, no `ExecutionOrchestrator`/`WorkspaceWrite`/
  `Patch`/`CodeGeneration`/`RepositoryHosting` change.

### Consequences
- + The product can now clean up the completed local feature branch safely (CAS delete, deterministic, tied to the
  exact synchronized main), completing the local post-merge lifecycle without any destructive/remote operation.
- − `domain`/`GitProvider`/`GitManager`/`ConversationRuntime`/`ResponseComposer`/`git-local` gain the cleanup
  surface (one new terminal state, two provider methods, one manager method + two typed errors, three runtime
  handlers, five composers). Nothing deploys/releases; remote branches are untouched; `main` is never deleted.

### Relations
ADR-0058 (consumes the `MAIN_SYNCED` anchor + `syncedMainCommit`/`mainSyncBranch` as the sole trigger source +
cleanup evidence), ADR-0057/0054 (the `pullRequestHeadBranch`/`pushedBranch` deletion target + the remote-mutation
Blocked-vs-Unverified rule, applied to local deletion), ADR-0046/0048/0023 (Git mutation discipline: single bounded
argv, adapter-side, no shell; Git = local repository capability). Plan:
`docs/plans/sprint-3i-post-merge-branch-cleanup-plan.md`.

## ADR-0060 — Remote Branch Cleanup (RepositoryHosting-owned, CRITICAL-approval-gated delete of exactly ONE merged PR head branch; split 3j-A approval / 3j-B execution)

- **Status:** ✅ Accepted (v2, Phase 3 — Product Construction), CA plan review: APPROVED WITH CHANGES → **split into
  two implementation sprints under this single ADR, both now implemented.** **Sprint 3j-A (approval gate)** and
  **Sprint 3j-B (execution/delete)** are both implemented (3j-B CA plan review: APPROVED WITH CHANGES → all 6 changes
  + tests 25–34 applied). The full chain `BRANCH_CLEANED → REMOTE_BRANCH_CLEANUP_PENDING → REMOTE_BRANCH_CLEANUP_
  APPROVED → (execute) → REMOTE_BRANCH_CLEANED` is now reachable.
- **Date:** 2026-07-04
- **Scope (whole design):** From a live `BRANCH_CLEANED` anchor, an explicit **remote** branch-cleanup command
  deletes the completed PR's **remote head branch** from the hosting provider — via the **RepositoryHosting**
  capability (CAP-010), through a **new CRITICAL ApprovalRequest**, **exactly ONE remote ref**, only after a strict
  live revalidation. **3j-A = the approval gate only (no deletion). 3j-B = the execution/delete.**

### Most important rule
> **A remote branch cleanup deletes exactly ONE remote branch — the anchored, already-merged PR head branch — and
> nothing else.** `REMOTE_BRANCH_CLEANED` (3j-B) means the completed PR's REMOTE head ref was deleted (or was already
> absent) this run; it does **NOT** mean deployed / released / tagged / production-ready / local-branch-deleted-this-
> run / all-branches-cleaned / repository-fully-cleaned. No deletion of the default/`main` branch, no bulk/wildcard/
> pattern, no force, no `git push --delete` (Git stays local-only, ADR-0023), no LOCAL deletion (that was 3i), no
> deploy/release/tag, no PR/reviewer/label/assignee mutation, no shell. **Deletion happens ONLY from a recorded
> CRITICAL approval + an explicit execute command + a full live preflight (3j-B).**

### Decision
- **State (Q1).** The full design adds `REMOTE_BRANCH_CLEANUP_PENDING` → `REMOTE_BRANCH_CLEANUP_APPROVED` →
  `REMOTE_BRANCH_CLEANED` (terminal). **3j-A adds ONLY the two approval states** + the four approval-tracking fields
  (`remoteBranchCleanupApprovalId`/`…RequestedAt`/`…ApprovedAt`/`…ApprovalDecisionBy`). **`REMOTE_BRANCH_CLEANED`,
  the descriptive remote fields (`remoteBranchCleanupMode`/`cleanedRemoteBranchName`/`remoteBranchCleanedAt`/`…By`/
  `remoteBranchCleanupProvider`/`remoteBranchDeletedCommit`), and `cleanedRemoteBranch=true` are 3j-B.** The
  `cleanedRemoteBranch` boolean is **reused** for "a remote branch was deleted this run" (stays `false` through 3j-A);
  distinct descriptive fields preserve the 3i LOCAL cleanup evidence unoverloaded. The chain is always preserved.
- **Ownership (Q2).** **RepositoryHosting** owns remote branch deletion (GitHub Git-refs REST, keyed by provider
  identity). **Git `push --delete` is REJECTED** — Git is a local-repository capability that must never handle a
  remote URL/credentials (ADR-0023); routing a remote mutation through it would smuggle blast radius behind a "local"
  capability. So local (Git, ADR-0059) and remote (RepositoryHosting, this ADR) deletion are different capabilities.
  *(The provider/manager delete methods are 3j-B; 3j-A adds no RepositoryHosting read/write method.)*
- **Approval (Q3).** A **new `RiskLevel.CRITICAL` ApprovalRequest**, tracked by a **distinct**
  `remoteBranchCleanupApprovalId` (never reusing commit/push/PR/merge ids). Approval happens **before** deletion,
  always; **two separate turns** (approval then execution), mirroring every prior gated mutation (2x/2y, 2z/3a,
  3f/3g). `BRANCH_CLEANED → (remote phrase) → REMOTE_BRANCH_CLEANUP_PENDING → (approve) → REMOTE_BRANCH_CLEANUP_
  APPROVED → (execute) → REMOTE_BRANCH_CLEANED`. The `ApprovalRef` is consumed by the Manager, never forwarded to the
  provider. **Approval reason (CA change 4)** states ONLY the permission target (repository/PR/anchored remote head
  branch/expected head commit) + risk + permission-only disclaimers; it must NOT claim the branch exists, its SHA is
  current, the PR is still merged, or that deletion is safe/will-succeed — those are live 3j-B checks.
- **Trigger (Q4, CA change 8).** `interpretRemoteBranchCleanupIntent` (cleanup verb + branch word + remote
  qualifier) is **hardened** to reject bulk/wildcard/all/`main`·default-branch phrases (load-bearing now that a
  remote phrase starts a real CRITICAL delete-approval, not the 3i no-op). Only at `BRANCH_CLEANED` (→ approval) /
  `REMOTE_BRANCH_CLEANUP_APPROVED` (→ already-approved). At `MAIN_SYNCED` a remote phrase → "clean local first" (no
  approval). The delete TARGET is always the **anchored PR head branch** — never a user-named branch.
- **Preflight + CAS (Q5/Q6, 3j-B).** 17-check live preflight (3j-B CA changes 2–4 added: `mergedHeadSha`-only
  expected commit with **no** `pullRequestCommitHash` fallback; the local-cleanup chain re-checked
  `branchCleanupMode==='local'` / `cleanedBranch===head` / `cleanedRemoteBranch===false` / `cleanedLocalBranch` boolean;
  complete 3j-A approval evidence). **GitHub has no atomic SHA-conditional ref delete**, so the mitigation is
  read-immediately-before-delete + explicit SHA verify + a single `DELETE /git/refs/heads/<branch>` (slash-preserving
  per-segment encoding, CA change 5), with an explicitly-accepted bounded residual race and Unverified-on-ambiguity.
  Already-absent → idempotent `REMOTE_BRANCH_CLEANED` (`cleanedRemoteBranch=false`, no DELETE).
- **Failure semantics (Q7, 3j-B).** Phase-aware: pre-delete → `RemoteBranchCleanupBlockedError` ("not deleted");
  at/after delete → `RemoteBranchCleanupUnverifiedError` (never "not deleted"); already-absent → idempotent. The typed
  errors live in `domain/repository-hosting.ts` (Option B, CA change 6) so adapter + manager + runtime share them; the
  manager does NOT blanket-convert a provider `Blocked` into `Unverified`.
- **3j-A behavior.** BRANCH_CLEANED + remote phrase → CRITICAL approval → PENDING (permission only, NO delete). PENDING
  intercepts every turn (approve → APPROVED; deny/cancel → BRANCH_CLEANED clearing ONLY the four approval fields, chain
  preserved; a remote/execute/status/deploy phrase → ambiguous re-prompt, never auto-approves/deletes). APPROVED is
  permission-only in 3j-A.
- **3j-B behavior (execution).** At REMOTE_BRANCH_CLEANUP_APPROVED an explicit **execution** command (checked FIRST,
  CA change 1; a re-request without an execute verb → already-approved) → `handleRemoteBranchCleanupExecutionTurn` →
  re-read the 3j-A approval (structured) + the 17-check preflight → `RepositoryHostingManager.deleteRemoteBranch`
  (live `getMergePreflight` merged-check + `getRemoteBranchCommit` + single provider `deleteRemoteBranch`) →
  `REMOTE_BRANCH_CLEANED` (mode 'remote', `cleanedRemoteBranchName`/`remoteBranchDeletedCommit`/`remoteBranchCleanedAt`/
  `…By`/`remoteBranchCleanupProvider`, `cleanedRemoteBranch=result.deleted`), preserving the full chain + approval
  evidence. Runtime calls the manager only, never the provider; token stays adapter-local.
- **Out of scope (Q8).** deploy · release · tag · delete default/`main` · arbitrary/user-named/bulk/wildcard delete ·
  force · `git push --delete` · LOCAL deletion · reset/force-push · PR/reviewer/label/assignee mutation · workflow
  dispatch · check rerun · shell/CommandExecution · ExecutionOrchestrator/WorkspaceWrite/Patch/CodeGeneration/Git
  changes. **3j-A additionally excludes** all remote deletion, the GitHub DELETE, the RepositoryHosting read/delete
  methods, and the `REMOTE_BRANCH_CLEANED` active state (all 3j-B).

### Consequences
- + The product now reaches the end of the development lifecycle: from a CRITICAL-gated approval (3j-A) an explicit
  execution command (3j-B) deletes the completed PR's remote branch via a single GitHub Git-refs DELETE — the final
  cleanup step — with the settled Blocked-vs-Unverified safety split and no atomic-CAS overclaim.
- − 3j-A: `ConversationRuntime` (+2 approval states, +4 approval fields, +2 classifiers, +1 reason builder, handlers)
  and `ResponseComposer` gain the approval surface. 3j-B: `domain` (RemoteBranchCleanupResult + 2 typed errors),
  `RepositoryHostingProvider`/`RepositoryHostingManager` (+`getRemoteBranchCommit`/`deleteRemoteBranch`), the GitHub
  adapter (git-refs GET + DELETE, slash-preserving ref path), `ConversationRuntime` (+`REMOTE_BRANCH_CLEANED` + the
  execution turn + 6 descriptive fields), and `ResponseComposer` (success/blocked/unverified/already-cleaned) gain the
  execution surface. No deploy/release/tag/default-branch/bulk/wildcard/force/`git push --delete`/local-delete/shell/
  `ExecutionOrchestrator`/`WorkspaceWrite`/`Patch`/`CodeGeneration`/Git-capability change.

### Relations
ADR-0059 (consumes the `BRANCH_CLEANED` anchor + the `interpretRemoteBranchCleanupIntent` classifier +
`cleanedRemoteBranch`; extends the local-vs-remote wording split), ADR-0057/0056 (the CRITICAL
merge-approval→execution two-turn pattern mirrored here + the RepositoryHosting Blocked-vs-Unverified rule for 3j-B),
ADR-0054/0053/0052/0051 (the RepositoryHosting capability: manager owns approval/ordering/integrity; provider owns
bounded GitHub REST, adapter-local token, no shell; `RepositoryIdentity`/`pullRequestRef` as the only target),
ADR-0023 (Git = local repository capability, never a remote URL — why remote deletion is RepositoryHosting-owned).
Plans: `docs/plans/sprint-3j-remote-branch-cleanup-plan.md` (3j-A approval),
`docs/plans/sprint-3j-b-remote-branch-cleanup-execution-plan.md` (3j-B execution).

## ADR-0061 — GitHub App Authentication (dev/PAT → GitHub App installation; adapter-local App key, short-lived installation tokens minted at execution; CAP-010 REST + CAP-002 push/clone; zero Core-contract change)

- **Status:** ✅ **Accepted** (v2 — GitHub App Authentication; Sprint 4a design ACCEPTED → this ADR gates Sprint 4b
  implementation). **Ratified by the Chief Architect / Product Owner on 2026-07-07** under the ratification
  conditions below (Sprint 4a/4b baseline; no new capability; `GitProvider` port + `LocalGitProvider` unchanged; no
  credential on `RepositoryInfo`/`RepositoryIdentity`; the secret boundary; one-shot `GIT_ASKPASS` only; HTTPS
  remote preflight required; SSH blocked for App-auth push; Discord credential-free; PAT dev-only; new artifacts use
  Quoky naming; no rename of existing identifiers; UAT + production secret creation NOT yet approved; no broad
  naming migration; Sprint 4c not started). Sprint 4b implementation is approved to proceed.
- **Date:** 2026-07-07
- **Scope:** Replace the developer/PAT repository-auth model with a **GitHub App installation** model for BOTH
  GitHub auth surfaces — **RepositoryHosting REST (CAP-010)** and **local `git push`/`clone` (CAP-002)**. The App
  private key is the only new durable secret and is **adapter-local**; a **short-lived installation access token**
  is minted **at execution time**, used as the Bearer for REST and as the git credential for push/clone, and never
  exposed. The change is **adapter-local + composition-root only** — **no `@chunsik/core` contract changes, no new
  capability.** Authoritative design: `docs/plans/sprint-4a-…-plan.md` (baseline, §11/§15/§18) and
  `docs/plans/sprint-4b-…-implementation-plan.md` (concrete implementation, both CA-accepted).

### Most important rule
> **The App private key and every minted installation token are adapter-local / composition-owned and NEVER appear
> in process argv, a git remote URL, `.git/config`, logs, anchors, an `ApprovalRequest.reason`, a Discord message,
> UAT evidence, or anywhere in `@chunsik/core`.** `LocalGitProvider` and the `GitProvider` **port are unchanged**;
> `RepositoryInfo`/`RepositoryIdentity` gain **no** credential field; there is **no new capability**. Authentication
> is orthogonal to governance — the existing HIGH/CRITICAL approval gates in front of push/PR/merge/cleanup are
> untouched. A pre-mutation auth/mint failure is **Blocked** ("did not happen"); a failure at/after a mutation is
> **Unverified** (never "did not happen").

### Decision
- **Q1 — New adapter-local auth component (`@quoky/github-app-auth`).** A new package (new `@quoky` npm scope,
  coexisting with `@chunsik/*`; directory `packages/github-app-auth/`) holds the App private key and mints tokens:
  `GitHubAppAuth.resolveInstallationId(owner,repo)` + `tokenForInstallation(installationId, scope?)`. App JWT is
  **RS256 via built-in `node:crypto`**; bounded single-request `fetch`; **no octokit/gh/curl/extra SDK** (ADR-0053
  preserved). It depends only on Node built-ins + `@chunsik/core` types. Function-neutral class names carry no
  product name and are kept as chosen.
- **Q2 — CAP-010 auth-source swap (the only RepositoryHosting-adapter edit).** `GitHubHostingConfig.token` becomes
  `auth: { kind:'github-app'; tokenSource: () => Promise<string> } | { kind:'pat'; token }`; `request()` reads the
  Bearer value from `await currentToken()`. **Everything else in `GitHubRepositoryHostingProvider` is unchanged**
  (fixed `https://api.github.com`, bounded fetch, sanitized `statusError` — no token/body echo, the exact
  POST-pulls / PUT-merge / DELETE-git-refs mutation set, reads, path-safety). The adapter never sees a JWT or
  installation — it receives an opaque bearer string.
- **Q3 — CAP-002 git credential (composition-root decorator + one-shot GIT_ASKPASS).** A composition-root
  `GitHubAppGitProvider` **decorator** implements the `GitProvider` port by wrapping an **unchanged**
  `LocalGitProvider`. Local ops delegate directly; the three remote-touching ops (`pushApprovedCommit` /
  `getRemoteRefCommit` (`ls-remote`) / `syncMainFastForward` (`fetch`)) **mint the token async first**, then build a
  **one-shot `GIT_ASKPASS`** runner: a unique per-invocation temp helper (`mkdtemp`, mode 0700, containing **no
  token literal** — it echoes `$GIT_APP_TOKEN` from the **child** process env), a fresh `childEnv`
  (`GIT_ASKPASS`, `GIT_APP_TOKEN`, `GIT_TERMINAL_PROMPT=0`) passed to a single `spawnSync`, with the temp helper
  removed in a `finally`. **PROHIBITED as defaults (RC1):** token in argv, `git -c http.extraHeader=…`,
  `https://x-access-token:<token>@…` remote URL, `.git/config` write, any persistent credential-helper write.
- **Q4 — Boundary (RC2).** The `GitProvider` port is **not** amended; `LocalGitProvider` is **byte-for-byte
  unchanged** (the async mint happens in the decorator before the sync spawn, so git-local never mints/reads/
  forwards a token or a remote URL); core never sees a credential; `RepositoryInfo`/`RepositoryIdentity` get no
  credential field.
- **Q5 — Concurrency + leakage (RC3).** Credential state is per-invocation: a fresh `childEnv` (the parent
  `process.env` is **never** mutated) + a unique temp helper dir → concurrent GitHub-mutating executions are
  isolated; cleanup is guaranteed in a `finally` on success, Blocked, and thrown exception; child-env/token are
  never logged (`sanitizeGitStderr` remains the stderr backstop). v1 need not block concurrency; if per-invocation
  isolation cannot be guaranteed on the target platform, v1 MAY serialize GitHub-mutating executions — stated
  explicitly, without overclaiming product-wide concurrency.
- **Q6 — installation_id resolution.** `GET /repos/{owner}/{repo}/installation` (App JWT); `200`→`id`, `404`→`null`
  ("not installed" fail-safe), else sanitized error. In-memory cache keyed by `owner/repo`; **no persisted mapping**
  (deferred to multi-project/team). `owner`/`repo` are the reviewed identity (ADR-0051), never a chat-supplied id.
- **Q7 — Token minting + in-memory cache.** `POST /app/installations/{installationId}/access_tokens` (App JWT);
  parse `token`+`expires_at` only; **short-lived (~1h)**; in-memory cache with a refresh buffer; minted **lazily at
  execution** (never eagerly at boot); **never persisted/logged/returned**. Per-execution **down-scoping**
  (`repository_ids` + minimal `permissions: contents:write, pull_requests:write`) where GitHub allows. One mint
  serves both surfaces (REST + git) within its life.
- **Q8 — Config + fail-safe + auth-mode selection.** New env (read only in `apps/chunsik/src/config.ts`):
  `QUOKY_GITHUB_APP_ID` / `QUOKY_GITHUB_APP_PRIVATE_KEY(_PATH)` / `QUOKY_GITHUB_APP_INSTALLATION_ID` (optional) /
  `QUOKY_GITHUB_OWNER` / `QUOKY_GITHUB_REPO` / `QUOKY_RUNTIME_ENV`. **prod:** App-only; **PAT-only rejected**;
  **App+PAT rejected as ambiguous** → not-configured (fail-safe, sanitized warning). **dev:** App precedence, PAT
  fallback. Not-configured / incomplete App config / not-installed / **pre-mutation mint failure → Blocked**; a
  mint/refresh failure at/after a call → **Unverified**. The private key enters only the App-auth config at the
  composition root — never core/runtime/anchor/logs. `ConversationRuntime` still receives `manager | undefined`,
  never a token.
- **Q9 — Naming boundary (CA correction).** New artifacts use **Quoky** (`@quoky/github-app-auth`,
  `QUOKY_GITHUB_APP_*`, `QUOKY_GITHUB_OWNER/REPO`, `QUOKY_RUNTIME_ENV`). Existing legacy identifiers are **kept**:
  `@chunsik/*` packages, `apps/chunsik`, `CHUNSIK_*` env (`CHUNSIK_GITHUB_OWNER/REPO` = legacy owner/repo fallback;
  **`CHUNSIK_GITHUB_TOKEN` = dev-only PAT fallback**), `ChunsikConfig`, class/type/state/CAP/ADR identifiers. No
  repo-wide `ChunsikBot → Quoky` doc substitution. **Bulk migration is deferred to Sprint 4c — Quoky Naming
  Migration Plan** (plan-only, not started).
- **Q10 — HTTPS precondition.** App-token git auth requires the target remote to resolve to an
  `https://github.com/…` URL (so git prompts via askpass); **SSH remotes are blocked for App-auth push** (they would
  use ambient keys). A required UAT preflight verifies HTTPS.
- **Q11 — Discord boundary.** Discord stays a **credential-free transport** — never receives/stores/logs the App
  private key, an installation token, a PAT, or an App JWT; never accepts a secret pasted into chat; never selects
  repositories as an API permission boundary. It may only carry intent, show approval / not-configured / not-
  installed messages, and optionally provide a GitHub App install link.
- **Q12 — UAT re-entry (gated; not executed).** UAT re-enters on the GitHub App model (Sprint 4a §14: `quoky-dev`
  App on `jonghyungJeon-private/quoky-uat-sandbox` only, least-privilege set, secret-free evidence, App-token git
  push preflight). It runs **only after** this ADR is ratified, Sprint 4b is implemented + typecheck-clean + green
  on Node 22 + PR'd + CA-implementation-reviewed + merged, **and** CA explicitly says "App-auth UAT approved,
  proceed." The PAT-based Sprint 3o smoke test does **not** resume as-is.

### Consequences
- **+** Product-representative auth: short-lived, per-repo-scoped installation tokens instead of a hand-injected,
  terminal-ambient PAT; both GitHub surfaces (REST + git) authenticate from one adapter-local minting source.
- **+** Tiny blast radius — the adapter-local credential boundary (ADR-0051/0053/0054) means the swap is invisible
  to `@chunsik/core`: the `GitProvider`/`RepositoryHostingProvider` ports, the managers, the runtime, the domain,
  and `LocalGitProvider` are all unchanged. Establishes the Team-Edition multi-installation seam.
- **−** One new durable secret (the App private key) to manage; a new adapter package + an adapter-local minting
  component (JWT sign + token exchange + in-memory cache) + a composition-root git-credential decorator; the UAT
  must re-provision on the App model; concurrency may be conservatively bounded in v1 if isolation is unattainable.
- **Out of scope:** no new capability; no `GitProvider`/`RepositoryHostingProvider` port change; no domain/manager/
  runtime contract change; no production GitHub App secret creation/configuration without explicit CA approval; no
  broad naming migration and no Sprint 4c start; no UAT execution; no deploy/release/tag; GitHub Enterprise deferred
  (github.com only, ADR-0053).

### Relations
Extends **ADR-0051** (reviewed `RepositoryIdentity`, no token/URL — kept pure; adds a non-secret installation
resolution alongside), **ADR-0053/0054** (adapter-local credential boundary + built-in `fetch`/sanitized errors —
the reason the swap needs no Core change), and reuses **ADR-0057/0060** (the REST mutations now Bearer'd by the
minted token). Documents the **ADR-0023/0048** git boundary (git push/clone credential supplied ephemerally
*outside* git-local; the port is **not** amended, `RepositoryInfo` still exposes no remote URL). Naming boundary per
the CA Sprint 4b correction; bulk rename deferred to a future **Sprint 4c**. Plans:
`docs/plans/sprint-4a-github-app-authentication-architecture-plan.md` (accepted baseline),
`docs/plans/sprint-4b-github-app-authentication-implementation-plan.md` (accepted implementation plan).

## ADR-0062 — Preview Intent Routing Fix (deterministic preview intent into the existing CodeChangePreview pipeline; negation-aware pre-classification gates)

- **Status:** ✅ **Accepted** (Sprint 4c-Follow-up). Ratified by the Chief Architect via the follow-up plan
  approval (APPROVED 2026-07-09) and the implementation-plan approval (APPROVED 2026-07-09) under the approved
  scope below; subject to the standard CA implementation-PR review before merge.
- **Date:** 2026-07-09
- **Scope:** Fix the product/runtime command-UX / intent-routing gap that BLOCKED Gate 4B Scenario C. It is **not** a
  GitHub App auth failure — the App happy path (installation resolution / token mint / push / PR) was never reached.
  Two confirmed root causes: (A) the pre-classification mutation gates matched commit/push/apply/PR/**test** tokens
  regardless of **negation**, so "do not commit / do not push / 테스트 실행하지 마" hijacked routing; (B) there was
  **no preview entry point** — a preview is only a byproduct of `IMPLEMENT_CODE`. Authoritative design:
  `docs/plans/sprint-4c-followup-preview-intent-routing-fix-plan.md` and `…-implementation-plan.md` (both CA-approved).

### Most important rule
> The fix changes **only** intent RECOGNITION/ROUTING. It **relaxes no approval boundary** and adds **no
> automation**: the shipped lifecycle `CodeChangePreview → WORKSPACE_APPLIED → COMMIT_APPROVAL → GIT_COMMITTED →
> PUSH_APPROVAL_PENDING → PUSH_APPROVED → GIT_PUSHED → PR_CREATED` is unchanged, each remote step still separately
> approved. A preview-only request KEEPS the existing HIGH-risk plan approval before AI patch generation (7a); it
> never applies/commits/pushes/PRs. **No GitHub App auth / token-flow code is touched (ADR-0061 preserved).**

### Decision
- **FIX-1 (deterministic PREVIEW intent).** `IntentClassifier` recognizes an explicit preview request (KO+EN
  `PREVIEW_WORDS` — "변경 미리보기", "코드 변경 미리보기", "patch/diff preview", "preview only", "파일 변경안", … —
  plus an explicit `/preview <request>` command) and routes it to `IntentType.IMPLEMENT_CODE` /
  `Capability.CODE_IMPLEMENTATION` with `raw.kind:'preview'`. This reuses the EXISTING `planningOnly` → HIGH-risk
  plan approval → `runCodeGenerationPreview` pipeline and stops at the read-only `ELIGIBLE` diff preview. No new
  anchor status, no new lifecycle state. **7a selected; 7b (AI generation without the plan approval) is DEFERRED /
  NOT APPROVED.**
- **FIX-2 (negation-aware gates).** A shared, deterministic, clause-scoped `isNegated()` / `unnegatedMatch()`
  (new module `packages/core/src/application/intent-negation.ts`) makes the pre-classification gates count a token
  only when it is NOT under an explicit negation in the same clause. Applied to `interpretCommitIntent`,
  `interpretCommitExecutionIntent`, `interpretPushIntent`, `interpretPushExecutionIntent`, `interpretApplyIntent`,
  `interpretPatchIntent`, `interpretFinalApplyIntent`, `interpretPrIntent`, `interpretPostApplyValidationIntent`,
  **and `IntentClassifier.detectTestRun`** (the last was directly implicated — the bot ran `pnpm test` despite
  "테스트 실행하지 마"). Negation only REMOVES a trigger; it never creates a positive intent. Non-negated behavior
  is unchanged (ADR-0033 test execution, the commit/push/apply/PR gates all behave exactly as before).
- **FIX-3 (anchor-independent commit-gate precedence).** OPTIONAL / constrained — not required after FIX-1+FIX-2;
  the full test matrix passes without it, so it was NOT implemented this slice. (Any future change here must not
  weaken a boundary or remove the safe "no applied change to commit" reply.)

### Consequences
- **+** A "patch/diff preview only" request now reaches preview generation; negated prohibitions no longer hijack
  routing; the exact Gate 4B failure is fixed at both root causes.
- **+** Tiny, contained blast radius: one new pure util module + recognition-only edits to `intent-classifier.ts`
  and the static matchers in `conversation-runtime.ts`. No port/domain/manager/lifecycle/App-auth change.
- **−** One more deterministic layer to maintain (KO/EN negation markers + clause splitting); it deliberately does
  NOT resolve contrastive "A 말고 B" forms (out of scope). Routing stays deterministic (no AI in routing).
- **Validation:** Node 22 `typecheck` exit 0; `pnpm test` 51 files / 1131 tests green (49/1098 baseline preserved +
  33 new covering preview routing, negated commit/push/apply/PR, negated TEST_EXECUTION, and unchanged genuine paths).

### Relations
Extends **ADR-0038** (AI Code Generation Preview) / **ADR-0040** (Explicit Preview Apply Approval); makes the
**ADR-0045** (commit) / **ADR-0047** (push) approval-word matchers and **ADR-0033** (Live Test Execution,
`detectTestRun`) / **ADR-0043** (Post-Apply Validation) negation-aware. Does **NOT** touch **ADR-0061** (GitHub App
Authentication) — no App-auth/token-flow change. Plans:
`docs/plans/sprint-4c-followup-preview-intent-routing-fix-plan.md` (investigation + approved scope),
`docs/plans/sprint-4c-followup-preview-intent-routing-fix-implementation-plan.md` (implementation design).

## ADR-0063 — Provider-Neutral Context Provenance and Current-Fact Precedence

- **Status:** ✅ **Accepted** — ratified by Product Owner and Chief Architect on 2026-07-19. Implementation requires
  separate approval.
- **Date:** 2026-07-19
- **Scope:** Supersedes only the relevant context-shaping portions of **ADR-0017** and **ADR-0018** as stated in
  Relations. It does not change memory persistence, project registration, intent/capability routing, provider
  selection, approvals, execution, storage, or mutation policy.

### Context

PR #52 removed Core-side keyword/regex connection-target interpretation and delegated natural-language meaning to
the selected `GENERAL_CHAT` provider. A Live UAT then received the ambiguous current-connection question through
Discord and produced the prior project-target answer from an `ollama-cli` run. The served artifact contained the
new Quoky prompt and no connection-target resolver.

The failed Session contained both an active-project summary and earlier Assistant-generated copies of the same
incorrect answer. Under ADR-0017, ContextBuilder flattens the most recent same-Session User and Assistant memories
to `role: text` strings. Under ADR-0018, the active project's memory summary is included in later chat. PromptComposer
currently places the platform fact, project background, and flattened transcript in one context layer. Role is
visible, but source provenance and epistemic authority are not preserved as separate concepts. Consequently, a
Provider can treat earlier generated Assistant text or project-memory content as current system evidence.

The required invariant is:

> AI decides meaning. Core decides authority, provenance, and facts.

Quoky remains an AI Assistant rather than a command bot. Core must provide a clear provider-neutral context contract
without deciding semantic targets from phrases, adding a second AI call, or deleting contaminated history.

### Decision

#### 1. Separate provenance from epistemic status

Context supplied to a Provider MUST preserve two independent axes. Implementations may refine type names, but MUST
NOT collapse these axes into one field.

**Source / provenance** identifies where content came from:

- **Core Runtime** — data established by the current application turn;
- **User** — User-authored message content;
- **Assistant** — earlier AI-generated response content;
- **Project Memory** — stored active-project summary/background.

**Epistemic status / authority** identifies how the Provider may rely on it:

- **authoritative current fact** — a fact Core can establish for the current turn;
- **user-provided claim or intent input** — authoritative as the User's request/claim, not as external truth;
- **assistant-generated non-authoritative content** — continuity material that may be inaccurate;
- **non-authoritative background** — contextual material that does not establish the current request target or
  external truth.

User input is never promoted to an authoritative system fact merely because the User stated it. Assistant output
never becomes authoritative merely because it was persisted as SHORT_TERM memory. Project memory never becomes
authoritative merely because its project is active.

Chunsik Memory remains the source of record for what was stored and for the provenance attached to each record.
That authority covers the record's existence and origin; it does not establish the external truth of a stored User
claim, Assistant output, or project summary. Record provenance and content-level epistemic truth remain distinct.

#### 2. Give current-turn facts one owner

`Session.activeProjectId` remains the source of the mutable active-project selection that persists across turns.
When a Task is created, `Task.projectId` captures that selection as the immutable project reference for the current
turn. The **Task** is the single source of current-turn facts used during prompt composition:

- `Task.context.platform` owns the inbound conversation-platform value;
- the existence of `Task.projectId` reflects the active-project selection captured for that Task;
- reaching PromptComposer through the normal Runtime path establishes that the inbound message was accepted by the
  Runtime for processing;
- response generation occurs before outbound delivery success can be established.

ContextBuilder MUST NOT duplicate these current-turn facts into ContextBundle. It owns only:

- bounded, ordered conversation history with preserved role/provenance;
- active-project memory rendered as non-authoritative background.

PromptComposer combines Task and ContextBundle. It derives and renders the current-facts section from Task, then
renders background and transcript sections from ContextBundle. Task and ContextBundle MUST NOT store parallel
copies of the same current-turn fact.

#### 3. Bound authoritative facts narrowly

Core MAY present the following as authoritative current-turn facts:

- the current request was received through the conversation platform named by `Task.context.platform`;
- the inbound message was accepted by the Runtime for the current turn;
- outbound response delivery success is not yet known at response-generation time;
- an active project id is selected for the Task when `Task.projectId` exists.

Core MUST NOT present the following as authoritative facts without separate verified evidence:

- overall Discord Gateway or transport health;
- the health or actual connection state of any external service;
- successful outbound response delivery before delivery occurs;
- the truth of project-memory summary content;
- the truth of any earlier Assistant response;
- a semantic target inferred from keywords, regexes, language-specific phrases, provider id, concrete platform
  value, or project name.

The platform fact proves how the current inbound request reached Quoky; it does not prove global transport health.
The active-project-id fact proves selection state; it does not prove project-summary correctness or make the project
the implicit target of the User's question.

#### 4. Keep active-project selection separate from project background

The active-project concepts are split as follows:

- **`Session.activeProjectId`** — mutable active-project selection owned by Session across turns;
- **`Task.projectId`** — immutable current-turn snapshot captured from `Session.activeProjectId` when the Task is
  created and used as the authoritative selection fact for prompt composition;
- **project memory/summary content** — Project Memory provenance with non-authoritative-background status, assembled
  by ContextBuilder;
- **request target** — natural-language meaning decided by the selected `GENERAL_CHAT` Provider.

ContextBundle does not duplicate `Task.projectId` or an equivalent current-turn selection fact. PromptComposer
combines the Task-owned snapshot with ContextBuilder's project background while preserving their distinct authority
and meaning.

Project background remains available for legitimate project-aware conversation. Core MUST NOT condition its
inclusion on phrase matching, and the existence of an active project MUST NOT by itself identify the current User
question's target.

#### 5. Preserve conversation history with role and provenance

ContextBuilder continues to retrieve the most recent same-Session SHORT_TERM records under ADR-0017's existing
bounds, ordering, truncation, current-inbound exclusion, and pruning policy. It MUST preserve User/Assistant role and
provenance in structured context until PromptComposer renders it.

Assistant turns remain available for continuity, including follow-ups that refer to the preceding answer. They are
rendered as Assistant-generated, non-authoritative transcript entries that may be inaccurate. They are not deleted,
rewritten, hidden through sentence matching, or moved to a special clean Session. Missing or malformed legacy role
metadata fails safe as non-authoritative transcript content, never as an authoritative current fact.

#### 6. Render explicit provider-neutral precedence

PromptComposer renders the following conceptual sections in this order:

1. **Current-turn facts supplied by Core** — derived from Task;
2. **Background resources** — including active-project memory, explicitly non-authoritative for target selection;
3. **Conversation transcript** — continuity material with User/Assistant provenance and epistemic labels;
4. **Current User task** — the existing final Task layer.

The `GENERAL_CHAT` developer contract instructs every provider that:

- the current User task is interpreted naturally using the whole conversation;
- current Core facts outrank contradictory Assistant-generated history;
- User messages are intent/claim input, not automatically verified external facts;
- Assistant history supports continuity but is not evidence of current state;
- active-project background is not an implicit target merely because it exists;
- a short clarification is requested only when meaning remains genuinely uncertain;
- external status absent from current Core facts is not invented.

These are provenance and precedence rules, not semantic resolution rules. No specific natural-language sentence,
language, provider, project name, or transport name is part of the decision logic.

#### 7. Keep one Provider call and existing governance

Natural-language interpretation and final response generation remain one selected `GENERAL_CHAT` provider call.
This ADR adds no semantic classifier, target enum/parser, confidence service, additional AI call, provider-id branch,
or concrete transport branch.

The decision does not change IntentClassifier, IntentResolver, CapabilityRouter, approval/risk policy, execution
requests, workspace access, storage schema, Session identity, memory contents, or Runtime mutation boundaries.

### Consequences

- **+** Current facts, User claims, Assistant output, and project background have explicit, independent provenance
  and epistemic status.
- **+** Contaminated Assistant history remains usable for continuity without being promoted to current evidence.
- **+** Active-project context remains available without becoming an implicit semantic target.
- **+** The contract is deterministic and provider-neutral while meaning interpretation stays with the selected AI.
- **+** No extra Provider call, memory cleanup, Session reset, storage migration, or routing change is required.
- **−** `ContextBundle` and related fixtures must evolve from flattened strings to structured conversation turns.
- **−** Prompt wording and structure affect all `GENERAL_CHAT` providers and require contract, regression, and Live
  UAT coverage.
- **−** A structurally stronger prompt still cannot guarantee that every model follows the contract; Provider
  behavior remains a separately verified UAT concern.
- **Risk:** Over-isolating Assistant history could degrade ordinary follow-ups. Tests must prove the content remains
  present, ordered, bounded, and usable.
- **Risk:** Treating `authoritative` too broadly could create false claims. Only the fact boundary above is allowed.

### V1 / V2

**V1 target — after ratification and separately approved implementation:**

- provider-neutral structured history entries with separate provenance and epistemic status;
- Task-owned current-turn facts;
- ContextBuilder-owned history and project background;
- PromptComposer-owned sectioning and precedence;
- one existing `GENERAL_CHAT` Provider call;
- deterministic contract/application-flow tests plus separately approved Live UAT.

**V2+ [LATER]:** semantic retrieval/ranking, summarized memory, confidence models, or richer factual verification.
None is introduced by this ADR. A future feature that changes routing or adds AI calls requires its own ADR.

### Supersession and Relations

- **ADR-0017 is superseded only in this respect:** recent conversation is no longer flattened to unqualified
  `role: text` strings before prompt composition. Existing same-Session retrieval, N=10 bound, oldest-to-newest
  ordering, 400-character truncation, current-inbound exclusion, storage, and pruning decisions remain in force.
- **ADR-0018 is superseded only in this respect:** `Session.activeProjectId` continues to own mutable selection across
  turns, while `Task.projectId` is the immutable current-turn snapshot used during prompt composition; PROJECT
  memory/summary is non-authoritative background, and active-project existence does not establish the current request
  target. Project registration, scanning, persistence, workspace gating, and read-only behavior remain in force.
- Extends **ADR-0002** (ContextBuilder assembles structured per-run context) and **ADR-0003** (PromptComposer owns
  provider-neutral layered prompt authorship).
- Preserves `ARCHITECTURE.md` provider rules: Core does not know Ollama/Discord as concrete implementations, does
  not branch on provider id, and does not pin providers to Session/Task/Actor.

### Approval Boundary

This Accepted ADR records the ratified Architecture decision only. Ratification does not authorize production/test
implementation, Build/Test, Merge, Runtime/Discord/AI execution, DB/session/memory mutation, Live UAT, Cleanup, or
Gate 6. Each requires separate explicit approval.
