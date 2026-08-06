# Stage 2B Slice 5C-EG-F0-H Host Adapter and Sequencer Architecture Plan

## 1. Status and Boundary

- **Status:** plan-only; ready for independent targeted review.
- **Accepted inputs:** the F0 Markdown allowlist and fixture-only F0-R deterministic runner at repository HEAD
  `72dd8396ad4e6d0d4e7ff9b98aac26a8f866eb3a`.
- **Objective:** close the architecture contract for a future non-production host adapter and stop-on-first-failure
  sequencer before any implementation or host interaction is approved.
- **Non-authorization:** this plan implements no adapter, resolves no symbol, freezes no digest, reads no host or
  executable metadata, creates no process, sends no signal, and dispatches no command.

```text
F0_ALLOWLIST_CONTRACT = COMPLETE_AND_ACCEPTED
F0_R_FIXTURE_RUNNER = COMPLETE_AND_ACCEPTED
REAL_HOST_ADAPTER = NOT_IMPLEMENTED
CANONICAL_DIGEST = NOT_FROZEN
F0_F1_EXECUTION = NOT_APPROVED
```

Ownership remains `tools/provider-routing/egress-allowlist-runner/**`, with a future private `host/` sub-boundary.
No code under `packages/core/**`, production application/runtime, Provider routing, or Discord may import it. Core
change, production public API change, and Runtime activation are all `NO`.

## 2. Structural Ownership and Dispatch Capability

The future boundary has three layers:

```text
ApprovedExecutionContextFactory
  -> StopOnFirstFailureSequencer
       -> private HostCommandAdapter capability
       -> private HostExecutableIdentityVerifier capability
       -> accepted pure F0-R validation/normalization functions
```

Only `ApprovedExecutionContextFactory` may create a sequencer run and its dispatch authority. The authority uses a
module-private `WeakSet` brand, or a reviewed equivalent runtime-unforgeable brand, and a private constructor/factory.
It is not a structural TypeScript token and is nonserializable, noncloneable, and unavailable through public exports.
Tests receive a distinct fake capability, never the real brand.

Each per-command capability binds all of the following and nothing caller-selected:

```text
staticAllowlistDigest
executionBaselineDigest
COMMAND_ORDER_VERSION
sequencerRunId
sequenceIndex
single sequencer run
```

The capability becomes invalid immediately after one dispatch attempt, whether spawn succeeds or fails. A failure
revokes the root authority and every undispatched future capability. The adapter exposes no generic
`execute(record)` entry point and cannot be called around baseline, dependency, identity, order, or policy checks.

The sequencer exclusively owns command index, state transitions, dependency derivation, evidence acceptance,
terminalization, and final projection. It is single-use and cannot restart after consumption or failure.

The only supported topology is `ONE_BOUNDED_CHILD_NO_DESCENDANTS`. Every spawn uses `detached=false`; IPC stdio,
process-group execution, descendant creation, and descendant management are prohibited.

## 3. Versioned Live Execution Policies and Baseline Binding

The following identifiers are closed live-execution contract inputs:

```text
SEQUENCER_CONTRACT_VERSION = stage2b-5c-eg-f0-stop-first-sequencer-v1
PROCESS_ADAPTER_POLICY_VERSION = stage2b-5c-eg-f0-process-adapter-v1
REAL_STREAM_ADAPTER_POLICY_VERSION = stage2b-5c-eg-f0-real-stream-adapter-v1
TERMINATION_POLICY_VERSION = stage2b-5c-eg-f0-exact-child-termination-v1
ENVIRONMENT_POLICY_VERSION = stage2b-5c-eg-f0-host-environment-v1
COMMAND_ORDER_VERSION = stage2b-5c-eg-f0-command-order-v1
```

`COMMAND_ORDER_VERSION` is part of the canonical static allowlist digest. The other live versions, their complete
closed policy contents, and the executable identity policy version are inputs to `executionBaselineDigest`. Runtime
observations never enter a policy definition. Any version or policy-content mismatch stops before dispatch.

The future `ExecutionBaselineBinding` is a closed object containing:

```text
branch
repositoryHead
repositoryParent
originMain
expectedBehindCount
expectedAheadCount
trackedClean
stagedClean
approvedUntrackedInventoryPolicy
repositoryRoot
allowlistDocumentBlobId
architecturePlanBlobId
staticAllowlistDigest
sequencerContractVersion and closed policy
processAdapterPolicyVersion and closed policy
realStreamAdapterPolicyVersion and closed policy
terminationPolicyVersion and closed policy
environmentPolicyVersion and closed policy
executableIdentityPolicyVersion and closed policy
```

