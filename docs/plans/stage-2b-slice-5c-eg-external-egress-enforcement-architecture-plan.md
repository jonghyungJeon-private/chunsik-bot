# Stage 2B Slice 5C-EG External-Egress Enforcement Architecture Plan

## 1. Status and Scope

- **Slice:** Stage 2B Slice 5C-EG — External-Egress Enforcement.
- **Artifact status:** implementation-ready decomposition, but host-mechanism feasibility is blocked pending a
  separately approved proof Slice.
- **Baseline:** `main` at `6194df53e56fbc69e0ce32968e6ce8acfcb2c3db`, with local `origin/main` at
  `eae8f802a61b65a4d0336b3d1ba69f5bc341bbff` and no tracked or staged change before this plan.
- **Plan boundary:** architecture and future validation design only. This Slice applies no firewall rule, creates no
  identity, changes no permission, starts no daemon, container, VM, Provider, Runtime, Discord connection, database,
  packet capture, or network test.
- **Predecessor:** 5C-I is complete and default-off. Enabled admission remains blocked before production configuration,
  Provider, service, or collaborator construction until an exact 5C-EG result is independently verified.
- **Non-goals:** no Core change, no ADR ratification, no implementation, no live 5C-E UAT, and no risk-accepted bypass.

## 2. Existing Gap

The existing Ollama client path constrains the CLI child with exact executable selection, the exact
`http://127.0.0.1:11434` endpoint, an isolated environment, no inherited `PATH` or proxy configuration,
`OLLAMA_NO_CLOUD`, exact command policy, model-download observation, and pre/post inventory comparison. These are
valuable client and evidence controls, but they do not technically prevent external egress by the independently
running Ollama daemon. Generation is delegated over loopback, and the daemon remains outside the spawned-child
containment boundary with its own socket capability.

Consequently, none of loopback selection, `OLLAMA_NO_CLOUD`, isolated `HOME`/`TMPDIR`, proxy removal, a client-only
sandbox, `lsof` or packet observation, download markers, `CONFIG_RESTRICTED_RISK_ACCEPTED`, operator assertions, or
boolean/string attestations supplies the missing guarantee. 5C-EG requires prevention enforced outside both the CLI
and daemon, plus proof collected by a component independent of the enforcer.

## 3. Bounded Threat Model

### Protected execution

```text
QuirkyBot production GENERAL_CHAT routing
→ exact Ollama CLI executable
→ http://127.0.0.1:11434
→ one uniquely controlled Ollama daemon
→ pre-existing approved local models only
```

The enforcement window covers the CLI, daemon, and every descendant capable of participating in the attempt. A
controlled CLI talking to an arbitrary pre-existing daemon is prohibited.

### Required allowance

Only the exact loopback TCP communication needed between the controlled CLI and controlled daemon is allowed. The
daemon listener must be bound to `127.0.0.1:11434`; wildcard, non-loopback, IPv6, alternate-port, or second-daemon
listeners fail admission. Local model-file reads required for the approved inventory are allowed.

### Required denial

For both CLI and daemon enforcement identities, deny all non-loopback IPv4 and IPv6 traffic. This includes UDP and
TCP DNS to configured resolvers, IPv6 resolvers, direct-IP traffic, cloud fallback, model acquisition, DNS over
HTTPS, QUIC, and alternate ports. Blocking only DNS ports is inadequate: the contract is all non-loopback denial,
which closes DNS, DoH, direct-IP, and alternate-endpoint paths together.

### Out of scope

This boundary does not claim to withstand kernel compromise, root deliberately replacing verified enforcement,
arbitrary privileged-administrator bypass, unrelated malware already holding root, or physical machine compromise.
It must withstand normal QuirkyBot, Ollama CLI, Ollama daemon, and descendant behavior, including unexpected external
connection attempts, crashes, and ordinary restarts.

## 4. Architecture Invariants

