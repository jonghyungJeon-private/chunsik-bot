# Sprint 3d-A Plan — Repository Identity Configuration (safe, reviewed source of `provider/owner/repo`; no hosting mutation)

- **Status:** APPROVED WITH CHANGES (all 10 CA required changes applied) → implemented; PR open for CA
  Implementation Review.
- **Base:** `main @ 65da46eeea91ed1caa4cdebe3543e7e3fae7b27d`
- **Validation runtime:** Node 22
- **ADR (proposed):** ADR-0051 — Repository Identity Configuration.
- **Capability:** the **config-only subset of CAP-010 Repository Hosting** (ADR-0050). 3d-A implements ONLY the
  identity types + validators + a resolver (the safe missing-identity detection path) + a config-loading path —
  **no** `RepositoryHostingProvider`/`RepositoryHostingManager`/adapter, **no** hosting mutation, **no** GitHub
  API.
- **Predecessors:** ADR-0050 (Sprint 3c — accepted RepositoryHosting boundary; established that actual PR
  creation is blocked until a reviewed `RepositoryIdentity` configuration source exists — this sprint builds
  that source), ADR-0049 (3b — `PR_APPROVED` anchor), ADR-0023 (CAP-002 Git — the settled
  remote-URL-exclusion decision this sprint must not violate), ADR-0025 (CAP-004 Approval — reason/secret
  discipline mirrored).

## 0. CA review disposition (Sprint 3d-A plan — APPROVED WITH CHANGES)

All 10 CA required changes and the "APPROVED WITH CHANGES" Q decisions (Q3/Q5) are applied. Map:

| CA change | Where applied |
|---|---|
| 1. Explicit token-pattern rejection for owner AND repo | §4.2 `looksLikeSecret`; §6 tests 15–19 |
| 2. Provider fixed `'github'`; app reads no `CHUNSIK_GITHUB_PROVIDER`/token env | §4.4; §6 tests 43/44 |
| 3. Both owner+repo absent → not-configured; one present → invalid-owner/invalid-repo | §4.3; §6 tests 29–31 |
| 4. Owner GitHub-login rules explicit (no leading/trailing/consecutive hyphen; ≤39) | §4.2; §6 tests 32–36 |
| 5. Repo `.git` suffix rejected | §4.2; §6 test 37 |
| 6. Repo leading dot rejected | §4.2; §6 tests 38/39 |
| 7. Resolver never logs / never throws (required property) | §4.3; §6 tests 40/41 |
| 8. `repositoryHosting` config-loader test coverage | §4.4 (vitest glob); §6 tests 42–45 |
| 9. No wiring into ConversationRuntime (absence guards) | §4.5; §6 tests 48–51 |
| 10. ADR states 3d-A does not satisfy PR-execution readiness by itself | §8 |
| Q3 APPROVED WITH CHANGES (token/.git/leading-dot/hyphen edges) | §4.2 |
| Q5 APPROVED WITH CHANGES (token-pattern rejection; loader reads no token; tests) | §4.2/§4.4/§4.5 |

## 1. Goal

Sprint 3d-A answers, with a safe implementation:

```text
How does ChunsikBot know the repository identity for future PR creation?
```

Required identity: `provider = github`, `owner`, `repo`, from reviewed **configuration only** — never from
`git remote -v`, `RepositoryInfo.remoteUrl` (does not exist — ADR-0023), a raw pasted URL, unbounded
per-request user input, a connector, or a runtime shell.

```text
env (owner/repo) ── read ONLY in apps/chunsik/src/config.ts ──▶ RepositoryIdentityConfig | undefined
                                                                        │
                                                RepositoryIdentityResolver.resolve(config)   (pure, in core)
                                                                        │
                              ┌─────────────────────────────────────────┴───────────────────────────────┐
                     { status: 'resolved', identity: RepositoryIdentity }        { status: 'missing', reason }
                              (consumed by future RepositoryHosting, 3d-C)         (future → not-configured response)
```

3d-A stops at producing the resolution; it is **not** consumed by any conversation flow (that wiring is 3d-C).

## 2. Boundary & the most important rules

> Repository identity is **explicit reviewed configuration** — a validated `{ provider:'github', owner, repo }`.
> Never parsed from a git remote, never carries a token, never widens `RepositoryInfo` (ADR-0023 stands).
> github.com only; GitHub Enterprise deferred. **3d-A does not satisfy PR-execution readiness by itself**;
> actual PR creation stays blocked until 3d-B/3d-C are accepted.

