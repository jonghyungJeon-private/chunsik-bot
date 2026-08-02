import { DeadlineClass } from './provider-execution-plan';

export const DEADLINE_POLICY_VERSION = 'provider-deadline-policy-v1' as const;

export interface DeadlineBudget {
  readonly overallBudgetMs: number;
  readonly validationReserveMs: number;
  readonly minimumAttemptBudgetMs: number;
}

export interface ProviderDeadlinePolicy {
  readonly version: string;
  resolve(deadlineClass: DeadlineClass): DeadlineBudget;
}

export interface MonotonicClock {
  nowMs(): number;
}

const BUDGETS: Readonly<Record<DeadlineClass, DeadlineBudget>> = Object.freeze({
  [DeadlineClass.INTERACTIVE]: Object.freeze({
    overallBudgetMs: 15_000,
    validationReserveMs: 250,
    minimumAttemptBudgetMs: 50,
  }),
  [DeadlineClass.STANDARD]: Object.freeze({
    overallBudgetMs: 60_000,
    validationReserveMs: 500,
    minimumAttemptBudgetMs: 100,
  }),
  [DeadlineClass.EXTENDED]: Object.freeze({
    overallBudgetMs: 300_000,
    validationReserveMs: 1_000,
    minimumAttemptBudgetMs: 250,
  }),
});

export const DEFAULT_PROVIDER_DEADLINE_POLICY: ProviderDeadlinePolicy = Object.freeze({
  version: DEADLINE_POLICY_VERSION,
  resolve(deadlineClass: DeadlineClass): DeadlineBudget {
    return BUDGETS[deadlineClass];
  },
});

export const SYSTEM_MONOTONIC_CLOCK: MonotonicClock = Object.freeze({
  nowMs: () => Number(process.hrtime.bigint()) / 1_000_000,
});

export function effectiveProviderTimeoutMs(
  requestTimeoutMs: number | undefined,
  providerBudgetMs: number,
): number {
  return Math.max(0, Math.min(requestTimeoutMs ?? Number.POSITIVE_INFINITY, providerBudgetMs));
}
