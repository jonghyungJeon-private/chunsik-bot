# Stage 2B Slice 5C-EG-F0-XR-FP Filesystem Provenance Feasibility Plan

## 1. Status, Baseline, and Method

- **Status:** plan/static feasibility only; ready for independent review.
- **Baseline:** `main` at `08cbf543f222d407efd00ac2351bfd2c02619ecf`.
- **Accepted authority:** ADR-0065 and ADR-0066 are ratified; F0-XR-FCI is complete and accepted.
- **Method:** repository and previously captured primary-source analysis only. No filesystem provenance API, host
  metadata read, mount traversal, native helper, process, signal, `kqueue`, daemon, provider, or network operation
  was executed.

This Slice does not reopen cancellation containment. It preserves:

```text
XR_BOUNDED_PROCESS_CONTAINMENT = IMPLEMENTED_OFFLINE
ORPHAN_DISPOSITION = RESIDUAL_ACCEPTED_WITH_REQUIRED_SELF_WATCHDOG
LOCAL_FILESYSTEM_PROVENANCE_PREFLIGHT = BLOCKED_FEASIBILITY_GAP
```

## 2. Narrow Required Claim

The earlier wording, “every filesystem object participating in the approved observation path is backed by a locally
attached mount,” overclaims physical backing and underclaims mediation. A locally mounted APFS namespace can still
contain File Provider-managed or on-demand content, while a path lookup can cross an automount boundary before the
target exists. XR needs this narrower operational claim:

> For the exact approved path and each namespace or mount transition used to resolve and observe it during one XR
> attempt, a bounded authoritative observation classifies the serving filesystem and mediation mode as allowed by
> the closed policy; rejects network, File Provider, FUSE/third-party daemon, autofs/automount, removable when not
> explicitly allowed, and unknown provenance; binds the classified mount identities to the attempt; and detects any
> relevant binding change before evidence admission.

This claim does not assert physical-media ancestry, absence of all operating-system daemons, atomicity with the
kernel, or physical cancellation. “Non-daemon-mediated” means no filesystem/content provider outside the explicitly
accepted base macOS/APFS implementation, not that ordinary kernel and OS services never participate. Local removable
media is a separate policy class and is denied in XR v1 because no approval currently allows it.

```text
XR_REQUIRED_PROVENANCE_CLAIM = DEFINED
```

## 3. Darwin Namespace Model

The model must keep four facts separate:

1. **Namespace resolution:** `lstat`, symlinks, mount crossings, autofs triggers, synthetic entries, and firmlinks
   decide which object is reached.
2. **Serving mount:** Darwin mount identity and flags describe the filesystem currently serving that object.
3. **Volume/media topology:** APFS volume role, volume group, and optional block-device attachment describe storage
   topology, but do not prove per-path File Provider or daemon absence.
4. **Content mediation:** File Provider placeholders/materialization and FUSE or other user-space filesystems can
   preserve local-looking path and metadata behavior while delegating semantics outside ordinary APFS storage.

Consequently, an absolute path proves syntax only; `realpath` proves one observed canonical resolution only; `dev`
binds an object to a filesystem device only within the observed namespace; and filesystem type classifies the
serving implementation only. None alone proves approved provenance.

Modern macOS also exposes a sealed System volume paired with a writable Data volume. Firmlinks make selected logical
paths traverse that pair without behaving like user-created symlinks. Synthetic paths may provide namespace roots
or mount points. These platform-defined transitions need explicit, closed recognition; they are not a generic
exemption for arbitrary mount crossing.

## 4. Authority-Source Matrix

