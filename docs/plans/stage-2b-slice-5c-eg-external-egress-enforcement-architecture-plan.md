# Stage 2B Slice 5C-EG External-Egress Enforcement Architecture Plan

## 1. Status and Scope

- **Slice:** Stage 2B Slice 5C-EG — External-Egress Enforcement.
- **Artifact status:** architecture feasibility is blocked pending a separately planned read-only feasibility Slice;
  this plan is not ready for mechanism implementation.
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

The enforcement window covers the CLI, daemon, and every descendant capable of participating in the generation
workflow. A controlled CLI talking to an arbitrary pre-existing daemon is prohibited.

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
8. Enforcement is independently verifiable, bounded to one exact enforcement window, fail-closed, and
   deterministically reversible.
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
- protected-process connections can be excluded before enforcement without relying on scoped PF state eviction;
- Apple-managed PF anchors and host firewall state can coexist without conflict;
- a dedicated daemon can be launched under the identity without an uncontrolled GUI/user daemon or auto-restart;
- exact loopback behavior and deterministic rollback on this macOS build; or
- the present container/VM candidate supplies independently provable no-route networking for this threat model.

Independent read-only observation found `/usr/local/bin/docker`, resolving to
`/Applications/OrbStack.app/Contents/MacOS/xbin/docker`, plus `orb`, `orbctl`, `/Applications/OrbStack.app`, and an
existing `~/.orbstack/` directory. Podman, Colima, the Lima CLI, `vz`, `vfkit`, `qemu`, Docker Desktop, and UTM were
not found. OrbStack is present, but its actual network isolation behavior for this threat model is unverified.
Installation alone does not establish feasibility. Because PF owner matching is protocol-limited and OrbStack's
isolation guarantees are not yet demonstrated, the exact all-non-loopback guarantee cannot honestly be declared
feasible yet.

## 6. Architecture Option Analysis

### Option A — Dedicated OS identity plus scoped host firewall

Shape: one dedicated non-login OS user/group owns both the CLI invocation and a dedicated Ollama daemon; a uniquely
named PF anchor allows exact loopback TCP and blocks non-loopback IPv4/IPv6 for TCP/UDP owned by that identity. A
dedicated model store is owned for controlled reads, and the daemon is launched only through an operator-controlled
mechanism with automatic restart disabled.

Strengths are low runtime overhead, exact owner scoping for documented TCP/UDP sockets, preservation of unrelated
process traffic, named-anchor inspection/counters, and bounded rollback. It requires privilege for identity,
ownership, daemon, PF anchor, state handling, and PF enable-reference operations. Both processes must use the same
effective identity before their sockets are created. Existing controlled sockets and daemon processes must be absent
before apply. The app cannot own these operations.

The target manual confirms owner matching for TCP/UDP and both address families, but explicitly says owner matching
is ignored for other protocols. PF does not provide a proven user/group-scoped state eviction mechanism suitable for
this architecture. Anchor precedence, Apple-managed-rule coexistence, `quick` behavior, full protocol coverage, and
safe conflicting-state handling remain feasibility questions. Therefore Option A is a feasibility candidate, not an
approved or recommended architecture.

The protected-process state mitigation is ordering-based: prevalidate absence of the controlled daemon/listener;
select a fresh dedicated non-login identity; prove no Slice-owned process or socket exists; apply and independently
verify enforcement; only then launch the dedicated daemon and permitted CLI invocations.
**No protected-process connection may exist before enforcement application.** This excludes protected-process
pre-existing state by construction; it does not claim unrelated global state is harmless and never permits global PF
state flushing.

```text
OPTION_A_CLI_IDENTITY_LAUNCH =
  BLOCKED_PENDING_FEASIBILITY
```

