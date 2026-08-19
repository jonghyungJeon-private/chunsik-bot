import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PromptComposer } from './prompt-composer';
import { PromptRenderer } from './prompt-renderer';
import { Capability, IntentType, RiskLevel, TaskStatus } from '../domain';
import type { ContextBundle, PromptSpec, Task, WorkspaceRef } from '../domain';

const spec: PromptSpec = { system: 'SYS', developer: 'DEV', context: 'CTX', task: 'TASK' };
const renderer = new PromptRenderer();

const bodyBetween = (value: string, startMarker: string, endMarker: string): string => {
  const start = value.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing start marker: ${startMarker}`);
  const bodyStart = start + startMarker.length;
  const end = value.indexOf(endMarker, bodyStart);
  if (end < 0) throw new Error(`Missing end marker: ${endMarker}`);
  return value.slice(bodyStart, end);
};

const countOccurrences = (value: string, needle: string): number => {
  let count = 0;
  let offset = 0;
  while (offset < value.length) {
    const index = value.indexOf(needle, offset);
    if (index < 0) break;
    count++;
    offset = index + needle.length;
  }
  return count;
};

describe('PromptRenderer (CAP-008, ADR-0029)', () => {
  it('renders a PromptSpec into an AiRequest with the layered prompt text (no PromptSpec leaks)', () => {
    const req = renderer.render(spec, { capability: Capability.CODE_IMPLEMENTATION });
    expect(req.capability).toBe(Capability.CODE_IMPLEMENTATION);
    expect({
      systemPresent: req.prompt.includes('SYS'),
      developerPresent: req.prompt.includes('DEV'),
      contextPresent: req.prompt.includes('CTX'),
      taskPresent: req.prompt.includes('TASK'),
    }).toEqual({
      systemPresent: true,
      developerPresent: true,
      contextPresent: true,
      taskPresent: true,
    });
    // AiRequest carries only a rendered string — never the structured spec.
    expect((req as unknown as { promptSpec?: unknown }).promptSpec).toBeUndefined();
  });

  it('omits the empty Context section', () => {
    const req = renderer.render({ ...spec, context: '' }, { capability: Capability.GENERAL_CHAT });
    expect(req.prompt.includes('# Context')).toBe(false);
  });

  it('carries workspace / contextFiles / timeout when supplied', () => {
    const workspace: WorkspaceRef = { id: 'w1', rootPath: '/tmp/ws', kind: 'local-clone' };
    const req = renderer.render(spec, {
      capability: Capability.CODE_IMPLEMENTATION,
      workspace,
      contextFiles: [{ path: 'a.ts', content: 'x' }],
      timeoutMs: 5000,
    });
    expect(req.workspace?.id).toBe('w1');
    expect(req.contextFiles?.[0]?.path).toBe('a.ts');
    expect(req.timeoutMs).toBe(5000);
  });

  it('keeps the GENERAL_CHAT decision-boundary order and deterministic prompt hash', () => {
    const task: Task = {
      id: 'task-deterministic',
      title: 'Synthetic status request',
      description: 'What is the current status?',
      status: TaskStatus.PENDING,
      intent: {
        type: IntentType.CHAT,
        capability: Capability.GENERAL_CHAT,
        confidence: 1,
        requiresWork: true,
        summary: 'What is the current status?',
      },
      riskLevel: RiskLevel.LOW,
      context: {
        platform: 'synthetic-platform',
        channelId: 'channel-1',
        userId: 'user-1',
      },
      projectId: 'project-synthetic',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const context: ContextBundle = {
      taskId: task.id,
      backgroundResources: [
        {
          content: '# Project: project-synthetic',
          provenance: 'PROJECT_MEMORY',
          epistemicStatus: 'NON_AUTHORITATIVE_BACKGROUND',
        },
      ],
      conversationTranscript: [
        {
          content: 'The project is the current external target.',
          provenance: 'ASSISTANT',
          epistemicStatus: 'ASSISTANT_NON_AUTHORITATIVE',
        },
      ],
    };
    const composer = new PromptComposer();
    const first = renderer.render(composer.compose(task, context), {
      capability: Capability.GENERAL_CHAT,
    });
    const second = renderer.render(composer.compose(task, context), {
      capability: Capability.GENERAL_CHAT,
    });

    const system = first.prompt.indexOf('# System');
    const developer = first.prompt.indexOf('# Developer');
    const promptContext = first.prompt.indexOf('# Context');
    const primaryFacts = first.prompt.indexOf(
      '## 1. Current-turn facts supplied by Core',
    );
    const background = first.prompt.indexOf('## 2. Background resources');
    const transcript = first.prompt.indexOf(
      '## 3. Conversation transcript (continuity allowed; not authoritative external-state evidence)',
    );
    const authorityBoundary = first.prompt.indexOf(
      '## 4. Current-turn authority decision boundary',
    );
    const taskSection = first.prompt.indexOf('# Task');

    expect(system).toBe(0);
    expect(developer).toBeGreaterThan(system);
    expect(promptContext).toBeGreaterThan(developer);
    expect(primaryFacts).toBeGreaterThan(promptContext);
    expect(background).toBeGreaterThan(primaryFacts);
    expect(transcript).toBeGreaterThan(background);
    expect(authorityBoundary).toBeGreaterThan(transcript);
    expect(taskSection).toBeGreaterThan(authorityBoundary);
    const expectedTask =
      '# Task\n' +
      '--- Current user message ---\n' +
      JSON.stringify({
        provenance: 'USER',
        epistemicStatus: 'USER_CLAIM_OR_INTENT',
        content: task.description,
      });
    expect(first.prompt.slice(taskSection) === expectedTask).toBe(true);
    expect(countOccurrences(first.prompt, task.description)).toBe(1);

    const primaryFactBody = bodyBetween(
      first.prompt,
      '## 1. Current-turn facts supplied by Core\n',
      '\n\n## 2. Background resources',
    );
    const repeatedFactBody = bodyBetween(
      first.prompt,
      '### Authoritative current facts\n',
      '\n### Mandatory inference constraints',
    );
    const authorityRuleBody = bodyBetween(
      first.prompt,
      '### Mandatory inference constraints\n',
      '\n\n# Task',
    );
    const developerBody = bodyBetween(
      first.prompt,
      '# Developer\n',
      '\n\n# Context',
    );
    const hash = (value: string): string =>
      createHash('sha256').update(value).digest('hex');
    expect(hash(repeatedFactBody)).toBe(hash(primaryFactBody));
    expect(developerBody.endsWith(authorityRuleBody)).toBe(true);

    expect(hash(second.prompt)).toBe(hash(first.prompt));
    expect(second.prompt.length).toBe(first.prompt.length);
    expect((first as unknown as { promptSpec?: unknown }).promptSpec).toBeUndefined();
  });

  it('keeps a previous user turn role-attributed in the final GENERAL_CHAT prompt string', () => {
    const task: Task = {
      id: 'task-recall-boundary',
      title: 'Recall the previous turn',
      description: '내가 방금 뭐라고 했어?',
      status: TaskStatus.PENDING,
      intent: {
        type: IntentType.CHAT,
        capability: Capability.GENERAL_CHAT,
        confidence: 1,
        requiresWork: true,
        summary: '내가 방금 뭐라고 했어?',
      },
      riskLevel: RiskLevel.LOW,
      context: { platform: 'test', channelId: 'channel-1', userId: 'user-1' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const request = renderer.render(
      new PromptComposer().compose(task, {
        taskId: task.id,
        backgroundResources: [],
        conversationTranscript: [
          {
            turnNumber: 1,
            role: 'user',
            content: '안녕?',
            provenance: 'USER',
            epistemicStatus: 'USER_CLAIM_OR_INTENT',
          },
          {
            turnNumber: 1,
            role: 'assistant',
            content: '안녕하세요!',
            provenance: 'ASSISTANT',
            epistemicStatus: 'ASSISTANT_NON_AUTHORITATIVE',
          },
        ],
      }),
      { capability: Capability.GENERAL_CHAT },
    );

    expect(request.prompt).toContain(
      `[Turn 1] User: ${JSON.stringify({
        provenance: 'USER',
        epistemicStatus: 'USER_CLAIM_OR_INTENT',
        content: '안녕?',
      })}`,
    );
    expect(request.prompt.indexOf('[Turn 1] User:')).toBeLessThan(
      request.prompt.indexOf('--- Current user message ---'),
    );
  });
});
