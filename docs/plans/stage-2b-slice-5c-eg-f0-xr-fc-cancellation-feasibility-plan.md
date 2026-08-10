# Stage 2B Slice 5C-EG-F0-XR-FC Process-Isolated Cancellation Feasibility Plan

## 1. Status, Baseline, and Non-Authorization

- **Status:** architecture/feasibility only; ready for independent Architecture and Safety Review.
- **Baseline:** `main` at `f84107cf4d9ae36ffb6c796e0d0e9195bb2f1447`.
- **Accepted predecessors:** F0-XR through F0-XR-AV, and F0-XR-F accepted with carryover.
- **Inspection performed:** repository source/contracts/tests and primary Node 22.22.1, libuv, and Darwin process
  documentation only.
- **Non-authorization:** no filesystem metadata read, process spawn/termination, signal, worker, XR-AX, network,
  daemon, code-sign, Runtime, provider, database, or push action.

This plan separates six facts that must never be collapsed:

```text
JS/request completion != process termination
process termination != process reap
process reap != proof of when each descriptor was cleaned
descriptor cleanup != libuv request cancellation
libuv/threadpool reclamation != kernel I/O physical cancellation
no accepted child evidence != proof that no late kernel-side activity occurred
```

## 2. Existing Process Architecture Findings

The repository has capability-specific process adapters rather than one global process implementation:

| Boundary | Current ownership and dependency | Lifecycle and containment | Why it cannot directly own XR |
|---|---|---|---|
| CAP-007 `CommandExecution` | Core manager/port → `@chunsik/command-local`; the adapter is the sole spawn owner for CAP-007 | `spawnSync`, argv array, `shell:false`, workspace cwd, required timeout, minimal default `PATH/HOME`, 100k-char per-stream cap and secret masking; terminal aggregate is persisted | permits only `pnpm`/`npm`/`node`, models one workspace command, has no typed bidirectional protocol, staged TERM/KILL/reap evidence, descriptor contract, or XR failure taxonomy; argv/hash persistence would expose exact host paths |
| Ollama preflight containment | app-private caller → `ContainedOllamaPreflightProcessRunner`; Core and Runtime do not import it | exact Ollama argv, absolute executable, runner-owned HOME/TMPDIR, isolated env, piped stdio, bounded bytes/hashes, TERM then KILL, final-settlement timer, sandbox cleanup | policy and result are Ollama/loopback specific; final settlement may mark containment failure without proving child reap; accepted review explicitly leaves process-tree containment unresolved |
| Git and AI CLI adapters | their own adapter packages | provider-specific argv, timeout/output handling | capability-specific authority; not a general containment owner and unrelated to XR |

The current **sole process-spawn owner for CAP-007 is `@chunsik/command-local`**, but the repository does not have a
global spawn owner suitable for every capability. Reusing CAP-007 would broaden its accepted aggregate and allowlist,
mix a private security preflight with user-facing execution history, and force platform/process semantics through a
Core command port. Reusing the Ollama runner would broaden an exact provider-specific policy into a generic host
reader. Either move would be an architecture change disguised as reuse.

The future owner must therefore be a private XR strict capability at the app/tool boundary, depending inward on the
existing private XR contracts and on one injected spawn/lifecycle adapter. It must not enter Core, Runtime, CAP-007,
`@chunsik/command-local`, or the Ollama runner. Its implementation requires an ADR/Architecture Review because it
introduces a new narrowly scoped spawn owner. Shared low-level lifecycle code may be extracted later only if its API
contains no Ollama, workspace-command, filesystem-path, or XR policy.

```text
XR_PROCESS_ISOLATION_OWNER = NEW_STRICT_CAPABILITY_REQUIRED
```

## 3. Candidate Process Lifetimes

| Shape | Startup overhead | Deadline containment | State/token/accounting | PRE/POST integrity | Kill/cleanup and blast radius | Evidence boundary | Decision |
|---|---|---|---|---|---|---|---|
| One process per primitive | up to 52 spawns per XR set; highest churn | best per-call isolation | parent can consume one token/accounting call before each spawn; no child state | parent must reconstruct all ordering; process identity and protocol repeated for every call | one hung call per child, but repeated startup/cleanup multiplies failure surface | one tiny result per child; aggregation entirely parent-side | reject: disproportionate churn and more lifecycle transitions than observations |
| One process per executable XR record | four bounded children; moderate | record deadline plus per-request deadlines inside one child | parent retains token issuance, `XR_LIMITS`, and `XrReadAccounting`; child holds only current record and one outstanding request | one process performs that record's complete PRE then POST under parent-issued sequential authority | a hung record loses only one executable observation; kill/reap discards whole record and releases that child's process-level pool | no record evidence becomes eligible until valid result, normal/accepted exit, reap, cleanup, and parent validation | **preferred conditional design** |
| One process for all four records/full observation | one startup; lowest | one failure consumes the whole run budget | more state and every path reside in one child; parent protocol is longer | easiest shared sequencing but largest child authority | one hang/crash destroys all records and concentrates all filesystem/threadpool risk | largest output/protocol transcript and blast radius | reject: containment unit is too broad |

