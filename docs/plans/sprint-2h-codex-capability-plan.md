# Sprint 2h Implementation Plan — CAP-008 AI Code Generation Capability (Codex)

- **Status:** ✅ APPROVED (Planning review, Round 2) — implemented in ADR-0029. Round-1's **4
  Merge-Blocking** plan changes were reflected and accepted: (1) split `CodeProposal` aggregate,
  (2) `PromptRenderer` layer (`AiProvider` takes `AiRequest`, not `PromptSpec`), (3) extract
  `ProviderSelector`, (4) AI-Layer Aggregate Ownership Rule in ADR-0029. The final-approval
  Non-blocking list (`generationHash` — so the planned `promptHash` was dropped —
  `providerVersion`/`modelVersion`, Proposal Lifecycle, Prompt Version, Provider Cost, Token
  Usage, Provider Capability, Failure-Taxonomy extension) was NOT implemented.
- **Capability:** **CAP-008 — AI Code Generation** (the **first AI Layer** capability). Codex
  is its **first provider adapter**; CAP-009 Ollama is a second adapter behind the SAME contract.
- **Date:** 2026-06-30 · **Base:** `main` @ `b190c9f` (CAP-001…007 merged).
- **Process:** V2 architecture-first, Step 1 (Implementation Plan). Plan → review → approval →
  implementation. Do not bypass the planning gate.

> **Framing.** "Codex" is a *provider*, not the capability. The capability is **AI Code
> Generation** — it OWNS the act and record of an AI authoring a code **proposal**. Codex (and
> later Ollama) are interchangeable `AiProvider` adapters that serve it. This framing is what
> keeps the AI Layer independent and is the basis for every answer below.

---

## 0. Foundational design (answers to the 10 mandated questions — settle FIRST)

The AI Layer must hold capability independence *more* strictly than prior capabilities, because
an AI provider is general-purpose and will "want" to do everything. The boundary is drawn here.
The CA's Round-1 changes sharpen three internal seams (proposal aggregate, prompt rendering,
provider selection) — folded into the answers below.

**1. What does the Codex / AI Code Generation capability own?**
It owns **TWO aggregates** (the AI-Layer ownership rule, MB-4 / ADR-0029):
- **`CodeGeneration`** — the Execution-History record of one AI code-generation *run*:
  `{ executionPlanRef, capability, promptHash, status, failureKind?, codeProposalRef? }`. It holds
  only a **`CodeProposalRef`** to its output.
- **`CodeProposal`** — the produced *artifact*: `{ codeGenerationRef, proposal: ProposedChange[],
  providerId, usage?, artifacts? }`. All heavy/produced data (the `ProposedChange[]`, the provider
  metadata, usage, artifacts) lives here, NOT on `CodeGeneration`.

It owns the *authoring of a code proposal* — nothing else. It does NOT own ExecutionPlan,
ApprovalRequest, PatchSet, WorkspaceChange, CommandExecution, prompts, conversation state, or the
AI provider itself.

**2. How is it independent from the Command capability (CAP-007)?**
Command Execution runs OS processes via the `CommandRunner` port; AI Code Generation produces
text/proposals via the `AiProvider` port. The capability **never spawns a process, never touches
`CommandRunner`, never runs a command.** If the Codex CLI is itself a subprocess, that is the
`AiProvider` *adapter's* private mechanism behind the `AiProvider` port — it is NOT CAP-007 and
NOT the `CommandRunner` port. They sit at opposite ends of the pipeline (Codex *authors*; Command
*runs*) and neither imports the other.

**3. What contract does it share with Planning (CAP-003)?**
ONLY `ExecutionPlanRef` (+ read-only, caller-supplied plan context: goal, target files, required
capabilities). It references the plan; it never mutates `ExecutionPlan` (Planning owns it).
Planning decides WHAT to do; AI Code Generation authors the code FOR that plan.

**4. What contract does it share with Patch (CAP-005)?**
ONLY the **`ProposedChange[]`** value object (the existing CAP-001 domain type) — now carried on
the **`CodeProposal`** aggregate — flowing Codex → (Workspace diff) → Patch. AI Code Generation
EMITS `ProposedChange[]`; Patch CONSUMES it (with a `WorkspaceDiff` + `ApprovalRef`) to build a
`PatchSet`. **Codex never builds a PatchSet** (Patch owns it); **Patch never calls AI.** The
proposal is passed by the caller (e.g. via `CodeProposalRef` → load `CodeProposal`) — no manager import.

