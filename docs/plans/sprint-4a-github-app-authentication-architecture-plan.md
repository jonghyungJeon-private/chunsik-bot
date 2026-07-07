# Sprint 4a Plan — GitHub App Authentication Architecture (plan-only; auth-model pivot from dev/PAT → GitHub App)

> Product: **Quoky (formerly ChunsikBot V2)**. This document uses **Quoky** as the product-facing name going
> forward; **code identifiers stay unchanged** in this sprint — packages (`@chunsik/core`,
> `repository-hosting-github`, `git-local`), classes (`GitHubRepositoryHostingProvider`, `ConversationRuntime`,
> `ChunsikCore`), env vars (`CHUNSIK_GITHUB_*`), capability numbers (CAP-002/010), ADR numbers, and lifecycle
> states are **not** renamed here (CA Naming Decision + §0.2). Nothing but this doc is touched.

- **Status:** PLAN-ONLY — **APPROVED WITH CHANGES by CA** (Sprint 4a plan review). This revision folds in the full
  CA disposition (Required Changes 1–6, the accepted §17 defaults, and the Quoky naming decision). Still **no
  implementation, no branch, no commit, no PR, no GitHub App / secret creation or configuration, no UAT, no GitHub
  API mutation**. The sole deliverable remains this document. Awaiting CA acceptance of the updated plan.
- **Base:** `main @ bf58b83e5fc780e8f10b928792857a66b738da78` (v1 RC ACCEPTED; UAT operator guide merged).
- **Validation runtime:** Node 22 (per project policy). This sprint changes **no code**, so `pnpm typecheck` /
  `pnpm test` are unaffected; the working tree carries only this doc (plus the untracked Sprint 3o packet).
- **ADR (proposed):** **ADR-0061** — GitHub App Authentication Architecture (next unused number after ADR-0060).
  To be authored/ratified as the **first step of Sprint 4b**, before any implementation (§18, §19 Next Sprint).
- **Capability number:** **NONE.** Not a new capability. It re-sources the *credential* for the existing
  **RepositoryHosting (CAP-010)** REST calls and the *push/clone credential* for **Git (CAP-002)**. No CAP-011,
  no new aggregate, no new god-interface (capability-independence rule upheld).
- **Predecessors this sprint builds on:** ADR-0051 (repository identity is reviewed config; carries no token/URL),
  ADR-0053 (GitHub adapter constraints — built-in `fetch` only, adapter-local token, sanitized errors),
  ADR-0054 (PR-creation execution; the adapter-local token boundary + Blocked/Unverified split), ADR-0057/0060
  (merge + remote-branch-cleanup REST mutations), ADR-0023/0048 (Git owns local ops + the one approved push;
  `RepositoryInfo` exposes **no** remote URL; git-local never handles a remote URL/credential), and the Sprint 3o
  UAT authorization packet (the PAT-based smoke test this pivot pauses).
- **Directive:** CA "Auth Model Pivot" + Sprint 4a plan review. Product auth model:
  `GitHub App installation → selected repositories → installation_id resolution → short-lived installation access
  token minted at execution → no token exposed to Discord/chat/logs/anchors/evidence`. Plan the transition only.

---

## 0. Coverage of the CA-required plan areas

| CA-required plan area | Section |
|---|---|
| GitHub App registration model | §3 |
| Minimum required GitHub App permissions | §4 |
| Installation flow | §5 |
| Repository selection flow | §6 |
| workspace / repository / installation_id data model | §7 |
| Installation token generation flow | §8 |
| Token lifetime and non-storage policy | §9 |
| RepositoryHosting provider integration | §10 |
| Git provider push/clone auth implications | §11 (credential mechanism narrowed per RC1/RC2/RC3) |
| Discord Bot integration boundary | §12 |
| PAT fallback policy for local dev only | §13 |
| UAT smoke test redesign using GitHub App | §14 |
| Security invariants | §15 |
| Migration impact on existing RepositoryHosting capability | §16 |

Additional: §0.1 CA review disposition · §0.2 Naming decision · §1 goal/scope/non-goals · §2 as-is auth model ·
§17 resolved architectural questions (CA rulings) · §18 ADR-0061 content outline · §19 stop condition +
next-sprint direction.

## 0.1 CA review disposition — Sprint 4a plan (APPROVED WITH CHANGES)

Every CA-required change is applied below; this table maps each to where it lives.

| CA item | Disposition | Where applied |
|---|---|---|
| **RC1 — narrow the git credential mechanism** | Applied. Token must never be in argv / shell text / remote URL / `.git/config` / logs / anchors / approval reason / chat / evidence. `http.extraHeader` and `x-access-token:<token>@` URL forms and any token-literal-in-command / persistent-helper-write are **prohibited as the default**. Preferred: **one-shot `GIT_ASKPASS` or one-shot credential helper**, token from env/in-memory closure only, no token literal in the helper, `chmod 700` if materialized, deleted immediately after use. | §11.2 (rewritten), §11.3, §15 S8 |
| **RC2 — ADR-0023 boundary must be explicit** | Applied. Do **not** amend the `GitProvider` port, pass credentials through `@chunsik/core`, add URL/credential to `RepositoryInfo`, or make `RepositoryIdentity` carry credentials. ADR-0061 states the boundary explicitly. §17.1 is now **resolved**. | §11.1, §11.5, §16.1, §17.1, §18 |
| **RC3 — concurrency + env-leakage must be addressed** | Applied. ADR-0061 must answer the five concurrency/leakage questions; first implementation MAY conservatively **block concurrent GitHub-mutating executions**, and if so, user-facing wording must not claim product-wide concurrency. | §11.6 (new), §18 |
| **RC4 — UAT redesigned around GitHub App** | Applied. `quoky-dev` App on the sandbox only, selected-repos only, the exact least-privilege set; new preflight lines incl. "git push credential path uses App token, not ambient keychain/OAuth/PAT". | §14 |
| **RC5 — Discord boundary stays strict** | Applied. Discord never receives/stores/logs private key / installation token / PAT / App JWT and never selects repos as an API permission boundary; may only carry intent, show prompts/not-configured messages, optionally provide an install link. | §12 |
| **RC6 — plan-document update only** | Applied. Only this file changed; no implement/branch/commit/PR/App/secrets/UAT/GitHub mutation. Stop and report after updating. | §19 |
| **§17.2 installation_id capture** | Accepted: resolution-on-demand via `GET /repos/{owner}/{repo}/installation`; webhook deferred. | §5.2, §17.2 |
| **§17.3 mapping persistence** | Accepted: in-memory cache first; persisted `owner/repo → installation_id` deferred to multi-project/team mode. | §7.3, §17.3 |
| **§17.4 token down-scoping** | Accepted: always request `repository_ids` + minimal `permissions` where GitHub allows. | §8.4, §17.4 |
| **§17.5 dev-only PAT fallback** | Accepted: dev-only PAT; prod/UAT-representative runs MUST use App auth; if PAT **and** App auth are both configured in a **non-dev** runtime → **reject config as ambiguous**. | §13, §17.5 |
| **§17.6 JWT signing** | Accepted: built-in Node `crypto` RS256; no Octokit / gh / curl / extra auth SDK for the first implementation. | §8.2, §17.6 |
| **§17.7 App naming** | Accepted: `quoky-dev` / `quoky-prod`. | §3.1, §17.7 |
| **Next sprint** | Sprint 4b — GitHub App Authentication Implementation; may not start until CA explicitly approves; must begin by authoring/ratifying ADR-0061. | §19 |

