# Sprint 3j Plan — Remote Branch Cleanup (RepositoryHosting-owned, CRITICAL-approval-gated delete of exactly ONE merged PR head branch; NO force/bulk/wildcard/default-branch)

- **Status:** APPROVED WITH CHANGES (CA plan review) → **split into two implementation sprints under ADR-0060**;
  **the next PR implements Sprint 3j-A (approval gate) ONLY.** Sprint 3j-B (execution) is reviewed separately later.
- **Base:** `main @ 778c3f801c66925681d372a4a038e3ae5eb45339`
- **Validation runtime:** Node 22 · `pnpm typecheck` (exit 0) · `pnpm test` (full suite green).
- **ADR:** ADR-0060 — Remote Branch Cleanup (added to `DECISIONS.md` at 3j-A implementation time; covers the whole
  design; 3j-A implements the approval gate, 3j-B implements the execution/delete).

> **CA-mandated split (house pattern — every gated mutation ships approval-then-execution: 2x/2y, 2z/3a, 3f/3g):**
> ```text
> Sprint 3j-A — Remote Branch Cleanup Approval   ← THIS PR: BRANCH_CLEANED → REMOTE_BRANCH_CLEANUP_PENDING
>                                                            → approve/deny/cancel → REMOTE_BRANCH_CLEANUP_APPROVED / BRANCH_CLEANED
> Sprint 3j-B — Remote Branch Cleanup Execution  ← LATER:  REMOTE_BRANCH_CLEANUP_APPROVED → execute → REMOTE_BRANCH_CLEANED
> ```
> **3j-A implements ONLY the approval gate. NO remote deletion, NO GitHub write, NO RepositoryHosting delete
> API, NO `REMOTE_BRANCH_CLEANED` active state.** Every execution/delete piece below is labelled
> **[Deferred to Sprint 3j-B]** and must NOT be implemented in this PR.
- **Nature:** from a live `BRANCH_CLEANED` anchor, an explicit **remote** branch-cleanup command deletes the
  completed PR's **remote head branch** from the hosting provider — via the **RepositoryHosting capability**
  (CAP-010), through a **new CRITICAL ApprovalRequest**, **exactly ONE remote ref**, only after a strict live
  revalidation. **No force, no bulk/wildcard/pattern, no deleting the default/`main` branch, no `git push --delete`
  (Git stays local-only), no deploy/release/tag, no PR/reviewer/label/assignee mutation, no shell.**
- **Predecessors (reused, not re-litigated):**
  - **ADR-0059** (Sprint 3i) — the `BRANCH_CLEANED` anchor + the `interpretRemoteBranchCleanupIntent` classifier
    (currently → `composeRemoteBranchCleanupUnsupported`; 3j turns it into the real trigger) + `cleanedRemoteBranch`
    (false at BRANCH_CLEANED; 3j sets it) + the local-vs-remote wording split this extends.
  - **ADR-0057/0056** (Sprint 3g/3f) — the CRITICAL merge-approval → merge-execution two-turn pattern this
    mirrors (`MERGE_APPROVAL_PENDING → MERGE_APPROVED → PR_MERGED`), and the RepositoryHosting
    Blocked-vs-Unverified safety split extended to remote deletion.
  - **ADR-0054/0053/0052/0051** — the RepositoryHosting capability (manager owns approval/ordering/integrity; the
    provider owns bounded GitHub REST calls, adapter-local token, no shell; `RepositoryIdentity`; the anchored
    `pullRequestRef`/`pullRequestHeadBranch` as the ONLY target).
  - **ADR-0023** — Git is a **local repository** capability that never exposes a remote URL; this is *why* remote
    branch deletion belongs to RepositoryHosting, not to a Git `push --delete` (Q2).

---

## 0. CA required plan questions → where answered

| CA plan question | Answered in |
|---|---|
| Q1 New terminal state (`REMOTE_BRANCH_CLEANED`) + fields; reuse `cleanedRemoteBranch` or new fields | §4.1, §5 Q1 |
| Q2 Ownership (RepositoryHosting vs Git) — choose one, reject the other | §4.5, §5 Q2 |
| Q3 Approval gate (new CRITICAL? before delete? same-turn? which structured fields) | §4.6, §5 Q3 |
| Q4 Conservative trigger classifier | §4.2, §5 Q4 |
| Q5 Required remote preflight (15 checks) + already-absent policy | §4.3, §5 Q5 |
| Q6 CAS / expected commit (does GitHub support conditional ref delete?) | §4.4, §5 Q6 |
| Q7 Failure semantics (Blocked vs Unverified) + new errors | §4.7, §5 Q7 |
| Q8 Out of scope | §6 |
| Required tests (20 full / 18 for 3j-A) | §7 |
| Sequencing recommendation (approval vs execution split) | §4.8 |

---

## 0.1 CA plan-review disposition (APPROVED WITH CHANGES → all applied to this 3j-A scope)

| CA required change | Disposition | Where |
|---|---|---|
| Split into 3j-A (approval) + 3j-B (execution) under ADR-0060; next PR = 3j-A only | Applied — header + §4.8; all execution pieces labelled **[Deferred to Sprint 3j-B]** | header, §4.1, §4.4, §4.5, §4.9 |
| 1. Narrow implementation scope to 3j-A (approval-only) | Applied — §4.1/§4.9 mark active 3j-A states/fields; delete design retained but deferred | §4.1, §4.9, §7.1 |
| 2. No RepositoryHosting delete APIs in 3j-A (no GitHub write endpoint) | Applied — §4.5 provider/manager methods are **[Deferred to Sprint 3j-B]** | §4.5 |
| 3. No `REMOTE_BRANCH_CLEANED` active runtime state in 3j-A (stop at `REMOTE_BRANCH_CLEANUP_APPROVED`) | Applied — §4.1 adds only the two approval states in 3j-A | §4.1, §4.9 |
| 4. CRITICAL approval reason states only the permission TARGET; must not claim exists/SHA-current/PR-merged/delete-safe | Applied — §4.6 reason constraints | §4.6, §7.1 (3/4) |
| 5. Pending intercepts ALL turns; delete/execute while pending never executes/auto-approves | Applied — §4.9 pending block; ambiguous re-prompt | §4.9, §7.1 (8/9/10) |
| 6. Approved state is permission-only (no mutation); execute → future-step-unavailable | Applied — §4.9 approved block | §4.9, §7.1 (11/12/13) |
| 7. Deny/cancel → `BRANCH_CLEANED`, clears ONLY the 4 remote-cleanup approval fields; preserves the chain | Applied — §4.6 | §4.6, §7.1 (9) |
| 8. Classifier hardening (reject bulk/wildcard/all/main/default) required in 3j-A | Applied — §4.2 | §4.2, §7.1 (6) |

