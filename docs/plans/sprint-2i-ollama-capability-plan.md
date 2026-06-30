# Sprint 2i Implementation Plan — CAP-009 Ollama AI Code Generation Provider

- **Status:** ✅ APPROVED (Planning review) — implemented in ADR-0030. CA-confirmed decisions:
  (1) Ollama `CODE_IMPLEMENTATION` priority = **40**; (2) `ollama run <model>` with the prompt on
  **stdin**; (3) update `code-generation.md` + **ADR-0030** + CHANGELOG + CURRENT_STATE (no separate
  `ollama.md`); (4) wire `AI_PROVIDERS` **in this PR** (`isAvailable()`-gated); (5) **keep** the
  EMBEDDING descriptor. Scope held to a provider adapter — no new capability/aggregate/manager/port/
  repository/migration, no Core-contract change, Codex unchanged.
- **Capability:** **CAP-009 — Ollama** is *not a new capability*. It is the **second
  `AiProvider` adapter** for the existing **CAP-008 AI Code Generation** capability
  (ADR-0029). CAP-008 established the AI Layer and its provider-agnostic contract;
  CAP-009 is the proof that the contract holds — a different provider serves the same
  capability with **zero Core-contract changes**.
- **Date:** 2026-06-30 · **Base:** `main` @ `bdd7ee1` (CAP-001…008 merged).
- **Process:** V2 architecture-first, Step 1 (Implementation Plan). Plan → review →
  approval → implementation. Do not bypass the planning gate.

> **Framing.** ADR-0029 and `docs/capabilities/code-generation.md` already name this
> work: *"CAP-009 Ollama — a second `AiProvider` adapter behind the same port +
> `ProviderSelector`; the capability, manager, aggregates, renderer, and parser are
> unchanged."* This plan does not invent a capability. It fills the `OllamaCliProvider`
> stub, adds one `capabilities[]` entry, and wires one provider. If that is all it takes
> to add a second code-generation backend, CAP-008's provider-independence is real.

---

## 0. Foundational design (the questions specific to adding a second provider)

CAP-008 already answered the 10 AI-Layer questions (ADR-0029). They are **unchanged** —
ownership, prompt layering, statelessness, retry split, tool-calling-out-of-scope, and
the parsing contract all live in CAP-008 and CAP-009 touches none of them. Only the
questions that are *specific to a second provider* are settled here.

**A. Why is Ollama implementable suggest-only when Codex was not?**
This is the crux. CAP-008 kept `CodexCliProvider.execute()` NotImplemented because the
Codex CLI has **no deterministic suggest-only mode** — `codex exec --sandbox read-only`
is still an *agent* loop (plan-act-observe, tool use), which crosses the AI-Layer
boundary (no tool calling, no autonomous action; the AI only proposes). **Ollama is the
opposite shape.** `ollama run <model>` is **plain single-shot text generation**: prompt
in → text out. No tools, no file access, no shell, no plan-act loop. It is *structurally*
incapable of the autonomous behavior that blocked Codex. Therefore Ollama can satisfy the
suggest-only contract honestly, and CAP-009 makes it the **first real code-generation
provider** the capability can run on. (The irony — that the "code" CLI can't be
suggest-only but a general local model can — is exactly the point: the capability is
above the model.)

**B. Does the AI Code Generation capability change?** **No.** `CodeGenerationManager`,
`CodeGeneration`/`CodeProposal` aggregates, `PromptComposer.composeCodeGeneration`,
`PromptRenderer`, `ProviderSelector`, `parseCodeProposal`, and migration v6 are **all
unchanged**. The provider-agnostic parser (authored in core for exactly this reason)
parses Ollama's output identically to any other provider's. CAP-009 is adapter +
selection-data only.

**C. How is the provider selected for code generation?** By the existing data-driven
`ProviderSelector` (`CapabilityRouter`) — by `Capability`, never by `id`. CAP-009 adds
`{ capability: CODE_IMPLEMENTATION, priority: <N> }` to `OllamaCliProvider.capabilities`
so the selector *can* pick it. No `if (id === 'ollama-cli')` anywhere; Core stays blind
to the concrete provider (AGENTS.md §3, §7).

