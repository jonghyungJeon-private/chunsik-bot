# Stage 2B Slice 5C-EG-F0-H Host Adapter and Sequencer Architecture Plan

## 1. Status and Boundary

- **Status:** plan-only; ready for independent review.
- **Accepted inputs:** the F0 Markdown allowlist and the fixture-only F0-R deterministic runner at repository HEAD
  `72dd8396ad4e6d0d4e7ff9b98aac26a8f866eb3a`.
- **Objective:** design the future non-production boundary that may connect the accepted contract to exact local
  commands after separate implementation, host-read, process-execution, digest-freeze, and live-execution approvals.
- **Non-authorization:** this plan implements no adapter, resolves no symbol, freezes no digest, reads no executable,
  and dispatches no command.

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

## 2. Structural Ownership

The future boundary has three layers:

```text
ApprovedExecutionContextFactory
  -> StopOnFirstFailureSequencer
       -> private HostCommandAdapter capability
       -> private HostExecutableIdentityVerifier capability
       -> accepted pure F0-R validation/normalization functions
```

Only `ApprovedExecutionContextFactory` may construct the opaque dispatch capability, and only
`StopOnFirstFailureSequencer.run(context)` receives it. The host adapter class, identity verifier, and per-record
dispatch function are not exported from the `host/` module. Public exports expose the sequencer factory and bounded
results, never an `execute(record)` method. Tests use a distinct fake capability. This makes sequencing a structural
precondition rather than a caller convention and prevents direct real-adapter calls that skip baseline, digest, or
dependency checks.

The sequencer exclusively owns state transitions, command index, dependency derivation, evidence append, terminal
failure, cancellation, and final projection. It is single-use: a consumed or failed context cannot be restarted.

