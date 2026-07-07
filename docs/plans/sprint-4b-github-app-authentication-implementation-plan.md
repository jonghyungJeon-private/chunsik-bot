# Sprint 4b Plan — GitHub App Authentication Implementation (plan-only; concrete implementation design)

> Product: **Quoky (formerly ChunsikBot V2)**. **Naming boundary (CA correction, §0.2):** existing identifiers are
> kept as-is for now (`@chunsik/*` packages, `apps/chunsik`, `CHUNSIK_*` env, `ChunsikConfig`, existing class/type/
> state/CAP/ADR names). **New artifacts added by Sprint 4b use Quoky naming** — the new package is
> **`@quoky/github-app-auth`** and new GitHub App env vars are **`QUOKY_GITHUB_APP_*`**. Broad renaming of existing
> names is **out of scope** here and is deferred to a separate **Sprint 4c — Quoky Naming Migration Plan** (§0.3).
> This document is the concrete implementation plan for the auth pivot accepted in **Sprint 4a** (ADR-0061-to-be).
> **PLAN-ONLY: no code, no ADR authoring, no branch, no commit, no PR, no GitHub App, no secrets, no UAT, no GitHub
> mutation, no rename of existing code/docs.** The sole deliverable is this document; then stop for CA review.

- **Status:** PLAN-ONLY — **APPROVED WITH CHANGES by CA** (Sprint 4b plan review + this naming-boundary correction).
  This revision applies the CA naming correction (§0.1). **Sprint 4b is NOT implementation-approved** — CA will
  re-assess acceptance after this update.
- **Base:** `main @ bf58b83e5fc780e8f10b928792857a66b738da78`.
- **Validation runtime:** Node 22. This sprint changes **no code**; `pnpm typecheck` / `pnpm test` are unaffected.
- **ADR:** **ADR-0061 — GitHub App Authentication Architecture.** Authoring/ratification of ADR-0061 is the
  **first task of the eventual implementation** (§3); no implementation code lands before it (ARCHITECTURE.md
  §11.7). This plan does **not** author the ADR — it defines what the ADR and the implementation contain.
- **Capability:** NONE new. Re-sources the credential for **CAP-010** (REST) and **CAP-002** (git push/clone).
- **Predecessors / inputs:** Sprint 4a plan (`docs/plans/sprint-4a-github-app-authentication-architecture-plan.md`
  — the accepted baseline incl. §11 narrowed credential mechanism, §15 invariants S1–S11, §18 ADR outline);
  ADR-0051/0053/0054 (adapter-local token boundary), ADR-0023/0048 (Git local-only + the one approved push;
  `RepositoryInfo` has no remote URL), the CA Sprint 4a review/acceptance and the CA Sprint 4b review + naming
  correction (RC1–RC6 + this naming boundary).

---

## 0.1 CA review disposition — Sprint 4b plan (APPROVED WITH CHANGES) + naming correction

Naming-correction items (this revision):

| CA item | Disposition | Where applied |
|---|---|---|
| **N1 — new package name** | `@chunsik/github-app-auth` → **`@quoky/github-app-auth`** (new `@quoky` npm scope, coexisting with `@chunsik/*`). Directory `packages/github-app-auth/` (basename convention, matching existing packages). | §2, §4 |
| **N2 — new GitHub App env** | Use **`QUOKY_GITHUB_APP_ID` / `QUOKY_GITHUB_APP_PRIVATE_KEY` / `QUOKY_GITHUB_APP_PRIVATE_KEY_PATH` / `QUOKY_GITHUB_APP_INSTALLATION_ID`**. The new runtime-mode override env is likewise `QUOKY_RUNTIME_ENV`. | §4.1, §10.1 |
| **N3 — new owner/repo env** | If Sprint 4b touches owner/repo config, prefer **`QUOKY_GITHUB_OWNER` / `QUOKY_GITHUB_REPO`** (App installation resolution needs owner/repo, so this is read). | §5, §10.1 |
| **N4 — legacy CHUNSIK_* kept as fallback** | `CHUNSIK_GITHUB_OWNER` / `CHUNSIK_GITHUB_REPO` remain **legacy fallbacks**; `CHUNSIK_GITHUB_TOKEN` remains the **dev-only PAT** fallback (unchanged policy). | §10.1, §11 |
| **N5 — no broad rename in 4b** | Existing `@chunsik/*` packages, `apps/chunsik`, all `CHUNSIK_*` env, `ChunsikConfig`, existing class/type/state names, and existing CAP/ADR numbers/prefixes are **NOT renamed** in Sprint 4b. No repo-wide `ChunsikBot → Quoky` doc substitution. | §0.2, §2, §15.7 |
| **N6 — separate migration sprint** | Bulk renaming of existing names is deferred to **Sprint 4c — Quoky Naming Migration Plan** (plan-only; §0.3). | §0.3 |

Retained Sprint 4b review decisions (unchanged by this correction):
```text
Sprint 4b plan = APPROVED WITH CHANGES; implementation NOT yet approved.
ADR-0061 must be authored/ratified BEFORE implementation.
GitProvider port: NOT changed.               LocalGitProvider: NOT changed.
No credential field on RepositoryInfo / RepositoryIdentity.
Composition-root GitHubAppGitProvider decorator; one-shot GIT_ASKPASS.
No token in argv / URL / .git/config.        HTTPS GitHub remote preflight REQUIRED; SSH blocked for App-auth push.
Discord = credential-free transport.         PAT fallback = dev-only.       UAT re-enters on the GitHub App model.
```

