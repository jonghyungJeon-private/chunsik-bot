import { Capability } from '../domain';
import type { Id, Intent, WorkspaceRef } from '../domain';
import type { ExecutionRequest } from './execution-orchestrator';

/**
 * Capabilities that mean "this intent is an execution" (it should enter the
 * Execution Orchestrator chain). Everything else is conversational/analysis and
 * stays on the existing `ChunsikCore` fast path.
 */
const EXECUTION_CAPABILITIES: ReadonlySet<Capability> = new Set([
  Capability.CODE_IMPLEMENTATION,
  Capability.TEST_EXECUTION,
]);

/** Caller-supplied context the resolver folds into the ExecutionRequest. */
export interface IntentResolutionContext {
  requestedBy: string;
  projectId?: Id;
  workspaceRef?: WorkspaceRef;
  targetFiles?: string[];
  /** Subset of `targetFiles` that came from the explicit new-file flow (F3-A). Passed straight through
   *  to `ExecutionRequest.newFileTargets` — the resolver neither classifies nor derives it. */
  newFileTargets?: string[];
  command?: { command: string; args: string[] };
}

/**
 * Intent Resolver (Sprint 2j, ADR-0031) — the bridge between the conversation layer
 * and the execution layer. It maps a **classified** `Intent` (from `IntentClassifier`)
 * into an `ExecutionRequest` for the Execution Orchestrator, or returns `null` when the
 * intent is not an execution (plain chat / analysis — handled elsewhere).
 *
 * It deliberately does NOT classify (that is `IntentClassifier`'s job) and does NOT plan
 * (that is the Planning capability's job). Keeping it a distinct Application service keeps
 * classification and execution-mapping responsibilities unmixed (CA Round-2).
 */
export class IntentResolver {
  /** Whether this intent should enter the Execution Orchestrator chain (vs. chat/analysis). */
  isExecution(intent: Intent): boolean {
    return EXECUTION_CAPABILITIES.has(intent.capability);
  }

  resolve(intent: Intent, context: IntentResolutionContext): ExecutionRequest | null {
    if (!EXECUTION_CAPABILITIES.has(intent.capability)) return null;
    // The command is DERIVED, never taken from user text: a TEST_EXECUTION intent maps its
    // classifier `raw.kind` to exactly one of two allow-listed commands (ADR-0033). Other execution
    // capabilities may carry a caller-supplied command via context.
    const command =
      intent.capability === Capability.TEST_EXECUTION ? testCommandFor(intent) : context.command;
    return {
      goal: intent.summary,
      instruction: intent.summary,
      requiredCapabilities: [intent.capability],
      requestedBy: context.requestedBy,
      ...(context.projectId ? { projectId: context.projectId } : {}),
      ...(context.workspaceRef ? { workspaceRef: context.workspaceRef } : {}),
      ...(context.targetFiles ? { targetFiles: context.targetFiles } : {}),
      ...(context.newFileTargets ? { newFileTargets: context.newFileTargets } : {}),
      ...(command ? { command } : {}),
      // ADR-0035: planningOnly is set ONLY here, ONLY for CODE_IMPLEMENTATION — the first live
      // code-change product slice stops at Planning + Approval; no AI generation/patch/write yet.
      ...(intent.capability === Capability.CODE_IMPLEMENTATION ? { planningOnly: true } : {}),
    };
  }
}

/** Fixed, allow-listed command for a TEST_EXECUTION intent — never a user-supplied string. */
function testCommandFor(intent: Intent): { command: string; args: string[] } {
  return intent.raw?.kind === 'typecheck'
    ? { command: 'pnpm', args: ['typecheck'] }
    : { command: 'pnpm', args: ['test'] };
}