Its recursively canonical bytes produce `executionBaselineDigest`. Neither digest contains itself, and the baseline
digest is not part of the static digest. Both digests are mandatory in the approved context, opaque dependency state,
sequencer state, and every command evidence object.

## 4. Git Version Bootstrap and Exact Freeze Sequence

The closed symbol table remains exactly:

```text
APPROVAL_BOUND_HEAD_SHA
APPROVAL_BOUND_ARCHITECTURE_PLAN_BLOB_ID
APPROVAL_BOUND_GIT_VERSION_LINE
```

`APPROVAL_BOUND_GIT_VERSION_LINE` comes only from one separately approved pre-freeze exact Git version process. That
process is outside the 16-record sequence but must use the same executable path and identity policy, exact argv, cwd,
closed environment, process/stream limits, and termination policy. It produces bounded evidence and resolves only
that symbol; it grants no command, digest, host-read, or execution authority. It is process execution, not passive
metadata collection.

After freeze, F0-GIT-00 confirms the frozen Git identity; it does not discover or bootstrap the value. Missing,
unknown, extra, unresolved, pattern-invalid, or baseline-inconsistent symbols stop before dispatch.

The exact freeze sequence is:

```text
approved repository and executable metadata evidence accepted
-> approved pre-freeze Git version evidence accepted
-> closed symbol table resolved
-> resolved executable contract validated
-> canonical static allowlist bytes produced with COMMAND_ORDER_VERSION
-> approved static allowlist digest compared and frozen
-> ExecutionBaselineBinding canonicalized with closed live policies
-> approved executionBaselineDigest compared and frozen
-> sequencer capability becomes eligible
-> immediate pre-spawn executable identity revalidation may begin
```

No final digest is calculated or claimed by this plan.

## 5. Dependency, Replay, and Evidence-Chain Protection

`DependencyState` is constructed only by the active sequencer from symbol resolution and its immutable append-only
evidence chain. It binds `staticAllowlistDigest`, `executionBaselineDigest`, repository HEAD/root,
`sequencerRunId`, `COMMAND_ORDER_VERSION`, and `sequenceIndex`. The context factory, not a caller, creates the run ID.
Fixture results, caller objects, detached evidence, or evidence from another run cannot establish a dependency.

Prior evidence must pass the closed schema and match all applicable identity fields, including:

```text
commandId
exitClass = SUCCESS
stopReason = NONE
normalizationResult = SUCCESS
staticAllowlistDigest
executionBaselineDigest
sequencerRunId
commandOrderVersion
sequenceIndex
repositoryHead
workingDirectory
argvDigest recomputed from the current record
evidenceClass equal to the current record
contractVersion
schemaVersion
privilegeClass
localDaemonContact
executableRealpath and final approved executable identity
```

`observedAt` remains audit-only. Byte and redaction counts are schema-validated but do not establish dependency
identity. Any mismatch is terminal before the next dispatch.

For F0 the accepted residual order proof is deliberately bounded: single-use sequencer plus immutable append-only
chain plus sequence index, baseline digest, and static digest. No separate chain digest and no predecessor field in
individual evidence are required. Detached evidence cannot prove order because only the active sequencer may accept
it. The result contains the final ordered bounded list or a deterministic bounded digest of that list. This residual
is accepted only for the bounded, single-process F0 run and is not a general workflow precedent.

## 6. Stop-on-first-failure Sequencer and Closed Result

The fixed phases are:

```text
PRE_EXECUTION_BOUND
-> EXECUTABLE_IDENTITIES_VALIDATED
-> F0_BASELINE_RUNNING
-> F1_SOURCE_RUNNING
-> F1_PATH_RUNNING
-> EVIDENCE_FINALIZED
-> STOPPED
```

For each record, the sequencer validates phase, exact next ID/index, current digests and policy versions, executable
identity, dependencies, and stream/termination capability before issuing one dispatch capability. It advances only
after accepting `SUCCESS/NONE/SUCCESS` evidence.