## 0.2 Naming decision (CA)

```text
Official product / character name : Quoky
Korean user-facing name           : 쿼키
Discord display/context name       : Quoky Bot
Marketing descriptor only          : Quoky AI
Legacy / internal codename         : ChunsikBot / 춘식봇
```
- **Primary name going forward: `Quoky`.** During transition use `Quoky (formerly ChunsikBot V2)` or
  `Quoky (ChunsikBot V2)` where clarification helps.
- **Do NOT rename** code, packages, folders, classes, states, ADRs, or existing docs broadly in this sprint. Code
  identifiers referenced here (`@chunsik/core`, `repository-hosting-github`, `git-local`, `ChunsikCore`,
  `ConversationRuntime`, `GitHubRepositoryHostingProvider`, `CHUNSIK_GITHUB_*`, CAP-002/010, ADR numbers, lifecycle
  state names) are **unchanged**.
- **GitHub App slugs:** the draft `chunsik-dev` / `chunsik-prod` are replaced by **`quoky-dev` / `quoky-prod`**
  (unless CA later chooses different slugs).

---

## 1. Goal, scope, and non-goals

### 1.1 Goal
Design the transition from the current **developer/PAT-based** repository authentication to a **GitHub App
installation-based** model, so that **Quoky** — executed **through the Discord Bot**, not from a terminal with a
hand-injected PAT — authenticates to GitHub the way a distributed product must:

```text
GitHub App registration (one App per environment: quoky-dev / quoky-prod)
→ user installs the App on SELECTED repositories (out-of-band web flow on github.com)
→ installation_id resolved from the reviewed owner/repo (non-secret, identity-adjacent)
→ at EXECUTION time: App private key → signed App JWT → exchange for a SHORT-LIVED installation access token
→ that token authenticates BOTH the REST calls (CAP-010) AND git push/clone (CAP-002)
→ token is minted per-execution, held in memory only, and NEVER reaches Discord/chat/logs/anchors/evidence/core
```

The decisive architectural property we are protecting: the token boundary the codebase **already** enforces
(ADR-0051/0053/0054) means this is an **adapter-local + composition-root** change with **zero `@chunsik/core`
contract change**. The plan's job is to keep it that way (and, per RC1–RC3, to make the git-credential path
non-persistent, secret-safe, and concurrency-honest).

### 1.2 In-scope (design only)
The App registration model, permission set, installation + repository-selection flows; the
`workspace/repository/installation_id` data model; installation-token generation/lifetime/non-storage; the CAP-010
adapter credential swap; the **narrowed** CAP-002 git push/clone credential mechanism (§11, RC1–RC3); the Discord
boundary; the dev-only PAT fallback; the UAT redesign; security invariants; and the CAP-010 migration impact.

### 1.3 Non-goals / explicitly NOT in this sprint (plan-only boundary)
- ❌ No code. No new/edited `.ts`, no port/domain/manager/adapter change, no `config.ts`/`app.module.ts` edit.
- ❌ No GitHub App creation, no private key generation, no installation, no `installation_id` capture, no secret
  configuration (dev or prod).
- ❌ No branch, commit, PR, merge, deploy, tag, release, or **any GitHub API mutation**.
- ❌ No UAT execution and no Sprint 3o §7.1 preflight run. The PAT-based smoke test stays **paused**.
- ❌ No GitHub Enterprise (github.com only, ADR-0053). No change to risk/approval gates, the lifecycle state
  machine, or the Blocked/Unverified taxonomy — auth is orthogonal to governance.
- ❌ No broad renaming of code/packages/classes/states/ADRs/docs (§0.2).

---

## 2. As-is authentication model (the two surfaces we are changing)

There are **two distinct GitHub auth surfaces** today, and the pivot must address **both**. CA accepted this
framing (Sprint 4a review, "What Is Accepted").

### 2.1 Surface A — RepositoryHosting REST (CAP-010)
- `GitHubRepositoryHostingProvider` (`packages/repository-hosting-github/src/index.ts`) holds an **adapter-local**
  token (`GitHubHostingConfig.token`), used **only** as `Authorization: Bearer <token>` on `https://api.github.com`
  calls via the built-in `fetch`. Constructor throws on a blank token.
- Read from the environment as `CHUNSIK_GITHUB_TOKEN` **only** in `apps/chunsik/src/config.ts`; passed **only** to
  the adapter constructor in `apps/chunsik/src/app.module.ts`, and only when non-blank
  (`githubToken.length > 0 ? new RepositoryHostingManager(new GitHubRepositoryHostingProvider({ token })) :
  undefined`). When absent, the manager is `undefined` and the capability fails safe as "not configured".
- The token is **never** returned/logged/placed in an error/stored on the anchor/put in an `ApprovalRequest.reason`
  /shown in a response. `RepositoryHostingManager`, `ConversationRuntime`, and all of `@chunsik/core` never see it.
  `statusError` collapses 401/403 to "authorization failed" with no token/body echo.