## 0.2 Naming boundary policy (CA)

```text
Existing names (already in the codebase)      : keep as-is for now (legacy identifiers).
New names introduced by Sprint 4b             : use Quoky.
```
- **Quoky** = product / character / new user-facing name. **ChunsikBot / `@chunsik` / `CHUNSIK_*`** = existing
  internal codename / legacy identifiers (kept until Sprint 4c).
- New product-bearing identifiers use Quoky: the new package `@quoky/github-app-auth`, env `QUOKY_GITHUB_APP_*` /
  `QUOKY_GITHUB_OWNER` / `QUOKY_GITHUB_REPO` / `QUOKY_RUNTIME_ENV`.
- **Function-neutral new type/class names that carry no product name** (`GitHubAppAuth`, `GitHubAppGitProvider`,
  `AppAuthConfig`, `AppAuthError`, `GitHubHostingAuth`) are **not** product names, so they stay as chosen — no
  `Quoky`/`Chunsik` prefix is added. The policy applies to product-bearing identifiers, not to neutral technical
  names.
- **Forbidden in Sprint 4b (N5):** renaming `@chunsik/*`, `apps/chunsik`, `CHUNSIK_*` (as a wholesale switch),
  `ChunsikConfig`, existing class/type/state, existing CAP/ADR numbers/prefixes, or a repo-wide doc rename.

## 0.3 Deferred — Sprint 4c — Quoky Naming Migration Plan (plan-only, future)

Bulk migration of existing names is **not** Sprint 4b. A future **Sprint 4c** (plan-only start) will separately
decide: whether `@chunsik/* → @quoky/*`; whether `apps/chunsik → apps/quoky`; whether `CHUNSIK_* → QUOKY_*`; the
legacy `CHUNSIK_*` fallback window; documentation-migration scope; README / operator-guide / UAT-docs /
`CURRENT_STATE` cleanup scope; whether it is a breaking change; and the migration ordering. Sprint 4b performs none
of this.

---

## 0. Coverage of the CA-required Sprint 4b plan scope

| CA-required 4b scope item | Section |
|---|---|
| author ADR-0061 first | §3 |
| define the GitHub App auth component | §4 |
| define installation_id resolution | §5 |
| define installation token minting and in-memory cache | §6 |
| define RepositoryHosting adapter auth-source swap | §7 |
| define git push credential wrapper (one-shot GIT_ASKPASS / non-persistent helper) | §8 |
| prove no token in argv, URL, .git/config, logs, anchors, approval reason, Discord, or evidence | §9 |
| define config shape and fail-safe behavior | §10 |
| define dev-only PAT fallback behavior | §11 |
| define tests (token non-exposure, not-configured, mint failure, git credential isolation) | §12 |
| define UAT re-entry point after implementation | §13 |

Additional: §0.1–§0.3 naming disposition/policy/migration · §1 goal + step sequence · §2 artifact map · §14
implementation order + validation · §15 risks / decisions for CA · §16 stop condition.

---

## 1. Goal and step sequence

### 1.1 Goal
Turn the Sprint 4a baseline into a concrete, reviewable implementation design: a new adapter-local **App-auth
component** (`@quoky/github-app-auth`) that mints short-lived installation tokens, a **RepositoryHosting adapter
auth-source swap** (CAP-010), a **composition-root git-credential decorator** feeding those tokens to `git
push`/`fetch`/`ls-remote` via a one-shot `GIT_ASKPASS` (CAP-002) — with `LocalGitProvider` and the `GitProvider`
port **unchanged** — plus config, fail-safe, dev-only PAT fallback, the full no-token-exposure proof, tests, and the
UAT re-entry gate. New artifacts use Quoky naming (§0.2); existing names are untouched (§0.3).

### 1.2 Implementation step sequence (for the approved Sprint 4b, not this plan-only doc)
```text
Step 1  Author + ratify ADR-0061 (§3). No code before this.
Step 2  New adapter package @quoky/github-app-auth: JWT signing + installation resolution + token mint/cache (§4–§6).
Step 3  RepositoryHosting adapter (CAP-010) auth-source swap to a token source (§7).
Step 4  Composition-root GitProvider credential decorator + one-shot GIT_ASKPASS (§8). LocalGitProvider UNCHANGED.
Step 5  config.ts env (QUOKY_* new + CHUNSIK_* legacy fallback) + app.module.ts wiring + fail-safe rules (§10, §11).
Step 6  Tests: token non-exposure · not-configured · mint failure · git credential isolation (§12).
Step 7  pnpm typecheck (exit 0) + pnpm test (green, Node 22); update CURRENT_STATE/CHANGELOG; PR.
Step 8  (separate, CA-gated) UAT re-entry per §13 after merge + explicit CA approval.
```
This plan-only document performs **none** of these steps.

### 1.3 Plan-only boundary (this document)
❌ No code, ADR authoring, branch, commit, PR, GitHub App creation, secret configuration, UAT, GitHub API mutation,
or rename of any existing code/doc. Only this file is written. Stop and report after writing it (§16).

---

## 2. Artifact map (what the approved Sprint 4b will add/change)