**D. Where does all Ollama interaction live?** Entirely in the `@chunsik/ai-cli`
**adapter** (`OllamaCliProvider`), behind the existing `AiProvider` port, via the
existing `CliRunner` (argv-array `spawn`, stdin prompt, timeout, masked output, failure
taxonomy per ADR-0015). **Core stays `child_process`/HTTP-free.** Mirrors
`ClaudeCliProvider` exactly.

**E. Why is this safe to run in the real pipeline?** The code-generation `AiRequest`
carries **no workspace cwd** (ADR-0029, MB-2): the provider runs in a **neutral cwd**
(`tmpdir()`), with context only via `prompt`/`contextFiles`. A local model in a temp
directory with no tools physically cannot read repo secrets, write files, or run
commands. Application stays with CAP-006, execution with CAP-007, decisions with the
human (CAP-004). Ollama only *proposes*.

---

## 1. Objective

Make **AI Code Generation (CAP-008) runnable on Ollama** by implementing the existing
`OllamaCliProvider` stub as a **suggest-only** code-capable `AiProvider`, advertising
`CODE_IMPLEMENTATION`, and wiring it into `AI_PROVIDERS`. The capability, manager,
aggregates, renderer, selector, and parser are untouched. Net effect: a second,
local-first provider can author a `CodeProposal` for an `ExecutionPlan` — selected by
policy, never by name.

```
ExecutionPlan (Planning)
  → [AI Code Generation: compose → render → SELECT(provider) → execute → parse → CodeGeneration + CodeProposal]   ← CAP-008 (unchanged)
        ProviderSelector now has two real code providers to choose from:
          ClaudeCliProvider  CODE_IMPLEMENTATION = 50   (cloud, universal fallback)
          OllamaCliProvider  CODE_IMPLEMENTATION = <N>   (local, suggest-only)   ← CAP-009
  → Workspace diff (CAP-001) → Approval (CAP-004) → Patch (CAP-005) → Workspace Write (CAP-006) → Command (CAP-007)
```

## 2. Scope (proposed minimal safe scope)

1. **Implement `OllamaCliProvider.execute(AiRequest)`** in `packages/ai-cli/src/index.ts`
   (fill the stub) — suggest-only, mirroring `ClaudeCliProvider.execute`:
   - Invoke `ollama run <model>` via the existing `CliRunner`, **prompt on stdin** (never
     as an argv), **neutral cwd** (`tmpdir()`; the code-gen `AiRequest` has no workspace),
     `request.timeoutMs ?? defaultTimeoutMs`.
   - On success: `text = stdout.trim()`; wrap in a `MARKDOWN_REPORT` `Artifact`; return
     `AiExecutionResult` with `raw` = masked exit/stderr.
   - Failure taxonomy (ADR-0015): `timedOut → TIMEOUT`; `code === null → UNAVAILABLE`
     (e.g. `ollama` not installed / model not pulled); `code !== 0 → classifyStderr`
     (model-not-found / connection-refused → `UNAVAILABLE`; otherwise `EXECUTION_FAILED`);
     empty stdout → `EMPTY_OUTPUT`. All stderr masked via `maskSecrets`.
2. **Implement `OllamaCliProvider.isAvailable()`** — `ollama --version` (or `ollama list`)
   exits 0 within a short timeout; any throw/non-zero → `false` (so the selector never
   picks an absent Ollama — same pattern as `ClaudeCliProvider.isAvailable`).
3. **Advertise `CODE_IMPLEMENTATION`** in `OllamaCliProvider.capabilities` at priority
   `<N>` (Decision Q1 — recommend **below** Claude's 50 so a local model is a *fallback*,
   not the default for code). Existing GENERAL_CHAT/SUMMARIZATION/EMBEDDING/etc. entries
   are kept as-is.