### 2.2 Surface B — Local git push/clone (CAP-002)
- `LocalGitProvider.pushApprovedCommit(rootPath, remote, branch, commitHash)`
  (`packages/git-local/src/index.ts`) runs a single `git --no-pager push <remote> HEAD:<branch>` via argv
  `spawnSync` (no shell). `remote` is a **git remote name** (e.g. `origin`), **not** a URL.
- **git-local never handles a token or a remote URL** (ADR-0023): `RepositoryInfo` carries no remote URL; the push
  relies on **ambient git credentials** already configured on the checkout (credential helper / SSH key / a token
  embedded in the configured remote URL). `sanitizeGitStderr` masks token-like substrings and URL-embedded
  credentials **defensively** — a backstop, not the credential path.
- Consequence: in the paused PAT-based UAT, the push credential was whatever the sandbox checkout's git was
  configured with (a PAT in a helper/URL). **This is exactly the fragility CA flagged** — the push credential is
  ambient and terminal-local, not a product-managed, short-lived, scoped credential.

### 2.3 Why the boundary is a gift, not an obstacle
Because core sees **neither** credential, the entire pivot lives in (1) the **adapter** — replace the static PAT
with a minted installation token; and (2) the **composition root / a new adapter-local auth component** — mint the
token and feed git's push/clone credential ephemerally (§11). No port signature, domain type, manager, or runtime
path needs to change to swap the *credential source*. §16 quantifies this.

---

## 3. GitHub App registration model

### 3.1 One App per environment (`quoky-dev` / `quoky-prod`)
- Register **one GitHub App per deployment environment**: **`quoky-dev`** (local/test) and **`quoky-prod`**
  (production), owned by the operating org/account. github.com only (GHE deferred, ADR-0053). Slugs per CA §17.7.
- The App carries: `app_id` (non-secret), `client_id` (non-secret), a **private key** (PEM, the ONLY durable
  secret introduced by this pivot), an optional **webhook secret** (§5.3, deferred), and a fixed permission set
  (§4).
- The App is the *identity of the product*; **installations** are how specific repositories opt in. One App can be
  installed on many repos/orgs; each installation has a stable, non-secret `installation_id`.

### 3.2 What replaces the PAT
| Old (dev/PAT) | New (GitHub App) |
|---|---|
| A human-issued fine-grained PAT, injected into the runtime env | An App private key, adapter-local; installation tokens minted at execution |
| One long-lived secret per operator terminal | One durable secret (private key) per environment; tokens are short-lived |
| Scope tied to the PAT's fixed grant | Scope = the App's permission set ∩ the installation's selected repos (∩ per-run down-scope, §8.4) |
| Ambient/manual for git push | Same minted installation token drives push/clone, via the narrowed mechanism (§11) |

### 3.3 Registration artifacts and where they live
```text
app_id           : non-secret  → environment config (CHUNSIK_GITHUB_APP_ID)
client_id        : non-secret  → environment config (if used)
private key (PEM): SECRET      → adapter-local ONLY (CHUNSIK_GITHUB_APP_PRIVATE_KEY / _PATH); never in core
webhook secret   : SECRET      → composition/webhook boundary ONLY (if webhook capture is later used; §5.3)
installation_id  : non-secret  → data model (§7); resolved/cacheable; grants NOTHING without the private key
```
Registration is a manual, out-of-band github.com action by the operator/CA — **not** in this sprint, never
automated by the bot.

---

## 4. Minimum required GitHub App permissions

Least-privilege, derived **directly** from the operations CAP-010 + CAP-002 perform. Nothing else. (CA RC4 lists
the identical set.)

| Permission | Level | Why (exact operations) |
|---|---|---|
| **Contents** | Read & write | git clone/fetch (read) + the one approved `git push` (write); underpins the Git-refs read/delete for remote branch cleanup. |
| **Pull requests** | Read & write | `createPullRequest` (POST), `findOpenPullRequest`/status/preflight reads, `mergePullRequest` (PUT). |
| **Metadata** | Read (mandatory) | GitHub requires it for repo/branch existence reads. |

**Explicitly NOT requested** (mirrors Sprint 3o + CAP-010 §11):
```text
Workflows : NO   Actions : NO   Packages : NO   Administration : NO   Deployments : NO
Environments/Secrets/Webhooks(repo) : NO   Members/Org admin : NO   Checks(write) : NO (check-runs are READ-only)
```
- **Installation target:** "Only select repositories," never "All repositories." First target: the sandbox
  `jonghyungJeon-private/quoky-uat-sandbox`; production repos opted in explicitly, later.
- **Token down-scoping (CA §17.4, accepted):** installation tokens are minted with a **narrowed**
  `repository_ids` + `permissions` subset (§8.4) wherever GitHub allows, so a single execution's token is scoped
  to exactly the repo + rights that execution needs.

---

## 5. Installation flow

### 5.1 The flow is a web/OAuth flow, out-of-band from Discord's message transport
Installation is a **browser** action on github.com — the operator/repo-owner clicks "Install," picks repositories,
confirms. The bot cannot and must not perform it; it can only *reference* an installation that already exists (§12).

```text
1. Operator opens the App install URL:  https://github.com/apps/quoky-dev/installations/new  (prod: quoky-prod)
2. Operator selects "Only select repositories" → picks the target repo(s) → Install.
3. GitHub creates an Installation with a stable installation_id + a selected-repositories set.
4. installation_id is resolved (§5.2) and used in the data model (§7).
5. From then on: owner/repo → installation_id → mint a token at execution (§8).
```

### 5.2 Capturing installation_id — resolution-on-demand (CA §17.2, accepted default)
- Given a reviewed `RepositoryIdentity {owner, repo}` and an **App JWT** (§8.2), call
  `GET /repos/{owner}/{repo}/installation` → returns the installation object incl. `id` (the `installation_id`),
  resolvable at composition/first-use and cacheable in-memory (§7.3).
- Needs **no** new inbound HTTP surface and no webhook secret to protect; keeps installation_id derivable from
  configuration the operator already reviews (owner/repo).

### 5.3 Webhook capture — DEFERRED (CA §17.2)
A webhook (`installation`, `installation_repositories`, protected by the webhook secret) would enable live
"install → auto-detected" UX but adds an inbound endpoint + a secret to guard. **Deferred**; §5.2 is the default.