---

## 1. Goal

```text
BRANCH_CLEANED
→ explicit REMOTE branch cleanup command ("원격 브랜치 삭제해줘" / "remote branch cleanup 해줘" / "delete remote branch"
  / "origin 브랜치 삭제해줘" / "GitHub branch delete")
→ record a NEW CRITICAL ApprovalRequest (target = the anchored PR head branch, never user-supplied)
→ REMOTE_BRANCH_CLEANUP_PENDING (halt; NO deletion, NO GitHub write)
→ approve  → REMOTE_BRANCH_CLEANUP_APPROVED (record only; NO deletion)
→ explicit execute command
→ RepositoryHostingManager.deleteRemoteBranch:
     revalidate the completed chain + identity + pullRequestRef + expected head commit
     live read the remote branch head SHA IMMEDIATELY before delete; verify SHA == expected; PR still merged/attributable
     delete EXACTLY the one remote ref (RepositoryHosting; GitHub REST; never git push --delete)
→ REMOTE_BRANCH_CLEANED (+ remoteBranchCleanupMode 'remote', cleanedRemoteBranchName, remoteBranchDeletedCommit,
   remoteBranchCleanedAt/By, remoteBranchCleanupProvider 'github', cleanedRemoteBranch=true)
→ respond: which REMOTE branch was deleted, that main/local/deploy/release/tag were NOT touched

Known pre-delete failure (any preflight / SHA mismatch / not-attributable) → "원격 브랜치를 삭제하지 않았어요" (definitely not deleted)
Unknown failure AT/AFTER the delete attempt                                 → "삭제 결과를 확인하지 못했어요" (never "not deleted")
Remote branch already absent                                                → REMOTE_BRANCH_CLEANED (idempotent) + "이미 없어요" (nothing deleted this run)
Hosting not configured (no identity / no token / no manager)               → "정리할 수 없어요 (설정 확인)"; no state change
```

---

## 2. Boundary & the most important rule

> **A remote branch cleanup deletes exactly ONE remote branch — the anchored, already-merged PR head branch — from
> the hosting provider, and nothing else.** Sprint 3j performs **no** deletion of the default/`main` branch, **no**
> bulk/wildcard/pattern deletion, **no** force behavior, **no** `git push --delete` (Git stays local-repository-only,
> ADR-0023), **no** local branch deletion (that was 3i), **no** deploy/release/tag, **no** PR/reviewer/label/
> assignee mutation, **no** workflow dispatch / check rerun, **no** `CommandExecution`/shell. It runs through the
> **RepositoryHosting capability** (`RepositoryHostingProvider`/`RepositoryHostingManager`), adapter-side, bounded
> GitHub REST only, **behind a NEW CRITICAL ApprovalRequest**. `REMOTE_BRANCH_CLEANED` means only: the specific
> completed PR's REMOTE head ref was deleted (or was already absent) this run — it does **not** mean deployed /
> released / production-ready / tagged / all-branches-cleaned / repository-fully-cleaned / local-branch-deleted-
> this-run. GitHub's refs API provides **no atomic SHA-conditional delete** (§4.4/Q6), so correctness comes from a
> live read-immediately-before-delete + explicit SHA verification; an ambiguous failure at/after the delete is
> **unverified**, never "not deleted".

---

## 3. Architecture & reuse (source-verified)

- **Trigger anchored to `BRANCH_CLEANED` only** (`conversation-runtime.ts`; the 3i `BRANCH_CLEANED` routing block).
  The existing `interpretRemoteBranchCleanupIntent` (which today returns `'remote'` → unsupported) becomes the real
  entry — **but must gain the bulk/wildcard/`main`-target guards** it currently lacks (§4.2, a load-bearing change:
  in 3i "remote → no-op" made guards unnecessary; in 3j "remote → real delete" makes them mandatory).
- **The deletion target is the ANCHORED PR head branch** (`anchor.cleanedBranch` == `anchor.pullRequestHeadBranch`,
  cross-checked against `anchor.pushedBranch`) — **never a user-named branch** (mirrors 3e/3g/3i). The user's phrase
  only expresses "clean up the remote branch"; the target is fixed by the anchor.
- **Preserves the full `BRANCH_CLEANED` causal chain** — identity / `pullRequestRef` / head / base / merged head SHA
  / merge commit / synced main / local cleanup evidence. Remote cleanup **adds** fields; it clears none.
- **Two-turn CRITICAL approval mirrors 3f/3g exactly** — `handleRemoteBranchCleanupApprovalTurn`
  (→ `REMOTE_BRANCH_CLEANUP_PENDING`), `handleRemoteBranchCleanupDecisionTurn` (→ `REMOTE_BRANCH_CLEANUP_APPROVED`
  on approve; back to `BRANCH_CLEANED` clearing only the remote-cleanup approval fields on deny/cancel),
  `handleRemoteBranchCleanupExecutionTurn` (→ `REMOTE_BRANCH_CLEANED`). `deps.approvals.requestForRisk` with
  `RiskLevel.CRITICAL`; structured-fields-only re-read at execution (`executionPlanRef.id`, `status === APPROVED`).
- **Ownership = RepositoryHosting** — a new READ method + a new mutating method on `RepositoryHostingProvider`, plus
  a new `RepositoryHostingManager.deleteRemoteBranch` (preflight + single delete). The runtime calls the **manager
  only**, never the provider, and receives **no token** (mirrors merge execution). Git gains **nothing** in 3j.
