# CURRENT MAIN

- Branch: `main`
- Inspected HEAD: `168c7127efdf97a88f95980ae9b98987baee2759`
- Baseline relation: M3A-1 implementation is `33013cb93298ef6930f87fe9e2cf7f9da9d436e9`; the current HEAD adds the accepted identity-gap disclosure.
- Remote/release preservation baseline: `origin/main` is `80bbc94de0493c24036197dabc2ff00dbcd20cbf`; `v1.0.0` resolves to `55af788bd099112d0cc22c2cbd2e0027f3b83503` (the annotated tag object) and its peeled commit remains the closed release commit. This review does not move either reference.

# M3A-1 ACCEPTANCE SUMMARY

The source implements the accepted read-only foundation: `ResourceRef` validates and normalizes provider-independent `{ source, externalId }` identity; `WorkSurfaceQuery` reads Jira and GitHub concurrently through `ConnectorProvider`, normalizes connector items, sorts them deterministically, and exposes explicit per-source availability; the deterministic conversation path renders the result without AI execution. `CURRENT_STATE.md`, `CHANGELOG.md`, and `docs/capabilities/work-surface.md` accurately disclose the implementation's live identity limitation.

The review questions resolve as follows: (1) the surface is reachable through the normal conversation/application path; (2) a real Actor cannot currently obtain Jira personal work through that path; (3) a real Actor cannot currently obtain GitHub personal work through that path; and (12) before identity provisioning it is observably reachable and gives a truthful diagnostic, but it is not useful for its intended purpose of returning a real user's personal work. M3A-1 remains useful as an accepted, tested foundation, not yet as an end-to-end live capability.

# ACTUAL USER PATH

1. A user sends a normal inbound message such as “내가 할 일 보여줘” or “Show me what I need to work on.” `IntentClassifier.isPersonalWorkSurface` emits `LOOKUP` / `READONLY_LOOKUP` with `raw.kind = personal-work-surface`.
2. `ConversationRuntime.handleInner` first resolves the Actor from the inbound `ConversationContext`, opens/touches the Session, records short-term memory, handles higher-priority pending flows, and classifies the request.
3. The bounded personal-work branch calls `workSurface.forActor(actor)` directly. It does not create a Task/TaskRun, route to an AI provider, or enter the execution orchestrator.
4. `WorkSurfaceQuery.forActor` asks for `jira` and `github`. For each source it first searches `actor.identities[]` for an exactly matching platform and takes the first non-blank external id after deterministic sorting.
5. **The first real live break is here:** `ActorManager.resolveFromContext` creates a new Actor with only `{ platform: context.platform, externalId: context.userId }` (normally the inbound Discord identity), and no current path adds Jira or GitHub entries. Both reads return `IDENTITY_MISSING` before connector discovery or any network call.
6. If explicit identities are injected, Jira renders a personal-work JQL read and GitHub renders an issue-search read through their adapters.
7. Each returned connector item becomes a `WorkSurfaceItem` whose `resource` is `new ResourceRef({ source, externalId: item.id })`; connector DTOs do not cross into domain or persistence state.
8. The two results are merged and sorted by source, title, then external id. Availability becomes `COMPLETE`, `PARTIAL`, or `UNAVAILABLE` without treating an unreadable source as an empty work list.
9. `ResponseComposer.composeWorkSurface` renders up to 20 items and explicit remediation text for every unavailable source; the runtime records/sends that deterministic response.

Source evidence: `packages/core/src/application/intent-classifier.ts`, `packages/core/src/application/conversation-runtime.ts`, `packages/core/src/application/actor-manager.ts`, `packages/core/src/application/work-surface-query.ts`, `packages/core/src/domain/resource-ref.ts`, and `packages/core/src/application/response-composer.ts`.

# LIVE REACHABILITY

“Reachable” has two distinct answers. The application route is reachable: intent recognition, runtime dispatch, Work Surface composition, and response rendering are wired. The intended live data result is not reachable for a normally created Actor because identity resolution fails before connector lookup.

