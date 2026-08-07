# Stage 2B Slice 5C-EG-F0-XR-A Real Filesystem Adapter Architecture and Safety Plan

## 1. Status, Authority, and Non-Authorization

- **Status:** plan-only; ready for independent Architecture and Safety Review.
- **Baseline:** `main` at `44987dc11a631c18677e3566f37e9dc6e538ec60`; accepted XR-I focused tests
  `144/144`, including XR-I `34/34`, on Node `v22.22.1`.
- **Objective:** specify a future concrete adapter for the accepted private `ExactHostReadPort` without implementing
  or invoking it.
- **Non-authorization:** no filesystem import, host read, executable inspection, code-sign inspection, `.git` read,
  process, signal, network/daemon contact, mutation, digest freeze, XG/XF/XA/E, or push is approved here.

```text
XR_REAL_FILESYSTEM_ADAPTER = NOT_IMPLEMENTED
XR_HOST_READ_EXECUTION = NOT_PERFORMED
XR_METADATA_EVIDENCE_EXECUTION_ELIGIBLE = NO
CODE_SIGN_GATE = BLOCKS_XG_XF_XA_E
TOCTOU_LIVE_EXECUTION_GATE = BLOCKED_FEASIBILITY_GAP_FOR_LIVE_EXECUTION
```

## 2. Target Platform Boundary

The sole candidate target is the current development platform profile:

```text
OS = macOS / Darwin
architecture = arm64
runtime = Node.js 22
candidate local filesystem = APFS on a locally attached volume
fallback platform = NONE
```

This profile is an approval constraint, not a fact freshly observed by this plan. XR-AI must fail closed unless a
separately approved preflight proves the exact OS, architecture, Node major version, and acceptable mount/filesystem
class. It must not fall back to x64, Linux, another filesystem, or weakened metadata semantics.

On the candidate Darwin/APFS profile, numeric `dev` and `ino` can correlate an entry within a reviewed filesystem
snapshot but are not globally portable identity and do not prevent inode reuse or mount replacement. Numeric `uid`
and `gid` are expected but must be present and safely representable. `mode` supplies POSIX permission/type bits;
file type must be derived through the Node `Stats` predicates rather than guessed from a pathname. Darwin symlinks
may be absolute or relative; `readlink` returns the stored target and `realpath` returns a canonicalized target path.
Neither result proves that the backing volume is local or non-daemon-mediated.

## 3. Candidate Adapter Shape and API Selection

`RealExactHostReadPort` would implement exactly the existing four methods. It would accept only a branded,
single-use `ApprovedPathToken`; it would expose no raw path, generic operation, options object, byte cap, directory
operation, or mutation method.

| Adapter method | Candidate Node 22 API | Binding checked before call | Options | Closed projection |
|---|---|---|---|---|
| `lstatExact` | `node:fs/promises.lstat(exactPath, { bigint: true })` | read ID, context, pass, `LSTAT`, path, call index | `bigint: true` only | closed metadata, observing the link itself |
| `readlinkExact` | `node:fs/promises.readlink(exactPath, { encoding: 'utf8' })` | same, operation `READLINK` | UTF-8 string only | normalized bounded target string |
| `realpathExact` | `node:fs/promises.realpath(exactPath, { encoding: 'utf8' })` | same, operation `REALPATH` | UTF-8 string only | normalized absolute path |
| `statExact` | `node:fs/promises.stat(exactPath, { bigint: true })` | same, operation `STAT` | `bigint: true` only | closed final-target metadata |

The implementation must not select `readFile`, `open`, `readdir`, `opendir`, `glob`, `watch`, `chmod`, `chown`,
`utimes`, `link`, `symlink`, `rename`, or `writeFile`. It performs one host call per consumed token, no retry, no
alternate path, and no broader inspection. These calls are intended to be metadata-only and non-mutating, but may
trigger mount, automount, FUSE, or filesystem-provider behavior outside the Node process; that risk is addressed in
Section 6.

## 4. Token Authority Continuity

