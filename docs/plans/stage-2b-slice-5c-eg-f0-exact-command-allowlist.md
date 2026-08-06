# Stage 2B Slice 5C-EG-F0 Exact Command Allowlist

## 1. Status and Scope

- **Artifact:** exact allowlist and evidence-normalization contract for the first bounded F0/F1 feasibility work.
- **Status:** plan-only; no command in this document is approved or executed by its creation.
- **Document-construction baseline:** `main` at `d0bdba4d72d3c6fe82f1802894a2f3bc52ec5dd6`, local `origin/main` at
  `eae8f802a61b65a4d0336b3d1ba69f5bc341bbff`, ahead/behind `9/0`, tracked/staged clean, 32 existing untracked files.
  The later execution approval must instead bind its exact reviewed allowlist-commit HEAD; it must be the direct child
  of this construction baseline and produce the expected `10/0` divergence. This avoids a self-referential commit SHA
  in the document while preventing an unconstrained HEAD.
- **Purpose:** let an independent reviewer and Chief Architect approve or reject each exact Tier A command for a later
  F0/F1 execution. No approval inherits into Tier B, C, or D.
- **Non-goals:** no PF, process, socket, identity, service, Docker/OrbStack, Ollama, daemon, model-store, network,
  Provider, Runtime, Discord, or database observation or mutation.
- **Architecture status:** remains `BLOCKED_FEASIBILITY_GAP`; no enforcement mechanism is recommended.

## 2. Accepted Static Current-Path Evidence

Repository source currently supports this candidate direct-spawn shape:

```text
STATIC_CURRENT_PATH_EVIDENCE

Current direct-spawn repository path candidate:
- 2 pre-inventory CLI invocations
- 1 Provider generation CLI invocation
- 2 post-inventory CLI invocations
- candidate total = 5 CLI invocations
- candidate direct child-process spawns = 5
```

It is not the final window contract:

```text
STATIC_CURRENT_PATH_EVIDENCE != FINAL_ENFORCEMENT_WINDOW_CONTRACT
```

The count must be recomputed after the Stream B launch mechanism is selected. An operator runner, `launchd` service,
or bounded IPC service may introduce additional process creation and ancestry. Failure paths may stop early, but that
does not raise the successful-path candidate maximum.

The following remain four separate unknowns and may not be collapsed into generic “daemon activity”:

```text
daemon HTTP exchange count = UNKNOWN
cold model-load-triggered daemon activity = UNKNOWN
warm versus cold model behavior = UNKNOWN
hidden adapter exchanges = UNKNOWN
```

F0/F1 does not resolve these unknowns because it executes neither the harness nor a daemon. It only revalidates the
static source facts and records the unknown boundary.

## 3. Tier Model

### Tier A — Exact repository and local static-document reads

Only the exact entries in section 5 are candidates for the first later execution approval. They cover Git baseline,
tracked plan/source identities, static source excerpts, and metadata for two known installed paths.
Each entry is individually rejectable. Approval of one does not approve the others.

### Tier B — Narrow unprivileged host reads

Excluded from the first allowlist and not automatically approved: `id`, `uname`, `sw_vers`, exact-PID `ps`, exact-name
`pgrep`, exact-label `launchctl`, exact-account `dscl`, and other exact host-file metadata not listed in Tier A. They
require a later F2-A delta plan with resolved identifiers, privacy filters, and separate Chief Architect approval.

### Tier C — Privileged or local-daemon-contact reads

Excluded and unapproved: every `pfctl` invocation, Docker client/server call, `orb`/`orbctl` call, Ollama command,
runtime network inspection, and daemon-discovered or privileged model-store metadata inspection. These require
separate F2-B, F2-C, or F2-D plans and approval. A command described as read-only still remains Tier C when it opens a
privileged device or contacts/may wake a local daemon.

### Tier D — Mutating or execution-bearing actions

Permanently excluded from F0/F1: PF apply/flush/enable/disable/state kill; daemon lifecycle; container/VM creation,
start, stop, or removal; user/group creation; ACL/permission mutation; model copy/pull/delete/prune; Provider
generation; network/localhost tests; packet capture; Runtime/Discord/DB activity; cleanup; Push/PR/Merge.

## 4. Common Execution Envelope

Every candidate command has this fixed envelope unless its record narrows it further:

- Working directory: `/Users/seongsujeonjonghyeong/demo_Project/chunsik-bot-2`.
- No login/interactive shell, pipelines, redirections, aliases, functions, command substitution, globbing, or fallback.
- Exact executable realpath and approved identity must match before invocation. The runner performs this validation
  internally on only the exact configured path, without a shell lookup, broad path search, or additional Tier A
  command. Mismatch stops before launch; missing runner capability yields `COMMAND_SAFETY_BLOCKED`.
- Environment: empty/minimal runner-owned environment, with only `LC_ALL=C` and `LANG=C`. No inherited proxy,
  credential, GitHub, Discord, Docker, OrbStack, Ollama, pager, or manual variables.
- No stdin. One invocation per command id. Timeout: 5 seconds.
- Capture is bounded before parsing. Raw bytes are held only in memory, never logged or persisted, and discarded after
  normalization. An error path stores only an `exitClass` and bounded reason code.
- `Unexpected or unfilterable output → discard → stop → do not retain raw output.`
- Truncation is never success. No broader command, alternate executable, retry, or automatic substitution follows.

## 5. Exact Tier A Command Records

The approvable set has `TIER_A_RECORD_COUNT = 16`; its arithmetic is `original 17 + F0-GIT-00 - F1-MAN-01 -
F1-MAN-02 = 16`. Every approvable entry has `Approval status = CANDIDATE_ONLY_NOT_APPROVED`. Exact argv below is
represented as a JSON string array to avoid shell-quoting ambiguity. A record is the union of its narrative fields
and its mandatory row in the section 5 execution matrix; a missing matrix row makes that record non-approvable.

### F0-GIT-00 — Effective Git identity

