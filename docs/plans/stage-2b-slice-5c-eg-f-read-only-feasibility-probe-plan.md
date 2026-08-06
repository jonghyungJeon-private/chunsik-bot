# Stage 2B Slice 5C-EG-F Read-Only Feasibility Probe Plan

## 1. Status, Purpose, and Boundary

- **Slice:** Stage 2B Slice 5C-EG-F.
- **Purpose:** collect the minimum bounded, read-only evidence needed to decide whether dedicated-identity scoped host
  enforcement (Option A), OrbStack isolation (Option B), both, or neither may proceed to architecture and
  implementation planning.
- **Current architecture status:** `BLOCKED_FEASIBILITY_GAP`; no mechanism is recommended.
- **Meaning of feasible:** implementation planning may proceed. It does not mean enforcement is applied, the
  end-to-end guarantee is proven, Provider generation is approved, or production activation is allowed.
- **This document:** plan-only. It does not approve or execute any host, PF, process, listener, identity, daemon,
  OrbStack, Docker, model-store, network, Provider, Runtime, Discord, database, or secret inspection.
- **Mutation boundary:** no rules, states, identities, users/groups, ACLs, permissions, containers/VMs, daemons,
  models, keys, trust roots, source code, or runtime state may be created, changed, started, stopped, or removed.
- **Repository boundary:** `packages/core/**` remains unchanged. The future probe is evidence collection, not product
  implementation.

The final future probe result is exactly one of:

```text
FEASIBILITY_PROBE_RESULT =
  OPTION_A_FEASIBLE_FOR_IMPLEMENTATION_PLANNING |
  OPTION_B_FEASIBLE_FOR_IMPLEMENTATION_PLANNING |
  MULTIPLE_OPTIONS_REMAIN_FEASIBLE |
  NO_OPTION_PROVEN_FEASIBLE |
  PROBE_INCONCLUSIVE
```

Unknown, redacted, permission-denied, conflicting, stale, or unreviewable evidence never becomes positive evidence.

## 2. Evidence and Review Contract

Every stream records: question, approved command identifier, bounded output schema, observation time, privilege
class, source authority, redactions, result, unknowns/conflicts, and reviewer disposition. Raw transcripts are not
required when a bounded projection suffices. The executor must preserve command exit status and distinguish absence,
permission denial, parse rejection, and command failure.

Evidence levels are:

1. `AUTHORITATIVE_DOCUMENTATION`: local manual or installed vendor documentation;
2. `INDEPENDENT_HOST_OBSERVATION`: narrowly filtered OS/runtime state, not a requested value;
3. `REPOSITORY_FACT`: static code/config inspection without execution;
4. `VENDOR_CLAIM`: useful context but not proof of local enforcement;
5. `UNKNOWN`: missing, unsafe, ambiguous, conflicting, or unapproved.

An implementer may normalize evidence but may not self-approve it. An independent reviewer checks command safety,
raw-to-bounded projection reproducibility, contradictions, privacy redactions, and decision-matrix application.

## 3. Command Classification Rules

Each proposed operation is classified before execution:

```text
UNPRIVILEGED_READ_ONLY
PRIVILEGED_READ_ONLY
MUTATING
UNKNOWN
```

- Only the first two can enter a later approved allowlist.
- `PRIVILEGED_READ_ONLY` requires exact separate approval even if it has no intended mutation.
- `UNKNOWN` is prohibited until an independent safety review reclassifies the exact invocation.
- A command that contacts a local daemon has process/network impact even when its API method is read-only.
- Help/version output is accepted only if documented not to auto-start or contact a daemon; otherwise it remains
  `UNKNOWN`.
- No command substitution, wildcard, recursive home traversal, broad process/socket listing, environment dump, or
  unbounded output is permitted.
- Exact executable realpaths and arguments are frozen in an execution allowlist digest before F0.

## 4. Stream A — Host and PF Capabilities

### Question

Can target-host PF express, order, expose, and independently report a Slice-scoped policy without global disruption,
and what protocol/identity gaps remain?

### Planned inspections

- Read local `pf.conf(5)` and `pfctl(8)` manuals for anchors, labels/counters, `quick`, `user`/`group`, effective
  credential timing, `inet`/`inet6`, TCP/UDP limitations, state inspection, and `pfctl -E`/`-X` references.
- Inspect only the installed PF executable metadata and help surface without opening `/dev/pf` where independently
  classified safe.
- Under separate privileged-read approval, inspect bounded PF status, main rule/anchor ordering, exact relevant
  anchor subtree, labels/counters, enable references, and state-summary capabilities. Never load or flush anything.
- Research from local authoritative documentation whether normal unprivileged Node/Ollama processes can originate
  TCP, UDP, ICMP/ICMPv6, raw sockets, QUIC-over-UDP, Unix sockets, or other routeable families. No packets are sent.
