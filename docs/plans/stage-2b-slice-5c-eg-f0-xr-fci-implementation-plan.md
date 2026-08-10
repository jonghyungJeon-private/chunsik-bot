# Stage 2B Slice 5C-EG-F0-XR-FCI Implementation Plan

## Status and authority

- Baseline: `main` at `0f60b0408011c5e0466f1768f87dbff733a4ce64`.
- Authority: ratified ADR-0065 and its `XR_BOUNDED_PROCESS_CONTAINMENT_INVARIANT`.
- Scope: plan only. This document does not approve implementation, process execution, signals, live filesystem reads, provenance, evidence admission, XR-AX, runtime mutation, push, PR, or merge.
- Objective: design the smallest offline/static/fake-first capability that can later isolate one exact XR record in one child process without moving path, evidence, limit, accounting, or sequencing authority out of the parent.

The capability boundary is acceptable, but implementation is blocked from claiming the complete invariant until Darwin orphan disposition and independently observable reap proof receive a feasible, reviewed mechanism. The offline contracts, state machine, protocol, fake suite, and guards can still be implemented and independently reviewed without starting a process.

## 1. Ownership boundary

### Capability-owned

The new private XR process-isolation capability owns only:

- construction and pre-spawn validation of the fixed observer identity;
- fixed transport framing and parsing;
- exactly one observer child per XR record;
- the child lifecycle, normal close, failure-only `TERM -> grace -> KILL`, exit observation, explicit reap proof, stream closure, and sandbox cleanup;
- fixed stdin/stdout/stderr channels, environment, CWD, descriptor policy, umask policy, and resource-containment checks;
- terminal classification as `CLEAN_TERMINAL` or `UNCERTAIN_TERMINAL`;
- a closed capability failure taxonomy and deterministic precedence.

### Parent-owned and not delegated

The XR parent remains the sole authority for:

- `ApprovedPathToken` creation and validation;
- `XR_LIMITS`, counters, `XrReadAccounting`, and budget exhaustion;
- record ordering, PRE/POST sequencing, attempt-wide halt, and the one-outstanding-operation rule;
- exact-path selection and all path derivation;
- provenance, evidence eligibility/admission, comparison, verdicts, and retry policy.

The child may enforce fixed defensive ceilings, but it cannot grant budget, reorder operations, create tokens, infer paths, classify evidence, or retry. A child result is transport data only. One unresolved child makes the whole attempt ineligible and prevents the next record.

## 2. Proposed files and import direction

No public Core port or workspace package is proposed. The capability stays private to XR tooling/application composition.

```text
tools/provider-routing/egress-allowlist-runner/
  host/isolation/
    contracts.ts
    protocol.ts
    observer-identity.ts
    record-observer.ts
    failure-precedence.ts
    observer-entrypoint.ts
    *.test.ts
tools/provider-routing/egress-allowlist-runner-test-support/
  fake-observer-lifecycle.ts
tools/provider-routing/egress-allowlist-runner-host-adapter/
  node-observer-lifecycle.ts            # future, separately approved live adapter
  node-observer-lifecycle.test.ts
```

Allowed dependency direction:

```text
offline XR sequencer
  -> record-observer
  -> contracts + protocol + observer-identity + failure-precedence
  -> injected XrObserverLifecyclePort

future node-observer-lifecycle
  -> contracts + protocol only

observer-entrypoint
  -> contracts + protocol + exactly lstatExact, readlinkExact, realpathExact, and statExact

egress-allowlist-runner-test-support
  -> contracts only
```

`contracts.ts` defines the private port, lifecycle observations, identity values, protocol DTOs, terminal result, and failure codes. `record-observer.ts` owns policy and state transitions. The future host adapter owns concrete process APIs but no XR policy. The entrypoint cannot import the sequencer, token issuer, accounting, provenance, eligibility, evidence, or retry modules. Neither the controller nor adapter may import Core-facing provider/application composition.

The existing runner production-tree guard currently forbids process APIs. It remains intact. Fake lifecycle support is physically outside the production runner root, and production runner code must never import that test-support sibling. Any future concrete adapter is also physically outside the runner tree and receives a separate exact allowlist; moving it does not authorize it. Neither sibling directory is created by this plan.

## 3. Observer identity model

Observer identity is a control-plane identity and is separate from the target executable/path evidence being observed. The exact expected identity is composed before any spawn from:

```ts
type XrObserverIdentity = Readonly<{
  contractVersion: 1;
  protocolVersion: 1;
  nodeExecutableRealpath: string;
  nodeExecutableSha256: string;
  observerEntrypointRealpath: string;
  observerEntrypointSha256: string;
  observerBundleByteLength: number;
  buildBindingSha256: string;
}>;
```

Rules:

1. Composition supplies this immutable expected identity; a caller cannot supply or override an executable.
2. An injected identity reader validates the exact absolute Node executable and exact absolute entrypoint immediately before spawn. A mismatch is pre-spawn terminal failure.
3. Spawn uses the exact validated executable path with `shell: false`; it never uses `PATH`, `/usr/bin/env`, a shell, a caller executable, a fallback binary, or an alternate entrypoint.
4. The fixed entrypoint is the only program argument. Target `exactPath` values travel only inside framed stdin requests, never in argv, environment, CWD, process title, stderr, or logs.
5. Identity reads concern only the pre-approved control-plane executable and bundle. They do not consume or depend on XR target observations, PRE/POST evidence, or the child, so the design has no circular dependence on the reads it is meant to isolate.
6. A future live identity reader itself requires an approved, bounded control-plane filesystem-read mechanism. Offline implementation uses exact fakes.

There remains a time-of-check/time-of-use interval between identity realpath/hash validation and the concrete spawn. Pure Node composition does not close that interval. This control-plane observer residual is recorded without conflating it with downstream executable code-sign or target-observation TOCTOU:

```text
OBSERVER_IDENTITY_PRESPAWN_TOCTOU = NOT_CLOSED_BY_PURE_NODE_PLAN
```

## 4. One child per record and sole authority

For each XR record, the parent constructs a fresh sandbox and one observer. The same child serves that record's approved PRE and POST primitive requests, then exits. It is never pooled or reused across records. A second child cannot start until the first is `CLEAN_TERMINAL`; `UNCERTAIN_TERMINAL` halts the entire attempt.

The parent permits exactly one request in flight. It allocates the nonce and monotonically increasing sequence, selects `pass`, `op`, and `exactPath`, and checks accounting before sending. The child rejects a duplicate, gap, replay, out-of-order sequence, second in-flight request, unknown field, unknown operation, or request after close. It never schedules work independently.

Normal completion is voluntary: parent sends the fixed close frame after all approved operations; the child acknowledges, closes protocol output, and exits `0`. `TERM` and `KILL` are failure recovery only and must never appear on the clean path.

## 5. Closed bounded protocol

### Framing and encoding

- Transport: stdin requests, stdout responses, stderr diagnostic sink.
- Frame: unsigned 32-bit big-endian byte length followed by one canonical UTF-8 JSON object.
- JSON: no BOM, no invalid UTF-8, no duplicate keys, no floats, no extra fields, and canonical lexicographic key order on emission.
- Maximum frame payload: 8,192 bytes.
- Maximum aggregate stdin and stdout bytes per child, including frame prefixes: 65,536 bytes each.
- Maximum stderr: 4,096 bytes; any non-empty stderr is a closed failure even below the cap.
- Maximum operation requests: 52 per child as a defense-in-depth ceiling. The parent's stricter record-derived `XR_LIMITS` remains authoritative.
- Nonce: exactly 32 lowercase hexadecimal characters, generated by the parent fake/clock-id boundary in offline tests and by the approved shared ID source later.
- Sequence: integer `1..52`, contiguous and never reused.

### Request schema

Every operation request contains exactly:

```text
version, nonce, sequence, pass, op, exactPath
```

- `version`: literal `1`.
- `pass`: `PRE | POST`.
- `op`: exactly `LSTAT | READLINK | REALPATH | STAT`.
- `exactPath`: non-empty absolute path already selected by the parent; it is opaque to the child other than exact primitive invocation.

The sole close request contains exactly `version`, `nonce`, `sequence`, and `close: true`. It consumes the next sequence but not an XR read budget unit.

### Response schema

An operation response contains exactly `version`, `nonce`, `sequence`, `status`, and one of:

- `status: OK`, `value: <operation-specific normalized result>`; or
- `status: ERROR`, `error: <closed primitive error code>`.

