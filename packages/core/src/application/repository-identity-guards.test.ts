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
const runtimeSrc = src('./conversation-runtime.ts');
const composerSrc = src('./response-composer.ts');
const gitDomainSrc = src('../domain/git.ts');

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