- Determine whether `user`/`group` match effective credentials at socket creation, how descendants inherit process
  credentials, and which protocols cannot be owner-associated.

### State invariant and future prevalidation

**No protected-process connection may exist before enforcement application.**

Future evidence must bind a fresh dedicated identity, show no process under that identity, no listener under that
identity, no protected CLI/daemon socket, and no uncontrolled daemon on the exact endpoint. This is construction-time
exclusion, not PF state eviction. Global state flushing is prohibited. A conflicting pre-existing Slice identity,
process, socket, anchor, or endpoint stops the workflow.

### Evidence and criteria

- **Expected evidence:** authoritative semantic citations; bounded rule/anchor ordering; presence/absence of exact
  labels; PF enable-reference projection; protocol matrix; privilege/read-safety classification; unknowns.
- **Success:** owner semantics and IPv4/IPv6 rules are expressible; protocol gaps are closed by a separately
  inspectable boundary or proven irrelevant to unprivileged protected processes; anchor precedence/coexistence is
  safely placeable; protected-process state exclusion is demonstrable; unrelated processes stay out of scope.
- **Failure:** any required egress path remains possible, rule precedence can be bypassed, safe coexistence cannot be
  bounded, or verification requires global rule/state mutation.
- **Ambiguity:** permission denial, undocumented Apple behavior, optimized/hidden rules, incomplete anchor output, or
  protocol uncertainty yields `UNKNOWN`, never feasibility.
- **Privacy:** retain only rule identities/digests, ordering, bounded labels/counters, and PF reference ownership. Do
  not retain unrelated addresses, states, applications, or traffic.
- **Review:** an independent reviewer validates local manual authority and that host projections correspond to the
  exact inspected kernel state rather than proposed rules.

## 5. Stream B — Dedicated Identity and CLI/Daemon Launch

### Question

Can a non-app owner launch both CLI and daemon under one exact identity before socket creation while exposing only
one bounded approved workflow to the production app?

### Candidates

| Candidate | Process creator and UID/GID question | App communication | Principal attack-surface question |
|---|---|---|---|
| Operator-invoked dedicated runner | Does an operator-owned runner establish effective UID/GID before both daemon and CLI sockets? | Can the app submit a pre-bound one-shot request without elevation? | Can arbitrary executable/argument selection be structurally impossible? |
| Preconfigured `launchd` service boundary | Does a reviewed service identity own daemon and CLI children with auto-restart disabled? | Can a narrow Mach/Unix IPC request carry only an enforcement-window id? | Does service configuration or IPC create a general privileged executor? |
| Preconfigured unprivileged IPC service | Can an already-running dedicated-identity service create only enumerated children? | Exact local socket identity, peer identity, schema, count, and expiry | Can peer spoofing, replay, second instances, and argument injection be rejected? |
| Other host-supported non-app launcher | What installed authoritative mechanism supplies the same guarantees? | Must be bounded and unprivileged | Unknown mechanisms remain prohibited until separately reviewed |

### Planned inspection and criteria

- Inspect local service/identity manuals and only exact relevant service metadata under a separately approved filter.
- For each candidate determine creator, effective UID/GID timing, socket timing, process ancestry/start identity,
  descendant inheritance, executable/argument allowlist, one-window replay protection, second CLI/daemon rejection,
  auto-restart disabling, startup/shutdown owner, app IPC authorization, and privilege surface.
- **Success:** one candidate supplies a non-app creator, establishes the dedicated identity before sockets, accepts
  only one canonical window request without `sudo`/setuid in the app, prevents arbitrary commands/second instances,
  and is independently observable and deterministically stoppable.
- **Failure:** the app must elevate or control service lifecycle, arguments are general-purpose, identity changes
  after socket creation, descendants escape, or auto-restart/second instances cannot be excluded.
- **Ambiguity:** undocumented service behavior, environment-bearing metadata that cannot be safely filtered, or
  missing process-start identity results in `INCONCLUSIVE`.
- **Privacy:** no full `launchctl` domains, environments, unrelated services, or process command lines. Retain only
  bounded exact-label properties and identity facts.
- **Review:** reviewer must verify that process creation and IPC ownership are distinct from the production app.

Decision target:

```text
OPTION_A_CLI_IDENTITY_LAUNCH =
  PROVEN_FEASIBLE |
  PLAUSIBLE_BUT_UNVERIFIED |
  NOT_FEASIBLE |
  INCONCLUSIVE
```

## 6. Stream C — OrbStack Feasibility

### Question

Can the installed OrbStack candidate provide an independently inspectable, no-external-route environment while
preserving only controlled app-to-daemon communication and proportionate local model execution?