The authority verifier must be shared with XR-I as a private module capability, not reimplemented by the adapter.
The module may export a consumer interface or factory to the private adapter module while keeping token issuance,
the runtime brand, binding `WeakMap`, and consumed-token set inaccessible. It must never export token construction.

The shared consumer atomically:

1. verifies runtime brand and complete binding;
2. burns the token before any host call;
3. returns the exact approved path only to the selected internal operation;
4. records that one call is outstanding;
5. permits exactly one terminal success or normalized failure.

Success and failure both consume the token. Wrong read ID, context, pass, operation, path, or call index fails before
filesystem access. A token cannot be logged, serialized, cloned, substituted, reconstructed from caller data, reused,
or retried. A token issued for PRE `LSTAT` can never authorize POST or `REALPATH`.

## 5. Deadline and Cancellation Feasibility

The desired policy is both:

```text
per primitive call = 1000 ms
per executable read record = 10000 ms
owner = XR engine monotonic deadline controller
```

The primitive deadline starts immediately before token consumption; the record deadline starts before its first PRE
call. A completed call cancels its timer before the next token is issued. A timeout burns current authority, prevents
new calls, maps to `XR_READ_TIMEOUT`, and requires the outstanding-call count to return to zero before evidence can
be finalized. Late results are discarded and can neither update observations nor authorize POST.

However, the selected Node 22 Promise APIs do not provide an accepted `AbortSignal` contract that guarantees
cancellation of an in-flight filesystem request. `Promise.race` only stops waiting; it does not prove that the host
operation stopped. Finalizing while such an operation remains outstanding would violate boundedness and allow a late
host effect after terminal evidence.

```text
EXACT_BOUNDED_FILESYSTEM_CANCELLATION = BLOCKED_FEASIBILITY_GAP
PROMISE_RACE_ONLY = REJECTED
XR_READ_TIMEOUT = RESERVED_FOR_FUTURE_REAL_FILESYSTEM_ADAPTER
```

XR-AI must not begin until an independent review accepts either a genuinely cancellable mechanism, an isolated
worker/process lifecycle under separately approved process authority, or an explicitly bounded residual-risk policy.
This plan approves none of those alternatives.

## 6. Network Filesystem, FUSE, Automount, and Daemon Risk

An absolute path does not prove local storage. `lstat`, `readlink`, `realpath`, or `stat` may indirectly activate an
automount, contact a network-mounted filesystem, cross a FUSE/provider boundary, or involve a local cloud filesystem
daemon. The required policies remain `networkPolicy=NONE` and `localDaemonContact=NONE`.

Before the first approved-path operation, a separately approved mechanism must attest that every configured path and
every traversed mount belongs to an allowlisted locally attached APFS volume and does not cross a mount boundary,
FUSE provider, automount, network filesystem, or cloud-synchronization provider. The four selected APIs alone cannot
establish all those facts without first touching the path. Mount-table/process inspection, `statfs`, IOKit, Disk
Arbitration, or broader directory/filesystem inspection is not approved here.

```text
LOCAL_FILESYSTEM_PROVENANCE_PREFLIGHT = BLOCKED_FEASIBILITY_GAP
SILENT_LOCALITY_ASSUMPTION = PROHIBITED
```

Failure to prove locality stops before adapter construction and before any approved executable-path read.

## 7. Closed Error Normalization

The adapter catches only at its private boundary and emits a reason, never a raw error object, message, stack, errno
payload, or unapproved path. It does not retry, repair, elevate privilege, enumerate parents, or try another path.

| Platform condition | XR failure |
|---|---|
| `ENOENT`, dangling target | `XR_FILE_MISSING` |
| `EACCES`, `EPERM` | `XR_PERMISSION_DENIED` |
| `ELOOP` | `XR_SYMLINK_CYCLE` |
| `ENOTDIR`, `EINVAL`, NUL | `XR_LINK_TARGET_INVALID` |
| `ENAMETOOLONG` | `XR_READ_BYTE_CAP_EXCEEDED` |
| `ESTALE` | `XR_BASELINE_CHANGED` |
| `ETIMEDOUT` or accepted deadline terminal | `XR_READ_TIMEOUT` |
| unsupported/missing metadata or unsafe conversion | `XR_UNSUPPORTED_FILESYSTEM_IDENTITY` |
| `EIO` and every unknown error | `COMMAND_SAFETY_BLOCKED` |