```text
NEW package  packages/github-app-auth/                (@quoky/github-app-auth) — adapter-local App auth [NEW SCOPE]
  src/index.ts        GitHubAppAuth (JWT sign via node:crypto RS256; resolveInstallationId; tokenForInstallation +
                      in-memory cache); AppAuthConfig; AppAuthError (sanitized). Depends only on @chunsik/core
                      (existing core, kept) + Node built-ins (crypto, fetch). No octokit/gh/curl/SDK (ADR-0053).
  src/index.test.ts   unit tests (fake fetch; fake clock via injected now()).
  package.json        { "name": "@quoky/github-app-auth", ... , "dependencies": { "@chunsik/core": "workspace:*" } }
  tsconfig.json       (mirror existing adapter package shape)
  ── introduces the @quoky npm scope, coexisting with @chunsik/*; no existing package is renamed (N5).

CHANGE  packages/repository-hosting-github/src/index.ts     (existing package name kept — N5)
  GitHubHostingConfig.token → GitHubHostingConfig.auth (discriminated union: 'github-app' tokenSource | 'pat').
  request(): Authorization header value comes from `await this.currentToken()`. Everything else UNCHANGED.

NEW  apps/chunsik/src/github-app-git-provider.ts           (existing apps/chunsik dir kept — N5)
  GitHubAppGitProvider implements the core GitProvider port by wrapping an UNCHANGED LocalGitProvider; remote ops
  mint a token (async) then run the inner op through a one-shot GIT_ASKPASS runner; local ops delegate directly.

CHANGE  apps/chunsik/src/config.ts                          (ChunsikConfig kept — N5)
  read NEW QUOKY_GITHUB_APP_ID / QUOKY_GITHUB_APP_PRIVATE_KEY(_PATH) / QUOKY_GITHUB_APP_INSTALLATION_ID;
  read owner/repo preferring QUOKY_GITHUB_OWNER/REPO, falling back to legacy CHUNSIK_GITHUB_OWNER/REPO;
  keep CHUNSIK_GITHUB_TOKEN (dev-only PAT, legacy); read QUOKY_RUNTIME_ENV (default from NODE_ENV).

CHANGE  apps/chunsik/src/app.module.ts
  build GitHubAppAuth once; build the RepositoryHosting adapter with an App token source (or dev PAT); wrap
  LocalGitProvider in GitHubAppGitProvider for GIT_PROVIDER; same fail-safe (manager/decorator only when configured).

UNCHANGED (RC2 + N5):
  packages/core/src/ports/git-provider.port.ts · repository-hosting-provider.port.ts   (ports untouched)
  packages/core/src/domain/*                     (RepositoryInfo no URL/credential; RepositoryIdentity pure)
  packages/core/src/application/*                (RepositoryHostingManager, GitManager, ConversationRuntime, resolver)
  packages/git-local/src/index.ts                (LocalGitProvider byte-for-byte unchanged — §8.5)
  ALL existing @chunsik/* package names, apps/chunsik, CHUNSIK_* env (as identifiers), ChunsikConfig, class/state/
  CAP/ADR names — NOT renamed (deferred to Sprint 4c, §0.3).
  Discord adapter, lifecycle state machine, risk/approval gates.
```

---

## 3. Step 1 — Author ADR-0061 first

Before any implementation code, author and ratify **ADR-0061** using the Sprint 4a §18 outline, and additionally:
- **State the RC2 boundary explicitly** (Sprint 4a §11.1): `LocalGitProvider` owns local git ops; core never sees
  credentials; the `GitProvider` port is **not** amended; `RepositoryInfo` gets no URL/credential; `RepositoryIdentity`
  carries no credential; the App-auth component owns minting; a narrowly-scoped execution wrapper supplies the git
  credential ephemerally for exactly one invocation; the mechanism is non-persistent and secret-safe.
- **Answer RC3 Q-C1…Q-C5 concretely** (concurrency, cross-run leakage, single-invocation scoping, guaranteed
  cleanup on success/blocked/exception, child-env exclusion from logs/evidence) — resolved by the §8 design below.
- **Record the naming boundary** (§0.2): new artifacts use Quoky (`@quoky/github-app-auth`, `QUOKY_GITHUB_APP_*`);
  existing names are kept; broad migration is Sprint 4c.
- Record the ADR-0061 **decision** as the §4–§11 designs and the **invariants** as Sprint 4a §15 S1–S11.
- Ratification by the Product Owner; reviewer ≠ implementer (AGENTS.md §9). No code merges before ratification.

---

## 4. Step 2 — GitHub App auth component (`@quoky/github-app-auth`)

An **adapter-local** package holding the App private key and minting installation tokens. Self-contained
infrastructure; imports only Node built-ins (`node:crypto` for RS256, global `fetch`) and `@chunsik/core` types
(the existing core, kept per N5). **No octokit / gh / curl / extra SDK** (ADR-0053). Bounded single-request `fetch`
per call (no pagination/retry).