| Source | Pure Node | New/native or service authority | Mount identity | Local/network | Provider/daemon provenance | Race and side-effect limit |
|---|---|---|---|---|---|---|
| Node `statfs` / `statfsSync` | yes | none beyond host read | device/type and capacity projection only; no complete Darwin mount tuple | type heuristic only through exposed fields | no | resolving the supplied path can trigger automount/provider work; result is immediately stale |
| Node `stat` / `lstat` | yes | none beyond host read | object `dev`/inode, not stable mount identity | no | no | per-component/path binding races; `stat` follows the final symlink |
| Darwin `statfs` | no | narrow native binding | type, mount-on/from names, flags and filesystem id snapshot | `MNT_LOCAL` and type improve classification | no authoritative File Provider/content mediation proof | path lookup can trigger forbidden work; snapshot is not atomic with XR |
| `getfsstat` / `getmntinfo` | no | narrow native binding | bounded system mount snapshot with the same Darwin fields | can reject known non-local/network/autofs entries | no per-path provider proof; FUSE may require closed type denylist | avoids target traversal but lexical longest-prefix mapping is not authoritative across namespace transitions; snapshot changes |
| APFS attributes/volume identity | not completely | native filesystem attributes and possibly broader APIs | volume UUID/role/group can strengthen identity | APFS does not imply locally attached or non-provider | no | topology may change; APFS identity does not bind a later pathname read |
| Firmlink knowledge | no public complete Node model | reviewed, version-bound platform model or authoritative native fact | identifies an accepted System/Data transition only | no | no | static tables can drift across OS versions; generic `realpath` does not expose firmlink semantics |
| Disk Arbitration | no | framework session/service contact and new authority | maps mounted volume to BSD disk/media description | attachment facts improve local/removable classification | no per-file provider proof | asynchronous and non-atomic; violates current no-daemon/service-contact boundary |
| IOKit | no | native kernel/registry inspection authority | can trace some block devices and attachment properties | improves physical/local/removable classification | cannot classify File Provider or arbitrary FUSE namespace mediation | mount-to-device mapping and registry observation are non-atomic |
| File Provider indicators | no authoritative closed API in current Node surface | supported domain/item interrogation would require File Provider framework/service authority; private xattrs are inadmissible | not a mount identity | no | potentially authoritative only for the queried provider domain/item, subject to API contract | query may contact system/provider machinery or materialize; absence of a marker is not proof of absence |
| automount indicators | no complete Darwin flags | native mount flags/type snapshot | identifies an already visible autofs/automounted mount | can reject it | identifies automount mediation, not the eventual backing before trigger | target observation may itself trigger mount and network/daemon work |
| network flags/types | Node type only | native flags/source/type | part of mount tuple | useful positive rejection; not a universal negative proof | does not reject local-advertising user-space/provider mediation | mount replacement and new automount remain possible |

`f_mntfromname`, mount labels, server names, and full mount paths are sensitive observation inputs, not evidence
payloads. CLI tools such as `mount`, `df`, `diskutil`, and `ioreg` are rejected: they add shell/process/executable and
often service authority without making the result atomic.

## 5. Node-Only and Native Feasibility

Node can correlate `lstat`/`stat` device identities with `statfs` type and can reject a closed set of known network
types. It cannot read the complete Darwin mount tuple and flags, establish APFS System/Data firmlink semantics,
classify physical attachment/removability, or authoritatively exclude File Provider, FUSE daemon mediation,
automount, and unknown future filesystems. A type denylist is not a proof that all forbidden categories were
distinguished.

```text
NODE_ONLY_PROVENANCE = INSUFFICIENT
```

Direct `statfs` plus `getfsstat`/`getmntinfo` can supply a stronger mount snapshot without contacting Disk
Arbitration. It can positively reject `MNT_LOCAL` absence, autofs/automounted flags when exposed, known network
types, unknown types, and mount changes. It remains unable to prove File Provider absence within an APFS namespace,
physical attachment for every source, or a complete supported firmlink mapping. `MNT_LOCAL` is a useful network
classification fact, not an attestation of non-provider/non-daemon provenance. IOKit can add media facts but not the
missing per-path mediation fact.

```text
DARWIN_NATIVE_PROVENANCE = PARTIAL_ONLY
```

## 6. File Provider and Daemon-Mediated Paths

Yes: a path can be absolute, `stat`-able, `realpath`-able, and served through an APFS-looking local namespace while
its content availability or materialization is controlled by File Provider or a cloud/provider daemon. Ordinary
mount type, `dev`, and mount-local flags therefore cannot distinguish the forbidden condition.