**5. How far is the AI Provider (OpenAI/Codex) an Adapter responsibility?**
ALL external AI interaction is the `AiProvider` **adapter's** responsibility (the EXISTING port,
with its input narrowed per MB-2): process/HTTP invocation, auth, transport timeout, transport
retry, secret masking, and failure classification into `AiFailureKind` / `AiProviderError`
(ADR-0015). **Crucially (MB-2): the provider no longer renders prompts** — it receives a
**fully-rendered `AiRequest`** and never sees a `PromptSpec`. The *capability* (core
`CodeGenerationManager`) owns orchestration ONLY: compose → render → select → execute → parse →
persist. **Core stays HTTP/`child_process`-free** and never imports an OpenAI/Codex SDK, never
names `'codex-cli'`, never branches on provider `id`.

**6. Who owns the Prompt?**
A layered chain (sharpened by MB-2): **`PromptComposer` → `PromptSpec` → `PromptRenderer` →
`AiRequest` → `AiProvider`**.
- `PromptComposer` (core) owns prompt *authorship* (the layered `PromptSpec`, ADR-0003/0014).
- **`PromptRenderer` (new layer) owns *rendering*** `PromptSpec` → a provider-agnostic `AiRequest`
  (the rendered prompt text + context/workspace/timeout). This responsibility moves OUT of the
  provider adapter (the old `renderPromptSpec`).
- The `AiProvider` adapter owns NEITHER authorship NOR rendering — it consumes `AiRequest` only.
The Codex capability supplies structured inputs + a capability tag; it owns no template text.

**7. Who owns Conversation State?**
**Session/Memory** (`SessionManager` + `MemoryManager`). AI Code Generation is **stateless per
generation**: one request = one `CodeGeneration` (+ one `CodeProposal` on success). Multi-turn
context is supplied by the caller from Memory; the capability persists NO conversation history.
Iterative refinement = the orchestrator re-invoking the capability with updated context (future),
never the capability owning a thread.

**8. Who owns Retry?**
Split, deliberately. **Transport retry** (UNAVAILABLE / TIMEOUT / transient) = the `AiProvider`
adapter (or a thin provider-level policy), classified via `AiFailureKind`. **Generation /
orchestration retry** (regenerate because a proposal was rejected or failed validation) = a future
**Execution Orchestrator**, NOT this capability — mirrors CAP-007 (retry deferred to the
orchestrator). The capability does exactly ONE generation per `generate()` and records the
outcome (including failure); it never loops.

**9. Which capability owns Tool Calling?**
NEITHER — it is **out of scope for CAP-008**. CAP-008 is single-shot (prompt in → proposal out):
no tool loop, no autonomous tool invocation. When tool-calling / agentic loops arrive, they belong
to a future **Agent Runtime / Execution Orchestrator** that COMPOSES AI Code Generation (author)
+ Workspace (read) + Command (run) + Approval (gate). AI Code Generation must never absorb
Workspace/Command responsibilities by calling tools itself. **Adapter constraint:** the Codex CLI
must be invoked in a **suggest-only / non-autonomous mode** (no auto-write, no auto-exec) so the
capability surfaces only a *proposal* — application stays with Workspace Write, execution with
Command (see Risks).

**10. How does it share the same interface with Ollama (CAP-009)?**
Both are `AiProvider` adapters behind the SAME EXISTING port, selected via a new **`ProviderSelector`**
seam (MB-3) by `Capability`. `CodeGenerationManager` depends on `ProviderSelector` (not on a
concrete provider, and no longer on `CapabilityRouter` directly). CAP-009 Ollama = add an adapter
+ advertise a `CODE_IMPLEMENTATION` priority; the capability, manager, aggregates, `PromptRenderer`,
`AiRequest`, and proposal-parsing contract are UNCHANGED. The proposal-parsing contract is defined
ONCE in the capability (provider-agnostic), so any provider's result parses into `ProposedChange[]`
identically. Swapping Codex↔Ollama is a selection/config decision, not a capability code change.

