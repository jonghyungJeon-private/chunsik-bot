import { describe, expect, it } from 'vitest';
import { WorkspaceManager } from './workspace-manager';
import { NotImplementedError } from '../errors';
import type { Task, WorkspaceDiff, WorkspaceRef } from '../domain';
import type { ProposedChange, WorkspaceProvider } from '../ports';

/** Records what the provider received, returns canned values. */
function fakeProvider() {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, ...args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const provider = {
    kind: 'local-clone',
    async resolve(ref: WorkspaceRef) {
      record('resolve', ref);
      return ref;
    },
    async readFile(ref: WorkspaceRef, relPath: string) {
      record('readFile', ref, relPath);
      return 'CONTENT';
    },
    async listFiles(ref: WorkspaceRef, glob?: string) {
      record('listFiles', ref, glob);
      return ['a.ts'];
    },
    async diff(ref: WorkspaceRef, changes: ProposedChange[]) {
      record('diff', ref, changes);
      return {
        refId: ref.id,
        files: [],
        estimatedChangedLines: 0,
        truncated: false,
      } satisfies WorkspaceDiff;
    },
  } as unknown as WorkspaceProvider;
  return { provider, calls };
}

describe('WorkspaceManager (ADR-0022 — core builds the ref)', () => {
  it('open() builds a WorkspaceRef from the project + provider kind, then resolves it', async () => {
    const { provider, calls } = fakeProvider();
    const mgr = new WorkspaceManager(provider);
    const ref = await mgr.open({ id: 'p1', rootPath: '/tmp/proj' });
    expect(ref.projectId).toBe('p1');
    expect(ref.rootPath).toBe('/tmp/proj');
    expect(ref.kind).toBe('local-clone'); // taken from provider.kind, not hardcoded
    expect(ref.id).toBeTruthy();
    expect(calls.resolve).toHaveLength(1);
  });

  it('read/list/diff delegate to the provider', async () => {
    const { provider, calls } = fakeProvider();
    const mgr = new WorkspaceManager(provider);
    const ref = await mgr.open({ id: 'p1', rootPath: '/tmp/proj' });
    expect(await mgr.read(ref, 'a.ts')).toBe('CONTENT');
    expect(await mgr.list(ref, '*.ts')).toEqual(['a.ts']);
    const changes: ProposedChange[] = [{ path: 'a.ts', newContent: 'x' }];
    const diff = await mgr.diff(ref, changes);
    expect(diff.refId).toBe(ref.id);
    expect(calls.readFile).toHaveLength(1);
    expect(calls.listFiles?.[0]?.[1]).toBe('*.ts');
    expect(calls.diff?.[0]?.[1]).toBe(changes);
  });

  it('prepare() returns undefined without a project and is otherwise deferred', async () => {
    const { provider } = fakeProvider();
    const mgr = new WorkspaceManager(provider);
    expect(await mgr.prepare({ } as Task)).toBeUndefined();
    await expect(mgr.prepare({ projectId: 'p1' } as Task)).rejects.toBeInstanceOf(NotImplementedError);
  });
});