**Allowed (implemented):** `RepositoryIdentity`/`RepositoryIdentityConfig` domain types; validators for
`provider`/`owner`/`repo` (incl. token/`.git`/leading-dot rejection); pure `RepositoryIdentityResolver`; the
env-reading config path in `apps/chunsik/src/config.ts`; tests; ADR-0051.

**NOT introduced (verified):** actual PR creation · `RepositoryHostingProvider.createPullRequest` · GitHub API
call · a mutating adapter · `PR_CREATED` state · merge/deploy/release · reviewer/label/assignee mutation · git
remote parsing · `RepositoryInfo.remoteUrl` · `CommandExecution` · runtime shell-out · any
`ConversationRuntime`/anchor/`ResponseComposer`/`ApprovalRequest` change.

## 3. Architecture & reuse (source-verified)

- **Single config-loading path.** `apps/chunsik/src/config.ts` header: *"This is the ONLY place env vars are
  read; everything downstream receives typed config objects."* 3d-A adds a `repositoryHosting` section there,
  and makes `loadConfig(env = process.env)` accept an injectable env for narrow testability.
- **Domain vs loading split.** Framework-agnostic types + pure logic live in `packages/core` (`domain/
  repository-hosting.ts`, `application/repository-identity-resolver.ts`); only the raw env read lives in the app.
- **Q2 grounding.** `Project` = `{ id, name, rootPath, techStack?, commands?, conventions?, metadata? }`,
  `ProjectManager.register(path, session)` captures a **local path only**; `Project.metadata` is `Metadata =
  Record<string, unknown>` (untyped/unbounded). Therefore **global runtime config** first; per-project deferred.
- **`RepositoryInfo` unchanged (Q6).** `packages/core/src/domain/git.ts` excludes remote URLs (ADR-0023);
  git-local's "does NOT expose remote URLs / credentials in info" regression test remains green.
- **Test-file build exclusion (verified).** `tsconfig.base.json` `"exclude": ["**/*.test.ts"]` is inherited
  (package tsconfigs set only `include`), so `tsc -b` does not typecheck test files — the fs-based guard test
  may use `import.meta.url` (vitest-only) safely.

## 4. Design (as implemented)

### 4.1 Domain types (`packages/core/src/domain/repository-hosting.ts`)

```ts
export type RepositoryHostingProviderKind = 'github';        // github.com only; GHE deferred
export const MAX_REPO_OWNER = 39;
export const MAX_REPO_NAME = 100;
export interface RepositoryIdentity { provider: RepositoryHostingProviderKind; owner: string; repo: string; }
export interface RepositoryIdentityConfig { provider: string; owner: string; repo: string; }  // RAW, no token field
```

### 4.2 Validators (pure; CA changes 1/4/5/6, Q3/Q5)

```ts
isSupportedHostingProvider(p)  // === 'github' only
looksLikeSecret(value)         // case-insensitive: rejects ghp_/github_pat_/gho_/ghu_/ghs_/ghr_ prefixes
                               //   and 'token'/'secret'/'password'/'pat_' substrings (false rejection OK)
isSafeRepoOwner(s)   // string, ≤39, /^[A-Za-z0-9](?:-?[A-Za-z0-9])*$/ (no leading/trailing/consecutive hyphen),
                     //   !looksLikeSecret  → whitespace/control/URL rejected by the class
isSafeRepoName(s)    // string, /^[A-Za-z0-9._-]{1,100}$/, not '.'/'..', NO leading dot (CA #6),
                     //   NO /\.git$/i suffix (CA #5), !looksLikeSecret (CA #1)
```

### 4.3 Resolver (`packages/core/src/application/repository-identity-resolver.ts`; Q4/Q7/Q8)

```ts
type RepositoryIdentityMissingReason = 'not-configured' | 'unsupported-provider' | 'invalid-owner' | 'invalid-repo';
type RepositoryIdentityResolution =
  | { status: 'resolved'; identity: RepositoryIdentity }
  | { status: 'missing'; reason: RepositoryIdentityMissingReason };

class RepositoryIdentityResolver {                       // constructor arity 0 → no logger (CA #7)
  resolve(config): RepositoryIdentityResolution {         // never throws (CA #7)
    if (!config) return missing('not-configured');
    owner/repo := string-or-'';
    if (!owner && !repo) return missing('not-configured');           // CA #3 both absent
    if (!isSupportedHostingProvider(config.provider)) return missing('unsupported-provider');
    if (!isSafeRepoOwner(owner)) return missing('invalid-owner');    // CA #3 repo present, owner absent
    if (!isSafeRepoName(repo))  return missing('invalid-repo');      // CA #3 owner present, repo absent
    return resolved({ provider:'github', owner, repo });             // copies ONLY 3 fields (Q5 no-leak)
  }
}
```

