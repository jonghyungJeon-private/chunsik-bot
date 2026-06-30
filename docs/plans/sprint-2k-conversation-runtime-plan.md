# Sprint 2k Implementation Plan — Conversation Runtime (Application Layer)

- **Status:** ✅ APPROVED WITH CHANGES (Planning review) — implemented in ADR-0032. CA-confirmed
  decisions: `ChunsikCore` evolves to a thin facade delegating to `ConversationRuntime`; transient
  `TurnResult`/`RuntimeTurnStatus` (no aggregate); stateless resume via the fixed correlation source
  `Session.activeTaskId → Task.planId → approvals.findByExecutionPlan → PENDING`; decision
  interpretation only when pending (approve/deny/cancel/ambiguous); full conversational flow
  ownership; short-term memory only; `OutboundMessage` output with platform delivery outside the
  runtime; `ResponseComposer.composeExecutionResult` added. Out of scope held: Agent Runtime, Tool
  Calling, retry, Event Bus, Discord UI, telemetry, memory subsystem.
- **Phase:** **Phase 2 — Application Layer**, first **Product Construction** sprint. This is **not a
  new capability and not a new aggregate** — it is the **Application-Layer Runtime** that connects
  the user to the existing Application/Capability layers and makes 춘식봇 *feel* like one coherent
  assistant.
- **Date:** 2026-07-01 · **Base:** `main` @ `b96cd10` (CAP-001…009 + Execution Orchestrator merged).
- **Validation runtime (when implemented):** **Node 22** (`pnpm typecheck` / `pnpm test`).
- **Process:** V2 architecture-first, step 1 (Planning). Plan → review → approval → implementation.

> **Product-first framing.** The single question this sprint answers: **"사용자가 자연스럽게
> 사용할 수 있는 Runtime인가?"** The user never sees Capabilities, Orchestrators, or Aggregates —
> they send a message and get a natural reply (or a clear approval prompt, or a kind failure
> message). The Conversation Runtime is the thin layer that makes that true by **composing** what
> already exists; it adds **no new structure** of its own.

---

## 0. Foundational design (settle FIRST)

**1. What is the Conversation Runtime — and what is it NOT?**
It is an **Application-Layer Runtime service** — the single entry the platform calls per user
message. It owns the *conversation flow* and *transient runtime state*, and composes existing
services:

```
User Message (InboundMessage)
  → Conversation Runtime
      → SessionManager (open/touch Session)          [Conversation Session]
      → MemoryManager (record the user turn)          [Message / history]
      → IntentClassifier → Intent
      → branch:
          • conversational intent (chat / project-analysis / register) → existing single-shot path
          • execution intent → IntentResolver → ExecutionRequest → ExecutionOrchestrator.run/resume
      → ResponseComposer → OutboundMessage            [Assistant Response]
  → PlatformAdapter delivers the reply
```

It is **NOT** a Capability (owns no domain aggregate), **NOT** a new aggregate, **NOT** the Agent
Runtime (no autonomous loop/tool-calling/retry/reflection), and **NOT** a platform adapter (it works
on the platform-agnostic `InboundMessage`/`OutboundMessage` + `PlatformAdapter` port; Discord
specifics stay in the existing `DiscordPlatformAdapter`).

**2. What does it own / not own?**
- **Owns (flow + transient runtime state only):** Conversation Session lifecycle (via `SessionManager`),
  **Turn** orchestration (one user-message → assistant-response cycle), **Message** in/out
  (`InboundMessage`/`OutboundMessage` + short-term history), **Context** assembly (via
  `ContextBuilder`/`MemoryManager`), and **Runtime State** of the in-progress turn.
- **Does NOT own:** Planning, AI Generation, Patch, Approval, Workspace, Command (those are the
  capabilities, composed via the Execution Orchestrator), nor any persisted aggregate.

**3. How does it avoid a new aggregate (the central constraint)?**
- **Conversation Session** = the existing `Session` aggregate (thin; ADR-0001). Reused as-is.
- **Message / history** = existing `InboundMessage`/`OutboundMessage` value types + existing
  **short-term conversation memory** (already recorded per session). No new store.
- **Turn** = a **transient runtime concept** (not persisted): one inbound message processed to one
  outbound reply. Work-path turns already map to the existing `Task`/`TaskRun`; execution-path turns
  map to the Sprint 2j `ExecutionOutcome`. No `Turn`/`Message`/`Conversation` aggregate is added.