Option A remains blocked until a non-app, non-privilege-escalating owner can launch both CLI and daemon under the
exact dedicated identity. Candidate ownership is an operator-approved unprivileged execution launcher or a
preconfigured dedicated service/runner owned by the host-enforcement boundary. 5C-EG-F must decide which host
component creates each process, owns its effective UID/GID before socket creation, and exposes an unprivileged,
bounded app communication interface. The app may request one already-approved generation workflow through that
interface but may not elevate, switch identity, start privileged tooling, or manage the daemon. The verifier binds
each process-start identity, effective UID/GID, ancestry, and executable identity to the enforcement window; it
rejects a second uncontrolled CLI/daemon. Descendants must inherit the same effective identity and boundary.

### Option B — Dedicated container or VM boundary

Shape: the dedicated daemon and its CLI-side execution peer live inside an isolated network namespace or VM with no
default/external route, a narrowly exposed host/local endpoint, and dedicated model storage. An independent verifier
inspects namespace/VM routes, interfaces, policy, process identity, listener, and runtime identity.

This can cover protocols without PF owner-matching limitations and can isolate unrelated host processes. OrbStack is
present as a candidate runtime, but its suitability, actual network isolation, no-route proof, host communication,
and rollback guarantees are unverified. Costs are substantial for Personal Edition: a runtime/image dependency,
explicit daemon/VM lifecycle, changed host-versus-guest loopback semantics, performance/resource overhead, and more
complex crash/reboot recovery. Linux container/VM execution on macOS may not provide Metal GPU acceleration, so both
approved 8B models may run CPU-only; latency and usability could become product-level blockers. A dedicated model
store may duplicate approximately 10 GB, subject to exact local model sizes and volume behavior. No exact performance
degradation is asserted without evidence. Host `127.0.0.1:11434` is not automatically guest loopback; any port
forward becomes part of the reviewed boundary and must not create an external route.

### Option C — Broad host-global PF denial during an enforcement window

Rejected. Global denial can interrupt unrelated applications and operator connectivity, races with other host
activity, mutates shared privileged state, and makes rollback failure host-wide. It does not provide acceptable
ownership isolation and cannot be the only feasible Personal Edition answer.

### Option D — Client-only sandbox or environment controls

Rejected as enforcement. The CLI delegates to a separate daemon; controlling the child environment cannot remove
the daemon's independently held or newly created external sockets.

### Option E — Observation-only controls

Rejected as enforcement. Packet observation, `lsof`, markers, inventories, and post-run evidence can show what was
seen, not prevent traffic. Absence of an observation is not proof that the kernel denied a connection.

### Recommendation

```text
RECOMMENDED_ARCHITECTURE =
  NO_FEASIBLE_LOCAL_ARCHITECTURE_YET
```

PF identity enforcement and OrbStack isolation are candidates for 5C-EG-F, but neither is recommended yet. Selecting
`DEDICATED_IDENTITY_SCOPED_HOST_ENFORCEMENT` or `CONTAINER_OR_VM_ISOLATION` now would invent feasibility. If no
candidate independently proves the full protocol, identity/process, communication, state, rollback, and
unrelated-process invariants, production Ollama routing remains disabled.

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
scope echoed as success. It also owns whichever non-app CLI/daemon launch boundary 5C-EG-F proves feasible; that
boundary must accept only a pre-bound enforcement window and expose no general privilege-escalation facility.

### Independent verifier

A separate executable/code path, maintained and reviewed independently from the mutator, reads kernel/isolation
state, process ownership, executable identities, listener state, model inventory, and apply receipt. It recomputes
canonical digests from observed state. It cannot accept a caller-supplied boolean or treat the mutator receipt alone
as proof.

### Operator and Runtime

The operator separately approves identity/model-store preparation, privileged apply, daemon and launcher lifecycle,
negative tests, exact-window verification, and rollback. Runtime consumes only an already-verified, unexpired,
exact-scope admission result. Runtime never invokes `sudo`, switches UID/GID, starts privileged host tooling, creates
users/groups, changes ACLs, launches/stops the protected daemon, manages a container/VM, repairs enforcement, retries,
or weakens the boundary.

## 8. Daemon Identity and Lifecycle