1. `packages/core/**` is unchanged; host policy never enters `@chunsik/core`.
2. Production routing Providers and services are not constructed before exact enforcement verification.
3. Runtime activation remains impossible before 5C-EG completion and separate 5C-E approval.
4. CLI and daemon share one enforceable boundary, including descendants.
5. Non-loopback IPv4, non-loopback IPv6, DNS, model acquisition, cloud fallback, and alternate endpoints are denied.
6. Only exact loopback daemon communication remains available.
7. Unrelated user processes are not broadly disrupted.
8. Enforcement is independently verifiable, attempt-bound, fail-closed, and deterministically reversible.
9. No retry, fallback, warning-and-continue, or risk-accepted bypass exists.
10. The production application never invokes `sudo`, mutates firewall state, manages a privileged daemon, or repairs
    enforcement.

## 5. Local Host Feasibility Evidence

Read-only inspection identified macOS 26.3, build `25D125`, Darwin 25.3.0, and `/sbin/pfctl`. Local authoritative
`pf.conf(5)` documentation says `user` and `group` rules match the effective owner stored when a socket is created,
and supports both `inet` and `inet6`. It also states that only TCP and UDP packets can be associated with users;
identity parameters are ignored for other protocols. The manual documents named anchors, `quick` rule semantics,
anchor-scoped inspection, per-rule/label counters, and `pfctl -E`/`-X` enable references.

This proves that identity-scoped TCP/UDP PF syntax exists on the target host. It does **not** yet prove:

- a Slice-owned anchor is attached at a precedence that cannot be overridden by later host rules;
- the identity boundary denies every required non-loopback protocol while leaving unrelated processes unaffected;
- existing states opened before enforcement cannot survive the transition;
- Apple-managed PF anchors and host firewall state can coexist without conflict;
- a dedicated daemon can be launched under the identity without an uncontrolled GUI/user daemon or auto-restart;
- exact loopback behavior and deterministic rollback on this macOS build; or
- a container/VM runtime with independently provable no-route networking exists on this host.

No Docker, Podman, Colima, Lima, or `vz` CLI was found by read-only executable lookup. Absence of those CLIs is not
proof that no VM mechanism can be installed; installation and lifecycle are outside this Slice. Because PF owner
matching is protocol-limited and no alternative isolation mechanism is presently demonstrated, the exact
all-non-loopback guarantee cannot honestly be declared feasible yet.

## 6. Architecture Option Analysis

### Option A — Dedicated OS identity plus scoped host firewall

Shape: one dedicated non-login OS user/group owns both the CLI invocation and a dedicated Ollama daemon; a uniquely
named PF anchor allows exact loopback TCP and blocks non-loopback IPv4/IPv6 for TCP/UDP owned by that identity. A
dedicated model store is owned for controlled reads, and the daemon is launched only through an operator-controlled
mechanism with automatic restart disabled.

Strengths are low runtime overhead, exact owner scoping for documented TCP/UDP sockets, preservation of unrelated
process traffic, named-anchor inspection/counters, and bounded rollback. It requires privilege for identity,
ownership, daemon, PF anchor, state handling, and PF enable-reference operations. Both processes must use the same
effective identity before their sockets are created. Existing sockets and daemon processes must be absent before
apply. The app cannot own these operations.

The target manual confirms owner matching for TCP/UDP and both address families, but explicitly says owner matching
is ignored for other protocols. Anchor precedence, Apple-managed-rule coexistence, state eviction ownership, and
the complete denial claim remain host-integration questions. Therefore Option A is the preferred feasibility
candidate, not an approved architecture.

### Option B — Dedicated container or VM boundary

Shape: the dedicated daemon and its CLI-side execution peer live inside an isolated network namespace or VM with no
default/external route, a narrowly exposed host/local endpoint, and dedicated model storage. An independent verifier
inspects namespace/VM routes, interfaces, policy, process identity, listener, and runtime identity.

This can cover protocols without PF owner-matching limitations and can isolate unrelated host processes. Costs are
substantial for Personal Edition: a runtime/image dependency, large model volumes, storage duplication or carefully
controlled mounts, explicit daemon/VM lifecycle, changed host-versus-guest loopback semantics, performance and
resource overhead, and more complex crash/reboot recovery. Host `127.0.0.1:11434` is not automatically guest
loopback; any port forward becomes part of the reviewed boundary and must not create an external route. No suitable
runtime is currently demonstrated locally, so denial proof and rollback are unresolved.

### Option C — Broad host-global PF denial during an attempt