### 5.4 Fail-safe when not installed
`GET /repos/{owner}/{repo}/installation` → 404 (App not installed on that repo) ⇒ capability **"not installed /
not configured"** — the exact fail-safe posture the code already has for a missing token (§2.1). No mutation is
attempted; the runtime replies with the existing not-configured path. Point-in-time only, never a durable claim
(Remote observation safety policy).

---

## 6. Repository selection flow

Two distinct layers of "selection":

### 6.1 Installation-time selection (on GitHub) — the security boundary
The repositories the App may touch are chosen **on github.com at install time** ("select repositories"). This is
the authoritative allow-list; the product cannot exceed it; the installation token is scoped to this set. **Discord
never selects repositories as an API permission boundary** (CA RC5).

### 6.2 Runtime target selection (in the product) — the reviewed identity
The product resolves **which** repo an execution targets through the **existing reviewed `RepositoryIdentity`**
(ADR-0051): validated `{provider:'github', owner, repo}` from reviewed config — never parsed from a git remote,
never a freshly user-supplied string in a mutating turn. Unchanged.
- **Invariant:** the runtime target MUST be within the installation's selected-repositories set. A reviewed
  identity that resolves to a repo the App is not installed on → §5.4 not-installed fail-safe (block, no mutation);
  GitHub also enforces this server-side (the token simply has no rights there).
- Per the safety policies: the query target is always the capability's **own anchored ref/identity**, never a repo
  id newly mentioned by the user mid-turn.

---

## 7. workspace / repository / installation_id data model

### 7.1 Design principle: installation_id is identity-adjacent, NOT a credential
- `installation_id` is a **non-secret integer**; it identifies which installation to mint a token for and grants
  nothing without the App private key. It MAY be stored/config/logged operationally, but by policy we keep it out
  of user-facing chat/evidence (operational noise, not conversation).
- Keep the **`RepositoryIdentity` value object pure** (ADR-0051: no token, no URL; CA RC2). We do **not** bolt a
  credential onto identity. installation_id is resolved *alongside* identity, not *inside* it.

### 7.2 Proposed shape (design; not implemented this sprint)
```text
RepositoryIdentity            (UNCHANGED, ADR-0051)
   { provider: 'github', owner, repo }         — reviewed config; no token, no URL

InstallationRef               (NEW, non-secret, design)
   { provider: 'github', installationId: number }
   — resolved from RepositoryIdentity via GET /repos/{owner}/{repo}/installation (§5.2); a small validated value
     object; carries NO token and NO private key.

Environment / auth config     (composition-root only)
   { appId, privateKey|privateKeyPath, [webhookSecret] }   — the private key is the ONLY new durable secret;
     adapter-local; NEVER enters @chunsik/core.

Workspace/Project association (design; where the mapping lives)
   owner/repo  →  installationId          (resolved lazily, §5.2; cached in-memory, §7.3)
```

### 7.3 Global-first, in-memory-cache-first (CA §17.2/§17.3, accepted)
- First implementation: a **global** App + a single resolved installation for the configured identity — the same
  global posture ADR-0051 chose for identity, matching the current single-`repositoryHosting`-identity wiring.
- The `owner/repo → installation_id` mapping is an **in-memory cache first**; a **persisted** mapping is
  **deferred** to multi-project/team mode (and only via a reviewed typed field — never `Project.metadata`).
- **Team Edition path:** the persisted map + per-installation token minting is exactly the multi-tenant seam Team
  Edition needs, added without a Core-contract change (ARCHITECTURE.md §13).

### 7.4 What is NOT stored
- ❌ The App private key — adapter-local secret only; never in the data model/DB/anchor/a persisted record.
- ❌ Installation access tokens — never persisted (§9); in-memory for their lifetime, then discarded.

---

## 8. Installation token generation flow

All adapter-side (or in a small adapter-local auth component the composition root injects). Core never participates.

### 8.1 Overview
```text
private key (PEM, adapter-local)
  → sign a short-lived App JWT (RS256; iss=app_id; iat; exp ≤ 10 min)                           [§8.2]
  → POST /app/installations/{installation_id}/access_tokens  (Authorization: Bearer <appJWT>)   [§8.3]
     (with a narrowed repository_ids + permissions body — CA §17.4)                              [§8.4]
  → receive { token, expires_at, permissions }   (token lives ~1 hour)
  → cache in-memory keyed by installation_id until (expires_at − safety buffer)                  [§9]
  → use as Authorization: Bearer <installationToken> for REST (§10) and as the git credential (§11)
```

### 8.2 App JWT signing — built-in Node crypto only (CA §17.6, accepted)
- RS256 via **Node's built-in `crypto`** (`crypto.sign('RSA-SHA256', …)` / minimal JWT assembly). **No Octokit, no
  gh, no curl, no additional auth SDK** for the first implementation — preserving ADR-0053's "built-in primitives
  only."
- JWT claims: `{ iat: now−30s (clock-skew guard), exp: now+≤600s, iss: app_id }`. Never persisted; regenerated as
  needed. The private key is read once at adapter construction, held adapter-local, never logged/returned.

### 8.3 Installation token exchange
- `POST https://api.github.com/app/installations/{installation_id}/access_tokens` with the App JWT as Bearer, via
  built-in `fetch` (same bounded single-request discipline as ADR-0053 — no pagination/retry loops). Parse `token`
  + `expires_at` only; raw payload never surfaced; 401/403 collapses to "authorization failed" like the current
  `statusError`.

### 8.4 Per-execution down-scoping (CA §17.4, accepted)
The exchange body requests `repository_ids: [<the one target repo>]` and a minimal `permissions` subset (e.g.
`contents: write`, `pull_requests: write`) **wherever GitHub allows**, so the minted token is scoped to the single
repo + rights the current execution needs — defense-in-depth below the App ceiling.

### 8.5 Mint timing — at execution, not at boot
Tokens are minted **lazily at execution time** (or on first use within their lifetime), not eagerly at process
start, so a long-idle process never holds a stale token and a token exists only when an approved operation is about
to run.

---

## 9. Token lifetime and non-storage policy