### Installed baseline accepted from predecessor review

`/usr/local/bin/docker` resolves to OrbStack's xbin Docker client; `orb`, `orbctl`, OrbStack.app, and
`~/.orbstack/` are present. Presence is not proof of suitability.

### Planned inspections

1. Classify local help/version/manual operations before calling them; exclude any call that may start/contact the
   runtime until separately approved.
2. Inspect installed non-secret documentation for no-route/`none`/internal networking, IPv4/IPv6, DNS, host gateway,
   port forwarding, Unix sockets, routes/interfaces, policy visibility, lifecycle, and deterministic cleanup.
3. Only with separate local-daemon-contact approval, inspect bounded runtime status and exact relevant network/
   container metadata. Do not list all containers, networks, mounts, environment, labels, or credentials.
4. Compare communication patterns:
   - host client to forwarded daemon port;
   - host client to a Unix-socket bridge;
   - app and daemon inside the same isolated environment;
   - dedicated narrow proxy/relay.
   Each must show that it adds neither an external route nor an uncontrolled process. The app cannot manage OrbStack
   lifecycle.
5. Inspect installed documentation/hardware exposure metadata for Metal/GPU passthrough and Ollama acceleration.
   If not authoritative, record CPU-only likelihood as unknown and require a later separately approved controlled
   local benchmark; no benchmark belongs to F.
6. Inspect only exact volume/mount metadata for the proposed model store: ownership, mutability, copy-on-write,
   duplication, and cleanup. Do not inspect model content.

`--network none` and “internal network” are hypotheses, not proof: the probe must separately establish host reach,
implicit gateways, IPv4/IPv6 routes, DNS/DoH/QUIC denial, policy observability, and rollback.

### Evidence and criteria

- **Expected evidence:** vendor/local-doc capability matrix, bounded actual runtime identity/status if approved,
  exact isolation/network projection, communication-pattern analysis, GPU conclusion confidence, volume behavior,
  cleanup ownership, and unknowns.
- **Success:** no external IPv4/IPv6 route, DNS, DoH/QUIC, or implicit host-gateway escape; controlled communication
  does not reopen egress; daemon/isolation identity is unique; policy and cleanup are independently inspectable; model
  storage is bounded; performance risk is acceptable enough for planning.
- **Failure:** host communication requires a route/proxy with external capability, isolation is not inspectable,
  lifecycle must be app-managed, cleanup is unbounded, or product burden is disproportionate.
- **Ambiguity:** vendor claims without local proof, daemon-unavailable results, hidden networking, or unknown GPU/
  volume behavior yields `PLAUSIBLE_BUT_UNVERIFIED` or `INCONCLUSIVE`, never `PROVEN_FEASIBLE`.
- **Privacy:** no Docker environment/config dump, all-container/network listing, registry credentials, mount contents,
  or unrelated metadata.
- **Review:** independent reviewer verifies that local-daemon responses are actual observations and that no command
  created/started anything.

Decision target:

```text
ORBSTACK_ISOLATION =
  PROVEN_FEASIBLE |
  PLAUSIBLE_BUT_UNVERIFIED |
  NOT_FEASIBLE |
  INCONCLUSIVE
```

## 7. Stream D — Model-Store Feasibility

### Question and planned inspection

Can the two approved models, `llama3.1:8b` and `granite3.3:8b`, be exposed to the controlled daemon without content
disclosure, acquisition capability, unsafe shared writes, or disproportionate duplication?

After a separate approval identifies an exact canonical store path without reading secret-bearing environment, use
non-recursive metadata-first inspection. Record store realpath digest, filesystem identity, owner/group/mode, bounded
ACL presence, aggregate byte size, approved manifest/blob identifiers and sizes, and whether observed runtime files
or documentation require locks/metadata writes. Never output model bytes, unrelated entries, or user documents.

Static documentation and narrowly scoped metadata must determine read-only support, minimum writable paths, whether
write access can create manifests/blobs or permit pull, shared-store privilege leakage, dedicated-copy need,
copy-on-write behavior, approximate duplication cost, and preparation-Slice mutations. Ollama commands are excluded
from F because they may contact/start a daemon; runtime write behavior that cannot be learned safely remains unknown
or requires a later separately approved non-generation experiment.

- **Success:** exact store boundary and inventory are projectable without content; minimum writes are known and
  cannot acquire models; ownership is compatible with one selected isolation candidate.
- **Failure:** required writes allow uncontrolled acquisition, content must be exposed, or storage cannot be isolated.
- **Ambiguity:** unknown canonical path, ACL semantics, runtime writes, hidden OrbStack volume behavior, or partial
  inventory yields `UNKNOWN_RUNTIME_WRITE_REQUIREMENTS` or `INCONCLUSIVE`.