- **Exact executable / expected realpath:** `/usr/bin/git` / `/usr/bin/git`.
- **Exact argv:** `["--version"]`.
- **Working directory:** repository root from section 4.
- **Purpose:** bind the system Git shim and its bounded version result before other Git records.
- **Expected normalized fields:** `gitVersionLine: APPROVAL_BOUND_GIT_VERSION_LINE`; the later execution approval
  supplies one exact full-line logical value and the normalizer requires equality after newline normalization.
- **Output schema:** exact literal regex source
  `^git version [0-9A-Za-z][0-9A-Za-z._+-]{0,63}( \([0-9A-Za-z][0-9A-Za-z ._+-]{0,63}\))?\n?$`, plus equality to
  `APPROVAL_BOUND_GIT_VERSION_LINE`. This permits only the exact prefix, one bounded ASCII primary version token, at
  most one bounded parenthesized ASCII vendor suffix, and an optional final normalized newline. Arbitrary trailing
  text and multiline output are rejected. The suffix is schema compatibility, not a claim about current host output;
  the resolved approval-bound line must satisfy this pattern before canonicalization or execution.
- **Maximum output:** stdout 1 line, 128 bytes; stderr must be empty under the matrix cap.
- **Privilege / daemon / network / lifecycle:** unprivileged; none; none; one short child only.
- **Secret/privacy risk:** low; no redaction expected.
- **Filter/retention:** retain normalized Git version only; discard raw.
- **Stop:** executable identity mismatch, nonzero exit, stderr, malformed/extra output, truncation, or approval-bound
  version mismatch.
- **Evidence class / approval:** `EXECUTABLE_IDENTITY` / candidate only.

### F0-GIT-01 — Branch

- **Exact executable / expected realpath:** `/usr/bin/git` / `/usr/bin/git`.
- **Exact argv:** `["rev-parse","--abbrev-ref","HEAD"]`.
- **Working directory:** repository root from section 4.
- **Purpose:** bind branch to `main`.
- **Expected normalized fields:** `branch: "main"`.
- **Maximum output:** 1 line, 64 bytes; accepted raw pattern `^main\n?$`.
- **Privilege / daemon / network / lifecycle:** unprivileged; none; none; one short child only.
- **Secret/privacy risk:** low; branch only. No redaction expected.
- **Filter/retention:** retain normalized branch, discard raw.
- **Stop:** nonzero exit, any other branch/field, truncation, extra line, executable mismatch.
- **Evidence class / approval:** `REPOSITORY_BASELINE` / candidate only.

### F0-GIT-02 — HEAD

- **Exact executable / expected realpath:** `/usr/bin/git` / `/usr/bin/git`.
- **Exact argv:** `["rev-parse","HEAD"]`.
- **Working directory:** repository root.
- **Purpose:** bind exact execution HEAD supplied by the later approval.
- **Expected normalized fields:** `headSha: APPROVAL_BOUND_HEAD_SHA`, resolved to exactly the full 40-hex
  allowlist-commit SHA named in that approval. The
  approval must independently prove its parent is `d0bdba4d72d3c6fe82f1802894a2f3bc52ec5dd6`; an arbitrary matching SHA is
  not accepted.
- **Maximum output:** 1 line, 64 bytes; accepted pattern `^[0-9a-f]{40}\n?$` plus equality to the approval-bound SHA.
- **Privilege / daemon / network / lifecycle:** unprivileged; none; none; one short child.
- **Secret/privacy risk:** low; no redaction.
- **Filter/retention:** exact SHA only; raw discarded.
- **Stop:** mismatch, malformed/extra output, nonzero exit, truncation.
- **Evidence class / approval:** `REPOSITORY_BASELINE` / candidate only.

### F0-GIT-03 — Local origin baseline

- **Exact executable / expected realpath:** `/usr/bin/git` / `/usr/bin/git`.
- **Exact argv:** `["rev-parse","origin/main"]`.
- **Working directory:** repository root.
- **Purpose:** bind the local remote-tracking ref without fetch/network.
- **Expected normalized fields:** `localOriginMainSha: "eae8f802a61b65a4d0336b3d1ba69f5bc341bbff"`.
- **Maximum output:** 1 line, 64 bytes; exact 40-lowercase-hex equality.
- **Privilege / daemon / network / lifecycle:** unprivileged; none; Git local object read only; one child.
- **Secret/privacy risk:** low; no remote URL is queried or retained.
- **Filter/retention:** SHA only; discard raw.
- **Stop:** mismatch, missing ref, extra output, network attempt, truncation.
- **Evidence class / approval:** `REPOSITORY_BASELINE` / candidate only.

### F0-GIT-04 — Divergence

- **Exact executable / expected realpath:** `/usr/bin/git` / `/usr/bin/git`.
- **Exact argv:** `["rev-list","--left-right","--count","origin/main...HEAD"]`.
- **Working directory:** repository root.
- **Purpose:** confirm behind/ahead counts from local objects.
- **Expected normalized fields:** `behindCount: 0`, `aheadCount: 10`.
- **Maximum output:** 1 line, 64 bytes; accepted literal regex source `^0[ \t]+10\n?$`.
- **Privilege / daemon / network / lifecycle:** unprivileged; none; no network; one child.
- **Secret/privacy risk:** low. Retain two integers only.
- **Stop:** material difference, parse/exit/truncation failure.
- **Evidence class / approval:** `REPOSITORY_BASELINE` / candidate only.

### F0-GIT-05 — Working-tree state

- **Exact executable / expected realpath:** `/usr/bin/git` / `/usr/bin/git`.
- **Exact argv:** `["status","--short"]`.
- **Working directory:** repository root.
- **Purpose:** confirm tracked/staged clean and existing untracked count without reading file contents.
- **Expected normalized fields:** `trackedChangeCount: 0`, `stagedChangeCount: 0`, `untrackedCount: 32`.
- **Maximum output:** 64 lines, 8,192 bytes. Accepted records are two status columns plus a repository-relative path;
  normalizer counts records and retains no paths.