### 4.1 Config + construction
```ts
interface AppAuthConfig {
  appId: string;                 // non-secret; from QUOKY_GITHUB_APP_ID
  privateKeyPem: string;         // SECRET — adapter-local ONLY; read once; never logged/returned/persisted
                                 //          (from QUOKY_GITHUB_APP_PRIVATE_KEY or _PATH)
  fetchImpl?: typeof fetch;      // injectable for tests (fake fetch; no live network)
  now?: () => number;            // injectable clock for JWT iat/exp + cache expiry (deterministic tests)
  timeoutMs?: number;            // AbortSignal.timeout for the token/installation calls
}
class GitHubAppAuth {
  constructor(config: AppAuthConfig);           // throws on blank appId/privateKeyPem (mirrors adapter token guard)
  resolveInstallationId(owner: string, repo: string): Promise<number | null>;   // §5
  tokenForInstallation(installationId: number, scope?: TokenScope): Promise<string>;  // §6
}
interface TokenScope { repositoryIds?: number[]; permissions?: Record<string,'read'|'write'> } // §6.3 down-scoping
```

### 4.2 App JWT (built-in crypto RS256; CA §17.6)
Build a JWT `{ alg:'RS256', typ:'JWT' }` / `{ iat: now()-30, exp: now()+540, iss: appId }` (exp ≤ 10 min; 30s skew
guard); sign `base64url(header)+'.'+base64url(payload)` with `crypto.createSign('RSA-SHA256')` over the PEM key.
Never persisted; regenerated on demand. Private key read once at construction, held private, never logged/returned/
placed in an error.

### 4.3 Error discipline
`AppAuthError` messages are **sanitized** — no token, no JWT, no private key, no raw payload. A 401/403 collapses to
`"github app: authorization failed"`; a network failure to `"github app: <op> request failed"`.

---

## 5. Step 2 — installation_id resolution (CA §17.2: resolution-on-demand)

```ts
resolveInstallationId(owner, repo): Promise<number | null>
```
- Sign an App JWT (§4.2) → `GET https://api.github.com/repos/{owner}/{repo}/installation` with `Authorization:
  Bearer <appJWT>`, bounded single `fetch`.