It does not echo `exactPath`. A close acknowledgment contains exactly `version`, `nonce`, `sequence`, and `status: CLOSED`.

Allowed primitive errors are `ENOENT`, `ENOTDIR`, `ELOOP`, `EACCES`, `EPERM`, `EINVAL`, `ENAMETOOLONG`, and `IO_UNCLASSIFIED`. This closed set is justified by `lstat`, `readlink`, `realpath`, and `stat`; content-read-only errors are excluded. Platform error messages and stacks never cross the protocol.

### Ordering and terminal rules

- The parent sends no next frame before the matching response is fully decoded.
- Duplicate, stale, future, missing, or wrong-nonce frames are terminal protocol failures.
- A response before the matching request, two responses for one request, trailing bytes after `CLOSED`, partial frame at EOF, EOF with an outstanding request, or result without subsequent clean exit/reap/stream closure is terminal.
- A decoded result remains provisional until the child reaches `CLEAN_TERMINAL`.
- Buffer limits are checked before allocation and before concatenation. Crossing any cap terminates parsing and enters failure containment.

## 6. Path privacy and process envelope

### Descriptor and channel policy

- Child stdio is exactly three pipes: parent-to-child stdin, child-to-parent stdout, and capped stderr.
- No inherited application descriptors, IPC channel, TTY, extra fd, detached mode, shell, or process-group authority.
- Parent closes stdin on normal close or immediately upon containment entry; all listeners and pipe handles are released only after terminal classification.

### Environment and CWD

- Environment allowlist is exactly `LANG=C`, `LC_ALL=C`, and `NO_COLOR=1`.
- `PATH`, `HOME`, `TMPDIR`, provider/Discord variables, secrets, inherited Node options, and caller environment are absent.
- CWD is a fresh runner-owned exact sandbox directory for the record. The exact target path is not encoded in its name.
- Source guards prohibit child writes and dynamic loading. Cleanup accepts only the recorded exact sandbox root and is idempotent.

### Identity, permissions, and umask

- The minimal Node design does not claim privilege reduction. It inherits the already-validated effective uid/gid and supplementary groups; a mismatch against composition policy fails before spawn.
- The child sets `umask(0o077)` before emitting readiness. Failure to do so is terminal.
- No `setuid`, `setgid`, `sudo`, entitlement, sandbox-exec, or credential escalation is permitted. Requiring group reduction or a distinct uid is a scope expansion and separate review.

### Resource-limit matrix

| Resource | Proposed enforcement | Claim |
|---|---|---|
| wall time | parent monotonic deadline plus bounded TERM/KILL phases | enforced by lifecycle policy |
| requests | parent accounting and child hard ceiling 52 | enforced |
| protocol bytes | 8 KiB/frame, 64 KiB each direction | enforced |
| stderr | 4 KiB and non-empty-is-failure | enforced |
| concurrent processes | state machine permits one child for one record | enforced while parent lives |
| file writes | imports/operations closed to four reads; fresh sandbox | static/semantic defense, not kernel proof |
| CPU, RSS/address space, open files, file size | no portable Node `spawn` rlimit contract | not claimed |

`--max-old-space-size` is not treated as an OS memory limit. Adding `setrlimit`, seatbelt/sandbox profiles, or a native launcher changes the implementation boundary and requires feasibility evidence and independent review.

## 7. Darwin orphan disposition and reap proof

Darwin reparents a surviving child when its parent exits; it has no Linux `PR_SET_PDEATHSIG` equivalent in the proposed Node-only boundary. Stdin EOF plus a child self-deadline are useful defenses, but both rely on the child runtime/event loop making progress and therefore do not prove bounded termination of a stuck child. Process groups do not provide parent-death termination. An external supervisor would introduce another process and conflict with the one-child-per-record invariant.

Self-watchdog defenses may reduce practical residual exposure, but they are not yet proof of ADR-0065 orphan containment; the uninterruptible-wait case remains unresolved. This remediation records rather than starts that feasibility work.

```text
ORPHAN_DISPOSITION = BLOCKED_FEASIBILITY_GAP
ORPHAN_NEXT_DECISION = SELF_WATCHDOG_FEASIBILITY
SELF_WATCHDOG = NOT_YET_PROOF_OF_ADR_0065_ORPHAN_CONTAINMENT
```

