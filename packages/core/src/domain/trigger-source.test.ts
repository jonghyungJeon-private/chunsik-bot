import { describe, expect, it } from 'vitest';
import {
  MAX_TRIGGER_PROVENANCE_ID_CHARACTERS,
  TriggerSource,
  TriggerSourceKind,
} from './trigger-source';

const input = () => ({
  kind: TriggerSourceKind.INTERNAL_CONTINUATION,
  provenanceId: 'work-1:continuation-1',
  observedAt: '2026-09-03T01:02:03.004Z',
});

describe('TriggerSource', () => {
  it('accepts INTERNAL_CONTINUATION with bounded provenance and supplied time', () => {
    expect(new TriggerSource(input())).toEqual(input());
  });

  it.each(['SCHEDULE', 'WEBHOOK', '', undefined])(
    'rejects unsupported kind %j',
    (kind) => expect(() => new TriggerSource({ ...input(), kind } as never)).toThrow(
      'Unsupported TriggerSource kind',
    ),
  );

  it.each([
    '',
    ' leading',
    'trailing ',
    'invalid/id',
    'x'.repeat(MAX_TRIGGER_PROVENANCE_ID_CHARACTERS + 1),
    42,
  ])('rejects empty or invalid provenance identity %j', (provenanceId) => {
    expect(() => new TriggerSource({ ...input(), provenanceId } as never)).toThrow(
      'Invalid TriggerSource provenanceId',
    );
  });

  it.each([
    '',
    '2026-09-03',
    '2026-09-03T01:02:03Z',
    '2026-02-30T01:02:03.004Z',
    '2026-09-03T01:02:03.004+00:00',
    42,
  ])('rejects invalid or non-canonical observedAt %j', (observedAt) => {
    expect(() => new TriggerSource({ ...input(), observedAt } as never)).toThrow(
      'Invalid TriggerSource observedAt',
    );
  });

  it('is immutable and defensively captures its input', () => {
    const mutable = input();
    const trigger = new TriggerSource(mutable);
    mutable.provenanceId = 'changed';

    expect(Object.isFrozen(trigger)).toBe(true);
    expect(() => {
      (trigger as { provenanceId: string }).provenanceId = 'changed-through-value';
    }).toThrow(TypeError);
    expect(trigger.provenanceId).toBe('work-1:continuation-1');
  });
});
