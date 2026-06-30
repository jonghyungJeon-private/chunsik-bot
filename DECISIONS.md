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
