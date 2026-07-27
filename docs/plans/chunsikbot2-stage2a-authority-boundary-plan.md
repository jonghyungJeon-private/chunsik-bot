# Stage 2A Task-Adjacent Authority Boundary Implementation Plan

## CURRENT MAIN

- Repository: `chunsik-bot-2`
- Branch: `main`
- `HEAD = main = origin/main`:
  `81fccb12e570dfb3e399d85afcb86cf99f131753`
- Existing tracked changes to preserve:
  - `AGENTS.md`
  - `CLAUDE.md`
- Existing untracked work, including the accepted Stage 1 remediation analysis,
  must remain untouched.
- This document is plan-only. No product source, test, config, compiled output,
  DB, Session, or Memory change is claimed.

## CONFIRMED FAILURE BASELINE

The valid Stage C Live UAT used the correct `.env.local`, bot, guild/channel,
compiled artifacts, and one `ollama-cli`/`llama3.1` Provider execution.

Confirmed evidence:

| Evidence | Identifier |
|---|---|
| Inbound Discord message | `1530962636949295255` |
| Outbound Discord message | `1530962700149198992` |
| Task | `9f81ff9d-fd15-4422-9854-01d5b7af4e72` |
| TaskRun | `d853dbec-abab-407e-9e25-540ae6919236` |
| Artifact | `55840fcb-8959-42e9-865e-ecb43a1e4161` |
| Prompt SHA-256 | `41c90e13dc87bc39692ab90d66df9a4d02460c9d11781b8dc471e230f3733edd` |

Runtime plumbing passed. Semantic acceptance failed because the response treated
the active project as the request target and reused Assistant history as prior
verification:

```text
I've already confirmed that the project "quoky-gate5-disposable" is connected...
```

The exact failed prompt was reconstructed byte-for-byte and matched the TaskRun
SHA. It contained the implemented Stage 1 provenance labels, Developer rules,
two identical current-fact bodies, and final Task. There was no stale artifact,
bypass, adapter re-rendering, truncation, retry, fallback, or duplicate.

The real transcript contained ten entries: five User and five Assistant.
Every Assistant entry reinforced the same unsupported current-state conclusion.
The facts-only repeated block followed the transcript, but it repeated the
active-project fact without repeating its non-target/non-status limitation.

## STAGE 2A GOAL

Strengthen ADR-0063 at implementation level by replacing the facts-only
task-adjacent block with a compact authority boundary that:

- preserves the existing authoritative fact envelopes unchanged;
- repeats mandatory inference constraints after all transcript entries;
- pairs active-project selection with its non-target/non-status limitation;
- remains immediately before final `# Task`;
- preserves all transcript and execution invariants;
- introduces no new fact type, resolver, Provider call, or model-specific logic.

Success at this stage means deterministic prompt-contract implementation and
tests are ready for independent review. It does not claim future Provider or
Live UAT behavior.

## ARCHITECTURE DECISION

Chief Architect decision:

- Stage 2A requires no ADR-0063 amendment.
- Stage 2B typed absence-of-evidence facts are deferred and excluded.
- Stage 2C model/provider suitability work is not approved.

Stage 2A remains within existing ownership:

- Task owns current-turn facts.
- ContextBuilder owns bounded transcript and project background.
- PromptComposer owns provider-neutral sectioning and precedence.
- PromptRenderer serializes `PromptSpec`.
- Provider receives one rendered `AiRequest`.

No domain type, port, capability, intent, memory policy, provider selection, or
governance change is needed.

## CURRENT CODE PATH

### Context construction

File:
`packages/core/src/application/context-builder.ts`

Symbols:

- `RECENT_LIMIT = 10`
- `MAX_MEMORY_CHARS = 400`
- `ContextBuilder.build`
- `ContextBuilder.toTranscriptEntry`
- `ContextBuilder.truncate`

Responsibilities:

- select same-session SHORT_TERM records;
- request enough records to exclude the current inbound memory;
- retain newest N=10 oldest-to-newest;
- preserve User/Assistant/legacy provenance and epistemic status;
- truncate transcript to 400 characters;
- add active-project PROJECT memory as non-authoritative background.

Stage 2A must not modify this file.

### Prompt composition and repeated boundary

File:
`packages/core/src/application/prompt-composer.ts`

Symbols:

- `PromptComposer.compose`
- local `currentFacts`
- `canonicalCurrentFactsBody`
- local `contextSections`
- `PromptComposer.developerFor`
- `PromptComposer.label`
- `PromptComposer.section`
- `PromptComposer.renderEntries`
- `PromptComposer.sectionFromBody`

