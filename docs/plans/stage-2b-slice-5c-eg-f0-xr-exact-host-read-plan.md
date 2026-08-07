# Stage 2B Slice 5C-EG-F0-XR Exact Host Read Architecture and Safety Plan

## 1. Status and Boundary

- **Status:** documentation-only, plan-only, ready for independent review.
- **Objective:** define bounded exact executable metadata observations without creating a process or mutating the
  host. These observations remain non-execution-eligible while mandatory code-sign identity is unresolved.
- **Accepted predecessors:** F0 contract, F0-R, F0-H, F0-HI, and F0-HV.
- **Non-authorization:** this plan performs and approves no host read, executable inspection, repository-internal read,
  Git-version execution, process creation, signal, digest freeze, F0/F1 execution, or later-slice operation.

```text
F0-XR = EXACT_HOST_READS_ONLY
REAL_HOST_ADAPTER = NOT_IMPLEMENTED
XR_READ_ALLOWLIST = CANDIDATE_ONLY_NOT_APPROVED
XR_DIGEST = NOT_FROZEN
XR_METADATA_READ_IMPLEMENTATION_FEASIBLE = YES
XR_METADATA_EVIDENCE_EXECUTION_ELIGIBLE = NO
```

F0-HV was a read-only independent validation function, not a separate implementation Slice or commit. It was
satisfied by the Claude targeted F0-HI remediation review of
`b36aad6423f11f38c062e3d3c034c934d1e0de20`: Node `v22.22.1`, focused tests `109/109`, tooling and repository
typecheck PASS, `git diff --check` PASS, and real host/process/signal activity `0`. The Chief Architect subsequently
accepted that review as fulfilling the F0-HV static/fixture-validation function.

```text
F0-HV separate commit = NOT_REQUIRED
F0-HV separate plan document = NOT_REQUIRED
```

This is historical clarification only and creates no new approval or evidence artifact.

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
-> component-by-component lstat from the absolute root
-> record each ordinary path component identity
-> resolve and record every encountered component or leaf symlink
-> continue from the normalized resolved target
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
- Every absolute-path component is observed using bounded component-by-component `lstat`; no component is silently
  resolved by `realpath` alone.
- Every ordinary component and its identity enter ordered `pathComponentChain`.
- Every component or leaf symlink and its target enter ordered `symlinkChain`.
- Maximum total symlink hops across intermediate components and the leaf is `8`; the ninth hop is rejected before
  another read.
- Cycle detection covers component and leaf links and is applied before following the next target.
- Absolute targets remain absolute. Relative targets resolve only against the current link's parent for the next exact
  path; the reader never enumerates that parent.
- Every derived path must be absolute, normalized, free of NUL, and bounded to 4096 UTF-8 bytes.
- The final target must equal the approval-bound expected realpath.
- Both configured-path identity and final-target identity enter evidence. Each chain component enters the bounded
  chain evidence.
- A changed link/target between initial and final observations yields `XR_BASELINE_CHANGED`.
- Missing targets, cycles, excessive depth, and non-regular final targets fail closed.
- Final `realpath` must equal the bounded manually resolved path; disagreement is terminal.
- No containment assumption is inferred merely from a common parent. Exact expected target equality is required.

## 7. Executable Identity Evidence Fields

| Field | Role | Notes |
|---|---|---|
| `configuredPath` | `IDENTITY_BEARING_APPROVAL_CONTEXT` | Exact resolved-contract path; not host-discovered. |
| `pathComponentChain` | `IDENTITY_BEARING_PATH` | Ordered identities for every ordinary component. |
| `configuredPathIdentity` | `IDENTITY_BEARING_PATH` | Initial/final lstat identity of the configured entry. |
| `canonicalRealpath` | `IDENTITY_BEARING_PATH` | Must equal the approved and manually resolved target. |
| `symlinkChain` | `IDENTITY_BEARING_PATH` | Ordered component/leaf link and target identities. |
| `fileType` | `SECURITY_POLICY_FIELD` | Final target must be a regular file. |
| `device` + `inode` | `IDENTITY_BEARING_UNDER_REVIEWED_FILESYSTEM_MODEL` | Required only with stable reviewed semantics; neither is globally sufficient alone. |
| `uid` + `gid` | `SECURITY_POLICY_FIELD` | Numeric policy comparison; not complete executable identity. |
| `mode` | `SECURITY_POLICY_FIELD` | Numeric permission/type policy; not complete executable identity. |
| `size` | `SUPPORTING_INTEGRITY_FIELD_NOT_SUFFICIENT_ALONE` | Bounded nonnegative integer. |
| `mtime` | `AUDIT_ONLY_AND_RACE_SIGNAL_NOT_SUFFICIENT_ALONE` | Additional race signal only. |
| `codeSignObservation` | `UNAVAILABLE_ON_PLATFORM` | Closed unresolved XR observation; never an identity value. |
| `observedAt` | `AUDIT_ONLY` | Excluded from identity and digest comparison. |

