import type { Id, IsoTimestamp } from './common';
import type { RiskLevel } from './enums';

/**
 * A request for human approval before a HIGH/CRITICAL action runs. The
 * PlatformAdapter renders this (e.g. Discord buttons) and reports back a
 * decision. No external write happens until the decision is `approved`.
 */
export interface ApprovalRequest {
  id: Id;
  taskId: Id;
  planStepId?: Id;
  riskLevel: RiskLevel;
  summary: string;
  requestedAt: IsoTimestamp;
}

export interface ApprovalDecision {
  approvalId: Id;
  approved: boolean;
  decidedBy: string;
  decidedAt: IsoTimestamp;
  comment?: string;
}