```text
App private key : DURABLE secret. Adapter-local (env/secret-file). Read once; never logged/returned/persisted to
                  DB/anchor/reason/chat/evidence. The only new long-lived secret.
App JWT         : EPHEMERAL (≤10 min). In-memory, regenerated on demand. Never persisted/logged.
Installation    : SHORT-LIVED (~1 hour, GitHub-issued). In-memory cache keyed by installation_id, refreshed within
  access token   a safety buffer (e.g. if <5 min remaining). NEVER written to DB / disk / logs / anchor /
                  ApprovalRequest.reason / responses / UAT evidence / a git remote URL / .git/config. Discarded on
                  expiry/rotation.
installation_id : NON-secret. May be stored/config; kept out of user chat/evidence by convention (operational).
```
- **Non-storage is enforced structurally:** the token is produced and consumed entirely within the adapter (REST)
  or the ephemeral git-credential mechanism (§11); it never crosses a port boundary into `@chunsik/core`, so there
  is no core-side field it *could* be persisted into (mirrors §2.1).
- **Rotation/leak response** (mirrors Sprint 3o §10): on any suspected exposure → rotate the App private key, stop
  the run, record the incident **without** the secret. Installation tokens self-expire; revocation via
  `DELETE /installation/token`.

---

## 10. RepositoryHosting provider integration (CAP-010)

### 10.1 The only adapter change: swap the credential *source*, not the *shape*
- Today: `GitHubRepositoryHostingProvider` sets `Authorization: Bearer ${this.token}` from a constructor string.
- Proposed: the adapter obtains the header value from an injected **installation-token source**:
  ```text
  GitHubHostingConfig (proposed):
     { auth: { kind: 'github-app', appId, privateKey, installationId, [scope] },  fetchImpl?, timeoutMs? }
   OR { auth: { kind: 'pat', token } }         ← local-dev fallback ONLY (§13)
  ```
- `request(...)` changes from a fixed `Bearer ${this.token}` to `Bearer ${await this.auth.currentToken()}`, where
  `currentToken()` returns the cached-or-freshly-minted installation token (§8) for the App kind, or the static PAT
  for the dev-fallback kind. **Everything else is unchanged:** the fixed `https://api.github.com` base, the bounded
  single-request `fetch`, the sanitized `statusError` (still no token/body echo), the mutation set (POST pulls /
  PUT merge / DELETE git-refs), the read set, and path-safety encoding.

### 10.2 The manager, runtime, ports, and domain do NOT change (CA "What Is Accepted")
- `RepositoryHostingProvider` (port), `RepositoryHostingManager`, `ConversationRuntime`, `RepositoryIdentity`, and
  all of `domain/repository-hosting.ts` are **untouched**. The manager still consumes the `ApprovalRef` and never
  sees a credential; the runtime still calls the manager only. **Approval anchors never store tokens.**
- The Blocked-vs-Unverified split (ADR-0054) is unchanged. A **token-mint failure before the mutating call** is a
  pre-mutation failure → **Blocked** ("did not happen"). A failure **at/after** the mutating call remains
  **Unverified** (Remote mutation safety policy). Auth failures (401/403) collapse to "authorization failed".
  Mid-flight expiry is avoided by minting immediately before the operation (§8.5) + the refresh buffer (§9).

### 10.3 Composition-root change (small, localized)
`app.module.ts` swaps `GitHubRepositoryHostingProvider({ token })` for the App-auth config (from new env in
`config.ts`), keeping the identical fail-safe: build the adapter/manager **only** when App auth is fully configured
(appId + private key + a resolvable installation); otherwise the manager stays `undefined` and the capability is
"not configured" (§2.1). No token/private key is ever passed into core.

---

## 11. Git provider push/clone auth implications (narrowed per RC1/RC2/RC3)

This is the **primary architectural decision** of the pivot, because CAP-002 authenticates differently from CAP-010
and is bound by ADR-0023.

### 11.1 The tension and the accepted boundary (CA RC2)
- The installation token is a normal GitHub credential for git over HTTPS. But **ADR-0023 forbids git-local from
  handling a remote URL or a credential**, and `RepositoryInfo` exposes no remote URL. `LocalGitProvider` takes a
  remote *name*, not a credential.
- **CA-accepted boundary (RC2) — ADR-0061 states it explicitly:**
  ```text
  LocalGitProvider still owns local git operations.
  Core still never sees credentials.
  The GitProvider port remains UNCHANGED (not amended).
  RepositoryInfo carries NO URL/credential field; RepositoryIdentity carries NO credential.
  The GitHub App auth component owns token minting.
  A narrowly-scoped EXECUTION WRAPPER provides git credentials ephemerally for EXACTLY ONE git invocation.
  The credential mechanism must be non-persistent and secret-safe.
  ```

### 11.2 Credential mechanism — NARROWED (CA Required Change 1)
The recommended direction (credential supplied *outside* git-local, per-invocation) is accepted **only** with this
restriction. The installation token must **never** appear in:
```text
process argv · shell command text · git remote URL · .git/config · logs · anchors · approval reason ·
chat response · UAT evidence
```
**Therefore these are PROHIBITED as the default implementation path:**
```text
git -c http.extraHeader="Authorization: Bearer <token>" ...      ← token in argv/process table — FORBIDDEN default
https://x-access-token:<token>@github.com/owner/repo.git         ← token in remote URL — FORBIDDEN default
any command string containing the literal token
any persistent credential-helper write (e.g. `git credential approve`, store/cache helpers)
```
**Preferred FIRST implementation path:**
```text
- a ONE-SHOT GIT_ASKPASS (or one-shot credential helper) for exactly one git invocation
- the token is read from the process ENVIRONMENT or an in-memory CLOSURE only — never passed as an argument
- the helper script/file contains NO token literal (it echoes an env var / closure value at runtime)
- if the helper is materialized to disk, it is chmod 700 and DELETED IMMEDIATELY after the invocation
- no token in argv · no token in .git/config · no token in the remote URL · no token in logs/evidence
```
The token reaches git only through the askpass/helper channel that git itself invokes; the surrounding command
line, config, and URL stay token-free. `sanitizeGitStderr` remains the backstop that masks any stray token/URL-cred
in stderr.

### 11.3 git-local stays unchanged
`LocalGitProvider.pushApprovedCommit(rootPath, remote, branch, commitHash)` and every other method keep their
current signatures and argv discipline. The credential is set up and torn down by the execution wrapper *around*
the call (an adapter-local/composition-owned component), so git-local still never sees a URL or a credential — the
ADR-0023 invariant holds for the adapter (RC2).