---

## 1. Objective

Add an **AI Code Generation** capability: given an `ExecutionPlan` (+ read-only context), ask a
**code-capable AiProvider** (Codex first) to author a **code proposal** (`ProposedChange[]`),
recording the *run* as a `CodeGeneration` and the *output* as a `CodeProposal` (Execution History).
It only *proposes*; it never applies files (CAP-006), generates patches (CAP-005), runs commands
(CAP-007), plans (CAP-003), approves (CAP-004), or calls git (CAP-002). It is the upstream
"authoring" stage of the pipeline:

```
ExecutionPlan (Planning)
  → [AI Code Generation: render → select → execute → CodeGeneration → CodeProposal(ProposedChange[])]   ← CAP-008
  → Workspace diff (CAP-001) → Approval (CAP-004) → Patch (CAP-005)
  → Workspace Write (CAP-006) → Command Execution (CAP-007)
```

## 2. Scope (proposed minimal safe scope)

- **`CodeGeneration` aggregate** (run record) + **`CodeProposal` aggregate** (produced proposal) —
  both CAP-008-owned (MB-1) — with `CodeGenerationRef`, `CodeProposalRef`, `CodeGenerationStatus`.
- **`PromptRenderer`** layer (MB-2): `PromptSpec → AiRequest` (provider-agnostic, rendered). New
  **`AiRequest`** type; `AiProvider.execute` takes `AiRequest`, never `PromptSpec`.
- **`ProviderSelector`** seam (MB-3): `select(capability) → AiProvider`, extracted from the current
  `CapabilityRouter` selection logic.
- **`CodeGenerationManager.generate(input)`** — orchestration only:
  1. `PromptComposer` → `PromptSpec`; `PromptRenderer.render(PromptSpec)` → `AiRequest`.
  2. `promptHash = contentHash(...)` — Execution Identity (reuses the CAP-006/007 hash pattern).
  3. Persist `CodeGeneration` `PENDING → GENERATING`.
  4. `provider = ProviderSelector.select(CODE_IMPLEMENTATION)`.
  5. `provider.execute(aiRequest)`.
  6. **Parse** the result → `ProposedChange[]` via a provider-agnostic parser.
  7. Persist a **`CodeProposal`** (proposal + providerId + usage? + artifacts?); set
     `CodeGeneration.codeProposalRef` + status (`SUCCEEDED`); failure → `FAILED` + `failureKind`.
- **Implement `CodexCliProvider.execute()`** (fill the existing stub) behind the EXISTING
  `AiProvider` port — **suggest-only**, consumes `AiRequest`, masked output, failure classification.
- **Persistence:** `CodeGenerationRepository` + `CodeProposalRepository` + Sqlite impls +
  **migration v6** (`code_generations`, `code_proposals`).
- Tests + capability doc + ADR-0029 (incl. the AI-Layer Ownership Rule).

## 3. Out of Scope (explicit)

- ❌ Applying files (CAP-006), generating PatchSets (CAP-005), Planning (CAP-003), Approval
  (CAP-004), Git (CAP-002), running commands (CAP-007).
- ❌ **A new AI provider port** — reuse the existing `AiProvider` port (narrow its input to
  `AiRequest`); do NOT add a parallel provider abstraction.
- ❌ **Tool calling / agentic loops / autonomous file edits or command runs** (future Orchestrator).
- ❌ **Conversation/thread state, multi-turn memory** (owned by Session/Memory; supplied as input).
- ❌ **Generation-level retry / self-repair loops** (future Execution Orchestrator).
- ❌ **Non-blocking (CA-confirmed, NOT this PR):** Provider Cost, Token Usage accounting, Provider
  Capability modelling, Failure-Taxonomy extension. (`CodeProposal.usage?` stays an optional,
  reserved passthrough field — no accounting/cost logic.)
- ❌ Streaming output to the user, embeddings, model fine-tuning/config UI.
- ❌ Mutating `ExecutionPlan`/`ApprovalRequest`/`PatchSet`/`WorkspaceChange`/`CommandExecution`.
- ❌ Orchestrator/Discord wiring of the new capability.

## 4. Architecture Impact

