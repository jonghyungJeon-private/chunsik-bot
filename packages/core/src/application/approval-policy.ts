import type { ExecutionPlan, IsoTimestamp, RiskLevel } from '../domain';
import type { RiskPolicy } from './risk-policy';

/**
 * Deterministic evaluation of whether an ExecutionPlan needs human approval
 * (CAP-004, ADR-0025). Required fields are populated; the reserved optional
 * fields exist for future policies but are NOT enforced in 2d (no role-based
 * authorization, no expiry enforcement).
 */
export interface ApprovalEvaluation {
  requiresApproval: boolean;
  reason: string;
  riskLevel: RiskLevel;
  requestedBy: string;
  // Reserved (not implemented in CAP-004):
  approverRole?: string;
  expiresAt?: IsoTimestamp;
  policyVersion?: string;
}

/**
 * Minimal, deterministic approval policy. Reuses the shared `RiskPolicy` as the
 * single source of truth for whether a risk level needs approval (HIGH/CRITICAL).
 * Reads the plan; never mutates it.
 */
export class ApprovalPolicy {
  constructor(private readonly risk: RiskPolicy) {}

  evaluate(plan: ExecutionPlan, requestedBy: string): ApprovalEvaluation {
    const riskLevel = plan.overallRisk;
    const requiresApproval = this.risk.requiresApproval(riskLevel);
    const reason = requiresApproval
      ? `${riskLevel} risk requires human approval`
      : `${riskLevel} risk is auto-approved (no human approval required)`;
    return { requiresApproval, reason, riskLevel, requestedBy };
  }
}