Rejected. Global denial can interrupt unrelated applications and operator connectivity, races with other host
activity, mutates shared privileged state, and makes rollback failure host-wide. It does not provide acceptable
ownership isolation and cannot be the only feasible Personal Edition answer.

### Option D — Client-only sandbox or environment controls

Rejected as enforcement. The CLI delegates to a separate daemon; controlling the child environment cannot remove
the daemon's independently held or newly created external sockets.

### Option E — Observation-only controls

Rejected as enforcement. Packet observation, `lsof`, markers, inventories, and post-run evidence can show what was
seen, not prevent traffic. Absence of an observation is not proof that the kernel denied an attempt.

### Recommendation

```text
RECOMMENDED_ARCHITECTURE =
  NO_FEASIBLE_LOCAL_ARCHITECTURE_YET
```

Option A is the first candidate to validate because it is proportionate if it works, but selecting
`DEDICATED_IDENTITY_SCOPED_HOST_ENFORCEMENT` now would invent feasibility. Option B becomes mandatory if Option A
cannot prove the full protocol, precedence, state, and unrelated-process invariants. If neither is independently
provable, production Ollama routing remains disabled.

## 7. Ownership Boundaries

### Core

No change, firewall/network-policy abstraction, daemon concept, privileged-host type, or verifier port. Core remains
provider-independent.

### App composition

`apps/chunsik` may own app-private canonical scope contracts, activation admission, the exact expected scope, and
consumption of one bounded verified result. It must fail before production configuration and Provider/service
construction. It must not apply, repair, retry, or roll back host enforcement.

### Host enforcer

A separately approved operator tool outside the production bootstrap owns privileged prevalidation, unique
identity/isolation creation or selection, rule/isolation application, daemon launch/stop ordering, stale/conflict
detection, and rollback. It writes a bounded apply receipt containing actual identities and digests, not a requested
scope echoed as success.

### Independent verifier

A separate executable/code path, maintained and reviewed independently from the mutator, reads kernel/isolation
state, process ownership, executable identities, listener state, model inventory, and apply receipt. It recomputes
canonical digests from observed state. It cannot accept a caller-supplied boolean or treat the mutator receipt alone
as proof.

### Operator and Runtime

The operator separately approves identity/model-store preparation, privileged apply, daemon lifecycle, negative
tests, exact-attempt verification, and rollback. Runtime consumes only an already-verified, unexpired, exact-scope
admission result. Runtime never invokes `sudo`, launches or repairs enforcement, restarts the daemon, retries, or
weakens the boundary.

## 8. Daemon Identity and Lifecycle

A dedicated daemon is required; a GUI-managed or ordinary user-managed daemon cannot be reused. The controlled CLI
and daemon must execute under the same dedicated effective OS identity for Option A, or inside the same verified
container/VM boundary for Option B. The plan requires:

1. bind exact reviewed daemon and CLI executable realpaths, file identities, versions, and SHA-256 digests;
2. prove no process is already listening on `127.0.0.1:11434`, `[::1]:11434`, wildcard addresses, or an alternate
   approved-conflicting endpoint before apply;
3. prove no GUI/launch agent/daemon can automatically spawn or restart an uncontrolled daemon;
4. apply and independently verify enforcement before launching the dedicated daemon;
5. launch only the dedicated daemon under the verified identity and confirm its PID, effective owner, parent/launch
   owner, executable identity, descendants, and exact IPv4 loopback listener;
6. bind admission proof to that daemon PID plus a stronger process-start identity to prevent PID reuse;
7. block if any alternate daemon/listener appears or the controlled daemon exits, execs, changes identity, or
   restarts; and
8. after an attempt, stop the dedicated daemon before enforcement rollback, verify exit and listener absence, then
   roll back Slice-owned enforcement.

Automatic restart is disabled. A daemon restart invalidates the proof and ends the attempt; no same-attempt restart
or re-verification is allowed. An app crash leaves enforcement active and transfers recovery to the separately
approved operator rollback procedure.

## 9. Model Storage

The approved inventory remains exactly `llama3.1:8b` and `granite3.3:8b`. A future preparation Slice must choose and
create a dedicated model store owned by the enforcement identity, preferably a dedicated copy to avoid privilege
leakage through shared mutable storage. During an attempt the daemon receives read-only access wherever Ollama can
operate without mutation; if Ollama requires writes for metadata or locks, the minimum dedicated writable paths
must be enumerated and proven unable to add model blobs. Shared ordinary-user write access is prohibited.

