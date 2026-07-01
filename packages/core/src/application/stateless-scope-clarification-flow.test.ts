import { describe, expect, it } from 'vitest';
import { Capability, IntentType, RiskLevel, SessionStatus, TaskStatus } from '../domain';
import type { ConversationContext, Session, Task } from '../domain';
import { StatelessScopeClarificationFlow } from './stateless-scope-clarification-flow';
import type { PendingScopeClarification } from './conversation-runtime';

const TS = '2026-07-01T00:00:00.000Z';
const CTX: ConversationContext = { platform: 'test', channelId: 'c1', userId: 'u1' };

const sessionOf = (o: Partial<Session> = {}): Session => ({
  id: 'sess-1',
  actorId: 'actor-1',
  context: CTX,
  status: SessionStatus.ACTIVE,
  activeProjectId: 'proj-1',
  createdAt: TS,
  lastActivityAt: TS,
  ...o,
});

const pendingOf = (o: Partial<PendingScopeClarification> = {}): PendingScopeClarification => ({
  kind: 'code-scope-clarification',
  summary: '이 버그 고쳐줘',
  rawKind: 'fix',
  projectId: 'proj-1',
  createdAt: TS,
  ...o,
});

/** An unrelated Task that already carries a planId — the shape an approval anchor always has. */
const approvalAnchorTaskOf = (o: Partial<Task> = {}): Task => ({
  id: 'task-approval',
  title: 't',
  description: 'd',
  status: TaskStatus.WAITING_APPROVAL,
  intent: {
    type: IntentType.IMPLEMENT_CODE,
    capability: Capability.CODE_IMPLEMENTATION,
    confidence: 1,
    requiresWork: true,
    summary: 's',
  },
  riskLevel: RiskLevel.HIGH,
  context: CTX,
  planId: 'plan-1',
  createdAt: TS,
  updatedAt: TS,
  ...o,
});

/** In-memory fake store — a stand-in for `StorageProvider.sessions`/`tasks`. */
function makeStore() {
  const sessions = new Map<string, Session>();
  const tasks = new Map<string, Task>();
  const store = {
    sessions: {
      async save(s: Session) {
        sessions.set(s.id, s);
        return s;
      },
    },
    tasks: {
      async get(id: string) {
        return tasks.get(id) ?? null;
      },
      async save(t: Task) {
        tasks.set(t.id, t);
        return t;
      },
    },
  };
  return { store, sessions, tasks };
}

