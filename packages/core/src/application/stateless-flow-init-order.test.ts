import { describe, expect, it } from 'vitest';
import { Capability } from '../domain';
import type { ApprovalRequest, Id, Session, Task } from '../domain';
import { StatelessScopeClarificationFlow } from './stateless-scope-clarification-flow';
import { StatelessApprovalFlow } from './stateless-approval-flow';
import { StatelessApplyPreviewFlow } from './stateless-apply-preview-flow';
import type { ExecutionOutcome, ExecutionRequest } from './execution-orchestrator';
import type { ApplyPreviewAnchor } from './conversation-runtime';

// Sprint 4c-Follow-up-2, Track A / ADR-0062 — storage init-order regression.
// The stateless flows are constructed during the Nest factory, which runs BEFORE `await storage.init()`. The sqlite
// StorageProvider declares `sessions!`/`tasks!`/`approvals!` (definite-assignment; undefined until init()). This
// stub mirrors that ordering so the tests prove: holding the LIVE storage seam (Option 1) resolves the initialized
// repos at call time, whereas the old eager-snapshot wiring froze `undefined` and crashed on `.save()`.
class InitOrderStorage {
  sessions!: { save(session: Session): Promise<Session> };
  tasks!: { get(id: Id): Promise<Task | null>; save(task: Task): Promise<Task> };
  approvals!: { findByExecutionPlan(id: Id): Promise<ApprovalRequest[]> };
  readonly saved = { tasks: [] as Task[], sessions: [] as Session[] };

  async init(): Promise<void> {
    this.sessions = {
      save: async (session) => {
        this.saved.sessions.push(session);
        return session;
      },
    };
    this.tasks = {
      get: async () => null,
      save: async (task) => {
        this.saved.tasks.push(task);
        return task;
      },
    };
    this.approvals = { findByExecutionPlan: async () => [] };
  }
}

const session = {
  id: 's1',
  context: { platform: 'test', channelId: 'c1', userId: 'u1' },
  activeProjectId: 'p1',
  actorId: 'a1',
} as unknown as Session;

const scopePending = { kind: 'code-scope-clarification', summary: 'x', createdAt: 't' } as unknown as Parameters<
  StatelessScopeClarificationFlow['anchor']
>[1];

const applyAnchor = {
  kind: 'code-preview-apply',
  status: 'AWAITING_APPROVAL',
  instruction: 'x',
  projectId: 'p1',
  createdAt: 't',
} as unknown as ApplyPreviewAnchor;

const request = {
  goal: 'g',
  instruction: 'i',
  requiredCapabilities: [Capability.CODE_IMPLEMENTATION],
  requestedBy: 'u1',
} as unknown as ExecutionRequest;
const outcome = { refs: { executionPlanRef: { id: 'plan-1' } } } as unknown as ExecutionOutcome;

describe('stateless flows — storage init-order (Track A / ADR-0062)', () => {
  it('ScopeClarificationFlow built before init persists after init (no undefined .save)', async () => {
    const storage = new InitOrderStorage();
    const flow = new StatelessScopeClarificationFlow(storage); // LIVE seam, constructed BEFORE init
    await storage.init();
    await expect(flow.anchor(session, scopePending)).resolves.toBeUndefined();
    expect(storage.saved.tasks).toHaveLength(1);
    expect(storage.saved.sessions).toHaveLength(1);
  });

  it('ApprovalFlow built before init persists after init', async () => {
    const storage = new InitOrderStorage();
    const flow = new StatelessApprovalFlow(storage);
    await storage.init();
    await expect(flow.anchor(session, request, outcome)).resolves.toBeUndefined();
    expect(storage.saved.tasks).toHaveLength(1);
    expect(storage.saved.sessions).toHaveLength(1);
  });

  it('ApplyPreviewFlow built before init persists after init', async () => {
    const storage = new InitOrderStorage();
    const flow = new StatelessApplyPreviewFlow(storage);
    await storage.init();
    await expect(flow.anchor(session, applyAnchor)).resolves.toBeUndefined();
    expect(storage.saved.tasks).toHaveLength(1);
    expect(storage.saved.sessions).toHaveLength(1);
  });

  it('regression witness: the OLD eager-snapshot wiring freezes undefined and throws on .save()', async () => {
    const storage = new InitOrderStorage();
    // The pre-fix pattern: destructure repo VALUES before init() → captures `undefined`.
    const snapshotFlow = new StatelessScopeClarificationFlow({
      sessions: storage.sessions,
      tasks: storage.tasks,
    });
    await storage.init(); // storage is now populated, but the snapshot already froze undefined
    await expect(flow_anchor(snapshotFlow)).rejects.toThrow(/reading 'save'|undefined/);
  });
});

function flow_anchor(flow: StatelessScopeClarificationFlow): Promise<void> {
  return flow.anchor(session, scopePending);
}