4. **Wire `OllamaCliProvider` into `AI_PROVIDERS`** in `apps/chunsik/src/app.module.ts`
   (line ~105): `new OllamaCliProvider({ bin: config.ai.ollamaBin, model: config.ai.ollamaModel })`.
   The config seam (`OLLAMA_CLI_BIN`/`OLLAMA_MODEL`) already exists. Guarded by
   `isAvailable()` → no runtime impact if Ollama is absent.
5. **Tests** (`packages/ai-cli/src/index.test.ts`, fake `CliRunner`): success →
   `MARKDOWN_REPORT`; full failure taxonomy (timeout/unavailable/auth-n.a./exec/empty);
   `isAvailable` true/false; **suggest-only argv assertion** (`ollama run <model>`, prompt
   on stdin, **no agent/tool/exec/auto-apply flags**, neutral cwd); masked output;
   advertises `CODE_IMPLEMENTATION`. Plus a **parity test**: `CodeGenerationManager.generate`
   already runs on a fake provider — add/confirm a case proving the *same* manager produces
   a `CodeProposal` when the selected provider is Ollama-shaped (capability unchanged).
6. **Docs (DoD):** update `docs/capabilities/code-generation.md` (Future Expansion / Public
   API → Ollama `execute()` now implemented suggest-only; Codex still deferred);
   **ADR-0030**; `CURRENT_STATE.md` + `CHANGELOG.md`.

## 3. Out of Scope (explicit)

- ❌ **A new capability, aggregate, manager, port, or repository.** CAP-009 is a provider
  adapter for CAP-008. No `CodeGeneration`/`CodeProposal` change, no new domain type.
- ❌ **A migration.** No schema change (no v7).
- ❌ **Changing `CodexCliProvider`** — it stays NotImplemented/unavailable (no verified
  suggest-only Codex mode exists; unchanged from ADR-0029).
- ❌ **Tool calling / agentic loops / autonomous edits or runs** — the suggest-only
  boundary is the whole point; Ollama is invoked single-shot only.
- ❌ **Ollama embedding / vector path** — `EMBEDDING` stays advertised but unimplemented
  (VectorProvider is a separate, deferred concern; not this PR).
- ❌ **Streaming**, model management/pull UX, per-request model override, generation-level
  retry/self-repair (future Orchestrator), conversation state (Session/Memory).
- ❌ **Mutating any aggregate** (`ExecutionPlan`/`Approval`/`PatchSet`/`WorkspaceChange`/
  `CommandExecution`/`CodeGeneration`/`CodeProposal` semantics).
- ❌ **Orchestrator/Discord wiring of AI Code Generation** — CAP-008 remains not
  orchestrator-wired; CAP-009 does not change that (it only adds a selectable provider).

## 4. Architecture Impact

- **The smallest capability increment to date.** No Core contract changes at all: no new
  port, no new aggregate, no new manager, no migration. The blast radius is one adapter
  method pair + one `capabilities[]` entry + one wiring line.
- **This is the deliverable's thesis:** if adding a second, independent code-generation
  provider requires *zero* changes to Core, the `AiProvider` / `ProviderSelector` /
  `AiRequest` / `parseCodeProposal` contracts from CAP-008 are genuinely provider-agnostic.
- **Core stays `child_process`/HTTP-free** — all Ollama interaction is in `@chunsik/ai-cli`.
- **Data-driven selection preserved** — Core never names `'ollama-cli'`, never branches on
  `id`; selection is by advertised `CODE_IMPLEMENTATION` priority + `isAvailable()`.
- **Boundary unchanged** — the adapter imports only `@chunsik/core` types + its own
  `cli-runner`; it imports no other adapter.

## 5. Aggregate Ownership (ADR-0025 / ADR-0029 — UNCHANGED)