Preparation must bind canonical store realpath, filesystem/device identity, owner/group/mode/ACL projection,
approved manifest entries, content digests supported by the model format, and a canonical inventory digest. Pre- and
post-attempt verification detects drift. Network denial is the primary acquisition prevention; read-only approved
model content and no unapproved writable model destination provide defense in depth. Any copy, ownership, ACL, or
permission mutation requires a separate privileged preparation Slice and is not approved here. Model data is
preserved during rollback.

Model-store ownership is therefore **designed but not established**. Until the preparation mechanism and Ollama's
minimum write requirements are verified, this is a blocking feasibility fact rather than an operator assertion.

## 10. Enforcement State Machine

```text
UNCONFIGURED
→ PREVALIDATED
→ ENFORCEMENT_APPLIED
→ ENFORCEMENT_VERIFIED
→ DAEMON_READY
→ ATTEMPT_READY
→ ATTEMPT_COMPLETE
→ POST_VERIFIED
→ ROLLED_BACK
```

The enforcement is active for exactly one approved attempt, not a general runtime window. The attempt identity and
deadline/window are fixed before apply; reuse for a second generation is prohibited.

- `UNCONFIGURED → PREVALIDATED`: prove exact host, mechanism version, expected clean Slice identity, no conflicting
  anchor/isolation, no uncontrolled daemon/listener, prepared model store, executables, and rollback target.
- `PREVALIDATED → ENFORCEMENT_APPLIED`: separately approved privileged mutator applies one unique attempt identity.
- `ENFORCEMENT_APPLIED → ENFORCEMENT_VERIFIED`: independent observation plus separately approved controlled
  negative/positive tests prove the applied state; no Provider exists yet.
- `ENFORCEMENT_VERIFIED → DAEMON_READY`: launch and bind the dedicated daemon under the already-enforced identity.
- `DAEMON_READY → ATTEMPT_READY`: re-verify process/listener/model/executable identity and produce bounded admission.
- `ATTEMPT_READY → ATTEMPT_COMPLETE`: one exact approved Provider attempt; any second dispatch is terminal failure.
- `ATTEMPT_COMPLETE → POST_VERIFIED`: verify counters/proof, identities, unchanged inventory, no alternate daemon,
  and monotonic attempt facts.
- `POST_VERIFIED → ROLLED_BACK`: stop daemon, remove only attempt-owned state, restore prior PF enable-reference/state
  as defined, and independently verify restoration.

Terminal failures are `PREVALIDATION_FAILED`, `APPLY_FAILED`, `VERIFICATION_FAILED`, `DAEMON_IDENTITY_FAILED`,
`ATTEMPT_BLOCKED`, `POST_VERIFICATION_FAILED`, and `ROLLBACK_FAILED`. Any uncertainty terminates progression. A
failure after apply still follows the rollback edge; rollback failure remains visible, terminal, and requires manual
operator recovery under new approval. Pre-existing or stale Slice state is never reused or overwritten. There is no
automatic retry.

## 11. Independent Verification Design

### Evidence sources

The verifier reads authoritative state rather than the requested scope:

- exact CLI/daemon executable realpaths, filesystem identities, hashes, versions, effective owner/isolation identity,
  process-start identities, ancestry, descendants, and listener endpoints;
- absence of uncontrolled alternate daemon/listeners;
- kernel PF anchors/rules/labels/counters and PF enable references, or container/VM runtime identity, routes,
  interfaces, namespace policy, and forwarding configuration;
- prepared model-store ownership and exact inventory digest; and
- the mutator's bounded receipt only as an ownership claim to compare against observed state.

The verifier is independently implemented/reviewed, uses a read-only command allowlist and strict parsers, rejects
unknown output, and recomputes the enforcement digest. It never imports/calls mutator success logic and cannot
project `VERIFIED` by echoing input.

### Required proof

1. expected mechanism/contract version and unique rule/isolation identity are active;
2. IPv4 and IPv6 non-loopback denial, DNS/direct-IP/alternate-port denial, and exact loopback allowance are present;
3. rules are attached at effective precedence and no bypassing rule or pre-existing state survives;
4. controlled deterministic negative targets for IPv4, IPv6, DNS, and alternate HTTPS/QUIC attempts fail with the
   expected kernel/isolation denial, while the exact loopback daemon check succeeds;
