# Disposable Quoky Live Canary A2 Marker

> **DISPOSABLE CANARY ARTIFACT:** This note exists only to qualify the Quoky
> Architect → Builder → exact-HEAD Reviewer control-plane path. It is not a
> product, architecture, governance, dependency, configuration, runtime, or
> provider specification.

- Authorization root: `eb32f834-0449-4838-bf8c-a9d0b9c85b24`
- Sequence: `QUOKY-LIVE-CANARY-A2-B-C`
- Frozen ordered sequence: `[QUOKY-LIVE-CANARY-A2, QUOKY-LIVE-CANARY-B, QUOKY-LIVE-CANARY-C]`
- Step: `QUOKY-LIVE-CANARY-A2`
- Task: `quoky-live-canary-a2-straight-pass-doc-only`
- Base HEAD: `03bfd291aba4e31b680a4338951f4780a3621b6c`
- Expected agent order: Kiro Architect → Codex Builder → exact-HEAD Claude Reviewer PASS → Kiro classification

The control plane records the final Builder HEAD and Reviewer verdict from the
actual dispatch results; they are deliberately not predicted by this Builder
artifact.

Required terminal invariants to be observed by the control plane:

- `falseHumanRequired=false`
- Codex Builder is dispatched exactly once (`duplicateBuilderDispatch=false`).
- Claude Reviewer is dispatched exactly once against the exact Builder HEAD
  (`duplicateReviewerDispatch=false`, `wrongHeadReview=false`).
- `stuckPendingState=false`
- `feedbackLost=false`
- `feedbackDoubleConsumed=false`
- `unauthorizedStrictAction=false`

No Strict action, application runtime, Discord action, provider/network path,
secret access, database mutation, release operation, or Quoky source change is
part of this marker.
