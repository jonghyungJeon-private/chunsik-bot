# Stage 2B Slice 5C-EG-F0-R / F0-HI Offline Runner

This directory owns the non-production, fixture-only executable representation of the accepted F0 allowlist in
`allowlist.ts`. The Markdown allowlist remains the Architecture and Safety specification; this versioned TypeScript
object is its single machine-readable command contract. Drift tests pin the 16 command ids and exclude templates.

The accepted F0-H plan is implemented here only as the F0-HI mocked boundary. The runner exposes pure
canonicalization, symbol resolution, dependency, identity, stream-policy, normalization, evidence, deterministic
event-arbitration, timeout/termination, and stop-on-first-failure functions. All host ports require explicit
deterministic fakes. There is no real host adapter, shell lookup, process spawn, filesystem inspection, signal,
network access, daemon contact, or production-runtime import.

The static allowlist binds command shape, `approvalStatus=CANDIDATE_ONLY_NOT_APPROVED`, normalization, policies, and
validated dependency declarations. Repository divergence is not static: `ExecutionBaselineBinding` owns the
approval-supplied expected behind/ahead counts and has a separate digest. The v2 static contract binds
`COMMAND_ORDER_VERSION`; the baseline digest binds every closed live-policy version and value. The exact environment
is `LANG=C, LC_ALL=C`, and any future environment change invalidates both digests. Dependency state is module-issued only from
the exact closed symbol resolution and context-matching successful prior evidence; arbitrary strings are rejected.

Fixture output is a sequence of stdout/stderr events. The host arbiter preserves the accepted F0-R precedence:
both-stream cap, stderr cap, stdout cap, invalid UTF-8, then bounded non-empty stderr. Any non-empty stderr is terminal.
Caps and strict UTF-8/newline normalization are incremental across 4096-byte segments; at most one segment is pending.
The sequencer derives the exact 16-record order only from a validated resolved contract, so callers cannot supply or
reorder records. Every terminal failure emits exactly one validated bounded v2 evidence record, and ordered evidence
is successful evidence followed by that terminal record. Timeout uses a deterministic scheduled fake clock with
per-command handles and exact cancellation. No raw output is stored. Operator-visible termination failure is required.
Contract/canonicalization/evidence schema are v2; v1 digests are incompatible and
cannot be reused. The canonical digest remains unfrozen, environment viability remains an unevaluated execution gate,
and executable TOCTOU remains a live-execution feasibility blocker. Termination and F0/F1 process execution remain
unapproved.

XR-I adds a private offline exact-host-read engine backed only by deterministic fixture ports. Its closed, unfrozen
allowlist contains `XR-EXEC-GIT`, `XR-EXEC-SED`, `XR-EXEC-READLINK`, and `XR-EXEC-STAT`; callers provide neither paths
nor operations. Each record performs two complete component/symlink observations with inclusive limits of 16 path
entries and eight symlink hops per pass, and `32/16/2/2/52` total `lstat/readlink/realpath/stat/all` calls. UTF-8 link
and normalized-evidence caps are checked before accumulation; excess fails closed, including with
`XR_READ_CALL_CAP_EXCEEDED`. Full canonical-v2 consistency tokens must match across both passes.

`HostReadExecutableObservation` remains separate from `ExecutableIdentity`: it has the required unresolved code-sign
sentinel and no `codeSignature`. XR evidence is therefore execution-ineligible, code-sign feasibility blocks
XG/XF/XA/E, and live-execution TOCTOU remains unresolved. The real filesystem adapter is `NOT_IMPLEMENTED`, host-read
execution is `NOT_PERFORMED`, and this Slice freezes no digest and grants no execution approval. F0-HV remains
`COMPLETE_AND_ACCEPTED_BY_INDEPENDENT_REVIEW` at reviewed HEAD `b36aad6423f11f38c062e3d3c034c934d1e0de20`;
no separate commit or plan document is required.

Validation:

```text
pnpm exec vitest run tools/provider-routing/egress-allowlist-runner/runner.test.ts
pnpm exec vitest run tools/provider-routing/egress-allowlist-runner/host/*.test.ts
pnpm exec tsc -p tools/provider-routing/egress-allowlist-runner/tsconfig.json
```