describe('StatelessScopeClarificationFlow (Sprint 2p, ADR-0037)', () => {
  it('anchor creates a Task with no planId, never advanced past PENDING', async () => {
    const { store, tasks } = makeStore();
    const flow = new StatelessScopeClarificationFlow(store);
    await flow.anchor(sessionOf(), pendingOf());
    const [task] = [...tasks.values()];
    expect(task!.planId).toBeUndefined();
    expect(task!.status).toBe(TaskStatus.PENDING);
  });

  it('anchor stores the discriminator kind = code-scope-clarification', async () => {
    const { store, tasks } = makeStore();
    const flow = new StatelessScopeClarificationFlow(store);
    await flow.anchor(sessionOf(), pendingOf());
    const [task] = [...tasks.values()];
    const anchor = task!.metadata!.conversationScopeClarificationAnchor as PendingScopeClarification;
    expect(anchor.kind).toBe('code-scope-clarification');
  });

  it('anchor stores the original summary', async () => {
    const { store, tasks } = makeStore();
    const flow = new StatelessScopeClarificationFlow(store);
    await flow.anchor(sessionOf(), pendingOf({ summary: '이 버그 고쳐줘' }));
    const [task] = [...tasks.values()];
    expect(task!.description).toBe('이 버그 고쳐줘');
    expect(task!.intent.summary).toBe('이 버그 고쳐줘');
  });

  it('anchor stores rawKind in a field distinct from the discriminator kind', async () => {
    const { store, tasks } = makeStore();
    const flow = new StatelessScopeClarificationFlow(store);
    await flow.anchor(sessionOf(), pendingOf({ rawKind: 'refactor' }));
    const [task] = [...tasks.values()];
    const anchor = task!.metadata!.conversationScopeClarificationAnchor as PendingScopeClarification;
    expect(anchor.kind).toBe('code-scope-clarification');
    expect(anchor.rawKind).toBe('refactor');
  });

  it('anchor sets session.activeTaskId to the anchor Task', async () => {
    const { store, sessions, tasks } = makeStore();
    const flow = new StatelessScopeClarificationFlow(store);
    await flow.anchor(sessionOf(), pendingOf());
    const [task] = [...tasks.values()];
    expect(sessions.get('sess-1')?.activeTaskId).toBe(task!.id);
  });

  it('findPending returns the anchor for a plan-less Task carrying a valid discriminator', async () => {
    const { store, sessions } = makeStore();
    const flow = new StatelessScopeClarificationFlow(store);
    await flow.anchor(sessionOf(), pendingOf());
    const anchored = sessions.get('sess-1')!;
    expect(await flow.findPending(anchored)).toEqual(pendingOf());
  });

  it('findPending returns null when activeTaskId is absent', async () => {
    const { store } = makeStore();
    const flow = new StatelessScopeClarificationFlow(store);
    expect(await flow.findPending(sessionOf({ activeTaskId: undefined }))).toBeNull();
  });

  it('findPending returns null when the pointed-at Task has a planId (approval anchor, not ours)', async () => {
    const { store, tasks } = makeStore();
    const flow = new StatelessScopeClarificationFlow(store);
    tasks.set('task-approval', approvalAnchorTaskOf());
    const found = await flow.findPending(sessionOf({ activeTaskId: 'task-approval' }));
    expect(found).toBeNull();
  });

  it('findPending returns null when the metadata discriminator is missing or has a different value', async () => {
    const { store, tasks } = makeStore();
    const flow = new StatelessScopeClarificationFlow(store);
    tasks.set('task-unrelated', {
      id: 'task-unrelated',
      title: 't',
      description: 'd',
      status: TaskStatus.PENDING,
      intent: {
        type: IntentType.CHAT,
        capability: Capability.GENERAL_CHAT,
        confidence: 1,
        requiresWork: true,
        summary: 's',
      },
      riskLevel: RiskLevel.LOW,
      context: CTX,
      createdAt: TS,
      updatedAt: TS,
      metadata: { someOtherThing: { kind: 'not-ours' } },
    });
    const found = await flow.findPending(sessionOf({ activeTaskId: 'task-unrelated' }));
    expect(found).toBeNull();
  });

  it('a projectId mismatch clears the anchor (since it is genuinely ours) and returns null', async () => {
    const { store, sessions } = makeStore();
    const flow = new StatelessScopeClarificationFlow(store);
    await flow.anchor(sessionOf(), pendingOf({ projectId: 'proj-1' }));
    const anchored = sessions.get('sess-1')!;
    const found = await flow.findPending({ ...anchored, activeProjectId: 'proj-2' });
    expect(found).toBeNull();
    expect(sessions.get('sess-1')?.activeTaskId).toBeUndefined(); // safely cleared
  });

  it('clear does not clear an approval anchor (Task with planId at the pointer)', async () => {
    const { store, tasks, sessions } = makeStore();
    const flow = new StatelessScopeClarificationFlow(store);
    tasks.set('task-approval', approvalAnchorTaskOf());
    const session = sessionOf({ activeTaskId: 'task-approval' });
    sessions.set('sess-1', session);
    await flow.clear(session);
    expect(sessions.get('sess-1')?.activeTaskId).toBe('task-approval'); // untouched
  });

  it('clear resets activeTaskId for a genuine scope anchor', async () => {
    const { store, sessions } = makeStore();
    const flow = new StatelessScopeClarificationFlow(store);
    await flow.anchor(sessionOf(), pendingOf());
    const anchored = sessions.get('sess-1')!;
    await flow.clear(anchored);
    expect(sessions.get('sess-1')?.activeTaskId).toBeUndefined();
  });
});
