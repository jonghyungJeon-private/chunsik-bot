import { NotImplementedError } from '../errors';
import type { Intent, Plan, Task } from '../domain';
import type { CapabilityRouter } from './capability-router';
import type { RiskPolicy } from './risk-policy';

/**
 * Decomposes an intent into an ordered Plan of steps, each carrying a risk
 * level (from RiskPolicy) and an approval flag. Step GENERATION is model-driven
 * cognition and is a deliberate stub in v1; the risk assignment it will use is
 * already implemented in RiskPolicy.
 *
 * Intended design: route ARCHITECTURE_PLANNING to an AiProvider to produce
 * candidate steps, then stamp each step's risk via RiskPolicy and set
 * overallRisk = RiskPolicy.max(...steps).
 */
export class Planner {
  constructor(
    private readonly router: CapabilityRouter,
    private readonly risk: RiskPolicy,
  ) {}

  async plan(_task: Task, _intent: Intent): Promise<Plan> {
    throw new NotImplementedError('Planner.plan');
  }
}
