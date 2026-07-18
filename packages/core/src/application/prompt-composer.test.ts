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
    expect(spec.system).toContain('You are Quoky');
    expect(spec.system).not.toContain('You are Chunsik');
    expect(spec.developer.toLowerCase()).toContain('conversational');
    expect(spec.context).toContain('Current conversation platform: discord');
    expect(spec.task).toBe('hello there');
  });

  it('provides the current platform while keeping the active project as background context', () => {
    const spec = pc.compose(mkTask(Capability.GENERAL_CHAT), {
      ...bundle([]),
      projectSummary: 'quoky-gate5-disposable',
    });

    expect(spec.developer).toContain("Interpret the user's intent naturally");
    expect(spec.developer).toContain('current conversation platform');
    expect(spec.developer).toContain('background context');
    expect(spec.developer).toContain('Do not assume the active project or workspace is the subject');
    expect(spec.context).toContain('Current conversation platform: discord');
    expect(spec.context).toContain('Active project (background context):');
    expect(spec.context).toContain('quoky-gate5-disposable');
  });

  it('does not turn user language into a resolved target hint', () => {
    const spec = pc.compose(
      mkTask(Capability.GENERAL_CHAT),
      withSummary('현재 연결상태 알려줘', 'quoky-gate5-disposable'),
    );

    expect(spec.context).toContain('Current conversation platform: discord');
    expect(spec.context).toContain('Active project (background context):');
    expect(spec.context).not.toContain('Resolved connection target:');
  });

  it('represents a non-Discord conversation platform generically', () => {
    const task = mkTask(Capability.GENERAL_CHAT);
    const spec = pc.compose(
      { ...task, context: { ...task.context, platform: 'matrix' } },
      withSummary('지금 연결됐어?'),
    );

    expect(spec.context).toContain('Current conversation platform: matrix');
    expect(spec.context).not.toContain('Resolved connection target:');
  });

  it('guides the assistant to interpret context naturally and clarify only when needed', () => {
    const developer = pc.compose(mkTask(Capability.GENERAL_CHAT), bundle([])).developer;

    expect(developer).toContain("Interpret the user's intent naturally");
    expect(developer).toContain('recent conversation');
    expect(developer).toContain('Resolve ambiguity using the most natural meaning');
    expect(developer).toContain('Ask a brief clarifying question only when');
    expect(developer).toContain('Do not invent system state that Core has not provided');
  });

  it('does not instruct the model to claim outbound delivery before it occurs', () => {
    const developer = pc.compose(mkTask(Capability.GENERAL_CHAT), bundle([])).developer;

    expect(developer).toContain('message was received');
    expect(developer).toContain('response is being processed');
    expect(developer).toContain('do not claim outbound delivery succeeded');
  });

  it('keeps provider-neutral guidance for a non-Discord platform', () => {
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