- **Runtime State** = a **transient** per-turn value (e.g. `RESPONDED | AWAITING_APPROVAL | FAILED |
  CANCELLED`), derived from the turn's result (`ExecutionOutcome.status` for execution turns). Not
  persisted by the runtime; **never stored as a snapshot on `Session`** (AGENTS.md §4).

**4. How is the cross-turn Approval halt handled (the hard part)?**
The Execution Orchestrator halts at `AWAITING_APPROVAL` (Sprint 2j). Across turns this means: turn N
asks for approval; a later turn N+k carries the user's decision. To stay **stateless** (consistent
with the Sprint 2j orchestrator and "no new aggregate"), the runtime **derives** the pending state
from existing aggregates: a `Session`'s in-focus execution plan that has a **PENDING `ApprovalRequest`**
is "awaiting approval". On the next user turn the runtime, seeing that pending state, interprets the
message as an approval decision, records it via `ApprovalManager.decide`, and calls
`ExecutionOrchestrator.resume`. **No runtime state is persisted by the runtime itself.** (How the
session is correlated to its in-flight plan is Decision Q2.)

**5. What about failure & cancellation (Product quality)?**
Reuse what exists: AI/capability failures already classify to a kind + a kind user-facing message
(ADR-0015 / `describeAiFailure` / `ResponseComposer.composeError`). Execution failures surface as a
clear reply naming nothing technical. The orchestrator's `STOPPED_ON_FAILURE`/`DENIED`/`CANCELLED`
outcomes map to graceful replies. A user can cancel an awaiting-approval turn (Sprint 2j cancellation
contract) — surfaced as a natural "취소했어요" reply.

**6. Why is this Product Construction, not Architecture Construction?**
It introduces **no new architecture** — no port, no aggregate, no capability, no migration. It is a
composition/runtime service whose value is entirely **user experience**: one coherent assistant that
plans, proposes, asks approval, applies, and runs — without the user ever seeing the machinery.

---

## 1. Objective

Build (design now, implement post-approval) the **Conversation Runtime**: the single per-message
entry that turns a user message into a natural assistant response by composing Session + Intent +
(chat | Execution Orchestrator) + Response, and that manages turn/runtime-state — including the
approval halt/resume — so 춘식봇 behaves like one assistant. Target shape:

```
User → Conversation Runtime → Intent Resolver → Execution Orchestrator → Capability Managers → Capability Aggregates → Response
```

## 2. Scope (this Sprint — plan-only)

- **Conversation Runtime Planning document** (this file): the runtime's responsibilities, the
  turn flow, reuse of Session/memory/Intent/Orchestrator/Response, the **transient** turn &
  runtime-state model (no new aggregate), the Approval halt→resume conversation contract, failure &
  cancellation UX, proposed (non-binding) interface sketches, risks, and the validation strategy.
- **Chief Architect Review request.**

That is the entire Sprint 2k deliverable.

## 3. Out of Scope (explicit — CA Direction)

- ❌ **Agent Runtime** (autonomous plan-act-observe loop) · ❌ **Tool Calling** · ❌ **Retry** ·
  ❌ **Reflection** · ❌ **Workflow Engine** · ❌ **Background Task**.
- ❌ **Memory** as a new subsystem (no long-term/vector/working-memory work). The runtime **reuses
  the existing short-term conversation memory** for turn history — nothing new.
- ❌ **Discord** / platform-specific UI (approval buttons, rich embeds). The runtime is
  platform-agnostic (`InboundMessage`/`OutboundMessage` + `PlatformAdapter`); the `DiscordPlatformAdapter`
  is unchanged this sprint.
- ❌ **Telemetry / Metrics.**
- ❌ **New aggregate / repository / migration / port / capability**; ❌ any Core-contract change;
  ❌ changing any capability manager or the Execution Orchestrator contract.

## 4. Architecture Impact / Positioning

- **Pure Application-Layer addition**, `[NOW]`: a runtime service composing existing services. **No
  new domain aggregate, no new port, no new repository, no migration.**
