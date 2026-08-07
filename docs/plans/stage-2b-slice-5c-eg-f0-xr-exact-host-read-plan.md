# Stage 2B Slice 5C-EG-F0-XR Exact Host Read Architecture and Safety Plan

## 1. Status and Boundary

- **Status:** documentation-only, plan-only, ready for independent review.
- **Objective:** define bounded exact repository/executable metadata reads that may later supply reviewed evidence to
  F0-XG and F0-XF without creating a process or mutating the host.
- **Accepted predecessors:** F0 contract, F0-R, F0-H, F0-HI, and F0-HV.
- **Non-authorization:** this plan performs and approves no host read, executable inspection, repository-internal read,
  Git-version execution, process creation, signal, digest freeze, F0/F1 execution, or later-slice operation.

```text
F0-XR = EXACT_HOST_READS_ONLY
REAL_HOST_ADAPTER = NOT_IMPLEMENTED
XR_READ_ALLOWLIST = CANDIDATE_ONLY_NOT_APPROVED
XR_DIGEST = NOT_FROZEN
```

## 2. Fact Classification

Each required fact has exactly one primary acquisition classification. An approval-bound expected value may be carried
as pure input even where a fresh observation requires process execution; carrying an expectation never proves the
current host state.

| Required fact | Classification | Rationale |
|---|---|---|
| Repository root | `PURE_FROM_ALREADY_APPROVED_DATA` | Exact root is an approval-bound context value; XR does not discover it. |
| Branch | `REQUIRES_PROCESS_EXECUTION` | Fresh Git-semantic branch state is deferred to sequenced Git evidence. |
| HEAD | `REQUIRES_PROCESS_EXECUTION` | Correct resolution must honor gitfile/worktree, symbolic refs, packed refs, and replacements. |
| Parent | `REQUIRES_PROCESS_EXECUTION` | Commit lookup may require pack/object parsing, shallow-state handling, and replacement semantics. |
| origin/main | `REQUIRES_PROCESS_EXECUTION` | Loose/packed/symbolic ref and worktree semantics belong to Git. |
| Ahead count | `REQUIRES_PROCESS_EXECUTION` | Requires revision traversal with complete Git graph semantics. |
| Behind count | `REQUIRES_PROCESS_EXECUTION` | Requires revision traversal with complete Git graph semantics. |
| Tracked cleanliness | `REQUIRES_PROCESS_EXECUTION` | Equivalence to Git index/worktree status is not established by bounded passive reads. |
| Staged cleanliness | `REQUIRES_PROCESS_EXECUTION` | Requires full index/tree comparison semantics. |
| Approved untracked inventory | `REQUIRES_PROCESS_EXECUTION` | Ignore, sparse, nested repository, and worktree rules prevent a narrow equivalent parser. |
| Allowlist-document blob identity | `REQUIRES_PROCESS_EXECUTION` | Fresh index/blob identity resolution is Git-semantic; approved identity remains an expectation only. |
| Architecture-plan blob identity | `REQUIRES_PROCESS_EXECUTION` | Same Git-semantic constraint as the allowlist document. |
| Exact executable path | `PURE_FROM_ALREADY_APPROVED_DATA` | Comes from the resolved, validated static contract; caller cannot provide a path. |
| Canonical executable realpath | `READABLE_WITH_EXACT_HOST_READ` | Bounded exact-path symlink resolution can observe it without executing the target. |
| Symlink chain | `READABLE_WITH_EXACT_HOST_READ` | Exact-chain `lstat`/`readlink` operations are bounded by depth and byte caps. |
| File type | `READABLE_WITH_EXACT_HOST_READ` | Exact configured path/final target metadata. |
| Device | `READABLE_WITH_EXACT_HOST_READ` | Platform metadata, subject to filesystem semantic support. |
| Inode | `READABLE_WITH_EXACT_HOST_READ` | Platform metadata, subject to filesystem semantic support. |
| Numeric uid | `READABLE_WITH_EXACT_HOST_READ` | Exact target metadata; no account-directory lookup. |
| Numeric gid | `READABLE_WITH_EXACT_HOST_READ` | Exact target metadata; no group-directory lookup. |
| Mode | `READABLE_WITH_EXACT_HOST_READ` | Exact target numeric mode. |
| Size | `READABLE_WITH_EXACT_HOST_READ` | Exact target metadata; contents are not read. |
| Modification timestamp | `READABLE_WITH_EXACT_HOST_READ` | Audit/race signal only, not sufficient identity. |
| Code-sign identity | `BLOCKED_FEASIBILITY_GAP` | No approved bounded passive API is shown to provide authoritative platform code-sign identity. |
| Git version line | `REQUIRES_PROCESS_EXECUTION` | Only F0-XG may execute the exact Git version request. |