CAP-009 owns **no aggregate**. It is a provider adapter. The AI Code Generation capability
(CAP-008) continues to own `CodeGeneration` + `CodeProposal`; AI never owns a downstream
aggregate. CAP-009 changes none of this — it only changes *which backend can author a
proposal*.

## 6. Capability Responsibility (provider adapter)

- **In (adapter):** consume an `AiRequest`, invoke `ollama run <model>` suggest-only,
  classify transport failures (ADR-0015), mask output, return `AiExecutionResult`. Probe
  availability.
- **Out:** prompt authorship (`PromptComposer`), rendering (`PromptRenderer`), selection
  policy (`ProviderSelector`), parsing (`parseCodeProposal`), persistence (CAP-008
  manager), approval/apply/exec (downstream). The adapter is dumb on purpose.

## 7. Ports / Adapters

- **Reuse `AiProvider` (port) — no change.** `OllamaCliProvider` already `implements`
  `AiProvider` via `BaseCliAiProvider`. We fill `execute`/`isAvailable` (currently inherit
  `NotImplementedError`) and add a `capabilities[]` entry.
- **No new port, no new DI token.** Uses the existing `AI_PROVIDERS` multi-provider array
  and `AiProviderManager` selection.
- **`CliRunner`** — reused unchanged (argv-array `spawn`, stdin, timeout, masked output).
- **Wiring:** add `OllamaCliProvider` to the `AI_PROVIDERS` factory in `app.module.ts`.

## 8. Domain Objects

- **None new.** Reuses `AiRequest`, `AiExecutionResult`, `AiCapabilityDescriptor`,
  `Artifact`/`ArtifactKind.MARKDOWN_REPORT`, `AiFailureKind`, `AiProviderError`,
  `Capability.CODE_IMPLEMENTATION`. No domain or enum addition.

## 9. ADR Impact

- **New ADR-0030 — CAP-009 Ollama AI Code Generation provider (suggest-only).** Records:
  - CAP-009 is a *provider adapter* for CAP-008, **not** a new capability; no Core-contract
    change (the provider-independence proof).
  - **Why Ollama is suggest-only-implementable where Codex was not** (single-shot text gen
    vs. agentic CLI) — the key distinction from ADR-0029.
  - The `CODE_IMPLEMENTATION` priority decision (Q1) and the local-first fallback rationale.
  - Neutral-cwd / no-workspace / no-tools safety argument; failure taxonomy reuse (ADR-0015).
- **Relates:** ADR-0029 (CAP-008 AI Code Generation — primary), ADR-0014 (CLI providers),
  ADR-0015 (AI failure taxonomy), ADR-0003 (prompt layering). **Supersedes nothing.**

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Ollama invocation is accidentally agentic / tool-using | **Low** | `ollama run <model>` is single-shot text gen — no tools/exec/file access by design; test asserts argv has no agent/exec/auto-apply flags; neutral cwd, no workspace, no `contextFiles` materialization into the repo |
| Local model emits malformed / non-envelope output → proposal won't parse | Med | Unchanged CAP-008 contract: `parseCodeProposal` failure → `CodeGeneration` `FAILED` (no throw past the manager); provider-agnostic parser already covers this |
| Ollama down / model not pulled → runtime error in the pipeline | Low | `isAvailable()` false → selector never picks it; if it races, `execute` maps to `UNAVAILABLE`/`EXECUTION_FAILED` (graceful, classified) |
| Ollama outranks Claude for code unexpectedly (quality regression) | Med | Q1: advertise `CODE_IMPLEMENTATION` **below** Claude's 50 → Claude wins when both available; Ollama serves only when it's the best available (e.g. offline/local-only) |
| Secret leakage via prompt/context or model output | Low | Reuse `maskSecrets` (same path as Claude); neutral `tmpdir()` cwd + no workspace → cannot read repo/`.env`; CAP-001 secret-skip policy upstream |
| Wiring a second provider perturbs the existing Claude/chat path | Low | Additive array entry guarded by `isAvailable()`; full existing suite (CAP-001…008 + chat) must stay green; no contract change |

