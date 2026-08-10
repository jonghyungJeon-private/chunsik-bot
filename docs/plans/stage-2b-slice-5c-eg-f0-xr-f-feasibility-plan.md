# Stage 2B Slice 5C-EG-F0-XR-F Provenance and Cancellation Feasibility Plan

## 1. Status, Baseline, and Non-Authorization

- **Status:** plan-only; ready for independent Architecture and Safety Review.
- **Baseline:** `main` at `affdaa86ccbca0818ee74820b2ccb0f3b792f183`.
- **Accepted predecessors:** F0-XR, F0-XR-I, F0-XR-A with Chief Architect clarifications, F0-XR-AI, and F0-XR-AV.
- **Research method:** repository source inspection plus primary Node 22.22.1 and Apple documentation; no candidate API
  was invoked against the host.
- **Non-authorization:** no real adapter call, executable metadata read, `statfs`, mount inspection, native framework
  call, process, signal, worker, network/daemon contact, code-sign inspection, XR-AX, XG/XF/XA/E, or push.

The accepted offline adapter and fake validation remain unchanged. This plan does not infer a host fact from policy,
does not make quarantined I/O cancellable, and does not weaken either of these constraints:

```text
networkPolicy = NONE
localDaemonContact = NONE
```

## 2. Required Provenance Claim

Before the first approved-path metadata read, a future preflight would have to bind every configured executable path
and every possible traversal to one immutable provenance snapshot proving all of the following:

1. Darwin on arm64 and the approved Node major;
2. APFS, with the exact mount identity and mount point;
3. the applicable sealed System or paired Data volume role, including any firmlink crossing;
4. a locally attached physical backing chain;
5. no network mount, automount, FUSE, File Provider/cloud-provider, or other daemon-mediated filesystem;
6. no relevant mount replacement from preflight through both XR PRE and POST passes.