The required authoritative fact would be a supported, versioned OS assertion for the exact resolved item and its
domain that it is not File Provider-managed and needs no provider-mediated materialization for the approved metadata
operations. The reviewed current boundary contains no such offline mount-table fact. Filename layout, Mobile
Documents paths, placeholder suffixes, undocumented extended attributes, process lists, and absence of a known
provider domain are heuristics and must fail closed. Supported File Provider interrogation would introduce service
or daemon authority and requires separate architecture review; even then, its negative-proof and no-materialization
contract must be demonstrated before selection.

FUSE and other third-party filesystems are likewise daemon-mediated even when they advertise themselves as local.
A closed filesystem-type allowlist can reject observed FUSE types, but cannot prove that APFS namespace content is
not independently provider-mediated.

```text
FILE_PROVIDER_PROVENANCE_DETECTION = REQUIRES_DAEMON_OR_NEW_AUTHORITY
```

## 7. Network Filesystems and Automount

Known NFS, SMB, WebDAV, sshfs/FUSE, and their observed automounted instances can be rejected using a combination of
Darwin mount flags and a closed filesystem-type policy. `MNT_LOCAL` absence is stronger than name matching for
ordinary network volumes. It still does not establish an exhaustive negative: a third-party/user-space filesystem
may advertise local semantics, a new unknown type must be rejected, and an untriggered autofs path has no final
backing mount to classify.

```text
NETWORK_FILESYSTEM_DETECTION = PARTIAL_ONLY
```

Metadata traversal can be the operation that triggers autofs. Preflight can therefore mutate mount state and cause
daemon or network activity merely by trying to classify the final path. A mount-table snapshot may safely reject an
already represented autofs boundary without traversing it, but it cannot resolve the eventual target while both
network and daemon contact remain unapproved. Any path at or below an unresolved automount trigger fails closed.

```text
AUTOMOUNT_PROVENANCE = BLOCKED
```

## 8. Mount Identity, Component Scope, and Firmlinks

### Mount identity

XR needs an attempt-local identity, not a claim of globally permanent mount identity. The candidate internal tuple
is:

```text
Darwin filesystem id + object device id + filesystem type + canonical mount point
+ normalized mount source identity + security-relevant mount flags
+ volume UUID/role/group when authoritatively available
```

The filesystem id/device pair and mount tuple bind the current serving mount; type and flags classify it; volume
identity disambiguates APFS remount/replacement where available. Mount source and paths are input-only and must be
digested or reduced before evidence emission. No individual field is authoritative across remounts, cloned APFS
volumes, namespace rebinding, or provider state. Because the provider/firmlink fields are unavailable under current
authority, the full identity model is incomplete.

```text
MOUNT_IDENTITY_MODEL = PARTIAL
```

### Path-component scope

Checking only the final target misses a symlink, mount point, synthetic namespace, or automount transition used to
reach it. Checking only textual components also misses firmlinks and mount replacement. The future model must walk a
bounded number of already approved path components without following an unclassified transition, record each
symlink observation required by XR, and classify every distinct serving mount before crossing it. The exact approved
paths provide the deterministic component bound; no directory crawl or mount-table persistence is allowed.

```text
PROVENANCE_CHECK_SCOPE = FULL_COMPONENT_MODEL
```

### Firmlinks

A firmlink is an OS-defined System/Data namespace transition and may make the logical path, physical volume path,
and mount/volume role differ. A future classifier may accept only a version-bound, authoritative mapping between the
sealed System volume and its paired Data volume, with both identities allowed and bound. It must never generalize
that exception to other mount crossings. Current Node and generic mount-prefix observations do not provide the
complete authoritative mapping.

```text
FIRMLINK_MODEL = REQUIRES_NATIVE_PROOF
```

## 9. TOCTOU and Bounded Observation Budget

Preflight cannot freeze the mount namespace, provider state, path bindings, automount outcome, or media replacement.
An `ApprovedPathToken` binds authorization, not mount reality. The strongest feasible model is a two-snapshot
protocol: obtain a pre-observation mount snapshot and per-component/object bindings, execute the already accepted
bounded XR observation, repeat the relevant mount and binding observations, and admit evidence only if the closed
identity set and policy classifications match. This detects some changes but is not atomic and cannot prove that a
transient replacement or provider transition did not occur between observations.