- **Relationship to `ChunsikCore`** (Decision Q1): `ChunsikCore` is today's de-facto conversation
  entry (single-capability; its approval gate is a deliberate `NotImplementedError`). The
  Conversation Runtime is exactly the layer that seam awaited. Recommended: the Conversation Runtime
  **is** this entry (either `ChunsikCore` evolves into it, or a `ConversationRuntime` service it
  delegates to) — not a parallel structure. Net new structure must be minimal.
- **Composes, never absorbs.** It calls `SessionManager`, `MemoryManager`, `ContextBuilder`,
  `IntentClassifier`, `IntentResolver`, `ExecutionOrchestrator`, `ResponseComposer`, `PlatformAdapter`
  — and owns none of their responsibilities. Capability managers remain mutually unaware; the
  orchestrator stays stateless; provider selection stays with `ProviderSelector`; retry stays a
  future Agent Runtime concern.
- **Stateless** (consistent with the Application Layer): no runtime state persisted by the runtime;
  the approval-halt state is derived from existing aggregates.

## 5. Runtime Flow & Composition (the contract that matters)

| Step | Action | Reuses (existing) |
|---|---|---|
| 1 | Resolve Actor; open/touch Session | `ActorManager`, `SessionManager` |
| 2 | Record the user turn (short-term memory) | `MemoryManager.recordShortTerm` |
| 3 | Classify intent | `IntentClassifier` |
| 4a | **Pending-approval turn?** (derived) → interpret as decision → `ApprovalManager.decide` → `ExecutionOrchestrator.resume` | Sprint 2j orchestrator |
| 4b | **Conversational intent** (chat/analysis/register) → existing single-shot path | provider via `ProviderSelector`, `ProjectAnalyzer`, etc. |
| 4c | **Execution intent** → `IntentResolver.resolve` → `ExecutionOrchestrator.run` | Sprint 2j resolver + orchestrator |
| 5 | Map the outcome to a reply: COMPLETED→result · AWAITING_APPROVAL→`composeApprovalNotice` · DENIED/CANCELLED/FAILED→graceful message | `ResponseComposer` (incl. `composeApprovalNotice`, `composeError`) |
| 6 | Record the assistant turn; deliver | `MemoryManager.recordAssistant`, `PlatformAdapter.sendMessage` |

The runtime is the only place these are sequenced; each composed service keeps its own
responsibility and boundary.

## 6. Responsibility & Boundaries

- **In:** per-message turn orchestration; Session lifecycle calls; message history record/replay;
  context assembly hand-off; runtime-state derivation; mapping outcomes → natural replies; the
  approval halt→resume conversation contract.
- **Out:** planning, AI generation, diffing, approval decisioning logic, patching, writing, command
  gating, provider selection, persistence of any aggregate, retry, memory subsystems, platform
  rendering.
- **Single responsibility:** *turn one user message into one natural assistant response by composing
  the existing layers, and carry conversation/runtime state across turns — statelessly.*

## 7. Transient runtime model (NO new aggregate)

Design sketches (Application-layer types, not domain aggregates, not persisted; final shapes settle
at implementation):
- `ConversationRuntime.handle(message: InboundMessage): Promise<TurnResult>` — the single entry.
- `TurnResult` (transient): `{ status: RESPONDED | AWAITING_APPROVAL | DENIED | FAILED | CANCELLED,
  reply: OutboundMessage, sessionId, executionOutcome? }`.
- `RuntimeTurnStatus` enum at the Application layer (distinct from any domain status).
- Reuses: `Session`, `InboundMessage`/`OutboundMessage`, `Intent`, `ExecutionRequest`/`ExecutionOutcome`
  (Sprint 2j), short-term memory records. **No `Turn`/`Message`/`Conversation` aggregate, no table.**

## 8. ADR Impact

- **Proposed ADR-0032 — Conversation Runtime (Application-Layer runtime; stateless composition).**
  Authored at implementation time (post-approval): the runtime as a stateless Application service;
  reuse of Session/short-term-memory/Intent/Orchestrator/Response; the transient turn & runtime-state
  model (no new aggregate); the Approval halt→resume conversation contract; the `ChunsikCore`
  relationship; failure/cancellation UX; and the explicit Out-of-Scope deferrals.
- **Relates:** ADR-0001 (Session, thin), ADR-0017 (short-term memory), ADR-0031 (Execution
  Orchestrator), ADR-0025 (Approval), ADR-0015 (failure taxonomy / kind replies), ADR-0003 (prompt/
  context layering). **Supersedes nothing.**