- **New AI Layer, strictly bounded.** A core manager that depends on AI infrastructure
  (`PromptComposer`, `PromptRenderer`, `ProviderSelector`) + `StorageProvider`, and imports **no
  other capability manager** (Planning/Approval/Patch/Workspace Write/Command).
- **Reuses the `AiProvider` port** (no new provider port) but **narrows its input to `AiRequest`**
  (MB-2): rendering moves to `PromptRenderer`; the existing `ClaudeCliProvider` is updated to
  consume `AiRequest` (its inline `renderPromptSpec` call relocates to `PromptRenderer`). Core
  stays HTTP/`child_process`-free.
- **Provider selection extracted** into `ProviderSelector` (MB-3); `CapabilityRouter` becomes (or
  is refactored behind) this seam so the capability depends on selection-by-capability abstractly.
- **Two owned aggregates** (`CodeGeneration` → `CodeProposalRef` → `CodeProposal`, MB-1) — the
  AI-Layer Aggregate Ownership Rule is written into ADR-0029 (MB-4).
- **Provider-agnostic proposal parsing** lives in core (one contract for all providers) → CAP-009
  Ollama reuses it unchanged.
- **Migration runner** advances to v6 (`code_generations`, `code_proposals`), additive (ADR-0020).

## 5. Aggregate Ownership (ADR-0025 + new AI-Layer rule, MB-4)

- **Owns `CodeGeneration` AND `CodeProposal`** and is the only capability that mutates either.
  - `CodeGeneration` (run) → holds `CodeProposalRef`.
  - `CodeProposal` (output) → holds `ProposedChange[]` + provider metadata + usage? + artifacts?.
- **References (never mutates):** `ExecutionPlanRef`, `WorkspaceRef` (read-only context).
- **Emits (does not own downstream):** `ProposedChange[]` (CAP-001 value object) for Patch to consume.
- **AI never owns any downstream aggregate** (PatchSet/WorkspaceChange/CommandExecution/ApprovalRequest).
- AI Code Generation ≠ Workspace ≠ Git ≠ Planning ≠ Approval ≠ Patch ≠ Workspace Write ≠ Command.

## 6. Capability Responsibility

- **In:** compose → render (`PromptRenderer`) → select (`ProviderSelector`) → execute → parse to a
  proposal → persist `CodeGeneration` (run) + `CodeProposal` (output), incl. classified failure.
- **Out:** prompt authorship (`PromptComposer`), prompt rendering (`PromptRenderer`), provider
  selection policy (`ProviderSelector`), provider mechanics/auth/retry/masking (adapter),
  applying/patching/running/approving (downstream), conversation state (Memory).
- Single responsibility: **turn a plan + context into a recorded AI code proposal.**

## 7. Ports / Adapters

- **Reuse `AiProvider` (port), narrowed (MB-2):** `id`, `capabilities[]`, `isAvailable()`,
  `execute(AiRequest)`. New **`AiRequest`** (rendered prompt + contextFiles + workspace? + timeout?
  + metadata?) replaces the `promptSpec?`-carrying request; the provider no longer knows `PromptSpec`.
