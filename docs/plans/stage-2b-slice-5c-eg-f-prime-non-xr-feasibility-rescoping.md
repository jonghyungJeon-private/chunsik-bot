# Stage 2B Slice 5C-EG-F′ Non-XR Feasibility Re-scoping and Mechanism Selection

```text
STATUS = ACCEPTED
F_PRIME_RESULT = NO_FEASIBLE_ARCHITECTURE_YET
5C_EG_FEASIBILITY_LOOP = CLOSED
5C_EG_STATUS = BLOCKED_CARRYOVER
CAN_5C_EG_I1_START = NO
```

## CURRENT MAIN

```text
Branch = main
HEAD = 0924d52c3e2796abb1c9ca1baafaeed3a1da3272
origin/main = eae8f802a61b65a4d0336b3d1ba69f5bc341bbff
Ahead / behind = 35 / 0
Tracked / staged diff before this plan = none
Existing untracked = preserved, including quoky_test.md
```

This Slice is plan-only and uses repository documents and already recorded static evidence. It performs no host,
kernel, runtime, network, daemon, Provider, XR, or provenance observation. Push, PR, merge, and commit are not
authorized.

## EXISTING PLAN BASELINE

The ratified 5C-EG plan concludes:

```text
STAGE_2B_SLICE_5C_EG_ARCHITECTURE = BLOCKED_FEASIBILITY_GAP
RECOMMENDED_ARCHITECTURE = NO_FEASIBLE_LOCAL_ARCHITECTURE_YET
```

Its candidates are dedicated-identity scoped host enforcement and a container/VM boundary. Neither may be selected
without evidence. XR-AX is optional for Stage 2B and remains blocked carryover; filesystem provenance feasibility is
not reopened. ADR-0065 and ADR-0066 remain unchanged.

The directive calls the items in existing section 15 the "13 questions", but the canonical section actually has 24
numbered questions. F′ evaluates all 24 so that no canonical question is silently dropped.

## F′ PURPOSE

F′ determines which architecture-selection facts can be established without XR and separates documentary/static
evidence from separately approved host observation and Strict active proof. It does not require a mechanism to be
selected. It does not weaken the all-non-loopback threat model or create a filesystem-provenance or daemon-assisted
provenance authority.

## EVIDENCE LEVEL TAXONOMY

| Level | Meaning | F′ execution |
|---|---|---|
| LEVEL_1 | Read-only static or documentary evidence already in the repository | Used |
| LEVEL_2 | Read-only host, kernel, guest, or runtime observation under separately approved host access | Designed only; not executed |
| LEVEL_3 | Mutation, active negative test, or privileged enforcement execution under Strict approval | Designed only; not executed |

Documented syntax or product claims can establish candidate capability, not effective target-host enforcement.
Runtime self-report can establish neither independent denial nor rollback by itself.

## 13-QUESTION NON-XR RE-SCOPING MATRIX

### Q01 — What denies daemon egress?

```text
CLOSABLE_WITHOUT_XR = PARTIAL
READ_ONLY_EVIDENCE_AVAILABLE = Existing PF and container/VM candidate analysis identifies possible denial boundaries.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = YES
RESIDUAL_GAP = No candidate has proven all-protocol denial for the controlled daemon and descendants.
IMPACT_ON_MECHANISM_SELECTION = Blocks selection.
```

### Q02 — How do CLI and daemon share identity?

```text
CLOSABLE_WITHOUT_XR = PARTIAL
READ_ONLY_EVIDENCE_AVAILABLE = A shared effective identity or shared guest boundary is structurally defined.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = YES
RESIDUAL_GAP = Launch owner, pre-socket identity, descendants, and second-process exclusion are unproven.
IMPACT_ON_MECHANISM_SELECTION = Blocks A; remains an observation/launch gap for B and B′.
```

### Q03 — How are unrelated processes excluded?

```text
CLOSABLE_WITHOUT_XR = PARTIAL
READ_ONLY_EVIDENCE_AVAILABLE = Owner scoping and guest isolation are candidate boundaries; global denial is rejected.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = YES
RESIDUAL_GAP = Effective scoping and unrelated-process connectivity are not demonstrated.
IMPACT_ON_MECHANISM_SELECTION = Requires Level 3 control proof for every viable family.
```

### Q04 — Is macOS PF identity scoping supported?