Any other result atomically terminalizes the run, revokes all dispatch authority, prevents later identity checks and
spawns, retains only bounded evidence, and returns without retry, repair, fallback, resume, or alternate parsing.
F0-GIT-04 is parsed as `behindCount` then `aheadCount`; mismatch with the binding emits `BASELINE_MISMATCH` and makes
all later records ineligible.

`SequencerResult.resultClass` is one of exactly:

```text
COMPLETED
BASELINE_FAILED
COMMAND_SAFETY_FAILED
COMMAND_EXECUTION_FAILED
EVIDENCE_VALIDATION_FAILED
PROCESS_TERMINATION_FAILED
```

The immutable result contains exactly the bounded control fields:

```text
resultClass
terminalCommandId
terminalSequenceIndex
staticAllowlistDigest
executionBaselineDigest
acceptedEvidenceCount
terminalEvidence
final ordered bounded evidence list or its bounded deterministic digest
```

It contains no raw stdout/stderr. `COMPLETED` is possible only after all 16 successes; every other terminal state
invalidates the remaining sequence.

## 7. Exact Command Order

```text
01 F0-GIT-00
02 F0-GIT-01
03 F0-GIT-02
04 F0-GIT-03
05 F0-GIT-04
06 F0-GIT-05
07 F0-GIT-06
08 F0-GIT-07
09 F0-GIT-08
10 F1-SRC-01
11 F1-SRC-02
12 F1-SRC-03
13 F1-SRC-04
14 F1-PATH-01
15 F1-PATH-02
16 F1-PATH-03
```

F0-GIT-00 confirms the already frozen Git identity. F0-GIT-07 establishes accepted blob identities before source
excerpts. Every F0 baseline command precedes F1, and installed-path metadata remains last.

## 8. Future Real Host Command Adapter and Environment

The chosen API is `node:child_process.spawn(executable, argv, options)` with:

```text
shell = false
detached = false
executable = exact absolute record path
argv = exact immutable record argv
cwd = exact approved repository root
env = { LANG: "C", LC_ALL: "C" }
stdio = [ignore, pipe, pipe]
windowsHide = true where supported
```

PATH lookup, command strings, `exec`, fallback APIs, shell parsing, command substitution, globbing, redirects, pipes,
IPC stdio, inherited environment, and executable fallback are prohibited. `HOME`, proxy, credential, pager, shell,
and Git mutation variables are absent. The adapter exposes no generic spawn options.

Git may emit stderr. The contract still requires empty stderr for success; it does not suppress, widen, or whitelist
stderr. Viability of `LANG=C` and `LC_ALL=C` is established only by the separately approved pre-freeze Git version
capture. `ENVIRONMENT_VIABILITY = EXECUTION_GATE`: failure or nonempty stderr yields `COMMAND_SAFETY_BLOCKED` and
prevents freeze/execution. An environment change requires contract review and a new baseline digest.

## 9. Executable Identity and TOCTOU Boundary

The private verifier reads only the exact configured executable path and validates canonical realpath, exact symlink
policy, regular-file type, stable device/inode or reviewed platform equivalent, numeric owner/group, mode, size, and
code-sign identity where required. It performs no PATH lookup, directory enumeration, discovery, or alternate search.

The same identity is revalidated immediately before spawn and the final identity is recorded in evidence. Because
Node `spawn` has no portable execute-by-file-descriptor contract, this narrows but does not eliminate the
time-of-check/time-of-use window. Post-spawn executable correlation may require a platform-specific process-status
read; that read is not approved and needs a separate feasibility decision.

```text
EXECUTABLE_IDENTITY_TOCTOU_CONTROL = BLOCKED_FEASIBILITY_GAP_FOR_LIVE_EXECUTION
```

This gap does not block HI mocked implementation. It blocks XA authorization and E execution until a reviewed
mechanism is approved or the Chief Architect explicitly accepts the bounded residual risk.

## 10. Process Event and Timeout State Machine

The adapter models `spawn`, `error`, `exit`, `close`, stdout/stderr `data`, `end`, and `error`, timeout, termination
request, and termination completion. One private atomic terminalization path runs exactly once. Late events are
ignored for evidence and capability purposes; timers, listeners, and readers are disposed; no later evidence or
capability is emitted; and completion is impossible while the exact child is unaccounted for.

