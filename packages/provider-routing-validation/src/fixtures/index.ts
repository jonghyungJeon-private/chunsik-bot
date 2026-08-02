import deadlineAfterValidation from './deadline-after-validation-v1.json';
import emptyOutputFallback from './empty-output-fallback-v1.json';
import manifestJson from './manifest.json';
import primaryAccepted from './primary-accepted-v1.json';
import promptLeak from './prompt-leak-v1.json';
import semanticEscalation from './semantic-escalation-v1.json';
import semanticValidationUnresolved from './semantic-validation-unresolved-v1.json';
import timeoutFallback from './timeout-fallback-v1.json';
import { FixtureManifest, RoutingValidationFixture } from '../contracts';
import { validateFixture, validateManifest } from '../fixture-validator';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** Explicit immutable registry. Adding a fixture requires a reviewed source change. */
export const GOLDEN_FIXTURES: readonly RoutingValidationFixture[] = Object.freeze([
  deadlineAfterValidation,
  emptyOutputFallback,
  primaryAccepted,
  promptLeak,
  semanticEscalation,
  semanticValidationUnresolved,
  timeoutFallback,
].map((fixture) => deepFreeze(validateFixture(fixture))));

export const GOLDEN_FIXTURE_MANIFEST: FixtureManifest = deepFreeze(validateManifest(manifestJson));