Likewise, Node's `exit` and `close` observations are distinct lifecycle facts, but the proposed TypeScript surface must not equate either event with an independently proven reap. The lifecycle port therefore exposes separate observations:

```ts
observeExit(): Promise<ExitObservation>;
observeReap(): Promise<ReapProof>;
observeStreamsClosed(): Promise<StreamsClosedProof>;
```

Fakes can exercise these independently. A future concrete adapter cannot synthesize `ReapProof` from an `exit` event or PID disappearance. Candidate closure requires a separately reviewed native Darwin mechanism (for example, a minimal wrapper/watchdog using documented process observation) or an explicit architecture decision accepting the residual gap. Until then:

- parent death/crash cannot have a proven bounded orphan disposition;
- live `ReapProof` has no accepted producer;
- any missing observation yields `UNCERTAIN_TERMINAL` and halts the attempt;
- no FCI live implementation may be approved.

Reference facts to verify during feasibility closure: Apple `wait(2)` documents orphan reparenting and wait semantics; Apple `kqueue(2)` documents process filters; Node child-process documentation distinguishes `exit` and `close`. These sources inform the gap but do not by themselves prove the proposed invariant.

## 8. Lifecycle and terminal state model

```text
IDLE
 -> IDENTITY_VALIDATED
 -> STARTING
 -> ACTIVE
 -> CLOSING
 -> EXIT_OBSERVED
 -> REAP_PROVEN
 -> STREAMS_CLOSED
 -> CLEANING
 -> CLEAN_TERMINAL

Any nonterminal state
 -> TERMINATING_TERM
 -> TERMINATING_KILL (only if grace expires)
 -> EXIT_OBSERVED
 -> REAP_PROVEN
 -> STREAMS_CLOSED
 -> CLEANING
 -> CLEAN_TERMINAL | UNCERTAIN_TERMINAL
```

`IDENTITY_VALIDATED` makes the pre-spawn gate explicit. `CLOSING` distinguishes voluntary success from containment. Exit, reap, streams, and cleanup are separate because none implies another. `UNCERTAIN_TERMINAL` is absorbing. A deadline callback may request containment but may never settle the operation. Final settlement occurs only after the required terminal observations and cleanup result are recorded.

Failure containment is exactly:

1. freeze new requests and discard provisional results;
2. close stdin and issue one TERM through the lifecycle port;
3. wait a fixed monotonic grace interval;
4. if exit is not observed, issue one KILL;
5. wait a fixed final exit interval;
6. independently require reap proof and stream closure;
7. perform exact-root cleanup;
8. classify clean only when every required observation is proven; otherwise classify uncertain and halt the attempt.

Concrete durations are composition constants, not caller inputs: operation deadline 2,000 ms, TERM grace 250 ms, final exit/reap/stream deadline 1,000 ms, cleanup deadline 1,000 ms. Changing them requires tests and review but not a protocol field.

## 9. Closed failure taxonomy and precedence

Closed codes:

```text
OBSERVER_IDENTITY_MISMATCH
OBSERVER_IDENTITY_UNREADABLE
SANDBOX_PREPARE_FAILED
SPAWN_FAILED
READY_TIMEOUT
REQUEST_WRITE_FAILED
PROTOCOL_FRAME_INVALID
PROTOCOL_SCHEMA_INVALID
PROTOCOL_NONCE_MISMATCH
PROTOCOL_SEQUENCE_VIOLATION
PROTOCOL_OUTPUT_LIMIT
STDERR_NONEMPTY
STDERR_LIMIT
CHILD_PRIMITIVE_ERROR
OPERATION_TIMEOUT
UNEXPECTED_EXIT
NORMAL_CLOSE_FAILED
TERM_FAILED
KILL_FAILED
EXIT_UNPROVEN
REAP_UNPROVEN
STREAM_CLOSE_UNPROVEN
CLEANUP_FAILED
INTERNAL_STATE_VIOLATION
```

Precedence is deterministic and independent of callback arrival order. The final primary failure is the first present class in this order, then its fixed code order above:

1. identity/state invariant;
2. spawn/sandbox preparation;
3. protocol/output/stderr safety;
4. operation/primitive/normal-close failure;
5. TERM/KILL actuation failure;
6. exit, reap, or stream proof failure;
7. cleanup failure.