```text
PROVENANCE_TOCTOU_MODEL = PARTIAL
```

For `P` approved paths with at most `C` components each and `M` distinct encountered mounts, a future attempt may
use at most two bounded mount snapshots, `2 * P * C` component binding observations, and `2 * M` mount/volume
classifications, with compile-time/configuration caps on `P`, `C`, and `M`. Duplicate mounts are classified once per
phase. Any overflow, new transition, snapshot truncation, timeout, or identity mismatch fails the whole attempt.
There is no filesystem crawl and no interrogation of unrelated mount entries beyond in-memory filtering of the
bounded snapshot.

This observation budget is a design bound only. Executing any member remains unapproved, and path-component reads
may themselves cross the forbidden boundary before classification; implementation must solve that bootstrap issue.

## 10. Privacy and Closed Failure Taxonomy

Evidence may contain only the closed classification, policy/model version, approved-path-relative component index,
a keyed or domain-separated digest of the bounded mount identity, pre/post equality facts, and one closed failure
reason. It must not persist the full mount table, absolute/unrelated mount paths, mount source, usernames, volume
labels, network server/share names, provider/domain/account identifiers, BSD disk names, raw flags, or native error
text. Diagnostic raw values may exist only ephemerally inside the bounded helper and must be zero-retention.

```text
PROVENANCE_EVIDENCE_PRIVACY = DEFINED
```

Closed failure reasons:

- `UNKNOWN_FILESYSTEM`
- `NETWORK_FILESYSTEM_DETECTED`
- `PROVIDER_BACKED_DETECTED`
- `DAEMON_MEDIATED_DETECTED`
- `AUTOMOUNT_AMBIGUITY`
- `REMOVABLE_MEDIA_NOT_ALLOWED`
- `MOUNT_IDENTITY_MISMATCH`
- `MOUNT_CHANGED_AFTER_PREFLIGHT`
- `PATH_BINDING_CHANGED`
- `FIRMLINK_MODEL_UNSUPPORTED`
- `NATIVE_PROVENANCE_UNAVAILABLE`
- `PROVENANCE_OBSERVATION_TIMEOUT`
- `PROVENANCE_BUDGET_EXCEEDED`
- `PROVENANCE_UNVERIFIABLE`

Errors expose no raw host strings. Unknown native codes map to `PROVENANCE_UNVERIFIABLE`.

## 11. Architecture Options and New Authority

### A. `PURE_NODE_PROVENANCE` — reject

It lacks mount flags/source, authoritative firmlink/APFS role facts, attachment identity, and File Provider/daemon
classification. More Node calls cannot synthesize facts the API does not expose.

### B. `BOUNDED_DARWIN_NATIVE_PROVENANCE` — reject as complete solution

`statfs` plus a mount snapshot is the smallest useful rejection layer, but it cannot close File Provider mediation,
the firmlink model, physical attachment, or TOCTOU. It is suitable only as a future partial primitive.

### C. `NEW_STRICT_PROVENANCE_HELPER` — reject under current claim and authority

A narrow helper could safely wrap only `getfsstat`/`getmntinfo`, `statfs`, approved volume attributes, and possibly
reviewed IOKit queries. It would receive the exact approved paths, fixed caps, and deadline; return only closed
classes/digests/reason codes; and must never expose arbitrary paths, enumerate results to callers, invoke a shell or
command, open file content, contact Disk Arbitration/File Provider/provider processes, trigger materialization,
access network, mutate mounts, or issue tokens/evidence decisions. That authority still cannot obtain the missing
supported per-item provider negative fact, so creating it now would not resolve the blocker.

### D. `DAEMON_ASSISTED_PROVENANCE` — reject for this Slice

File Provider or Disk Arbitration assistance may supply additional positive facts, but daemon contact is explicitly
unapproved, Disk Arbitration does not close per-file provider mediation, and no reviewed API contract yet proves the
required negative without triggering provider work. D is not selected merely because C is incomplete.