- **New `PromptRenderer` (MB-2):** `render(PromptSpec): AiRequest` — provider-agnostic rendering
  (absorbs the adapter's old `renderPromptSpec`). Lives in core/prompting layer.
- **New `ProviderSelector` (MB-3):** `select(capability): Promise<AiProvider>` — selection extracted
  from `CapabilityRouter` (which becomes its implementation / is refactored behind it). Reuses
  `AiProviderManager` + `AI_PROVIDERS`.
- **Implement `CodexCliProvider.execute()`** in `@chunsik/ai-cli` (argv-array CLI via existing
  `CliRunner`, suggest-only, masked output, `AiProviderError`/`AiFailureKind` per ADR-0015) — now
  consuming `AiRequest`.
- **New repositories:** `CodeGenerationRepository` (`findByExecutionPlan`) +
  `CodeProposalRepository` (`findByCodeGeneration`) + Sqlite impls (+ migration v6).
- `CodeGenerationManager` wired like other managers (inject `PromptComposer`, `PromptRenderer`,
  `ProviderSelector`, `STORAGE_PROVIDER`). No new provider DI token (uses `AI_PROVIDERS`).

## 8. Domain Objects

- **`CodeGenerationStatus`** (enum): `PENDING | GENERATING | SUCCEEDED | FAILED`.
- **`CodeGeneration`** (aggregate, run): `{ id, executionPlanRef, capability, promptHash, status,
  failureKind?, codeProposalRef?, workspaceRef?, createdAt, updatedAt }`.
- **`CodeProposal`** (aggregate, output): `{ id, codeGenerationRef, proposal: ProposedChange[],
  providerId, usage?, artifacts?, createdAt }`.
- **`CodeGenerationRef`** `{ id, status }` · **`CodeProposalRef`** `{ id }` (+ derivations).
- **`AiRequest`** (MB-2): `{ capability, prompt: string (rendered), contextFiles?, workspace?,
  timeoutMs?, metadata? }` — what `AiProvider.execute` receives (no `PromptSpec`).
- **`GenerateCodeInput`** — `{ executionPlanRef, capability?, instruction, workspaceRef?,
  contextFiles?, targetFiles?, timeoutMs? }`.
- Reuses `ProposedChange` (CAP-001), `ExecutionPlanRef`, `WorkspaceRef`, `Capability`, `PromptSpec`,
  `Artifact`, `AiFailureKind`, the pure `contentHash`.

## 9. ADR Impact

- **New ADR-0029 — CAP-008 AI Code Generation (Codex).** Records: the **two owned aggregates**
  (`CodeGeneration` → `CodeProposalRef` → `CodeProposal`, MB-1); **reuse of the `AiProvider` port
  with input narrowed to `AiRequest`** + the new **`PromptRenderer`** layer (MB-2); the
  **`ProviderSelector`** seam (MB-3); provider-agnostic proposal parsing; prompt owned by the
  prompting layer; stateless (no conversation); transport-retry in adapter / generation-retry
  deferred; tool-calling out of scope; **suggest-only adapter constraint**; persistence + migration v6.
- **AI-Layer Aggregate Ownership Rule (MB-4) — written verbatim into ADR-0029:**
  > Planning owns ExecutionPlan · Approval owns ApprovalRequest · Patch owns PatchSet ·
  > Workspace owns WorkspaceChange · Command owns CommandExecution ·
  > **AI owns CodeGeneration (and CodeProposal)** · **AI never owns any downstream aggregate.**
- **Relates:** ADR-0014 (CLI providers), ADR-0015 (AI failure taxonomy), ADR-0003 (prompt layering),
  ADR-0024 (Planning), ADR-0026 (Patch), ADR-0025 (Aggregate Ownership), ADR-0020 (migrations).

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Codex CLI is agentic — may edit files / run commands itself, violating capability boundaries | **High** | **Suggest-only** adapter invocation (no auto-apply/-exec); capability surfaces only a `ProposedChange[]` proposal; application stays with CAP-006, execution with CAP-007 (Q9) |
| AI Layer "absorbing" other capabilities (tool calling, applying, running) | High | Strict scope: single-shot generation only; no `CommandRunner`/`WorkspaceWriter` deps; tool-calling explicitly out of scope |
| Narrowing `AiProvider` to `AiRequest` breaks the existing Claude/chat path | **Med-High** | Relocate `renderPromptSpec` → `PromptRenderer`; update `ClaudeCliProvider` to consume `AiRequest`; full existing suite (CAP-001…007 + chat) must stay green |
| Non-deterministic / malformed AI output breaks parsing | Med | Provider-agnostic parser with a defined output contract; parse failure → `FAILED` (no throw past the manager); proposal validated as `ProposedChange[]` before persist |
| Secret leakage via prompt/context or AI output | Med | Reuse `maskSecrets`; never send secret-named files (CAP-001 policy); mask provider output (ADR-0015 path) |
| Provider lock-in / breaking CAP-009 parity | Med | Depend on `AiProvider` port + `ProviderSelector`; parsing contract provider-agnostic; no `id` branching |
| Two-aggregate consistency (orphan `CodeProposal`, dangling `CodeProposalRef`) | Low | Persist `CodeProposal` first, then set `CodeGeneration.codeProposalRef`; `CodeProposal` back-references `codeGenerationRef` |

## 11. Validation

- `pnpm typecheck` + `pnpm test`:
  - `CodeGenerationManager`: composes → renders (`PromptRenderer`) → selects (fake
    `ProviderSelector`/provider) → parses → persists `CodeGeneration` `SUCCEEDED` + a linked
    `CodeProposal`; empty/garbled output → `FAILED` (no proposal); `AiProviderError`
    (timeout/auth/unavailable) → `FAILED` + `failureKind` (no throw past the manager);
    **imports no other capability manager**; never mutates referenced aggregates.
  - `PromptRenderer`: a fixed `PromptSpec` → expected `AiRequest` (no `PromptSpec` leaks downstream).
  - `ProviderSelector`: selects a code-capable provider by capability; none available → error.
  - Provider-agnostic parser: fixed provider output → expected `ProposedChange[]`.
  - `CodexCliProvider.execute()` (fake `CliRunner`): suggest-only argv (no auto-apply flag),
    consumes `AiRequest`, masked output, failure classification (ADR-0015).
  - `SqliteCodeGenerationRepository` + `SqliteCodeProposalRepository` round-trip + **migration v6**.
  - Regression: existing Claude/chat path still green after the `AiRequest` narrowing.
  - Boundary: core has no HTTP/`child_process`; capability does not depend on Codex concretely.
- Live AI smoke not required (fake providers/runners), consistent with CAP-001…007.

## 12. Rollback

- Additive + one AI-layer refactor (rendering → `PromptRenderer`, selection → `ProviderSelector`,
  `AiProvider` input → `AiRequest`). Rollback = `git revert`; migration v6 is forward-only/idempotent
  and changes no existing table; the `CodexCliProvider` stub reverts to `NotImplementedError`. No
  downstream capability (Patch/Workspace Write/Command) is touched.

## 13. Blast Radius

- Compile-time: new domain (2 aggregates + refs + enum + `AiRequest`), `PromptRenderer` +
  `ProviderSelector` seams, 2 repos, migration v6, `app.module` wiring, `CodexCliProvider.execute()`
  filled, **and a contract change to the existing `AiProvider` port** (`AiRequest`) that touches
  `ClaudeCliProvider` + the chat pipeline. New monorepo references: none (core + existing
  `ai-cli`/`storage-sqlite`).
- Runtime: new capability not orchestrator-wired → near-zero new live impact; the `AiRequest`
  narrowing must preserve the existing chat path (covered by the regression suite). Migration v6
  additive/backward-compatible.
- Data: new `code_generations` + `code_proposals` tables. Net: **Medium-High** (first AI-authoring
  surface + an AI-layer contract refactor; risk bounded by suggest-only + no apply/exec + regression).

---

## 14. Chief Architect Decision Questions (remaining, post Round-1)

1. **`ProviderSelector` shape:** a new core **port** (DI token) implemented by the refactored
   `CapabilityRouter`, or a plain core service wrapping it? (Recommend: port + token, so selection
   policy is swappable and the manager depends on an abstraction.)
2. **`PromptRenderer` location:** core prompting layer (alongside `PromptComposer`), or its own
   small module? (Recommend: core prompting layer; it is the inverse of `PromptComposer`.)
3. **`AiRequest` migration:** narrow `AiProvider.execute` to `AiRequest` now (update `ClaudeCliProvider`
   in this PR), or keep a temporary `prompt`-string compatibility path? (Recommend: narrow now —
   one clean contract; the regression suite guards the chat path.)
4. **Proposal parsing contract:** require the model to emit a structured envelope (fenced per-file
   blocks or a JSON proposal) parsed deterministically in core? (Recommend yes — one provider-agnostic
   contract so Ollama parses identically.)
5. **Suggest-only adapter:** confirm Codex runs non-autonomously (no auto-apply/-exec), so the
   capability only proposes (Q9)? (Recommend yes — the core safety boundary of the AI Layer.)
6. **`CodeProposal.usage?`:** keep as a reserved optional passthrough (no accounting), consistent
   with Token-Usage being Non-blocking? (Recommend yes.)

## Next Step
Stop here and wait for Chief Architect review. On approval I implement only the approved scope,
validate, and produce the Sprint 2h review. No code/commit/branch/prototype until then — the four
Merge-Blocking changes above are now in the plan; Q1–Q5 (selector/renderer/AiRequest/parsing/
suggest-only) should be settled before implementation.