### 11.4 Clone/fetch
The same one-shot askpass/helper mechanism (§11.2) covers `clone`/`fetch` for reads (e.g. future workspace
provisioning) using the same installation token. No separate credential path; the same prohibitions apply.

### 11.5 Rejected alternatives (documented)
```text
(b) Extend the GitProvider port with a credential param  → puts a credential into git-local + amends ADR-0023 +
                                                            touches a Core port. REJECTED (CA RC2: do not amend).
(c) Skip git push, do everything via REST                → not viable; the approved push (ADR-0048) must create the
                                                            remote branch before a PR can be opened.
(d) Rely on ambient credentials (status quo)             → the exact fragility CA is eliminating. REJECTED.
```

### 11.6 Concurrency, credential lifecycle, and env-leakage (CA Required Change 3)
Before implementation, **ADR-0061 must answer** the following. This is a gating design obligation for Sprint 4b —
if it cannot be satisfied without global process-env leakage or concurrency risk, **stop and return to CA before
coding further** (RC2/RC3).
```text
Q-C1. Can two Quoky executions run concurrently with DIFFERENT repository installations (different tokens)?
Q-C2. Can one run's GIT_ASKPASS / credential helper leak into another run (shared process env, shared temp file)?
Q-C3. Is credential state scoped to a SINGLE invocation (per-child-process env / per-invocation helper), never a
      global `process.env` mutation that outlives or overlaps another run?
Q-C4. Is cleanup GUARANTEED on every path — success, Blocked failure, AND a thrown exception (finally-scoped
      teardown; helper file unlinked; env not left populated)?
Q-C5. Are child-process env values EXCLUDED from logs and evidence (no env dump; no argv echo; sanitized stderr)?
```
**Design direction (to be ratified in ADR-0061):**
- Prefer **per-invocation, per-child-process** credential state: pass the token via the *child's* environment
  (spawn `env` option) + a one-shot `GIT_ASKPASS`, so nothing is written to the parent's global `process.env` and
  two concurrent spawns never share credential state (answers Q-C2/Q-C3).
- Wrap setup/teardown in a `finally` so the helper file (if any) is unlinked and the credential reference dropped
  on success, Blocked, and exception alike (Q-C4).
- **First implementation MAY conservatively block concurrent GitHub-mutating executions** if a safe per-invocation
  isolation cannot be guaranteed. **If concurrency is blocked, it must be explicit**, and **user-facing wording
  must not claim product-wide concurrency support** (RC3).

---

## 12. Discord Bot integration boundary (CA Required Change 5 — strict)

### 12.1 What the Discord bot is
Per CURRENT_STATE / ARCHITECTURE, the Discord adapter (`packages/adapter-discord`) is a **thin `PlatformAdapter`
transport**: receive message, typing indicator, chunked delivery. It carries conversation, not credentials. It
remains a transport only.

### 12.2 Discord MUST NOT (RC5)
```text
- receive the GitHub App private key
- receive an installation access token
- receive a PAT
- receive an App JWT
- accept secrets pasted into chat        (forbidden; a Sprint 3o hard-stop condition)
- store an installation token
- log an installation token
- select repositories as an API permission boundary   (that is installation-time selection on GitHub, §6.1)
```

### 12.3 Discord MAY ONLY (RC5)
```text
- carry user intent (e.g. "PR 만들어줘") into ConversationRuntime, as today
- show approval prompts (unchanged governance UX)
- show not-installed / not-configured messages (§5.4)
- optionally provide a GitHub App install link (§5.1 deep link)
```

### 12.4 Where installation_id enters relative to Discord
Resolved **server-side** (§5.2 from the reviewed identity), **not** through Discord messages. A Discord `actor`
maps to a workspace/identity (existing Session/Actor seam); the installation is a property of the
repository/workspace, resolved by the runtime — never supplied by the chat user in a mutating turn (safety
policies). The token boundary proven for CAP-010 extends unchanged: the token never enters core, so it never
enters the Discord transport that sits *above* core.

---

## 13. PAT fallback policy — local dev ONLY (CA §17.5, accepted)

### 13.1 Policy
- A **fine-grained PAT path is retained for local development only**, behind the existing `CHUNSIK_GITHUB_TOKEN`
  env, expressed as `auth: { kind: 'pat', token }` (§10.1). It lets a developer exercise the flow without
  registering an App + private key locally.
- **Production and UAT-representative runs MUST use GitHub App auth.** The PAT variant is dev/test only, documented
  non-production, and subject to the SAME adapter-local boundary (never in core/runtime/anchor/reason/logs/chat).
- **Ambiguity rule (CA §17.5):** if **PAT and App auth are both configured in a non-dev runtime**, **reject the
  config as ambiguous** (fail to construct the hosting manager → capability "not configured", fail-safe) rather
  than silently picking one. In an explicit dev runtime, App auth takes precedence when both are present.

### 13.2 Why keep it at all
Removing PAT support entirely would force every local contributor to provision an App + private key just to run the
happy path. The dev-only fallback keeps the inner loop cheap while making App auth the sole production/UAT model.

---

## 14. UAT smoke test redesign using GitHub App (CA Required Change 4)

The Sprint 3o packet is **paused, not discarded** — its sandbox repo, scenarios (A–H), evidence rules, hard-stops,
and rollback carry over. **The paused PAT-based smoke test MUST NOT resume as-is.** Only the **auth provisioning**
changes.

### 14.1 Future UAT auth model (RC4)
```text
quoky-dev GitHub App
installed on jonghyungJeon-private/quoky-uat-sandbox ONLY
selected repositories only
Contents R/W · Pull requests R/W · Metadata read
no workflows · no packages · no administration · no secrets · no org admin
```
- No terminal token; the installation token is **minted at execution** and never displayed. Injection point =
  adapter-local **App private key** (dev secret handling), not a PAT in a terminal.

### 14.2 What stays identical (from Sprint 3o)
- Sandbox `jonghyungJeon-private/quoky-uat-sandbox` (PRIVATE, README.md only), one-line README edit, `uat/<topic>`
  branch, disposable rollback.