Apple documents the System/Data split and that writable locations such as `/usr/local`, `/private`, `/var`, and
`/tmp` are on the Data volume. That topology is a platform model, not proof of the current path or mount. See
[Role of Apple File System](https://support.apple.com/guide/security/role-of-apple-file-system-seca6147599e/web)
and [Signed system volume security](https://support.apple.com/guide/security/signed-system-volume-security-secd698747c9/web).

## 3. Filesystem Provenance Candidate Evaluation

| Candidate | Host API required | Process required | Daemon contact possible | Network contact possible | Mutation possible | Pre-read feasibility | TOCTOU residual | Approval boundary |
|---|---|---:|---|---|---:|---|---|---|
| Node `fsPromises.statfs(path)` | Node/libuv `statfs` on each path | no | filesystem-dependent; cannot prove none | path lookup may trigger automount/provider/network behavior | no intended mutation | **No**: it touches the path and Node exposes only bounded `StatFs` fields, not Darwin mount flags, mount source, volume role, or hardware chain | mount can change immediately after result | new host-filesystem capability plus XR-AX read approval |
| Native Darwin `statfs` / `getattrlist` on each path | libc/syscall | no if in-process native code | filesystem-dependent; cannot prove none | same path-resolution risk | no intended mutation | **Partial**: filesystem type, flags, mount point/source can be observed, including `MNT_LOCAL`; observation itself may cross the forbidden boundary | path-to-mount race and later replacement | reviewed native binding and separately approved host reads |
| `getmntinfo` / `getfsstat` mount snapshot | libc | no if in-process native code | not inherently required, but snapshot cannot attest daemon absence | no path traversal expected; still cannot prove future lookup has no contact | no intended mutation | **Partial**: bounded mount-table snapshot can reject non-APFS, non-local and automounted entries without touching executable paths | longest-prefix mapping misses namespace/firmlink semantics; snapshot can become stale | reviewed native binding and mount-table inspection capability |
| Disk Arbitration | Disk Arbitration framework/session | no child process | **Yes/unknown under required policy**; framework is an arbitration service boundary | no intended network, but returned disk facts do not constrain later filesystem access | read-only description intended | **Partial**: maps a mount to BSD media and exposes volume/device descriptors | asynchronous change and mount replacement remain | new native/framework and local-daemon capability; incompatible until explicitly accepted |
| IOKit Registry | IOKit user API | no child process | kernel/driver interaction; not a proof of no filesystem daemon | no intended network | read-only registry query intended | **Partial**: can trace an already identified block device to attachment properties; cannot alone map arbitrary namespace paths, firmlinks, FUSE, or provider mounts | registry and mount snapshots are not atomic with XR reads | new native/IOKit capability and independent review |
| Process-based `mount`, `diskutil`, `df`, `ioreg`, or similar | executable plus underlying APIs | **yes** | tool-dependent and possibly yes | tool/path-dependent and possibly yes | command intended read-only but authority is broad | **No under current approval**: parsing CLI output adds executable identity, environment, output and termination gates without stronger atomic proof | subprocess output is immediately stale | new process/daemon/host-inspection Strict capability |
| Predeclared path/mount allowlist only | none | no | none | none | no | **No**: policy is not observation | cannot detect replacement or provider state | insufficient; no approval can convert assertion to observation |

Node 22.22.1 documents that promise filesystem operations use the libuv threadpool and that `statfs` returns a
`StatFs` projection. It does not expose Darwin `f_flags`, `f_mntonname`, or `f_mntfromname` through that object:
[Node.js 22.22.1 filesystem API](https://nodejs.org/download/release/v22.22.1/docs/api/fs.html).
Apple identifies `MNT_LOCAL` as the BSD-layer network-volume discriminator, while `statfs` and `getmntinfo` return
current filesystem/mount snapshots: [Testing for a Network Volume](https://developer.apple.com/library/archive/qa/nw09/_index.html),
[statfs(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/statfs.2.html),
and [getmntinfo(3)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/getmntinfo.3.html).
Disk Arbitration can map volume paths to BSD media and description dictionaries, while IOKit supplies deeper media
properties; neither source specifies an atomic path/mount/hardware attestation across later reads:
[Apple Disk Arbitration guide](https://developer.apple.com/library/archive/documentation/DriversKernelHardware/Conceptual/DiskArbitrationProgGuide/ManipulatingDisks/ManipulatingDisks.html).

### 3.1 Provenance conclusion

No evaluated mechanism proves the complete required claim while retaining both `networkPolicy=NONE` and
`localDaemonContact=NONE`. A future bounded native preflight could improve rejection by combining a mount snapshot,
Darwin flags, APFS allowlisting, mount-source identity, and IOKit attachment evidence. It still needs an independently
reviewed answer for firmlink namespace binding, File Provider/FUSE/daemon exclusion, and mount replacement across XR
PRE/POST. Until such an answer exists, partial observations must fail closed rather than be called provenance proof.

```text
FILESYSTEM_PROVENANCE_FEASIBILITY = BLOCKED_FEASIBILITY_GAP
```

## 4. Exact Bounded Cancellation Requirement

For every `lstat`, `readlink`, `realpath`, and `stat`, the accepted claim would require all of the following by the
deadline: no underlying filesystem work remains, no late result or host effect is possible, cleanup has completed,
and the next token can be issued or a terminal record can be finalized. Deadline detection alone is insufficient.

| Option | Physical cancellation guarantee | Outstanding-operation proof | Deadline bound | Cleanup bound | New authority required | Process/signal required | Failure semantics | Feasibility |
|---|---|---|---|---|---|---:|---|---|
| Direct Node `fs/promises` | none documented for these four calls | promise settlement only; timeout does not prove libuv/kernel completion | logical wait bound only | none for an outstanding request | none beyond accepted adapter | no | quarantine, revoke, no success evidence | blocked |
| `Promise.race` / current deadline controller | none | explicitly retains an unknown outstanding operation | logical wait bound only | none | none | no | `OUTSTANDING_IO_QUARANTINED`; POST and finalization prohibited | blocked |
| Worker thread isolation | `worker.terminate()` stops worker JS as soon as possible, not a documented cancellation contract for libuv/kernel filesystem I/O | worker exit does not establish that the underlying request was physically cancelled within the target | no accepted physical-I/O bound | no accepted kernel-I/O cleanup bound | worker construction/termination and module authority | worker termination | terminate worker, revoke record, reject evidence | blocked |
| Child process per record/sequence | `SIGTERM` is cooperative; `SIGKILL` terminates the process but no reviewed source supplies a maximum time for an outstanding filesystem syscall/request to reach complete cleanup | child exit/reap is stronger containment, but not proof of a fixed physical cancellation deadline for blocked kernel/filesystem work | escalation timers can bound signal dispatch, not proven process exit | no documented maximum cleanup/reap bound for this workload | spawn, exact child identity/env/IPC, signal, reap and output limits | **yes** | TERM then KILL, fail closed on late/no exit; never finalize success | unresolved, therefore blocked |
| Permanently quarantined residual operation | no | proof is deliberately absent | caller returns by deadline | potentially unbounded | none | no | revoke forever and suppress late result | **not acceptable** for XR-AX without explicit CA residual-risk acceptance |

The Node filesystem documentation states that promise operations use the underlying threadpool but gives these four
APIs no `AbortSignal` cancellation contract. Worker termination is documented as stopping worker execution as soon as
possible, not as cancelling kernel/libuv I/O: [Node worker threads](https://nodejs.org/download/release/v22.22.1/docs/api/worker_threads.html).
Node also warns that `subprocess.kill()` sends a signal that may not actually terminate a process, and Node processes
handle `SIGTERM` before re-raising it: [Node child processes](https://nodejs.org/download/release/v22.22.1/docs/api/child_process.html).
The stronger Darwin property of uncatchable `SIGKILL` is still not, without a reviewed bounded-exit proof, an exact
cleanup deadline for arbitrary filesystem/provider behavior. This last statement is an inference from the absence of
such a guarantee in the reviewed contracts, not a claim that isolation has no containment value.

### 4.1 Cancellation conclusion

The current adapter correctly detects a deadline and quarantines authority, but it cannot meet physical cancellation.
Worker isolation does not close the proof. Child-process isolation is the strongest candidate and deserves a narrow
future proof review, but it introduces process/signal authority and currently lacks a defensible maximum termination
and cleanup bound. Quarantine alone is not accepted merely to make evidence finalizable.

```text
CANCELLATION_FEASIBILITY = BLOCKED_FEASIBILITY_GAP
```

## 5. Exact XR-AX Eligibility Prerequisites

`XR_AX_ELIGIBLE` may become `YES` only after all conditions below are independently accepted and implemented where
applicable:

1. provenance preflight produces a bounded, immutable, exact-path-to-mount evidence binding and closes every claim
   in Section 2 before adapter construction;
2. cancellation provides a reviewed physical bound, or the Chief Architect explicitly accepts a precisely bounded
   residual-risk model and changes the architecture decision before execution;
3. real async orchestration routes every call through the single `XR_LIMITS` / `XrReadAccounting` authority before
   token issuance and passes offline/static/fake validation;
4. the exact four executable paths, operations, PRE/POST order, call/byte/evidence caps, Node/platform profile,
   deadlines, environment, failure taxonomy, and output target are frozen in an XR-AX-P plan;
5. pre-validation covers platform, provenance, mount identity, adapter source/binding, zero outstanding work, and
   unchanged approved baseline before the first executable-path call;
6. post-validation repeats the complete path and provenance binding, rejects mount or metadata drift, proves zero
   outstanding work, and emits no success evidence on uncertainty;
7. a separate Strict approval authorizes exactly one bounded real metadata-read execution.

Even after these prerequisites, metadata remains execution-ineligible until the separate code-sign and downstream
TOCTOU gates close:

```text
XR_METADATA_EVIDENCE_EXECUTION_ELIGIBLE = NO
CODE_SIGN_GATE = BLOCKS_XG_XF_XA_E
CANONICAL_DIGEST_FREEZE_APPROVED = NO
```

## 6. Smallest Future Approval Split

Use four approval boundaries grouped into three planning tracks. Provenance and cancellation cannot be safely
combined because they require different authorities and independent conclusions; `XR-AX-P` and `XR-AX` remain two
distinct approvals even though they share one row below.

| Slice | Scope | Stop condition / explicitly excluded |
|---|---|---|
| `XR-FP` | plan and, only after review, offline/native provenance probe implementation behind injected fakes; separately approve any live mount/IOKit inspection | no executable-path metadata read, no Disk Arbitration unless local-daemon policy is explicitly reconsidered |
| `XR-FC` | child-process cancellation proof plan first; only a later approval may implement fake lifecycle validation or a disposable non-filesystem termination probe | no host filesystem work, no assumption that signal dispatch proves cleanup, no residual-risk acceptance by implementation |
| `XR-AX-P` then `XR-AX` gate | one plan freezes the exact bounded actual-read scope; one subsequent Strict approval authorizes one execution | no code-sign, digest freeze, XG/XF/XA/E, Runtime, Discord, DB, or inherited approval |

`XR-FP` or `XR-FC` must stop at `BLOCKED_FEASIBILITY_GAP` if its required proof remains unavailable. If the Chief
Architect elects to relax `localDaemonContact=NONE` or accept cancellation residual risk, that is an architecture and
approval-model change requiring an ADR before implementation or execution; this plan does not recommend or enact it.

## 7. Decision

The feasibility analysis is complete enough for independent review, but it deliberately does not claim either gap is
resolved. The existing adapter remains unwired and unconstructed for production use.

```text
STAGE_2B_SLICE_5C_EG_F0_XR_F_PLAN = READY_FOR_INDEPENDENT_REVIEW
FILESYSTEM_PROVENANCE_FEASIBILITY = BLOCKED_FEASIBILITY_GAP
CANCELLATION_FEASIBILITY = BLOCKED_FEASIBILITY_GAP
XR_AX_ELIGIBLE = NO
XR_ACTUAL_HOST_READ_APPROVED = NO
XR_METADATA_EVIDENCE_EXECUTION_ELIGIBLE = NO
CODE_SIGN_GATE = BLOCKS_XG_XF_XA_E
CANONICAL_DIGEST_FREEZE_APPROVED = NO
PUSH_APPROVED = NO
PROCESS_EXECUTION_APPROVED = NO
SIGNAL_EXECUTION_APPROVED = NO
NETWORK_APPROVED = NO
LOCAL_DAEMON_CONTACT_APPROVED = NO
CODE_SIGN_READ_APPROVED = NO
NEXT_ACTION = CLAUDE_INDEPENDENT_F0_XR_F_PLAN_REVIEW
```
