import type { SelectionCoverageEntry } from './contracts';

export const REQUIRED_SELECTION_COVERAGE_AXES = Object.freeze([
  'POLICY_MATCH',
  'NO_POLICY_MATCH',
  'ELIGIBILITY',
  'NO_ELIGIBLE_PROVIDER',
  'DISABLED',
  'UNAVAILABLE',
  'RANKING',
  'STABLE_ORDERING',
  'PREFERENCE',
  'AUTHORITY',
  'SAFETY',
] as const);

export const SELECTION_COVERAGE_MANIFEST: readonly SelectionCoverageEntry[] = Object.freeze([
  { axis: 'POLICY_MATCH', scenarioId: 'routing-preference', assertion: 'A matching policy produces SELECTED.' },
  { axis: 'NO_POLICY_MATCH', scenarioId: 'no-policy-match', assertion: 'No matching predicate produces POLICY_NOT_MATCHED.' },
  { axis: 'ELIGIBILITY', scenarioId: 'trait-eligibility', assertion: 'Tool, structure, capacity, and locality gates run before ranking.' },
  { axis: 'NO_ELIGIBLE_PROVIDER', scenarioId: 'trait-eligibility', assertion: 'A matched policy can terminate with no eligible provider.' },
  { axis: 'DISABLED', scenarioId: 'availability-filter', assertion: 'Disabled providers never enter ranking.' },
  { axis: 'UNAVAILABLE', scenarioId: 'availability-filter', assertion: 'Unavailable providers never enter ranking.' },
  { axis: 'RANKING', scenarioId: 'authority-safety-ranking', assertion: 'Configured dimensions are applied lexicographically.' },
  { axis: 'STABLE_ORDERING', scenarioId: 'routing-preference', assertion: 'Fixed registration and unordered-array permutations preserve the decision.' },
  { axis: 'PREFERENCE', scenarioId: 'routing-preference', assertion: 'Routing-class preference precedes later ranking dimensions.' },
  { axis: 'AUTHORITY', scenarioId: 'authority-safety-ranking', assertion: 'Authority requirements and reliability participate together.' },
  { axis: 'SAFETY', scenarioId: 'authority-safety-ranking', assertion: 'High semantic risk selects through a bounded safety-sensitive policy.' },
]);