## 11. Validation

- `pnpm typecheck` (exit 0) + `pnpm test`:
  - `OllamaCliProvider` (fake `CliRunner`): success → `MARKDOWN_REPORT` artifact + trimmed
    text; **suggest-only** argv (`ollama run <model>`, prompt on stdin, neutral cwd, no
    agent/exec/auto-apply flag); failure taxonomy (TIMEOUT / UNAVAILABLE / EXECUTION_FAILED
    / EMPTY_OUTPUT); masked output; `isAvailable` true(0)/false(non-zero & throw); advertises
    `CODE_IMPLEMENTATION`.
  - **Parity:** `CodeGenerationManager.generate` (existing fake-provider tests) yields a
    `CodeProposal` for an Ollama-shaped provider with **no manager/parser change** — the
    provider-independence assertion.
  - **Regression:** existing Claude/chat + CAP-001…008 suites stay green (200 tests today).
  - **Boundary:** Core has no `child_process`/HTTP; Core does not name `'ollama-cli'` /
    branch on `id`.
- Live Ollama smoke **not required** (fake runner), consistent with CAP-001…008. A manual
  `ollama`-present smoke (real `ollama run`) is optional and noted in the review, not gating.

## 12. Rollback

Purely additive (one adapter method pair, one `capabilities[]` entry, one wiring line, an
ADR + doc updates). Rollback = `git revert`. No migration, no schema, no Core-contract
change to undo. With the wiring reverted, `OllamaCliProvider` reverts to the inherited
`NotImplementedError` and is treated as unavailable — exactly today's behavior.

## 13. Blast Radius

- Compile-time: `OllamaCliProvider` (`execute`/`isAvailable`/`capabilities`),
  `index.test.ts`, `app.module.ts` (one array entry), docs/ADR. **No Core change**, **no new
  monorepo references**, **no migration**.
- Runtime: a second code provider becomes selectable *only when `ollama` is installed and
  available*; absent that, behavior is identical to today. The Claude/chat path is
  unchanged. Net: **Low** — the smallest, safest capability increment in V2; the risk is
  bounded by suggest-only + isAvailable-gating + no contract change.

---

## 14. Chief Architect Decision Questions

1. **`CODE_IMPLEMENTATION` priority for Ollama.** Recommend a value **below** Claude's 50
   (e.g. **40**) so Claude is preferred for code when available and Ollama is the
   local/offline fallback. (Codex advertises 100 but is unavailable, so it never competes.)
   Confirm the value, or specify a policy (e.g. local-first → above Claude).
2. **Invocation form.** `ollama run <model>` with the prompt on **stdin** (mirrors
   `ClaudeCliProvider`; no prompt in argv → no escaping/length issues). Confirm, vs. passing
   the prompt as an argv. (Recommend stdin.)
3. **Capability doc vs. its own doc.** CAP-009 is a *provider*, not a capability — recommend
   updating `docs/capabilities/code-generation.md` (Future Expansion → implemented) + a short
   ADR-0030, rather than creating a `docs/capabilities/ollama.md`. Confirm.
4. **Wire into `AI_PROVIDERS` in this PR**, or land the adapter first and wire separately?
   Recommend wire now (the deliverable is "a second provider can serve code generation");
   `isAvailable()`-gated so there is no runtime impact when Ollama is absent.
5. **`EMBEDDING` capability.** Leave advertised-but-unimplemented (as today), or drop it from
   the descriptor until a vector path exists? (Recommend leave — out of scope; no behavior
   change since `execute` for embedding isn't a code path.)

## Next Step
Stop here and wait for Chief Architect review. On approval I implement only the approved
scope (fill the `OllamaCliProvider` stub suggest-only, advertise `CODE_IMPLEMENTATION` at
the approved priority, wire `AI_PROVIDERS`, tests, ADR-0030, doc + state updates), validate
(`pnpm typecheck` + `pnpm test`), and produce the Sprint 2i review. No code/commit/branch
prototype until then.
