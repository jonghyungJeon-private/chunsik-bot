import { describe, expect, it } from 'vitest';
import {
  ROUTING_FAILURE_MATRIX,
  RoutingFailureClass,
  RoutingFailureCode,
  RoutingFailureProducerStatus,
} from './runtime-response-validation-contracts';

describe('routing failure matrix', () => {
  it('defines every bounded failure code exactly once', () => {
    expect(ROUTING_FAILURE_MATRIX.map((entry) => entry.code).sort()).toEqual(
      Object.values(RoutingFailureCode).sort(),
    );
    expect(new Set(ROUTING_FAILURE_MATRIX.map((entry) => entry.code)).size).toBe(
      ROUTING_FAILURE_MATRIX.length,
    );
    expect(Object.isFrozen(ROUTING_FAILURE_MATRIX)).toBe(true);
    expect(ROUTING_FAILURE_MATRIX.every(Object.isFrozen)).toBe(true);
  });

  it('keeps configuration and safety failures fail-closed with no branch', () => {
    const closed = ROUTING_FAILURE_MATRIX.filter((entry) =>
      [RoutingFailureClass.CONFIGURATION, RoutingFailureClass.SAFETY].includes(entry.failureClass),
    );
    expect(closed.every((entry) => !entry.fallbackAllowed && !entry.escalationAllowed && entry.failClosed)).toBe(true);
    expect(closed.filter((entry) => entry.failureClass === RoutingFailureClass.CONFIGURATION).every((entry) => entry.attemptConsumed === 0)).toBe(true);
  });

  it('permits empty-output fallback, prohibits output-limit fallback, and never escalates operational failures', () => {
    const empty = ROUTING_FAILURE_MATRIX.find((entry) => entry.code === RoutingFailureCode.EMPTY_OUTPUT);
    const outputLimit = ROUTING_FAILURE_MATRIX.find(
      (entry) => entry.code === RoutingFailureCode.OUTPUT_LIMIT_VIOLATION,
    );
    expect(empty?.fallbackAllowed).toBe(true);
    expect(outputLimit?.fallbackAllowed).toBe(false);
    expect(
      ROUTING_FAILURE_MATRIX.filter((entry) => entry.failureClass === RoutingFailureClass.OPERATIONAL).every(
        (entry) => !entry.escalationAllowed,
      ),
    ).toBe(true);
  });

  it('marks adapter/runtime signal producers as pending rather than active defenses', () => {
    const pending = ROUTING_FAILURE_MATRIX.filter(
      (entry) => entry.producerStatus === RoutingFailureProducerStatus.PRODUCER_PENDING,
    ).map((entry) => entry.code);
    expect(pending).toEqual([
      RoutingFailureCode.PROVIDER_SPAWN_FAILED,
      RoutingFailureCode.STRUCTURAL_VALIDATION_FAILED,
      RoutingFailureCode.CONTAINMENT_FAILURE,
      RoutingFailureCode.MODEL_DOWNLOAD_DETECTED,
    ]);
  });
});
