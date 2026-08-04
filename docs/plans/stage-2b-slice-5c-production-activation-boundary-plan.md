# Stage 2B Slice 5C Production Activation Boundary Plan

## Purpose and slice boundary

Slice 5C activates the already implemented production routing configuration without merging implementation
approval with live-execution approval:

- **5C-I:** production composition activation implementation and offline validation only.
- **5C-E:** separately approved Runtime, Discord, DB, Provider live execution and UAT.

5C-I may add default-off wiring before host egress enforcement exists because the disabled path constructs no new
production routing Providers and performs no probe or execution. The enabled production path must nevertheless
fail closed until a concrete, independently verifiable egress-enforcement dependency is available. A boolean,
environment string, operator assertion, or client-only restriction cannot satisfy that dependency.

## Current composition gap

The production descriptors, bindings, policies, validation profile, and two Ollama Provider instances are already
constructed by `createProductionProviderRoutingConfiguration()` in
`apps/chunsik/src/provider-routing/production-provider-routing-config.ts`. Core's
`RuntimeProviderRoutingService` is implemented in
`packages/core/src/application/runtime-provider-routing-service.ts`. The remaining gap is the composition root:

- `apps/chunsik/src/app.module.ts` currently constructs legacy `AI_PROVIDERS`, `AiProviderManager`, and
  `CapabilityRouter` around its provider/application declarations.
- Its `ConversationRuntime` factory currently omits the optional `runtimeProviderRouting` dependency.
- `ConversationRuntime` declares that optional dependency in
  `packages/core/src/application/conversation-runtime.ts` and uses it only for a TaskRun-backed
  `GENERAL_CHAT` request at the existing eligible branch.

Consequently `runtimeProviderRouting` is currently `undefined`, and legacy routing remains the production path.

## Ownership and exact activation control

Activation belongs to the `apps/chunsik` composition boundary. Core contracts remain unchanged, and host firewall,
PF, container, VM, or daemon-policy concepts do not enter `@chunsik/core`. `ConversationRuntime` continues to
receive either one fully composed `RuntimeProviderRouting` collaborator or `undefined`.

5C-I will introduce an app-private, exhaustively parsed configuration:

```text
Environment variable: CHUNSIK_PROVIDER_ROUTING_MODE
Accepted values:       legacy | stage2b-general-chat-v1
Missing value:         legacy
Invalid value:         fail application startup
Development behavior: same parsing and fail-closed rules
Production behavior:  same parsing and fail-closed rules
```

Exact, case-sensitive matching is required. Values such as `true`, `yes`, `enabled`, and `1` are invalid. Invalid
input fails startup rather than silently changing behavior or masking a deployment error.

`runtimeProviderRouting` is present only when all of these conditions hold:

1. the exact mode is `stage2b-general-chat-v1`;
2. an app-private activation factory receives a concrete egress-enforcement implementation; and
3. that implementation independently verifies denial for the exact execution scope before routing Providers are
   constructed.

Until the separate egress-enforcement Slice supplies that implementation, the enabled mode fails startup with a
bounded configuration error. Missing or explicit `legacy` mode returns `undefined` before calling
`createProductionProviderRoutingConfiguration()`. This ordering guarantees zero new Provider construction,
availability probes, and executions in the default path. No activation is inferred from an installed executable,
running daemon, or model inventory.

The verifier is an app/host composition concern, not a new generic Core network-policy port. 5C-I may define only
the smallest app-private injected construction seam needed for deterministic offline tests; it must not invent an
attestation value that impersonates OS enforcement.

## External-egress predecessor

The successful enabled production branch has a hard predecessor: a separately reviewed and approved
**Stage 2B Slice 5C-EG — External Egress Enforcement Architecture and Implementation** (working slice name).
It owns enforcement selection, host-policy and privilege boundaries, independently verifiable evidence,
daemon-lifecycle and model-storage implications, rollback, and failure behavior.

The following remain evidence or risk controls and do not satisfy technical denial: `OLLAMA_NO_CLOUD=1`, a loopback
endpoint, isolated `HOME`/`TMPDIR`, proxy-variable non-inheritance, post-execution `lsof`, download-marker
observation, and `CONFIG_RESTRICTED_RISK_ACCEPTED`.

## Provider construction and identity

The approved identities remain exactly:

```text
balanced primary   = ollama-cli:llama3.1:8b
semantic candidate = ollama-cli:granite3.3:8b
```

The enabled factory calls `createProductionProviderRoutingConfiguration({ ollamaBin })` exactly once and passes its
registry, policy engine, executable bindings, validation profiles, and deadline policy into exactly one
`RuntimeProviderRoutingService`. `app.module.ts` injects only that service into `ConversationRuntime`; it must not
invoke a Provider or Gateway directly. Construction validation remains descriptor/binding/profile-only and makes
no `isAvailable()` call.

