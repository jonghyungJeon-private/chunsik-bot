# Sprint 3k Plan — Lifecycle Hardening & Product Readiness Audit (audit-first → docs-only hardening; NO new mutation capability)

- **Status:** APPROVED WITH CHANGES (CA plan review) → **docs-only hardening: implement G1 + G2 only.** Exactly two
  new files (`docs/lifecycle-state-machine.md`, `docs/capabilities/repository-hosting.md`); **no runtime/test/provider/
  manager/adapter/capability change.** H3/H4/A5 deferred (not scheduled). Implementing on branch
  `v2/lifecycle-hardening-docs`; PR for CA Implementation Review; do not merge.
- **Base:** `main @ 9a5d96d20fe42b4b209104fbb8f1112fe5a4d04a` (Sprint 3j-B merge; ADR-0060 complete).
- **Validation runtime (for any FUTURE hardening implementation):** Node 22 · `pnpm typecheck` (exit 0) · `pnpm test`.
- **ADR:** none proposed — this sprint adds **no new capability, no new state, no new mutation**. Any hardening item
  CA elects to schedule would carry its own ADR only if it changes a settled decision (most are docs/tests only).
- **Nature:** the end-to-end development lifecycle is complete (plan → … → remote branch cleanup execution; CA: ~99%).
  This sprint is an **audit-first readiness pass**: verify the eight CA-listed invariants against the merged code,
  record evidence, and identify **only true blocking gaps** before v1 stabilization. **It proposes no code changes in
  itself** — it produces this audit + a prioritized, CA-reviewable hardening backlog.

> **Headline finding: NO true blocking gap was found.** Every safety-critical invariant (no-overclaim terminal
> wording, Blocked-vs-Unverified on remote mutations, no shell/CommandExecution leak, distinct structured-checked
> approval ids, token containment) holds across all capabilities. The items below are **documentation-completeness
> and consistency** improvements, not v1 blockers.

---

## 0.1 CA plan-review disposition (APPROVED WITH CHANGES → applied)

| CA decision | Disposition |
|---|---|
| 3k becomes **docs-only implementation**, not audit-only | Applied — this sprint delivers G1 + G2 as two new docs |
| Implement **G1 + G2 only** → `docs/lifecycle-state-machine.md` + `docs/capabilities/repository-hosting.md` | Applied — exactly those two files (plus this plan artifact) |
| **H3 / H4 / A5 deferred** (not approved for 3k) | Applied — moved to "deferred, not scheduled"; H3 must be behavior-preserving + separately reviewed if ever scheduled |
| No runtime/state/approval/manager/provider/adapter/CommandExecution/ExecutionOrchestrator/WorkspaceWrite/Patch/CodeGeneration/mutation change | Applied — docs-only; full suite still run to confirm no repo-wide breakage |
| G1 must document every durable state (meaning / evidence fields / allowed next intents / forbidden implications / category / failure semantics) + repeat the no-deploy/release/tag/production-ready/CI-verified disclaimer | Applied in G1 |
| G2 must cover the 11 required RepositoryHosting sections | Applied in G2 |

**Note on changed files:** this sprint's own plan doc (`docs/plans/sprint-3k-…`) is the standard per-sprint artifact
(committed in every prior sprint) and is docs-only — it is not runtime/test/provider/manager code. The two
CA-specified deliverables are `docs/lifecycle-state-machine.md` and `docs/capabilities/repository-hosting.md`.

---

## 0. Audit method

Read-only inspection of the merged tree at the base commit — `git.ts`/`git-manager.ts`, `repository-hosting*.ts`,
`repository-hosting-github`, `git-local`, `conversation-runtime.ts`, `response-composer.ts`, `DECISIONS.md`
(ADR-0040–0060), `docs/capabilities/*`, and the five test suites (1061 tests / 8263 test LOC). No runtime execution,
no mutation. Each of CA's eight checks below carries the evidence gathered and a PASS / PARTIAL verdict.

---

## 1. Audit checklist — findings

### ✅ Check 1 — All terminal states have correct wording and no overclaim — **PASS**

`ApplyPreviewAnchorStatus` has 22 states. The completed/terminal success states — `GIT_PUSHED`, `PR_CREATED`,
`PR_MERGED`, `MAIN_SYNCED`, `BRANCH_CLEANED`, `REMOTE_BRANCH_CLEANED` — each carry an explicit "what this does NOT
mean" disclaimer both in the status JSDoc and in the success composer (43 `배포/릴리즈/deployed/released`-class
disclaimer mentions in `response-composer.ts`). Examples verified: merge success → "머지했다는 것이 배포/릴리즈를 뜻하지는
않아요"; `REMOTE_BRANCH_CLEANED` success → "로컬 브랜치·main은 건드리지 않았어요. 배포/릴리즈/태그도 하지 않았어요". No
terminal state claims deployed / released / tagged / production-ready / repository-fully-cleaned. **No overclaim.**