## 3. Repository Metadata Read Feasibility

F0-XR chooses **B/C**, not direct `.git` parsing:

```text
B = bind already approved repository facts as expectations
C = obtain fresh repository facts from separately approved sequenced F0 Git commands
```

A bounded direct parser is rejected for this Slice. A correct parser would need to implement and constrain gitfile and
worktree indirection, symbolic/detached HEAD, loose/packed/symbolic refs, object existence, zlib object decoding,
packfiles and indexes, commit-parent extraction, shallow boundaries, replace refs, alternates, linked worktrees,
submodules, repository format extensions, and malformed/adversarial metadata. This is substantial Git semantics and
would still not safely provide graph divergence or worktree status equivalence.

XR therefore defines no `.git` path, no recursive traversal, no repository-object reader, and no claim that approved
baseline expectations are fresh observations. Fresh branch, refs, identities, and divergence remain
`REQUIRES_PROCESS_EXECUTION` under their future exact F0 records.

## 4. Working-tree Cleanliness

XR does not reproduce `git status`, `git diff`, or `git diff --cached`. Doing so would require complete handling of
index formats and extensions, split/sparse index, timestamp/cache validity, ignore rules, nested repositories,
intent-to-add, assume-unchanged, skip-worktree, submodules, mode/symlink changes, unmerged entries, and current
filesystem comparison semantics.

```text
TRACKED_CLEANLINESS_FRESH_OBSERVATION = REQUIRES_SEQUENCED_F0_GIT_COMMAND
STAGED_CLEANLINESS_FRESH_OBSERVATION = REQUIRES_SEQUENCED_F0_GIT_COMMAND
UNTRACKED_INVENTORY_FRESH_OBSERVATION = REQUIRES_SEQUENCED_F0_GIT_COMMAND
```

XR may bind the approved expected values into its context, but does not emit fresh cleanliness evidence.

## 5. Exact Executable Metadata Read Model

The future private XR reader accepts an approved `readId`, never a path. The resolved static contract supplies the
configured absolute path. The unique candidate executable paths are limited to the contract paths represented by:

```text
XR-EXEC-GIT
XR-EXEC-SED
XR-EXEC-READLINK
XR-EXEC-STAT
```

For each ID the future operation is:

```text
approved readId -> exact contract path
-> lstat configured path
-> bounded symlink-chain lstat/readlink resolution when applicable
-> realpath comparison
-> stat final target
-> repeat configured-path lstat and final-target stat
-> compare identity-bearing fields
-> normalize bounded evidence or fail closed
```

There is no PATH lookup, directory enumeration, sibling discovery, glob, recursion, fallback candidate, alternate Git
search, target invocation, or raw executable-content read.

## 6. Symlink Policy

- A configured path may be a symlink only when its approved record permits it.
- Maximum chain depth is `8`; the ninth link fails before further reading.
- Every encountered link path and normalized target is cycle-checked and recorded in order.
- Absolute targets remain absolute. Relative targets resolve only against the current link's parent for the next exact
  path; the reader never enumerates that parent.
- Every derived path must be absolute, normalized, free of NUL, and bounded to 4096 UTF-8 bytes.
- The final target must equal the approval-bound expected realpath.
- Both configured-path identity and final-target identity enter evidence. Each chain component enters the bounded
  chain evidence.
- A changed link/target between initial and final observations yields `XR_BASELINE_CHANGED`.
- Missing targets, cycles, excessive depth, and non-regular final targets fail closed.
- No containment assumption is inferred merely from a common parent. Exact expected target equality is required.

## 7. Executable Identity Evidence Fields