All observed codes are retained in a sorted secondary set. Any item in classes 5-7 forces `UNCERTAIN_TERMINAL`; class 1-4 may end `CLEAN_TERMINAL` only after successful containment, reap, stream closure, and cleanup. This prevents a late timer, error, or close callback from overwriting a more authoritative failure.

## 10. Reuse decisions

| Existing seam | Decision | Reason |
|---|---|---|
| Ollama preflight bounded output reader | ADAPT concept only | XR needs incremental length framing, pre-allocation caps, and closed schema; direct reuse would import application/provider assumptions. |
| Ollama TERM/KILL runner | ADAPT state semantics only | its final timer can settle without separate reap proof, so direct reuse violates ADR-0065. |
| runner-owned Ollama sandbox cleanup | ADAPT exact-root/idempotence pattern | ownership names and authority differ; no cross-adapter import is allowed. |
| `packages/command-local` process execution | DO_NOT_REUSE | it is a general command capability and would expose caller command authority forbidden here. |

No low-level component is approved for direct reuse. If later extraction is justified, only a policy-neutral, tested primitive may move behind the private lifecycle port; it cannot acquire XR sequencing or evidence authority.

## 11. Offline/fake test plan

The first implementation slice is process-free and filesystem-metadata-free. Tests use a scripted fake lifecycle, fake identity reader, fake monotonic clock, and fake cleanup owner. Required cases:

- exact identity success; each identity field mismatch; unreadable identity; no spawn after failure;
- exact executable binding and rejection of PATH, shell, caller argv, alternate entrypoint, inherited env, or target path in argv/env/CWD/diagnostics;
- one child per record, no overlap, no pooling, and whole-attempt halt after uncertain terminal;
- exactly `LSTAT`, `READLINK`, `REALPATH`, and `STAT` in PRE/POST, one outstanding request, exact contiguous sequence, and close handshake;
- split prefixes/payloads, coalesced frames, invalid UTF-8, zero/oversized length, duplicate JSON keys, extra/missing fields, wrong nonce/version/pass/op, duplicate/gap/out-of-order response;
- output/stderr/request caps at boundary and one byte beyond; EOF mid-prefix/mid-payload; trailing bytes; response-before-request; result-before-exit remains provisional;
- voluntary normal exit sends no TERM/KILL;
- operation timeout, TERM success, TERM grace then KILL, TERM failure, KILL failure, exit missing, reap missing, streams missing, cleanup failure, and every combination needed to prove precedence;
- callback permutations and late callbacks cannot double-settle or alter primary failure;
- named regression — final timer fires without exit, reap, stream-close, or cleanup proof: it MUST NOT produce `CLEAN_TERMINAL` (`FINAL_TIMER_FIRED != EXIT_PROVEN`, `FINAL_TIMER_FIRED != REAP_PROVEN`, and `FINAL_TIMER_FIRED != CLEAN_TERMINAL`);
- exact sandbox cleanup only, idempotent cleanup, cleanup timeout, and no sibling deletion;
- uid/gid policy mismatch and umask-ready failure;
- stdin EOF/self-deadline defenses are recorded but never accepted as Darwin orphan proof;
- property tests over bounded frame chunking and lifecycle event permutations.

No test may import `node:child_process`, start a process, send a signal, read target metadata, or mutate a real runtime sandbox. A later concrete-adapter validation is a separate approval gate.

## 12. Static guards

Add exact guards with the offline implementation:

- production isolation controller has no import of `node:child_process`, `node:fs`, `node:worker_threads`, shell libraries, provider adapters, Core, evidence/provenance, retry, or token issuers;
- concrete process APIs are forbidden everywhere except the future exact host-adapter file;
- observer entrypoint imports only protocol/contracts and the exact `lstatExact`, `readlinkExact`, `realpathExact`, and `statExact` primitive modules; AST checks reject content reads, write/mutate APIs, dynamic import/require, networking, subprocesses, IPC, timers beyond the fixed self-deadline, and environment/path discovery;
- production XR-FCI modules mechanically reject `@chunsik/command-local` (CAP-007), every generic command runner, the Ollama preflight/process runner, and every provider-specific runner. A policy-neutral extracted utility is separately admissible only when static inspection proves it contains neither capability ownership nor process policy;
- production runner code mechanically rejects imports from `egress-allowlist-runner-test-support`;
- protocol DTOs reject index signatures, arbitrary metadata, unbounded strings, and unknown fields;
- no `PATH`, shell, alternate executable, caller `execArgv`, inherited environment spread, target-path logging, or error-message forwarding;
- parent-only symbols (`ApprovedPathToken`, `XR_LIMITS`, `XrReadAccounting`, provenance, eligibility, evidence, retry) cannot be imported by child or host adapter;
- tests prove static guards fail on seeded forbidden fixtures.