A dedicated daemon is required; a GUI-managed or ordinary user-managed daemon cannot be reused. The controlled CLI
and daemon must execute under the same dedicated effective OS identity for Option A, or inside the same verified
container/VM boundary for Option B. Who launches both processes under Option A remains
`BLOCKED_PENDING_FEASIBILITY`: it must be a non-app operator-approved runner or preconfigured service boundary, not
app privilege escalation. The plan requires:

1. bind exact reviewed daemon and CLI executable realpaths, file identities, versions, and SHA-256 digests;
2. prove no process is already listening on `127.0.0.1:11434`, `[::1]:11434`, wildcard addresses, or an alternate
   approved-conflicting endpoint before apply;
3. prove no GUI/launch agent/daemon can automatically spawn or restart an uncontrolled daemon;
4. prove the invariant `No protected-process connection may exist before enforcement application.` and prove no
   Slice-owned process or socket exists before apply;
5. apply and independently verify enforcement before launching the dedicated daemon;
6. have the proven non-app launch boundary create only the dedicated daemon under the verified identity and confirm
   its PID, effective owner, parent/launch owner, executable identity, descendants, and exact IPv4 loopback listener;
7. have that same boundary create only the enumerated CLI/inventory invocations with the dedicated effective UID/GID
   already established before socket creation; the app communicates through a bounded unprivileged request interface;
8. bind admission proof to CLI/daemon PIDs plus stronger process-start identities to prevent PID reuse;
9. block if any alternate CLI/daemon/listener appears or a controlled process exits unexpectedly, execs, changes
   identity, exceeds the window counts, or restarts; and
10. after the enforcement window, stop the dedicated daemon before rollback, verify all controlled descendants and
    listeners are absent, then roll back Slice-owned enforcement.

Automatic restart is disabled. A daemon restart invalidates the proof and terminates the window; no same-window
restart or re-verification is allowed. A second uncontrolled CLI or daemon also terminates the window. Descendants
must inherit the same identity/isolation boundary and remain within enumerated executable/count limits. An app crash
leaves enforcement active and transfers recovery to the separately approved operator rollback procedure.

## 9. Model Storage

The approved inventory remains exactly `llama3.1:8b` and `granite3.3:8b`. A future preparation Slice must choose and
create a dedicated model store owned by the enforcement identity, preferably a dedicated copy to avoid privilege
leakage through shared mutable storage. During an enforcement window the daemon receives read-only access wherever
Ollama can operate without mutation; if Ollama requires writes for metadata or locks, the minimum dedicated writable paths
must be enumerated and proven unable to add model blobs. Shared ordinary-user write access is prohibited.

Preparation must bind canonical store realpath, filesystem/device identity, owner/group/mode/ACL projection,
approved manifest entries, content digests supported by the model format, and a canonical inventory digest. Pre- and
post-window verification detects drift. Network denial is the primary acquisition prevention; read-only approved
model content and no unapproved writable model destination provide defense in depth. Any copy, ownership, ACL, or
permission mutation requires a separate privileged preparation Slice and is not approved here. Model data is
preserved during rollback.

Model-store ownership is therefore **designed but not established**. Until the preparation mechanism and Ollama's
minimum write requirements are verified, this is a blocking feasibility fact rather than an operator assertion.

## 10. Enforcement Window and State Machine

```text
UNCONFIGURED
→ PREVALIDATED
→ WINDOW_BOUND
→ ENFORCEMENT_APPLIED
→ ENFORCEMENT_VERIFIED
→ DAEMON_READY
→ GENERATION_READY
→ GENERATION_COMPLETE
→ POST_VERIFIED
→ ROLLED_BACK
```

`ENFORCEMENT_WINDOW` is fixed before enforcement application and covers one approved activation/run identity, one
controlled daemon lifecycle, and exactly one Provider generation request. It enumerates the allowed inventory
invocations before and after generation, the generation CLI invocation, any required daemon requests, exact
executable identities, endpoint, model identities, maximum command/request counts, start deadline, expiration
deadline, and terminal conditions. Multiple bounded child processes or daemon HTTP exchanges inside this single
approved generation workflow may be necessary and must be explicitly enumerated. A second Provider generation
request is a terminal violation.