- `error` before `spawn` is `PROCESS_SPAWN_FAILED`.
- `exit` captures exit code and signal separately but is not sufficient for final completion.
- `close` establishes process/stdio closure eligibility after both streams are finalized.
- stdout or stderr reader errors are `STREAM_READ_FAILED`, distinct from nonzero exit.
- nonzero exit and signal exit remain distinct classifications.
- the bounded process result stores exit code and signal in separate fields.

Every command timeout is exactly 5000 ms. The timer starts immediately before `spawn` and covers spawn, execution,
both stream finalizations, and `close`. Timeout is terminal, requests exact-child termination, and never retries.
Termination authority must exist before spawn eligibility.

```text
timeout -> EXECUTION_ERROR / COMMAND_TIMEOUT
spawn error -> EXECUTION_ERROR / PROCESS_SPAWN_FAILED
stream error -> EXECUTION_ERROR / STREAM_READ_FAILED
termination failure -> EXECUTION_ERROR / PROCESS_TERMINATION_FAILED
EVIDENCE_SCHEMA_VERSION_CHANGE_REQUIRED = YES
```

HI therefore begins with an additive evidence enum/schema version bump, updates the canonical static digest, and
receives independent validation before the mocked adapter is added. Existing evidence/schema versions are not reused.

## 11. Real Stream Backpressure and Finalization

stdout and stderr remain separate. A synchronous byte limiter runs before retention or asynchronous handoff. There is
no secondary unbounded queue and at most one delivered chunk per stream may remain unprocessed. Oversized chunks are
sliced into pieces of at most 4096 bytes before validation; no raw oversized chunk is enqueued.

Each source pauses before asynchronous handoff and resumes only after the limiter accepts the piece. A cap, decoder,
queue, or protocol violation stops retention immediately and requests exact-child termination. Stateful strict UTF-8
decoding spans chunks, CRLF/CR normalization spans boundaries, and equality with byte/line caps is allowed. Decoder
flush occurs exactly once; incomplete terminal UTF-8 is invalid.

Finalization waits for process outcome, both stream ends, decoder flushes, and `close`. Accepted failure precedence is
preserved:

```text
both caps exceeded -> BOTH_STREAM_OUTPUT_LIMIT_EXCEEDED
stderr cap exceeded -> STDERR_OUTPUT_LIMIT_EXCEEDED
stdout cap exceeded -> STDOUT_OUTPUT_LIMIT_EXCEEDED
bounded non-empty stderr -> STDERR_NONEMPTY
```

Late data after terminalization is ignored for evidence and treated only as an internal invariant violation. No
unbounded raw or normalized material is retained.

## 12. Exact-child Termination Policy

The only termination sequence is:

```text
if child has not exited: send SIGTERM once
-> wait 500 ms
-> if still not exited: send SIGKILL once
-> wait up to 500 ms for close confirmation
```

Signals target only the direct child PID created by the current dispatch. Descendants, process groups, negative PIDs,
alternate signals, repeated escalation, filesystem cleanup, and host cleanup are prohibited. No signal is sent after
exit. Listener/timer disposal is adapter-internal memory hygiene, not host cleanup.

Failure to account for child closure yields `EXECUTION_ERROR/PROCESS_TERMINATION_FAILED`, returns
`PROCESS_TERMINATION_FAILED`, and invalidates the sequence. Termination approval is separate from process creation;
without both approved authorities, spawn is ineligible.

## 13. Host Operation Classification

| Operation | Class | Daemon/network | Approval boundary |
|---|---|---|---|
| Repository metadata/file read | bounded unprivileged host read | none | XR exact host-read approval |
| Exact executable metadata/code-sign read | bounded unprivileged safety read | none | XR exact host-read approval |
| Exact process creation | lifecycle mutation | none by contract | XG or E process approval |
| Platform process-status read | host/process metadata read | none | separate feasibility and read approval |
| stdout read | bounded process I/O read | none | same approved process operation |
| stderr read | bounded process I/O read | none | same approved process operation |
| exit/status event observation | bounded process lifecycle observation | none | same approved process operation |
| direct-child `SIGTERM` | lifecycle mutation | none | separate exact-child termination authority |
| direct-child `SIGKILL` | lifecycle mutation | none | separate exact-child termination authority |
| Listener/timer disposal | internal in-memory mutation | none | implementation authority; not host cleanup |
| Local daemon contact | prohibited external interaction | local daemon | not approved; safety block |
| Network possibility | prohibited external interaction | network | not approved; safety block |
| Host mutation other than exact child lifecycle | prohibited host mutation | none | not approved |

