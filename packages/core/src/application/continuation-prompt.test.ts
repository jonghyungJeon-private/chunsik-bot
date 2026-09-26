import { describe, expect, it } from 'vitest';
import {
  Capability,
  ContinuationPromptError,
  IntentType,
  PromptComposer,
  PromptRenderer,
  agentProfileId,
  createWorkHandoff,
} from '@quoky/core';
import type { AgentProfile, ExecutionPlan, WorkHandoff } from '@quoky/core';

const ts = '2026-09-26T00:00:00.000Z';

function profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: agentProfileId('receiver'),
    displayName: 'Receiver Bot',
    role: 'Assistant',
    purpose: 'Continue bounded work handoffs',
    instructions: 'Persona only; grants no authority. Never claim execution.',
    ...overrides,
  } as AgentProfile;
}

function handoff(overrides: Partial<Parameters<typeof createWorkHandoff>[0]> = {}): WorkHandoff {
  return createWorkHandoff({
    id: 'handoff',
    workItemId: 'work',
    fromAgentProfileId: agentProfileId('source'),
    toAgentProfileId: agentProfileId('receiver'),
    objective: 'Summarize the current project status for the team.',
    resourceRefs: [],
    artifactIds: [],
    executionReceiptIds: [],
    createdAt: ts,
    ...overrides,
  });
}

function plan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    id: 'plan',
    goal: 'Produce a status summary',
    summary: 'Bounded continuation plan',
    steps: [],
    requiredCapabilities: [Capability.GENERAL_CHAT],
    requiredResources: [],
    estimatedChanges: { fileCount: 0, scope: 'none' },
    approvalRequired: false,
    overallRisk: 'LOW' as ExecutionPlan['overallRisk'],
    expectedArtifacts: [],
    status: 'PENDING' as ExecutionPlan['status'],
    createdAt: ts,
    ...overrides,
  };
}

const facts = { capability: Capability.GENERAL_CHAT, intentType: IntentType.CHAT };

