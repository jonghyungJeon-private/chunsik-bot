import { describe, expect, it } from 'vitest';
import { PromptComposer } from './prompt-composer';
import { Capability, IntentType, RiskLevel, TaskStatus } from '../domain';
import type { ContextBundle, Task } from '../domain';

const mkTask = (capability: Capability): Task => ({
  id: 't1',
  title: 't',
  description: 'hello',
  status: TaskStatus.PENDING,
  intent: { type: IntentType.CHAT, capability, confidence: 1, requiresWork: true, summary: 'hello there' },
  riskLevel: RiskLevel.LOW,
  context: { platform: 'discord', channelId: 'c', userId: 'u' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const bundle = (recent: string[]): ContextBundle => ({
  taskId: 't1',
  summary: 'hello there',
  recentMessages: recent,
});

const withSummary = (summary: string, projectSummary?: string): ContextBundle => ({
  taskId: 't1',
  summary,
  recentMessages: [],
  ...(projectSummary ? { projectSummary } : {}),
});

describe('PromptComposer', () => {
  const pc = new PromptComposer();

  it('produces a layered spec; context empty when no recent messages', () => {
    const spec = pc.compose(mkTask(Capability.GENERAL_CHAT), bundle([]));
    expect(spec.system).toContain('Chunsik');
    expect(spec.developer.toLowerCase()).toContain('conversational');
    expect(spec.context).toContain('Current conversation platform: discord');
    expect(spec.task).toBe('hello there');
  });

  it('prioritizes an explicit connection target, then the current platform, over project background', () => {
    const spec = pc.compose(mkTask(Capability.GENERAL_CHAT), {
      ...bundle([]),
      projectSummary: 'quoky-gate5-disposable',
    });

    expect(spec.developer).toContain('explicit user-named target');
    expect(spec.developer).toContain('If no target is named');
    expect(spec.developer).toContain('current conversation platform');
    expect(spec.developer).toContain('background context, not as the connection target');
    expect(spec.context).toContain('Current conversation platform: discord');
    expect(spec.context).toContain('Active project (background context):');
    expect(spec.context).toContain('quoky-gate5-disposable');
  });

  it('resolves an ambiguous connection-status question to the current platform, not the active project', () => {
    const spec = pc.compose(
      mkTask(Capability.GENERAL_CHAT),
      withSummary('현재 연결상태 알려줘', 'quoky-gate5-disposable'),
    );

    expect(spec.context).toContain('Resolved connection target: current conversation platform (discord)');
    expect(spec.context).toContain('Active project (background context):');
    expect(spec.context).not.toContain('Resolved connection target: explicit project target');
  });

  it('resolves an ambiguous equivalent generically for a non-Discord platform', () => {
    const task = mkTask(Capability.GENERAL_CHAT);
    const spec = pc.compose(
      { ...task, context: { ...task.context, platform: 'matrix' } },
      withSummary('지금 연결됐어?'),
    );

    expect(spec.context).toContain('Resolved connection target: current conversation platform (matrix)');
  });

  it.each([
    ['현재 연결된 프로젝트 알려줘', 'explicit project target'],
    ['워크스페이스 연결 상태 알려줘', 'explicit workspace target'],
    ['GitHub 연결 상태 알려줘', 'explicit GitHub target'],
    ['현재 연결된 저장소 알려줘', 'explicit repository target'],
  ])('preserves the explicit target in %s', (summary, target) => {
    const spec = pc.compose(mkTask(Capability.GENERAL_CHAT), withSummary(summary));

    expect(spec.context).toContain(`Resolved connection target: ${target}`);
    expect(spec.context).not.toContain('Resolved connection target: current conversation platform');
  });

  it('does not add a resolved target hint to unrelated chat', () => {
    const spec = pc.compose(mkTask(Capability.GENERAL_CHAT), withSummary('오늘 날씨 어때?'));

    expect(spec.context).not.toContain('Resolved connection target:');
  });

  it('does not instruct the model to claim outbound delivery before it occurs', () => {
    const developer = pc.compose(mkTask(Capability.GENERAL_CHAT), bundle([])).developer;

    expect(developer).toContain('message was received');
    expect(developer).toContain('response is being processed');
    expect(developer).toContain('do not claim outbound delivery succeeded');
  });

  it('represents non-Discord platforms generically without changing the priority rule', () => {
    const task = mkTask(Capability.GENERAL_CHAT);
    const spec = pc.compose(
      { ...task, context: { ...task.context, platform: 'matrix' } },
      bundle([]),
    );

    expect(spec.context).toContain('Current conversation platform: matrix');
    expect(spec.developer).toContain('current conversation platform');
    expect(spec.system).not.toContain('Discord');
    expect(spec.developer).not.toContain('Discord');
  });

  it('renders recent conversation into the context layer', () => {
    const spec = pc.compose(mkTask(Capability.GENERAL_CHAT), bundle(['earlier-a', 'earlier-b']));
    expect(spec.context).toContain('earlier-a');
    expect(spec.context).toContain('earlier-b');
  });

  it('varies the developer layer by capability', () => {
    const chat = pc.compose(mkTask(Capability.GENERAL_CHAT), bundle([])).developer;
    const summarize = pc.compose(mkTask(Capability.SUMMARIZATION), bundle([])).developer;
    expect(chat).not.toBe(summarize);
  });
});
