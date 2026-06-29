import { describe, expect, it } from 'vitest';
import { ProjectManager } from './project-manager';
import { MemoryManager } from './memory-manager';
import { SessionManager } from './session-manager';
import { MemoryType, SessionStatus } from '../domain';
import type { Project, Session } from '../domain';
import type { ProjectScan, StorageProvider } from '../ports';
import type { WorkspaceManager } from './workspace-manager';
import type { VectorProvider } from '../ports';

function fakeStorage() {
  const projects: Project[] = [];
  const memories: Array<{ type: string; scope: { projectId?: string; sessionId?: string }; content: string }> = [];
  const sessions = new Map<string, Session>();
  const storage = {
    projects: {
      async save(p: Project) {
        projects.push(p);
        return p;
      },
      async get() {
        return null;
      },
      async delete() {},
      async list() {
        return projects;
      },
    },
    memories: {
      async save(m: any) {
        memories.push(m);
        return m;
      },
      async findByScope(scope: any, type?: string) {
        return memories.filter(
          (r) =>
            (type === undefined || r.type === type) &&
            (scope.projectId === undefined || r.scope.projectId === scope.projectId) &&
            (scope.sessionId === undefined || r.scope.sessionId === scope.sessionId),
        );
      },
      async get() {
        return null;
      },
      async delete() {},
      async list() {
        return memories;
      },
    },
    sessions: {
      async save(s: Session) {
        sessions.set(s.id, s);
        return s;
      },
      async get(id: string) {
        return sessions.get(id) ?? null;
      },
      async findActiveByContext() {
        return null;
      },
      async delete() {},
      async list() {
        return [...sessions.values()];
      },
    },
  } as unknown as StorageProvider;
  return { storage, projects, memories, sessions };
}

const validScan: ProjectScan = {
  exists: true,
  name: 'demo',
  rootPath: '/x/demo',
  gitBranch: 'main',
  packageManager: 'pnpm',
  fileTreeSummary: 'src/\npackage.json',
};

const session: Session = {
  id: 'S1',
  actorId: 'A1',
  context: { platform: 'discord', channelId: 'c', userId: 'u' },
  status: SessionStatus.ACTIVE,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastActivityAt: '2026-01-01T00:00:00.000Z',
};

function build(scan: ProjectScan) {
  const { storage, projects, memories, sessions } = fakeStorage();
  const memory = new MemoryManager(storage, {} as VectorProvider);
  const sessionMgr = new SessionManager(storage);
  const workspace = { scan: async () => scan } as unknown as WorkspaceManager;
  return { pm: new ProjectManager(storage, workspace, memory, sessionMgr), projects, memories, sessions };
}

describe('ProjectManager.register (ADR-0018)', () => {
  it('registers a valid local project: persists project + PROJECT memory + binds session', async () => {
    const { pm, projects, memories, sessions } = build(validScan);
    const res = await pm.register('/x/demo', session);

    expect(res.ok).toBe(true);
    expect(res.message).toContain('demo');
    expect(projects).toHaveLength(1);
    const projectMems = memories.filter((m) => m.type === MemoryType.PROJECT);
    expect(projectMems).toHaveLength(1);
    expect(projectMems[0]!.scope.projectId).toBe(projects[0]!.id);
    expect(sessions.get('S1')?.activeProjectId).toBe(projects[0]!.id);
  });

  it('returns a friendly failure for a non-existent path (nothing persisted)', async () => {
    const { pm, projects, memories } = build({ ...validScan, exists: false, rootPath: '/nope' });
    const res = await pm.register('/nope', session);

    expect(res.ok).toBe(false);
    expect(res.message).toContain('찾을 수 없');
    expect(projects).toHaveLength(0);
    expect(memories).toHaveLength(0);
  });

  it('rejects an empty path', async () => {
    const { pm, projects } = build(validScan);
    const res = await pm.register('   ', session);
    expect(res.ok).toBe(false);
    expect(projects).toHaveLength(0);
  });
});
