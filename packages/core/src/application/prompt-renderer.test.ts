import { describe, expect, it } from 'vitest';
import { PromptRenderer } from './prompt-renderer';
import { Capability } from '../domain';
import type { PromptSpec, WorkspaceRef } from '../domain';

const spec: PromptSpec = { system: 'SYS', developer: 'DEV', context: 'CTX', task: 'TASK' };
const renderer = new PromptRenderer();

describe('PromptRenderer (CAP-008, ADR-0029)', () => {
  it('renders a PromptSpec into an AiRequest with the layered prompt text (no PromptSpec leaks)', () => {
    const req = renderer.render(spec, { capability: Capability.CODE_IMPLEMENTATION });
    expect(req.capability).toBe(Capability.CODE_IMPLEMENTATION);
    expect(req.prompt).toContain('SYS');
    expect(req.prompt).toContain('DEV');
    expect(req.prompt).toContain('CTX');
    expect(req.prompt).toContain('TASK');
    // AiRequest carries only a rendered string — never the structured spec.
    expect((req as unknown as { promptSpec?: unknown }).promptSpec).toBeUndefined();
  });

  it('omits the empty Context section', () => {
    const req = renderer.render({ ...spec, context: '' }, { capability: Capability.GENERAL_CHAT });
    expect(req.prompt).not.toContain('# Context');
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
});