## Legacy coexistence and request behavior

When activation is missing or `legacy`:

- existing `AI_PROVIDERS` construction and `CapabilityRouter` behavior remain unchanged;
- production routing configuration and Providers are not constructed;
- new-path availability probes and executions remain zero; and
- Code Generation, Project Analysis, no-work chat, and all non-`GENERAL_CHAT` paths remain unchanged.

When future activation is fully admitted, only the existing TaskRun-backed `GENERAL_CHAT` + `CHAT` +
`requiresWork=true` seam is eligible. Once that seam handles a request, it performs neither legacy fallback nor
shadow execution. The selected Provider identity remains audit-only and is not exposed to the user.

## 5C-I smallest implementation diff

After independent architecture approval, the smallest implementation is:

1. Add an app-private typed parser and activation factory under `apps/chunsik/src/provider-routing/`.
2. Add focused unit tests for parsing, construction ordering, identity preservation, and zero-I/O behavior.
3. In `apps/chunsik/src/app.module.ts`, obtain the optional collaborator through that factory and add it to the
   existing `ConversationRuntime` dependency object; do not alter legacy provider registrations.
4. Use the existing production configuration factory and `RuntimeProviderRoutingService`; make no Core change.
5. Keep the real enabled branch fail-closed until 5C-EG supplies a concrete independently verified enforcement
   implementation.

No source implementation is authorized by this plan.

## Offline validation strategy for 5C-I

Focused tests must prove:

1. missing activation configuration preserves legacy behavior;
2. explicit `legacy` preserves legacy behavior;
3. invalid, case-variant, truthy, empty, and whitespace-padded values fail startup;
4. enabled composition constructs the approved production configuration exactly once;
5. construction calls `isAvailable()` zero times;
6. construction performs zero Provider executions;
7. disabled mode does not construct production routing Providers;
8. disabled `ConversationRuntime` receives `undefined`;
9. admitted enabled `ConversationRuntime` receives the exact composed collaborator;
10. legacy `AI_PROVIDERS` construction and `CapabilityRouter` behavior remain unchanged;
11. `app.module.ts` introduces no direct Provider or Gateway execution bypass;
12. tests perform no Runtime start, Discord action, network access, DB access, or actual Provider execution;
13. enabled mode without the concrete verified egress dependency fails before Provider construction;
14. exact provider/model roles remain `ollama-cli:llama3.1:8b` and `ollama-cli:granite3.3:8b`;
15. non-eligible capabilities and no-work chat continue through the existing legacy behavior; and
16. the eligible new seam has no legacy fallback or shadow execution after handling begins.

Prefer dependency-injected app-private factories and fake construction seams. A narrowly scoped structural guard
may supplement, but not replace, behavioral tests. Normal focused tests, typecheck, app build, and diff invariants
are required for 5C-I; live startup and all external I/O remain prohibited there.

## 5C-E strict live gate

5C-E cannot begin until a new approval records all of the following:

- exact branch, commit SHA, remote baseline, clean tracked/staged state, and preserved untracked inventory;
- the exact activation mode and environment source;
- concrete external-egress enforcement independently verified for the attempt scope;
- freshly measured and explicitly approved executable identities;
- freshly verified exact required model inventory;
- independent Runtime, Discord, and DB mutation approval;
- independent Provider-generation approval;
- deterministic time, output, invocation, retry, fallback, escalation, and abort stop conditions;
- pre/post repository and DB validation with bounded evidence handling;
- zero automatic retry, fallback expansion, model acquisition, or daemon lifecycle mutation; and
- a tested rollback/deactivation procedure that restores `legacy` mode and verifies Runtime shutdown/state.

5C-E must stop before Provider construction or execution if any prerequisite differs. This plan performs none of
those checks or actions.

## Architecture questions answered

1. **Default-off before host enforcement?** Yes; disabled construction returns before any new Provider is built.
2. **When is the collaborator present?** Only for the exact enabled mode plus successful independent enforcement
   verification for the exact execution scope.
3. **Where is configuration parsed?** In an app-private `apps/chunsik` composition helper used by `app.module.ts`.
4. **Invalid input behavior?** Fail application startup in development and production.
5. **How is disabled construction prevented?** Parse first and return `undefined` before invoking the factory.
6. **How is direct execution prevented?** The composition root constructs/injects the existing service only; it
   never calls Provider or Gateway execution APIs.
7. **Core change needed?** No.
8. **Does the two-provider configuration remain valid?** Yes, unchanged and exact.
9. **Who owns egress enforcement?** Separate 5C-EG architecture/implementation approval, not 5C-I or 5C-E UAT.
10. **Smallest 5C-I diff?** One app-private parser/factory with tests plus optional collaborator injection in
    `app.module.ts`, reusing the existing configuration factory and service.