Unsupported device/inode semantics fail closed when the executable identity policy requires them. Required code-sign
identity remains a feasibility blocker rather than being silently omitted. No raw executable bytes enter evidence.

The XR-specific observation is closed and deliberately not structurally assignable to the accepted
`ExecutableIdentity`, whose mandatory `codeSignature: string` remains unchanged:

```text
HostReadExecutableObservation = {
  configuredPath
  canonicalRealpath
  pathComponentChain
  symlinkChain
  finalTargetMetadata
  codeSignObservation = NOT_OBSERVED_BLOCKED_FEASIBILITY_GAP
}
```

It cannot satisfy executable-identity validation, authorize XG/XA/E, or be silently promoted during XF. It may enter
`HostReadEvidenceBinding` only as unresolved observation. Metadata reads may still collect the non-code-sign facts,
but completion does not make the evidence eligible for an execution baseline.

### Code-sign mechanism disposition

- Extended attributes are passive metadata candidates but are not authoritative code-sign identity by themselves;
  no `xattr` read is approved or sufficient.
- A Security.framework/native binding could be authoritative but is outside the XR v1 passive filesystem boundary and
  needs separate feasibility, implementation, platform-support, and safety review.
- `/usr/bin/codesign` is process execution, not an XR read, and is not part of XG's single Git-version execution. It
  requires a new independently approved Slice or an explicit future-slice revision.

```text
SELECTED_AUTHORITATIVE_CODE_SIGN_MECHANISM = NONE
EXECUTABLE_IDENTITY_POLICY_CHANGE = NOT_APPROVED
CODE_SIGN_READ_FEASIBILITY = BLOCKED_FEASIBILITY_GAP
CODE_SIGN_GATE_EFFECT = BLOCKS_XG_XF_XA_E
```

XG, XF execution-baseline acceptance, XA, and E remain blocked until an authoritative mechanism is approved or a new
executable-identity policy is explicitly approved, version-bumped, and digest-invalidating. XR chooses neither path.

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
| `lstat` | exact ordered components, link targets, and entry rechecks | 32 | metadata only; one 1000 ms cancellable deadline |
| `readlink` | only an entry just proven to be a symlink | 8 | 4096 UTF-8 bytes per target |
| `realpath` | configured path | 1 | result 4096 UTF-8 bytes; same deadline |
| `stat` | exact final target | 2 | metadata only; same deadline |

The closed total is `32 + 8 + 1 + 2 = 43` primitive calls per executable read ID. Component and total call caps are
checked before issuing the next read; reaching exactly the cap is allowed, while a 44th total call or any per-kind
call above its cap is rejected.

Byte caps are inclusive and applied before accumulation:

```text
observed == cap -> allowed
observed > cap -> rejected
```

Counts use actual UTF-8 bytes. Each link target is capped at 4096 bytes and aggregate link-target bytes at 32768.
When the next target would exceed either cap, no partial target is appended. Metadata serialization size is checked
before addition to the bounded evidence accumulator. No cap is enforced only after unbounded accumulation.

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
maximumComponentEntryLstatCalls = 32
maximumReadlinkCalls = 8
maximumRealpathCalls = 1
maximumFinalStatRecheckCalls = 2
maximumTotalPrimitiveCalls = 43
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

Both pre-read and post-read tokens contain exactly the approved read-context identity, configured path, ordered
`pathComponentChain` identities, ordered `symlinkChain` entries and targets, final canonical realpath, final target
device/inode and file type, uid, gid, mode, size, and every required policy field. `mtime` may be compared as an
additional audit/race signal but is not sufficient identity.

