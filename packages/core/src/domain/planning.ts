import type { Id, IsoTimestamp, Metadata } from './common';
import type { Capability, IntentType, RiskLevel } from './enums';

/** The classifier's understanding of a single inbound message. */
export interface Intent {
  type: IntentType;
  /** The capability required to satisfy this intent. */
  capability: Capability;
  /** 0..1 confidence; low confidence may trigger a clarifying question. */
  confidence: number;
  /** Whether this needs to become a Task (vs. an immediate chat reply). */
  requiresWork: boolean;
  /** Human-readable restatement of what the user wants. */
  summary: string;
  /** Raw classifier output for debugging; never surfaced to the user. */
  raw?: Metadata;
}

/** One concrete step in a Plan. Each step carries its own risk. */
export interface PlanStep {
  id: Id;
  description: string;
  capability: Capability;
  riskLevel: RiskLevel;
  /** Derived from riskLevel + policy; HIGH/CRITICAL gate execution. */
  requiresApproval: boolean;
}

/** An ordered set of steps produced by the Planner for a Task. */
export interface Plan {
  id: Id;
  taskId: Id;
  steps: PlanStep[];
  /** The max risk across steps; drives the task-level approval gate. */
  overallRisk: RiskLevel;
  summary: string;
  createdAt: IsoTimestamp;
}