The limitation classification for review question 8 is:

- Primary: **missing implementation plus missing configuration/provisioning** — no bounded mechanism consumes explicit operator-owned Jira/GitHub mappings and persists them into the existing Actor.
- Not the first break: **composition wiring** — `WorkSurfaceQuery` is constructed from `ConnectorManager` and injected into `ConversationRuntime` correctly.
- Subsequent prerequisites: **external connector credential/setup** — Jira and GitHub connectors must also be configured and authorized for the target systems.
- Execution-only gate: **live/Strict boundary** — an actual Jira/GitHub read is external network execution and requires exact Human authorization; that boundary does not explain the deterministic `IDENTITY_MISSING` result and does not block offline implementation/validation of provisioning.

# IDENTITY PROVISIONING

For review questions 5–7, identity currently comes only from the inbound `ConversationContext`: `ActorManager.resolveFromContext` looks up `(context.platform, context.userId)` and creates the Actor with that single ExternalIdentity when absent. There is no operator command, configuration field, startup projection, application service, or conversation flow that adds Jira/GitHub identities. `ActorRepository.save` can persist a complete Actor and the SQLite provider already synchronizes every `Actor.identities[]` entry into `actor_identities`, but no production caller uses that capability to provision external work identities.

The smallest missing mechanism is an **explicit, deterministic, operator-owned mapping at the application/composition boundary** that selects an existing Actor by canonical `Actor.id` (or resolves its already-linked inbound ExternalIdentity), validates one Jira and/or GitHub mapping, and saves the augmented Actor through the existing repository. It must fail closed on missing Actor, blank/duplicate/conflicting mappings, and must never infer, auto-link, merge Actors, use credentials as identity, or ask a connector to declare the current Actor. The precise config shape, lifecycle, and conflict policy require Chief Architect ratification; this review does not select or implement them.

This mechanism can reuse the existing Actor JSON plus `actor_identities` table and therefore answers review question 11: live identity reachability can be implemented without schema or migration work.

# JIRA IDENTITY PATH

The exact Core value required by current source is:

```text
ExternalIdentity { platform: "jira", externalId: "<non-blank Jira assignee identifier>" }
```

`WorkSurfaceQuery` trims the value and passes it as `params.actorExternalId`. `JiraConnectorProvider` requires it to be non-empty, escapes backslashes and quotes, and renders `assignee = "<externalId>" AND resolution = Unresolved`. Source does not constrain the value to an email or add a tenant field; operationally it must be a Jira assignee identifier accepted by the configured Jira Cloud instance. `CHUNSIK_JIRA_EMAIL` is connector authentication configuration and is not Actor identity.

After identity provisioning, the connector additionally requires complete Jira host/email/API-token configuration. Missing credentials mean `NOT_CONFIGURED`; rejected credentials or network/service failure mean `UNAVAILABLE`. Credential material remains adapter/config state outside Core and outside `ExternalIdentity`.

# GITHUB IDENTITY PATH

The exact Core value required by current source is:

```text
ExternalIdentity { platform: "github", externalId: "<GitHub login>" }
```

`WorkSurfaceQuery` passes the trimmed value as `params.actorExternalId`. `GitHubConnectorProvider` validates the GitHub-login-shaped value (`1–39` alphanumeric/hyphen characters, beginning alphanumeric) and renders `involves:<login> is:open archived:false`. It normalizes numeric issue/PR ids to string `ResourceRef.externalId` values; the login itself is not the resource id.

After identity provisioning, the production composition root registers this connector only when repository identity plus an accepted GitHub App mode, or the dev-only PAT mode, is configured. The GitHub App read token is separately down-scoped to read issues/pull requests. Token, installation, owner, and repository configuration are connector/auth prerequisites, not Actor identities.

# CONFIG / COMPOSITION PATH

