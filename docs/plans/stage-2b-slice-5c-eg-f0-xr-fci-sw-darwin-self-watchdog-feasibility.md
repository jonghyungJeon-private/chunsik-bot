# Stage 2B Slice 5C-EG-F0-XR-FCI-SW Darwin Self-Watchdog Feasibility Plan

## Status and authority

- Baseline: `main` at `7f6ee7eb72f11fbab48c3d7e0f97cc0af6c07449`.
- Authority preserved: ratified ADR-0065 and the accepted XR-FCI plan.
- Scope: feasibility and plan only. No watchdog implementation, process spawn, signal, `kqueue` execution, filesystem metadata read, XR-FCI implementation, push, PR, or merge is authorized.
- Question: whether a child-local watchdog materially narrows the Darwin orphan residual without misrepresenting detection or initiated termination as bounded physical completion.

## 1. Required semantic separation

The analysis uses four non-interchangeable facts:

```text
PARENT_DEATH_DETECTED
!= SELF_TERMINATION_INITIATED
!= CHILD_TERMINATION_COMPLETED
!= PHYSICAL_KERNEL_FILESYSTEM_CANCELLATION
```

A parent-loss indication immediately makes all provisional child results ineligible. It cannot itself prove that a child exited, was reaped, closed streams, completed cleanup, or cancelled an in-flight kernel/filesystem operation. ADR-0065 remains unchanged.

## 2. Primary-source facts

The feasibility conclusions rely on these documented facts:

- Apple `pipe(2)` defines a pipe as a descriptor pair and says the pipe persists until all associated descriptors are closed. Apple `kqueue(2)` further states that a pipe read filter reports EOF when the last writer disconnects. Therefore EOF depends on ownership of every writer descriptor, not merely the nominal parent object: [Apple pipe(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/pipe.2.html), [Apple kqueue(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kqueue.2.html).
- Apple `intro(2)` states that when a creating process exits, each child's parent PID is changed to the system process `init`. `getppid(2)` only reports the current parent PID: [Apple intro(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/intro.2.html), [Apple getppid(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/getppid.2.html).
- Apple `kqueue(2)` allows `EVFILT_PROC` registration by PID and reports `NOTE_EXIT` when that process exits. Registration can fail with `ESRCH` if the process does not exist. The API provides an observation; it does not terminate the observer.
- Node documents that callback and promise filesystem APIs use libuv's threadpool off the event-loop thread. Node timers are scheduled around the event loop and their callback time depends on other event-loop work: [Node filesystem threadpool](https://nodejs.org/api/fs.html#threadpool-usage), [Node timers](https://nodejs.org/api/timers.html#timers).

These facts establish practical detection paths. They do not establish a maximum termination latency under an uninterruptible kernel/filesystem wait.

## 3. Stdin EOF as parent-death detection

### Model

The existing bounded protocol stdin pipe can also be a liveness lease if all of these FD invariants hold:

1. the parent owns the only write descriptor for the observer's stdin;
2. no sibling, descendant, shell, supervisor, IPC layer, or duplicated descriptor retains a writer;
3. the child owns only the read endpoint;
4. spawn closes every non-allowlisted descriptor and does not create descendants;
5. the parent never transfers or duplicates the writer.

On parent process death Darwin closes that process's descriptors. With no other writer, the child receives already-buffered bytes first and then EOF. EOF is therefore a reliable parent-loss indication under the exact FD invariant. If any duplicate writer exists, EOF may be delayed indefinitely; the invariant is a correctness requirement, not an optimization.

### Interaction with filesystem work

The child can receive pipe EOF while a libuv filesystem request remains outstanding. Because the four planned asynchronous metadata primitives use the libuv threadpool rather than synchronous JS execution, an ordinary single worker request that stalls does not by itself occupy the main event-loop thread. The event loop can normally observe EOF, invalidate provisional results, and initiate fail-closed shutdown.

This is not unconditional. EOF delivery and its handler still require the Node runtime/event loop to make progress. Synchronous/blocking JS, a native addon blocking the main thread, event-loop starvation, runtime failure, or a process/kernel state in which userspace cannot run prevents the child from acting. EOF detects loss only when it is observed; it does not cancel the worker's syscall or prove exit.

```text
STDIN_EOF_PARENT_DEATH_DETECTION = RELIABLE_UNDER_FD_INVARIANT
STDIN_EOF_PROVES_CHILD_TERMINATION = NO
```

## 4. Child-local hard lifetime deadline

The child can arm a fixed, non-caller-configurable maximum record lifetime before accepting the first request. On expiry it stops accepting work, invalidates provisional output, closes protocol activity, enters watchdog failure state, and initiates voluntary fail-closed termination. It cannot retry or finalize evidence.

This materially covers a parent that remains alive but stops driving the protocol and provides an independent trigger when pipe closure is absent or delayed. Structurally, the observer can avoid synchronous filesystem APIs, long JS loops, native addons, worker creation, descendants, and user callbacks, keeping the main event loop available in the expected libuv threadpool-stall case.

The deadline is nevertheless an event-loop timer. Timer starvation, blocking JS/native execution, runtime failure, or inability to execute userspace prevents its callback. A locally observed monotonic expiry does not abort an in-flight kernel request and does not prove process completion.

```text
CHILD_SELF_DEADLINE = PARTIAL_DEFENSE
CHILD_SELF_DEADLINE_PROVES_BOUNDED_EXIT = NO
```

## 5. `getppid` observation

Polling `process.ppid` can notice reparenting after the original parent exits. It is weaker than the uniquely owned pipe:

- it needs polling and event-loop/timer progress;
- the observed value identifies a PID, not a stable process generation or cryptographic parent identity;
- reparenting indicates that the original parent is gone, but does not initiate or prove child termination;
- PID-based comparison adds a race surface without adding proof beyond EOF under the FD invariant.

It may be a diagnostic defense only if it is fixed, path-free, and never treated as authority. It is not part of the strongest minimal model.

```text
GETPPID_PARENT_DEATH_DETECTION = PARTIAL
```

## 6. `kqueue` / `EVFILT_PROC` / `NOTE_EXIT`

A native component can create a kqueue and register `EVFILT_PROC` with the expected parent PID and `NOTE_EXIT`, without network or daemon contact. This is not available through the accepted pure Node capability; an addon or narrow native helper and its build/loading/code-identity boundary would be new authority.

The mechanism is useful but not complete:

- if registration succeeds against the intended live parent, `NOTE_EXIT` is an independent exit notification;
- if the parent exits before registration, registration may return `ESRCH`, which can be treated as parent-loss suspicion/fail-closed;
- capture-PID, validate-parent, and register are not one atomic process-generation binding;
- rapid PID reuse can make a bare PID refer to a different process before registration, so PID plus `getppid` does not by itself close the race;
- `NOTE_EXIT` only reports exit; it neither kills the child nor proves the child's later exit or filesystem cancellation;
- the native notification still needs a runnable child/native event-delivery path to initiate shutdown.

Closing the identity/race questions would require a separately designed native contract and evidence, not an inference in this plan. Since the unique stdin pipe already supplies a capability-like lifetime relationship without PID reuse, kqueue is optional and does not belong in the minimal self-watchdog proposal.

```text
KQUEUE_PARENT_DEATH_DETECTION = PARTIAL_ONLY
KQUEUE_NEW_AUTHORITY_REQUIRED = YES
KQUEUE_INCLUDED_IN_MINIMAL_MODEL = NO
```

## 7. Heartbeat model

A parent heartbeat plus child timeout detects a live parent that has stopped making protocol progress. The hard record deadline already covers that case. Heartbeats add messages, sequencing, timeout tuning, false positives under event-loop delay, and another timer dependency. They do not exceed the proof supplied by a uniquely owned pipe for parent disappearance and do not help when the child cannot execute watchdog logic.

```text
HEARTBEAT_MODEL = REDUNDANT
```

## 8. Strongest minimal combined watchdog

The strongest minimal model is:

```text
unique parent-owned stdin writer
+ exact no-duplicate/no-inheritance FD invariant
+ child-local fixed monotonic maximum lifetime
+ async-only four-operation observer structure
+ fail-closed provisional-result invalidation
```

It deliberately excludes heartbeat, `getppid` polling, kqueue, descendants, and a supervisor.

The model improves specific cases:

| Condition | Stronger outcome |
|---|---|
| parent disappears while child event loop runs | stdin reaches EOF after buffered data; child invalidates results and initiates shutdown |
| parent stays alive but abandons/stalls protocol | child hard deadline initiates shutdown |
| one async metadata request stalls in libuv worker while main event loop runs | EOF/deadline handler can run and initiate shutdown; result stays ineligible |
| EOF and deadline race | first indication enters one absorbing watchdog-failed state; later indication cannot settle twice |
| late filesystem result after watchdog | discarded; cannot restore eligibility or terminal success |
| child cannot execute userspace/watchdog logic | no new proof; orphan/termination residual remains |

This changes the residual from “ordinary parent loss can leave an observer with no child-owned response” to “ordinary parent loss or protocol abandonment has two independent child-owned triggers when the runtime can progress.” It makes no frequency claim.

```text
SELF_WATCHDOG_COMBINED_MODEL = MATERIAL_RESIDUAL_REDUCTION
```

## 9. Uninterruptible wait boundary

No child-internal watchdog can prove bounded termination when the child/process cannot execute the userspace code that detects loss or initiates exit. Even after a watchdog handler runs, an outstanding filesystem operation can remain physically active; voluntary exit intent is not physical cancellation. ADR-0065's separation of containment intent, exit, reap, stream closure, cleanup, and physical filesystem completion remains mandatory.

```text
SELF_WATCHDOG_PROVES_FULL_ADR_CONTAINMENT = NO
UNINTERRUPTIBLE_WAIT_RESIDUAL = UNRESOLVED
PHYSICAL_KERNEL_FILESYSTEM_CANCELLATION_PROVEN = NO
```

## 10. External supervision comparison

An external supervisor, second helper, or launchd service can remain runnable when the observer's JS event loop is stuck, independently detect parent/child state, and attempt external termination. That is stronger actuation independence than a child-only watchdog. It still cannot prove a maximum exit/reap latency for a process trapped in an uninterruptible kernel/filesystem wait, and it introduces another process, authority, identity, lifecycle, cleanup, and potentially daemon boundary. It also conflicts with the accepted one-child-per-record shape unless a new architecture decision changes ownership.

Therefore external supervision adds partial operational defense, not the missing full proof. This plan does not recommend or design it.

```text
EXTERNAL_SUPERVISION_ADDS_PROOF = PARTIAL_ONLY
NEW_SUPERVISION_AUTHORITY_RECOMMENDED = NO
```

## 11. Process groups

A dedicated process group can make explicit shutdown/signal targeting and descendant cleanup easier. The accepted observer has no descendant authority, and process groups do not notify a child that its parent died. Darwin reparenting and orphaned-process-group semantics do not supply the required parent-death lease.

```text
PROCESS_GROUP_PARENT_DEATH_SOLUTION = NO
```

## 12. Architecture decision

The selected option is:

```text
B. SELF_WATCHDOG_REDUCES_RESIDUAL_BUT_CA_ACCEPTANCE_REQUIRED
```

The reduction is material because a uniquely owned kernel pipe covers ordinary parent disappearance and the local deadline covers a live-but-non-driving parent, while asynchronous-only structure preserves event-loop responsiveness during the expected single libuv worker stall. It is not sufficient for the existing ADR because no child-internal mechanism proves bounded termination in the uninterruptible/non-runnable case.

ADR-0065 must not be edited in place or silently weakened. Repository history is append-only ADR-oriented, so acceptance should be a new ADR that references ADR-0065 and explicitly chooses one of:

1. accept the precisely bounded residual and define the watchdog as required defense-in-depth while retaining `UNCERTAIN_TERMINAL`; or
2. keep XR-FCI blocked pending a stronger containment authority.

The recommendation is a Chief Architect residual-risk decision, not automatic implementation approval.

```text
ADR_RELATION = NEW_ADR_REQUIRED_FOR_RESIDUAL_ACCEPTANCE
NEXT_ARCHITECTURE_DECISION = CA_ORPHAN_RESIDUAL_RISK_DECISION
```

## 13. Eventual XR-FCI requirements if accepted

Without implementing them here, an accepted watchdog design would require:

- a unique, non-inherited parent stdin writer and mechanical no-duplicate-FD proof;
- the exact child read endpoint as both bounded protocol channel and parent-liveness lease;
- a fixed child-local monotonic maximum lifetime armed before readiness;
- async-only `LSTAT`, `READLINK`, `REALPATH`, and `STAT`; no blocking JS/native extension path;
- one absorbing `WATCHDOG_FAILED` state entered by EOF or deadline;
- atomic invalidation of every provisional result before any shutdown action;
- no response/evidence finalization after parent-loss indication;
- no child retry, descendant, alternate channel, heartbeat, daemon, or network authority;
- late results discarded and no timer/event allowed to manufacture `CLEAN_TERMINAL`;
- exit/reap/stream-close/cleanup proofs still independently required when a parent exists to observe them;
- explicit `UNCERTAIN_TERMINAL` when lifecycle completion cannot be proven.

## 14. Fake-only validation plan

Future offline tests must use a scripted lifecycle and clock; they must not spawn, signal, call kqueue, or access live metadata.

Named cases:

1. parent pipe closes normally after clean close handshake;
2. parent disappears during idle;
3. parent disappears with one request outstanding;
4. parent disappears after provisional result but before finalization;
5. self-deadline expires while parent pipe remains open;
6. EOF and deadline race in both callback orders;
7. parent-death indication and result race in both callback orders;
8. watchdog triggers but exit/reap/stream-close/cleanup remain uncertain;
9. late result after watchdog is discarded;
10. simulated watchdog cannot progress: proof remains unavailable and state cannot become `CLEAN_TERMINAL`;
11. duplicate writer fixture prevents EOF and fails the FD invariant before readiness;
12. final timer fires without lifecycle proofs and cannot create terminal success;
13. heartbeat absence has no effect because heartbeat is not in the protocol;
14. getppid/kqueue events cannot independently authorize success;
15. all provisional observations are erased from eligible output on the first parent-loss/deadline indication.

## 15. Approval boundary and verdict

```text
STAGE_2B_SLICE_5C_EG_F0_XR_FCI_SW_PLAN = READY_FOR_INDEPENDENT_REVIEW
STDIN_EOF_PARENT_DEATH_DETECTION = RELIABLE_UNDER_FD_INVARIANT
CHILD_SELF_DEADLINE = PARTIAL_DEFENSE
KQUEUE_PARENT_DEATH_DETECTION = PARTIAL_ONLY
KQUEUE_NEW_AUTHORITY_REQUIRED = YES
HEARTBEAT_MODEL = REDUNDANT
SELF_WATCHDOG_COMBINED_MODEL = MATERIAL_RESIDUAL_REDUCTION
SELF_WATCHDOG_PROVES_FULL_ADR_CONTAINMENT = NO
EXTERNAL_SUPERVISION_ADDS_PROOF = PARTIAL_ONLY
PROCESS_GROUP_PARENT_DEATH_SOLUTION = NO
ORPHAN_DISPOSITION = REDUCED_RESIDUAL_REQUIRES_CA_ACCEPTANCE
NEXT_ARCHITECTURE_DECISION = CA_ORPHAN_RESIDUAL_RISK_DECISION
XR_FCI_IMPLEMENTATION_APPROVED = NO
PROCESS_EXECUTION_APPROVED = NO
SIGNAL_EXECUTION_APPROVED = NO
XR_ACTUAL_HOST_READ_APPROVED = NO
NETWORK_APPROVED = NO
LOCAL_DAEMON_CONTACT_APPROVED = NO
LOCAL_FILESYSTEM_PROVENANCE_PREFLIGHT = BLOCKED_FEASIBILITY_GAP
XR_AX_ELIGIBLE = NO
PUSH_APPROVED = NO
NEXT_ACTION = CLAUDE_INDEPENDENT_F0_XR_FCI_SW_PLAN_REVIEW
```