## 3. Pre-execution Binding and Freeze Sequence

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
```

Its recursively canonical bytes produce `executionBaselineDigest`. The digest is not part of the static allowlist
digest and neither digest contains itself. `executionBaselineDigest` is mandatory in the approved execution context,
opaque `DependencyState`, sequencer state, and every `CommandEvidence`. Evidence lacking it is schema-invalid.

The exact freeze sequence is:

```text
repository-only baseline verified against the approved binding
-> closed approval-bound symbol table resolved
-> resolved executable contract validated
-> canonical static allowlist bytes produced
-> approved static allowlist digest compared and frozen for this run
-> ExecutionBaselineBinding canonicalized
-> approved executionBaselineDigest compared and frozen for this run
-> sequencer capability becomes eligible
-> first executable identity check may begin
```

The closed symbol table remains exactly:

```text
APPROVAL_BOUND_HEAD_SHA
APPROVAL_BOUND_ARCHITECTURE_PLAN_BLOB_ID
APPROVAL_BOUND_GIT_VERSION_LINE
```

The execution approval supplies every value, including the Git version expectation. This plan guesses none. Missing,
unknown, extra, unresolved, pattern-invalid, or baseline-inconsistent values stop before dispatch. No final digest is
calculated or claimed here.

## 4. Dependency and Evidence Replay Protection

`DependencyState` is constructed only by the sequencer from the exact symbol-resolution result and its append-only
evidence chain. It binds `allowlistDigest`, `executionBaselineDigest`, repository HEAD, repository root, and current
sequence index. Arbitrary strings, fixture results, caller objects, and evidence from another sequencer instance
cannot establish a dependency.

To derive `<commandId>:SUCCESS`, prior evidence must pass the closed schema and match all of:

```text
commandId
exitClass = SUCCESS
stopReason = NONE
normalizationResult = SUCCESS
allowlistDigest
executionBaselineDigest
repositoryHead
workingDirectory
argvDigest recomputed from the current record
evidenceClass equal to the current record
contractVersion
schemaVersion
privilegeClass
localDaemonContact
executableRealpath and approved executable identity
```

`observedAt` is excluded because it is audit-only and cannot establish identity. Byte counts and redaction counts are
validated by the evidence schema but excluded from dependency identity because replay is already bound to contract,
baseline, command, argv, executable, and normalized success. Any mismatch yields dependency failure and prevents
dispatch. Evidence from another baseline cannot satisfy a dependency even if HEAD, root, and static digest match.

## 5. Stop-on-first-failure Sequencer

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

For each record, the sequencer validates the phase, exact next command id, current baseline/digests, identity,
dependencies, and stream capability before releasing one dispatch token. It consumes the token exactly once, obtains
one bounded result, normalizes evidence, appends it, and advances only on `SUCCESS/NONE/SUCCESS`.

Any other result atomically sets a terminal state, revokes the dispatch capability, prevents every later identity
check and spawn, retains only the bounded failure evidence, and returns. There is no repair, retry, alternate parser,
fallback command, broader output, privilege escalation, or sequence resume.

F0-GIT-04 is parsed as `behindCount` then `aheadCount`, matching
`rev-list --left-right --count origin/main...HEAD`. Immediately after its normalized evidence is created, the
sequencer compares both values with the approved `ExecutionBaselineBinding`. A mismatch emits `BASELINE_MISMATCH`,
terminates the sequence, and makes F0-GIT-05 and every later record ineligible.

## 6. Exact Command Order

The complete future order is:

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

F0-GIT-00 establishes Git identity before all other Git records. F0-GIT-07 establishes accepted blob identities
before source excerpts. Every F0 baseline command precedes F1, and installed-path metadata remains last because it is
not needed to authorize repository/source reads and adds host metadata exposure.

## 7. Future Real Host Command Adapter

The chosen implementation API is Node.js `node:child_process.spawn(executable, argv, options)` with:

```text
shell = false
executable = exact absolute record path
argv = exact immutable record argv
cwd = exact approved repository root
env = newly constructed exact allowlist environment
stdio = [ignore, pipe, pipe]
windowsHide = true where supported
```

`spawn` preserves the executable-plus-argv boundary and independent stdout/stderr pipes without shell parsing. PATH
lookup, command strings, `exec`, `execFile` fallback, command substitution, globbing, redirects, pipes, inherited
environment, and executable fallback are prohibited. The implementation must reject a non-absolute executable and
must not expose generic spawn options to callers. Documenting this API does not approve process creation.

## 8. Executable Identity Verifier

Before each process creation, the private verifier reads only the exact configured executable path and validates:

- canonical realpath and the record's symlink policy;
- regular-file type;
- device/inode or the reviewed platform-equivalent stable bounded identity;
- numeric owner and group, mode, and size; and
- code-sign identity when required by the executable identity contract.

No PATH lookup, directory enumeration, broad search, discovery, or alternate candidate is allowed. The checks are
runner-internal safety validation rather than extra Tier A commands, but they are real host metadata reads and require
an exact future host-read approval. Unsupported metadata or mismatch stops before spawn. Symlinks are rejected unless
the exact record explicitly approves the link and target identities; identity must be rechecked immediately before
spawn to narrow time-of-check/time-of-use drift.

## 9. Incremental Stream and Termination Design

The adapter supplies separate stdout and stderr chunk sources to the accepted limiter. Each reader applies byte caps
before accumulation, stateful strict UTF-8 decoding across chunks, CRLF/CR normalization across boundaries, and line
caps without boundary reset. Equality with a byte/line cap is allowed; the first value greater than a cap fails.

The sequencer waits for both bounded readers to classify their streams so precedence remains:

```text
both caps exceeded -> BOTH_STREAM_OUTPUT_LIMIT_EXCEEDED
stderr cap exceeded -> STDERR_OUTPUT_LIMIT_EXCEEDED
stdout cap exceeded -> STDOUT_OUTPUT_LIMIT_EXCEEDED
bounded non-empty stderr -> STDERR_NONEMPTY
```

After a safety violation, readers stop retaining bytes and the adapter requests termination of only the exact child
created for that record, waits for a bounded exit deadline, and reports termination success or failure. No partial
facts or raw streams persist. Process termination is a lifecycle mutation. It requires explicit approval as a
mandatory safety response within the same future process-execution operation; if termination authority is absent,
the sequencer must not spawn. Escalation beyond the preapproved child-specific termination method is prohibited and
termination failure is terminal and operator-visible.

## 10. Operation Classification

| Operation | Read/mutation class | Privilege | Daemon/network | Required future approval |
|---|---|---|---|---|
| Repository baseline/file read | bounded host read | unprivileged | none | exact host-read and command execution |
| Executable metadata/code-sign read | runner-internal host safety read | normally unprivileged | none | exact host-read |
| Exact process spawn | lifecycle mutation | unprivileged | record remains `NONE/NONE` | process execution |
| stdout/stderr collection | bounded process I/O read | unprivileged | none | process execution |
| Exact-child termination | lifecycle mutation | unprivileged where owned | none | child-specific termination |
| Symbol/digest calculation | pure local computation | none | none | digest freeze |
| Evidence normalization | pure bounded computation | none | none | included with approved execution |

Every current record remains `localDaemonContact=NONE` and `networkPolicy=NONE`. Any implementation evidence that a
record may contact a daemon or network produces `COMMAND_SAFETY_BLOCKED`; classification cannot be upgraded in place.
No privileged operation is designed for this Slice.

## 11. Security and Failure Model

The following are fail-closed before or at their first observation: baseline mismatch, unresolved symbol, static or
baseline digest mismatch, executable identity mismatch, unsupported metadata, missing sequencer/termination
capability, dependency mismatch, fixture-versus-real stream semantic mismatch, either stream cap violation, invalid
UTF-8, nonzero/unexpected exit, local-daemon or network detection, termination failure, and evidence-schema failure.

Failure revokes later dispatch, produces only closed bounded evidence, and returns for a new approval. There is no
fallback executable/command/source, automatic repair/retry, expanded output, privilege escalation, alternate host
adapter, or continuation with warnings.

## 12. Future Implementation Entry Requirements

Before a host adapter implementation can be reviewed, it must add fixture/offline coverage for:

- `DependencyState` binding `executionBaselineDigest`;
- dependency validation of recomputed `argvDigest` and exact `evidenceClass`;
- structural stop-on-first-failure and unexported adapter capability;
- explicit `Object.create(null)` canonicalization behavior;
- rejection or an exact documented contract for array non-index own string properties;
- line-cap equality and one-line-over-cap behavior;
- missing `ExecutionBaselineBinding`;
- symbol-dependency guard; and
- real-adapter chunk semantics matching the accepted fixture limiter without host execution in unit tests.

These requirements do not reopen or weaken acceptance of F0-R and do not authorize implementation.

## 13. Slice Order and Independent Approvals

```text
5C-EG-F0-H  = this host-adapter/sequencer architecture plan
5C-EG-F0-HI = offline host-adapter and sequencer implementation with mocked process/metadata APIs
5C-EG-F0-HV = independent static, import-boundary, and fixture validation
5C-EG-F0-X  = exact host reads, symbol values, static digest, baseline digest, and execution approval
5C-EG-F0-E  = bounded stop-on-first-failure F0/F1 execution
```

HI needs implementation approval; HV is read-only/offline; X separately approves exact host reads, process and
termination operations, and both digest freezes; E separately approves live execution of the already frozen chain.
No approval inherits between Slices, and Push/PR/Merge remain separate.

## 14. Decisions

| Decision | Status | Decision and rationale |
|---|---|---|
| `HOST_ADAPTER_OWNER` | `DECIDED` | Private `host/` boundary under the existing non-production runner owner; prevents production/Core dependency. |
| `PROCESS_API` | `DECIDED` | Exact absolute executable plus immutable argv via `node:child_process.spawn` with `shell=false`; preserves streams and avoids shell interpretation. |
| `SEQUENCER_OWNER` | `DECIDED` | Single-use `StopOnFirstFailureSequencer` owns capability, order, state, evidence, and termination. |
| `STOP_ON_FIRST_FAILURE_ENFORCEMENT` | `DECIDED` | Unexported adapter plus one-use opaque dispatch token; terminal transition revokes all later dispatch. |
| `EXECUTION_BASELINE_DIGEST_OWNERSHIP` | `DECIDED` | Approved context factory canonicalizes binding; sequencer/evidence/dependencies carry the resulting digest. |
| `DEPENDENCY_REPLAY_BINDING` | `DECIDED` | Static digest + baseline digest + HEAD/root + argv/evidence/executable identity and schema versions. |
| `EXECUTABLE_IDENTITY_READ_CLASS` | `DECIDED` | Runner-internal exact-path host safety read requiring separate host-read approval. |
| `PROCESS_TERMINATION_CLASS` | `DECIDED` | Exact-child lifecycle mutation, mandatory and separately explicit within future execution approval. |
| `STATIC_DIGEST_FREEZE_SEQUENCE` | `DECIDED` | Baseline verify, symbols resolve, contract validate, static freeze, baseline freeze, then eligibility. |
| `COMMAND_ORDER` | `DECIDED` | Exact 16-record order in section 6; repository baseline, source, then installed paths. |
| `IMPLEMENTATION_SLICE_BOUNDARY` | `DECIDED` | HI/HV remain offline; X/E separately gate host reads, process execution, digest freeze, and live run. |

## 15. Approval Boundary

```text
STAGE_2B_SLICE_5C_EG_F0_H_PLAN =
  READY_FOR_INDEPENDENT_REVIEW

REAL_HOST_ADAPTER_IMPLEMENTATION_APPROVED = NO
HOST_READS_APPROVED = NO
PROCESS_EXECUTION_APPROVED = NO
CANONICAL_DIGEST_FREEZE_APPROVED = NO
F0_F1_EXECUTION_APPROVED = NO
PRIVILEGED_READ_APPROVED = NO
LOCAL_DAEMON_CONTACT_APPROVED = NO
NETWORK_TESTING_APPROVED = NO
HOST_MUTATION_APPROVED = NO
PROVIDER_EXECUTION_APPROVED = NO
PUSH_APPROVED = NO

NEXT_ACTION =
  CLAUDE_INDEPENDENT_HOST_ADAPTER_PLAN_REVIEW
```