Token authority failures retain `XR_PATH_TOKEN_FORGED`, `XR_PATH_TOKEN_CONSUMED`, or
`XR_PATH_TOKEN_BINDING_MISMATCH` and occur before host access. Evidence contains only bounded counts and the closed
reason; it contains no partial observation.

## 8. Metadata and Path Normalization

- Request bigint metadata. Convert `dev`, `ino`, `uid`, `gid`, `mode`, `size`, and the selected mtime representation
  only after checking non-negativity and safe bounded conversion. Overflow or absent required values fails with
  `XR_UNSUPPORTED_FILESYSTEM_IDENTITY`; no truncation or floating-point approximation is allowed.
- Project only `fileType`, `device`, `inode`, `uid`, `gid`, permission/type-preserving numeric `mode`, `size`, and
  `mtime`. No birthtime, atime, ctime, flags, blocks, native handle, or platform object escapes.
- Derive `DIRECTORY`, `REGULAR_FILE`, or `SYMLINK` through mutually exclusive `Stats` predicates. Socket, FIFO,
  character/block device, or unknown type fails closed.
- Normalize absolute paths and relative link targets under the XR-I lexical rules. Reject NUL, malformed or
  non-absolute derived paths, ambiguous `.`/`..` after normalization, and invalid UTF-8. Do not perform Unicode NFC or
  NFD rewriting: normalization could change exact filesystem identity. Canonical JSON escaping remains deterministic.
- Count `readlink` target size from its exact UTF-8 encoding before accumulation. Equality with 4096 bytes is allowed;
  overflow is rejected without partial addition.
- `mtime` remains `AUDIT_ONLY_AND_RACE_SIGNAL_NOT_SUFFICIENT_ALONE`, stays in normalized observation, and is excluded
  symmetrically from component, symlink-entry, and final-target consistency-token identity.

## 9. Fixture and Real Adapter Parity

A future XR-AV harness will feed equivalent observations to `ScriptedExactHostReadPort` and the gated real adapter.
Both use the same immutable normalized metadata/path types, private token consumer, closed error mapper, engine-owned
call accounting, byte checks, and evidence builder. No host-specific `Stats`, errno object, native path buffer, or
timer handle may escape.

Parity assertions cover normalized operation returns, ordered PRE/POST observations, consistency tokens, failure
reasons, primitive counts, link-target bytes, evidence bytes, and immutable evidence. The fixture remains authoritative
for deterministic engine tests. Real-adapter tests are separate, default-off, platform-gated, and may not inspect the
four approved executable paths until XR-AX is independently approved. This plan executes no parity harness.

## 10. PRE/POST Consistency and Cache Policy

The real adapter must execute two complete ordered passes. It must not reuse a PRE `Stats` result, symlink target,
realpath result, native cache object, Promise, or token during POST. Each token causes one fresh Node API call in the
engine-prescribed order. Adapter-owned caching is prohibited.

The consistency model detects component or target replacement, symlink change, identity/security metadata change,
and canonical-realpath change. It cannot alone rule out inode reuse, mount replacement, a filesystem serving stale
metadata, or replacement after POST. `mtime` remains an audit race signal but not token identity. These residuals keep
the live-execution TOCTOU gate blocked.

## 11. Residual Offline Hardening Before XR-AI

Complete and independently validate these offline changes before any real adapter implementation:

1. verify the private `RESOLUTION_BRAND` inside sequencer contract validation;
2. add a dedicated evidence-size nonconvergence failure reason;
3. add a dedicated XR read-allowlist version mismatch reason;
4. add an automated assertion that the offline boundary imports no host APIs;
5. defensively copy and deep-freeze every fixture-returned value before it enters engine observation.

They remain offline work and must not be bundled with actual filesystem access.

