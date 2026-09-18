import type { IsoTimestamp } from './common';

export enum TriggerSourceKind {
  INTERNAL_CONTINUATION = 'INTERNAL_CONTINUATION',
}

export const MAX_TRIGGER_PROVENANCE_ID_CHARACTERS = 128;

const PROVENANCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CANONICAL_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface TriggerSourceInput {
  readonly kind: TriggerSourceKind;
  readonly provenanceId: string;
  readonly observedAt: IsoTimestamp;
}

/**
 * Immutable provenance for one application-level proactive-work observation.
 * It grants no identity, authority, approval, execution, or scheduling right.
 */
export class TriggerSource {
  readonly kind: TriggerSourceKind;
  readonly provenanceId: string;
  readonly observedAt: IsoTimestamp;

  constructor(input: TriggerSourceInput) {
    if (typeof input !== 'object' || input === null) {
      throw new Error('TriggerSource input must be an object');
    }
    if (input.kind !== TriggerSourceKind.INTERNAL_CONTINUATION) {
      throw new Error('Unsupported TriggerSource kind');
    }
    if (typeof input.provenanceId !== 'string' || !PROVENANCE_ID.test(input.provenanceId)) {
      throw new Error('Invalid TriggerSource provenanceId');
    }
    if (!isCanonicalUtcTimestamp(input.observedAt)) {
      throw new Error('Invalid TriggerSource observedAt');
    }

    this.kind = input.kind;
    this.provenanceId = input.provenanceId;
    this.observedAt = input.observedAt;
    Object.freeze(this);
  }
}

function isCanonicalUtcTimestamp(value: unknown): value is IsoTimestamp {
  if (typeof value !== 'string' || !CANONICAL_UTC_TIMESTAMP.test(value)) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}
