import { describe, expect, it } from 'vitest';
import { Capability, IntentType } from '../domain';
import type { Intent } from '../domain';
import { IntentResolver } from './intent-resolver';

const intentOf = (capability: Capability, type: IntentType, summary = 'do the work'): Intent => ({
  type,
  capability,
  confidence: 1,
  requiresWork: true,
  summary,
});

describe('IntentResolver', () => {
  const resolver = new IntentResolver();

  it('maps a code-implementation intent to an ExecutionRequest', () => {
    const req = resolver.resolve(intentOf(Capability.CODE_IMPLEMENTATION, IntentType.IMPLEMENT_CODE, 'add a flag'), {
      requestedBy: 'user',
      projectId: 'proj-1',
    });
    expect(req).not.toBeNull();
    expect(req?.requiredCapabilities).toEqual([Capability.CODE_IMPLEMENTATION]);
    expect(req?.goal).toBe('add a flag');
    expect(req?.instruction).toBe('add a flag');
    expect(req?.requestedBy).toBe('user');
    expect(req?.projectId).toBe('proj-1');
  });

  // Live Code Change Planning (ADR-0035): planningOnly is set ONLY for CODE_IMPLEMENTATION, and
  // ONLY by IntentResolver — never a general-purpose stage-override signal.
  it('marks a code-implementation ExecutionRequest as planningOnly (ADR-0035)', () => {
    const req = resolver.resolve(intentOf(Capability.CODE_IMPLEMENTATION, IntentType.IMPLEMENT_CODE, '이 버그 고쳐줘'), {
      requestedBy: 'user',
    });
    expect(req?.planningOnly).toBe(true);
  });

  it('maps a test-execution intent to an ExecutionRequest (carrying the command)', () => {
    const req = resolver.resolve(intentOf(Capability.TEST_EXECUTION, IntentType.RUN_TESTS), {
      requestedBy: 'user',
      command: { command: 'pnpm', args: ['test'] },
    });
    expect(req?.requiredCapabilities).toEqual([Capability.TEST_EXECUTION]);
    expect(req?.command).toEqual({ command: 'pnpm', args: ['test'] });
  });

  it('does not set planningOnly for a test-execution intent (scoped to CODE_IMPLEMENTATION only, ADR-0035)', () => {
    const req = resolver.resolve(intentOf(Capability.TEST_EXECUTION, IntentType.RUN_TESTS), {
      requestedBy: 'user',
      command: { command: 'pnpm', args: ['test'] },
    });
    expect(req?.planningOnly).toBeUndefined();
  });

  it('returns null for a conversational intent (stays on the chat fast path)', () => {
    expect(resolver.resolve(intentOf(Capability.GENERAL_CHAT, IntentType.CHAT), { requestedBy: 'user' })).toBeNull();
  });

  it('returns null for a project-analysis intent (not an execution)', () => {
    expect(
      resolver.resolve(intentOf(Capability.PROJECT_ANALYSIS, IntentType.PROJECT_ANALYSIS), { requestedBy: 'user' }),
    ).toBeNull();
  });
});