| Field | Role | Notes |
|---|---|---|
| `configuredPath` | `IDENTITY_BEARING` | Exact resolved-contract path. |
| `configuredPathIdentity` | `IDENTITY_BEARING` | Initial/final lstat identity of the configured entry. |
| `canonicalRealpath` | `IDENTITY_BEARING` | Must equal the approved target. |
| `symlinkChain` | `IDENTITY_BEARING` | Ordered, depth-capped link path/target identities. |
| `fileType` | `IDENTITY_BEARING` | Final target must be a regular file. |
| `device` | `IDENTITY_BEARING` | Required only on a reviewed filesystem/platform with stable semantics. |
| `inode` | `IDENTITY_BEARING` | Required only with reviewed stable semantics; never globally unique alone. |
| `uid` | `IDENTITY_BEARING` | Numeric only. |
| `gid` | `IDENTITY_BEARING` | Numeric only. |
| `mode` | `IDENTITY_BEARING` | Numeric permission/type bits. |
| `size` | `IDENTITY_BEARING` | Bounded nonnegative integer; not sufficient alone. |
| `mtime` | `AUDIT_ONLY` | Race signal; timestamp alone is never identity. |
| `codeSignIdentity` | `UNAVAILABLE_ON_PLATFORM` | Unavailable until an authoritative passive mechanism is approved. |
| `observedAt` | `AUDIT_ONLY` | Excluded from identity and digest comparison. |

Unsupported device/inode semantics fail closed when the executable identity policy requires them. Required code-sign
identity remains a feasibility blocker rather than being silently omitted. No raw executable bytes enter evidence.

## 8. TOCTOU Relationship

```text
EXECUTABLE_IDENTITY_TOCTOU_CONTROL = BLOCKED_FEASIBILITY_GAP_FOR_LIVE_EXECUTION
```

XR captures a bounded snapshot only. HI models initial/pre-dispatch comparisons but performs no reads. XG and E must
separately approve and repeat identity observation immediately before their respective spawn attempt. XR evidence is
not reusable as proof that a later executed file is unchanged.

Node process creation has no approved portable execute-by-open-file-descriptor binding. A future post-spawn
correlation may require a platform-specific process-status read, which is outside XR and remains a separate
feasibility/read approval. Until a mechanism is approved or bounded residual risk is explicitly accepted by the Chief
Architect, XR cannot make XA or E eligible.

## 9. Proposed Host Read API

The future private API is conceptually:

```text
readApprovedHostFact(readId, approvedReadContext)
```

It does not expose `readFile(path)`, raw paths, filesystem options, or generic operations. Candidate implementation
primitives are narrowly wrapped `node:fs/promises` equivalents of `lstat`, `readlink`, `realpath`, and `stat`.
`open/read` and `readFile` are not selected for executable metadata because no file contents are required.

Per approved executable read ID:

| Primitive | Allowed input | Maximum | Byte cap/cancellation |
|---|---|---:|---|
| `lstat` | configured path plus at most 8 derived link paths | 10 total | metadata only; one 1000 ms cancellable deadline |
| `readlink` | only an entry just proven to be a symlink | 8 | 4096 UTF-8 bytes per target |
| `realpath` | configured path | 1 | result 4096 UTF-8 bytes; same deadline |
| `stat` | exact final target | 2 | metadata only; same deadline |

Every operation is read-only: no write/create/truncate flags, chmod/chown, directory mutation, recursion, retry, or
arbitrary caller path. Deadline expiry is terminal and does not start a second attempt.

## 10. Closed XR Read Allowlist

```text
XR_READ_ALLOWLIST_VERSION = stage2b-5c-eg-f0-xr-read-allowlist-v1
approvalStatus = CANDIDATE_ONLY_NOT_APPROVED
```

Each of `XR-EXEC-GIT`, `XR-EXEC-SED`, `XR-EXEC-READLINK`, and `XR-EXEC-STAT` is a candidate record with the following
closed shape:

```text
readId
purpose = EXECUTABLE_IDENTITY_CAPTURE
exactPathSource = RESOLVED_STATIC_ALLOWLIST_CONTRACT
operation = LSTAT_READLINK_REALPATH_STAT_RECHECK
maximumCalls = 21
maximumBytes = 32768
expectedFileType = REGULAR_FILE
symlinkPolicy = APPROVAL_BOUND_DEPTH_8_EXACT_TARGET
privilegeClass = UNPRIVILEGED
localDaemonContact = NONE
networkPolicy = NONE
hostMutation = NONE
normalizedFacts = CLOSED_EXECUTABLE_IDENTITY_V1
failureReasons = CLOSED_XR_FAILURE_SET_V1
dependencies = XR_APPROVED_CONTEXT_BOUND
approvalStatus = CANDIDATE_ONLY_NOT_APPROVED
```