“One record” means one approved executable identity and its complete fresh PRE/POST sequence. It does not mean an
arbitrary caller-defined path set. There is no retry or replacement child in this Slice.

## 4. Future Lifecycle and Exact Proven/Unproven Claims

The conditional lifecycle is:

```text
validate exact observer identity and fixed invocation
→ create isolated record child with closed descriptors/environment/cwd
→ parent issues one bounded operation request at a time
→ child returns at most one result for that request
→ parent validates and accounts before issuing the next request
→ normal completion: close request channel → wait for exit → wait for close/reap evidence
→ deadline/protocol/cap failure: revoke record → close input → SIGTERM
→ bounded grace expiry: SIGKILL
→ bounded wait for terminal exit and reap
→ cleanup sandbox/protocol resources
→ discard the entire record unless every terminal condition is proven
```

`SIGTERM` delivery, `SIGKILL` delivery, exit observation, stream close, reap, and cleanup are separate states. A
boolean return from `child.kill()` proves at most signal-delivery acceptance, never target termination. The parent
must not settle merely because a final timer fired. It may settle only into either:

- `CLEAN_TERMINAL`: child exit status observed, child reaped, streams closed, cleanup complete, no pending request,
  and the validated record is internally complete; or
- `UNCERTAIN_TERMINAL`: any proof missing; all observation and downstream eligibility discarded, with no retry.