- **Privilege / daemon / network / lifecycle:** unprivileged; none; no network; one child.
- **Secret/privacy risk:** medium because names may be private. `redactionCount` equals discarded path count; raw and
  names are discarded immediately.
- **Stop:** tracked/staged entry, untracked count other than 32, absolute/out-of-root path, malformed record,
  truncation, nonzero exit.
- **Evidence class / approval:** `REPOSITORY_BASELINE_REDACTED` / candidate only.

### F0-GIT-06 — Staged-state cross-check

- **Exact executable / expected realpath:** `/usr/bin/git` / `/usr/bin/git`.
- **Exact argv:** `["diff","--cached","--name-only"]`.
- **Working directory:** repository root.
- **Purpose:** independently confirm the index has no staged paths.
- **Expected normalized fields:** `stagedPathCount: 0`.
- **Maximum output:** 1 line, 1 byte; only empty output accepted.
- **Privilege / daemon / network / lifecycle:** unprivileged; none; none; one child.
- **Secret/privacy risk:** low because success is empty; raw discarded.
- **Stop:** any byte, nonzero exit, truncation.
- **Evidence class / approval:** `REPOSITORY_BASELINE` / candidate only.

### F0-GIT-07 — Accepted tracked identities

- **Exact executable / expected realpath:** `/usr/bin/git` / `/usr/bin/git`.
- **Exact argv:** `["ls-files","--stage","docs/plans/stage-2b-slice-5c-eg-external-egress-enforcement-architecture-plan.md","docs/plans/stage-2b-slice-5c-eg-f-read-only-feasibility-probe-plan.md","apps/chunsik/src/tools/provider-generation-execution.ts","apps/chunsik/src/tools/provider-generation-validation.ts","apps/chunsik/src/provider-routing/ollama-preflight/preflight.ts","apps/chunsik/src/provider-routing/provider-routing-activation.ts"]`.
- **Working directory:** repository root.
- **Purpose:** bind the two accepted plans and four exact source inputs without content execution.
- **Expected normalized fields:** six records with mode `100644`, stage `0`, and this exact path→blob map, independent
  of Git's output ordering:

  | Path | Blob id |
  |---|---|
  | `docs/plans/stage-2b-slice-5c-eg-external-egress-enforcement-architecture-plan.md` | `APPROVAL_BOUND_ARCHITECTURE_PLAN_BLOB_ID` |
  | `docs/plans/stage-2b-slice-5c-eg-f-read-only-feasibility-probe-plan.md` | `7940ab4858b93400273fbf800545459d307114ce` |
  | `apps/chunsik/src/tools/provider-generation-execution.ts` | `c9eb9f9fc1a264dd911d05b003d6e06c0506412c` |
  | `apps/chunsik/src/tools/provider-generation-validation.ts` | `ba91f0aa8be8a256790c63a9b4ac50cab611ba20` |
  | `apps/chunsik/src/provider-routing/ollama-preflight/preflight.ts` | `e56a2970b118396784d4a6ef3ade88b516993194` |
  | `apps/chunsik/src/provider-routing/provider-routing-activation.ts` | `2ebd57e275377bb4d030f27807f85f2c5fe5ed02` |
- **Maximum output:** 6 lines, 2,048 bytes; exact Git index-record grammar.
- **Privilege / daemon / network / lifecycle:** unprivileged; none; none; one child.
- **Secret/privacy risk:** low; paths are approved repository paths. No redaction.
- **Filter/retention:** retain `{path,mode,blobId,stage}` six-record tuple; discard raw.
- **Stop:** missing/extra path, different blob/mode/stage, malformed/truncated output. Output order is normalized by
  exact path and is not itself evidence.
- **Evidence class / approval:** `REPOSITORY_FILE_IDENTITY` / candidate only.

### F0-GIT-08 — Accepted-chain changed paths and Core invariant

- **Exact executable / expected realpath:** `/usr/bin/git` / `/usr/bin/git`.
- **Exact argv:** `["diff","--name-only","eae8f802a61b65a4d0336b3d1ba69f5bc341bbff..HEAD"]`.
- **Working directory:** repository root.
- **Purpose:** project the approved local commit range's paths and confirm no `packages/core/` path appears.
- **Expected normalized fields:** `changedPathCount`, `coreChangedPathCount: 0`, `allPathsRepositoryRelative: true`;
  retain only sorted SHA-256 digest of the path list plus counts, not path names.
- **Maximum output:** 256 lines, 32,768 bytes; repository-relative path grammar only.
- **Privilege / daemon / network / lifecycle:** unprivileged; none; none; one child.
- **Secret/privacy risk:** medium path disclosure; paths are digested/discarded.
- **Stop:** any `packages/core/` path, absolute/traversal path, schema failure, truncation, nonzero exit.
- **Evidence class / approval:** `REPOSITORY_SCOPE_REDACTED` / candidate only.

### F1-SRC-01 — Entrypoint PRE/POST composition excerpt

- **Exact executable / expected realpath:** `/usr/bin/sed` / `/usr/bin/sed`.
- **Exact argv:** `["-n","278,289p","apps/chunsik/src/tools/provider-generation-execution.ts"]`.
- **Working directory:** repository root.
- **Purpose:** show one harness invocation and PRE/POST preflight dependency composition.
- **Expected normalized fields:** booleans `singleHarnessIncrementPresent`, `prePostPhaseTypePresent`,
  `runPreflightDelegatedPresent`; citation `provider-generation-execution.ts:278`.
- **Maximum output:** 12 lines, 4,096 bytes; UTF-8 TypeScript source only.
- **Privilege / daemon / network / lifecycle:** unprivileged; no daemon/network; one `sed` child; source is not run.
- **Secret/privacy risk:** low approved source excerpt. Retain normalized booleans and citation; raw discarded.
- **Stop:** accepted blob identity not established first, missing marker, unexpected binary/control data, truncation.
- **Evidence class / approval:** `STATIC_CURRENT_PATH_EVIDENCE` / candidate only.

