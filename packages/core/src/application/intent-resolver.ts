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
  resolve(intent: Intent, context: IntentResolutionContext): ExecutionRequest | null {
    if (!EXECUTION_CAPABILITIES.has(intent.capability)) return null;
    return {
      goal: intent.summary,
      instruction: intent.summary,
      requiredCapabilities: [intent.capability],
      requestedBy: context.requestedBy,
      ...(context.projectId ? { projectId: context.projectId } : {}),
      ...(context.workspaceRef ? { workspaceRef: context.workspaceRef } : {}),
      ...(context.targetFiles ? { targetFiles: context.targetFiles } : {}),
      ...(context.command ? { command: context.command } : {}),
    };
  }
}