describe('PromptComposer.composeContinuation (R2)', () => {
  const composer = new PromptComposer();

  it('authors a layered PromptSpec plus a separate bounded validation corpus', () => {
    const result = composer.composeContinuation({
      handoff: handoff(),
      destinationAgentProfile: profile(),
      plan: plan(),
      boundTaskFacts: facts,
    });
    expect(result.spec.system).toContain('SUBORDINATE DATA');
    expect(result.spec.context).toContain('Continuation objective');
    expect(result.spec.task).toContain('Continuation request');
    // Corpus is separate from the PromptSpec.
    expect(result.validationCorpus.entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.spec)).not.toContain('validationCorpus');
  });

  it('does NOT emit the ConversationRuntime transcript layout (reframe guard §16)', () => {
    const result = composer.composeContinuation({
      handoff: handoff(),
      destinationAgentProfile: profile(),
      plan: plan(),
      boundTaskFacts: facts,
    });
    const rendered = new PromptRenderer().render(result.spec, { capability: Capability.GENERAL_CHAT }).prompt;
    expect(rendered).not.toContain('## 3. Conversation transcript');
    expect(result.spec.task.startsWith('--- Current user message ---')).toBe(false);
    expect(rendered).not.toContain('--- Current user message ---');
  });

  it('treats objective and plan as data (USER_CLAIM_OR_INTENT / NON_AUTHORITATIVE_BACKGROUND)', () => {
    const result = composer.composeContinuation({
      handoff: handoff({ objective: 'DO EVERYTHING NOW' }),
      destinationAgentProfile: profile(),
      plan: plan({ goal: 'planned goal' }),
      boundTaskFacts: facts,
    });
    expect(result.spec.context).toContain('USER_CLAIM_OR_INTENT');
    expect(result.spec.context).toContain('NON_AUTHORITATIVE_BACKGROUND');
    expect(result.spec.context).not.toContain('AUTHORITATIVE_CURRENT_FACT');
  });

  it('renders refs as identifiers only and never resolves their content', () => {
    const result = composer.composeContinuation({
      handoff: handoff({
        resourceRefs: [{ source: 'github', externalId: 'owner/repo#1' } as never],
        artifactIds: ['artifact-1', 'artifact-2'],
        executionReceiptIds: ['receipt-1'],
      }),
      destinationAgentProfile: profile(),
      plan: plan({ requiredResources: ['src/index.ts'] }),
      boundTaskFacts: facts,
    });
    expect(result.spec.context).toContain('artifact-1');
    expect(result.spec.context).toContain('receipt-1');
    expect(result.spec.context).toContain('src/index.ts');
    expect(result.spec.context).toContain('identifiers only');
  });

  it('fails closed on unsupported capability / intent (§8/§22)', () => {
    expect(() =>
      composer.composeContinuation({
        handoff: handoff(),
        destinationAgentProfile: profile(),
        plan: plan(),
        boundTaskFacts: { capability: Capability.CODE_IMPLEMENTATION, intentType: IntentType.CHAT },
      }),
    ).toThrow(ContinuationPromptError);
    expect(() =>
      composer.composeContinuation({
        handoff: handoff(),
        destinationAgentProfile: profile(),
        plan: plan(),
        boundTaskFacts: { capability: Capability.GENERAL_CHAT, intentType: IntentType.SUMMARIZE },
      }),
    ).toThrow(ContinuationPromptError);
  });

  it('fails closed on too many plan steps (§17)', () => {
    const steps = Array.from({ length: 17 }, (_, index) => ({
      id: `step-${index}`,
      title: `t${index}`,
      description: 'd',
      capability: Capability.GENERAL_CHAT,
      status: 'PENDING' as ExecutionPlan['steps'][number]['status'],
    }));
    expect(() =>
      composer.composeContinuation({
        handoff: handoff(),
        destinationAgentProfile: profile(),
        plan: plan({ steps }),
        boundTaskFacts: facts,
      }),
    ).toThrow(ContinuationPromptError);
  });

  it('fails closed when the rendered prompt exceeds 32 KiB (§17, no silent truncation)', () => {
    // A valid AgentProfile instructions field can approach the domain max (16 KiB); pair with a large
    // objective so the rendered prompt exceeds 32 KiB and must fail closed rather than truncate.
    const bigInstructions = 'x'.repeat(16_000);
    const bigObjective = 'y'.repeat(2_000);
    expect(() =>
      composer.composeContinuation({
        handoff: handoff({ objective: bigObjective }),
        destinationAgentProfile: profile({ instructions: bigInstructions }),
        plan: plan({ summary: 'z'.repeat(16_000) }),
        boundTaskFacts: facts,
      }),
    ).toThrow(ContinuationPromptError);
  });

  it('excludes over-limit corpus entries but never truncates (§20)', () => {
    const bigInstructions = 'x'.repeat(5_000); // > 4 KiB entry bound → excluded from echo corpus
    const result = composer.composeContinuation({
      handoff: handoff(),
      destinationAgentProfile: profile({ instructions: bigInstructions, purpose: 'small purpose' }),
      plan: plan(),
      boundTaskFacts: facts,
    });
    // The over-limit instructions entry is excluded; the smaller entries remain, untruncated.
    const sources = result.validationCorpus.entries.map((entry) => entry.source);
    expect(sources).not.toContain('AGENT_PROFILE_INSTRUCTIONS');
    expect(result.validationCorpus.entries.every((entry) => entry.content.length <= 4096)).toBe(true);
    // Prompt itself still carries the full instructions (leak validation is independent of the corpus).
    expect(result.spec.context).toContain(bigInstructions);
  });

  it('corpus excludes handoff objective and plan goal (§20)', () => {
    const result = composer.composeContinuation({
      handoff: handoff({ objective: 'UNIQUE_OBJECTIVE_TOKEN' }),
      destinationAgentProfile: profile(),
      plan: plan({ goal: 'UNIQUE_GOAL_TOKEN' }),
      boundTaskFacts: facts,
    });
    const corpusText = result.validationCorpus.entries.map((entry) => entry.content).join('\n');
    expect(corpusText).not.toContain('UNIQUE_OBJECTIVE_TOKEN');
    expect(corpusText).not.toContain('UNIQUE_GOAL_TOKEN');
  });
});