### F1-SRC-02 — Generation and PRE/POST lifecycle excerpt

- **Exact executable / expected realpath:** `/usr/bin/sed` / `/usr/bin/sed`.
- **Exact argv:** `["-n","277,353p","apps/chunsik/src/tools/provider-generation-validation.ts"]`.
- **Working directory:** repository root.
- **Purpose:** show PRE once, one-count Provider runner guard/delegation, Gateway generation, and POST once.
- **Expected normalized fields:** `preflightPreCallCount: 1`, `providerRunnerGuardMaximum: 1`,
  `gatewayExecuteCallCount: 1`, `preflightPostCallCount: 1`, with approved line citations.
- **Maximum output:** 77 lines, 16,384 bytes; UTF-8 TypeScript only.
- **Privilege / daemon / network / lifecycle:** unprivileged; none; none beyond `sed`; no source execution.
- **Secret/privacy risk:** low approved source. Raw discarded after exact marker/count parsing.
- **Stop:** file identity missing, count/marker mismatch, truncation, binary/control data, extra output.
- **Evidence class / approval:** `STATIC_CURRENT_PATH_EVIDENCE` / candidate only.

### F1-SRC-03 — Per-preflight direct-spawn excerpt

- **Exact executable / expected realpath:** `/usr/bin/sed` / `/usr/bin/sed`.
- **Exact argv:** `["-n","98,126p","apps/chunsik/src/provider-routing/ollama-preflight/preflight.ts"]`.
- **Working directory:** repository root.
- **Purpose:** show each preflight invokes VERSION then INVENTORY through `processRunner.run` once each.
- **Expected normalized fields:** `versionRunnerCallCount: 1`, `inventoryRunnerCallCount: 1`,
  `orderedVersionBeforeInventory: true`, with exact citations.
- **Maximum output:** 29 lines, 8,192 bytes; UTF-8 TypeScript only.
- **Privilege / daemon / network / lifecycle:** unprivileged; no host/runtime contact; only `sed`; source not run.
- **Secret/privacy risk:** low. Retain facts/citations only; raw discarded.
- **Stop:** blob not prevalidated, count/order mismatch, malformed/truncated output.
- **Evidence class / approval:** `STATIC_CURRENT_PATH_EVIDENCE` / candidate only.

### F1-SRC-04 — Dormant activation gate excerpt

- **Exact executable / expected realpath:** `/usr/bin/sed` / `/usr/bin/sed`.
- **Exact argv:** `["-n","102,134p","apps/chunsik/src/provider-routing/provider-routing-activation.ts"]`.
- **Working directory:** repository root.
- **Purpose:** confirm legacy returns before enforcement and enabled mode verifies exact scope before configuration/
  routing-service construction.
- **Expected normalized fields:** `legacyEarlyReturnPresent`, `missingEnforcementThrowsBeforeConstruction`,
  `verificationBeforeConfiguration`, `scopeMismatchThrows`, `configurationAfterVerification`.
- **Maximum output:** 33 lines, 8,192 bytes; UTF-8 TypeScript only.
- **Privilege / daemon / network / lifecycle:** unprivileged; no host execution; only `sed`; source not run.
- **Secret/privacy risk:** low. Facts and citation only.
- **Stop:** blob identity absent, ordering/marker mismatch, truncation/control data.
- **Evidence class / approval:** `STATIC_ACTIVATION_CONTRACT` / candidate only.

### F1-MAN-01 — Local `pf.conf(5)` template

- **Status:** `NOT_YET_APPROVABLE_TEMPLATE`.
- **Purpose:** reserve a future deterministic-provenance local-documentation record.
- **Reason excluded:** the exact installed manual source identity is unresolved. This template defines no executable,
  argv, evidence claim, or digest input and is excluded from the Tier A count.

### F1-MAN-02 — Local `pfctl(8)` template

- **Status:** `NOT_YET_APPROVABLE_TEMPLATE`.
- **Purpose:** reserve a future deterministic-provenance local-documentation record.
- **Reason excluded:** the exact installed manual source identity is unresolved. This template defines no executable,
  argv, evidence claim, or digest input and is excluded from the Tier A count.

### F1-PATH-01 — Docker symlink target

- **Exact executable / expected realpath:** `/usr/bin/readlink` / `/usr/bin/readlink`.
- **Exact argv:** `["/usr/local/bin/docker"]`.
- **Working directory:** repository root.
- **Purpose:** establish only the exact known Docker path's symlink target; do not execute Docker.
- **Expected normalized fields:** `pathExists: true`,
  `symlinkTarget: "/Applications/OrbStack.app/Contents/MacOS/xbin/docker"`.
- **Maximum output:** 1 line, 256 bytes; exact absolute-path equality only.
- **Privilege / daemon / network / lifecycle:** unprivileged; none; none; one metadata-read child.
- **Secret/privacy risk:** low approved path. No redaction.
- **Stop:** missing/not-symlink/nonmatching target, extra output, truncation, executable mismatch.
- **Evidence class / approval:** `INSTALLED_PATH_METADATA` / candidate only.

### F1-PATH-02 — Docker target metadata

- **Exact executable / expected realpath:** `/usr/bin/stat` / `/usr/bin/stat`.
- **Exact argv:** `["-L","-f","%HT|%Sp|%u|%g|%z","/usr/local/bin/docker"]`.
- **Working directory:** repository root.
- **Purpose:** record bounded target type/mode/numeric owner/size through the exact known symlink.
- **Expected normalized fields:** `fileType`, `mode`, `uid`, `gid`, `sizeBytes`; file type must be regular file and
  mode must contain no group/other write bit. No timestamp is collected.
- **Maximum output:** 1 line, 256 bytes; exact five-field pipe-delimited grammar.
- **Privilege / daemon / network / lifecycle:** unprivileged; no daemon/network; one metadata child.
- **Secret/privacy risk:** low numeric metadata. Raw discarded.
- **Stop:** missing path, nonregular target, unsafe mode, malformed/extra/truncated output.
- **Evidence class / approval:** `INSTALLED_PATH_METADATA` / candidate only.