## 12. Code-Sign and Execution Gates

`HostReadExecutableObservation` remains distinct from `ExecutableIdentity`. The adapter cannot inspect or fabricate
`codeSignature`, mark metadata evidence execution-eligible, enter it into an execution baseline, unblock XG, or freeze
a digest. Any authoritative code-sign mechanism is a separate Architecture Review and approval boundary.

```text
XR_METADATA_EVIDENCE_EXECUTION_ELIGIBLE = NO
CODE_SIGN_GATE = BLOCKS_XG_XF_XA_E
```

## 13. Future Approval Split

| Slice | Scope | Explicitly not authorized |
|---|---|---|
| `XR-AI` | adapter implementation only after cancellation/locality blockers close | host reads, validation against approved paths, execution |
| `XR-AV` | static safety, fakes, normalization/error/parity harness validation | actual reads of the four paths |
| `XR-AX` | one separately approved bounded metadata-read execution after pre-validation | code-sign, baseline acceptance, XG/XF/XA/E |

Implementation approval does not authorize reads. Validation approval does not authorize reads. XR-AX requires exact
pre/post baseline validation, platform/locality proof, deadline resolution, bounded evidence targets, and a separate
Strict approval. Its evidence remains execution-ineligible because code-sign identity is unavailable. No approval
inherits to XG, XF, XA, or E.

## 14. Future Test Plan

### Static safety

- Permit only the reviewed `node:fs/promises` imports and four selected functions.
- Reject child-process, signal, network, daemon, mutation, directory enumeration, `.git`, code-sign, native binding,
  and unapproved filesystem APIs.

### Token enforcement

- Forgery, reuse, wrong operation/pass/read ID/context/path/call index each produce the exact closed reason and zero
  host calls. Success and host failure both burn the token; no second call occurs.

### Error and metadata normalization

- Cover every error in Section 7 plus an unknown object; assert no message, stack, or extra path leakage.
- Cover bigint boundaries, overflow, absent uid/gid, every supported and unsupported file type, mode projection,
  size/mtime conversion, NUL and invalid UTF-8, 4096/4097-byte link targets, and lexical path normalization.

### Deadline feasibility

- Cover timeout before completion, late completion, outstanding-call accounting, token burn, finalization prevention,
  and no false cancellation claim. These tests cannot make an infeasible cancellation mechanism acceptable.

### Parity and consistency

- Assert fixture/real normalized result, token, reason, count, byte, and evidence parity.
- Assert fresh full PRE/POST calls with no cached substitution and drift for symlink, component, target, mount identity,
  and security fields.

No test may inspect `/usr/bin/git`, `/usr/bin/sed`, `/usr/bin/readlink`, or `/usr/bin/stat` without separate XR-AX
execution approval.

## 15. Approval Conclusion

The architecture is sufficiently explicit for independent review, but XR-AI is blocked until exact cancellation and
local-filesystem provenance have an approved solution.

```text
STAGE_2B_SLICE_5C_EG_F0_XR_A_PLAN = READY_FOR_INDEPENDENT_REVIEW
XR_REAL_ADAPTER_IMPLEMENTATION_APPROVED = NO
XR_REAL_ADAPTER_VALIDATION_APPROVED = NO
XR_ACTUAL_HOST_READ_APPROVED = NO
EXECUTABLE_METADATA_READ_APPROVED = NO
CODE_SIGN_READ_APPROVED = NO
XR_METADATA_EVIDENCE_EXECUTION_ELIGIBLE = NO
PRE_FREEZE_GIT_VERSION_EXECUTION_APPROVED = NO
CANONICAL_DIGEST_FREEZE_APPROVED = NO
PROCESS_EXECUTION_APPROVED = NO
F0_F1_EXECUTION_APPROVED = NO
PUSH_APPROVED = NO
NEXT_ACTION = CLAUDE_INDEPENDENT_F0_XR_A_PLAN_REVIEW
```

## 16. XR-AI Offline Implementation Alignment

