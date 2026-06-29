import { newId } from '../util/id';
import { now } from '../util/clock';
import { ArtifactKind, Capability, ExecutionStatus, RiskLevel } from '../domain';
import type {
  EstimatedChanges,
  ExecutionPlan,
  ExecutionStep,
  PlanningRequest,
} from '../domain';
import type { ExecutionPlanner } from '../ports';
import type { RiskPolicy } from './risk-policy';

/** Map a coarse blast-radius bucket from the number of affected resources. */
function scopeFor(fileCount: number): EstimatedChanges['scope'] {
  if (fileCount === 0) return 'none';
  if (fileCount <= 5) return 'local';
  return 'broad';
}

/** Deterministically map required capabilities to their expected artifact kinds. */
function expectedArtifactsFor(capabilities: Capability[]): ArtifactKind[] {
  const out = new Set<ArtifactKind>();
  for (const c of capabilities) {
    switch (c) {
      case Capability.CODE_IMPLEMENTATION:
        out.add(ArtifactKind.CODE_DIFF);
        out.add(ArtifactKind.PATCH);
        break;
      case Capability.TEST_EXECUTION:
        out.add(ArtifactKind.TEST_LOG);
        break;
      case Capability.DOCUMENT_ANALYSIS:
        out.add(ArtifactKind.DOCUMENT_SUMMARY);
        break;
      default:
        out.add(ArtifactKind.MARKDOWN_REPORT);
    }
  }
  return [...out];
}

/**
 * The v2 planning strategy (CAP-003, ADR-0024): pure, **deterministic** assembly
 * of an `ExecutionPlan` from a `PlanningRequest`. No AI, no I/O — it only reads
 * the request and consults the deterministic `RiskPolicy`. Same input → same plan
 * (modulo the injected id/timestamp). AIPlanner/HybridPlanner are future strategies
 * behind the same `ExecutionPlanner` port.
 */
export class DeterministicPlanner implements ExecutionPlanner {
  readonly kind = 'deterministic';

  constructor(private readonly risk: RiskPolicy) {}

  async plan(request: PlanningRequest): Promise<ExecutionPlan> {
    const requiredCapabilities = request.requiredCapabilities ?? [];
    const requiredResources = request.requiredResources ?? [];

    const overallRisk = requiredCapabilities.length
      ? this.risk.max(...requiredCapabilities.map((c) => this.risk.assessCapability(c)))
      : RiskLevel.LOW;
    const approvalRequired = this.risk.requiresApproval(overallRisk);

    const steps: ExecutionStep[] = requiredCapabilities.map((capability, i) => ({
      id: newId(),
      title: `Step ${i + 1}: ${capability}`,
      description: `Apply ${capability} toward: ${request.goal}`,
      capability,
      status: ExecutionStatus.PENDING,
    }));

    const estimatedChanges: EstimatedChanges = {
      fileCount: requiredResources.length,
      ...(request.estimatedChangedLines !== undefined
        ? { estimatedChangedLines: request.estimatedChangedLines }
        : {}),
      scope: scopeFor(requiredResources.length),
    };

    const summary = requiredCapabilities.length
      ? `Plan to: ${request.goal} — via ${requiredCapabilities.join(', ')}`
      : `Plan to: ${request.goal}`;

    return {
      id: newId(),
      goal: request.goal,
      summary,
      steps,
      requiredCapabilities,
      requiredResources,
      estimatedChanges,
      approvalRequired,
      overallRisk,
      expectedArtifacts: expectedArtifactsFor(requiredCapabilities),
      status: ExecutionStatus.PENDING,
      ...(request.projectId ? { projectId: request.projectId } : {}),
      createdAt: now(),
    };
  }
}
