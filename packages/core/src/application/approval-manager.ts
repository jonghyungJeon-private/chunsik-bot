import { newId } from '../util/id';
import { now } from '../util/clock';
import { ApprovalStatus, executionPlanRef } from '../domain';
import type { ApprovalDecision, ApprovalRequest, ExecutionPlan, Id } from '../domain';
import type { StorageProvider } from '../ports';
import type { ApprovalPolicy } from './approval-policy';

/**
 * CAP-004 Approval (ADR-0025). Owns the `ApprovalRequest` aggregate and is the
 * ONLY capability that mutates it. It REFERENCES an `ExecutionPlan` (read-only,
 * via `executionPlanRef`) and never mutates the plan — Aggregate Ownership Rule.
 * Persists through the StorageProvider `approvals` repository.
 */
export class ApprovalManager {
  constructor(
    private readonly storage: StorageProvider,
    private readonly policy: ApprovalPolicy,
  ) {}

  /**
   * Create an ApprovalRequest for a plan. If the policy says no approval is
   * needed, the request is created already APPROVED (auto, decided by 'system');
   * otherwise it is PENDING awaiting a human decision. The plan is read, never mutated.
   */
  async requestFor(plan: ExecutionPlan, requestedBy: string): Promise<ApprovalRequest> {
    const evaluation = this.policy.evaluate(plan, requestedBy);
    const ts = now();
    const auto = !evaluation.requiresApproval;
    const request: ApprovalRequest = {
      id: newId(),
      executionPlanRef: executionPlanRef(plan),
      status: auto ? ApprovalStatus.APPROVED : ApprovalStatus.PENDING,
      riskLevel: evaluation.riskLevel,
      reason: evaluation.reason,
      requestedBy,
      ...(auto ? { decision: true, decidedBy: 'system', decidedAt: ts } : {}),
      createdAt: ts,
      updatedAt: ts,
    };
    return this.storage.approvals.save(request);
  }

  /** Record a human decision on a PENDING request (this aggregate is Approval-owned). */
  async decide(approvalId: Id, decision: ApprovalDecision): Promise<ApprovalRequest> {
    const existing = await this.storage.approvals.get(approvalId);
    if (!existing) throw new Error(`approval not found: ${approvalId}`);
    if (existing.status !== ApprovalStatus.PENDING) {
      throw new Error(`approval ${approvalId} already decided (${existing.status})`);
    }
    const updated: ApprovalRequest = {
      ...existing,
      status: decision.approved ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
      decision: decision.approved,
      decidedBy: decision.decidedBy,
      decidedAt: decision.decidedAt,
      ...(decision.comment ? { comment: decision.comment } : {}),
      updatedAt: now(),
    };
    return this.storage.approvals.save(updated);
  }

  async get(approvalId: Id): Promise<ApprovalRequest | null> {
    return this.storage.approvals.get(approvalId);
  }

  /** Whether a given ExecutionPlan currently has an APPROVED request. */
  async isApproved(executionPlanId: Id): Promise<boolean> {
    const requests = await this.storage.approvals.findByExecutionPlan(executionPlanId);
    return requests.some((r) => r.status === ApprovalStatus.APPROVED);
  }
}