### F1-PATH-03 — OrbStack app metadata

- **Exact executable / expected realpath:** `/usr/bin/stat` / `/usr/bin/stat`.
- **Exact argv:** `["-f","%HT|%Sp|%u|%g|%z","/Applications/OrbStack.app"]`.
- **Working directory:** repository root.
- **Purpose:** establish only exact app-bundle path/type/mode/numeric owner/aggregate directory-entry size; no
  traversal or app execution.
- **Expected normalized fields:** `pathExists: true`, `fileType: "Directory"`, `mode`, `uid`, `gid`, `sizeBytes`.
- **Maximum output:** 1 line, 256 bytes; five-field pipe-delimited grammar.
- **Privilege / daemon / network / lifecycle:** unprivileged; no daemon/network; one metadata child.
- **Secret/privacy risk:** low approved path. Raw discarded.
- **Stop:** missing/nondirectory/malformed/extra/truncated output or executable mismatch.
- **Evidence class / approval:** `INSTALLED_PATH_METADATA` / candidate only.

### Tier A per-record execution matrix

The following 16 rows are the complete approvable Tier A set. Each row independently defines both streams and the
local-daemon-contact classification. The narrative `Maximum output` for a record means its stdout limit and is
subordinate to this exact matrix if punctuation differs. Every row also fixes `network=NONE`,
`processLifecycle=ONE_BOUNDED_CHILD_NO_DESCENDANTS`, and `timeoutMs=5000`.

| commandId | stdoutMaxLines | stdoutMaxBytes | stderrMaxLines | stderrMaxBytes | localDaemonContact | explicitDependencies |
|---|---:|---:|---:|---:|---|---|
| `F0-GIT-00` | 1 | 128 | 1 | 512 | `NONE` | `SYMBOL_TABLE:RESOLVED` |
| `F0-GIT-01` | 1 | 64 | 1 | 512 | `NONE` | `SYMBOL_TABLE:RESOLVED;F0-GIT-00:SUCCESS` |
| `F0-GIT-02` | 1 | 64 | 1 | 512 | `NONE` | `SYMBOL_TABLE:RESOLVED;F0-GIT-00:SUCCESS` |
| `F0-GIT-03` | 1 | 64 | 1 | 512 | `NONE` | `SYMBOL_TABLE:RESOLVED;F0-GIT-00:SUCCESS` |
| `F0-GIT-04` | 1 | 64 | 1 | 512 | `NONE` | `SYMBOL_TABLE:RESOLVED;F0-GIT-00:SUCCESS` |
| `F0-GIT-05` | 64 | 8192 | 4 | 1024 | `NONE` | `SYMBOL_TABLE:RESOLVED;F0-GIT-00:SUCCESS` |
| `F0-GIT-06` | 1 | 1 | 1 | 512 | `NONE` | `SYMBOL_TABLE:RESOLVED;F0-GIT-00:SUCCESS` |
| `F0-GIT-07` | 6 | 2048 | 4 | 1024 | `NONE` | `SYMBOL_TABLE:RESOLVED;F0-GIT-00:SUCCESS` |
| `F0-GIT-08` | 256 | 32768 | 4 | 1024 | `NONE` | `SYMBOL_TABLE:RESOLVED;F0-GIT-00:SUCCESS` |
| `F1-SRC-01` | 12 | 4096 | 4 | 1024 | `NONE` | `SYMBOL_TABLE:RESOLVED;F0-GIT-07:SUCCESS` |
| `F1-SRC-02` | 77 | 16384 | 4 | 1024 | `NONE` | `SYMBOL_TABLE:RESOLVED;F0-GIT-07:SUCCESS` |
| `F1-SRC-03` | 29 | 8192 | 4 | 1024 | `NONE` | `SYMBOL_TABLE:RESOLVED;F0-GIT-07:SUCCESS` |
| `F1-SRC-04` | 33 | 8192 | 4 | 1024 | `NONE` | `SYMBOL_TABLE:RESOLVED;F0-GIT-07:SUCCESS` |
| `F1-PATH-01` | 1 | 256 | 1 | 512 | `NONE` | `SYMBOL_TABLE:RESOLVED` |
| `F1-PATH-02` | 1 | 256 | 1 | 512 | `NONE` | `SYMBOL_TABLE:RESOLVED` |
| `F1-PATH-03` | 1 | 256 | 1 | 512 | `NONE` | `SYMBOL_TABLE:RESOLVED` |

`localDaemonContact` is a closed enum: `NONE | POSSIBLE | REQUIRED`. Every approvable Tier A record is `NONE`.
`F1-MAN-01` and `F1-MAN-02` are templates, have no execution-matrix row, and cannot be executed.
The approvable ids are exactly `F0-GIT-00` through `F0-GIT-08`, `F1-SRC-01` through `F1-SRC-04`, and
`F1-PATH-01` through `F1-PATH-03`; no other record enters canonical bytes or the digest.

## 6. Commands Excluded from the First Allowlist

The exact allowlist contains no `pfctl`, `ps`, `pgrep`, `lsof`, `launchctl`, `dscl`, Docker client, `orb`, `orbctl`,
Ollama, `du`, `find`, model/home-path `ls`/`stat`, route/socket/network utility, packet capture, Provider, Runtime,
Discord, DB, or cleanup command. `/sbin/pfctl -h` is also excluded. PF manual evidence remains deferred to a later,
separately reviewed allowlist delta.

The following are illustrative only and are not digest inputs:

```text
NOT_YET_APPROVABLE_TEMPLATE

F2-A: exact-PID process projection; exact dedicated account/label after identifiers exist
F2-B: exact privileged PF read after rule/anchor scope is independently reviewed
F2-C: exact Docker/OrbStack local-daemon query after no-autostart and privacy review
F2-D: exact approved model-store metadata after canonical path and confinement review
F3: controlled fixture commands under a separate network/lifecycle design
```

