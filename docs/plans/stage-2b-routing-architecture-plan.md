# Stage 2B Production Routing Architecture Plan

- **Status:** Architecture ratified by ADR-0064. Slices 1–5A, 5B-1, and 5B-2A-I are implemented. 5B-2A-I adds
  unwired app-private preflight contracts/runner with fake filesystem/process validation only. Actual Ollama
  version/inventory execution, activation, Provider generation, and Runtime/Discord/DB UAT remain separate gates.
- **Input:** Completed Stage 2A Provider Evaluation Infrastructure and frozen A1+A3 evidence.
- **Current candidates:** balanced primary `llama3.1:8b`; semantic candidate `granite3.3:8b`;
  latency-only evidence `llama3.2:3b`; deprioritized `mistral:7b`.

The objectives, candidate comparison, and open questions below are the retained pre-ratification analysis.
ADR-0064 is the canonical decision record when this historical plan differs from the implemented architecture.

## Implementation Status

- Slices 1–4 implement and validate provider-independent selection, bounded planning/Gateway orchestration,
  validation, audit, and private deterministic simulation.
- Slice 5A adds `RuntimeProviderRoutingService` in Core and an optional `ConversationRuntime` seam for only
  TaskRun-backed `GENERAL_CHAT` work turns. It uses static Runtime facts, one availability probe per configured
  executable per request, the fixed `GENERAL_CHAT` validation profile, and existing Task/TaskRun lifecycles.
- Slice 5A uses fake configuration and fake Providers only. The app composition root remains unchanged, so the
  currently configured Claude/Ollama instances do not use this seam.
- Slice 5B-1 statically binds only `llama3.1:8b` and `granite3.3:8b` as distinct Ollama executable instances,
  attaches canonical bounded Stage 2A provenance, and validates descriptor/binding/policy/profile construction.
  The configuration is intentionally not imported by `app.module.ts`.
- Actual Provider readiness and model installation are **NOT VERIFIED**. Provider execution is deferred to Slice
  5B-2; activation and Runtime/Discord/DB UAT are deferred to Slice 5C.
- Slice 5B-2A-I implements executable identity, exact version/list allowlisting, isolated loopback environment,
  bounded parsers/process lifecycle, and non-persistent results without app wiring. Slice 5B-2A-E0 adds explicit
  verified-OS-denial versus configuration-restricted-risk controls and a strict app-private execution composition;
  risk acceptance does not technically deny external egress. The runner owns exact environment construction and hard settlement.
  Actual executable/version and
  installed inventory remain **NOT VERIFIED**; process, daemon/network, inventory, and generation were not executed.

## Objectives

- Define the Production Routing architecture that consumes Stage 2A Provider Ranking without
  changing or reinterpreting its evidence.
- Establish explicit responsibilities for primary selection, fallback, semantic escalation,
  traffic policy, timeout, retry, and operational failure handling.
- Preserve provider independence: routing must remain capability- and policy-driven rather than
  embedding concrete model identities in Core behavior.
- Produce an architecture decision that can be reviewed independently before implementation.

## Architecture Boundary

Stage 2A owns Provider Evaluation Infrastructure:

- Evaluator and Golden Corpus
- deterministic Replay and Binding
- Benchmark Framework and Decision Engine
- evidence-based Provider Ranking

Stage 2B owns Production Routing:

- primary and fallback roles
- optional dual-routing and escalation policy
- traffic, timeout, retry, and failure policy
- operational observability and safe degradation expectations

Stage 2B consumes Stage 2A outputs but does not rewrite historical scorecards, Golden Corpus,
bindings, Champion rules, or Prompt conclusions. Core continues to depend only on `AiProvider`;
providers advertise capabilities, priority, and availability, while provider-specific invocation
and prompt shaping remain adapter responsibilities. Any change to these settled boundaries requires
an approved ADR before implementation.

## Scope

- Compare candidate routing strategies against the ratified Stage 2A ranking and failure signatures.
- Define provider roles and the decision inputs permitted for each role.
- Define the required behavior for unavailable, timed-out, failed, and semantically escalated calls.
- Define the governance and evidence needed to ratify one Production Routing architecture.
- Identify regression, observability, budget, and operational-safety requirements for a later
  implementation sprint.

## Non Goals

- No routing, dual-provider, retry, timeout, traffic-split, or escalation implementation.
- No Provider, Benchmark, Runtime, Discord, or model-download execution.
- No Prompt, Evaluator, Scorecard weight, Winner Rule, Golden Corpus, or Stage 2A result change.
- No concrete provider branching in Core and no provider pinning to Session, Task, or Actor.
- No new capability, aggregate, persistence schema, dynamic plugin loader, or autonomous agent loop.

## Candidate Routing Strategies

### Balanced Primary

Use `llama3.1:8b` as the sole default candidate because it leads the combined v4 overall ranking
and Authority score. This is the smallest operational surface, but it does not use Granite's higher
Semantic and Continuity results.

### Balanced Primary with Semantic Escalation

Use `llama3.1:8b` for the default role and consider `granite3.3:8b` for a separately defined
semantic-escalation role. Stage 2B must establish an observable, provider-neutral escalation signal;
the existence of two strong candidates alone does not ratify dual routing.

### Availability Fallback

Keep one provider as the normal selection and consider the other only when the primary is unavailable
or fails an approved operational condition. Stage 2B must distinguish availability fallback from
semantic escalation and must define whether an additional Provider call is permitted.

### Restricted Latency Path

Consider `llama3.2:3b` only for a future, explicitly bounded low-risk role where latency dominates.
Its Stage 2A Semantic and Instruction results do not support general-purpose Production routing.

These are retained comparison candidates, not an authorization to activate concrete Production routing.
`DUAL_PROVIDER` production activation remains unratified and deferred.

## Open Questions

- Which provider-neutral request or risk signals may select the balanced, semantic, or restricted
  latency role?
- Is semantic escalation allowed to add a second Provider call, and what budget and audit evidence
  would authorize it?
- Which failure classes permit fallback or retry, and which must fail closed without another call?
- What timeout ownership and deadline propagation preserve the existing adapter/Core boundary?
- How are retry limits, traffic distribution, circuit breaking, and recovery made deterministic and
  observable?
- How should routing decisions and provider variance be audited without pinning a provider to
  Session, Task, or Actor?
- What Golden Corpus and operational regressions are required before promotion?
- Does the selected design fit existing `ProviderSelector` responsibilities, or does it require a
  separately ratified architecture seam and ADR?

## Success Criteria

- One routing strategy and its provider roles are explicitly ratified.
- Selection, fallback, escalation, timeout, retry, traffic, and failure semantics are unambiguous.
- The design remains provider-independent and preserves the `apps -> adapters -> core` dependency
  direction and existing `AiProvider` boundary.
- Additional Provider-call budgets, audit facts, and fail-closed conditions are explicit.
- Golden Corpus regression and operational validation requirements are measurable without changing
  Stage 2A evidence or acceptance rules.
- Required ADR work, implementation scope, tests, and rollout gates are identified before any code
  or Runtime change begins.