**Q4:** future Repository Hosting receives a validated **`RepositoryIdentity`** (not raw config, not a Ref).
**Q8:** any `missing` is the safe detection path a future 3d-C maps to "저장소가 설정되지 않았어요" — not wired
in 3d-A.

### 4.4 Config-loading path (`apps/chunsik/src/config.ts`; Q1, CA changes 2/8)

```ts
loadConfig(env = process.env): ChunsikConfig  // env injectable for tests; env reading stays in this file
// ChunsikConfig gains: repositoryHosting?: RepositoryIdentityConfig
repositoryHosting:
  env.CHUNSIK_GITHUB_OWNER || env.CHUNSIK_GITHUB_REPO
    ? { provider: 'github', owner: env.CHUNSIK_GITHUB_OWNER ?? '', repo: env.CHUNSIK_GITHUB_REPO ?? '' }
    : undefined,
```

- Reads **only** `CHUNSIK_GITHUB_OWNER`/`CHUNSIK_GITHUB_REPO`; **no** `CHUNSIK_GITHUB_PROVIDER`, **no** token
  env var. `provider` fixed `'github'`. Both absent → `undefined`; one present → raw config the resolver
  classifies.
- `vitest.config.ts` `test.include` gains `'apps/**/src/**/*.test.ts'` (the narrowest change enabling the
  config-loader test — CA change 8). Nothing else in the app is wired.