Templates contain no executable/argv and cannot be executed, substituted, or included in the allowlist digest. A
command moves tiers only through an explicit delta plan and approval.

Future `id`/`dscl` dedicated-identity lookups initially test only absence or conflict for a not-yet-created identity.
They must not be normalized as evidence that the identity exists, and they remain outside Tier A.

## 7. Normalized Evidence Contract

```text
CommandEvidence {
  contractVersion: "stage2b-5c-eg-f0-command-evidence-v1"
  schemaVersion: "stage2b-5c-eg-f0-command-evidence-schema-v1"
  allowlistDigest: lowercase SHA-256
  commandId: exact allowlist id
  executableRealpath: exact absolute path
  executableIdentity: exact approved bounded identity object
  argvDigest: lowercase SHA-256 of canonical argv JSON
  workingDirectory: exact repository root
  repositoryBranch: "main"
  repositoryHead: exact approval-bound remediation commit SHA
  privilegeClass: "UNPRIVILEGED"
  localDaemonContact: NONE | POSSIBLE | REQUIRED
  exitClass: SUCCESS | ALLOWLIST_UNRESOLVED | EXPECTED_NOT_FOUND | PERMISSION_DENIED | STDERR_NONEMPTY |
    SCHEMA_MISMATCH | OUTPUT_LIMIT_EXCEEDED | EXECUTABLE_MISMATCH | BASELINE_MISMATCH |
    COMMAND_SAFETY_BLOCKED | EXECUTION_ERROR | UNEXPECTED_EXIT
  stopReason: closed StopReason enum
  stdoutByteCount: non-negative integer
  stderrByteCount: non-negative integer
  normalizedFacts: command-specific closed object
  redactionCount: non-negative integer
  outputTruncated: boolean
  normalizationResult: SUCCESS | NOT_ATTEMPTED | REJECTED
  evidenceClass: command-specific enum
  observedAt: UTC RFC3339 timestamp supplied by the evidence runner
}
```

Rules:

- `normalizedFacts` accepts only the fields and value constraints in section 5; unknown fields reject the record.
- `argvDigest` hashes UTF-8 canonical JSON of the exact argv array, not a shell command string.
- `observedAt` is audit metadata, not feasibility evidence and not part of the allowlist digest.
- Every current Tier A evidence record carries `localDaemonContact=NONE` directly; the field is not inferred from the
  allowlist digest.
- A success record requires exit code zero, empty stderr, `exitClass=SUCCESS`, `stopReason=NONE`,
  `outputTruncated=false`, and complete stdout schema validation. No current Tier A record defines
  `EXPECTED_NOT_FOUND`; that class is available only where a future record explicitly defines it.
- Every non-success class maps deterministically to exactly one closed stop reason. All failures retain
  `normalizedFacts={}`; no positive or partial facts survive.
- `outputTruncated=true` is permitted only on a rejected output-limit/truncation record and never preserves facts.
- `redactionCount` counts discarded path/source records; it never contains redacted values.
- Raw output is discarded for every command. Current execution retains no manual citations or manual-derived facts.

The complete closed stop-reason enum is:

```text
StopReason =
  NONE |
  ALLOWLIST_UNRESOLVED |
  EXPECTED_NOT_FOUND |
  BASELINE_MISMATCH |
  EXECUTABLE_MISMATCH |
  GIT_IDENTITY_NOT_ESTABLISHED |
  NONZERO_EXIT |
  UNEXPECTED_EXIT |
  PERMISSION_DENIED |
  STDERR_NONEMPTY |
  STDERR_OUTPUT_LIMIT_EXCEEDED |
  STDOUT_OUTPUT_LIMIT_EXCEEDED |
  BOTH_STREAM_OUTPUT_LIMIT_EXCEEDED |
  SCHEMA_MISMATCH |
  INVALID_UTF8 |
  PATTERN_MISMATCH |
  OUTPUT_TRUNCATED |
  NORMALIZATION_FAILED |
  LOCAL_DAEMON_CONTACT_DETECTED |
  NETWORK_ACTIVITY_DETECTED |
  COMMAND_SAFETY_BLOCKED
```

Free-form and unknown stop reasons are rejected. `SUCCESS` maps only to `NONE`; `EXPECTED_NOT_FOUND` maps only to
`EXPECTED_NOT_FOUND` when a future record explicitly permits it. `PERMISSION_DENIED` maps to the same stop reason;
`STDERR_NONEMPTY`, `OUTPUT_LIMIT_EXCEEDED`, `EXECUTABLE_MISMATCH`, `BASELINE_MISMATCH`, and `UNEXPECTED_EXIT` map to
their exact same-named or stream-specific reasons. A nonzero exit otherwise maps to
`EXECUTION_ERROR/NONZERO_EXIT`; schema subfailures map deterministically to the most specific listed schema reason.
The remaining exact mappings are: unresolved symbols → `ALLOWLIST_UNRESOLVED/ALLOWLIST_UNRESOLVED`; missing Git
identity evidence → `EXECUTABLE_MISMATCH/GIT_IDENTITY_NOT_ESTABLISHED`; invalid UTF-8, pattern mismatch, output
truncation, or normalization failure → `SCHEMA_MISMATCH` with its same-named stop reason; detected local-daemon or
network activity → `COMMAND_SAFETY_BLOCKED` with its same-named detection reason; and any other safety block →
`COMMAND_SAFETY_BLOCKED/COMMAND_SAFETY_BLOCKED`.

### Output enforcement

