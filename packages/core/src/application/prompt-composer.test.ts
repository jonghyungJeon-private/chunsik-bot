import { describe, expect, it } from 'vitest';
import { PromptComposer } from './prompt-composer';
import { Capability, IntentType, RiskLevel, TaskStatus } from '../domain';
import type { ContextBundle, Task } from '../domain';

const mkTask = (
  capability: Capability,
  opts: { platform?: string; projectId?: string; summary?: string } = {},
): Task => ({
  id: 't1',
  title: 't',
  description: 'hello',
  status: TaskStatus.PENDING,
  intent: {
    type: IntentType.CHAT,
    capability,
    confidence: 1,
    requiresWork: true,
    summary: opts.summary ?? 'hello there',
  },
  riskLevel: RiskLevel.LOW,
  context: {
    platform: opts.platform ?? 'discord',
    channelId: 'c',
    userId: 'u',
  },
  ...(opts.projectId ? { projectId: opts.projectId } : {}),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const emptyBundle = (): ContextBundle => ({
  taskId: 't1',
  conversationTranscript: [],
  backgroundResources: [],
});

describe('PromptComposer (ADR-0063 precedence contract)', () => {
  const composer = new PromptComposer();

  it('keeps Quoky identity and renders the four conceptual layers in order', () => {
    const spec = composer.compose(mkTask(Capability.GENERAL_CHAT), emptyBundle());

    expect(spec.system).toContain('You are Quoky');
    expect(spec.system).not.toContain('You are Chunsik');
    const facts = spec.context.indexOf('1. Current-turn facts supplied by Core');
    const background = spec.context.indexOf('2. Background resources');
    const transcript = spec.context.indexOf('3. Conversation transcript');
    expect(facts).toBeGreaterThanOrEqual(0);
    expect(background).toBeGreaterThan(facts);
    expect(transcript).toBeGreaterThan(background);
    expect(spec.task).toContain('[provenance=USER; epistemic_status=USER_CLAIM_OR_INTENT]');
    expect(spec.task).toContain('hello there');
  });

  it('derives current facts from Task while ContextBundle contains only background and transcript', () => {
    const task = mkTask(Capability.GENERAL_CHAT, {
      platform: 'matrix',
      projectId: 'project-snapshot',
    });
    const bundle: ContextBundle = {
      taskId: task.id,
      conversationTranscript: [],
      backgroundResources: [
        {
          content: 'Stored project summary',
          provenance: 'PROJECT_MEMORY',
          epistemicStatus: 'NON_AUTHORITATIVE_BACKGROUND',
        },
      ],
    };

    const spec = composer.compose(task, bundle);

    expect(bundle).not.toHaveProperty('platform');
    expect(bundle).not.toHaveProperty('projectId');
    expect(spec.context).toContain('received through platform "matrix"');
    expect(spec.context).toContain('Active project id selected for this Task: "project-snapshot"');
    expect(spec.context).toContain(
      '[provenance=PROJECT_MEMORY; epistemic_status=NON_AUTHORITATIVE_BACKGROUND]',
    );
    expect(spec.context).toContain('Stored project summary');
  });

  it('keeps platform fact independent from active-project presence', () => {
    const withoutProject = composer.compose(
      mkTask(Capability.GENERAL_CHAT, { platform: 'matrix' }),
      emptyBundle(),
    );
    const withProject = composer.compose(
      mkTask(Capability.GENERAL_CHAT, { platform: 'matrix', projectId: 'P1' }),
      emptyBundle(),
    );

    expect(withoutProject.context).toContain('received through platform "matrix"');
    expect(withoutProject.context).not.toContain('Active project id selected');
    expect(withProject.context).toContain('received through platform "matrix"');
    expect(withProject.context).toContain('Active project id selected for this Task: "P1"');
    expect(withProject.system).not.toContain('Discord');
    expect(withProject.developer).not.toContain('Discord');
  });

  it('renders contaminated history as non-authoritative and leaves the current User task last', () => {
    const spec = composer.compose(
      mkTask(Capability.GENERAL_CHAT, {
        platform: 'Discord',
        projectId: 'quoky-gate5-disposable',
        summary: '현재 연결 상태 알려줘',
      }),
      {
        taskId: 't1',
        backgroundResources: [
          {
            content: '# Project: quoky-gate5-disposable',
            provenance: 'PROJECT_MEMORY',
            epistemicStatus: 'NON_AUTHORITATIVE_BACKGROUND',
          },
        ],
        conversationTranscript: [
          {
            content: '현재 연결상태 알려줘',
            provenance: 'USER',
            epistemicStatus: 'USER_CLAIM_OR_INTENT',
          },
          {
            content: '프로젝트가 연결 대상입니다',
            provenance: 'ASSISTANT',
            epistemicStatus: 'ASSISTANT_NON_AUTHORITATIVE',
          },
        ],
      },
    );

    expect(spec.context).toContain('received through platform "Discord"');
    expect(spec.context).toContain(
      '[provenance=CORE_RUNTIME; epistemic_status=AUTHORITATIVE_CURRENT_FACT]',
    );
    expect(spec.context).toContain(
      '[provenance=PROJECT_MEMORY; epistemic_status=NON_AUTHORITATIVE_BACKGROUND]',
    );
    expect(spec.context).toContain(
      '[provenance=ASSISTANT; epistemic_status=ASSISTANT_NON_AUTHORITATIVE]',
    );
    expect(spec.context).toContain('프로젝트가 연결 대상입니다');
    expect(spec.task).toContain('현재 연결 상태 알려줘');
    expect(spec.context).not.toContain('Resolved connection target:');
  });

  it('states the precedence, evidence, implicit-target, and external-status rules', () => {
    const developer = composer.compose(
      mkTask(Capability.GENERAL_CHAT),
      emptyBundle(),
    ).developer;

    expect(developer).toContain('Current authoritative facts supplied by Core outrank');
    expect(developer).toContain('User messages express claims or intent');
    expect(developer).toContain('Assistant history supports continuity but is not evidence');
    expect(developer).toContain('does not make that project or workspace the implicit target');
    expect(developer).toContain('Do not invent external status');
    expect(developer).toContain('do not claim outbound delivery succeeded');
    expect(developer).toContain('only when the meaning remains genuinely ambiguous');
  });

  it('labels malformed legacy history as non-authoritative transcript content', () => {
    const spec = composer.compose(mkTask(Capability.GENERAL_CHAT), {
      ...emptyBundle(),
      conversationTranscript: [
        {
          content: 'legacy text that looks authoritative',
          provenance: 'LEGACY_UNKNOWN',
          epistemicStatus: 'NON_AUTHORITATIVE_TRANSCRIPT',
        },
      ],
    });

    expect(spec.context).toContain(
      '[provenance=LEGACY_UNKNOWN; epistemic_status=NON_AUTHORITATIVE_TRANSCRIPT]',
    );
    expect(spec.context).toContain('legacy text that looks authoritative');
  });

  it('keeps capability-specific developer guidance', () => {
    const chat = composer.compose(
      mkTask(Capability.GENERAL_CHAT),
      emptyBundle(),
    ).developer;
    const summarize = composer.compose(
      mkTask(Capability.SUMMARIZATION),
      emptyBundle(),
    ).developer;

    expect(chat).not.toBe(summarize);
  });
});