```text
preToken == postToken
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
pathComponentChain
symlinkChain
finalTargetIdentity
codeSignObservation = NOT_OBSERVED_BLOCKED_FEASIBILITY_GAP
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

Because `codeSignObservation` is unresolved, the binding is metadata evidence only and is not execution-eligible.
XF must not promote it into the mandatory `ExecutableIdentity.codeSignature` field.

## 15. Git Blob Identity Distinction

The following are distinct and cannot substitute for one another:

```text
current filesystem bytes
working-tree content
Git blob object identity
index entry identity
committed tree-entry/blob identity
approval-bound expected blob ID
```

Filesystem bytes do not establish which object is in the index. Index identity does not establish the committed tree
entry. Committed identity requires Git tree/index semantics. An approved expected blob ID remains an expectation until
re-observed. A plain filesystem hash is not a Git blob identity. Even hashing `blob <length>\0<content>` produces only
a candidate Git object identity for those bytes; it proves neither index membership, committed-tree membership, path
association, nor current repository state.

```text
No content hash may be labelled as the committed Git blob ID
without a defined and versioned Git object and tree/index verification contract.
DOCUMENT_AND_PLAN_BLOB_IDENTITIES = REQUIRES_PROCESS_EXECUTION
```

## 16. F0-HI Hardening Debt

These are carried requirements, not XR implementation authority:

| Debt | Must close | Reason |
|---|---|---|
| Remove/type-isolate all fixture replay defaults | `BEFORE_F0_XF` | No magic value may enter frozen replay/digest binding. |
| Pre-spawn failures use `processExitCode=NONE`, `childExited=false` | `BEFORE_F0_XG` | XG is the first real process boundary. |
| Validate full canonical record content against `TIER_A_RECORDS[index]` | `BEFORE_F0_XF` | XF must freeze exact complete records, not IDs alone. |
| Remove redundant non-scheduled timeout fallback | `BEFORE_F0_XG` | XG timeout must have one authoritative scheduled source. |

All four remain mandatory before F0-XA and F0-E. XR neither implements nor waives them.

## 17. Future Slice Relationship

```text
F0-XR = exact approved host reads only
F0-XG = one exact pre-freeze Git-version process execution
F0-XF = pure symbol resolution and digest freeze
F0-XA = process and termination authorization
F0-E  = bounded real 16-command sequence
```

XR creates no process, sends no signal, resolves no Git version, freezes no digest, and grants no later authority.
No approval inherits to XG, XF, XA, or E.

## 18. Decisions

| Decision | Status | Rationale |
|---|---|---|
| `XR_READ_OWNER` | `DECIDED` | Future private `host/read` boundary under the non-production egress allowlist runner. |
| `XR_READ_ALLOWLIST_MODEL` | `DECIDED` | Closed versioned read IDs mapped internally to resolved-contract paths; no caller path. |
| `REPOSITORY_METADATA_READ_FEASIBILITY` | `REQUIRES_PROCESS_EXECUTION` | Full Git semantics are too broad for a safe bounded XR parser. |
| `WORKTREE_STATUS_READ_FEASIBILITY` | `REQUIRES_PROCESS_EXECUTION` | Index/worktree equivalence is delegated to exact sequenced Git records. |
| `EXECUTABLE_METADATA_READ_FEASIBILITY` | `DECIDED` | Exact-path bounded lstat/readlink/realpath/stat candidate is feasible without execution. |
| `XR_METADATA_READ_IMPLEMENTATION_FEASIBLE` | `DECIDED` | A separately approved reader may collect non-code-sign observations. |
| `XR_METADATA_EVIDENCE_EXECUTION_ELIGIBLE` | `DECIDED` | `NO`; unresolved mandatory code-sign identity prevents baseline/execution use. |
| `SYMLINK_POLICY` | `DECIDED` | Approval-bound links, depth 8, cycle detection, exact target, two observations. |
| `INTERMEDIATE_COMPONENT_SYMLINK_POLICY` | `DECIDED` | Every path component is lstat-observed; all links are recorded and share the total depth-8 bound. |
| `CODE_SIGN_READ_FEASIBILITY` | `BLOCKED_FEASIBILITY_GAP` | No authoritative bounded passive mechanism has been approved. |
| `CODE_SIGN_GATE_EFFECT` | `DECIDED` | Mandatory code-sign identity remains unresolved and blocks XG/XF/XA/E. |
| `HOST_READ_API` | `DECIDED` | Private `readApprovedHostFact(readId, context)` with fixed wrappers and caps. |
| `READ_CAP_MODEL` | `DECIDED` | Inclusive pre-accumulation byte caps and pre-call 32/8/1/2/43 limits. |
| `READ_CONSISTENCY_MODEL` | `DECIDED` | Pre/post identity tokens; any change discards facts and stops without retry. |
| `XR_EVIDENCE_OWNER` | `DECIDED` | Separate immutable `HostReadEvidenceBinding`, optionally consumed later by XF. |
| `TOCTOU_RELATIONSHIP` | `BLOCKED_FEASIBILITY_GAP` | XR snapshot cannot bind later spawn identity. |
| `PRIVILEGE_CLASS` | `DECIDED` | Unprivileged only; elevation requirement stops. |
| `IMPLEMENTATION_BOUNDARY` | `DECIDED` | XR implementation/execution, XG, XF, XA, and E retain separate approvals. |

## 19. Approval Conclusion

```text
STAGE_2B_SLICE_5C_EG_F0_XR_PLAN = READY_FOR_INDEPENDENT_REVIEW
XR_HOST_READ_IMPLEMENTATION_APPROVED = NO
XR_HOST_READ_EXECUTION_APPROVED = NO
EXECUTABLE_METADATA_READ_APPROVED = NO
REPOSITORY_INTERNAL_READ_APPROVED = NO
CODE_SIGN_READ_APPROVED = NO
CODE_SIGN_PROCESS_EXECUTION_APPROVED = NO
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
NEXT_ACTION = CLAUDE_TARGETED_F0_XR_PLAN_REVIEW
```

```text
XR metadata-read plan acceptance does not make XR evidence execution-eligible.
```