Every record remains `localDaemonContact=NONE` and `networkPolicy=NONE`. Evidence that a record may contact either is
`COMMAND_SAFETY_BLOCKED`; classification cannot be widened in place. No privileged operation is designed.

## 14. Security and Failure Model

The system fails closed on baseline, symbol, digest, policy-version, command-order, dependency, capability, executable
identity, environment, spawn, timeout, stream, decoder, output-limit, exit, daemon/network, termination, or evidence
schema failure. Failure emits only bounded closed evidence and requires new approval. There is no retry, automatic
repair, fallback executable/command/source, alternate parser or adapter, broadened output, privilege escalation, or
continuation with warnings.

## 15. Future Implementation Entry Requirements

Before a real adapter can be considered, HI/HV must prove offline with mocked process/metadata/stream/termination APIs:

- additive evidence schema version and all four new execution-error reasons;
- unforgeable single-use capability, root revocation, and exact order/run/index binding;
- atomic one-time terminalization across every event ordering, including late events;
- 5000 ms whole-lifecycle timeout and exact 500/500 ms termination escalation;
- separate exit code/signal and stream-error handling;
- synchronous 4096-byte slicing, pause/resume backpressure, bounded queue, and strict decoder flush;
- immutable append-only evidence acceptance and closed `SequencerResult`;
- exact closed environment with no inheritance; and
- no production/Core import, host interaction, real process, daemon, network, or provider execution.

These requirements do not reopen or weaken F0-R acceptance and do not authorize implementation.

## 16. Slice Order and Independent Approvals

```text
5C-EG-F0-H  = this plan-only architecture closure
5C-EG-F0-HI = offline mocked process/metadata/stream/termination implementation
5C-EG-F0-HV = independent static, import-boundary, schema, and fixture validation
5C-EG-F0-XR = exact repository and executable metadata reads only
5C-EG-F0-XG = one exact pre-freeze Git version execution only
5C-EG-F0-XF = pure symbol resolution and static/baseline digest freeze
5C-EG-F0-XA = authorization of the frozen 16-command sequence and termination
5C-EG-F0-E  = actual bounded stop-on-first-failure execution
```

XR performs no process, symbol resolution, or digest freeze. XG resolves only the Git-version symbol and needs its own
spawn and termination approvals; it does not run the sequence. XR or XG failure blocks XF. XF is pure and creates no
process. XA authorizes but does not execute, and remains blocked by TOCTOU and environment gates. E needs its own
execution approval. No approval inherits between slices; Push/PR/Merge remain separate.

## 17. Decisions

| Decision | Status | Decision and rationale |
|---|---|---|
| `HOST_ADAPTER_OWNER` | `DECIDED` | Private `host/` boundary under the non-production runner owner. |
| `PROCESS_API` | `DECIDED` | Exact absolute executable and argv via `spawn`, `shell=false`, `detached=false`. |
| `SEQUENCER_OWNER` | `DECIDED` | Single-use sequencer owns authority, order, state, evidence, and terminalization. |
| `STOP_ON_FIRST_FAILURE_ENFORCEMENT` | `DECIDED` | Runtime-unforgeable one-attempt capability and root revocation enforce the stop. |
| `EXECUTION_BASELINE_DIGEST_OWNERSHIP` | `DECIDED` | Context factory canonicalizes all approved baseline and live-policy inputs. |
| `DEPENDENCY_REPLAY_BINDING` | `DECIDED` | Digests, run ID, order version, index, argv, identity, and schema bind replay. |
| `EXECUTABLE_IDENTITY_READ_CLASS` | `DECIDED` | Exact-path runner safety read requiring XR approval. |
| `EXECUTABLE_IDENTITY_TOCTOU_CONTROL` | `BLOCKED_FEASIBILITY_GAP_FOR_LIVE_EXECUTION` | Immediate recheck narrows but cannot portably eliminate spawn TOCTOU. |
| `PROCESS_TERMINATION_CLASS` | `DECIDED` | Separately authorized direct-child lifecycle mutation only. |
| `PROCESS_TERMINATION_PARAMETERS` | `DECIDED` | SIGTERM once, 500 ms, SIGKILL once, 500 ms close confirmation. |
| `PROCESS_EVENT_MODEL` | `DECIDED` | Closed events and one atomic terminalization path account for child and streams. |
| `TIMEOUT_MODEL` | `DECIDED` | Exact 5000 ms covers spawn through streams and close, with no retry. |
| `REAL_STREAM_OPERATION_MODEL` | `DECIDED` | Synchronous limiter, 4096-byte slicing, pause/resume, one pending chunk. |
| `ENVIRONMENT_CONTRACT` | `DECIDED` | Exact `LANG=C`, `LC_ALL=C`, with no inherited variables. |
| `ENVIRONMENT_VIABILITY` | `EXECUTION_GATE` | Pre-freeze Git capture must prove the closed environment before freeze/run. |
| `STATIC_DIGEST_FREEZE_SEQUENCE` | `DECIDED` | XR/XG evidence, symbols, static freeze, then baseline freeze. |
| `GIT_VERSION_BOOTSTRAP` | `DECIDED` | One separately approved pre-freeze process resolves only the Git version line. |
| `COMMAND_ORDER` | `DECIDED` | Versioned exact 16-record order in section 7. |
| `IMPLEMENTATION_SLICE_BOUNDARY` | `DECIDED` | H/HI/HV/XR/XG/XF/XA/E have non-inheriting authorities. |