5. denial counters or isolation rejection evidence increments and binds to the controlled identity; and
6. unrelated control processes retain their prevalidated connectivity in a separately approved test, demonstrating
   scoping rather than global disruption.

Negative targets must be local, controlled fixtures that do not depend on public services. A future privileged host
test environment should provide non-loopback IPv4/IPv6 sink endpoints and a deterministic DNS/HTTPS/UDP fixture on
a controlled interface or isolated peer. Merely contacting arbitrary public hosts is prohibited. These tests are
not approved in this plan.

### Bounded result

The signed or integrity-protected verifier result binds enforcement contract version, host identity where required,
mechanism and verifier versions, CLI/daemon executable identities, process-start/isolation identity, listener,
Provider ids, exact model ids and inventory digest, enforcement configuration digest, apply receipt digest,
verification timestamp and one-attempt expiry window, state/counter baseline, and rollback identity. It includes no
secret, raw environment, unrestricted process list, raw ruleset, model content, prompt, or response. App admission
recomputes its expected scope and compares every bounded field; it does not trust the signature alone.

## 12. Deterministic Rollback

- Use a collision-resistant Slice/attempt anchor or isolation identity and record its pre-existence check.
- Snapshot only bounded pre-state needed for restoration: PF enabled/reference status, relevant anchor attachment and
  contents/digests, conflicting states, daemon/listener absence, and model-store identity. Never assume PF was off.
- The privileged mutator owns rollback; the independent verifier proves that only the attempt-owned state was
  removed and unrelated rules/state remain at their prevalidated digests.
- If PF was already enabled, do not disable it. If the Slice acquired an enable reference with `pfctl -E`, release
  only its recorded token with the matching mechanism after its anchor is removed and verified.
- Never flush the global ruleset/state table, disable PF blindly, delete unrelated anchors, kill unrelated processes,
  or remove shared/dedicated model data.
- Stop and verify the dedicated daemon and descendants before removing enforcement; then remove only the unique
  anchor/isolation state, verify listener absence and restoration, and emit an operator-visible terminal receipt.
- Partial removal, identity mismatch, changed pre-state, daemon stop failure, or verifier disagreement produces
  `ROLLBACK_FAILED`; no broad cleanup or automatic retry follows.
- Host reboot/app crash recovery treats stale receipts/anchors/VMs as blocked state. A separately approved recovery
  operation must verify ownership before removal. Automatic daemon restart stays disabled.

After success, only bounded receipts/audit and the prepared model store may persist. No daemon, attempt anchor,
container/VM instance, listener, or admission result remains reusable.

## 13. Failure and Recovery Policy

Unsupported host capability, insufficient privilege, PF/anchor conflict, unknown firewall state, daemon or
executable mismatch, uncontrolled listener, model-store ownership mismatch, inventory drift, apply failure,
independent verification failure, loopback failure, process restart, host reboot, app crash, verifier disagreement,
or rollback failure is fail-closed. No Provider is constructed and no same-attempt retry occurs. Once enforcement is
applied, failure routes to the bounded rollback procedure; rollback failure is terminal and visible.

There is no fallback to `CONFIG_RESTRICTED_RISK_ACCEPTED`, warning-and-continue, global-firewall workaround, alternate
daemon, alternate model, or unprotected legacy production route. Legacy remains the default product mode; this does
not authorize production routing.

## 14. Proposed Implementation Slices

### 5C-EG-I1 — App-private contracts and pure validation

- **Scope/location:** `apps/chunsik/src/provider-routing/egress-enforcement/` contracts, canonicalization/digests,
  pure state reducer, exact-scope comparison, bounded projection, and tests; minimal activation integration only if
  separately approved.
- **Architecture:** app-private; no Core, adapter, bootstrap, Runtime, privileged command, host I/O, or public API.
- **Tests:** canonical scope/digest stability, valid/invalid transitions, identity mismatch, stale/expired result,
  rollback ownership, bounded projection, no secret/raw-host leakage, blocked Provider construction, no retry/fallback.
