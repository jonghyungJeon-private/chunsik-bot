# Capability — AI Code Generation (CAP-008)

> V2 is capability-driven. Lightweight doc for the **AI Code Generation** capability.
> Authority: `DECISIONS.md` (ADR-0029). Shared contract: `docs/execution-plan.md`.

## Purpose

Ask a code-capable `AiProvider` (Codex first) to author a **code proposal** for an
`ExecutionPlan`, recording the *run* as a `CodeGeneration` and the *output* as a
`CodeProposal`. The first **AI Layer** capability. "Codex" is the first provider;
the capability is provider-agnostic (CAP-009 Ollama is a second adapter).

```
ExecutionPlan (Planning)
  → [AI Code Generation: compose → render → select → execute → parse → CodeGeneration + CodeProposal]
  → Workspace diff (CAP-001) → Approval (CAP-004) → Patch (CAP-005) → Workspace Write (CAP-006) → Command (CAP-007)
```

> **The AI proposes; it does not decide, approve, apply, or execute.** Never a source of truth.

## Responsibilities

- Own the **`CodeGeneration`** (run) and **`CodeProposal`** (output) aggregates (the only things
  it mutates). `CodeGeneration` holds a `CodeProposalRef`; the proposal data lives on `CodeProposal`.
- `CodeGenerationManager.generate(input)` — orchestration only:
  - `PromptComposer.composeCodeGeneration` (authorship) → `PromptSpec` → `PromptRenderer.render`
    → `AiRequest` (the provider never sees a `PromptSpec`, and the request carries **no workspace
    cwd** — context flows only via `contextFiles`/`prompt`, so the provider cannot bypass CAP-001
    Workspace Read; the `workspaceRef` is recorded on the aggregate only).
  - `ProviderSelector.select(capability)` → an `AiProvider` (no concrete CLI named).
  - `provider.execute(aiRequest)` → `parseCodeProposal(text)` → `ProposedChange[]`.
  - Persist `CodeGeneration` (`PENDING→GENERATING→SUCCEEDED`/`FAILED`) + a linked `CodeProposal`
    on success. Exactly ONE generation per call (no retry).
- Persist via `CodeGenerationRepository` / `CodeProposalRepository` (migration v6).

## Out of Scope

- ❌ Deciding / approving (CAP-004), generating PatchSets (CAP-005), applying files (CAP-006),
  running commands (CAP-007), planning (CAP-003), git (CAP-002).
- ❌ A new AI provider port (reuse `AiProvider`, narrowed to `AiRequest`).
- ❌ Tool calling / agentic loops / autonomous edits or runs (future Orchestrator).
- ❌ Conversation/thread state (Session/Memory), generation-level retry (Orchestrator), streaming.
- ❌ `generationHash`, `providerVersion`/`modelVersion`, Proposal Lifecycle, Prompt Version,
  Provider Cost, Token Usage accounting, Provider Capability modelling (Non-blocking).
- ❌ Owning any downstream aggregate (AI-Layer Ownership Rule).

## Public API

- `CodeGenerationManager` (`generate`/`get`/`getProposal`/`findByExecutionPlan`).
- `ProviderSelector` (port; `select(capability) → AiProvider`; token `PROVIDER_SELECTOR`; impl
  `CapabilityRouter`). `PromptRenderer` (`render(PromptSpec, opts) → AiRequest`).
- `AiProvider` (port, reused; `execute(AiRequest)`). **`OllamaCliProvider.execute()` is implemented
  suggest-only (CAP-009, ADR-0030)** — `ollama run <model>`, prompt on stdin, neutral cwd; single-shot
  text generation (no tools/exec), advertises `CODE_IMPLEMENTATION` at priority 40 (below Claude),
  `isAvailable()`-gated. `CodexCliProvider.execute()` stays **deferred / NotImplemented** (the Codex
  CLI has no deterministic suggest-only mode — `codex exec --sandbox read-only` is read-only *agent*
  execution, not proposal-only; treated as unavailable, never selected).
  `parseCodeProposal(text) → ProposedChange[]` (provider-agnostic; identical for both).
- Domain: `CodeGeneration` (run; `PENDING|GENERATING|SUCCEEDED|FAILED`), `CodeProposal` (output;
  `ProposedChange[]` + providerId + usage? + artifacts?), `CodeGenerationRef`, `CodeProposalRef`,
  `GenerateCodeInput`, `AiRequest`. Reuses `ProposedChange` (CAP-001) — the contract handed to Patch.

## Future Expansion

- **CAP-009 Ollama ✅ (ADR-0030)** — a second `AiProvider` adapter behind the same port +
  `ProviderSelector`, suggest-only; the capability, manager, aggregates, renderer, and parser are
  unchanged. Proves provider-independence (no Core change). Codex remains deferred.
- Generation-level retry / self-repair = a future Execution Orchestrator (uses the run record).
- Reserved: `CodeProposal.usage?` (token accounting), tool-calling (Agent Runtime), streaming.

## Boundaries (Aggregate Ownership Rule — ADR-0025 / ADR-0029)

- **AI owns `CodeGeneration` and `CodeProposal`; AI never owns any downstream aggregate.**
- References `ExecutionPlanRef`/`WorkspaceRef`; emits `ProposedChange[]` for Patch — mutates nothing else.
- AI Code Generation ≠ Workspace ≠ Git ≠ Planning ≠ Approval ≠ Patch ≠ Workspace Write ≠ Command.
- **Core stays `child_process`/HTTP-free** — all external AI interaction is in the provider adapter.

## Related ADRs

- **ADR-0029** — CAP-008 AI Code Generation (primary; "propose, never apply").
- **ADR-0030** — CAP-009 Ollama provider (second adapter; suggest-only).
- ADR-0014 (CLI providers) · ADR-0015 (AI failure taxonomy) · ADR-0003 (prompt layering) ·
  ADR-0024 (Planning) · ADR-0026 (Patch) · ADR-0025 (Aggregate Ownership) · ADR-0020 (migrations).