Current config has Jira connector fields and GitHub hosting/auth fields, but no Actor external-identity mapping. `createConnectorProviders` registers Jira only from complete connector config; `app.module.ts` adds GitHub only from accepted GitHub hosting auth, constructs `ConnectorManager`, constructs `WorkSurfaceQuery`, and injects it into the runtime. That proves connector and Work Surface composition are present while identity provisioning is absent.

The recommended provisioning slice should stay outside `ConversationRuntime`: application startup/composition can validate explicit non-secret mapping config and invoke a narrow, deterministic provisioning service after storage initialization. Tests can use in-memory/fake repositories and injected config; they need no connector call, network, secret, Runtime, Discord, or DB migration. Any later application of mappings to an actual non-disposable runtime database remains governed by the applicable DB/Runtime authorization.

# PUBLIC CONTRACT IMPACT

Actual source does **not** prove that a new public Core port, domain type, aggregate, or field is required. The ratified model already contains `Actor.id`, `Actor.identities[]`, `ExternalIdentity { platform, externalId }`, `ActorRepository.findByExternalIdentity`, generic Actor `get/save`, and persistence capable of storing multiple identities. An app-private provisioning/configuration boundary can use those contracts.

`ConnectorProvider.currentIdentity()` is neither necessary nor appropriate. Connector authentication identifies a credential/installation, not necessarily the human Actor; allowing a connector to supply canonical Actor identity would violate the explicit external mapping boundary and can create false linking. Jira email, GitHub token/App installation, repository identity, and external human identity are distinct facts.

No unratified public Core contract is proven necessary at this HEAD. If implementation analysis later demonstrates that repository access from the application boundary cannot preserve mutation ownership without a new exported Core service/port, that proposal must be recorded as `CHIEF_ARCHITECT_DECISION_REQUIRED` and ratified before implementation; it must not be smuggled into M3A-1.1.

# CONVERSATION RUNTIME CHECK

- Before M3A-1 (`33013cb^`): accepted instantiated dependency baseline **31**; the interface includes 32 declared keys when the optional `runtimeProviderRouting` member is counted.
- After M3A-1/current HEAD: accepted instantiated dependency baseline **31**; the interface still includes the same 32 declared keys including that optional member.
- Change: the unused required `risk` dependency was replaced one-for-one by required `workSurface`. The regression test asserts `Object.keys(deps).length === 31`, absence of `risk`, and presence of `workSurface`.
- Acceptance condition: **31 <= 31**, so the final surface does not exceed the previous accepted baseline.

Putting identity config parsing, provisioning, persistence, or connector identity discovery into `ConversationRuntime` would increase its ownership even if hidden behind an existing dependency. The proposed solution must not add a runtime dependency or turn-level provisioning branch; application/composition owns provisioning, while the runtime continues to receive a resolved Actor and present the bounded Work Surface only.

# M3A-2 READINESS

ADR-0075 sufficiently separates `WorkItem` from external identity shape: `Actor.id` is durable ownership and `ResourceRef` is resource correlation, so M3A-2 is not technically forced to add Jira/GitHub identity fields or couple credentials to WorkItem. Nevertheless, beginning persistence first would build durable state before the only implemented acquisition surface can return real data. It would leave end-to-end semantics unexercised and increase the chance that temporary provisioning assumptions leak into repository APIs, seed behavior, or migration fixtures.

Resolving explicit identity provisioning first supplies a real, architecture-compliant input boundary against which M3A-2 can later persist many-per-actor work state. This ordering avoids identity rework by fixing identity outside WorkItem, not by expanding WorkItem. M3A-2 must continue to own only durable work identity, Actor ownership, optional project reference, resource correlation, high-level lifecycle/status, and origin; it must not absorb Task, Approval, execution, Provider, conversation, connector credential, or generic workflow state.

# OPTIONS A / B / C