- `200` → parse `id` (positive safe integer) → return it. `404` → **return `null`** ("App not installed on that
  repo" → the not-configured fail-safe, §10.4). Any other status → `AppAuthError` (sanitized).
- **In-memory cache** keyed by `"{owner}/{repo}" → installationId` (installation ids are stable). No persisted
  mapping (CA §17.3 — deferred to multi-project/team). `owner`/`repo` are the reviewed identity read preferring
  `QUOKY_GITHUB_OWNER/REPO`, falling back to `CHUNSIK_GITHUB_OWNER/REPO` (§10.1) — never a chat-supplied id.
- Non-secret value; resolved at composition (eager) or first use (lazy). Optional `QUOKY_GITHUB_APP_INSTALLATION_ID`
  short-circuits resolution when the operator supplies it.

---

## 6. Step 2 — installation token minting + in-memory cache

```ts
tokenForInstallation(installationId, scope?): Promise<string>
```
### 6.1 Mint
Sign an App JWT (§4.2) → `POST https://api.github.com/app/installations/{installationId}/access_tokens` with
`Authorization: Bearer <appJWT>`, bounded single `fetch`. Parse **only** `token` (non-empty string) + `expires_at`
(ISO). Non-2xx → `AppAuthError` (401/403 → "authorization failed").

### 6.2 In-memory cache + refresh buffer
- Cache `installationId → { token, expiresAtMs }` **in memory only** — never persisted/logged/returned in an error.
- Return the cached token if `expiresAtMs - now() > BUFFER_MS` (e.g. `BUFFER_MS = 5*60_000`); else mint a fresh one
  and replace the entry. Minted lazily at execution (Sprint 4a §8.5), never eagerly at boot.
- Optional: de-dup a single in-flight mint per installation via a stored `Promise<string>` (correctness holds
  without it).

### 6.3 Per-execution down-scoping (CA §17.4: always where allowed)
The POST body requests `repository_ids: [<target repo id>]` + minimal `permissions` (`contents:'write'`,
`pull_requests:'write'`) when a `scope` is provided, so the token is scoped to the single target repo + rights.
(Resolving the numeric repo id is one extra bounded cached `GET /repos/{owner}/{repo}`; or omit `repository_ids`
and rely on the installation's selected-repos set — §15.4.)

### 6.4 Shared by both surfaces
`tokenForInstallation` is the single token source for **both** CAP-010 REST (§7) and CAP-002 git (§8) — one mint
serves both within the token's ~1h life.

---

## 7. Step 3 — RepositoryHosting adapter auth-source swap (CAP-010)

### 7.1 Config change (adapter-local; the only adapter edit; existing package name kept — N5)
```ts
type GitHubHostingAuth =
  | { kind: 'github-app'; tokenSource: () => Promise<string> }   // = () => appAuth.tokenForInstallation(id, scope)
  | { kind: 'pat'; token: string };                              // dev-only fallback (§11)
interface GitHubHostingConfig { auth: GitHubHostingAuth; fetchImpl?: typeof fetch; timeoutMs?: number }
```
- `request()` computes the header once per call: `const token = await this.currentToken();` where `currentToken()`
  returns `auth.token` (pat) or `await auth.tokenSource()` (github-app). Header stays `Authorization: Bearer <token>`.
- **Everything else in `GitHubRepositoryHostingProvider` is unchanged:** fixed `https://api.github.com`, bounded
  single-request `fetch`, `statusError` sanitization (no token/body echo), the exact mutation set (POST pulls / PUT
  merge / DELETE git-refs), the read set, `enc`/`encRefPath` path safety, fork rejection, URL validation. The
  adapter knows nothing about JWTs/installations — it receives an opaque bearer string from `tokenSource`.

### 7.2 Manager / runtime / port / domain unchanged (RC2)
`RepositoryHostingProvider` (port), `RepositoryHostingManager`, `ConversationRuntime`, `RepositoryIdentity`, and
`domain/repository-hosting.ts` are untouched. Approval gating, ordering, integrity, the Blocked/Unverified split
(ADR-0054), and "manager never sees a credential, approval anchors never store tokens" hold. A **token-mint failure
before the mutating call is pre-mutation → Blocked** ("did not happen"); at/after → Unverified.

---

## 8. Step 4 — git push/clone credential wrapper (CAP-002)

The core mechanism, satisfying RC1 (narrowed), RC2 (git-local untouched, port unchanged), RC3 (concurrency +
cleanup + no env leakage).

### 8.1 Shape — a composition-root `GitProvider` decorator
```ts
// apps/chunsik/src/github-app-git-provider.ts  (existing apps/chunsik dir kept; the one layer allowed to bridge adapters)
class GitHubAppGitProvider implements GitProvider {
  constructor(deps: {
    makeLocalGit: (runner?: GitRunner) => GitProvider;   // = (r) => new LocalGitProvider(r)  (injected)
    localGit: GitProvider;                               // = new LocalGitProvider()           (for local ops)
    tokenSource: () => Promise<string>;                  // = () => appAuth.tokenForInstallation(installationId, scope)
  });
  // LOCAL ops → delegate to deps.localGit unchanged (no credential needed):
  isRepository/info/status/diff/commitFiles/getLocalRefCommit/isAncestor/deleteMergedLocalBranch → localGit.*
  // REMOTE ops → mint token (async) THEN run inner op through a one-shot-askpass runner:
  pushApprovedCommit/getRemoteRefCommit/syncMainFastForward → withAppCredential(op)
}
```
`GitRunner`/`GitRunResult` are git-local's exported types; the composition root may import them. `LocalGitProvider`
is **not** modified. (Class name is function-neutral, kept per §0.2.)

### 8.2 `withAppCredential` — the ephemeral, one-shot GIT_ASKPASS flow
```text
1. token = await tokenSource()                    // async mint happens HERE, BEFORE the sync spawn
2. dir = fs.mkdtempSync(os.tmpdir()/'quoky-askpass-')   // UNIQUE per invocation → concurrency-safe
3. write dir/askpass.sh (mode 0700), contents contain NO token literal:
      #!/bin/sh
      case "$1" in
        Username*) printf '%s' 'x-access-token' ;;
        *)         printf '%s' "$GIT_APP_TOKEN" ;;     # token read from CHILD env, not the file
      esac
4. childEnv = { ...process.env, GIT_ASKPASS: dir/askpass.sh, GIT_APP_TOKEN: token,
                GIT_TERMINAL_PROMPT: '0' }             // built on a FRESH object; parent process.env NOT mutated
5. runner = (args, {cwd,timeoutMs}) => spawnSync('git', args, { cwd, timeout: timeoutMs, encoding:'utf8', env: childEnv })
             → mapped to GitRunResult exactly like defaultGitRunner
6. result = await deps.makeLocalGit(runner).<sameRemoteMethod>(...originalArgs)   // inner LocalGitProvider spawns git
7. finally: fs.rm(dir, {recursive:true, force:true})                             // cleanup on success/blocked/throw
```
- The token reaches git **only** through `GIT_ASKPASS` reading `GIT_APP_TOKEN` from the **child** process env. It is
  never in argv, never in a `-c` flag, never in a remote URL, never written to `.git/config`, never a token literal
  in the helper file, never a persistent credential-helper write. (`git` invokes `GIT_ASKPASS` only when it needs
  HTTPS credentials — a no-op for any local subcommand.)
- **HTTPS precondition (required preflight):** the configured remote for the target must resolve to an
  `https://github.com/...` URL so git prompts for credentials via askpass. **SSH remotes are blocked for App-auth
  push** (they would use ambient keys); verified in the UAT preflight (§13) and documented as a deployment
  requirement (§15.3).

### 8.3 RC3 — concurrency, cleanup, leakage (answered)
```text
Q-C1 concurrent runs, different installations : each remote call mints its OWN token (cache keyed by installation)
                                                and builds its OWN unique askpass dir + OWN childEnv → isolated.
Q-C2 cross-run leakage                          : no shared temp path (mkdtemp) and no shared env (fresh childEnv
                                                object per call) → one run cannot see another's helper/token.
Q-C3 single-invocation scoping                  : credential state lives in the childEnv passed to ONE spawn +
                                                one temp dir; parent process.env is NEVER mutated.
Q-C4 guaranteed cleanup                          : the temp dir is removed in a `finally` around the inner op — on
                                                success, on a Blocked/Unverified throw, and on any exception.
Q-C5 child-env excluded from logs/evidence      : childEnv/token are never logged; sanitizeGitStderr remains the
                                                stderr backstop; no env dump anywhere.
```
Because per-invocation isolation is guaranteed, **v1 need NOT block concurrent GitHub-mutating executions.** If, at
implementation, isolation cannot be guaranteed on the target platform, v1 MAY conservatively serialize them — and
if so, that limitation is explicit and user-facing wording must not claim product-wide concurrency (CA RC3).

### 8.4 Which methods are credentialed
Remote-touching (need the token): `pushApprovedCommit` (push), `getRemoteRefCommit` (`ls-remote`),
`syncMainFastForward` (`fetch`). Local-only (delegated, no credential): `isRepository`, `info`, `status`, `diff`,
`commitFiles`, `getLocalRefCommit`, `isAncestor`, `deleteMergedLocalBranch`.

### 8.5 Why `LocalGitProvider` stays byte-for-byte unchanged (RC2)
The async token mint happens in the **decorator** (`withAppCredential`) *before* it constructs a fresh
`LocalGitProvider(runner)` whose sync runner already holds the token in `childEnv`. So the sync `GitRunner`
contract, the argv discipline, and git-local's credential-obliviousness are all preserved — git-local never mints,
reads, forwards, or is aware of any token or remote URL. The `GitProvider` **port** is unchanged; the decorator
implements it. (Decorator placement — composition root vs an injected-factory adapter — is §15.1 for CA.)

---

## 9. Step 4/6 — Proof: no token in argv / URL / .git/config / logs / anchors / approval reason / Discord / evidence

| Surface | Why the token cannot appear | Enforced by |
|---|---|---|
| **process argv** | The token is only in `childEnv.GIT_APP_TOKEN`; git argv is `['--no-pager','push',remote,'HEAD:branch']` etc. — no token, no `-c`. | §8.2 step 5; test asserts spawn argv excludes the token. |
| **git remote URL** | The remote stays the configured `https://github.com/...`; token supplied via askpass, never concatenated into a URL. | §8.2; test asserts no URL mutation / no `x-access-token@`. |
| **.git/config** | No `git config` write, no persistent credential-helper write; askpass is env-only + one-shot. | §8.1/§8.2; test asserts no config write. |
| **helper file** | `askpass.sh` reads `$GIT_APP_TOKEN`; contains **no token literal**; mode 0700; deleted in `finally`. | §8.2 steps 3/7; test asserts file bytes exclude the token + file removed. |
| **logs** | App-auth + adapter + decorator never log the token/JWT/key/childEnv; `AppAuthError`/`statusError` sanitized. | §4.3, §7.1; test asserts error/log strings exclude the token. |
| **anchors** | The token never crosses a port into `@chunsik/core`; no anchor field carries it. | RC2, §7.2; existing anchor tests. |
| **approval reason** | `ApprovalRequest.reason` is composed in core, which never sees the token. | RC2; existing approval tests. |
| **Discord** | Discord is a transport above core; the token never reaches core, so never the transport (CA RC5). | Sprint 4a §12; test asserts no token in any composed response. |
| **UAT evidence** | Evidence is secret-free (Sprint 3o §8); UAT preflight asserts no token/key/JWT anywhere (§13). | §13. |

---

## 10. Step 5 — config shape and fail-safe behavior

### 10.1 Env (read ONLY in `apps/chunsik/src/config.ts`; new = QUOKY_*, legacy = CHUNSIK_*)
```text
NEW (Quoky):
  QUOKY_GITHUB_APP_ID                 → app id (non-secret)
  QUOKY_GITHUB_APP_PRIVATE_KEY        → PEM (secret) — OR —
  QUOKY_GITHUB_APP_PRIVATE_KEY_PATH   → path to a PEM file (read at composition; value never logged)
  QUOKY_GITHUB_APP_INSTALLATION_ID    → optional; skips resolution (§5)
  QUOKY_GITHUB_OWNER / QUOKY_GITHUB_REPO → reviewed identity (PREFERRED)
  QUOKY_RUNTIME_ENV                   → 'dev' | 'prod' (default derived from NODE_ENV; 'prod' unless explicitly 'dev')
LEGACY fallback (kept — N4/N5):
  CHUNSIK_GITHUB_OWNER / CHUNSIK_GITHUB_REPO → used only when the QUOKY_* owner/repo are absent
  CHUNSIK_GITHUB_TOKEN                → dev-only PAT fallback (unchanged policy; §11)
```
- Owner/repo resolution order: **`QUOKY_GITHUB_OWNER/REPO` first, else `CHUNSIK_GITHUB_OWNER/REPO`** (legacy). The
  provider is fixed to `'github'` (ADR-0051 unchanged).
- `ChunsikConfig` (existing type name kept — N5) gains `githubApp?: { appId; privateKeyPem }` (resolved from
  key-or-path) + `runtimeEnv`. The private key is placed **only** into the App-auth config at the composition root;
  it never enters core/runtime/anchor/logs.

### 10.2 Auth-mode selection (composition root)
```text
appConfigured = githubApp.appId && githubApp.privateKeyPem present
patConfigured = CHUNSIK_GITHUB_TOKEN non-blank
runtimeEnv == 'prod' (or any non-'dev'):
   appConfigured && patConfigured        → REJECT AS AMBIGUOUS  → not configured (fail-safe, §10.4)   [CA §17.5]
   appConfigured only                    → github-app auth
   patConfigured only                    → REJECT (PAT not allowed in prod) → not configured           [CA §17.5]
   neither                               → not configured
runtimeEnv == 'dev':
   appConfigured (regardless of pat)     → github-app auth (App PRECEDENCE)                              [CA §17.5]
   patConfigured only                    → pat auth (dev fallback, §11)
   neither                               → not configured
```
"Reject" = construct **no** hosting manager and **no** credentialed git decorator → capability "not configured"; a
sanitized one-line warning is logged (no secret). Unrelated flows unaffected.

### 10.3 Wiring (composition root)
- Build `GitHubAppAuth` once (App mode). Build the RepositoryHosting adapter with `auth:{kind:'github-app',
  tokenSource: () => appAuth.tokenForInstallation(installationId, scope)}` (or `{kind:'pat',token}` in dev). Wrap
  `GIT_PROVIDER` in `GitHubAppGitProvider` (App mode) bound to the same `tokenSource`; in PAT/not-configured mode,
  `GIT_PROVIDER` stays the plain `LocalGitProvider` (dev PAT git push uses the dev's own credential — §11.3; §15.5).
- Same **fail-safe** as today: `repositoryHosting = { identity, manager }` with `manager` present only when fully
  configured; `ConversationRuntime` receives `manager | undefined` and never the token (unchanged, §2.1).

### 10.4 Fail-safe behaviors
```text
No App/PAT configured                  → capability "not configured"; no attempt (unchanged).
App config incomplete (missing key)    → not configured (do NOT crash unrelated flows).
Ambiguous / prod-PAT (10.2)            → rejected → not configured; sanitized warning.
Installation not found (resolve → null)→ not installed → not configured for that repo (§5).
Token mint fails BEFORE a mutation     → pre-mutation → Blocked ("did not happen"); REST call/push not attempted.
Token mint/refresh fails AT/AFTER call → Unverified (never "did not happen"); ask to check (Remote mutation policy).
```

---

## 11. Step 5 — dev-only PAT fallback behavior (CA §17.5)

- The PAT path is **local-dev only**, behind the **legacy** `CHUNSIK_GITHUB_TOKEN` env, expressed as
  `auth:{kind:'pat',token}` for the REST adapter. It lets a developer run the flow without registering an App +
  private key. (Kept as a legacy identifier — N4; not renamed in 4b.)
- **Production / UAT-representative runs MUST use App auth.** Non-dev: PAT-only rejected; PAT+App rejected as
  ambiguous (§10.2). Dev: App precedence when both present.
- Same adapter-local boundary (never in core/runtime/anchor/reason/logs/chat).
- **Git push under PAT (dev):** the dev's own git credential handles push (status quo for local dev); the §8
  decorator may optionally accept a PAT token source for dev App-parity (§15.5). The PAT path is never the product/
  UAT model.

---

## 12. Step 6 — tests (the four CA-required categories, concrete)

Fake `fetch` + injected `now()` (no live network, deterministic); no real key/token. Located per the existing
`vitest.config.ts` include (`packages/**/src/**/*.test.ts`, `apps/**/src/**/*.test.ts`).

### 12.1 Token non-exposure
```text
- GitHubAppAuth: a minted token never appears in AppAuthError messages (401/403 → "authorization failed"); the
  private key/JWT never appear in any error/return value.
- RepositoryHosting adapter: with a github-app tokenSource returning a sentinel token, assert the token is not in
  any thrown error, not in statusError (401/403), not in any PullRequestResult/preview field.
- decorator: assert the sentinel token is not in the spawn argv, not in any GitPushResult, not in a thrown
  Git*Blocked/Unverified error message.
- askpass file: assert its bytes do NOT contain the sentinel token (it references $GIT_APP_TOKEN only).
```

### 12.2 Not-configured behavior
```text
- No App + no PAT → hosting manager undefined + GIT_PROVIDER is plain LocalGitProvider; capability "not configured".
- App config incomplete (appId without key / key without appId) → not configured; no crash.
- Ambiguous (App+PAT, prod) and prod-PAT-only → rejected → not configured (sanitized warning).
- resolveInstallationId 404 → returns null → not-installed path (no mutation attempted).
- owner/repo: QUOKY_* preferred; CHUNSIK_* used only when QUOKY_* absent (resolution-order test).
```

### 12.3 Mint-failure behavior
```text
- tokenForInstallation with fake fetch → 401/403 → AppAuthError("authorization failed"); the REST request is NOT
  made and (for a mutation) the manager surfaces Blocked ("did not happen") — pre-mutation.
- installation access_tokens 500 → AppAuthError (sanitized); pre-mutation → Blocked.
- expired cache + failed refresh before a call → Blocked; after-call ambiguity → Unverified (never "did not happen").
```

### 12.4 Git credential isolation
```text
- withAppCredential sets GIT_ASKPASS + GIT_APP_TOKEN on the CHILD env only; assert process.env is NOT mutated
  (snapshot before/after equal).
- remote op (push/ls-remote/fetch) → askpass configured; local op (status/commit) → plain LocalGitProvider, no askpass.
- unique temp dir per invocation (two concurrent calls → distinct paths); no shared state.
- cleanup: the temp dir is removed after success AND after the inner op throws (finally) — assert removed in both.
- no token in the argv array passed to the (fake) spawn; sanitizeGitStderr still masks a token planted in stderr.
```

---

## 13. UAT re-entry point after implementation

- **Gate:** UAT may re-enter **only after** (a) ADR-0061 is ratified, (b) Sprint 4b is implemented, typecheck-clean
  and green on Node 22, PR'd, and **CA implementation-reviewed + merged**, and (c) CA explicitly states
  **"App-auth UAT approved, proceed."** The PAT-based Sprint 3o smoke test does **not** resume as-is.
- **Entry procedure:** run the **Sprint 4a §14 redesigned smoke test** — `quoky-dev` App installed on
  `jonghyungJeon-private/quoky-uat-sandbox` only, the least-privilege set, scenarios A/B/C/D/E/G/H (F deferred),
  secret-free evidence, attended/windowed/single-operator, launch only on explicit CA approval + a live preflight.
- **Preflight additions (Sprint 4a §14.3), verified live before any bot action:**
  ```text
  [ ] quoky-dev App installed on the sandbox repo (Contents R/W · PR R/W · Metadata read; no workflows/packages/admin)
  [ ] installation_id resolves from the REVIEWED owner/repo (QUOKY_GITHUB_OWNER/REPO, else legacy CHUNSIK_*)
  [ ] an installation token mints without printing the token
  [ ] the git push credential path uses the App token via one-shot GIT_ASKPASS — NOT ambient keychain/OAuth/PAT,
      and the target remote is an https://github.com/... URL (SSH bypasses askpass — blocked)
  [ ] no App private key / App JWT / installation token appears in chat/log/anchor/reply/evidence
  ```
- UAT execution itself remains a **separate, CA-gated** activity — not part of Sprint 4b's implementation.

---

## 14. Implementation order + validation (for the approved sprint)

1. ADR-0061 authored + ratified (§3). 2. `@quoky/github-app-auth` + unit tests (§4–§6, §12.1/§12.3).
3. RepositoryHosting adapter auth swap + tests (§7, §12.1/§12.2). 4. `GitHubAppGitProvider` decorator + one-shot
askpass + tests (§8, §12.1/§12.4). 5. `config.ts` (QUOKY_* + CHUNSIK_* legacy fallback) + `app.module.ts` wiring +
fail-safe/ambiguity tests (§10/§11, §12.2/§12.3). 6. `pnpm typecheck` (exit 0) + `pnpm test` (green, **Node 22**).
7. Update `CURRENT_STATE.md` + `CHANGELOG.md`; PR; CA implementation review; merge. No UAT (§13 gate). No rename of
existing names (Sprint 4c, §0.3).

---

## 15. Risks / decisions for CA

1. **§15.1 — decorator placement.** Recommended: `GitHubAppGitProvider` at the **composition root** (`apps/chunsik`,
   the one layer allowed to bridge two adapters), using real git-local + `@quoky/github-app-auth` types (no
   structural duplication; git-local untouched). Alternative: place it in `@quoky/github-app-auth` with an injected
   `LocalGitProvider` factory typed structurally. **Recommended: composition root.**
2. **§15.2 — async mint vs sync spawn.** Resolved by minting in the decorator *before* building the sync askpass
   runner (§8.5), so `LocalGitProvider` and the sync `GitRunner` contract are untouched.
3. **§15.3 — HTTPS-remote precondition.** App-token git auth requires the target remote to be `https://github.com/…`
   (SSH bypasses askpass). Documented + UAT-preflight-checked; SSH blocked for App-auth push. CA to confirm this is
   an acceptable deployment requirement.
4. **§15.4 — repo-id lookup for down-scoping.** Requesting `repository_ids` needs the numeric repo id (one extra
   cached `GET`). Recommended: include it (tightest scope). Alternative: send only `permissions`.
5. **§15.5 — dev PAT and git push.** Recommended: dev PAT is REST-only convenience; dev git push uses the
   developer's own credential. Alternative: give the §8 decorator a PAT token source for dev App-parity. CA confirm.
6. **§15.6 — private key delivery.** `QUOKY_GITHUB_APP_PRIVATE_KEY` (inline PEM) vs `QUOKY_GITHUB_APP_PRIVATE_KEY_PATH`
   (file). Recommended: support both; production uses a securely-mounted file/secret. No secret is created here.
7. **§15.7 — naming scope confirmation (CA correction).** Sprint 4b adds Quoky-named NEW artifacts only
   (`@quoky/github-app-auth`, `QUOKY_GITHUB_APP_*`, `QUOKY_GITHUB_OWNER/REPO`, `QUOKY_RUNTIME_ENV`) and keeps ALL
   existing `@chunsik/*` / `apps/chunsik` / `CHUNSIK_*` / `ChunsikConfig` / class/state/CAP/ADR names. The new
   `@quoky` npm scope coexists with `@chunsik/*`. Bulk migration is deferred to **Sprint 4c** (§0.3). CA to confirm
   this boundary (and whether the new package directory should be `packages/github-app-auth` per basename convention
   or another path).

---

## 16. Stop condition

Plan-only. **This document is the sole deliverable.** No implementation, no ADR authoring, no branch, no commit, no
PR, no GitHub App creation, no secret configuration, no UAT, no GitHub API mutation, and **no rename of any existing
code or doc** (Sprint 4c handles migration, §0.3). The PAT-based UAT remains paused. Sprint 4b is **not
implementation-approved** — after this naming-boundary revision, CA re-assesses acceptance; when approved, the
implementation begins with **ADR-0061 authoring/ratification** (§3), then §14. After writing this document, **stop
and report** for CA review.