Vocabulary is exact: a **Provider generation request** is the one app-level generation workflow; a **CLI invocation**
is one permitted executable spawn; a **daemon request** is one bounded HTTP exchange; an **inventory invocation** is
one permitted pre/post inventory command. None is called an ambiguous “dispatch.” The window is not a general runtime
period and cannot be reused.

- `UNCONFIGURED → PREVALIDATED`: prove exact host, mechanism version, expected clean Slice identity, no conflicting
  anchor/isolation, no uncontrolled daemon/listener, prepared model store, executables, and rollback target.
- `PREVALIDATED → WINDOW_BOUND`: canonicalize and bind the exact activation/run identity, workflow, process/command/
  request counts, executables, endpoint, models, deadlines, enforcement identity, and rollback identity.
- `WINDOW_BOUND → ENFORCEMENT_APPLIED`: separately approved privileged mutator applies the unique window identity.
- `ENFORCEMENT_APPLIED → ENFORCEMENT_VERIFIED`: independent observation plus separately approved controlled
  negative/positive tests prove the applied state; no Provider exists yet.
- `ENFORCEMENT_VERIFIED → DAEMON_READY`: launch and bind the dedicated daemon under the already-enforced identity.
- `DAEMON_READY → GENERATION_READY`: re-verify process/listener/model/executable identity and produce bounded,
  unexpired admission for the one Provider generation request.
- `GENERATION_READY → GENERATION_COMPLETE`: permit only enumerated pre-inventory, generation, and post-inventory CLI/
  daemon requests within their counts. A second Provider generation request is terminal failure.
- `GENERATION_COMPLETE → POST_VERIFIED`: verify counters/proof, identities, command/request counts, unchanged
  inventory, no alternate CLI/daemon, window validity, and monotonic generation facts.
- `POST_VERIFIED → ROLLED_BACK`: stop daemon, remove only window-owned state, restore prior PF enable-reference/state
  as defined, and independently verify restoration.

Terminal failures are `PREVALIDATION_FAILED`, `WINDOW_BINDING_FAILED`, `APPLY_FAILED`, `VERIFICATION_FAILED`,
`PROCESS_IDENTITY_FAILED`, `GENERATION_BLOCKED`, `WINDOW_VIOLATION`, `WINDOW_EXPIRED`,
`POST_VERIFICATION_FAILED`, and `ROLLBACK_FAILED`. A second Provider generation request, unexpected executable or
process, exceeded command/request count, daemon restart, or window expiry is terminal. Any uncertainty terminates
progression. A failure after apply still follows the rollback edge; rollback failure remains visible, terminal, and
requires manual operator recovery under new approval. Pre-existing or stale Slice state is never reused or
overwritten. There is no same-window retry or fallback to unprotected operation.

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
3. rules are attached at effective precedence; the invariant `No protected-process connection may exist before
   enforcement application.` holds; and no
   bypassing rule, unexpected Slice-owned process, or socket appears inside the window;
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
verification timestamp and bounded enforcement window, command/request limits, state/counter baseline, and rollback
identity. It includes no secret, raw environment, unrestricted process list, raw ruleset, model content, prompt, or
response. App admission
recomputes its expected scope and compares every bounded field; it does not trust the signature alone.

Before verifier implementation, the design must decide who signs or integrity-protects results, which key or trust
root is used, where it resides, how the app validates it, and how the app avoids holding a privileged host secret.
This is a non-blocking architecture-plan question, not permission to create a key. A signature alone is insufficient:
admission must still compare independently observed state, exact scope, enforcement digest, process identities,
bounded window, and rollback identity.

## 12. Deterministic Rollback