Current `GENERAL_CHAT` order:

1. `## 1. Current-turn facts supplied by Core`
2. `## 2. Background resources`
3. `## 3. Conversation transcript (continuity only; not current-state evidence)`
4. `## 4. Current-turn facts repeated as decision boundary`

Section 4 currently contains only `canonicalCurrentFactsBody`. The same body is
byte-identical to Section 1. It contains active-project selection when
`task.projectId` exists but no adjacent policy explaining what that fact does
not establish.

This is the only production file that Stage 2A should change.

### Prompt rendering

File:
`packages/core/src/application/prompt-renderer.ts`

Symbols:

- `PromptRenderer.render`
- `PromptRenderer.renderSpec`

It renders:

```text
# System
# Developer
# Context
# Task
```

It does not interpret context or change section contents. Stage 2A must not
modify this file.

### Transcript serialization

Files/symbols:

- `packages/core/src/application/context-builder.ts`
  - `ContextBuilder.toTranscriptEntry`
- `packages/core/src/application/prompt-composer.ts`
  - transcript mapping in `PromptComposer.compose`
  - `PromptComposer.label`
- `packages/core/src/application/prompt-content-normalizer.ts`
  - `normalizePromptContextContent`

ContextBuilder assigns structured trust metadata. PromptComposer serializes each
entry as one JSON line and normalizes only transient `GENERAL_CHAT` content.
Stage 2A changes neither behavior.

### Active-project fact generation

File/symbol:

- `packages/core/src/application/prompt-composer.ts`
  - `currentFacts` inside `PromptComposer.compose`

When `task.projectId` exists, it emits:

```json
{"provenance":"CORE_RUNTIME","epistemicStatus":"AUTHORITATIVE_CURRENT_FACT","content":"Active project id selected for this Task: \"...\"."}
```

Stage 2A preserves this fact byte-for-byte. The limitation is prompt policy, not
a new fact or altered fact content.

### One-Provider execution path

File:
`packages/core/src/application/conversation-runtime.ts`

Symbol:
`ConversationRuntime.handleWorkTurn`

Existing path:

```text
ContextBuilder.build
→ PromptComposer.compose
→ PromptRenderer.render
→ router.select
→ provider.execute
→ Artifact/TaskRun persistence
```

There is one `provider.execute(aiRequest)` call. Stage 2A must not modify this
file.

### Existing contract tests

| Responsibility | File/current tests |
|---|---|
| Prompt sections/facts/policy | `prompt-composer.test.ts`, `PromptComposer (ADR-0063 precedence contract)` |
| N=10/order/truncation/exclusion | `context-builder.test.ts`, `ContextBuilder (ADR-0063 structured context)` |
| Top-level rendering/hash/order | `prompt-renderer.test.ts`, `keeps the GENERAL_CHAT decision-boundary order and deterministic prompt hash` |
| Provider count/runtime path | `conversation-runtime.test.ts`, `passes the contaminated ADR-0063 contract through one GENERAL_CHAT Provider call...` |
| Input fidelity/provider count | `conversation-runtime.test.ts`, `preserves a >200-char current User message...` |
| Normalization | `prompt-content-normalizer.test.ts` |
| Memory order/cap | `memory-manager.test.ts` |

Existing tests preserve transcript content but do not yet model the full Stage
C-shaped five-User/five-Assistant contamination in one prompt-contract fixture.

## PROPOSED PROMPT CONTRACT

### Section name

Rename:

```text
## 4. Current-turn facts repeated as decision boundary
```

to:

```text
## 4. Current-turn authority decision boundary
```

The old name becomes inaccurate once the section contains facts plus policy.

### Payload shape

Use separate subsections:

```text
## 4. Current-turn authority decision boundary
### Authoritative current facts
<the existing line-oriented CORE_RUNTIME fact envelopes>

### Mandatory inference constraints
- Assistant transcript is continuity-only and cannot establish prior verification or current external state.
- An active project does not identify the target of the current request.
- An active project does not establish external connection status.
- Do not copy, confirm, or restate a current-state conclusion solely from Assistant history.
- When authoritative current facts do not establish the target or status, ask one concise clarifying question.
- Do not claim already confirmed, previously verified, or equivalent prior verification based solely on Assistant transcript.
```

Rationale:

- fact envelopes retain current provenance and epistemic status;
- policy remains policy rather than masquerading as a new fact envelope;
- `###` subsections cannot collide with existing top-level `##` context section
  validation;