```text
CLOSABLE_WITHOUT_XR = PARTIAL
READ_ONLY_EVIDENCE_AVAILABLE = Recorded local manual evidence supports TCP/UDP effective-owner matching for inet/inet6.
EVIDENCE_AUTHORITY = local static state
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = YES
RESIDUAL_GAP = Owner matching is ignored for other protocols; precedence/coexistence and full denial are unproven.
IMPACT_ON_MECHANISM_SELECTION = Option A remains blocked.
```

### Q05 — If PF scoping is unreliable, is container/VM mandatory?

```text
CLOSABLE_WITHOUT_XR = YES
READ_ONLY_EVIDENCE_AVAILABLE = Existing threat model rejects client-only and observation-only substitutes.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = NO
RESIDUAL_GAP = Another independently proven isolation mechanism could still be proposed by a later ADR.
IMPACT_ON_MECHANISM_SELECTION = B/B′ is the fallback family if A cannot close.
```

### Q06 — Who applies enforcement?

```text
CLOSABLE_WITHOUT_XR = YES
READ_ONLY_EVIDENCE_AVAILABLE = Existing plan assigns mutation to a separately approved privileged operator tool, never the app.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = NO
RESIDUAL_GAP = Concrete mutator implementation and privilege are mechanism-dependent.
IMPACT_ON_MECHANISM_SELECTION = Does not select a family; constrains I2 ownership.
```

### Q07 — Who verifies it?

```text
CLOSABLE_WITHOUT_XR = YES
READ_ONLY_EVIDENCE_AVAILABLE = A separately implemented and reviewed verifier is required.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = NO
RESIDUAL_GAP = Concrete observation channel is mechanism-dependent.
IMPACT_ON_MECHANISM_SELECTION = Every family must expose independently derived observable state.
```

### Q08 — What prevents echo verification?

```text
CLOSABLE_WITHOUT_XR = YES
READ_ONLY_EVIDENCE_AVAILABLE = No mutator success-logic import; observed state and expected state are independently derived.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = NO
RESIDUAL_GAP = Runtime/API correlation can still weaken the observation channel.
IMPACT_ON_MECHANISM_SELECTION = Correlated control planes require compensating Level 3 evidence.
```

### Q09 — How is proof bound to the daemon?

```text
CLOSABLE_WITHOUT_XR = PARTIAL
READ_ONLY_EVIDENCE_AVAILABLE = Required fields include process-start identity, owner/isolation identity, ancestry, descendants, listener, and window.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = YES
RESIDUAL_GAP = Mechanism-specific stable identities and observation APIs are unproven.
IMPACT_ON_MECHANISM_SELECTION = Blocks selection until one family supplies a complete binding coordinate system.
```

### Q10 — How are IPv4 and IPv6 denied?

```text
CLOSABLE_WITHOUT_XR = PARTIAL
READ_ONLY_EVIDENCE_AVAILABLE = Explicit inet/inet6 rules or a no-route/no-external-interface guest are candidate designs.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = YES
RESIDUAL_GAP = Effective denial and bypass resistance are not demonstrated.
IMPACT_ON_MECHANISM_SELECTION = Requires Level 2 state plus Level 3 negative tests.
```

### Q11 — How are DNS and DoH prevented?

```text
CLOSABLE_WITHOUT_XR = PARTIAL
READ_ONLY_EVIDENCE_AVAILABLE = All non-loopback denial would cover DNS, DoH, QUIC, direct IP, and alternate ports.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = YES
RESIDUAL_GAP = The premise—all non-loopback denial—is not proven for any candidate.
IMPACT_ON_MECHANISM_SELECTION = Resolver-only blocking is ineligible.
```

### Q12 — How is loopback preserved?

```text
CLOSABLE_WITHOUT_XR = PARTIAL
READ_ONLY_EVIDENCE_AVAILABLE = Exact IPv4 TCP allowance at 127.0.0.1:11434 is specified; guest forwarding is recognized as boundary state.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = YES
RESIDUAL_GAP = Listener exactness, wildcard rejection, and forwarding exposure are not demonstrated.
IMPACT_ON_MECHANISM_SELECTION = B/B′ must define host-versus-guest coordinates before I1 can freeze them.
```

### Q13 — How is acquisition prevented?

