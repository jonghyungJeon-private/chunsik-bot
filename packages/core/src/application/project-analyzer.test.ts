import { describe, expect, it } from 'vitest';
import { ProjectAnalyzer } from './project-analyzer';
import type { Session } from '../domain';
import type { Project, ProjectReadout, StorageProvider } from '../ports';
import type { WorkspaceManager } from './workspace-manager';

const READOUT: ProjectReadout = {
  files: [{ path: 'package.json', content: '{"name":"x"}', truncated: false }],
  tree: 'package.json\npackages/',
};

function build(project?: Project) {
  const storage = {
    projects: { async get(_id: string) { return project; } },
  } as unknown as StorageProvider;
  const workspace = { readProjectFiles: async () => READOUT } as unknown as WorkspaceManager;
  return new ProjectAnalyzer(storage, workspace);
}

function session(activeProjectId?: string): Session {
  return { id: 's1', activeProjectId } as unknown as Session;
}

describe('ProjectAnalyzer.prepare (ADR-0019 guard)', () => {
  it('is not ready when the session has no active project (asks to register)', async () => {
    const analyzer = build();
    const prep = await analyzer.prepare(session(undefined));
    expect(prep.ready).toBe(false);
    expect(prep.message).toMatch(/등록/);
    expect(prep.readout).toBeUndefined();
  });

  it('is not ready when the active project no longer exists', async () => {
    const analyzer = build(undefined); // storage.projects.get → undefined
    const prep = await analyzer.prepare(session('missing-id'));
    expect(prep.ready).toBe(false);
    expect(prep.readout).toBeUndefined();
  });

  it('is ready and returns the readout when an active project resolves', async () => {
    const project = { id: 'p1', name: 'x', rootPath: '/tmp/x', createdAt: 0 } as Project;
    const analyzer = build(project);
    const prep = await analyzer.prepare(session('p1'));
    expect(prep.ready).toBe(true);
    expect(prep.readout).toEqual(READOUT);
  });
});
