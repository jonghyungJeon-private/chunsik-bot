# Stage 2B Slice 5C-EG-F0 Exact Command Allowlist

## 1. Status and Scope

- **Artifact:** exact allowlist and evidence-normalization contract for the first bounded F0/F1 feasibility work.
- **Status:** plan-only; no command in this document is approved or executed by its creation.
- **Document-construction baseline:** `main` at `97a8f26f4094c195335c27d058efea9bddd4a2ea`, local `origin/main` at
  `eae8f802a61b65a4d0336b3d1ba69f5bc341bbff`, ahead/behind `6/0`, tracked/staged clean, 32 existing untracked files.
  The later execution approval must instead bind its exact reviewed allowlist-commit HEAD; it must be the direct child
  of this construction baseline and produce the expected `7/0` divergence. This avoids a self-referential commit SHA
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
tracked plan/source identities, static source excerpts, local PF manuals, and metadata for two known installed paths.
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
- Exact executable realpath must equal the expected realpath before invocation. Realpath confirmation itself must use
  a separately approved mechanism; mismatch stops the run.
- Environment: empty/minimal runner-owned environment, with only `LC_ALL=C`, `LANG=C`, and for manual commands
  `MANPAGER=cat`, `PAGER=cat`. No inherited proxy, credential, GitHub, Discord, Docker, OrbStack, or Ollama variables.
- No stdin. One invocation per command id. Timeout: 5 seconds for Git/path commands; 10 seconds for `man`.
- Capture is bounded before parsing. Raw bytes are held only in memory, never logged or persisted, and discarded after
  normalization. An error path stores only an `exitClass` and bounded reason code.
- `Unexpected or unfilterable output → discard → stop → do not retain raw output.`
- Truncation is never success. No broader command, alternate executable, retry, or automatic substitution follows.

## 5. Exact Tier A Command Records

All entries have `Approval status = CANDIDATE_ONLY_NOT_APPROVED`. Exact argv below is represented as a JSON string
array to avoid shell-quoting ambiguity.

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
- **Expected normalized fields:** `headSha`: exactly the full 40-hex allowlist-commit SHA named in that approval. The
  approval must independently prove its parent is `97a8f26f4094c195335c27d058efea9bddd4a2ea`; an arbitrary matching SHA is
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
- **Expected normalized fields:** `behindCount: 0`, `aheadCount: 7`.
- **Maximum output:** 1 line, 64 bytes; accepted pattern `^0[[:space:]]+7\n?$`.
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
  | `docs/plans/stage-2b-slice-5c-eg-external-egress-enforcement-architecture-plan.md` | `4bf15edf1b5a4a2cc81bcbdd3bd9739dfef7e71d` |
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
- **Purpose:** project the local six-commit chain's paths and confirm no `packages/core/` path appears.
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

### F1-MAN-01 — Local `pf.conf(5)`

- **Exact executable / expected realpath:** `/usr/bin/man` / `/usr/bin/man`.
- **Exact argv:** `["5","pf.conf"]`.
- **Working directory:** repository root; fixed manual environment from section 4.
- **Purpose:** cite installed authoritative semantics for anchors, `quick`, `user`/`group`, effective credential timing,
  TCP/UDP limitation, `inet`/`inet6`, labels/counters, and state behavior.
- **Expected normalized fields:** manual title/section plus bounded semantic facts and source paragraph digests; no raw
  full manual retained.
- **Maximum output:** 4,096 lines, 262,144 bytes; printable text only. Accepted semantic extractor permits at most 16
  fact records and 32 cited lines, each at most 240 bytes.
- **Privilege / daemon / network / lifecycle:** unprivileged; no daemon/network; `man` may spawn local formatters only.
- **Secret/privacy risk:** low installed public documentation. `redactionCount` covers all uncited lines.
- **Stop:** manual absent, any network attempt, pager interaction, unexpected escape/control sequence after local
  overstrike normalization, truncation, or required semantics absent.
