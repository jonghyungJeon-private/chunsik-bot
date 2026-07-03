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

  it('ConversationRuntime is NOT wired to repository identity — no dep, no anchor field, no reason change (tests 48/49/53/54)', () => {
    expect(runtimeSrc.includes('RepositoryIdentity')).toBe(false);
    expect(runtimeSrc.includes('repositoryHosting')).toBe(false);
  });

  it('ResponseComposer is unchanged for PR creation — no identity/hosting-mutation references (test 50)', () => {
    expect(composerSrc.includes('RepositoryIdentity')).toBe(false);
    expect(composerSrc.includes('createPullRequest')).toBe(false);
    expect(composerSrc.includes('repositoryHosting')).toBe(false);
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

  it('ConversationRuntime has no PR_CREATED / RepositoryHosting reference (tests 48/50)', () => {
    expect(runtimeSrc.includes('PR_CREATED')).toBe(false);
    expect(runtimeSrc.includes('RepositoryHosting')).toBe(false);
    expect(runtimeSrc.includes('createPullRequest')).toBe(false);
  });

  it('ResponseComposer has no PR-created wording / RepositoryHosting reference (test 49)', () => {
    expect(composerSrc.includes('PR_CREATED')).toBe(false);
    expect(composerSrc.includes('RepositoryHosting')).toBe(false);
  });

  it('Git capability has no PR method (tests 51/52) — GitProvider/GitManager unchanged', () => {
    expect(gitProviderPortSrc.includes('createPullRequest')).toBe(false);
    expect(gitProviderPortSrc.includes('PullRequest')).toBe(false);
    expect(gitManagerSrc.includes('createPullRequest')).toBe(false);
    expect(gitManagerSrc.includes('PullRequest')).toBe(false);
  });

  it('app.module.ts does not bind REPOSITORY_HOSTING_PROVIDER (test 78 — no real/fake provider binding)', () => {
    expect(appModuleSrc.includes('REPOSITORY_HOSTING_PROVIDER')).toBe(false);
    expect(appModuleSrc.includes('RepositoryHostingProvider')).toBe(false);
    expect(appModuleSrc.includes('RepositoryHostingManager')).toBe(false);
  });
});