The original plan state above remains historical. In an out-of-band project conversation on 2026-08-07 KST, the
Chief Architect accepted F0-XR-A with the clarification that XR-AI offline implementation and XR-AV offline/static/fake
validation are permitted while every real filesystem read remains blocked by provenance and cancellation feasibility
gaps. This records no repository approval artifact, packet, evidence document, or approval commit.

```text
CHIEF_ARCHITECT_POST_REVIEW_DECISION_DATE = 2026-08-07_KST
F0-XR-A_PLAN = COMPLETE_AND_ACCEPTED_WITH_CA_CLARIFICATIONS
XR-AI_OFFLINE_IMPLEMENTATION = APPROVED
XR-AV_OFFLINE_STATIC_FAKE_VALIDATION = APPROVED
F0-XR-AI = COMPLETE_AND_ACCEPTED_WITH_CARRYOVER
F0-XR-AV = REMEDIATION_IN_PROGRESS
XR_ACTUAL_HOST_READ_APPROVED = NO
```

XR-AV validates actual source imports rather than hand-maintained manifests, uses a true begin/end record deadline,
and uses XR-I's single `XR_LIMITS`/`XrReadAccounting` authority for path, hop, call, link-target and evidence caps.
`RealExactHostReadPort` does not itself enforce those caps: future async real-read orchestration must route every call
through the shared authority before token issuance, and XR-AX cannot proceed until that orchestration is independently
validated. Unknown host errors intentionally normalize to `COMMAND_SAFETY_BLOCKED` so unreviewed host detail cannot
widen the public failure taxonomy.

XR-AV static source-boundary verification may recursively enumerate the runner source tree and perform bounded,
read-only repository TypeScript source reads solely for import/export regression analysis. That approved test
infrastructure activity is distinct from prohibited real-adapter host reads and inspects no `.git` internals,
executables, code signatures, mount metadata, or filesystem provenance.

XR-AI implements the gated adapter module without constructing or invoking its production filesystem façade. Exactly
`lstat`, `readlink`, `realpath`, and `stat` are imported from `node:fs/promises`; there is no default port, CLI/runtime
wiring, production factory authority, or live readiness path. Tests inject only synthetic in-memory primitive results.

Metadata uses bigint host projections with safe-number bounds and fails closed on overflow or unsupported file types.
`ETIMEDOUT` is normalized to `XR_FILESYSTEM_PROVENANCE_SUSPECT`, while `ENAMETOOLONG` uses the distinct
`XR_PATH_LENGTH_UNSUPPORTED` reason. Host errors, Node Stats, buffers, native handles, and timer objects do not escape.

The expected profile remains policy—not observation—and explicitly accounts for the sealed System volume, Data
volume, firmlinks, mount identity, APFS type, local attachment, provider/FUSE backing, and daemon mediation. Provenance
attestation must itself satisfy `networkPolicy=NONE` and `localDaemonContact=NONE`; no `statfs`, mount-table, IOKit,
Disk Arbitration, process, or real path access is implemented.

The logical controller uses `min(1000 ms per call, remaining 10000 ms record target)`. Deadline detection is not
physical cancellation. An outstanding deadline enters `OUTSTANDING_IO_QUARANTINED`, burns authority, revokes future
calls and POST, ignores late fulfillment/rejection, and cannot emit success evidence. Temporary paths and synthetic
real filesystem fixtures remain actual reads and require separate approval.

```text
XR_REAL_ADAPTER_IMPLEMENTED = YES
XR_REAL_ADAPTER_EXECUTION_APPROVED = NO
XR_ACTUAL_HOST_READ_APPROVED = NO
LOCAL_FILESYSTEM_PROVENANCE_PREFLIGHT = BLOCKED_FEASIBILITY_GAP
EXACT_BOUNDED_FILESYSTEM_CANCELLATION = BLOCKED_FEASIBILITY_GAP
XR_AX_ELIGIBLE = NO
XR_METADATA_EVIDENCE_EXECUTION_ELIGIBLE = NO
CODE_SIGN_GATE = BLOCKS_XG_XF_XA_E
```