## 13. Future validation and approval gates

### Gate A — independent FCI plan review

Chief Architect/reviewer confirms ADR-0065 alignment, ownership, import direction, protocol closure, taxonomy, and that the orphan/reap gaps are stated rather than hidden.

### Gate B — orphan/reap feasibility decision

Before live adapter implementation, supply Darwin-specific evidence and choose one:

1. approve a minimal native mechanism that preserves exactly one observer child and produces bounded orphan disposition plus explicit reap proof; or
2. ratify a revised invariant/residual-risk decision.

This is an architecture boundary decision and cannot be inferred by the implementer. Its next decision is `SELF_WATCHDOG_FEASIBILITY`; this plan does not begin that work or claim it resolves the uninterruptible-wait case.

### Gate C — offline implementation

After explicit implementation approval, add only contracts, controller, parser, fakes, static guards, and offline tests. Validate focused tests, full relevant suite, `pnpm typecheck`, build, guard fixtures, diff, and clean intended scope. No real process or metadata read is authorized.

### Gate D — concrete adapter

Requires separate approval after Gate B. Validate exact observer identity, no-PATH spawn, channel/cap behavior, uid/gid/umask policy, TERM/KILL timing, independent exit/reap/stream observations, exact cleanup, and Darwin orphan behavior in a disposable attended harness. Process execution and signals are strict-governance actions.

### Gate E — XR integration

Only after independent architecture and implementation reviews may the parent sequencer wire the capability. Integration must re-prove limits/accounting, PRE/POST order, provenance/evidence separation, one-child-per-record, and whole-attempt halt. XR-AX remains separately blocked and unapproved.

## 14. Decision summary

- The private capability boundary is small enough and preserves parent authority.
- Observer identity is defined without PATH, caller executables, alternates, or circular target reads.
- Protocol, channels, lifecycle states, failure precedence, fake suite, guards, and validation gates are closed enough for targeted plan review.
- Darwin parent-death orphan disposition and concrete reap proof remain genuine feasibility gaps; stdin EOF, timers, Node events, or PID disappearance are not promoted into proof.
- Therefore the remediated plan is ready for targeted review, while implementation approval remains no.

```text
STAGE_2B_SLICE_5C_EG_F0_XR_FCI_PLAN = READY_FOR_TARGETED_REVIEW
XR_PROCESS_ISOLATION_CAPABILITY_BOUNDARY = ACCEPTABLE_DESIGN
OBSERVER_IDENTITY_MODEL = DEFINED
OBSERVER_IDENTITY_PRESPAWN_TOCTOU = NOT_CLOSED_BY_PURE_NODE_PLAN
ORPHAN_DISPOSITION = BLOCKED_FEASIBILITY_GAP
ORPHAN_NEXT_DECISION = SELF_WATCHDOG_FEASIBILITY
SELF_WATCHDOG = NOT_YET_PROOF_OF_ADR_0065_ORPHAN_CONTAINMENT
XR_FCI_IMPLEMENTATION_APPROVED = NO
PROCESS_EXECUTION_APPROVED = NO
SIGNAL_EXECUTION_APPROVED = NO
XR_ACTUAL_HOST_READ_APPROVED = NO
NETWORK_APPROVED = NO
LOCAL_DAEMON_CONTACT_APPROVED = NO
CODE_SIGN_READ_APPROVED = NO
LOCAL_FILESYSTEM_PROVENANCE_PREFLIGHT = BLOCKED_FEASIBILITY_GAP
XR_METADATA_EVIDENCE_EXECUTION_ELIGIBLE = NO
CODE_SIGN_GATE = BLOCKS_XG_XF_XA_E
CANONICAL_DIGEST_FREEZE_APPROVED = NO
XR_AX_ELIGIBLE = NO
PUSH_APPROVED = NO
NEXT_ACTION = CLAUDE_TARGETED_F0_XR_FCI_PLAN_REVIEW
```
