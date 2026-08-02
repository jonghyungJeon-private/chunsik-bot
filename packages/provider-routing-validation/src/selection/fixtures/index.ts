import authoritySafetyRanking from './authority-safety-ranking-v1.json';
import availabilityFilter from './availability-filter-v1.json';
import manifestJson from './manifest.json';
import noPolicyMatch from './no-policy-match-v1.json';
import routingPreference from './routing-preference-v1.json';
import traitEligibility from './trait-eligibility-v1.json';
import { SelectionFixture, SelectionManifest } from '../contracts';
import { validateSelectionFixture, validateSelectionManifest } from '../fixture-validator';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const GOLDEN_SELECTION_FIXTURES: readonly SelectionFixture[] = Object.freeze([
  authoritySafetyRanking,
  availabilityFilter,
  noPolicyMatch,
  routingPreference,
  traitEligibility,
].map((fixture) => deepFreeze(validateSelectionFixture(fixture))));

export const GOLDEN_SELECTION_MANIFEST: SelectionManifest = deepFreeze(validateSelectionManifest(manifestJson));