- **Privacy:** exact approved subtree only; filtered names/hashes/sizes; no content, recursion outside subtree, or
  environment.
- **Review:** independent reviewer checks path confinement and verifies that digest/inventory projection cannot reveal
  content.

Decision target:

```text
MODEL_STORE_FEASIBILITY =
  SHARED_STORE_PLAUSIBLE |
  DEDICATED_COPY_REQUIRED |
  UNKNOWN_RUNTIME_WRITE_REQUIREMENTS |
  NOT_FEASIBLE |
  INCONCLUSIVE
```

## 8. Stream E — Enforcement-Window Boundability

### Vocabulary

- **Provider generation request:** the single approved app-level generation workflow.
- **CLI invocation:** one invocation of the exact Ollama executable.
- **Process spawn:** one OS child creation; normally one per CLI invocation, but counted separately.
- **Daemon request:** one HTTP exchange with the exact loopback daemon.
- **Inventory invocation:** an allowed CLI invocation used only for PRE or POST inventory/version validation.

### Repository evidence and probe questions

Static repository inspection currently shows one harness invocation, one PRE and one POST preflight, one normal
Provider generation limit, and each preflight invoking exact `--version` then `list`. Thus the current successful
validation workflow appears enumerable as one Provider generation request, one controlled daemon lifecycle, two PRE
CLI/process spawns, one generation CLI/process spawn, and two POST CLI/process spawns: maximum five CLI invocations
and five corresponding child-process spawns. Failure paths may stop earlier. This is a repository fact, not runtime
proof. The exact daemon-request count and any hidden CLI/daemon exchanges remain unknown until adapter semantics can
be established without execution.

The future probe statically traces entrypoint → PRE → generation → POST and records all spawn/runner seams, command
arguments, endpoint/model identities, retry/fallback behavior, time budgets, and projection counts. It determines
whether an app-private window can bind activation/run id, one daemon lifecycle, one generation request, exact
inventory/generation invocations, spawn/command/request maxima, start/expiry deadlines, and rollback identity without
changing Core. No harness is executed.

- **Success:** every permitted spawn/command is statically enumerable; the one generation request is distinguishable
  from its bounded CLI/HTTP exchanges; hidden retry is zero; unknown daemon exchanges can be bounded at the host
  launcher/verifier boundary; an app-private contract suffices.
- **Failure:** unbounded/hidden spawning or daemon exchange cannot be observed/limited, or Core must acquire host
  policy concepts.
- **Ambiguity:** adapter behavior or daemon exchange count cannot be bounded statically and no selected mechanism can
  observe it; result is `INCONCLUSIVE`.
- **Privacy:** source paths and bounded contract facts only; no prompts/responses/runtime output.
- **Review:** independent reviewer reproduces the call graph and count derivation.

Decision target:

```text
ENFORCEMENT_WINDOW_BOUNDABILITY =
  PROVEN |
  REQUIRES_APP_PRIVATE_CHANGE |
  NOT_BOUNDABLE |
  INCONCLUSIVE
```

`CORE_CHANGE_REQUIRED = NO` remains invariant.

## 9. Stream F — Independent Verifier Feasibility

### Question and evidence separation

Can a separately implemented verifier derive enforcement truth from authoritative state instead of echoing a
request or mutator receipt?

```text
application expected scope
  = desired bounded window and identities

mutator receipt
  = claim of what the future mutator applied; never proof by itself

independent host observation
  = PF/isolation/process/listener/store facts read from authoritative state

verifier bounded result
  = canonical comparison and projection of all three, with mismatch/unknown preserved
```

The probe assesses whether a verifier can independently observe PF anchor/rule identity and digest, labels/counters,
enable-reference ownership, daemon/CLI process-start identity, effective UID/GID, executable realpath/digest,
ancestry/descendants, exact listener, store identity/inventory digest, OrbStack container/namespace identity,
routes/interfaces/isolation policy, enforcement-window identity, and rollback identity.

Trust options to evaluate without creating anything are: unsigned immediate bounded result plus independent
re-observation; OS-owned file/IPC identity; signature; MAC; privilege-separated local socket; and a one-time result
file with exact owner/mode checks. For each, identify signer/writer, key or trust root, location, replay/expiry,
app validation, and how the app avoids holding a privileged host secret. A signature is insufficient without exact
scope and fresh host observation.

- **Success:** for a candidate mechanism, authoritative sources expose every material identity/state, the verifier
  can recompute a digest and reject receipt/request mismatches, and trust/replay can be bounded without app-held
  privileged secrets.
- **Failure:** material state is hidden, result can be fabricated by echo, process/listener identity cannot be bound,
  or trust requires giving the app privileged authority.