- current facts remain deterministic and independently byte-comparable;
- constraints are adjacent to final Task and after the entire transcript.

### Pairing active-project fact and limitation

The authoritative active-project fact remains unchanged under
`### Authoritative current facts`. Its two static limitations immediately follow
in the same Section 4:

- active project does not identify request target;
- active project does not establish external connection status.

This is structural pairing, not a change to `Task.projectId`, fact provenance,
fact type, or fact content. No User text is inspected.

### No phrase matching

The constraints are unconditional static Provider instructions selected only by
the existing `Capability.GENERAL_CHAT` branch. Production code must not:

- inspect `task.description`, transcript text, project name, platform, Provider,
  model, or language;
- search for `연결`, `connected`, `already`, or equivalent phrases;
- generate different rules based on fixture content.

The words `already confirmed` occur only as a general instruction describing a
forbidden evidentiary claim. They are never a matcher or control-flow condition.

### Continuity preservation

The implementation does not change:

- `ContextBuilder.build`;
- `ContextBundle`;
- transcript entry types;
- transcript content/order/count;
- Assistant entry serialization;
- normalization/truncation;
- project background inclusion.

Assistant content remains available to the Provider for ordinary follow-ups.
Only its authority as current-state evidence is constrained.

### Proposed internal implementation shape

Within `PromptComposer`:

1. keep `currentFacts` and `canonicalCurrentFactsBody` unchanged;
2. add a private/static renderer or local constant for the mandatory rules;
3. replace the current `sectionFromBody` call for Section 4 with a helper that
   renders:
   - renamed Section 4 heading;
   - facts subsection using `canonicalCurrentFactsBody`;
   - rules subsection using fixed bullet strings;
4. keep the change under the existing `isGeneralChat` condition;
5. keep `spec.task` unchanged.

No new exported type or public API is required.

## FILE-BY-FILE CHANGE PLAN

### Production change

#### `packages/core/src/application/prompt-composer.ts`

Why:

- owns the deficient facts-only repeated block;
- owns provider-neutral prompt precedence and section ordering.

Exact responsibility:

- rename Section 4;
- preserve the exact canonical fact envelopes;
- add compact mandatory task-adjacent inference rules;
- render facts/rules as separate subsections;
- leave all other capabilities and `composeCodeGeneration` unchanged.

Expected diff category:

- localized prompt-composition implementation;
- no type, port, routing, storage, or provider change.

Why no other production file:

- ContextBuilder already preserves required transcript semantics;
- PromptRenderer already keeps Context before final Task;
- ConversationRuntime already makes one Provider call;
- domain types already represent all approved Stage 2A data;
- Provider receives the complete rendered prompt unchanged.

### Test changes

#### `packages/core/src/application/prompt-composer.test.ts`

Modify existing assertions that reference the old Section 4 heading or require
the entire Section 4 body to equal Section 1.

Add:

- helper to extract Section 4 facts subsection independently;
- full Stage C-shaped generic contamination fixture;
- facts-byte equality assertion;
- boundary rule presence/order assertions;
- unique current-input exactly-once assertion;
- active-project fact/limitation colocation assertion;
- no fixture-specific production-policy assertion;
- generic ordinary-follow-up continuity fixture.

#### `packages/core/src/application/context-builder.test.ts`

Retain all existing tests and add one composite generic fixture:

- 11 fetched records including current inbound;
- exclusion leaves exactly 10 entries;
- five User/five Assistant;
- oldest-to-newest order;
- all Assistant entries remain `ASSISTANT_NON_AUTHORITATIVE`;
- current inbound absent;
- 400-character behavior remains covered by existing test.

This adds regression evidence only; `context-builder.ts` remains unchanged.

#### `packages/core/src/application/prompt-renderer.test.ts`

Update the existing deterministic GENERAL_CHAT test:

- use renamed Section 4;
- verify facts and rules subsections;
- verify order through final `# Task`;
- verify Task remains the last top-level section;
- verify deterministic whole-prompt hash across identical renders;
- verify complete unique User input appears once in final Task.

Do not pin a fixed hash literal; compare two deterministic renders so harmless
approved wording changes do not require unrelated golden-hash churn.

#### `packages/core/src/application/conversation-runtime.test.ts`

Expand the existing contaminated ADR-0063 single-Provider test with a generic
10-entry Stage C-shaped `ContextBundle`:

- five User/five Assistant;
- repeated unsupported project/current-state conclusion;
- one Assistant prior-verification claim;
- active project and generic project background;
- ambiguous unique current task.

Assert:

- boundary ordering and mandatory constraints reach `AiRequest.prompt`;
- all 10 transcript envelopes reach Provider;
- current inbound is final Task and excluded from transcript input;
- `providerSelects === 1`;
- `providerExecutions === 1`;
- no orchestrator, workspace, command, resolver, approval, or second AI path.

### Explicitly unchanged files

- `packages/core/src/domain/prompting.ts`
- `packages/core/src/application/context-builder.ts`
- `packages/core/src/application/prompt-renderer.ts`
- `packages/core/src/application/prompt-content-normalizer.ts`
- `packages/core/src/application/conversation-runtime.ts`
- `packages/core/src/application/memory-manager.ts`
- all Provider/adapters and composition-root files
- `DECISIONS.md`, `ARCHITECTURE.md`
- compiled `dist`

Their unchanged status is required evidence that Stage 2A introduces no new fact
model, retrieval policy, runtime path, Provider branch, or ADR amendment.

## TEST PLAN

Tests are planned only; execution requires separate Test approval.

### A. Stage C-shaped contamination regression

Use generic synthetic values, not the failed project/message:

- active project `project-synthetic`;
- 10 transcript turns;
- five generic User status questions;
- five Assistant unsupported project-target conclusions;
- one Assistant claim that prior verification occurred;
- a unique ambiguous current task marker;
- no authoritative target or external-status fact.

Assertions:

1. every transcript entry remains present and ordered;
2. every Assistant entry retains
   `ASSISTANT_NON_AUTHORITATIVE`;
3. current inbound memory ID is excluded;
4. current input appears exactly once after `# Task`;
5. authority boundary follows all transcript entries;
6. authority boundary precedes final Task;
7. boundary contains existing facts and all mandatory rules;
8. active-project fact and both limitations occur within Section 4;
9. prior-verification from Assistant transcript is explicitly prohibited;
10. clarification is required when facts do not establish target/status;
11. production decision code contains no synthetic fixture value.

### B. Byte and ordering contract

1. Extract Section 1 fact lines.
2. Extract Section 4 `### Authoritative current facts`.
3. Assert the fact lines are byte-identical.
4. Do not require the whole Section 4 body to equal Section 1.
5. Assert stable order:
   System → Developer → Context → facts → background → transcript → authority
   boundary → Task.
6. Assert `# Task` is the final top-level section.
7. Assert complete multiline User input survives exactly.
8. Retain existing normalization tests.
9. Retain existing 400-character truncation and N=10 tests.

### C. Continuity preservation

Add a generic prompt fixture:

- prior Assistant: `The draft title is Aurora.`;
- current User: `Make that title shorter.`;
- no external current-state assertion.

Assert:

- prior Assistant content remains present and non-authoritative;
- current follow-up remains complete in final Task;
- policy says transcript may support continuity while prohibiting unsupported
  current-state facts;
- no transcript entry is deleted or summarized.

This is deterministic prompt availability evidence, not a claim about a model's
future natural-language output.

### D. Architecture and execution invariants

Assert:

- exactly one Provider selection and execution;
- no new resolver or capability;
- no Provider/model/project/message/platform/language branch;
- no change to `ContextBundle` or epistemic/provenance unions;
- no change to N=10 or memory APIs;
- no typed absence-of-evidence envelope;
- non-`GENERAL_CHAT` prompt shape remains unchanged;
- `composeCodeGeneration` remains unchanged.

### Intended validation commands

Only after separate Test approval, using the repository's approved Node version:

```text
pnpm --filter @chunsik/core test -- prompt-composer.test.ts
pnpm --filter @chunsik/core test -- context-builder.test.ts
pnpm --filter @chunsik/core test -- prompt-renderer.test.ts
pnpm --filter @chunsik/core test -- conversation-runtime.test.ts
pnpm typecheck
```

The implementer must first confirm actual package scripts/CLI filtering syntax.
If the repository does not support these exact focused forms, stop and report
the verified equivalent rather than guessing or running a broader suite without
approval.

## ACCEPTANCE CRITERIA

Stage 2A implementation review may pass only when:

- only approved production/test files change;
- Section 4 is renamed and immediately follows transcript;
- Section 4 has separate facts and constraints subsections;
- Section 4 fact envelopes equal primary facts independently;
- all six Chief Architect inference constraints are present;
- active-project fact and limitations are colocated;
- final top-level section is `# Task`;
- current User input is complete and appears once as current Task;
- full transcript, order, labels, N=10, truncation, and normalization remain;
- generic continuity content remains available;
- one Provider call remains;
- no Stage 2B fact/type, Stage 2C behavior, resolver, phrase match, or branch is
  introduced;