Darwin `waitpid` reports status for a terminated child and reaps it. This can prove the process terminal/reap state,
not a maximum time by which termination must occur: [Apple wait(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/wait.2.html).
Darwin `kill` sends a signal; successful return is not a wait/reap result:
[Apple kill(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kill.2.html).
Node likewise distinguishes `exit` from `close` and warns that `subprocess.kill()` sends a signal that may not
actually terminate the process: [Node.js 22.22.1 child processes](https://nodejs.org/download/release/v22.22.1/docs/api/child_process.html).

```text
PROCESS_TERMINAL_STATE_AFTER_OBSERVED_EXIT_AND_REAP = PROVABLE
UNDERLYING_KERNEL_FILESYSTEM_OPERATION_CANCELLATION = UNPROVEN
```

## 5. Descriptor, CWD, Environment, and Inherited-State Contract

The observer must be spawned directly by absolute, identity-validated path with `shell:false`, no PATH lookup,
detached mode disabled, and no descendant creation authority in its reviewed source.

| Surface | Required contract |
|---|---|
| stdin | one bounded length-prefixed or newline-framed request channel; parent closes it on terminal transition; no interactive input |
| stdout | sole bounded result channel; binary/UTF-8 framing fixed by protocol; byte cap enforced incrementally before accumulation |
| stderr | closed or independently byte-capped diagnostic channel; never evidence, never persisted raw, any non-empty value fails closed unless the protocol fixes an exact empty policy |
| IPC | none; do not add Node IPC serialization or an extra descriptor when bounded stdio framing suffices |
| extra descriptors | none; exactly `['pipe','pipe','pipe']`, no inherited fd, terminal, socket, server, or handle |
| cwd | fresh runner-owned empty temporary directory, not repository, home, `/`, executable directory, or approved-path parent |
| environment | exact frozen allowlist for locale/no-color only; no inherited `PATH`, `HOME`, `TMPDIR`, proxy, token, `NODE_OPTIONS`, loader, network, provider, or runtime variables |
| process state | fixed uid/gid inheritance only if independently accepted; no detached group, shell, hook, profile, rc file, preload, signal handler contract, or child-of-child |

This is stricter than CAP-007's minimal `PATH/HOME` default and aligns structurally with the Ollama runner's exact env,
bounded pipes, `shell:false`, and runner-owned sandbox. Cleanup failure is terminal and evidence-ineligible. Cleanup
itself must be idempotent, exact-root scoped, and separately proven; it cannot use a broad unresolved path or delete
outside the runner-owned directory.

## 6. Libuv Threadpool and Cumulative Exhaustion

Node 22 promise filesystem operations use the libuv threadpool. Libuv documents that its threadpool is global and
shared across event loops, and `uv_cancel()` cancels only a request that has not started; cancellation fails once the
work is executing: [libuv threadpool](https://docs.libuv.org/en/v1.x/threadpool.html) and
[libuv request cancellation](https://docs.libuv.org/en/v1.x/request.html).

| Model | Repeated-hang behavior | Resource conclusion |
|---|---|---|
| Direct adapter quarantine | every timed-out request remains in the application process pool until it returns; later attempts can cumulatively consume the same pool | unacceptable; authority revocation does not contain process resources |
| Worker-thread quarantine | workers share process-level/native resources; termination does not document cancellation of an executing `uv_fs_t` request | unacceptable; does not establish pool reclamation and can accumulate in the parent process |
| Child-process isolation | each observer has its own process-level libuv pool and descriptors; after **observed exit and reap**, no child userspace/threadpool/evidence channel survives | meaningfully bounds the parent-process exhaustion blast radius, but does not prove when an in-progress kernel/provider operation physically stopped |

No new record may begin while a previous child is not proven reaped. Reap timeout yields `UNCERTAIN_TERMINAL` and
halts the entire XR attempt; it never spawns a replacement. This prevents repeated hung children from accumulating
under one approved attempt, while still avoiding a false physical-cancellation claim.

## 7. Parent Authority and Child Protocol

### 7.1 Authority placement

The parent remains the sole owner of:

- the module-issued resolved XR contract and four fixed executable records;
- `XR_LIMITS` and the single `XrReadAccounting` instance;
- `ApprovedPathToken` brand, binding store, issuance, consumption, and single-use state;
- PRE/POST order, path/hop/call/link/evidence caps, consistency comparison, and final evidence eligibility.

Immediately before each request, the parent validates and consumes the exact token, advances shared accounting, and
sends only `{protocolVersion, recordNonce, sequence, pass, operation, exactPath}`. The observer owns no policy,
token constructor, token representation, alternate path, retry, traversal decision, or evidence builder. Its reviewed
binary accepts one record nonce at startup, the four-operation enum only, monotonically increasing sequence, and one
request outstanding. The child is still technically capable of calling its fixed primitives on a received path;
containment therefore relies on the parent-only fixed allowlist, exact observer identity, closed source/import guard,
and the absence of any generic command or caller-selected protocol.

### 7.2 Bounded protocol

- one child handles exactly one record and at most the parent-derived call maximum;
- request and response each have a fixed protocol version, closed keys, integer sequence and maximum encoded bytes;
- exact paths are transferred only inside the private pipe, never argv/env/log/history;
- output is one normalized result or one closed child error for the outstanding sequence; raw `Stats`, errno message,
  stack, descriptor, host path echo, or native handle is forbidden;
- unknown keys/messages, malformed framing/UTF-8, wrong nonce/sequence/pass/operation, duplicate or unsolicited
  results, multiple frames, cap excess, child exit before result, result without later clean exit/reap, late result,
  or trailing bytes revoke and discard the entire record;
- result-before-exit is provisional only. Parent validation does not finalize until the normal terminal handshake,
  stream close, exit, reap, sandbox cleanup, and POST consistency all succeed;
- child crash, deadline, signal failure, reap failure, or cleanup failure has no retry/fallback/escalation.

No shell string, arbitrary executable, arbitrary argv, generic command protocol, directory enumeration, or code-sign
operation is admitted.

## 8. Closed Failure Model

The future private boundary should use a closed XR-FC reason set and map every raw host/process error without message,
stack, errno payload, PID, path, signal detail, or partial result:

| Condition | Closed reason | Terminal rule |
|---|---|---|
| spawn throws/emits error or identity changes | `XR_OBSERVER_SPAWN_FAILED` | zero eligible observation; cleanup required |
| request/result framing, nonce, sequence, enum, duplicate, late or unknown message | `XR_OBSERVER_PROTOCOL_INVALID` | revoke, terminate, reap, discard record |
| operation or record deadline | `XR_OBSERVER_DEADLINE_EXCEEDED` | revoke, TERM→KILL→reap; never treat as cancellation proof |
| SIGTERM send throws/returns false or grace expires | `XR_OBSERVER_TERMINATION_FAILED` | attempt approved KILL path; record remains ineligible |
| SIGKILL send throws/returns false | `XR_OBSERVER_FORCE_KILL_FAILED` | uncertain terminal; halt all XR |
| no proven reap by its bound | `XR_OBSERVER_REAP_TIMEOUT` | uncertain terminal; halt all XR; no replacement child |
| unexpected code/signal/exit-before-result/result-before-required handshake | `XR_OBSERVER_UNEXPECTED_EXIT` | discard record |
| either stream exceeds cap or forbidden stderr appears | `XR_OBSERVER_OUTPUT_LIMIT_EXCEEDED` | terminate/reap; discard all bytes |
| normalized child output is malformed or contains extra fields | `XR_OBSERVER_OUTPUT_INVALID` | terminate/reap; discard record |
| fd/stream close, sandbox removal, timer/listener, or other cleanup proof missing | `XR_OBSERVER_CLEANUP_INCOMPLETE` | uncertain terminal and execution-ineligible |

Precedence must be deterministic: protocol/output safety facts observed before a deadline remain monotonic; termination,
reap, and cleanup failures override any provisional success. Raw output is never retained. There is exactly one
terminal record and zero retry.

## 9. Residual-Risk Decision

A killed-and-reaped child provides materially stronger containment than direct or worker quarantine:

- the observer address space and independent libuv pool no longer survive;
- inherited descriptors are closed with the process and the parent closes all pipe endpoints;
- no late child message can enter evidence after the channels are closed;
- the parent has consumed/revoked token authority and emits no partial record;
- one unreaped child blocks the complete XR attempt, preventing cumulative spawn exhaustion.

It still does **not** prove:

- that a filesystem/provider/kernel operation was physically cancelled at the logical deadline;
- a universal maximum from SIGKILL request to process termination/reap on the approved filesystem stack;
- that a provider, automount, network, or daemon side effect initiated before kill cannot finish later;
- that kernel/driver state performed no work after the child stopped producing evidence.

Therefore outcome C is not supported. Outcome A remains the default architecture rule. Outcome B is technically
coherent only if the Chief Architect explicitly changes the accepted requirement from “physical cancellation” to
“bounded authority and userspace resource containment after proven kill/reap,” and accepts the four residuals above.
That acceptance must be an ADR and cannot be inferred from implementation, tests, or inability to gather evidence.

```text
CHILD_PROCESS_ISOLATION_FEASIBILITY = REQUIRES_EXPLICIT_CA_RISK_ACCEPTANCE
EXACT_BOUNDED_FILESYSTEM_CANCELLATION = CONDITIONALLY_RESOLVABLE
```

“Conditionally resolvable” means only that an accepted architecture may substitute the precisely stated containment
invariant. Until that ADR and a separately approved implementation/fake validation complete, the operational blocker
remains effective and no actual read is eligible.

## 10. Provenance and Downstream Gates

This Slice neither evaluates nor solves filesystem provenance. Process isolation cannot prove APFS/local attachment,
firmlink/mount identity, provider/daemon absence, or mount stability.

```text
LOCAL_FILESYSTEM_PROVENANCE_PREFLIGHT = BLOCKED_FEASIBILITY_GAP
XR_AX_ELIGIBLE = NO
XR_ACTUAL_HOST_READ_APPROVED = NO
XR_METADATA_EVIDENCE_EXECUTION_ELIGIBLE = NO
CODE_SIGN_GATE = BLOCKS_XG_XF_XA_E
CANONICAL_DIGEST_FREEZE_APPROVED = NO
```

## 11. Future Approval Boundaries

1. **CA decision/ADR:** accept or reject the bounded-containment substitution and the new private XR spawn owner.
2. **XR-FCI:** implement only the observer protocol, parent lifecycle, injected spawn/timer/sandbox seams, and
   deterministic fake validation; no real process or filesystem read.
3. **XR-FCV:** independent static/fake review of descriptor/env/protocol/caps/TERM-KILL-reap/cleanup/failure paths.
4. **XR-AX-P:** only after provenance also closes, freeze one exact actual-read execution plan.
5. **XR-AX:** separately approve one real observer process and metadata-read execution.

No approval inherits to network, daemon, code-sign, digest freeze, XG/XF/XA/E, Runtime, provider, or database work.

## 12. Decision

```text
STAGE_2B_SLICE_5C_EG_F0_XR_FC_PLAN = READY_FOR_INDEPENDENT_REVIEW
XR_PROCESS_ISOLATION_OWNER = NEW_STRICT_CAPABILITY_REQUIRED
CHILD_PROCESS_ISOLATION_FEASIBILITY = REQUIRES_EXPLICIT_CA_RISK_ACCEPTANCE
EXACT_BOUNDED_FILESYSTEM_CANCELLATION = CONDITIONALLY_RESOLVABLE
LOCAL_FILESYSTEM_PROVENANCE_PREFLIGHT = BLOCKED_FEASIBILITY_GAP
XR_AX_ELIGIBLE = NO
PROCESS_EXECUTION_APPROVED = NO
SIGNAL_EXECUTION_APPROVED = NO
NETWORK_APPROVED = NO
LOCAL_DAEMON_CONTACT_APPROVED = NO
CODE_SIGN_READ_APPROVED = NO
XR_ACTUAL_HOST_READ_APPROVED = NO
XR_METADATA_EVIDENCE_EXECUTION_ELIGIBLE = NO
CODE_SIGN_GATE = BLOCKS_XG_XF_XA_E
CANONICAL_DIGEST_FREEZE_APPROVED = NO
PUSH_APPROVED = NO
NEXT_ACTION = CLAUDE_INDEPENDENT_F0_XR_FC_PLAN_REVIEW
```