- **Ambiguity:** undocumented APIs, stale snapshots, incomplete privilege access, or unresolved trust ownership yields
  `PLAUSIBLE_BUT_UNVERIFIED`/`INCONCLUSIVE`.
- **Privacy:** bounded identities/digests/counts only; no raw ruleset, environment, unrelated process/socket list,
  model content, prompt, or response.
- **Review:** verifier feasibility is independently reviewed from mutator feasibility; shared success logic is barred.

Decision target:

```text
VERIFIER_FEASIBILITY =
  PROVEN_FOR_SELECTED_MECHANISM |
  PLAUSIBLE_BUT_UNVERIFIED |
  NOT_FEASIBLE |
  INCONCLUSIVE
```

## 10. Command Safety Table for Future F Execution

Placeholders such as `<exact-label>`, `<dedicated-uid>`, `<exact-pid>`, `<exact-port>`, and `<approved-store>` must be
resolved and frozen in the separately approved allowlist. They must never be supplied through unvalidated shell
expansion. “Allowed” below means only eligible for later consideration; this plan approves none.

| Command or inspection | Purpose | Expected output category | Privilege required | Read-only certainty | Network impact | Process/lifecycle impact | Secret exposure risk | Allowed in future F execution? | Separate approval required? |
|---|---|---|---|---|---|---|---|---|---|
| `uname -a`; `sw_vers` | Bind target OS/build | Bounded host version | No | `UNPRIVILEGED_READ_ONLY` | None | None | Low; redact hostname | Candidate | Yes: F allowlist |
| `stat -f` on exact `/sbin/pfctl` | PF executable metadata | Type/owner/mode/size, no content | No | `UNPRIVILEGED_READ_ONLY` | None | None | Low | Candidate | Yes: F allowlist |
| `/sbin/pfctl -h` | Installed command surface | Help text | No expected | `UNPRIVILEGED_READ_ONLY` only after safety confirmation | None | One short process | Low | Candidate | Yes: F allowlist |
| `man 5 pf.conf`; `man 8 pfctl` with local pager disabled | Authoritative PF semantics | Selected cited paragraphs | No | `UNPRIVILEGED_READ_ONLY` | None | Pager process only | Low | Candidate | Yes: F allowlist |
| `/sbin/pfctl -s info` | PF status/counters | Filtered PF summary | Often yes | `PRIVILEGED_READ_ONLY` | None | Opens PF device; no lifecycle | Medium host-state exposure | Conditional | Exact privileged-read approval |
| `/sbin/pfctl -s References` | Enable-reference ownership | Bounded pid/name/token-time projection; token redacted in retained output | Often yes | `PRIVILEGED_READ_ONLY` | None | None | Medium | Conditional | Exact privileged-read approval |
| `/sbin/pfctl -s Anchors` | Main anchor names/order evidence | Filtered anchor identities | Often yes | `PRIVILEGED_READ_ONLY` | None | None | Medium | Conditional | Exact privileged-read approval |
| `/sbin/pfctl -a <exact-anchor> -sr -v` | Exact anchor rules/labels/counters | Bounded normalized rule projection/digest | Often yes | `PRIVILEGED_READ_ONLY` | None | None | Medium; rules may expose addresses | Conditional only after anchor resolved | Exact privileged-read approval |
| `/sbin/pfctl -sr -v` | Main rule ordering/`quick` context | Redacted normalized ordering, not raw retention | Often yes | `PRIVILEGED_READ_ONLY` | None | None | High host-policy exposure | Conditional only if narrower query insufficient | Exact privileged-read and privacy approval |
| `/sbin/pfctl -ss` | State capability/current-state inspection | Would expose connection state | Often yes | `PRIVILEGED_READ_ONLY` | None | None | High unrelated-connection exposure | No broad use; exact narrower alternative required | New explicit approval if ever necessary |
| Any `pfctl -f`, `-F`, `-e`, `-d`, `-E`, `-X`, `-k`, `-K`, table mutation | Would mutate PF/rules/states/references | Mutation | Yes | `MUTATING` | Host-wide possible | PF lifecycle/state | High | No | Not approvable in F |
| `id <dedicated-user>` / exact directory-service read | Resolve exact identity only | UID/GID/non-login bounded fields | No or directory-dependent | `UNPRIVILEGED_READ_ONLY` if exact | None | None | Low | Conditional after identity name approved | F allowlist; privilege if required |
| `dscl . -read /Users/<exact-user> <approved-attributes>` | Exact account metadata | Whitelisted UID/GID/shell/home fields | Usually no | `UNPRIVILEGED_READ_ONLY` if exact | Local directory service only | No lifecycle | Medium account metadata | Conditional | Exact attributes and local-service contact approval |
| Broad `dscl` list/search or user/group enumeration | Find identities | Broad account data | Varies | `UNKNOWN` for privacy scope | Local service | None | High | No | Narrow alternative required |
| Filtered `ps -o pid=,ppid=,uid=,gid=,lstart=,comm= -p <exact-pid>` | Exact process-start/ancestry identity | Bounded exact-PID fields | No/varies | `UNPRIVILEGED_READ_ONLY` | None | None | Medium; no args/env | Conditional | Exact PID/fields approval |
| `pgrep -u <dedicated-uid> -x <exact-name>` | Detect dedicated-identity process | PID set only | No | `UNPRIVILEGED_READ_ONLY` | None | None | Low if exact UID/name | Conditional | Exact UID/name approval |
| Broad `ps`, `pgrep`, or full command lines | Process discovery | Unrelated process data | No | `UNPRIVILEGED_READ_ONLY` technically, unsafe scope | None | None | High | No | Narrow alternative required |
| `lsof -nP -a -p <exact-pid> -iTCP -iUDP` with field filter | Exact PID network sockets | Protocol/address/port/owner projection | No/varies | `UNPRIVILEGED_READ_ONLY` or privileged for full visibility | None | None | Medium | Conditional | Exact PID/fields and possibly privileged-read approval |
| `lsof -nP -iTCP:<exact-port>` with field filter | Exact endpoint owner | Exact-port PID/UID/listener only | No/varies | `UNPRIVILEGED_READ_ONLY` or privileged | None | None | Medium | Conditional | Exact port and possibly privileged-read approval |
| Broad `lsof` / all listeners | Discover sockets | Unrelated process/network state | Varies | Read-only but privacy-unbounded | None | None | High | No | Narrow alternative required |
| `launchctl print <exact-domain>/<exact-label>` | Exact service properties | Whitelisted label, program, user/group, keepalive/run-at-load fields | No/varies | `UNPRIVILEGED_READ_ONLY` if exact, but output must be filtered | Local service query | Must not start service | High environment/metadata risk | Conditional | Exact label/filter approval after safety review |
| Broad `launchctl print`, list, kickstart, bootstrap/bootout, enable/disable | Broad inspection or lifecycle mutation | Broad data/mutation | Varies | `UNKNOWN` for broad print; lifecycle forms `MUTATING` | Local service | May change lifecycle | High | No | Not approved in F |
| `stat -f` / `ls -lde` on exact approved paths | Executable/store/IPC metadata and ACL presence | Metadata only | No/varies | `UNPRIVILEGED_READ_ONLY` | None | None | Medium path/ACL names | Conditional | Exact paths/fields approval |
| `codesign -dv` or checksum of exact reviewed executable | Executable identity | Signature metadata or digest | No | `UNPRIVILEGED_READ_ONLY` | None | One process/read | Low/medium | Conditional | Exact path/output approval |
| `/usr/local/bin/docker --help` or `version` | Client capability/version | Help/version | Unknown: may contact daemon | `UNKNOWN` until proven client-only | May contact local daemon | May auto-start runtime indirectly | Medium | Not by default | Local-daemon-contact approval after safety proof |
| `docker info` | Runtime capability | Daemon-wide info | No, but daemon contact | `UNKNOWN` for lifecycle/privacy | Local daemon IPC | Could trigger runtime availability behavior | High config/runtime metadata | No broad form | Narrow projection plus explicit approval |
| `docker network inspect <exact-network>` | Exact network routes/options | Network identity/driver/internal/IPAM/options digest | No, daemon contact | `UNPRIVILEGED_READ_ONLY` API if independently confirmed | Local daemon IPC | Must not create/start | High metadata | Conditional | Exact local-daemon-contact/privacy approval |
| `docker inspect <exact-container>` with server-side format | Exact isolation/process/mount identity | Whitelisted formatted fields | No, daemon contact | `UNPRIVILEGED_READ_ONLY` API if confirmed | Local daemon IPC | Must not start | High if env/mounts requested; exclude them | Conditional | Exact object/format approval |
| `docker ps`, network/volume list, unformatted inspect | Discovery | Unrelated runtime metadata | No, daemon contact | Read-only API but privacy-unbounded | Local daemon IPC | None intended | High | No | Exact-object alternative required |
| `orb --help`, `orbctl --help`, version/status forms | Installed OrbStack surface/status | Help/version/bounded status | Unknown per exact subcommand | `UNKNOWN` until installed docs prove read-only/no-autostart | May contact local runtime | May start/wake/change runtime | Medium/high | Not by default | Exact subcommand safety and local-daemon approval |
| Any OrbStack/Docker create/run/start/stop/restart/rm/network/volume mutation | Lifecycle/state mutation | Mutation | Varies | `MUTATING` | Local/external possible | Creates/changes lifecycle | High | No | Not approvable in F |
| Installed OrbStack documentation file read at exact app path | Network/GPU/storage semantics | Selected local documentation excerpts | No | `UNPRIVILEGED_READ_ONLY` | None | None | Low | Candidate | Exact paths approved; no config traversal |
| `du -sk <approved-store>` | Aggregate store size | One aggregate byte/block value | No/varies | `UNPRIVILEGED_READ_ONLY` but traverses approved subtree | None | Filesystem reads | Medium timing/path exposure | Conditional | Exact subtree and privacy approval |
| Bounded `find <approved-store>` with fixed depth/type/printf equivalent | Manifest/blob metadata | Whitelisted relative ids/types/sizes only | No/varies | Read-only but recursion-sensitive | None | Filesystem reads | High if scope wrong | Conditional only with path confinement | Exact command/privacy approval |
| Unbounded `find`, home traversal, model file content read | Discovery/content | Private paths/content | Varies | Read-only but prohibited privacy scope | None | Filesystem reads | Critical | No | Not permitted |
| `ls -le <approved-store>` / exact manifest directory | Owner/mode/ACL and approved entries | Bounded metadata | No/varies | `UNPRIVILEGED_READ_ONLY` | None | None | Medium | Conditional | Exact path/fields approval |
| `ollama --version`, `ollama list`, `ollama show` | Version/inventory/model metadata | CLI/daemon output | No | `UNKNOWN`; may contact/start daemon | Localhost/daemon, possible further behavior | May start/contact daemon | Model/runtime metadata | No in F | Separate later daemon/Provider boundary approval |
| `netstat`, route/interface summaries, `sysctl` exact network keys | Host route/protocol capability | Host network metadata | Varies | Read-only but broad/privacy-sensitive | None | None | Medium/high | Only exact keys/filtered form if essential | Exact approval |
| Any DNS lookup, `curl`, `nc`, `ping`, packet capture, localhost request | Connectivity test | Network result/packets | Varies | May be non-mutating but sends traffic | Network/localhost | May contact daemon/service | High | No | Separate future network-test approval |

