# Stage 2A Authority Boundary Implementation Report

## CURRENT MAIN

- Branch: `main`
- Local `HEAD`: `81fccb12e570dfb3e399d85afcb86cf99f131753`
- Local `main`: `81fccb12e570dfb3e399d85afcb86cf99f131753`
- Existing local `origin/main`: `81fccb12e570dfb3e399d85afcb86cf99f131753`
- Pre-existing tracked modifications preserved:
  - `AGENTS.md`
  - `CLAUDE.md`
- All pre-existing untracked files were left in place.

## IMPLEMENTED SCOPE

Stage 2A adds a static, provider-neutral GENERAL_CHAT authority boundary immediately
after the complete selected transcript and before the final Task.

The boundary is rendered as:

```text
## 4. Current-turn authority decision boundary
### Authoritative current facts
<reused canonicalCurrentFactsBody>
### Mandatory inference constraints
<reused GENERAL_CHAT_AUTHORITY_RULES_BODY>
```

The implementation:

- preserves Section 1 canonical current facts;
- preserves background resources;
- preserves the complete selected transcript;
- preserves the final Task as the last top-level section;
- leaves the current User input in the final Task only;
- changes no transcript, memory-selection, provider-selection, or execution path;
- applies only to `Capability.GENERAL_CHAT`.

## CHANGED FILES

Approved production file:

- `packages/core/src/application/prompt-composer.ts`

Approved test files:

- `packages/core/src/application/prompt-composer.test.ts`
- `packages/core/src/application/context-builder.test.ts`
- `packages/core/src/application/prompt-renderer.test.ts`
- `packages/core/src/application/conversation-runtime.test.ts`

Implementation report:

- `docs/plans/chunsikbot2-stage2a-authority-boundary-implementation.md`

No other production or test source was modified for Stage 2A.

## CANONICAL FACT REUSE

`PromptComposer.compose()` continues to render Task-derived facts once:

```text
currentFacts
  → PromptComposer.renderEntries(currentFacts)
  → canonicalCurrentFactsBody
```

The exact same `canonicalCurrentFactsBody` value is supplied to:

1. `## 1. Current-turn facts supplied by Core`
2. `### Authoritative current facts` within Section 4

Section 4 does not rebuild, re-map, or independently render the fact entries.
The approved tests compare the two emitted bodies for byte equality and repeat the
comparison with changed synthetic Task facts.

## SHARED AUTHORITY RULE SOURCE

One static rendered value is defined in `prompt-composer.ts`:

```text
GENERAL_CHAT_AUTHORITY_RULES_BODY
```

It contains the provider-neutral mandatory inference constraints. The same rendered
body is reused by:

1. the GENERAL_CHAT Developer instruction;
2. `### Mandatory inference constraints` within Section 4.

There is no second independently maintained rule list. The approved tests extract the
task-adjacent rule body and verify that the Developer instruction ends with that exact
rendered content.

The shared rules state that:

- Assistant transcript is continuity-only and cannot establish prior verification or
  current external state;
- an active project does not identify the current request target;
- an active project does not establish external connection status;
- a current-state conclusion cannot be copied, confirmed, or restated solely from
  Assistant history;
- one concise clarifying question is required when authoritative facts do not
  establish the target or status;
- prior confirmation or verification cannot be claimed solely from Assistant
  transcript.

Existing Stage 1 evidence, User-claim, external-status, and outbound-delivery
constraints are included in the same shared rule body to avoid a second authority-rule
source.

## PROMPT CONTRACT RESULT

For GENERAL_CHAT, the authored prompt order is now:

1. current-turn facts supplied by Core;
2. background resources;
3. complete conversation transcript marked continuity-only;
4. current-turn authority decision boundary;
5. final Task.

The active-project fact and both active-project limitations are colocated in Section 4.
The transcript remains unchanged and available for ordinary conversational continuity.
The policy is unconditional static GENERAL_CHAT wording; it introduces no phrase,
project, language, platform, Discord, Provider, model, or connection-status matcher.

Non-GENERAL_CHAT prompt behavior remains outside the new boundary.

## TEST CHANGES

The approved test source now covers:

1. byte-identical Section 1 and Section 4 canonical fact bodies;
2. reuse across changed synthetic Task-derived facts;
3. exact shared authority-rule content in Developer and Section 4;
4. Section 4 ordering after transcript and before final Task;
5. a generic synthetic 10-entry Stage C-shaped transcript;
6. preservation and ordering of all 10 transcript entries;
7. non-authoritative epistemic status for every Assistant entry;
8. active-project fact and limitations colocated in Section 4;
9. current User input exactly once in final Task;
10. exactly one Provider selection and execution;
11. preservation of ordinary conversational continuity;
12. absence of a Stage 2B typed absence-of-evidence fact;
13. unchanged non-GENERAL_CHAT authority-boundary behavior;
14. existing N=10 and 400-character truncation behavior.

Only generic synthetic fixture identifiers and content were added to the Stage 2A
regression.

## TEST EXECUTION STATUS

Tests were not executed because this approval window authorizes test source mutation
but explicitly does not authorize Test execution.

Typecheck and Build were also not executed.

No test-pass, typecheck-pass, or build-pass claim is made in this report.

## ARCHITECTURE INVARIANTS

- Production change is limited to `PromptComposer`.
- Core remains provider-independent and platform-independent.
- No domain type, provenance value, or epistemic-status value was added.
- No typed absence-of-evidence fact was introduced.
- No transcript filtering, deletion, summarization, or reordering was introduced.
- No memory retrieval, N=10 selection, truncation, or normalization behavior changed.
- No resolver, capability, second Provider call, or Stage 2B/2C path was added.
- Prompt rendering and conversation execution ownership remain unchanged.
- The current User input remains in the final Task envelope.

## SAFETY

- `AGENTS.md` and `CLAUDE.md` were preserved as pre-existing tracked modifications.
- Existing untracked files were not edited, deleted, moved, staged, or cleaned.
- The contaminated Session and Memory fixture was not opened in write mode or mutated.
- Runtime was not started, stopped, or restarted.
- Provider and model execution were not performed.
- Discord was not connected or acted upon.
- DB mutation was not performed.
- Build, Test, Typecheck, Commit, Push, PR, Merge, Cleanup, and Gate 6 were not
  performed.

## APPROVAL BOUNDARY

This implementation used only:

- Stage 2A Implementation approval;
- Stage 2A Test Source Modification approval;
- the approved production and test file list;
- one implementation-report mutation.

Test execution, Typecheck, Build, Runtime, Provider, Discord, DB, Commit, Push, PR,
Merge, Cleanup, and Gate 6 remain unapproved.

## NEXT STEP

Obtain separate Stage 2A Test and Typecheck approval, then run only the approved
deterministic verification commands against the current working tree.

STAGE_2A_IMPLEMENTATION_READY_FOR_TEST