### ✅ Check 2 — Every remote mutation has a Blocked-vs-Unverified split — **PASS (1 consistency note)**

| Remote mutation | Sprint/ADR | Failure model | Verdict |
|---|---|---|---|
| PR creation | 3d-D / 0054 | `RepositoryHostingBlockedError` / `RepositoryHostingUnverifiedError` (typed) | ✅ typed split |
| PR merge | 3g / 0057 | same typed pair | ✅ typed split |
| Remote branch delete | 3j-B / 0060 | `RemoteBranchCleanupBlockedError` / `RemoteBranchCleanupUnverifiedError` (typed) | ✅ typed split |
| Git push | 3a / 0048 | composer idiom: pre-push → `composePushExecutionUnavailable` ("not pushed"); at/after → `composePushExecutionFailed` ("could not complete / check remote / never unchanged") + `composePushResultUnverified` | ✅ **safe**, older idiom |

Local mutations also split correctly (main sync → `GitMainSync{Blocked,Unverified}Error`; local branch delete →
`BranchCleanup{Blocked,Unverified}Error`). **Consistency note (non-blocking):** the **push** capability (3a, the
earliest remote mutation) predates the ADR-0054 typed-error idiom, so it expresses the same safety via distinct
composers (`composePushExecutionFailed`/`composePushResultUnverified`) and `GitManager.pushApprovedCommit` throws a
plain `Error`. The **safety invariant holds** — the runtime's single-push-call catch is a blanket "could not
complete, check the remote, never 'remote unchanged'", i.e. Unverified semantics; pre-push failures are all "not
pushed". Optional hardening H3 would align push to the typed idiom for uniformity (no behavior change).

### ✅ Check 3 — No shell / CommandExecution fallback leaked into capability boundaries — **PASS**

- `git-local` runs git via `spawnSync('git', args, { cwd, timeout, encoding })` — **argument-array, never a shell
  string, never `shell: true`** (read-only subcommands + the four gated mutations: commit/push/ff-sync/update-ref -d).
- `repository-hosting-github` uses the Node built-in `fetch` only — no octokit/gh/curl/child_process.
- Grep for `child_process`/`execSync`/`spawnSync`/`exec(`/`shell: true`/`/bin/sh`/`require(` across all package `src`
  (excluding tests) finds **only** `git-local`'s argv `spawnSync`. `CommandExecution` remains the sole command runner
  (allow-listed to `pnpm test`/`pnpm typecheck`; never shells, never git, never mutates a file). **No leak.**

### ✅ Check 4 — All approval ids are distinct and structured-field checked — **PASS**

Six distinct id fields, never overloaded: `approvalId` (plan/apply), `commitApprovalId`, `pushApprovalId`,
`prApprovalId`, `mergeApprovalId`, `remoteBranchCleanupApprovalId`. Every decision/execution turn re-reads the
referenced `ApprovalRequest` and checks **structured fields only** — `status === PENDING|APPROVED` **and**
`request.executionPlanRef.id === anchor.executionPlanRef.id` (16 such checks) — and **never parses
`ApprovalRequest.reason`** (the only `.reason` occurrence in the runtime is a comment asserting it is not parsed).
Deny/cancel clears exactly its own approval fields and preserves the rest of the chain.

### ⚠️ Check 5 — State transitions are documented and test-covered — **PARTIAL (documentation gap; test coverage strong)**

- **Test coverage: strong.** 1061 tests / 47 files; 8263 test LOC (runtime 5908, hosting-manager 753, git-manager
  343, git-local 683, github-adapter 576). Each state transition (approval → pending → approved → executed, plus the
  idempotent/blocked/unverified branches) is exercised.
- **Transition provenance: adequate but scattered.** Each transition is described in its ADR (0040–0060) and in the
  inline JSDoc on each `ApplyPreviewAnchorStatus` member.
- **Gap G1 (non-blocking):** there is **no single consolidated lifecycle / state-machine map** of the 22-state
  `ApplyPreviewAnchorStatus` chain (the transitions must be reconstructed from 20+ ADRs). A one-page state map would
  materially help v1 onboarding and review.