- **Failure taxonomy reuses the ADR-0054 phase-aware rule** — a KNOWN pre-delete failure is *Blocked* ("not
  deleted"); any failure at/after the single delete call is *Unverified*.
- **`now()`** supplies `remoteBranchCleanedAt`; actor id supplies `remoteBranchCleanedBy`.

---

## 4. Design

### 4.1 New product states + anchor fields (Q1)

> **3j-A scope:** adds ONLY `REMOTE_BRANCH_CLEANUP_PENDING`, `REMOTE_BRANCH_CLEANUP_APPROVED`, and the four
> `remoteBranchCleanupApproval*` tracking fields. **`REMOTE_BRANCH_CLEANED` and every descriptive remote field
> (`remoteBranchCleanupMode`/`cleanedRemoteBranchName`/`remoteBranchCleanedAt`/`remoteBranchCleanedBy`/
> `remoteBranchCleanupProvider`/`remoteBranchDeletedCommit`) and `cleanedRemoteBranch=true` are [Deferred to
> Sprint 3j-B].** `cleanedRemoteBranch` stays `false` through 3j-A.

`ApplyPreviewAnchorStatus` gains, after `BRANCH_CLEANED`, three states (mirroring the 3f/3g merge chain):

```text
REMOTE_BRANCH_CLEANUP_PENDING   — a CRITICAL remote-branch-cleanup ApprovalRequest is pending decision. NO deletion,
                                  NO GitHub write. Every turn is intercepted by the decision handler (like AWAITING_
                                  APPROVAL / MERGE_APPROVAL_PENDING).
REMOTE_BRANCH_CLEANUP_APPROVED  — the remote-cleanup approval is recorded. Still NO deletion. Awaits an explicit
                                  execute command.
REMOTE_BRANCH_CLEANED           — terminal. The completed PR's REMOTE head ref was deleted (or was already absent)
                                  DURING THIS RUN (Sprint 3j, ADR-0060). NOT deployed/released/production-ready/
                                  tagged/all-branches-cleaned/local-branch-deleted-this-run/repository-fully-cleaned.
```

**Field decision (CA Q1 — reuse `cleanedRemoteBranch` OR introduce distinct fields): BOTH, deliberately.** Reuse the
existing boolean `cleanedRemoteBranch` (same semantic: "was a remote branch deleted this run") — it is `false` at
`BRANCH_CLEANED` and becomes `true` at `REMOTE_BRANCH_CLEANED` (or stays `false` when already absent). Introduce
**distinct DESCRIPTIVE remote fields** so the 3i LOCAL cleanup evidence (`branchCleanupMode`/`cleanedBranch`/
`branchCleanedAt`/`branchCleanedBy`/`cleanedLocalBranch`) is **preserved and never overloaded**:

```text
remoteBranchCleanupMode?: 'remote'          // REQUIRED at REMOTE_BRANCH_CLEANED
cleanedRemoteBranchName?: string            // REQUIRED at REMOTE_BRANCH_CLEANED; == anchored PR head branch
remoteBranchCleanedAt?: IsoTimestamp        // REQUIRED at REMOTE_BRANCH_CLEANED; RUNTIME record timestamp (now())
remoteBranchCleanedBy?: Id                  // REQUIRED at REMOTE_BRANCH_CLEANED; the actor who executed cleanup
remoteBranchCleanupProvider?: 'github'      // REQUIRED at REMOTE_BRANCH_CLEANED; the hosting provider
remoteBranchDeletedCommit?: string          // the SHA the remote branch pointed at when deleted (== expected head), when deleted
cleanedRemoteBranch?: boolean               // REUSED: true when a remote ref was deleted this run; false when already absent

// Approval-tracking (mirror mergeApproval* — DISTINCT ids so no collision with commit/push/PR/merge approvals):
remoteBranchCleanupApprovalId?: Id
remoteBranchCleanupApprovalRequestedAt?: IsoTimestamp   // set at REMOTE_BRANCH_CLEANUP_PENDING; cleared on deny/cancel
remoteBranchCleanupApprovedAt?: IsoTimestamp            // set at REMOTE_BRANCH_CLEANUP_APPROVED; cleared on deny/cancel
remoteBranchCleanupApprovalDecisionBy?: Id              // set at REMOTE_BRANCH_CLEANUP_APPROVED; cleared on deny/cancel
```

`REMOTE_BRANCH_CLEANED` **preserves the full chain** (`...anchor`): identity / `pullRequestRef` / head / base /
`mergedHeadSha` / `mergeCommitHash` / `syncedMainCommit` / `mainSyncBranch` + all 3i local cleanup fields. It never
clears them.

### 4.2 Runtime trigger classifier (Q4) — MUST add bulk/main guards

The existing `interpretRemoteBranchCleanupIntent` is promoted to the real trigger and **hardened** with the same
guards `interpretBranchCleanupIntent` already has (in 3i they were only on the LOCAL classifier because remote was a
no-op):

```ts
// Sprint 3j (ADR-0060) — hardened. A remote cleanup verb + branch word + remote qualifier, MINUS bulk/wildcard/"main".
static interpretRemoteBranchCleanupIntent(text: string): 'remote' | null {
  const t = text.trim().toLowerCase();
  if (CLEANUP_BULK.test(t) || CLEANUP_MAIN_TARGET.test(t)) return null; // NEW in 3j: bulk/wildcard/"main 삭제" → never
  if (CLEANUP_VERB.test(t) && CLEANUP_BRANCH_WORD.test(t) && CLEANUP_REMOTE_WORD.test(t)) return 'remote';
  return null;
}
```

- **Triggers** (CA allowed): `원격 브랜치 삭제해줘`, `remote branch cleanup 해줘`, `delete remote branch`,
  `origin 브랜치 삭제해줘`, `GitHub branch delete` → `'remote'`.
- **Must NOT trigger** (CA): `브랜치 정리해줘` (no remote qualifier → LOCAL path → at `BRANCH_CLEANED` = already
  cleaned, no delete), `정리해줘` (no branch word), `다 삭제해줘` (bulk guard), `main 삭제해줘` (main-target guard),
  `브랜치 전부 삭제해줘` (bulk guard), `배포해줘`/`릴리즈해줘` (no cleanup/branch words).
- The **target is always the anchored PR head branch** regardless of phrase; a user-named branch is never deletable.

### 4.3 Required remote preflight — 15 checks (Q5)

Split across the runtime (anchor/approval evidence) and the RepositoryHosting Manager (live remote read, then the
single delete). **Every** check that fails **before** the delete is *Blocked* ("remote branch was not deleted").

Runtime `handleRemoteBranchCleanupExecutionTurn` (before any mutating call) — any failure → `composeRemoteBranchCleanupBlocked`:

```text
1.  anchor.status === 'REMOTE_BRANCH_CLEANUP_APPROVED'   (approval already recorded; execution is a separate command)
2.  remoteBranchCleanupApprovalId present AND the ApprovalRequest re-reads status === APPROVED and
    executionPlanRef.id === anchor.executionPlanRef.id  (structured fields only; never parse reason)
3.  cleanedBranch / pullRequestHeadBranch present   (target := anchor.pullRequestHeadBranch)
4.  target === anchor.pushedBranch                  (cross-check the completed chain)
5.  target !== 'main' (PR_BASE_BRANCH_POLICY)       (never delete the base/default branch)
6.  target passes the safe branch-name guard (isSafePushBranch)
7.  anchor.repositoryIdentity present AND matches the configured deps identity (provider/owner/repo)
8.  anchor.pullRequestRef present AND belongs to the same repo (ref.provider/owner/repo === identity)
```

Manager `deleteRemoteBranch` (live read → verify → single delete) — checks 9–15, all pre-delete → *Blocked*:

```text
9.  provider.kind === identity.provider; identity supported; owner/repo safe (backstop, mirrors mergePullRequest)
10. PR still attributable + merged — a live getMergePreflight (or getPullRequestStatus) read shows state === 'merged'
    for the exact pullRequestRef/head; a non-merged / unattributable read → Blocked (do NOT delete the branch of a
    PR we can no longer confirm merged). [CA Q5.9]
11. remote branch existence — live getRemoteBranchCommit(identity, target):
       null (404) → ABSENT → idempotent success (§4.7), NO delete call
       present → record remoteCommit
12. remote branch commit === the anchored expected head commit (anchor.mergedHeadSha / pullRequestCommitHash) —
    mismatch → Blocked (the remote branch moved after merge; a moved branch is never deleted). [CA Q5.11 / Q6]
13. remote target !== the repository default/main branch — Blocked otherwise (defensive, beyond check 5). [CA Q5.12]
14. provider identity + repo match EXACTLY (no wildcard/pattern; the target is one exact branch name). [CA Q5.13/14]
15. the delete is a single exact ref — NO bulk/pattern/wildcard method exists on the port (§4.5). [CA Q5.13]
```

Only when checks 1–14 pass (and the branch exists) is the single delete (§4.4) performed, re-reading + re-verifying
the SHA immediately before the DELETE to minimize the race window.

### 4.4 Deletion strategy — read-immediately-before-delete (no atomic CAS available) (Q6)

**GitHub's Git-refs API has NO SHA-conditional delete.** `DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}`
accepts no `If-Match`/expected-SHA parameter (unlike the merge endpoint's `sha` body param, or the local Sprint 3i
`git update-ref -d <ref> <oldvalue>` which is a genuine CAS). **A true compare-and-swap remote delete is therefore
impossible through the provider API — the plan states this explicitly.** Mitigation (CA Q6):

```text
Inside the provider's deleteRemoteBranch(identity, branch, expectedCommitHash):
  1. GET /repos/{owner}/{repo}/git/ref/heads/{branch}      → object.sha  (immediate pre-delete read)
     - 404 → return { deleted:false, alreadyAbsent:true }  (idempotent; Manager also handled absent at check 11)
  2. verify object.sha === expectedCommitHash              → mismatch → RemoteBranchCleanupBlockedError (moved; not deleted)
  3. DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}  → 204 → { deleted:true, deletedCommitHash: expectedCommitHash }
     - any non-204 / network throw → RemoteBranchCleanupUnverifiedError (the DELETE may have taken effect)
```

- The read→verify→delete window is a single adapter round-trip; the target is the head of an **already-merged** PR
  (unlikely to receive new pushes), and the Manager's check 12 already verified the SHA once. **Residual race:** a
  concurrent push could advance the branch between step 2 and step 3, so a stale-tip delete is theoretically
  possible. This residual risk is **explicitly accepted** because GitHub provides no atomic conditional-delete on
  refs; it is bounded by (a) the merged-PR context, (b) the millisecond window, and (c) the Unverified-on-ambiguity
  rule (§4.7) — a delete whose outcome we cannot confirm is **never** reported as "not deleted".
- **NEVER** `git push --delete` / `-r` / a wildcard / a pattern / the default branch / a force flag / a bulk call.
  Single exact ref, RepositoryHosting-side, bounded `fetch`, sanitized errors (no token/raw payload), no retry
  (mirrors the 3d-C/3e/3g adapter discipline).

### 4.5 Ownership + capability change (Q2)

> **[Deferred to Sprint 3j-B] — 3j-A adds NONE of the provider/manager methods below.** 3j-A does not touch the
> RepositoryHosting provider or manager, introduces no GitHub write/read-ref endpoint, and adds no
> `RemoteBranchCleanupResult`/`RemoteBranchCleanupBlockedError`/`RemoteBranchCleanupUnverifiedError`. This section
> records the settled *ownership decision* (RepositoryHosting, not Git) that 3j-B will implement.

**Remote branch deletion → the RepositoryHosting capability. `git push --delete` (Git) is REJECTED.**

- **Chosen — RepositoryHosting:** deleting a branch on github.com is a **hosting-side remote mutation** keyed by the
  **provider repository identity** (`owner/repo`). RepositoryHosting already owns the adapter-local token, the
  `RepositoryIdentity`, the `pullRequestRef`, the bounded-`fetch`/no-shell discipline, and the Blocked-vs-Unverified
  safety split. The GitHub Git-refs REST endpoint is the natural, auditable primitive.
- **Rejected — Git `push --delete`:** the Git capability is a **local repository** capability that, by settled
  decision (ADR-0023), **never exposes or handles a remote URL/credentials**. Routing a remote deletion through
  `git push origin --delete <branch>` would (a) smuggle a **remote** mutation behind a "local" capability, (b)
  require remote-URL/credential handling the Git layer is forbidden from doing, and (c) contradict ADR-0059's
  explicit "Git owns local refs only; remote deletion is a higher-blast-radius remote mutation for its own gated
  sprint." So local (Git, 3i) and remote (RepositoryHosting, 3j) deletion are deliberately **different capabilities**.

**Provider port (`RepositoryHostingProvider`) — one read + one mutating method:**

```ts
// READ-ONLY (ADR-0060): the remote branch head commit, or null when the branch is absent (404). Bounded single GET
// (GET /repos/{owner}/{repo}/git/ref/heads/{branch}); sanitized errors; no token/raw payload; no pagination/retry.
getRemoteBranchCommit(identity: RepositoryIdentity, branch: string): Promise<{ commitHash: string } | null>;

// The ONLY new mutating method (ADR-0060) — deletes EXACTLY one remote branch. Takes NO ApprovalRef (consumed by the
// Manager). Reads the ref immediately, verifies object.sha === expectedCommitHash (§4.4; GitHub has no atomic CAS),
// then DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}. NEVER the default branch, a wildcard/pattern, a force
// flag, or git push. PHASE-AWARE: pre-delete SHA mismatch/known failure → RemoteBranchCleanupBlockedError; a failure
// AT/AFTER the DELETE → RemoteBranchCleanupUnverifiedError.
deleteRemoteBranch(input: {
  identity: RepositoryIdentity;
  branch: string;
  expectedCommitHash: string;
}): Promise<RemoteBranchCleanupResult>;
```

**Manager (`RepositoryHostingManager.deleteRemoteBranch`) — preflight + single delete; consumes the ApprovalRef:**

```ts
async deleteRemoteBranch(input: {
  identity: RepositoryIdentity;
  pullRequestRef: PullRequestRef;
  branch: string;                 // == anchored PR head branch (never user-supplied)
  expectedCommitHash: string;     // == anchored merged head SHA
  approvalRef: ApprovalRef;
}): Promise<RemoteBranchCleanupResult>
// 1. backstop validation (approval APPROVED; provider.kind === identity.provider; supported; owner/repo safe; ref
//    belongs to identity; safe branch; branch !== 'main'; SHA-shaped expectedCommitHash) → all → BlockedError.
// 2. live merged/attributable read (getMergePreflight): not 'merged' / ref mismatch / head mismatch → BlockedError (check 10).
// 3. getRemoteBranchCommit(identity, branch): null → idempotent { deleted:false, alreadyAbsent:true } (check 11);
//    commit !== expectedCommitHash → BlockedError (check 12).
// 4. SINGLE deleteRemoteBranch(provider): provider BlockedError → Blocked; UnverifiedError → Unverified; any OTHER
//    throw → Unverified (no blanket-convert of the Blocked case). Result-integrity (branch === target, deleted true,
//    identity match) mismatch → Unverified.
```

**New domain type + errors:**

```ts
export interface RemoteBranchCleanupResult {
  provider: RepositoryHostingProviderKind;  // 'github'
  owner: string;
  repo: string;
  branch: string;              // the deleted (or already-absent) remote branch (== anchored PR head branch)
  deleted: boolean;            // true when this run deleted a remote ref; false when already absent
  alreadyAbsent: boolean;      // true when the remote branch did not exist (404)
  deletedCommitHash?: string;  // the commit the remote branch pointed at (== expectedCommitHash), when deleted
}
export class RemoteBranchCleanupBlockedError extends Error {}     // definitively NOT deleted (pre-delete)
export class RemoteBranchCleanupUnverifiedError extends Error {}  // delete attempted; outcome unknown — never "not deleted"
```

Runtime `deps.repositoryHosting.manager` gains `deleteRemoteBranch` (type-only widening; the runtime calls the
manager ONLY, never the provider, and passes NO token). **Git gains no method in 3j.**

### 4.6 Approval gate (Q3)

- **Is a NEW CRITICAL ApprovalRequest required? YES.** Remote branch deletion is the highest-blast-radius mutation
  the product has reached (remote, affects collaborators, not locally recoverable). It is gated by a **new
  `RiskLevel.CRITICAL` ApprovalRequest** via `deps.approvals.requestForRisk`, tracked by a **distinct**
  `remoteBranchCleanupApprovalId` (never reusing commit/push/PR/merge approval ids). The approval reason is built
  deterministically from structured fields (owner/repo/branch/expected commit/PR number+URL) — never free-text
  parsed.
- **Does approval happen BEFORE deletion? YES, always.** No delete without a recorded `APPROVED` ApprovalRef
  re-read via structured fields at execution time (check 2). Deny/cancel → back to `BRANCH_CLEANED`, clearing ONLY
  the remote-cleanup approval fields (identity/PR/merge/sync/local-cleanup evidence preserved).
- **Can approval + execution happen in the SAME user turn? NO — two turns (recommended).** This mirrors *every*
  prior gated mutation: commit approval (2x) → commit execution (2y); push approval (2z) → push execution (3a);
  merge approval (3f) → merge execution (3g). A single-turn "approve-and-delete" would collapse the deliberate
  two-signal safety the whole product is built on, for its **most** dangerous operation. So:
  `BRANCH_CLEANED → (remote cleanup phrase) → REMOTE_BRANCH_CLEANUP_PENDING → (approve) → REMOTE_BRANCH_CLEANUP_APPROVED
  → (explicit execute phrase) → REMOTE_BRANCH_CLEANED`.
- **Which exact structured fields are validated?** At the decision turn: the pending request's `status === PENDING`
  and `executionPlanRef.id === anchor.executionPlanRef.id`. At the execution turn: the request re-reads
  `status === APPROVED` and `executionPlanRef.id === anchor.executionPlanRef.id`, PLUS the full anchored remote
  target (identity match, `pullRequestRef` repo match, `target === pullRequestHeadBranch === pushedBranch`,
  `target !== 'main'`, safe name, expected commit == `mergedHeadSha`). The `ApprovalRef` is consumed by the Manager
  and **never** forwarded to the provider (mirrors merge). *(The live re-read + full execution preflight is
  [Deferred to Sprint 3j-B]; 3j-A records the approval only.)*
- **Approval reason constraints (3j-A, CA change 4).** `buildRemoteBranchCleanupApprovalReason` states ONLY the
  requested permission **target** — `repository` (owner/repo), `pull request` (#number + URL), the `anchored remote
  head branch`, and the `expected head commit` — plus `risk: CRITICAL`, "no deletion performed", "records permission
  only", and "actual remote branch deletion is NOT performed in Sprint 3j-A; a separate 3j-B execution step is
  required". It must **NOT** claim the branch currently exists, that its SHA is still the expected one, that the PR
  is still merged, or that the delete will succeed / is safe now — those are **live execution checks for 3j-B**. The
  user-facing `composeRemoteBranchCleanupRequested` message obeys the same constraint.
- **Deny/cancel (CA change 7).** → back to `BRANCH_CLEANED`, clearing ONLY the four `remoteBranchCleanupApproval*`
  fields; **preserving** `repositoryIdentity`, `pullRequestRef`, `pullRequestHeadBranch`, `pushedBranch`,
  `mergedHeadSha`, `mergeCommitHash`, `syncedMainCommit`, `mainSyncBranch`, `branchCleanupMode`, `cleanedBranch`,
  `cleanedLocalBranch`, `cleanedRemoteBranch=false`.

### 4.7 Failure semantics (Q7) — extends the ADR-0054 rule to remote branch deletion

```text
KNOWN pre-delete block → RemoteBranchCleanupBlockedError → composeRemoteBranchCleanupBlocked
    (any of checks 1–14 fails, incl. approval not APPROVED, identity/ref mismatch, target==main, unsafe name,
    PR not confirmably merged, remote SHA mismatch, could-not-read live state). Safe to say: "원격 브랜치를 삭제하지
    않았어요." Anchor stays REMOTE_BRANCH_CLEANUP_APPROVED (the approval is still valid; the user may retry/execute).

UNKNOWN / generic failure AT/AFTER the DELETE attempt → RemoteBranchCleanupUnverifiedError → composeRemoteBranchCleanupUnverified
    (the DELETE returned non-204 ambiguously, threw, or the result failed integrity). The ref MAY be gone. MUST NOT
    claim "not deleted" and MUST NOT claim "deleted" — say "삭제 결과를 확인하지 못했어요, GitHub에서 확인해 주세요."
    Anchor stays REMOTE_BRANCH_CLEANUP_APPROVED.

ALREADY ABSENT (remote branch 404 at check 11 / provider read) → composeRemoteBranchCleanupSucceeded (alreadyAbsent)
    + anchor REMOTE_BRANCH_CLEANED (idempotent, cleanedRemoteBranch=false); no DELETE call. [CA Q5 preference:
    idempotent, since identity + target remain attributable.]

NOT CONFIGURED (no identity / no manager / no token) → composeRemoteBranchCleanupUnavailable; no state change.
```

New typed errors `RemoteBranchCleanupBlockedError` / `RemoteBranchCleanupUnverifiedError` (the Manager does **not**
blanket-convert provider throws — a provider Blocked stays Blocked; Unverified and any unknown throw are Unverified).

### 4.8 Response composers + wording (Q7) & sequencing recommendation

New `ResponseComposer` methods (deterministic, bounded), distinguishing remote-deleted / already-absent / blocked /
unverified / unavailable, plus the approval request/recorded/denied/cancelled notices (mirroring the merge set):

```text
composeRemoteBranchCleanupRequested(context, { owner, repo, branch, expectedCommit, prNumber, prUrl })
composeRemoteBranchCleanupRecorded(context)        // approval recorded; execution is a separate command
composeRemoteBranchCleanupDenied(context) / composeRemoteBranchCleanupCancelled(context)
composeRemoteBranchCleanupUnavailable(context)     // not configured; no state change
composeRemoteBranchCleanupSucceeded(context, { branch, cleanedRemoteBranch, alreadyAbsent })
  — deleted:       "원격 브랜치 '<name>'을 삭제했어요 (병합 완료된 PR의 브랜치예요). 로컬 브랜치·main은 건드리지 않았어요. 배포/릴리즈/태그도 하지 않았어요."
  — alreadyAbsent: "원격 브랜치 '<name>'은 이미 없어요. 이번엔 삭제한 원격 브랜치가 없어요. 로컬 브랜치·main은 변경하지 않았어요. 배포/릴리즈/태그도 하지 않았어요."
composeRemoteBranchCleanupBlocked(context)         — "원격 브랜치를 삭제하지 않았어요" + safe reason. NEVER claims deleted.
composeRemoteBranchCleanupUnverified(context)      — "삭제 결과를 확인하지 못했어요, GitHub에서 확인해 주세요." NEVER "not deleted"/"deleted".
```

The existing `composeRemoteBranchCleanupUnsupported` (3i) is **repurposed for the pre-`BRANCH_CLEANED` stages**: at
`MAIN_SYNCED` a remote-cleanup phrase → "먼저 로컬 브랜치를 정리한 뒤 원격 브랜치를 정리할 수 있어요" (no mutation),
preserving the local-then-remote chain (`MAIN_SYNCED → BRANCH_CLEANED → REMOTE_BRANCH_CLEANED`).

**Sequencing (CA-mandated split under the single ADR-0060):**

```text
3j-A — Remote Branch Cleanup Approval  ← THIS PR:  BRANCH_CLEANED → REMOTE_BRANCH_CLEANUP_PENDING → REMOTE_BRANCH_CLEANUP_APPROVED.
       Adds the two approval states, the four approval-tracking fields, classifier hardening, the CRITICAL approval +
       decision handlers, and the approval composers. NO provider/manager delete method, NO GitHub write. (mirrors 3f)
3j-B — Remote Branch Cleanup Execution ← LATER:    REMOTE_BRANCH_CLEANUP_APPROVED → REMOTE_BRANCH_CLEANED. Adds the
       provider read+delete methods, RepositoryHostingManager.deleteRemoteBranch, the execution handler, the live
       preflight, and REMOTE_BRANCH_CLEANED. (mirrors 3g)
```

### 4.9 Runtime routing

> **3j-A scope:** implements the `REMOTE_BRANCH_CLEANUP_PENDING` interception, the extended `BRANCH_CLEANED` block,
> and the `REMOTE_BRANCH_CLEANUP_APPROVED` block **as permission-only** (execute phrase → future-step-unavailable,
> NO execution turn). **The `REMOTE_BRANCH_CLEANED` terminal block and `handleRemoteBranchCleanupExecutionTurn` are
> [Deferred to Sprint 3j-B].**

New `REMOTE_BRANCH_CLEANUP_PENDING` interception (top-level, like every pending approval — decision flow ONLY; a
remote-cleanup/execute/deploy phrase while pending re-prompts, never decides, never deletes; CA change 5):

```text
if (applyAnchor?.status === 'REMOTE_BRANCH_CLEANUP_PENDING')
    → handleRemoteBranchCleanupDecisionTurn   (approve → REMOTE_BRANCH_CLEANUP_APPROVED; deny/cancel → BRANCH_CLEANED
       clearing ONLY the four remoteBranchCleanupApproval* fields; anything else → re-prompt)
```

Extended `BRANCH_CLEANED` block (remote phrase checked FIRST, before the local "already cleaned" reply):

```text
1. interpretRemoteBranchCleanupIntent === 'remote' → handleRemoteBranchCleanupApprovalTurn (→ PENDING; NO delete)
2. interpretBranchCleanupIntent === 'local'        → handleBranchAlreadyCleanedTurn (already cleaned; no mutation)
3. interpretMainSyncIntent === 'sync'              → handleMainAlreadySyncedTurn
4. status/check phrase                             → handlePrStatusPreviewTurn (read-only; keeps BRANCH_CLEANED)
5. merge phrase                                    → handleMergeAlreadyMergedTurn
6. DEPLOY_ONLY_WORDS / companion                   → handleMergeExecutionUnsupportedCompanionTurn
```

New `REMOTE_BRANCH_CLEANUP_APPROVED` block (3j-A — permission-only; CA change 6):

```text
1. interpretRemoteBranchCleanupIntent === 'remote'          → handleRemoteBranchCleanupAlreadyApprovedTurn (already approved; execution is a future step; NO mutation)
2. interpretRemoteBranchCleanupExecutionIntent === 'execute'→ handleRemoteBranchCleanupExecutionUnavailableTurn (3j-A: execution not implemented; [Deferred to 3j-B]; NO mutation)
3. status/check phrase                                      → handlePrStatusPreviewTurn (read-only; keeps REMOTE_BRANCH_CLEANUP_APPROVED)
4. merge phrase                                             → handleMergeAlreadyMergedTurn
5. DEPLOY_ONLY_WORDS / companion                            → handleMergeExecutionUnsupportedCompanionTurn
```

**[Deferred to Sprint 3j-B]** — the terminal `REMOTE_BRANCH_CLEANED` routing block and the execution turn
(`handleRemoteBranchCleanupExecutionTurn`) are NOT implemented in 3j-A.

At `MAIN_SYNCED` a remote-cleanup phrase continues to route to `handleRemoteBranchCleanupUnsupportedTurn`
(`composeRemoteBranchCleanupUnsupported`, reworded: remote cleanup is available after the local branch is cleaned,
i.e. from `BRANCH_CLEANED`) — no mutation, preserving the `MAIN_SYNCED → BRANCH_CLEANED → (approval) → …` order.

A new `interpretRemoteBranchCleanupExecutionIntent` (execute verb, e.g. `진행/실행/지금/execute/proceed`) is added in
3j-A but only used to route to the "execution is a future step" reply; the read-only status-preview guard widens to
also accept `REMOTE_BRANCH_CLEANUP_APPROVED`. Every other state is unchanged.

---

## 5. Required Architecture Questions — decisions

- **Q1 (state)** — Add `REMOTE_BRANCH_CLEANUP_PENDING`, `REMOTE_BRANCH_CLEANUP_APPROVED`, `REMOTE_BRANCH_CLEANED`
  (terminal). `REMOTE_BRANCH_CLEANED` = "the completed PR's REMOTE head ref was deleted (or already absent) this
  run"; NOT deploy/release/tag/production-ready/all-cleaned/local-deleted-this-run/repo-fully-cleaned. **Reuse the
  `cleanedRemoteBranch` boolean** (false at BRANCH_CLEANED → true/false at REMOTE_BRANCH_CLEANED) AND add distinct
  descriptive remote fields so the 3i LOCAL cleanup evidence is preserved unoverloaded (§4.1).
- **Q2 (ownership)** — **RepositoryHosting owns it** (GitHub Git-refs REST, keyed by provider identity). **Git
  `push --delete` REJECTED** — Git is local-repository-only and must never handle a remote URL/credentials
  (ADR-0023); routing a remote mutation through it would smuggle blast radius behind a "local" capability (§4.5).
- **Q3 (approval)** — **YES, a NEW CRITICAL ApprovalRequest**, before deletion, always; **two separate turns**
  (approval then execution), mirroring every prior gated mutation; distinct `remoteBranchCleanupApprovalId`;
  structured-fields-only re-read at execution (§4.6).
- **Q4 (trigger)** — Harden `interpretRemoteBranchCleanupIntent` with the bulk/wildcard/`main`-target guards (a
  load-bearing 3j change now that remote → real delete); target always the anchored PR head branch (§4.2).
- **Q5 (preflight)** — 15 checks (§4.3); **already absent → idempotent `REMOTE_BRANCH_CLEANED`**
  (`cleanedRemoteBranch=false`) since identity + target remain attributable (CA preference); a PR no longer
  confirmably merged → Blocked (check 10).
- **Q6 (CAS)** — **GitHub has no atomic SHA-conditional ref delete.** Mitigation = read-immediately-before-delete +
  explicit SHA verify + DELETE, with an explicitly-accepted, bounded residual race and Unverified-on-ambiguity
  (§4.4).
- **Q7 (failure)** — Phase-aware (§4.7): pre-delete → Blocked ("not deleted"); at/after → Unverified (never "not
  deleted"); already absent → idempotent. New typed errors; no blanket-convert.
- **Q8 (out of scope)** — §6.

---

## 6. Out of scope — explicitly forbidden

Sprint 3j's implementation must **not** add or perform any of:

```text
deploy · release · tag creation · delete the default/'main' branch · delete arbitrary/user-named branches ·
bulk branch deletion · wildcard/pattern deletion · force behavior · git push --delete (Git stays local-only) ·
LOCAL branch deletion (that was 3i) · reset --hard · force push · PR mutation (beyond the read-only merged-state
revalidation in check 10) · reviewer/label/assignee mutation · workflow dispatch · check rerun ·
CommandExecution/shell fallback · ExecutionOrchestrator changes · WorkspaceWrite/Patch/CodeGeneration changes ·
Git capability changes
```

`RepositoryHostingProvider` gains exactly one read + one mutating method (both single, exact, bounded). The token
stays adapter-local. The runtime calls the manager only, never the provider, and receives no token.

---

## 7.1 Required tests in Sprint 3j-A (approval-only; 18 — CA list)

Runtime tests (`conversation-runtime.test.ts`) — the next PR ships these:

```text
1.  BRANCH_CLEANED + explicit remote cleanup phrase → REMOTE_BRANCH_CLEANUP_PENDING.
2.  the approval request uses RiskLevel.CRITICAL.
3.  the approval reason contains repository / PR / anchored branch / expected head commit.
4.  the approval reason does NOT claim the branch exists / SHA is current / PR is still merged / deletion is safe now.
5.  the remote cleanup target is the anchored PR head branch ONLY, never a user-supplied name.
6.  bulk / wildcard / all·every·전부·모두·다 / main-delete / default-branch phrases → NO approval request, NO mutation.
7.  non-BRANCH_CLEANED states do NOT request remote cleanup approval.
8.  pending + approve → REMOTE_BRANCH_CLEANUP_APPROVED.
9.  pending + deny/cancel → BRANCH_CLEANED, clearing ONLY the four remote-cleanup approval fields (chain preserved).
10. pending + execute/delete phrase → NO deletion, NO auto-approve (ambiguous re-prompt).
11. the approved state is permission-only and performs NO RepositoryHosting mutation.
12. approved + remote cleanup phrase → "already approved / execution is a future step".
13. approved + execute phrase → "execution is not implemented in 3j-A".
14. status/check phrase remains read-only and preserves REMOTE_BRANCH_CLEANUP_APPROVED.
15. deploy/release phrase remains unsupported.
16. RepositoryHosting provider/manager remote-branch delete methods are ABSENT in 3j-A.
17. the Git capability is unchanged.
18. CommandExecution / shell / ExecutionOrchestrator are untouched.
```

Additional 3j-A guard tests (enduring invariants): the CRITICAL approval id is DISTINCT from
commit/push/PR/merge approval ids; deny/cancel preserves `repositoryIdentity`/`pullRequestRef`/`pullRequestHeadBranch`/
`pushedBranch`/`mergedHeadSha`/`mergeCommitHash`/`syncedMainCommit`/`mainSyncBranch`/`branchCleanupMode`/
`cleanedBranch`/`cleanedLocalBranch`/`cleanedRemoteBranch=false`; no anchor ever reaches `REMOTE_BRANCH_CLEANED` in
3j-A; the classifier hardening rejects a remote-cleanup phrase that also carries a bulk/wildcard/main token.

---

## 7. Full design tests (20 — spans 3j-A + 3j-B)

> Tests 1–18 above are the 3j-A subset. The remaining execution tests (live read, SHA verify, single DELETE,
> Blocked/Unverified split, REMOTE_BRANCH_CLEANED anchoring) are **[Deferred to Sprint 3j-B]**.

Runtime tests (`conversation-runtime.test.ts`) + RepositoryHosting Manager tests (`repository-hosting-manager.test.ts`
with a fake provider) + GitHub adapter tests (`repository-hosting-github` with an injected fake `fetch`). Numbered to
CA's list:

```text
1.  BRANCH_CLEANED + explicit remote cleanup phrase → REMOTE_BRANCH_CLEANUP_PENDING (CRITICAL approval; NO delete).
2.  non-BRANCH_CLEANED (+ non-APPROVED) + remote cleanup phrase → no delete (no manager.deleteRemoteBranch call).
3.  LOCAL cleanup phrase (no remote qualifier) does NOT trigger remote cleanup (routes local).
4.  bulk/wildcard/"main delete" remote phrase → classifier returns null → no approval, no delete.
5.  missing cleanedBranch / pullRequestHeadBranch → Blocked, no delete.
6.  target mismatch with pushedBranch → Blocked, no delete.
7.  target is 'main'/default branch → Blocked, no delete.
8.  unsafe target branch name (fails isSafePushBranch) → Blocked, no delete.
9.  repository identity mismatch (anchor vs configured / ref vs identity) → Blocked, no delete.
10. remote branch missing (404) → idempotent REMOTE_BRANCH_CLEANED (cleanedRemoteBranch=false), no DELETE call.
11. remote branch SHA mismatch (moved after merge) → Blocked, no delete.
12. remote branch SHA match + APPROVED + execute → exactly ONE deleteRemoteBranch (one DELETE) call.
13. delete-call failure AFTER attempt (Unverified / unknown throw / non-204) → Unverified, never "not deleted".
14. known pre-delete failure (approval not APPROVED, PR not merged, SHA mismatch, …) says "not deleted".
15. success anchors REMOTE_BRANCH_CLEANED and preserves the full chain (identity/pullRequestRef/mergedHeadSha/
    mergeCommitHash/syncedMainCommit/mainSyncBranch + all 3i local cleanup fields).
16. response says remote branch deleted; local branch / main / deploy / release / tag untouched.
17. already-absent response says nothing newly deleted and does not overclaim (no deploy/release/tag).
18. no deploy/release/tag/PR mutation/reviewer/label/assignee/workflow dispatch on any path.
19. no shell / CommandExecution fallback; no git push --delete (Git gains no method); adapter uses bounded fetch only.
20. no wildcard/bulk/default-branch delete method EXISTS on the port (single exact-branch signature only).
```

Additional guard tests (enduring invariants): the CRITICAL approval is required and re-read via structured fields at
execution (deny/cancel → BRANCH_CLEANED clearing only remote-cleanup approval fields; PR/merge/sync/local evidence
preserved); the approval + execution cannot both happen in one turn; the Manager does NOT blanket-convert provider
throws (Blocked stays Blocked); exactly ONE DELETE and only after the full preflight passes; the adapter never emits
a `push`/`--delete`/`-r`/force/wildcard and its errors never contain the token or raw payload;
`REMOTE_BRANCH_CLEANED` never unlocks deploy/release/tag and never re-deletes.

---

## 8. Validation & stop condition

- **3j-A implementation validation:** Node 22 · `pnpm typecheck` (exit 0) · `pnpm test` (full suite green, +3j-A tests).
- **3j-A stops after opening the PR** — approval gate only. NO remote deletion, NO GitHub DELETE, NO remote-branch
  mutation, NO RepositoryHosting delete API, NO `REMOTE_BRANCH_CLEANED` active state (all [Deferred to Sprint 3j-B]),
  per CA's Final Instruction. 3j-B is a separately-reviewed sprint.
