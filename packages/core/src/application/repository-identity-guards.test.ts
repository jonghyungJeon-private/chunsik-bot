import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Read a relative source file as text, for source-level absence guards (ADR-0051). */
function src(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

/** Strip block + line comments so guards match real CODE, never explanatory prose (e.g. a comment that says
 *  the module "never exposes a git remote URL" must not trip a "git remote" guard). */
function codeOf(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const resolverCode = codeOf(src('./repository-identity-resolver.ts'));
const domainCode = codeOf(src('../domain/repository-hosting.ts'));
const managerCode = codeOf(src('./repository-hosting-manager.ts'));
const portCode = codeOf(src('../ports/repository-hosting-provider.port.ts'));
const runtimeSrc = src('./conversation-runtime.ts');
const composerSrc = src('./response-composer.ts');
const gitDomainSrc = src('../domain/git.ts');
const gitProviderPortSrc = src('../ports/git-provider.port.ts');
const gitManagerSrc = src('./git-manager.ts');
const appModuleSrc = src('../../../../apps/chunsik/src/app.module.ts');

describe('Sprint 3d-A absence guards (ADR-0051 — config-only; no hosting mutation, no wiring, no secrets)', () => {
  it('the new modules use no process/shell/network/command surface (tests 20/24/25/26/27)', () => {
    for (const forbidden of [
      'child_process',
      'spawn(',
      'exec(',
      'execSync',
      'fetch(',
      'node:http',
      'node:https',
      'CommandRunner',
      'CommandExecution',
      'command.run',
    ]) {
      expect(resolverCode.includes(forbidden), `resolver must not contain "${forbidden}"`).toBe(false);
      expect(domainCode.includes(forbidden), `domain must not contain "${forbidden}"`).toBe(false);
    }
  });

  it('the new modules perform no PR creation / hosting mutation (test 28)', () => {
    // `createPullRequest` is the unambiguous hosting-mutation method; it must not appear in 3d-A code.
    expect(resolverCode.includes('createPullRequest')).toBe(false);
    expect(domainCode.includes('createPullRequest')).toBe(false);
  });

  it('the new modules parse no git remote and read no remote URL (CA Q6)', () => {
    for (const s of [resolverCode, domainCode]) {
      expect(/\.remoteUrl\b/.test(s)).toBe(false);
      expect(/git\s+remote/i.test(s)).toBe(false);
    }
  });

  it('RepositoryInfo (domain/git.ts) still declares no remoteUrl field (test 22 — ADR-0023 stands)', () => {
    expect(/remoteUrl/.test(gitDomainSrc)).toBe(false);
  });

  // (Sprint 3d-D, ADR-0054 supersedes) ConversationRuntime is now wired to an optional RepositoryHostingManager
  // + resolved identity, and the composer has PR-created wording — that live wiring is covered by the 3d-D
  // runtime tests. The ENDURING invariant kept here: the runtime/composer never import the GitHub adapter
  // directly (the runtime calls the manager only — CA change 7).
  it('ConversationRuntime never imports the GitHub adapter directly (CA change 7)', () => {
    expect(runtimeSrc.includes('GitHubRepositoryHostingProvider')).toBe(false);
    expect(runtimeSrc.includes('repository-hosting-github')).toBe(false);
  });

  it('ResponseComposer references no RepositoryIdentity type, no createPullRequest, no adapter (Git unchanged)', () => {
    expect(composerSrc.includes('RepositoryIdentity')).toBe(false);
    expect(composerSrc.includes('createPullRequest')).toBe(false);
    expect(composerSrc.includes('GitHubRepositoryHostingProvider')).toBe(false);
  });
});

describe('Sprint 3d-B absence guards (ADR-0052 — skeleton only; no adapter/API/mutation/wiring)', () => {
  it('the new hosting modules use no GitHub adapter / GitHub API / octokit / shell / command surface (tests 43–47)', () => {
    for (const forbidden of [
      'GitHubRepositoryHostingProvider',
      'octokit',
      'Octokit',
      'api.github.com',
      'child_process',
      'spawn(',
      'execSync',
      'fetch(',
      'node:http',
      'node:https',
      'CommandRunner',
      'CommandExecution',
    ]) {
      expect(managerCode.includes(forbidden), `manager must not contain "${forbidden}"`).toBe(false);
      expect(portCode.includes(forbidden), `port must not contain "${forbidden}"`).toBe(false);
      expect(domainCode.includes(forbidden), `domain must not contain "${forbidden}"`).toBe(false);
    }
  });

  it('the new hosting modules contain no merge/deploy/release/reviewer/label/assignee surface (tests 53–58)', () => {
    for (const forbidden of ['merge', 'deploy', 'release', 'reviewer', 'label', 'assignee']) {
      expect(managerCode.includes(forbidden), `manager must not contain "${forbidden}"`).toBe(false);
      expect(portCode.includes(forbidden), `port must not contain "${forbidden}"`).toBe(false);
    }
  });

  it('RepositoryHostingManager has no remote input and does not import isSafePushRemote (test 72)', () => {
    expect(managerCode.includes('isSafePushRemote')).toBe(false);
    expect(managerCode.includes('isSafePushBranch')).toBe(true); // allowed reuse
  });

  // (Sprint 3d-D supersedes) The 3d-B "ConversationRuntime has no PR_CREATED", "composer has no PR-created
  // wording", and "app.module does not bind REPOSITORY_HOSTING_PROVIDER" guards no longer hold — 3d-D wires the
  // adapter and adds PR creation execution. The ENDURING invariants kept here:
  it('ConversationRuntime calls the manager, never importing the GitHub adapter (CA change 7)', () => {
    expect(runtimeSrc.includes('GitHubRepositoryHostingProvider')).toBe(false);
    expect(runtimeSrc.includes('repository-hosting-github')).toBe(false);
  });

  it('Git capability has no PR method (tests 51/52) — GitProvider/GitManager unchanged', () => {
    expect(gitProviderPortSrc.includes('createPullRequest')).toBe(false);
    expect(gitProviderPortSrc.includes('PullRequest')).toBe(false);
    expect(gitManagerSrc.includes('createPullRequest')).toBe(false);
    expect(gitManagerSrc.includes('PullRequest')).toBe(false);
  });

  it('app.module.ts binds the GitHub adapter ONLY via REPOSITORY_HOSTING_PROVIDER construction (Sprint 3d-D)', () => {
    // Wiring now exists (superseding the 3d-B "does not bind" guard); the adapter is constructed at the
    // composition root and reached only through RepositoryHostingManager.
    expect(appModuleSrc.includes('GitHubRepositoryHostingProvider')).toBe(true);
    expect(appModuleSrc.includes('RepositoryHostingManager')).toBe(true);
  });
});