- Use a collision-resistant Slice/window anchor or isolation identity and record its pre-existence check.
- Snapshot only bounded pre-state needed for restoration: PF enabled/reference status, relevant anchor attachment and
  contents/digests, conflicting Slice-owned-state observations, daemon/CLI/listener absence, and model-store identity.
  Never assume PF was off. PF user/group-scoped state eviction is not assumed or claimed.
- The privileged mutator owns rollback; the independent verifier proves that only the window-owned state was
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

After success, only bounded receipts/audit and the prepared model store may persist. No daemon, window anchor,
container/VM instance, listener, or admission result remains reusable.

## 13. Failure and Recovery Policy

Unsupported host capability, insufficient privilege, PF/anchor conflict, unknown firewall state, daemon or
executable mismatch, uncontrolled listener, model-store ownership mismatch, inventory drift, apply failure,
independent verification failure, loopback failure, unexpected process, command/request-count violation, second
Provider generation request, process restart, window expiry, host reboot, app crash, verifier disagreement, or
rollback failure is fail-closed. No Provider is constructed before exact verification and no same-window retry
occurs. Once enforcement is applied, failure routes to the bounded rollback procedure; rollback failure is terminal
and visible.

There is no fallback to `CONFIG_RESTRICTED_RISK_ACCEPTED`, warning-and-continue, global-firewall workaround, alternate
daemon, alternate model, or unprotected legacy production route. Legacy remains the default product mode; this does
not authorize production routing.

## 14. Proposed Implementation Slices

### 5C-EG-F — Read-only feasibility harness and deterministic fixtures

- **Sequence/role:** first and next-smallest Slice; read-only, fixture-first feasibility investigation before any
  mechanism-shaped production contract.
- **Scope/location:** plan the minimum read-only probes and captured deterministic fixtures; repository location is
  selected in that Slice and must have no production-app dependency.
- **Questions:** PF identity applicability and protocol limits; anchor precedence, Apple coexistence and `quick`
  behavior; protected-process state exclusion; OrbStack isolation/no-route capability and required host
  communication; Metal/GPU impact; model-volume behavior; CLI/daemon identity launch ownership; and model-store
  runtime write requirements.
- **Tests:** fixture parsers and canonical bounded observations only. The probe plan must distinguish already accepted
  read-only host facts from later tests.
- **Validation/approval:** this remediation does not approve the probe. 5C-EG-F needs its own plan/approval. No host
  mutation, localhost/network test, process/daemon/runtime execution, or secret access; any later network test needs
  separate Strict approval.
- **Completion:** evidence either selects a safe, proportionate candidate for independent review or records exact
  remaining gaps. Until acceptance, no mechanism recommendation or implementation follows.

### 5C-EG-I1 — Contracts and pure validation after feasibility

- **Scope/location:** only after accepted F evidence, app-private mechanism-neutral contracts or the minimum
  mechanism-specific contracts justified by that evidence; canonical identity/digests, bounded enforcement-window
  definition, pure state reducer, exact-scope comparison, bounded projection, and tests.
- **Architecture:** app-private; no Core, adapter, bootstrap, Runtime, privileged command, host I/O, or public API. Do
  not freeze PF-shaped result fields before F.
- **Tests:** scope/digest stability, transitions, identity/window mismatch, stale/expired result, rollback ownership,
  bounded projection, no secret/raw-host leakage, blocked Provider construction, no retry/fallback.
- **Validation/approval:** separate normal code Slice approval; focused tests, typecheck, build. Host integration is
  prohibited.
- **Completion:** every missing, mismatched, stale, fabricated, or over-count bounded fact blocks before Provider
  construction, using only the mechanism contract accepted after F.

### 5C-EG-I2 — Concrete privileged host enforcer

- **Scope/location:** operator-only `ops/provider-routing/egress-enforcement/` or equivalently isolated private tool;
  rule templates, apply receipt, daemon lifecycle, and rollback. Production app must not import or execute it.
- **Architecture:** one selected and ratified mechanism; unique enforcement-window identity; no generic firewall
  abstraction or Provider-adapter ownership.
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

The sequence is mandatory:

