# Provider Routing Validation

Private, test-only deterministic validation harness for the Stage 2B routing contracts.

- Fixtures are strict JSON imported through an explicit registry; there is no filesystem discovery.
- Providers and time are scripted in memory. External provider execution is always `0`.
- The harness replays an already-selected provider decision and never simulates `RoutingPolicyEngine`.
- Golden comparisons use the harness-owned `CanonicalAuditProjection`, not the complete product audit schema.
- Fixture versions are immutable. Changes require a new version while retaining the prior fixture.
- No production package or application may import this package.

`HARNESS_DIGEST_VERSION` is owned by this package and is independent from Core's failure-matrix version.