- **Validation/approval:** normal code Slice approval; focused tests, typecheck, build. Host integration prohibited.
- **Completion:** fake verified input alone can satisfy the private admission contract in tests; every missing,
  mismatched, stale, or fabricated bounded fact blocks before Provider construction.

This is the smallest safe first implementation Slice.

### 5C-EG-F — Read-only feasibility harness and deterministic fixtures

- **Scope/location:** `tools/provider-routing/egress-enforcement/` read-only probes/parsers plus fixtures under its
  tests. No application by default and no dependency from production app.
- **Architecture:** prove Option A PF semantics and/or Option B isolation semantics using strict allowlists and
  bounded outputs. Mutator and verifier contracts remain separate.
- **Tests:** captured static PF/runtime/process/listener outputs, parser rejection, anchor precedence model, protocol
  coverage, state/staleness/conflict cases, and unrelated-process scoping.
- **Validation/approval:** pure fixture tests are normal; any live host, socket, localhost, negative-connectivity, or
  privilege exercise requires separate Strict approval.
- **Completion:** selects a mechanism only after controlled host proof closes every gap in section 5. If none closes,
  5C-EG remains blocked.

### 5C-EG-I2 — Concrete privileged host enforcer

- **Scope/location:** operator-only `ops/provider-routing/egress-enforcement/` or equivalently isolated private tool;
  rule templates, apply receipt, daemon lifecycle, and rollback. Production app must not import or execute it.
- **Architecture:** one selected and ratified mechanism; unique attempt identity; no generic firewall abstraction or
  Provider-adapter ownership.
- **Tests:** fake-command apply/rollback success and failure, stale/conflict detection, identity mismatch, partial
  failure, no repeated apply, no global cleanup. No live mutation in unit tests.
- **Validation/approval:** implementation approval and independent architecture review; actual identity/PF/daemon/
  permission/container mutation remains separately approved.
- **Completion:** deterministic dry fixtures pass, ownership is bounded, and independent verifier compatibility is
  demonstrated without Provider execution.

### 5C-EG-V — Independent verifier

- **Scope/location:** separate `tools/provider-routing/egress-verifier/`; no mutator implementation import. It emits
  the bounded result consumed by I1.
- **Tests:** success/failure fixtures, requested-versus-observed mismatch, daemon PID reuse/restart, executable/store/
  ruleset drift, counter mismatch, fabricated receipt, expiry, and no raw-data leakage.
- **Validation/approval:** normal offline implementation approval; live host inspection/connectivity requires Strict
  approval.
- **Completion:** independently recomputes proof from authoritative observations and rejects a mutator-only echo.

### 5C-EG-E — Privileged enforcement validation

- **Scope:** separately approved preparation, exact host apply, controlled negative IPv4/IPv6/DNS/DoH/QUIC tests,
  loopback allowance, unrelated-process isolation, daemon/model behavior, crash/reboot recovery where feasible, and
  rollback restoration. No generation.
- **Changed files:** preferably none beyond already reviewed implementation; any durable evidence policy must be
  separately approved. No evidence packet is implied by this plan.
- **Approval:** Strict, exact commands/targets/state, identity/model preparation, daemon lifecycle, network tests,
  host mutation, and rollback approved independently.
- **Completion:** independent review accepts exact mechanism proof and rollback; 5C-E remains separately blocked.

No Slice bundles privileged mutation with contracts, enforcer with verifier, or enforcement validation with live
Provider generation.

## 15. Required Architecture Questions

1. **What denies daemon egress?** Not yet selected. Candidate A is kernel PF rules scoped to a dedicated effective
   identity; candidate B is a no-route container/VM boundary. A controlled feasibility Slice must prove one.
2. **How do CLI and daemon share identity?** Dedicated effective user/group before socket creation, or the same
   verified isolation boundary. Descendants inherit the boundary and are rechecked.
3. **How are unrelated processes excluded?** Owner-scoped PF or a dedicated namespace/VM; global denial is rejected.
4. **Is macOS PF identity scoping supported?** Locally documented for TCP/UDP effective socket owners and both
   address families, but not for other protocols; full required feasibility is unresolved.
5. **If PF scoping is unreliable, is container/VM mandatory?** Yes, unless another independently proven local
   isolation mechanism is separately reviewed.
