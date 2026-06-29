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

describe('PromptComposer', () => {
  const pc = new PromptComposer();

  it('produces a layered spec; context empty when no recent messages', () => {
    const spec = pc.compose(mkTask(Capability.GENERAL_CHAT), bundle([]));
    expect(spec.system).toContain('Chunsik');
    expect(spec.developer.toLowerCase()).toContain('conversational');
    expect(spec.context).toBe('');
    expect(spec.task).toBe('hello there');
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