- **OPTION A — M3A-1.1 Identity Provisioning / Live Reachability:** closes the first proven break with an explicit app/composition-owned mapping, reuses all ratified identity and persistence shapes, requires no migration, and enables deterministic end-to-end offline validation. This is the evidence-supported next slice.
- **OPTION B — M3A-2 Persistent Personal Work / CAP-011 WorkItem:** architecture is ratified and can remain identity-independent, but implementing it now would persist work above a surface that no normally provisioned Actor can use. Defer until A is accepted.
- **OPTION C — another smaller slice:** no smaller product slice is supported. Connector wiring and response reachability already exist; a Jira-only or GitHub-only provisioning slice would duplicate the same mapping boundary and knowingly leave the other accepted source inaccessible. A documentation-only gap disclosure is already present and does not restore capability.

# RECOMMENDATION

Recommend **OPTION A: M3A-1.1 — Identity Provisioning / Live Reachability** for Chief Architect ratification, followed by M3A-2 only after the provisioning path is implemented and independently accepted. This is a recommendation, not ratification and not authorization to start implementation.

This recommendation answers review questions 9–10 and 13: use the ratified Actor identity model without `ConnectorProvider.currentIdentity()` or a new public Core contract, keep connector credentials outside identity, and solve the gap at the application/composition boundary without increasing Conversation Runtime ownership.

# CHIEF ARCHITECT DECISIONS REQUIRED

`CHIEF_ARCHITECT_DECISION_REQUIRED`:

1. Ratify or reject OPTION A as the next slice before any M3A-1.1 or M3A-2 implementation begins.
2. If A is ratified, select the exact explicit configuration contract used to locate an existing Actor (canonical `Actor.id` versus an already-linked inbound ExternalIdentity) and carry Jira/GitHub values. It must not use display name, credentials, inference, or connector-reported identity.
3. Ratify provisioning lifecycle and conflict semantics: when mapping is applied, whether absence removes nothing, and how duplicate `(platform, externalId)` or multiple same-platform entries fail closed. No auto-linking, Actor merge, or heuristic ownership transfer is allowed.
4. Confirm the app-private application/composition service is sufficient. If a new public Core mutation contract is instead proposed, require a separate architecture decision before implementation.

# RECOMMENDED NEXT IMPLEMENTATION SLICE

**Goal:** make the accepted Jira/GitHub Personal Work Surface deterministically reachable for an explicitly configured existing Actor, without live external execution in the implementation task.

**In-scope:** one bounded, explicit non-secret Actor-to-Jira/GitHub mapping config; app/composition-owned validation and provisioning after storage initialization; reuse of Actor/ExternalIdentity and existing Actor repository persistence; deterministic tests for Jira-only, GitHub-only, both, missing Actor, blank input, duplicate/conflict, idempotence, and preservation of the inbound identity; offline conversation-to-surface tests with fake connectors; documentation of the separate credential and Strict live-read prerequisites.

**Out-of-scope:** M3A-2/WorkItem, schema or migration, connector writes, identity discovery, `ConnectorProvider.currentIdentity()`, new identity aggregate, new ExternalIdentity fields, auto-linking, Actor merge, team/permission model, credentials or tenant metadata in Core, live connector calls, Runtime/Discord/Provider/network/Live UAT, Production/shared DB work, and any automatic start of the next slice.

**Architecture boundaries:** canonical identity remains `Actor.id`; mappings reuse `Actor.identities[]`, `ExternalIdentity`, and existing Actor repository contracts; credentials stay in adapters/config; connector protocol stays in adapters; provisioning stays at the application/composition boundary; Conversation Runtime receives no new dependency and owns no identity state; Work Surface remains read-only and non-authoritative.

**Validation:** focused config/provisioning unit tests with fake/disposable storage; focused Actor persistence and Work Surface integration tests with injected fake connectors; assertion that the accepted `ConversationRuntimeDeps` instantiated count remains at most 31; `PATH=/Users/seongsujeonjonghyeong/.nvm/versions/node/v22.22.1/bin:$PATH pnpm typecheck`; relevant offline tests; `git diff --check`; changed-file and staged-file verification proving no product source, schema, or migration changed. Any real credential read, application Runtime start, Jira/GitHub network request, Discord action, or Live UAT requires separate exact-scope Human authorization.