```text
CLOSABLE_WITHOUT_XR = PARTIAL
READ_ONLY_EVIDENCE_AVAILABLE = Network denial plus approved inventory and constrained model-store writes is defined.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = YES
RESIDUAL_GAP = Network denial, minimum writes, and unchanged inventory/content are unproven.
IMPACT_ON_MECHANISM_SELECTION = Blocks live admission, not mechanism-neutral I1 design.
```

### Q14 — How is storage available?

```text
CLOSABLE_WITHOUT_XR = NO
READ_ONLY_EVIDENCE_AVAILABLE = Dedicated prepared store is only a proposed design.
EVIDENCE_AUTHORITY = unavailable
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = YES
RESIDUAL_GAP = Ownership, permissions, minimum Ollama writes, inventory/content binding, and drift behavior.
IMPACT_ON_MECHANISM_SELECTION = Product and feasibility blocker for A, B, B′, and C′.
```

### Q15 — How is an uncontrolled daemon blocked?

```text
CLOSABLE_WITHOUT_XR = PARTIAL
READ_ONLY_EVIDENCE_AVAILABLE = Absence-before-apply and continuous process/listener checks are specified.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = YES
RESIDUAL_GAP = Launch-agent/GUI restart suppression and alternate listener/process detection are unproven.
IMPACT_ON_MECHANISM_SELECTION = A is blocked; B/B′ need runtime and guest process proof.
```

### Q16 — What if the daemon restarts?

```text
CLOSABLE_WITHOUT_XR = YES
READ_ONLY_EVIDENCE_AVAILABLE = Restart invalidates proof, terminates the window, and begins rollback; no restart/retry.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = NO
RESIDUAL_GAP = Concrete restart observation is mechanism-dependent.
IMPACT_ON_MECHANISM_SELECTION = Freezable mechanism-neutral policy plus dependent observation field.
```

### Q17 — What if the app crashes?

```text
CLOSABLE_WITHOUT_XR = YES
READ_ONLY_EVIDENCE_AVAILABLE = Enforcement remains active and recovery transfers to the operator.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = NO
RESIDUAL_GAP = Concrete stale-state discovery and recovery procedure remain mechanism-dependent.
IMPACT_ON_MECHANISM_SELECTION = Candidate must preserve enforce-first failure behavior.
```

### Q18 — What if rollback fails?

```text
CLOSABLE_WITHOUT_XR = YES
READ_ONLY_EVIDENCE_AVAILABLE = ROLLBACK_FAILED is visible, terminal, and has no retry or broad cleanup.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = NO
RESIDUAL_GAP = Rollback mechanics and restoration proof remain unproven.
IMPACT_ON_MECHANISM_SELECTION = Mechanism must expose exact window-owned rollback identity.
```

### Q19 — What persists after success?

```text
CLOSABLE_WITHOUT_XR = YES
READ_ONLY_EVIDENCE_AVAILABLE = Only bounded receipts/audit and prepared model data persist.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = NO
RESIDUAL_GAP = Concrete absence verification is mechanism-dependent.
IMPACT_ON_MECHANISM_SELECTION = Reusable admission, daemon, listener, or enforcement state is prohibited.
```

### Q20 — Smallest first Slice?

```text
CLOSABLE_WITHOUT_XR = YES
READ_ONLY_EVIDENCE_AVAILABLE = Chief Architect selects F′ as the non-XR read-only re-scope.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = NO
RESIDUAL_GAP = F′ may honestly return no feasible architecture.
IMPACT_ON_MECHANISM_SELECTION = Establishes the present Slice; I1 awaits acceptance and a selected mechanism.
```

### Q21 — Evidence required before 5C-E?

```text
CLOSABLE_WITHOUT_XR = YES
READ_ONLY_EVIDENCE_AVAILABLE = Mechanism proof, independent exact-scope result, controlled tests, rollback, and separate 5C-E approval are enumerated.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = YES
RESIDUAL_GAP = All host-specific evidence remains uncollected.
IMPACT_ON_MECHANISM_SELECTION = Defines later gates; does not itself choose a family.
```

### Q22 — Does this force Core change?