```text
5C-EG-F → 5C-EG-I1 → 5C-EG-I2 → 5C-EG-V → 5C-EG-E
```

No Slice bundles privileged mutation with contracts, enforcer with verifier, or enforcement validation with live
Provider generation.

## 15. Required Architecture Questions

1. **What denies daemon egress?** Not yet selected. Candidate A is kernel PF rules scoped to a dedicated effective
   identity; candidate B is a no-route container/VM boundary. A controlled feasibility Slice must prove one.
2. **How do CLI and daemon share identity?** Dedicated effective user/group before socket creation, or the same
   verified isolation boundary. A non-app launch owner remains to be proven; descendants inherit the boundary and are
   rechecked.
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
   identity, exact listener, descendants, and enforcement window.
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
16. **What if the daemon restarts?** Proof is invalid, the window terminates, and rollback begins; no auto-restart.
17. **What if the app crashes?** Enforcement stays active; operator-owned recovery verifies then rolls back.
18. **What if rollback fails?** Visible terminal `ROLLBACK_FAILED`; no retry or broad cleanup without new approval.
19. **What persists after success?** Only bounded receipts/audit and prepared model data; no active daemon,
    enforcement instance, or reusable admission.
20. **Smallest first Slice?** 5C-EG-F read-only, fixture-first feasibility probe planning and investigation.
21. **Evidence required before 5C-E?** Accepted host mechanism proof, independent verifier result bound to the exact
    daemon/scope/models, controlled denial/allowance and unrelated-process tests, clean post-verification, and proven
    rollback. 5C-E still needs separate execution approval.
22. **Does this force Core change?** No.
23. **Can it safely serve current Personal Edition?** Not yet established. OrbStack is present but unverified. Option
    B may lose Metal acceleration, run both approved 8B models CPU-only, and duplicate approximately 10 GB of model
    storage subject to exact sizes; latency/usability and storage may be product-level blockers.
24. **Is the recommendation proportionate?** Undecided. Dedicated identity, daemon, launcher/mutator, verifier, and
    rollback add operational burden; container/VM isolation adds lifecycle, acceleration, and storage risk. Default
    legacy mode remains correct, and production Ollama routing remains disabled unless a safe and proportionate
    architecture is proven. Security requirements are not weakened for proportionality.

```text
PERSONAL_EDITION_PROPORTIONALITY =
  UNDECIDED
```

## 16. Open and Blocking Feasibility Items

The following prevent architecture selection and 5C-EG completion:

- PF identity matching does not cover non-TCP/UDP protocols, so the literal all-non-loopback identity guarantee is
  not yet proven.
- Effective anchor precedence, Apple-managed PF coexistence, `quick` behavior, conflicting Slice-owned state,
  IPv4/IPv6 denial, exact loopback allowance, unrelated-process isolation, and rollback have not been proven on the
  target build. PF has no proven user/group-scoped state eviction mechanism for this architecture; protected-process
  connections must instead be absent before apply by construction.
- OrbStack is present as a candidate container/VM runtime, but its network isolation, host communication,
  acceleration, model-volume, and rollback suitability are unverified.
- `OPTION_A_CLI_IDENTITY_LAUNCH = BLOCKED_PENDING_FEASIBILITY`: no non-app, non-privilege-escalating owner has yet
  been proven able to launch both CLI and daemon under the exact dedicated identity. Process creator, effective
  UID/GID ownership, bounded app communication, process-start binding, descendant inheritance, and second-process
  exclusion remain unresolved.
- Dedicated daemon launch ownership, suppression of GUI/automatic restarts, and uncontrolled CLI/daemon exclusion
  are not yet demonstrated.
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

NEXT_SMALLEST_SLICE =
  5C_EG_F_FEASIBILITY_PROBE

NEXT_ACTION =
  READ_ONLY_FEASIBILITY_PROBE_PLAN_REQUIRED
```

The next governance step is a separately scoped plan for the read-only 5C-EG-F feasibility probe. This remediation
does not approve or begin that probe. No implementation or host action is authorized by this plan.