- Scenarios A (PR_CREATED) · B (PR_MERGED) · C (REMOTE_BRANCH_CLEANED) · D (deny/cancel) · E (blocked preflight) ·
  G (no-overclaim wording) · H (secret non-exposure) — **H now also verifies the App private key, App JWT, and
  minted token never appear** in chat/log/anchor/evidence. F stays deferred.
- Secret-free evidence; the same hard-stop set ends UAT immediately; attended, windowed, single-operator; launch
  only on explicit CA approval + a live preflight.

### 14.3 New preflight lines (added to Sprint 3o §7.1, per RC4)
```text
[ ] App installed on sandbox repo             — quoky-dev installed on jonghyungJeon-private/quoky-uat-sandbox
[ ] installation_id resolves                   — GET /repos/{owner}/{repo}/installation returns an id from the
                                                 REVIEWED owner/repo (not a chat-supplied id)
[ ] installation token mints (no print)        — a bounded dry mint succeeds; token value NEVER printed
[ ] git push credential path uses App token    — push/clone auth is the minted App token, NOT ambient
                                                 keychain / OAuth / PAT
[ ] no token/key/JWT exposed                    — no App private key / App JWT / installation token in any
                                                 chat / log / anchor / reply / evidence
```

### 14.4 Not in this sprint
No App is registered, installed, or configured here; no UAT is run; no GitHub API mutation. §14 is the **redesign
spec** a future execution sprint (post-implementation, post-CA-approval) will follow.

---

## 15. Security invariants (binding for the implementation sprint)

```text
S1.  The App PRIVATE KEY is adapter-local only. Never in @chunsik/core, ConversationRuntime, an anchor, an
     ApprovalRequest.reason, a response, a log, UAT evidence, or Discord. Read once at adapter construction.
S2.  Installation ACCESS TOKENS are short-lived, minted at execution, held in-memory only, and NEVER persisted /
     logged / surfaced / placed in a git remote URL or .git/config. No core-side field can hold one.
S3.  installation_id is non-secret and grants nothing without the private key; storable, kept out of user chat.
S4.  Least privilege: App permissions = Contents R/W + Pull requests R/W + Metadata R (nothing else); installed on
     SELECT repositories only; tokens down-scoped to the single target repo + minimal permissions per run (§8.4).
S5.  Fail-safe: no App configured / not installed / mint fails BEFORE a mutation → "not configured / Blocked"; no
     mutation attempted; unrelated flows unaffected (mirrors the current no-token behavior). Ambiguous PAT+App in a
     non-dev runtime → rejected (§13.1).
S6.  Unknown / at-or-after-mutation failure → Unverified, never "did not happen" (Remote mutation safety policy).
     Auth-mint failure is pre-mutation → Blocked.
S7.  Point-in-time only for reads (installation existence, token validity) — never a durable/verified/safe-to-act
     claim; the query target is the capability's own anchored identity, never a freshly user-supplied repo id.
S8.  GIT CREDENTIAL (RC1): the token reaches git ONLY via a one-shot GIT_ASKPASS / one-shot credential helper,
     from env/in-memory closure — NEVER in argv / shell text / remote URL / .git/config / logs / anchors / reason /
     chat / evidence; no token literal in the helper; helper chmod 700 if materialized and deleted immediately
     after use; no persistent credential-helper write. sanitizeGitStderr remains the backstop.
S9.  CONCURRENCY/LEAKAGE (RC3): credential state is scoped to a single invocation (per-child-process env / one-shot
     helper), never a global process.env mutation; cleanup is guaranteed on success/Blocked/exception (finally);
     child-process env is excluded from logs/evidence. Concurrent GitHub-mutating executions MAY be blocked in the
     first implementation — and if blocked, that is explicit and not overclaimed as concurrency support.
S10. github.com only (GHE deferred). Built-in fetch + built-in crypto only — no Octokit/gh/curl/extra SDK/shell for
     auth (ADR-0053 preserved). Errors stay sanitized (401/403 → "authorization failed", no token/body).
S11. No new approval design; the existing HIGH/CRITICAL gates in front of push/PR/merge/cleanup are unchanged. Auth
     is orthogonal to governance. Discord stays a transport only (§12).
```

---

## 16. Migration impact on the existing RepositoryHosting capability (CAP-010)

### 16.1 Blast radius — deliberately tiny (CA "What Is Accepted")
```text
CHANGES:
  packages/repository-hosting-github/src/index.ts   — auth source: static Bearer → minted installation token
                                                       (+ a small adapter-local App-auth component: JWT sign +
                                                        token exchange + in-memory cache); public method
                                                        signatures, base URL, request discipline, error
                                                        sanitization, mutation/read sets ALL unchanged.
  apps/chunsik/src/config.ts                         — read CHUNSIK_GITHUB_APP_ID / _PRIVATE_KEY(_PATH) /
                                                       [_INSTALLATION_ID]; keep CHUNSIK_GITHUB_TOKEN as dev PAT;
                                                       reject PAT+App in a non-dev runtime (§13.1).
  apps/chunsik/src/app.module.ts                     — construct the adapter with App-auth config; same fail-safe
                                                       (manager present only when fully configured).
  (git push/clone credential)                        — a NEW adapter-local/composition-owned execution wrapper
                                                       providing the one-shot GIT_ASKPASS / helper credential
                                                       (§11.2/§11.6); git-local (LocalGitProvider) UNCHANGED.

UNCHANGED (zero contract change — CA RC2):
  packages/core/src/ports/repository-hosting-provider.port.ts   — no signature change.
  packages/core/src/ports/git-provider.port.ts                  — no signature change (not amended).
  packages/core/src/domain/repository-hosting.ts                — results/refs/errors unchanged.
  packages/core/src/application/repository-hosting-manager.ts   — approval gating / ordering / integrity unchanged.
  packages/core/src/application/repository-identity-resolver.ts — RepositoryIdentity stays pure (no credential).
  RepositoryInfo (no URL/credential field), ConversationRuntime, lifecycle state machine, risk/approval gates,
  Discord transport — untouched.
```

### 16.2 Why so small — the boundary already did the work
ADR-0051/0053/0054 forced the credential adapter-local from day one. Swapping *which* credential the adapter holds
(a PAT string → an App-auth component that mints tokens) is invisible to core. This migration is the **payoff** of
that discipline and a concrete validation of "every infrastructure component is replaceable behind a port"
(ARCHITECTURE.md §2.3, §13 rule of evolution: adapters/wiring change, Core contracts do not).

