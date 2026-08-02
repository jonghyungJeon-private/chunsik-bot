import { createHash } from 'node:crypto';
import { canonicalJson } from '../canonical';
import {
  SELECTION_HARNESS_DIGEST_VERSION,
  SelectionFixture,
} from './contracts';

export function selectionDigest(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJson({ selectionHarnessDigestVersion: SELECTION_HARNESS_DIGEST_VERSION, value }))
    .digest('hex');
}

export function computeSelectionFixtureDigest(fixture: SelectionFixture): string {
  const { fixtureDigest: _excluded, ...material } = fixture;
  return selectionDigest(material);
}

export function computeSelectionCorpusDigest(fixtures: readonly SelectionFixture[]): string {
  return selectionDigest(
    fixtures
      .map(({ scenarioId, fixtureVersion, fixtureDigest }) => ({ scenarioId, fixtureVersion, fixtureDigest }))
      .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId)),
  );
}