```text
CLOSABLE_WITHOUT_XR = YES
READ_ONLY_EVIDENCE_AVAILABLE = Existing app-private activation seam accepts enforcement verification without Core host-policy concepts.
EVIDENCE_AUTHORITY = local static state
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = NO
RESIDUAL_GAP = None for architecture ownership.
IMPACT_ON_MECHANISM_SELECTION = Every option must remain outside packages/core.
```

### Q23 — Can it safely serve current Personal Edition?

```text
CLOSABLE_WITHOUT_XR = NO
READ_ONLY_EVIDENCE_AVAILABLE = Existing documents identify acceleration, latency, storage, lifecycle, and runtime costs only as risks.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = YES
RESIDUAL_GAP = No measured performance, storage, guest acceleration, or operator-burden evidence.
IMPACT_ON_MECHANISM_SELECTION = Product proportionality remains unresolved.
```

### Q24 — Is the recommendation proportionate?

```text
CLOSABLE_WITHOUT_XR = NO
READ_ONLY_EVIDENCE_AVAILABLE = Relative burdens are documented but not measured.
EVIDENCE_AUTHORITY = documentation
STRICT_EXECUTION_REQUIRED_FOR_FULL_PROOF = YES
RESIDUAL_GAP = No feasible mechanism or product-cost evidence exists to compare.
IMPACT_ON_MECHANISM_SELECTION = Retain NO_FEASIBLE_ARCHITECTURE_YET.
```

## EVIDENCE LEVEL MATRIX

| Questions | Current closure | Highest current evidence | Additional evidence needed |
|---|---|---|---|
| Q05–Q08, Q16–Q22 except Q21 execution | Policy/ownership closed | LEVEL_1 | Mechanism realization later needs Level 2/3 |
| Q01–Q04, Q09–Q13, Q15 | Candidate design only | LEVEL_1 | LEVEL_2 state observation and LEVEL_3 controlled proof |
| Q14 | Not closed | LEVEL_1 proposal only | LEVEL_2 store/runtime observation and LEVEL_3 preparation/validation |
| Q21 | Gate definition closed, evidence absent | LEVEL_1 | LEVEL_2 plus LEVEL_3 before 5C-E |
| Q23–Q24 | Not closed | LEVEL_1 risk statement | LEVEL_2 inventory/runtime facts and approved performance/lifecycle trials |

No Level 2 or Level 3 result is produced by F′.

## ARCHITECTURE FAMILY COMPARISON

Legend: `D` = design can address; `GAP` = unresolved proof; `NO` = does not satisfy; `N/A` = removed by architecture.

| Criterion | A: identity + host enforcement | B: container/VM | B′: no-external-NIC guest | C′: embedded inference/no daemon | NE: Network Extension |
|---|---|---|---|---|---|
| CLI containment | D/GAP launch | D/GAP runtime | D/GAP guest launch | D, new runtime | D/GAP product integration |
| Controlled Ollama daemon | D/GAP | D/GAP | D/GAP | N/A | D/GAP |
| Descendants | UID inheritance GAP | runtime/guest GAP | guest membership GAP | in-process boundary GAP | flow/process attribution GAP |
| Exact listener proof | D/GAP | coordinate GAP | coordinate GAP | N/A or new endpoint | separate process proof GAP |
| Wildcard rejection | D/GAP | D/GAP | D/GAP | N/A/new server contract | D/GAP |
| IPv4 non-loopback denial | TCP/UDP candidate | route/policy candidate | no-NIC candidate | process still needs denial GAP | filter candidate GAP |
| IPv6 non-loopback denial | TCP/UDP candidate | route/policy candidate | no-NIC candidate | GAP | filter candidate GAP |
| DNS denial | follows complete denial only | candidate | candidate | GAP | candidate GAP |
| Direct IP / alternate ports | other-protocol GAP | candidate | candidate | GAP | candidate GAP |
| DoH / QUIC | all-protocol GAP | candidate | candidate | GAP | protocol/filter GAP |
| Pre-existing daemon detection | required GAP | required host/guest GAP | required host/guest GAP | daemon absent by design | required GAP |
| Auto-restart risk | launch-agent GAP | runtime policy GAP | guest policy GAP | reduced, host restart remains | launch ownership GAP |
| Unrelated-process non-interference | owner scope candidate | strong candidate | strong candidate | likely, unproven | filter scoping candidate |
| Enforcement identity | UID/GID + anchor | runtime/guest id | guest/image/instance id | app/process identity | extension/config identity |
| Rollback identity | anchor/window token GAP | instance/network identity GAP | guest instance identity GAP | app artifact/config identity GAP | extension rule/config identity GAP |
| Rollback determinism | GAP | GAP | potentially simpler, GAP | redesign rollback GAP | GAP |
| Crash recovery owner | operator | operator | operator | operator/product runtime | operator/system extension |
| Independent verification | PF/kernel/process views candidate | correlation risk | guest+host axes candidate | new process/runtime verifier | kernel/extension view candidate |
| Verification correlation | lower if kernel read differs | YES if same runtime API/CLI | YES for runtime; can add guest/host axes | high without separate OS view | likely entitlement/control-plane coupling |
| Model-store ownership | GAP | volume GAP | guest volume GAP | new format/store GAP | unchanged GAP |
| Performance/product cost | lowest candidate, operational burden | acceleration/storage/lifecycle risk | greatest isolation; likely performance/UX cost | major provider architecture rewrite | entitlement, distribution, maintenance cost |
| Implementation authority | privileged PF/identity/launcher | runtime/VM lifecycle + storage | guest creation/network/storage | new architecture/ADR/provider implementation | Apple entitlement + system extension/product authority |

