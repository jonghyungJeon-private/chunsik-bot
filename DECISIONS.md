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