- approved deterministic tests/typecheck pass when separately executed;
- source and compiled-output state are reported accurately;
- no memory/session/DB cleanup occurs.

## NON-GOALS

- typed absence-of-evidence facts;
- new external-status or target fact semantics;
- ContextBundle/domain changes;
- transcript deletion, filtering, summarization, or User-only history;
- N=10/400-character policy changes;
- intent/phrase/target resolver;
- second AI call;
- model/provider tuning or selection changes;
- Ollama/Discord/project/language-specific behavior;
- memory reset or clean-session substitution;
- Build, Runtime, Provider, Discord, Live UAT, commit, or push.

## RISKS AND MITIGATIONS

### Excessive clarification

Risk: stronger rules could make ordinary conversation over-clarify.

Mitigation:

- rule applies to unsupported current target/status claims, not all follow-ups;
- retain “interpret naturally using whole conversation” Developer guidance;
- add generic continuity test;
- validate model behavior separately after deterministic review.

### Rule drift between Developer and Section 4

Risk: two policy locations may diverge.

Mitigation:

- keep Section 4 rules as one explicit fixed list in `PromptComposer`;
- tests assert required concepts in both the overall contract and task-adjacent
  boundary;
- avoid broad Developer refactoring in Stage 2A.

### Policy mistaken for fact

Risk: constraints could be serialized as authoritative evidence.

Mitigation:

- facts remain JSON provenance envelopes;
- constraints use a separate policy subsection and plain imperative bullets;
- no new `ContextProvenance` or `EpistemicStatus`.

### Active-project salience remains high

Risk: repeating facts may still foreground project selection.

Mitigation:

- immediately follow facts with both active-project limitations in the same
  section;
- do not repeat project background;
- require semantic Provider validation and contaminated-session UAT later.

### Prompt injection through transcript headings

Risk: transcript text could imitate new subsections.

Mitigation:

- keep JSON single-line serialization;
- retain existing malicious multiline tests;
- static real headings remain outside serialized content.

## ADR-0063 COMPATIBILITY

Stage 2A implements existing ADR-0063 requirements:

- provenance and epistemic status remain separate;
- Task remains current-fact owner;
- ContextBuilder remains history/background owner;
- PromptComposer remains precedence owner;
- current facts stay narrowly bounded;
- active-project selection remains separate from request target;
- transcript remains structured continuity;
- one Provider call remains;
- provider neutrality remains.

No ADR amendment is required because Stage 2A changes prompt strength and
placement, not architecture or fact semantics.

## STAGE 2B ESCALATION CONDITIONS

Stop implementation and return for Architecture Decision if any required change
would:

- add `requested target unknown`, `external status unavailable`, or equivalent
  as a new authoritative fact;
- add/alter provenance or epistemic-status types;
- require PromptComposer to determine whether facts establish a semantic target;
- inspect User/transcript text to detect target/status;
- change `ContextBundle`, Task fact ownership, or memory retrieval;
- delete, filter, summarize, or suppress transcript;
- change N=10 or truncation;
- add a Provider/model/platform/project/language branch;
- add a second Provider call or resolver;
- require Stage 2C provider suitability work.

Deterministic Stage 2A implementation should also stop if the approved boundary
cannot be expressed as static `GENERAL_CHAT` prompt policy while preserving
existing fact envelopes.

Stage 2A deterministic tests passing but the later contaminated Provider/UAT
still failing is not permission to improvise. It triggers separate Stage 2B
architecture review.

## SAFETY

- No repository source, test, config, or compiled output modified.
- No Build, Test, or Typecheck executed.
- No Runtime, Provider, or Discord execution.
- No DB, Session, or Memory mutation.
- Existing contaminated fixture preserved.
- Existing tracked and untracked work preserved.
- Only this approved plan document is added.

## APPROVAL BOUNDARY

Approved and completed by this packet:

- read-only repository inspection;
- Stage 2A implementation planning;
- one Markdown plan document.

Still not approved:

- Stage 2A implementation;
- source/test/config changes;
- ADR amendment;
- Stage 2B/2C;
- Build/Test/Typecheck;
- Runtime/Provider/Discord/Live UAT;
- DB/Memory mutation;
- commit/push/PR/merge;
- cleanup or Gate 6.

## NEXT STEP

Chief Architect should review this implementation plan. If accepted, issue a
separate Stage 2A Implementation approval naming the exact production/test files
and an independent Test approval when validation is intended.

STAGE_2A_PLAN_READY