The aggregate byte cap covers bounded normalized link targets and evidence serialization, not executable contents.
The record path is derived internally from the validated contract. Missing, unknown, duplicate, or caller-created IDs
are rejected. This plan neither serializes final canonical bytes nor freezes a read-allowlist digest.

## 11. Privilege and External-effect Classification

Every candidate read is `UNPRIVILEGED`, `localDaemonContact=NONE`, `networkPolicy=NONE`, and `hostMutation=NONE`.
Permission requiring elevation stops as `BLOCKED_FEASIBILITY_GAP`; there is no sudo, entitlement change, broader read,
or privilege escalation. Any observed daemon/network requirement is `COMMAND_SAFETY_BLOCKED` and cannot widen the
record in place.

Code-sign capture remains `BLOCKED_FEASIBILITY_GAP`, not a privileged candidate. No process or signal operation is an
XR read.

## 12. Closed Failure Model

```text
XR_READ_ID_NOT_ALLOWED
XR_APPROVED_PATH_UNRESOLVED
XR_SYMLINK_CYCLE
XR_SYMLINK_DEPTH_EXCEEDED
XR_UNEXPECTED_FILE_TYPE
XR_REALPATH_MISMATCH
XR_METADATA_MISMATCH
XR_PERMISSION_DENIED
XR_FILE_MISSING
XR_BASELINE_CHANGED
XR_FILESYSTEM_IDENTITY_UNSUPPORTED
XR_READ_BYTE_CAP_EXCEEDED
XR_READ_TIMEOUT
XR_REPOSITORY_METADATA_MALFORMED
XR_REPOSITORY_REF_AMBIGUOUS
XR_REPOSITORY_FORMAT_UNSUPPORTED
XR_CODE_SIGN_IDENTITY_UNAVAILABLE
XR_EVIDENCE_SCHEMA_MISMATCH
COMMAND_SAFETY_BLOCKED
```

Repository parser failures are reserved schema outcomes; because XR selects no repository-internal parser, their
appearance is an implementation/scope violation. Every failure discards partial normalized facts and stops. There is
no fallback path, alternate executable, directory expansion, retry, repair, privilege escalation, or process launch.

## 13. Read Consistency and Baseline Race Handling

For each executable the consistency token contains the approval context identity plus the configured-path and target
identity-bearing metadata. The bounded sequence is:

```text
pre-read configured-path token
-> bounded chain and final-target observations
-> post-read configured-path and final-target token
-> exact equality comparison
```

All records in one future XR operation execute once in the closed read-ID order. A changed configured entry, link,
target, or required metadata yields `XR_BASELINE_CHANGED`; all normalized facts are discarded and the sequence stops
without retry.

The repository approval token is input-only because XR performs no fresh Git-semantic observation. Two executable
snapshots cannot prove repository consistency, and two individually successful but unequal observations never form
valid evidence. XR freezes no digest.

## 14. Evidence Ownership

XR uses a separate private `HostReadEvidenceBinding`, later consumed as an explicit input to XF when independently
approved. It is not written directly into `ExecutionBaselineBinding` during XR because the latter is not frozen yet
and also owns non-read live-policy values.

The immutable closed evidence contains:

```text
xrEvidenceSchemaVersion
readAllowlistVersion
readId
approvedContextId
configuredPath
configuredPathIdentity
canonicalRealpath
symlinkChain
finalTargetIdentity
boundedNormalizedFacts
readCount
byteCount
preReadToken
postReadToken
resultClass
failureReason
observedAt
```

Unknown fields are rejected. `observedAt` is audit-only. Evidence contains no unrestricted raw bytes, executable
contents, secret, credential, process output, or network data. Failure evidence has empty normalized facts. XF may
bind the reviewed aggregate evidence identity into the baseline only after its own approval.

## 15. F0-HI Hardening Debt

These are carried requirements, not XR implementation authority:

| Debt | Must close | Reason |
|---|---|---|
| Remove/type-isolate all fixture replay defaults | `BEFORE_F0_XF` | No magic value may enter frozen replay/digest binding. |
| Pre-spawn failures use `processExitCode=NONE`, `childExited=false` | `BEFORE_F0_XG` | XG is the first real process boundary. |
| Validate full canonical record content against `TIER_A_RECORDS[index]` | `BEFORE_F0_XF` | XF must freeze exact complete records, not IDs alone. |
| Remove redundant non-scheduled timeout fallback | `BEFORE_F0_XG` | XG timeout must have one authoritative scheduled source. |

All four remain mandatory before F0-XA and F0-E. XR neither implements nor waives them.

## 16. Future Slice Relationship

```text
F0-XR = exact approved host reads only
F0-XG = one exact pre-freeze Git-version process execution
F0-XF = pure symbol resolution and digest freeze
F0-XA = process and termination authorization
F0-E  = bounded real 16-command sequence
```

XR creates no process, sends no signal, resolves no Git version, freezes no digest, and grants no later authority.
No approval inherits to XG, XF, XA, or E.

## 17. Decisions

| Decision | Status | Rationale |
|---|---|---|
| `XR_READ_OWNER` | `DECIDED` | Future private `host/read` boundary under the non-production egress allowlist runner. |
| `XR_READ_ALLOWLIST_MODEL` | `DECIDED` | Closed versioned read IDs mapped internally to resolved-contract paths; no caller path. |
| `REPOSITORY_METADATA_READ_FEASIBILITY` | `REQUIRES_PROCESS_EXECUTION` | Full Git semantics are too broad for a safe bounded XR parser. |
| `WORKTREE_STATUS_READ_FEASIBILITY` | `REQUIRES_PROCESS_EXECUTION` | Index/worktree equivalence is delegated to exact sequenced Git records. |
| `EXECUTABLE_METADATA_READ_FEASIBILITY` | `DECIDED` | Exact-path bounded lstat/readlink/realpath/stat candidate is feasible without execution. |
| `SYMLINK_POLICY` | `DECIDED` | Approval-bound links, depth 8, cycle detection, exact target, two observations. |
| `CODE_SIGN_READ_FEASIBILITY` | `BLOCKED_FEASIBILITY_GAP` | No authoritative bounded passive mechanism has been approved. |
| `HOST_READ_API` | `DECIDED` | Private `readApprovedHostFact(readId, context)` with fixed wrappers and caps. |
| `READ_CONSISTENCY_MODEL` | `DECIDED` | Pre/post identity tokens; any change discards facts and stops without retry. |
| `XR_EVIDENCE_OWNER` | `DECIDED` | Separate immutable `HostReadEvidenceBinding`, optionally consumed later by XF. |
| `TOCTOU_RELATIONSHIP` | `BLOCKED_FEASIBILITY_GAP` | XR snapshot cannot bind later spawn identity. |
| `PRIVILEGE_CLASS` | `DECIDED` | Unprivileged only; elevation requirement stops. |
| `IMPLEMENTATION_BOUNDARY` | `DECIDED` | XR implementation/execution, XG, XF, XA, and E retain separate approvals. |

## 18. Approval Conclusion

```text
STAGE_2B_SLICE_5C_EG_F0_XR_PLAN = READY_FOR_INDEPENDENT_REVIEW
XR_HOST_READ_IMPLEMENTATION_APPROVED = NO
XR_HOST_READ_EXECUTION_APPROVED = NO
EXECUTABLE_METADATA_READ_APPROVED = NO
REPOSITORY_INTERNAL_READ_APPROVED = NO
PRIVILEGED_READ_APPROVED = NO
PRE_FREEZE_GIT_VERSION_EXECUTION_APPROVED = NO
PROCESS_EXECUTION_APPROVED = NO
PROCESS_TERMINATION_APPROVED = NO
CANONICAL_DIGEST_FREEZE_APPROVED = NO
F0_F1_EXECUTION_APPROVED = NO
LOCAL_DAEMON_CONTACT_APPROVED = NO
NETWORK_TESTING_APPROVED = NO
HOST_MUTATION_APPROVED = NO
PUSH_APPROVED = NO
NEXT_ACTION = CLAUDE_INDEPENDENT_F0_XR_PLAN_REVIEW
```