## 9. Risks (Product/runtime-focused)

| Risk | Severity | Mitigation |
|---|---|---|
| Runtime drifts into the Agent Runtime (loops, tool-calling, retry) | **High** | Single forward turn; no loop/retry/reflection; those are explicitly out of scope (Phase 3) |
| Runtime grows a new aggregate / persists state | **High** | Stateless; reuse Session + short-term memory + derived approval state; `TurnResult` is transient |
| Snapshotting context/state onto `Session` | Med | Forbidden (AGENTS.md §4) — context rebuilt per turn; only existing `Session` lifecycle fields used |
| Cross-turn approval resume is ambiguous (which message = the decision?) | **Med-High** | Decision Q2/Q4: derive pending state from the session's in-flight plan + a minimal approval-decision interpretation; deep UI deferred |
| Absorbing capability/orchestrator responsibility | Med | Compose-only: call public methods; managers stay mutually unaware; orchestrator contract unchanged |
| Unnatural UX (confusing approval prompt, leaking internals, opaque failures) | **Med (Product)** | `composeApprovalNotice` for approvals; ADR-0015 kind error replies; never surface provider/capability internals |
| Duplicating `ChunsikCore` instead of evolving it | Med | Q1: evolve/delegate, don't add a parallel entry |

## 10. Validation strategy (for the FUTURE implementation — not run this Sprint)

When implemented (post-approval), tests (Node 22) with **fakes** for the composed services would
prove: a chat turn → a `RESPONDED` reply; an execution turn (auto-approved) → composed orchestrator
run → natural reply; a HIGH-risk execution turn → `AWAITING_APPROVAL` + an approval-notice reply, no
downstream run; the **next** turn (approval decision) → `resume` → final reply; a denied/failed/
cancelled outcome → a graceful reply; the runtime **persists no new aggregate** and **stores no
snapshot on Session**; it imports only Application services + the `PlatformAdapter`/`Logger` ports.
`pnpm typecheck` exit 0; full regression green. *(No tests written in Sprint 2k.)*

## 11. Rollback / Blast Radius

Additive Application-layer service (+ at most an evolution of `ChunsikCore`'s wiring). Rollback =
`git revert`. No migration, no schema, no Core-contract change, no capability change. Blast radius:
the conversation entry path (guarded by the regression suite + fakes); capabilities and the
orchestrator are untouched.

## 12. Chief Architect Decision Questions

1. **`ChunsikCore` relationship** — evolve `ChunsikCore` into the Conversation Runtime, or add a
   `ConversationRuntime` service that `ChunsikCore` delegates to? (Recommend: evolve/delegate, no
   parallel structure.)
2. **Cross-turn approval correlation** — derive the awaiting-approval state statelessly from the
   session's in-flight `ExecutionPlan` + its PENDING `ApprovalRequest` (no snapshot on Session)?
   Confirm how Session ↔ in-flight plan is correlated (e.g. via the existing `Session.activeTaskId`
   / a plan lookup), without a new aggregate.
3. **Turn / Runtime State modeling** — keep Turn and Runtime State **transient** (no new aggregate),
   reusing `Task`/`TaskRun` + short-term memory + `ExecutionOutcome`? Confirm.
4. **Approval-decision interpretation** — how is a user message recognized as an approval decision
   (a minimal yes/no/cancel interpretation by the runtime) and routed to `resume`? Confirm the
   contract; confirm deep platform UI (buttons) is deferred.
5. **Conversational path ownership** — should the Conversation Runtime own the **full** flow
   (chat/analysis/register **and** execution), fully subsuming `ChunsikCore`'s current behavior, or
   only the execution path? (Recommend: the full flow — that is what a "Conversation Runtime" is.)
6. **Memory boundary** — reuse existing short-term memory only (no new memory work) this sprint?
   Confirm.

## Next Step
Stop here and wait for Chief Architect review. On approval I will author ADR-0032 and implement only
the approved runtime (composition + transient turn/runtime-state + approval halt→resume) on a
`v2/<topic>` branch, with fake-based tests, validate on **Node 22**, and open a PR for implementation
review. **No code/branch/commit/PR until then** — this Sprint produces only this plan.