## OPTION A REVIEW

Option A remains a candidate only.

```text
PF_OWNER_MATCHING = TCP_UDP_LIMITED
ALL_PROTOCOL_NON_LOOPBACK_DENIAL = NOT_YET_PROVEN
OPTION_A_CLI_IDENTITY_LAUNCH = BLOCKED_PENDING_FEASIBILITY
ANCHOR_PRECEDENCE_AND_COEXISTENCE = UNRESOLVED
IDENTITY_SCOPED_STATE_EVICTION = UNRESOLVED
```

Level 1 establishes syntax and a possible ownership shape. Level 2 must observe exact target-build PF state,
precedence, conflicts, launch ownership, process identity, listeners, and absence of pre-existing controlled sockets.
Level 3 must prove IPv4/IPv6/DNS/direct-IP/alternate-port denial, exact loopback allowance, counters, unrelated-process
connectivity, and rollback. The gap may not be treated as implementation detail.

## OPTION B REVIEW

Option B can theoretically cover protocol families better than PF owner matching, but the installed candidate's
presence is not isolation evidence. Guest routes, interfaces, forwarding, host endpoint exposure, process membership,
model volumes, acceleration, and deterministic destruction/restoration remain unverified.

```text
MUTATION_CHANNEL = runtime API / CLI
OBSERVATION_CHANNEL = runtime API / CLI when used alone
CORRELATED_FAILURE_RISK = YES
```

An independent parser does not remove shared-control-plane failure. Candidate compensating axes are host-kernel
listener/route observation, guest-internal route/interface/policy observation, immutable instance/image identity,
and controlled Level 3 denial tests. Their feasibility is not yet established.

## OPTION B′ REVIEW

B′ removes the guest's external NIC/default route rather than relying only on guest firewall policy. It is the
strongest conceptual isolation candidate because external egress becomes structurally unavailable, but it still must
provide a narrowly scoped host-to-guest request path without creating an external bridge, NAT, proxy, or wildcard
listener. Host and guest loopback are different coordinates.

Runtime-only mutation and observation remain correlated. Useful independent axes would include guest-internal
interface/route enumeration, host-kernel listener/forwarding observation, and controlled isolated-peer tests. No
repository evidence proves that the current runtime can create this topology, preserve acceptable inference
performance, or roll it back deterministically. B′ is not selected.

## OPTION C′ REVIEW

C′ removes the separately running Ollama daemon and embeds inference in the application/provider boundary. This
eliminates the controlled-daemon/listener/auto-restart class but does not automatically deny networking by the
embedded engine or native dependencies. It changes the approved provider/execution architecture, packaging, model
format/store, lifecycle, resource isolation, and likely the v1 CLI-only constraint. It therefore requires a new ADR
and implementation authority rather than being a 5C-EG mechanism substitution.

```text
OPTION_C_PRIME_SELECTED = NO
REASON = MAJOR_ARCHITECTURE_AND_PRODUCT_SCOPE_EXPANSION_WITHOUT_FEASIBILITY_EVIDENCE
```

## NETWORK EXTENSION REVIEW