- The composition root MAY construct `new RepositoryIdentityResolver()`, but 3d-A does **not** inject it into
  `ConversationRuntime` (no consumer exists; consistent with CAP-004..008 being added "not orchestrator/Discord
  wired").

### 4.5 Absence guards & secret discipline (Q5/Q6, CA changes 1/9)

- `RepositoryIdentity`/`RepositoryIdentityConfig` have no token/remoteUrl field; resolver copies only 3 fields;
  resolver has no logger and never throws; config reads no token env; 3d-A adds no anchor field / approval
  reason → no token can reach identity/anchor/`ApprovalRequest.reason`/logs.
- A source-level guard test (`repository-identity-guards.test.ts`) proves: the new modules contain no
  `child_process`/`spawn(`/`exec(`/`fetch(`/`CommandRunner`/`CommandExecution`/`createPullRequest`, parse no
  `git remote`, and read no `.remoteUrl`; `RepositoryInfo` still declares no `remoteUrl`; `ConversationRuntime`
  and `ResponseComposer` contain no `RepositoryIdentity`/`repositoryHosting`/new `createPullRequest`.

## 5. Required Architecture Questions — decisions (with CA dispositions)

- **Q1 (where) — APPROVED.** `apps/chunsik/src/config.ts` sole env reader; types/validators/resolver in core.
- **Q2 (global vs per-project) — APPROVED.** Global first; per-project deferred; `Project.metadata` not used.
- **Q3 (validation) — APPROVED WITH CHANGES (applied §4.2):** provider=github; bounded GitHub-login owner;
  conservative repo; **+ token-pattern rejection, `.git` suffix rejection, leading-dot rejection, hyphen edges**.
- **Q4 (exposure) — APPROVED.** Validated `RepositoryIdentity`; not raw config, not a Ref.
- **Q5 (secrets) — APPROVED WITH CHANGES (applied):** no token field; resolver copies only 3 fields; **+
  explicit token-pattern rejection; loader reads no token env; tests prove no token in identity/config/anchor/
  reason/logs**.
- **Q6 (Git change) — APPROVED.** None; no `RepositoryInfo.remoteUrl`; no git remote parsing.
- **Q7 (RepositoryHosting implemented?) — APPROVED.** No hosting mutation; identity subset only.
- **Q8 (missing identity) — APPROVED.** `{ status:'missing', reason }`; detection path only in 3d-A.

## 6. Required tests (Node 22) — CA's 56-item list, mapped

**Validators / resolver** (`repository-hosting.test.ts`, `repository-identity-resolver.test.ts`): 1 valid →
resolved; 2 non-github → rejected; 3 empty owner / 4 empty repo; 5 whitespace owner / 6 whitespace repo; 7
owner slash / 8 repo slash; 9 owner URL / 10 repo URL; 11 owner control char / 12 repo control char; 13 long
owner / 14 long repo; 15 repo `ghp_…` / 16 repo `github_pat_…` / 17 repo `my-token` / 18 repo `secret-repo` /
19 owner token-like → rejected; 20 resolved identity no token field / 21 no remoteUrl field; 29 missing config
→ not-configured; 30 owner present, repo absent → invalid-repo / 31 repo present, owner absent → invalid-owner;
32 `-owner` / 33 `owner-` / 34 `own--er` rejected; 35 39-char owner accepted / 36 40-char rejected; 37
`chunsik-bot.git` rejected; 38 `.repo` rejected / 39 `repo.name` accepted; 40 resolver never throws / 41 no
logger dependency (arity 0); 46 identity no token field / 47 no remoteUrl (identity key-set === provider/owner/
repo).

**Config loader** (`apps/chunsik/src/config.test.ts`): 42 reads OWNER/REPO into `repositoryHosting`; 43 reads no
token env; 44 reads no `CHUNSIK_GITHUB_PROVIDER`; 45 undefined when both absent.

**Absence guards** (`repository-identity-guards.test.ts` + green full suite): 22 `RepositoryInfo` no remoteUrl;
23 `GitProvider.info` no remote URLs (existing git-local regression stays green); 24 no git remote command; 25
no `CommandExecution`; 26 no runtime shell-out; 27 no GitHub API; 28 no PR creation; 48 `ApplyPreviewAnchor`
no identity field / 49 `ConversationRuntime` deps unchanged / 50 `ResponseComposer` unchanged / 51
`ApprovalRequest` reason unchanged (proven by no `RepositoryIdentity`/`repositoryHosting`/new `createPullRequest`
in those files + untouched); 52 logs no secret (no logger) / 53 approval reason cannot include token / 54
anchor cannot include token.

**Node 22:** 55 `pnpm typecheck` green; 56 `pnpm test` green.

**Result:** 46 new tests added (22 validators + 13 resolver + 6 guards + 5 config); full suite **45 files / 780
tests pass** on Node v22.22.1; `pnpm typecheck` exit 0.

## 7. Architecture Impact / Reuse

- **Adds:** `packages/core/src/domain/repository-hosting.ts` (+ `domain/index.ts` export);
  `packages/core/src/application/repository-identity-resolver.ts` (+ `application/index.ts` export);
  `repositoryHosting?` in `apps/chunsik/src/config.ts` (+ injectable `env`); `apps/**` glob in
  `vitest.config.ts`; 4 test files; ADR-0051.
- **Does NOT change:** `GitProvider`/`GitManager`/`LocalGitProvider`/`RepositoryInfo`, `ExecutionOrchestrator`,
  `ConversationRuntime`, `ApplyPreviewAnchor`, `ApprovalManager`/`ApprovalRequest`, `ResponseComposer`,
  `WorkspaceWrite`/`Patch`/`CodeGeneration`/`CommandExecution`. No provider/adapter package, no GitHub API, no
  PR creation, no hosting mutation.

## 8. ADR-0051 (proposed) — Repository Identity Configuration

Authored in `DECISIONS.md`. Records (CA change 10 + required content): repository identity is explicit reviewed
configuration; `provider = github` only (github.com only; GHE deferred); owner/repo read only from
`apps/chunsik/src/config.ts` (`CHUNSIK_GITHUB_OWNER`/`CHUNSIK_GITHUB_REPO`), never a provider/token env; types/
validators/resolver in framework-agnostic core; global runtime config first (per-project deferred;
`Project.metadata` not an identity source); no git remote parsing / no `RepositoryInfo.remoteUrl` / no
connector / no shell / no `CommandExecution` / no GitHub API / no PR creation / no
`RepositoryHostingProvider`/`Manager`/adapter / no `PR_CREATED` / no `ConversationRuntime` dep / no anchor
identity field; `RepositoryIdentity`/`RepositoryIdentityConfig` have no token/remoteUrl field; token-like
owner/repo rejected; repo `.git` suffix + leading dot rejected; resolver returns a safe missing result, never
guesses; and — **3d-A does not satisfy PR-execution readiness by itself; actual PR creation remains blocked
until later Repository Hosting implementation Sprints (3d-B/3d-C) are accepted.**

## 9. Implementation sequence (CA-authorized)

1. Apply plan changes (this document). 2. Author ADR-0051. 3. Implement domain types + validators + resolver +
re-exports. 4. Add `repositoryHosting` config + `apps/**` vitest glob. 5. Add the 46 tests. 6. Validate on Node
22 (typecheck exit 0 + full suite green). 7. Open PR for Chief Architect Implementation Review. **No hosting
mutation, no GitHub API, no PR creation.**

## 10. Stop condition

Implementation is CA-authorized through PR. After opening the PR, **do not merge** — await Chief Architect
Implementation Review. **No hosting mutation, no GitHub API, no PR creation, no `RepositoryHostingProvider`/
`Manager`/adapter, no `PR_CREATED`.**