The runner applies stdout and stderr byte and line caps independently while streaming, before full buffering. Stream
classification follows `STREAM_PRECEDENCE_POLICY_VERSION = stage2b-5c-eg-f0-stream-precedence-v1`: if both caps are
exceeded, use `OUTPUT_LIMIT_EXCEEDED/BOTH_STREAM_OUTPUT_LIMIT_EXCEEDED`; otherwise stderr cap exceedance uses
`OUTPUT_LIMIT_EXCEEDED/STDERR_OUTPUT_LIMIT_EXCEEDED`, stdout cap exceedance uses
`OUTPUT_LIMIT_EXCEEDED/STDOUT_OUTPUT_LIMIT_EXCEEDED`, and within-cap non-empty stderr uses
`STDERR_NONEMPTY/STDERR_NONEMPTY`. Cap classification precedes generic stderr classification. Every case discards
both buffers, stops F0/F1, and emits no partial facts.
UTF-8 decode failure, NUL, unexpected control bytes, unknown fields, extra records, pattern mismatch, or filter
exception sets `SCHEMA_MISMATCH`, discards raw output, and stops. Empty stdout is valid only for F0-GIT-06.

```text
PATTERN_DIALECT = ECMASCRIPT_2023_UNICODE
PATTERN_DIALECT_VERSION = stage2b-5c-eg-f0-pattern-ecmascript-2023-unicode-v1
REGEX_DOCUMENT_REPRESENTATION = LITERAL_REGEX_SOURCE_TEXT
```

Regexes in this document are the exact logical source text passed to that compiler; Markdown adds no second escaping
layer. A tab escape is written `\t`, a newline escape `\n`, and a literal backslash `\\`. JSON may escape the string
as JSON requires, but deserialization must reproduce exactly the documented logical source, and canonical bytes hash
that logical regex source string. Decode UTF-8 strictly; invalid sequences stop with `INVALID_UTF8`. Normalize CRLF
and CR to LF before matching. Locale character classes are prohibited; use explicit ASCII classes such as `[ \t]`. Patterns
are full-string matches unless a record explicitly declares a bounded-line matcher, flags are fixed by the schema,
and implementation-specific regex extensions are prohibited. F0-GIT-04 therefore uses `^0[ \t]+10\n?$` and matches
spaces or actual tab characters, never the literal characters backslash-plus-`t` or backslash-plus-`n`.

No retry, larger cap, raw-output fallback, alternate parser, or broader command follows.

## 8. Canonical Allowlist and Digest Contract

Contract version: `stage2b-5c-eg-f0-allowlist-v1`.

```text
ALLOWLIST_CANONICALIZATION_VERSION = stage2b-5c-eg-f0-canonical-json-v1
DIGEST_CIRCULARITY = ABSENT
RUNNER_EXECUTABLE_IDENTITY_CAPABILITY = REQUIRED_BEFORE_EXECUTION
APPROVAL_BOUND_SYMBOL_POLICY_VERSION = stage2b-5c-eg-f0-approval-bound-symbols-v1
RAW_OUTPUT_POLICY_VERSION = stage2b-5c-eg-f0-raw-output-v1
MISMATCH_POLICY_VERSION = stage2b-5c-eg-f0-mismatch-v1
```

The global canonical object includes the allowlist contract version, canonicalization version, evidence schema
version, `PATTERN_DIALECT`, `PATTERN_DIALECT_VERSION`, regex-document-representation value,
raw-output-policy version and its closed contents, mismatch-policy version and its closed contents, and stream-
precedence-policy version and its closed contents. Changing any identifier or bound policy content changes the digest.

The canonical allowlist representation is a UTF-8 JSON array ordered by `commandId` ascending. Every object,
including nested objects in expected facts, output schemas, redaction policies, stop conditions, and environment,
recursively sorts keys by Unicode code-point lexicographic order. Each record contains exactly these inputs:

```text
commandId, executable, expectedRealpath, approvedExecutableIdentityContract, argv, workingDirectory, environment,
privilegeClass, localDaemonContact, networkPolicy, processLifecyclePolicy, timeoutMs, stdoutMaxLines, stdoutMaxBytes,
stderrMaxLines, stderrMaxBytes, patternDialect, outputSchema, expectedNormalizedFacts, redactionPolicy,
stopConditions, evidenceClass, explicitDependencies, contractVersion, schemaVersion, canonicalizationVersion
```

Serialization rules:

- Encode UTF-8 with standard JSON escaping, no whitespace, BOM, or trailing newline. Arrays preserve documented
  order. Integers are base-10 with no leading zero; floats are prohibited. Null, undefined, optional, and unknown
  fields are prohibited. Strings and enum values are case-sensitive.
- `environment` is a closed recursively canonical object of exact values; no inherited environment participates.
- `expectedNormalizedFacts` contains the exact closed expected values or constraints from section 5.
- The approval supplies a closed symbol table under
  `APPROVAL_BOUND_SYMBOL_POLICY_VERSION=stage2b-5c-eg-f0-approval-bound-symbols-v1`. Every value whose name begins
  `APPROVAL_BOUND_` must be resolved before canonical serialization, digest computation, command execution, or
  evidence-record creation. The current required names are exactly `APPROVAL_BOUND_HEAD_SHA`,
  `APPROVAL_BOUND_ARCHITECTURE_PLAN_BLOB_ID`, and `APPROVAL_BOUND_GIT_VERSION_LINE`, plus no unknown or extra names.
  An unresolved symbol yields `ALLOWLIST_UNRESOLVED/ALLOWLIST_UNRESOLVED` before the first command. No symbolic value
  enters canonical bytes. `APPROVAL_BOUND_SYMBOL_POLICY_VERSION` is the policy identifier, not a symbol-table key.
- Expected HEAD, local origin SHA, divergence, untracked count, tracked blob ids, Docker symlink target, and the Git
  version expectation belong to `APPROVAL_EXPECTATION_CLASS`, not observations. No timestamp or observed host fact enters
  the static digest.
- The digest is lowercase hex SHA-256 of the canonical UTF-8 bytes.
- The execution approval cites the reviewed digest. The runner recomputes it before the first command and records it
  in every `CommandEvidence`.