NE could theoretically filter process/socket traffic beyond PF owner matching, but F′ has no approved or locally
recorded evidence establishing the required entitlement, signing, distribution, supported filtering granularity,
process/descendant attribution, independently observable denial, or Personal Edition deployment viability. It also
introduces a system-extension product and lifecycle authority.

```text
NETWORK_EXTENSION_FEASIBLE = NOT_ESTABLISHED
NETWORK_EXTENSION_SELECTED = NO
REJECTION_BASIS = ENTITLEMENT_PRODUCT_AND_DISTRIBUTION_CONSTRAINTS_UNRESOLVED
```

F′ does not perform network documentation lookup because network access is outside its approval.

## INDEPENDENT VERIFIER MODEL

Canonical candidate definition:

```text
INDEPENDENCE_IS =
  separate implementation
  separate review
  no mutator success-logic import
  observed state derived independently
  expected state independently recomputed

INDEPENDENCE_IS_NOT = necessarily separate privilege
```

The enforcer and verifier may realistically share root privilege. Shared privilege does not invalidate structural
independence, but it increases common-mode risk and cannot turn a receipt into observation. Compensating Level 3
evidence candidates are controlled negative IPv4, IPv6, and DNS tests, denial-counter increments, exact positive
loopback proof, and proof that unrelated-process connectivity remains intact. F′ executes none of them.

For B/B′, using the same runtime API/CLI for mutation and observation records `CORRELATED_FAILURE_RISK = YES`.
Independent guest-internal and host-kernel observations should be required where feasible, with expected topology
recomputed without importing mutator success logic.

## I1 MECHANISM-NEUTRAL FIELDS

These fields can be designed before mechanism implementation, but I1 still waits for accepted F′ evidence and a
selected family:

- the exact ten states: `UNCONFIGURED`, `PREVALIDATED`, `WINDOW_BOUND`, `ENFORCEMENT_APPLIED`,
  `ENFORCEMENT_VERIFIED`, `DAEMON_READY`, `GENERATION_READY`, `GENERATION_COMPLETE`, `POST_VERIFIED`, `ROLLED_BACK`;
- legal transitions and monotonic terminal failure;
- fixed window start/expiry and stale-record rejection;
- unique attempt/window identity and non-reusable admission;
- fail-closed semantics and bounded terminal failure taxonomy;
- separate generation-request, CLI-invocation, daemon-request, and inventory-invocation counters;
- maximum one Provider generation request;
- same-window retry and second-generation rejection;
- exact Provider/model identities and bounded inventory identity;
- no Provider construction before enforcement verification;
- restart invalidation, app-crash operator recovery, and terminal rollback failure;
- bounded receipts/audit without secrets or raw model/prompt/response content.

Required ordering remains:

```text
no protected-process connection
before enforcement is applied and verified
```

Rollback remains:

```text
stop daemon / descendants
→ prove absence
→ remove only window-owned state
→ independently verify restoration
```

Rollback identity mismatch, rollback failure, expiry, stale enforcement reuse, same-window retry, and a second
Provider generation request are terminal fail-closed events. App crash leaves enforcement active and transfers
recovery ownership to the operator.

## I1 MECHANISM-DEPENDENT FIELDS

The following cannot be frozen honestly until a mechanism family and its observable coordinate system are accepted:

- enforcement identity representation;
- rollback identity and bounded pre-state representation;
- descendant-membership observation axis;
- listener/loopback coordinate system, including host versus guest;
- mutator receipt and enforcement configuration digest representation;
- independent observation source and correlation classification;
- process-start and restart identity representation;
- route/interface/anchor/policy coordinate system;
- exact CLI/daemon launch-owner representation;
- model-store/volume ownership, permissions, inventory, and drift identity;
- denial counter or isolation rejection evidence representation;
- crash/reboot stale-state discovery representation;
- mechanism-specific restoration proof.

## RESIDUAL STRICT-EVIDENCE REQUIREMENTS

Before mechanism selection or later activation can claim feasibility, separate approvals must provide, as applicable:

1. Level 2 target-host PF, process, listener, launch-agent, route/interface, guest, runtime, and model-store state.
2. A proven non-app owner for controlled CLI/daemon launch or a proven guest launch boundary.
3. Exact absence of protected processes/connections before apply and rejection of alternate processes/listeners.
4. Level 3 controlled negative IPv4, IPv6, DNS, direct-IP, alternate-port, DoH/HTTPS, and QUIC/UDP tests.
5. Exact positive `127.0.0.1:11434` proof without wildcard or externally forwarded exposure.
6. Denial counter/isolation rejection evidence bound to the window and controlled identity.
7. Unrelated-process connectivity preservation.
8. Deterministic stop, absence proof, window-owned rollback, and independent restoration verification.
9. App-crash/reboot stale-state recovery evidence.
10. Dedicated model-store minimum-write, ownership, inventory/content, and drift evidence.
11. B/B′ performance, acceleration, storage, and lifecycle evidence sufficient for Personal Edition proportionality.

These are evidence requirements, not authorization to execute them.

## RECOMMENDED ARCHITECTURE

```text
F_PRIME_RESULT = NO_FEASIBLE_ARCHITECTURE_YET
RECOMMENDED_ARCHITECTURE = NO_FEASIBLE_LOCAL_ARCHITECTURE_YET
```

Option A retains an unresolved protocol/launch/state gap. B and B′ lack independently corroborated topology,
listener, performance, storage, and rollback evidence. C′ is an unapproved architecture redesign. NE lacks
entitlement and product feasibility evidence. Selecting any family now would replace evidence with assumption.

## CAN I1 START AFTER THIS REVIEW?

```text
CAN_5C_EG_I1_START = NO
```

The Chief Architect directive requires F′ evidence acceptance before I1. More importantly, mechanism-dependent I1
fields cannot be frozen because F′ cannot select a family from Level 1 evidence. Mechanism-neutral contract drafting
may remain planning material, but implementation must not start.

## BLOCKING FINDINGS

- No family currently proves all-non-loopback denial plus exact loopback allowance for the whole protected process tree.
- Option A retains TCP/UDP-only owner matching, launch ownership, precedence/coexistence, and state gaps.
- B/B′ retain runtime-control correlation, topology/forwarding/listener, model-store, rollback, and product-cost gaps.
- No mechanism-dependent enforcement, rollback, descendant, or listener identity can yet be frozen for I1.
- Model-store behavior and current Personal Edition proportionality remain unestablished.

## NON-BLOCKING FINDINGS

- XR-AX and filesystem provenance are not F′ or Stage 2B selection blockers.
- The ten-state ordering, fail-closed policy, four independent count axes, stale/retry rules, and app-crash ownership
  are mechanism-neutral and stable.
- Independent verification means independent derivation and implementation/review, not necessarily separate privilege.
- `XrIsolationAttemptGate` is a containment-release gate and is not changed. A future XR consumer must separately
  require `state === CLEAN_TERMINAL && outcome === SUCCESS`; this is not a 5C-EG-F′ blocker.
- `packages/core/**` requires no change.

## SAFETY

F′ used only repository reads and the static/documentary evidence already recorded by accepted plans. It performed
no host mutation, PF/firewall mutation, container/VM mutation, daemon lifecycle action, network execution, active
negative test, Provider execution, Runtime/Discord/DB action, secret read, XR host/provenance execution, or code
implementation. Existing untracked files were preserved.

## APPROVAL BOUNDARY

This plan does not authorize Level 2 host observation, Level 3 execution, I1 implementation, privileged identity or
enforcement work, runtime/container/VM/daemon mutation, model-store preparation, network tests, Provider/Runtime/UAT,
commit, push, PR, or merge. Each requires its applicable separate approval. I1 additionally requires Chief Architect
acceptance of F′ evidence and a mechanism decision supported by evidence.

## VERDICT

```text
STAGE_2B_SLICE_5C_EG_F_PRIME = ACCEPTED
F_PRIME_RESULT = NO_FEASIBLE_ARCHITECTURE_YET
5C_EG_FEASIBILITY_LOOP = CLOSED
5C_EG_STATUS = BLOCKED_CARRYOVER
XR_AX_STAGE_2B_NECESSITY = OPTIONAL
FILESYSTEM_PROVENANCE_REOPEN = NO
ADR_0065_THREAT_MODEL_AMENDMENT = NOT_SELECTED
CAN_5C_EG_I1_START = NO
NEXT_REQUIRED_INPUT = NONE_FOR_STAGE_2B_OFFLINE_COMPLETION
```