- **Gap G2 (non-blocking):** `docs/capabilities/` documents approval / code-generation / command-execution / git /
  patch / planning / workspace / workspace-write, but has **no `repository-hosting.md`** — the newest and
  highest-blast-radius capability (CAP-010: PR create/status/merge + remote branch cleanup) is undocumented there.

### ✅ Check 6 — User-facing Korean response wording is consistent — **PASS (minor polish)**

Consistent idioms across composers: Blocked → "…하지 않았어요" (+ safe reason); Unverified → "결과를 확인하지 못했어요,
…에서 확인해 주세요"; every mutation reply states what was NOT touched ("배포/릴리즈/태그도 하지 않았어요"). No contradictory
or overclaiming wording found. Optional polish H4: a lightweight wording snapshot/lint to lock the phrasing so future
sprints can't drift it (nice-to-have, not a blocker).

### ✅ Check 7 — Secrets/tokens never enter anchors, reasons, logs, or responses — **PASS**

- The GitHub token is **adapter-local only** (`GitHubRepositoryHostingProvider.token`, used solely as
  `Authorization: Bearer` in the bounded `fetch`); it is never returned, logged, or placed in an error (sanitized
  `statusError`/`request` failures).
- The `ApplyPreviewAnchor` has **no token field** (the "token" mentions in `conversation-runtime.ts` are the unrelated
  `CancelToken` and JSDoc explicitly stating "NO token"); reason builders and composers never include a token; the
  structured failure logger logs ids only, never diff/file content/token.
- Existing tests assert the anchor JSON and reply text never match `/ghp_|github_pat_|token/i`. **Strong containment.**

### ✅ Check 8 — Only true blocking gaps before v1 stabilization — **NONE FOUND**

No safety-critical invariant is violated. The findings are documentation-completeness (G1, G2) and optional
consistency/polish (H3, H4). None blocks v1 product stabilization.

---

## 2. Proposed hardening backlog (CA-prioritized; docs/tests-first, no mutation-capability changes)

Ordered by value; each is **optional** and independently schedulable. None changes a settled ADR or adds a mutation.

| # | Item | Type | Effort | Rationale |
|---|---|---|---|---|
| **G1** | Add a consolidated lifecycle / state-machine map (the 22-state `ApplyPreviewAnchorStatus` chain + transitions + terminal meanings) under `docs/` | docs | S | v1 onboarding/review; single source for the whole flow |
| **G2** | Add `docs/capabilities/repository-hosting.md` (CAP-010: identity config, PR create/status/merge, remote branch cleanup; approval gates; Blocked-vs-Unverified; token containment) | docs | S | the newest, highest-risk capability is the only one without a capability doc |
| **H3** | (Optional) Align push (3a) to the typed `*Blocked`/`*Unverified` error idiom for uniformity — **behavior-preserving refactor + tests** | code (safe) | M | consistency only; the safety invariant already holds |
| **H4** | (Optional) Response-wording snapshot/lint to lock Korean phrasing invariants (no-overclaim, Blocked/Unverified) against drift | tests | S | regression guard for wording |
| **A5** | (Optional) A single "no-overclaim / no-secret" enduring-invariant test that scans every composer output for forbidden claims + token patterns | tests | S | one guard covering checks 1/6/7 for all future states |

**CA decision:** **G1 + G2 are implemented in this sprint (docs-only).** **H3 / H4 / A5 are deferred** (not
scheduled); if H3 is ever scheduled it must be behavior-preserving and separately reviewed (it touches older push
execution semantics).

---

## 3. Out of scope (this sprint and its backlog)

```text
no new state · no new mutation capability · no new approval design · no deploy/release/tag ·
no default/main/arbitrary/bulk/wildcard branch deletion · no force behavior · no git push --delete ·
no shell/CommandExecution fallback · no ExecutionOrchestrator/WorkspaceWrite/Patch/CodeGeneration/Git-capability
behavior change · no RepositoryHosting mutation change · (H3, if scheduled, is a behavior-PRESERVING refactor only)
```

---

## 4. Validation & stop condition

- **Validation (docs-only):** Node 22 · `pnpm typecheck` (exit 0) · `pnpm test` (full suite green) — run to confirm no
  repo-wide breakage even though only docs changed.
- **Stop after opening the PR** (per CA Stop Condition for Implementation) — deliver exactly
  `docs/lifecycle-state-machine.md` + `docs/capabilities/repository-hosting.md` (plus this plan artifact); report
  changed files + validation; confirm no code/runtime/test/provider/manager/adapter change. H3/H4/A5 remain deferred.