- **Evidence class / approval:** `AUTHORITATIVE_LOCAL_DOCUMENTATION` / candidate only.

### F1-MAN-02 — Local `pfctl(8)`

- **Exact executable / expected realpath:** `/usr/bin/man` / `/usr/bin/man`.
- **Exact argv:** `["8","pfctl"]`.
- **Working directory:** repository root; fixed manual environment.
- **Purpose:** cite read versus mutating command surface, anchors, labels/counters, enable references, and state
  inspection capabilities without invoking `pfctl`.
- **Expected normalized fields:** manual title/section, bounded option-semantics facts and paragraph digests; no raw
  manual retained.
- **Maximum output:** 4,096 lines, 262,144 bytes; printable text; at most 16 facts/32 cited lines/240 bytes per line.
- **Privilege / daemon / network / lifecycle:** unprivileged; no PF device, daemon, or network; local formatters only.
- **Secret/privacy risk:** low. Uncited lines counted as redacted and discarded.
- **Stop:** missing manual, network/pager interaction, control/schema error, truncation, required option semantics
  absent.
- **Evidence class / approval:** `AUTHORITATIVE_LOCAL_DOCUMENTATION` / candidate only.

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

## 6. Commands Excluded from the First Allowlist

The exact allowlist contains no `pfctl`, `ps`, `pgrep`, `lsof`, `launchctl`, `dscl`, Docker client, `orb`, `orbctl`,
Ollama, `du`, `find`, model/home-path `ls`/`stat`, route/socket/network utility, packet capture, Provider, Runtime,
Discord, DB, or cleanup command. `/sbin/pfctl -h` is also excluded: F1 uses the local `pfctl(8)` manual and does not
execute PF tooling.

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

## 7. Normalized Evidence Contract

```text
CommandEvidence {
  contractVersion: "stage2b-5c-eg-f0-command-evidence-v1"
  allowlistDigest: lowercase SHA-256
  commandId: exact allowlist id
  executableRealpath: exact absolute path
  argvDigest: lowercase SHA-256 of canonical argv JSON
  exitClass: ZERO | NONZERO | TIMEOUT | OUTPUT_LIMIT | SCHEMA_REJECTED | EXECUTABLE_MISMATCH
  normalizedFacts: command-specific closed object
  redactionCount: non-negative integer
  outputTruncated: false
  evidenceClass: command-specific enum
  observedAt: UTC RFC3339 timestamp supplied by the evidence runner
}
```

Rules:

- `normalizedFacts` accepts only the fields and value constraints in section 5; unknown fields reject the record.
- `argvDigest` hashes UTF-8 canonical JSON of the exact argv array, not a shell command string.
- `observedAt` is audit metadata, not feasibility evidence and not part of the allowlist digest.
- A success record requires `exitClass=ZERO`, `outputTruncated=false`, and complete schema validation.
- Nonzero/timeout/limit/schema failures retain `normalizedFacts={}` and no raw stderr/stdout.
- `redactionCount` counts discarded path/manual/source records; it never contains redacted values.
- Raw output is discarded for every command. Only normalized records and approved bounded manual citations/digests
  may persist.

### Output enforcement

The runner applies both byte and line caps while streaming, before full buffering. A cap hit sets `OUTPUT_LIMIT`,
discards the buffer, stops F0/F1, and emits no partial facts. UTF-8 decode failure, NUL, unexpected control bytes,
unknown fields, extra records, pattern mismatch, or filter exception sets `SCHEMA_REJECTED`, discards raw output, and
stops. Empty output is valid only for F0-GIT-06.

No retry, larger cap, raw-output fallback, alternate parser, or broader command follows.

## 8. Canonical Allowlist and Digest Contract

Contract version: `stage2b-5c-eg-f0-allowlist-v1`.

The canonical allowlist representation is a UTF-8 JSON array ordered by `commandId` ascending. Each element has
exactly these keys in this order:

```text
commandId
executableRealpath
argv
workingDirectory
environment
privilegeClass
timeoutMs
maxLines
maxBytes
outputSchemaVersion
expectedNormalizedFacts
redactionPolicyVersion
stopConditionCodes
```

Serialization rules:

- JSON strings use standard escaping, no insignificant whitespace, no trailing newline, and Unicode code points as
  literal UTF-8 except JSON-required escapes.
- Arrays retain documented order. Object key order is fixed above; nested schema/redaction definitions are referred
  to by version and separately hashed into their version identifiers.
- Integers are base-10 JSON numbers. No null/optional/unknown key exists.
- `environment` is a sorted array of exact `NAME=value` strings; no inherited environment participates.
- `expectedNormalizedFacts` contains the exact closed expected values or constraints from section 5. For
  F0-GIT-02, the independent execution approval replaces the single symbolic value `APPROVAL_BOUND_HEAD_SHA` with
  its exact reviewed allowlist-commit SHA before canonicalization; no command may run while it remains symbolic.
- The digest is lowercase hex SHA-256 of the canonical UTF-8 bytes.
- The execution approval cites the reviewed digest. The runner recomputes it before the first command and records it
  in every `CommandEvidence`.

This document contains exact Tier A executable/argv entries, but no final digest is calculated or claimed. Independent
review may reject or remove entries, and the later approval must resolve `APPROVAL_BOUND_HEAD_SHA`. Only then can that
approval freeze the final canonical bytes and digest. Any command, argv, expected facts, environment, directory,
privilege, cap, schema, redaction, timeout, or stop-condition difference is a new allowlist requiring new approval.

## 9. Baseline Mismatch and Stop Policy

The future execution stops before non-Git Tier A commands if branch, HEAD, local `origin/main`, divergence, tracked/
staged cleanliness, untracked count, accepted plan/source identities, repository root, or allowlist digest differs.
It also stops when an executable is absent or has a different realpath; output schema cannot be enforced; a manual or
path read attempts network/local-daemon contact; an excluded command becomes necessary; or repository/host state
materially differs from the approval.

There is no fetch, repair, clean, stage, reset, command substitution, executable fallback, alternate manual source,
broader output, privilege escalation, or automatic retry. A mismatch produces only a bounded failure result and
returns for new direction.

## 10. F0/F1 Execution and Result Contract

Execution order, if later approved:

1. F0-GIT-01 through F0-GIT-07 establish the exact baseline and identities.
2. F0-GIT-08 confirms the accepted chain/Core path invariant.
3. F1-SRC-01 through F1-SRC-04 normalize static direct-spawn and activation facts.
4. F1-MAN-01 and F1-MAN-02 normalize local authoritative documentation.
5. F1-PATH-01 through F1-PATH-03 inspect only the two exact known installed paths.
6. Stop and normalize the result. Do not advance to Tier B/C/D.

A successful first execution may establish only repository baseline validity, accepted source-derived invocation
facts, locally citable PF documentation semantics, exact OrbStack installation path metadata, absence of mutation/
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

- All exact baseline/schema/source/manual/path checks passing yields `BASELINE_AND_STATIC_EVIDENCE_ACCEPTED` only.
- Git/file identity mismatch yields `BASELINE_MISMATCH`.
- daemon/network contact risk, executable/read-only uncertainty, excluded-command need, or filter safety failure yields
  `COMMAND_SAFETY_BLOCKED`.
- Missing/ambiguous/conflicting static or manual facts yield `EVIDENCE_INCONCLUSIVE`.

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
  READY_FOR_INDEPENDENT_REVIEW

ALLOWLIST_EXECUTION_APPROVED =
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
  CLAUDE_INDEPENDENT_ALLOWLIST_REVIEW
```

No command in this document may run until independent review and a later exact execution approval freeze the final
canonical allowlist and digest.