### 16.3 Backward compatibility / cutover
The `auth` config is a discriminated union (`github-app` | `pat`), so an environment cuts over by changing env
only. Dev keeps the PAT path (§13); prod/UAT uses App; PAT+App in a non-dev runtime is rejected as ambiguous. No
data migration (tokens aren't persisted; installation_id resolution is lazy/cacheable). No lifecycle-state or
DB-schema change.

---

## 17. Architectural questions — RESOLVED by CA (Sprint 4a review)

All previously-open questions are now decided. Retained for traceability.

1. **§17.1 — ADR-0023 interaction. RESOLVED (CA RC1+RC2).** Do **not** amend the `GitProvider` port; keep
   credentials out of `@chunsik/core`; no URL/credential on `RepositoryInfo`; no credential on `RepositoryIdentity`.
   The token reaches git only via the **narrowed one-shot GIT_ASKPASS / credential-helper** mechanism (§11.2),
   owned by an execution wrapper *outside* git-local; ADR-0061 documents the boundary explicitly (§11.1). The
   `http.extraHeader` and `x-access-token:<token>@` URL forms are **prohibited defaults**.
2. **§17.2 — installation_id capture. RESOLVED: resolution-on-demand** via `GET /repos/{owner}/{repo}/installation`;
   webhook capture **deferred** (§5.2/§5.3).
3. **§17.3 — mapping persistence. RESOLVED: in-memory cache first**; persisted `owner/repo → installation_id`
   deferred to multi-project/team mode (§7.3).
4. **§17.4 — per-execution down-scoping. RESOLVED: always** request `repository_ids` + minimal `permissions` where
   GitHub allows (§8.4).
5. **§17.5 — dev-only PAT fallback. RESOLVED: keep it dev-only**; prod/UAT must use App auth; **PAT+App in a non-dev
   runtime is rejected as ambiguous** (§13.1).
6. **§17.6 — JWT signing. RESOLVED: built-in Node `crypto` RS256**; no Octokit/gh/curl/extra SDK for the first
   implementation (§8.2).
7. **§17.7 — App naming. RESOLVED: `quoky-dev` / `quoky-prod`** (§3.1), unless CA later chooses different slugs.
8. **New gating obligation (CA RC3) — concurrency/env-leakage.** ADR-0061 must answer Q-C1…Q-C5 (§11.6); if it
   cannot be satisfied without global env leakage or concurrency risk, **stop and return to CA before coding**.

---

## 18. Proposed ADR-0061 content outline (authored/ratified as Sprint 4b's first step)

```text
Title      : GitHub App Authentication Architecture (dev/PAT → App installation; adapter-local key, minted
             short-lived installation tokens; CAP-010 REST + CAP-002 push/clone; zero Core-contract change)
Status     : Proposed → (ratified by Product Owner as the FIRST step of Sprint 4b, before implementation)
Scope      : App registration (quoky-dev/quoky-prod); least-privilege permissions; installation + repo-selection
             flows; workspace/repository/installation_id data model; installation-token generation/lifetime/
             non-storage; CAP-010 adapter credential swap; the NARROWED CAP-002 git credential mechanism; Discord
             boundary; dev-only PAT fallback (+ non-dev ambiguity rejection); UAT redesign; security invariants;
             migration.
Must state explicitly (CA RC2):
   - LocalGitProvider still owns local git operations.
   - Core still never sees credentials.
   - The GitProvider port remains UNCHANGED (not amended).
   - RepositoryInfo carries no URL/credential; RepositoryIdentity carries no credential.
   - The GitHub App auth component owns token minting.
   - A narrowly-scoped execution wrapper provides git credentials ephemerally for exactly one git invocation.
   - The credential mechanism is non-persistent and secret-safe (one-shot GIT_ASKPASS/helper; §11.2).
Must answer (CA RC3): Q-C1…Q-C5 (concurrency + env leakage + single-invocation scoping + guaranteed cleanup +
             child-env exclusion from logs/evidence). May block concurrent GitHub-mutating executions if needed,
             stated explicitly without overclaiming concurrency. If unsatisfiable without global env leakage/
             concurrency risk → STOP and return to CA before coding further.
Invariants : the §15 S1–S11 list.
Relations  : supersedes the auth-provisioning of the Sprint 3o UAT packet; extends ADR-0051 (identity stays pure;
             adds InstallationRef alongside), ADR-0053/0054 (adapter-local credential; built-in primitives),
             ADR-0023/0048 (git push credential documented, port NOT amended). No ARCHITECTURE.md amendment
             expected (no Core-contract change).
Consequences: + product-representative auth; short-lived scoped tokens; no ambient/terminal credential; tiny blast
             radius; Team-Edition multi-installation seam. − one new durable secret (App private key); an
             adapter-local auth component (JWT sign + token exchange + cache) + the git-credential wrapper; UAT
             must re-provision; concurrency may be conservatively bounded in v1.
Plan ref   : docs/plans/sprint-4a-github-app-authentication-architecture-plan.md (this document).
```

---

## 19. Stop condition + next-sprint direction

### 19.1 Stop condition (CA Required Change 6)
Plan-document update **only**. Allowed change:
`docs/plans/sprint-4a-github-app-authentication-architecture-plan.md`. **Do NOT** implement, create a branch,
commit, open a PR, create a GitHub App, configure secrets, run UAT, or run any GitHub API mutation. No code is
touched. The PAT-based UAT smoke test remains **paused**. After updating this document, **stop and report**.

### 19.2 Next sprint direction (CA)
```text
Next implementation sprint : Sprint 4b — GitHub App Authentication Implementation
Gate                       : Sprint 4b may NOT start until CA explicitly approves it.
First step of Sprint 4b    : author / ratify ADR-0061 (§18), THEN implement ONLY the approved auth pivot.
```

### 19.3 Status (CA)
```text
Sprint 4a plan            : APPROVED WITH CHANGES (this revision applies them).
PAT-based UAT             : remains paused.
Quoky naming              : accepted as the product-facing name.
Product runtime auth mutation : NONE approved yet.
```