### E. `PROVENANCE_REMAINS_BLOCKED` — select

The exact missing fact is an authoritative, bounded, non-materializing classification of File Provider/other daemon
mediation for every participating object, plus an accepted firmlink/attachment model and a residual-risk decision
for non-atomic pre/post binding. No currently approved Node or direct Darwin mount API supplies that conjunction.

```text
PROVENANCE_ARCHITECTURE_OPTION = E
LOCAL_FILESYSTEM_PROVENANCE_PREFLIGHT = BLOCKED_FEASIBILITY_GAP
```

## 12. Ownership, Future Validation, and XR-AX Gate

Provenance is a parent-side preflight dependency. It does not own child lifecycle, watchdogs, signals, containment,
`ApprovedPathToken` issuance, XR evidence eligibility, routing, or Provider policy. XR-FCI does not own mount or
provider classification. Dependency remains from the future XR orchestrator to these separate, narrow mechanisms;
neither mechanism imports the other or Core/provider composition.

Future work, if architecture authority changes, starts offline with synthetic mount snapshots, APFS System/Data
volume groups, versioned firmlink fixtures, network/FUSE/File Provider/autofs fixtures, removable-media policy,
unknown types, snapshot truncation, mount replacement, path-binding races, timeout, and privacy projection. Fakes
must prove the bounds and fail-closed taxonomy before any host interrogation is proposed.

FCI carryover is recorded without remediation:

```text
CLEAN_TERMINAL is containment proof, not operation success.
Consumer success requires outcome === SUCCESS.
Same-record retry is structurally forbidden at the orchestration boundary.
```

`XR_AX_ELIGIBLE` can become `YES` only when all of these are independently satisfied: accepted F0-XR-FCI;
implemented and independently accepted provenance preflight closing the claim above; the remaining code-sign gate;
a frozen exact XR-AX plan and baseline; and separate Strict approval for the one bounded live execution. Provenance
acceptance cannot inherit process, signal, code-sign, provider, network, daemon, or live-read authority.

## 13. Decision

```text
STAGE_2B_SLICE_5C_EG_F0_XR_FP_PLAN = READY_FOR_INDEPENDENT_REVIEW
XR_REQUIRED_PROVENANCE_CLAIM = DEFINED
NODE_ONLY_PROVENANCE = INSUFFICIENT
DARWIN_NATIVE_PROVENANCE = PARTIAL_ONLY
FILE_PROVIDER_PROVENANCE_DETECTION = REQUIRES_DAEMON_OR_NEW_AUTHORITY
NETWORK_FILESYSTEM_DETECTION = PARTIAL_ONLY
MOUNT_IDENTITY_MODEL = PARTIAL
PROVENANCE_CHECK_SCOPE = FULL_COMPONENT_MODEL
FIRMLINK_MODEL = REQUIRES_NATIVE_PROOF
AUTOMOUNT_PROVENANCE = BLOCKED
PROVENANCE_TOCTOU_MODEL = PARTIAL
PROVENANCE_EVIDENCE_PRIVACY = DEFINED
PROVENANCE_ARCHITECTURE_OPTION = E
LOCAL_FILESYSTEM_PROVENANCE_PREFLIGHT = BLOCKED_FEASIBILITY_GAP
XR_AX_ELIGIBLE = NO
NEXT_ACTION = CLAUDE_INDEPENDENT_F0_XR_FP_PLAN_REVIEW
```

The approval boundary remains:

```text
REAL_PROCESS_EXECUTION_APPROVED = NO
REAL_SIGNAL_EXECUTION_APPROVED = NO
XR_ACTUAL_HOST_READ_APPROVED = NO
NETWORK_APPROVED = NO
LOCAL_DAEMON_CONTACT_APPROVED = NO
CODE_SIGN_READ_APPROVED = NO
XR_METADATA_EVIDENCE_EXECUTION_ELIGIBLE = NO
CANONICAL_DIGEST_FREEZE_APPROVED = NO
PUSH_APPROVED = NO
XR_AX_ELIGIBLE = NO
```