`ENVIRONMENT_VIABILITY` is an execution gate rather than an architecture decision status. A failed gate does not
reclassify or relax `ENVIRONMENT_CONTRACT`.

## 18. F0-HI Offline Implementation Alignment

F0-H is accepted and F0-HI now supplies only deterministic mocked ports, a runtime-unforgeable single-use dispatch
capability, event arbiter, exact 5000 ms timeout model, exact-child termination state machine, bounded stream model,
replay-bound evidence v2, and the closed final result. No real host adapter exists. Listener ordering is deterministic,
termination failure is operator-visible, and the exact environment remains `LANG=C, LC_ALL=C`.

The remediated host arbiter preserves F0-R stream precedence: both caps, stderr cap, stdout cap, invalid UTF-8, then
bounded non-empty stderr; non-empty stderr can never succeed. The sequencer accepts no caller record array and derives
the exact 16-record order from the prevalidated resolved contract. Before each dispatch it derives and validates the
branded dependency state. Every terminal path creates one closed, validated failure evidence record from active
context values; `orderedEvidence` contains prior successes followed by that terminal record. A deterministic fake
clock schedules and cancels a fresh 5000 ms handle for every mocked command, and timeout/stream safety share the
mocked exact-child termination controller.

```text
F0_H_PLAN = COMPLETE_AND_ACCEPTED
F0_HI_IMPLEMENTATION = MOCKED_ONLY
PRIOR_STATIC_DIGEST_COMPATIBLE = NO
PRIOR_BASELINE_DIGEST_COMPATIBLE = NO
FINAL_DIGEST_FROZEN = NO
ENVIRONMENT_VIABILITY = EXECUTION_GATE_NOT_EVALUATED
EXECUTABLE_IDENTITY_TOCTOU_CONTROL = BLOCKED_FEASIBILITY_GAP_FOR_LIVE_EXECUTION
```

The sequence remains `F0-H -> F0-HI -> F0-HV -> F0-XR -> F0-XG -> F0-XF -> F0-XA -> F0-E`, with no inherited
approval. HI exposes no API that performs host reads, Git-version execution, digest freeze, authorization, or live
execution.

## 19. Approval Boundary

```text
STAGE_2B_SLICE_5C_EG_F0_H_PLAN = READY_FOR_INDEPENDENT_REVIEW
REAL_HOST_ADAPTER_IMPLEMENTATION_APPROVED = NO
HOST_READS_APPROVED = NO
PRE_FREEZE_GIT_VERSION_EXECUTION_APPROVED = NO
PROCESS_EXECUTION_APPROVED = NO
PROCESS_TERMINATION_APPROVED = NO
CANONICAL_DIGEST_FREEZE_APPROVED = NO
F0_F1_EXECUTION_APPROVED = NO
PRIVILEGED_READ_APPROVED = NO
LOCAL_DAEMON_CONTACT_APPROVED = NO
NETWORK_TESTING_APPROVED = NO
HOST_MUTATION_APPROVED = NO
PROVIDER_EXECUTION_APPROVED = NO
PUSH_APPROVED = NO
NEXT_ACTION = CLAUDE_TARGETED_HOST_ADAPTER_PLAN_REVIEW
```