No exact command may be automatically substituted after failure. A narrower pre-approved alternative requires its own
allowlist entry and classification.

## 11. Privacy and Secret Boundary

The probe prohibits shell history, full environments, credentials, tokens, keys, model content, unrelated process
arguments, unrelated sockets, unrelated home traversal, browser data, application secrets, GitHub credentials,
Discord tokens, database content, Docker registry auth, and raw host-wide configuration.

Required projections are process identity without environment/full args; exact PID/port socket ownership; file
metadata without content; model sizes and manifest/inventory identities without blobs; filtered rule/network digests;
and runtime help/version/status without configuration secrets. Raw output is ephemeral where possible. Retained
evidence includes command id, exit class, normalized bounded fields, hashes where needed, explicit redaction counts,
and unknown/conflict facts. A filter failure discards output and stops; it never falls back to raw retention.

## 12. Execution Phases for a Later Approved Probe

### F0 — Baseline and allowlist

- Revalidate exact branch/HEAD/origin divergence, tracked/staged state, protected untracked count, OS identity, and
  approved repository root.
- Bind the execution approval to exact command ids/realpaths/arguments, privilege class, filters, expected schemas,
  and an allowlist digest.
- Verify privacy filters with static fixtures. No daemon/runtime/PF-device contact.

### F1 — Documentation and installed capability