6. **Who applies enforcement?** A separately approved privileged operator tool, never the app.
7. **Who verifies it?** A separately implemented/reviewed read-only verifier.
8. **What prevents echo verification?** The verifier reads kernel/isolation/process/model state, recomputes digests,
   and rejects receipt/request-only proof.
9. **How is proof bound to the daemon?** Executable hash/file identity, effective identity, ancestry, process-start
   identity, exact listener, descendants, and attempt window.
10. **How are IPv4 and IPv6 denied?** Explicit `inet` and `inet6` non-loopback denial or no external routes/policy in
    isolation; controlled tests must prove both.
11. **How are DNS and DoH prevented?** All non-loopback denial covers UDP/TCP DNS, DoH, QUIC, direct IP, and alternate
    ports without resolver-specific assumptions.
12. **How is loopback preserved?** A preceding exact IPv4 loopback TCP allowance for the identity, or internal-only
    isolation endpoint, bound to `127.0.0.1:11434`; tested positively.
13. **How is acquisition prevented?** Kernel/isolation egress denial plus approved inventory and constrained store
    writes; inventory is verified before and after.
14. **How is storage available?** A separately prepared dedicated store with minimal permissions; requirements must
    be proven before mutation.
15. **How is an uncontrolled daemon blocked?** Listener/process/launch-owner prevalidation and continuous boundary
    checks; any alternate listener/process blocks.
16. **What if the daemon restarts?** Proof is invalid, the attempt terminates, and rollback begins; no auto-restart.
17. **What if the app crashes?** Enforcement stays active; operator-owned recovery verifies then rolls back.
18. **What if rollback fails?** Visible terminal `ROLLBACK_FAILED`; no retry or broad cleanup without new approval.
19. **What persists after success?** Only bounded receipts/audit and prepared model data; no active daemon,
    enforcement instance, or reusable admission.
20. **Smallest first Slice?** 5C-EG-I1 pure app-private contracts/state validation.
21. **Evidence required before 5C-E?** Accepted host mechanism proof, independent verifier result bound to the exact
    daemon/scope/models, controlled denial/allowance and unrelated-process tests, clean post-verification, and proven
    rollback. 5C-E still needs separate execution approval.
22. **Does this force Core change?** No.
23. **Can it safely serve current Personal Edition?** Not yet established. Candidate A may be proportionate; Option B
    may be operationally disproportionate.
24. **Is the recommendation proportionate?** Keeping production disabled while proving lightweight Option A first
    is proportionate. Installing a VM stack is justified only if product value outweighs its lifecycle/storage cost.

## 16. Open and Blocking Feasibility Items

The following prevent architecture selection and 5C-EG completion:

- PF identity matching does not cover non-TCP/UDP protocols, so the literal all-non-loopback identity guarantee is
  not yet proven.
- Effective anchor precedence, Apple-managed PF coexistence, old-state handling, IPv4/IPv6 denial, exact loopback
  allowance, unrelated-process isolation, and rollback have not been exercised on the target build.
- A suitable container/VM boundary is neither present nor proven.
- Dedicated daemon launch ownership, suppression of GUI/automatic restarts, and uncontrolled-daemon exclusion are
  not yet demonstrated.
- Dedicated model-store ownership, minimum write requirements, inventory/content binding, and drift behavior are
  not yet established.
- Controlled deterministic negative-test infrastructure is not yet designed at executable detail or approved.

These are feasibility facts, not implementation details that may be deferred past activation. Production admission
therefore remains blocked before Provider construction.

## 17. Architecture Conclusion

```text
STAGE_2B_SLICE_5C_EG_ARCHITECTURE =
  BLOCKED_FEASIBILITY_GAP

RECOMMENDED_ARCHITECTURE =
  NO_FEASIBLE_LOCAL_ARCHITECTURE_YET

CORE_CHANGE_REQUIRED =
  NO

PRIVILEGED_IMPLEMENTATION_APPROVED =
  NO

LIVE_PROVIDER_EXECUTION_APPROVED =
  NO
```

The next governance step is independent Architecture Review of this threat model, feasibility conclusion, ownership
split, and proposed 5C-EG-F proof Slice, followed by Chief Architect disposition. No implementation or host action
is authorized by this plan.