The static digest excludes raw output, `observedAt`, all execution observations, the digest field itself, and the
future final documentation commit SHA. It is separate from (1) the execution-baseline binding and (2) the committed
document/blob binding; neither is folded into the static digest. Thus the digest includes neither itself nor a future
commit SHA. This document contains exact Tier A executable/argv entries, but no final digest is calculated or claimed. Independent
review may reject or remove entries, and the later approval must resolve the complete closed symbol table. Only then can that
approval freeze the final canonical bytes and digest. Any command, argv, expected facts, environment, directory,
privilege, cap, schema, redaction, timeout, or stop-condition difference is a new allowlist requiring new approval.

`RAW_OUTPUT_POLICY_VERSION` binds separate stdout/stderr capture, pre-buffer streaming caps, transient in-memory-only
raw bytes, no raw logging or persistence, both-buffer discard on failure, no partial facts, no larger-cap retry, no
alternate parser, and no broader-command fallback.

`MISMATCH_POLICY_VERSION` binds stop before the first non-baseline command and prohibits fetch, repair, clean, stage,
reset, executable fallback, command substitution, alternate source, privilege escalation, broader output, and
automatic retry.

## 9. Baseline Mismatch and Stop Policy

The future execution stops before non-Git Tier A commands if branch, HEAD, local `origin/main`, divergence, tracked/
staged cleanliness, untracked count, accepted plan/source identities, repository root, or allowlist digest differs.
It also stops when an executable is absent or has a different realpath; output schema cannot be enforced; a path read
attempts network/local-daemon contact; an excluded command becomes necessary; or repository/host state
materially differs from the approval.

The runner must resolve each exact executable path without a shell before launch, collect the approved bounded file
identity (realpath, file type, device/inode, mode, owner, size, and code-signing identity where the record requires
it), and compare it to the approval. Prohibited symlink or path drift stops with `EXECUTABLE_MISMATCH`. No new
inspection command is implied. If the runner lacks this capability, F0 returns `COMMAND_SAFETY_BLOCKED` before any
allowlisted command executes.

The future execution approval binds branch `main`; HEAD equal to this remediation commit; parent
`d0bdba4d72d3c6fe82f1802894a2f3bc52ec5dd6`; local `origin/main`
`eae8f802a61b65a4d0336b3d1ba69f5bc341bbff`; divergence `10/0`; tracked/staged clean; 32 existing untracked files;
exact allowlist-document and architecture-plan blobs; the fully resolved closed symbol table; final static allowlist
digest; exact 16 command ids; executable identity contracts; Git version expectation; output schemas; logical regex
source strings; policy versions; evidence schema; and approvable record count 16. Any mismatch stops.

There is no fetch, repair, clean, stage, reset, command substitution, executable fallback, alternate source,
broader output, privilege escalation, or automatic retry. A mismatch produces only a bounded failure result and
returns for new direction.

## 10. F0/F1 Execution and Result Contract

Execution order, if later approved:

1. F0-GIT-00 through F0-GIT-07 establish the exact baseline and identities.
2. F0-GIT-08 confirms the accepted chain/Core path invariant.
3. F1-SRC-01 through F1-SRC-04 normalize static direct-spawn and activation facts.
4. F1-PATH-01 through F1-PATH-03 inspect only the two exact known installed paths.
5. Stop and normalize the result. Do not execute the manual templates or advance to Tier B/C/D.

A successful first execution may establish only repository baseline validity, accepted source-derived invocation
facts, exact OrbStack installation path metadata, absence of mutation/
daemon/network/secret contact in the approved command set, and the Tier B/C approvals still needed.

It cannot establish PF feasibility, OrbStack isolation, CLI identity-launch feasibility, model-store feasibility,
verifier feasibility, or end-to-end enforcement security.

```text
F0_F1_RESULT =
  BASELINE_AND_STATIC_EVIDENCE_ACCEPTED |
  BASELINE_MISMATCH |
  COMMAND_SAFETY_BLOCKED |
  EVIDENCE_INCONCLUSIVE
```

- All 16 exact baseline/schema/source/path checks passing yields `BASELINE_AND_STATIC_EVIDENCE_ACCEPTED` only.
- Git/file identity mismatch yields `BASELINE_MISMATCH`.
- daemon/network contact risk, executable/read-only uncertainty, excluded-command need, or filter safety failure yields
  `COMMAND_SAFETY_BLOCKED`.
- Missing, ambiguous, or conflicting current static/path facts yield `EVIDENCE_INCONCLUSIVE`. PF manual evidence is
  not part of the current execution and remains deferred.

## 11. Later Approval Groups

After independent F0/F1 evidence review, later work remains separately gated:

```text
F2-A = narrow unprivileged process/identity/file metadata reads
F2-B = privileged PF read-only inspection
F2-C = local-daemon-contact OrbStack/Docker reads
F2-D = model-store metadata inspection
F3   = separately designed controlled fixtures
```

No approval, evidence, command, privilege, or safety classification inherits between groups. Each needs exact
identifiers, executable/argv, filters, caps, expected schemas, privacy analysis, stop policy, review, and approval.

## 12. Document Conclusion

```text
STAGE_2B_SLICE_5C_EG_F0_ALLOWLIST =
  READY_FOR_CHIEF_ARCHITECT_FINAL_ACCEPTANCE

TIER_A_RECORD_COUNT =
  16

ALLOWLIST_EXECUTION_APPROVED =
  NO

CANONICAL_DIGEST_FREEZE_APPROVED =
  NO

PRIVILEGED_READ_APPROVED =
  NO

LOCAL_DAEMON_CONTACT_APPROVED =
  NO

NETWORK_TESTING_APPROVED =
  NO

HOST_MUTATION_APPROVED =
  NO

PROVIDER_EXECUTION_APPROVED =
  NO

CORE_CHANGE_REQUIRED =
  NO

NEXT_ACTION =
  CHIEF_ARCHITECT_F0_ALLOWLIST_FINAL_ACCEPTANCE
```

No command in this document may run until independent review and a later exact execution approval freeze the final
canonical allowlist and digest.