- Local PF, launch/service, socket/protocol, and installed OrbStack documentation.
- Static repository window call graph and counts.
- Exact executable/app metadata only. No runtime lifecycle or local-daemon contact.

### F2 — Narrow host state, separately approved

- Exact PF summary/anchor/rule projections; exact endpoint and dedicated-identity process projection; exact
  model-store metadata; and exact OrbStack status/network metadata.
- Privileged reads and local-daemon IPC each require explicit command-level approval.
- No mutation, service start, broad discovery, or secret-bearing output.

### F3 — Optional controlled read-only fixtures

- Only operations independently proven read-only and separately approved after F1/F2.
- No external/localhost network test, Provider generation, container/VM/daemon lifecycle, or model content.
- If a required fact cannot be established without those actions, record the approval dependency and stop.

### F4 — Evidence normalization

- Produce bounded facts, unknowns/conflicts, redactions, command disposition, and canonical decision inputs.
- Do not silently merge vendor claims with local observations.

### F5 — Independent review

- Claude or another independent reviewer checks evidence provenance, safety, privacy, conflict handling, and matrix.
- Implementer cannot self-approve. Mechanism recommendation exists only after this review.

## 13. Stop Conditions

Stop immediately if a command may mutate, start/restart a daemon, create/change a container or VM, contact an
external network, expose secrets/model content/unrelated state, exceed the allowlist, require unapproved privilege,
discover an unexpected daemon/listener, require broad process inspection, traverse outside the approved store,
change OrbStack state, or encounter a materially different repository/host baseline.

Also stop on filter/schema mismatch, unexpected output, symlink/path escape, executable identity drift, inability to
prove read-only behavior, or conflict between authoritative sources. Do not substitute a command, widen scope,
retry through a different interface, or replace a blocked read with mutation.

## 14. Evidence-Based Decision Matrix

### Per-stream gating

| Gate | Option A required disposition | Option B required disposition | Otherwise |
|---|---|---|---|
| PF/protocol | Identity applicability, protocol closure, IPv4/IPv6 expression, safe precedence/coexistence proven enough for planning | Host PF not mechanism-critical, but host bridge must not bypass isolation | Inconclusive or no-option |
| Identity/launch | `OPTION_A_CLI_IDENTITY_LAUNCH = PROVEN_FEASIBLE` | Unique container/VM daemon and non-app lifecycle owner established | Option cannot proceed |
| OrbStack isolation | Not required unless used to close PF gaps | `ORBSTACK_ISOLATION = PROVEN_FEASIBLE` | Option B cannot proceed |
| Model store | Workable shared store or bounded dedicated copy with known writes/preparation | Bounded volume/mount, ownership, writes, duplication | Option cannot proceed |
| Window | `PROVEN` or accepted `REQUIRES_APP_PRIVATE_CHANGE` | Same | Option cannot proceed |
| Verifier | Actual host state inspectable; rollback scoped | Isolation state inspectable; cleanup scoped | Option cannot proceed |
| Proportionality | Unrelated processes unaffected; burden acceptable | Performance/storage/lifecycle acceptable enough for planning | No option proceeds |

### Aggregate outcomes

- `OPTION_A_FEASIBLE_FOR_IMPLEMENTATION_PLANNING`: every Option A gate passes; Option B does not also pass.
- `OPTION_B_FEASIBLE_FOR_IMPLEMENTATION_PLANNING`: every Option B gate passes; Option A does not also pass.
- `MULTIPLE_OPTIONS_REMAIN_FEASIBLE`: every gate for both options passes; later architecture review selects one.
- `NO_OPTION_PROVEN_FEASIBLE`: evidence affirmatively fails at least one mandatory gate for each option, or burden is
  disproportionate.
- `PROBE_INCONCLUSIVE`: required evidence is missing, conflicting, unsafe to collect, permission-blocked, or needs
  separately prohibited mutation/network/generation.

Option A may proceed only with supported PF identity behavior; closure of TCP/UDP/protocol gaps; expressible
non-loopback IPv4/IPv6 denial; protected-process state exclusion by construction; safe anchor precedence/coexistence;
feasible CLI/daemon launch owner and pre-socket identity; unrelated-process isolation; workable store; actual-state
verification; and scoped rollback.

Option B may proceed only with provable no-external-route OrbStack isolation; closed IPv4/IPv6/DNS/DoH paths;
non-bypassing host communication; unique daemon; bounded store; inspectable isolation; deterministic cleanup; and
performance acceptable enough for planning.

Neither proceeds when evidence conflicts, a guarantee is uninspectable, unrelated processes cannot be isolated,
verifier proof remains echoable, rollback cannot be bounded, burden is disproportionate, or required evidence needs
prohibited mutation/live generation.

## 15. Bounded Probe Output

The future report contains only:

```text
HOST FACTS
PF FACTS
IDENTITY/LAUNCH FACTS
ORBSTACK FACTS
MODEL-STORE FACTS
WINDOW-BOUNDING FACTS
VERIFIER FACTS
UNKNOWN OR CONFLICTING FACTS
PRIVACY REDACTIONS
DECISION MATRIX
FINAL FEASIBILITY RESULT
```

Each fact cites a command id/source and observation class. No raw transcript is required where a reproducible bounded
summary suffices. Retained excerpts are scope-limited and redacted. The report separately states commands not run,
permission blocks, local-daemon contacts, privileged reads, and every unresolved approval dependency.

## 16. Plan Conclusion

```text
STAGE_2B_SLICE_5C_EG_F_PLAN =
  READY_FOR_INDEPENDENT_REVIEW

PROBE_EXECUTION_APPROVED =
  NO

HOST_MUTATION_APPROVED =
  NO

NETWORK_TESTING_APPROVED =
  NO

PROVIDER_EXECUTION_APPROVED =
  NO

CORE_CHANGE_REQUIRED =
  NO

NEXT_ACTION =
  CLAUDE_INDEPENDENT_PROBE_PLAN_REVIEW
```

No mechanism recommendation is made. Independent plan review and a subsequent exact execution approval are required
before any feasibility command in this document may run.
