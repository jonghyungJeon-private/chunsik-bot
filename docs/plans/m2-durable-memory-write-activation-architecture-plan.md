# M2 Durable Memory Write Activation Architecture Proposal

Status: **PROPOSED — HUMAN RATIFICATION REQUIRED**. This document narrows the runtime activation of the
ADR-0073 durable-memory write contract. It does not authorize or implement the production write path. Product
Owner and independent Chief Architect ratification are required before the implementation slice below begins.

## Existing contract assessment

Repository code is authoritative where earlier task wording differs. `MemoryWriter` currently exposes
`createCandidate(input)`, `promote(candidate)`, and exact-scope `forget(request)`; it has no `write` method and no
candidate collection. `DefaultMemoryWriter` owns candidate revalidation, secret/size checks, normalized duplicate
handling, exact-scope supersession, exact-scope forgetting, lifecycle metadata, and persistence-failure
classification. Its narrowed `DurableMemoryPersistence` dependency is implemented by the existing `MemoryManager`
methods `durableMemory`, `durableMemories`, `saveDurable`, and `forgetDurable`.

`MemoryManager` remains the system of record and continues to reach the canonical `MemoryRepository` through its
existing `StorageProvider`. `DefaultMemoryWriter` adds application policy over that owner; it is not a repository,
adapter, or second source of truth. `MemoryCandidate` is transient and always created as `PENDING`. A promoted
`DurableMemory` is always `MemoryType.LONG_TERM`, with lifecycle timestamps and identity created by the writer.

`ConversationRuntime.handle` owns the inbound turn and returns one transient `TurnResult`. `handleInner` already
resolves the Actor and Session, records the inbound `SHORT_TERM` entry, gives pending approval/clarification/apply
state precedence, classifies an otherwise unclaimed message, and records Assistant and TOOL surfaces. Its optional
`runtimeProviderRouting` collaborator demonstrates application-collaborator injection, but no existing surface
consumes `MemoryWriter`. Assistant replies, provider output, TOOL output, `recordShortTerm`, and `recordAssistant`
are therefore not durable-memory candidates today.

## Proposed decision

### 1. Ownership and dependency direction

`MemoryWriter` remains the sole durable promotion/forgetting policy owner. `MemoryManager` and its existing
repository remain the persistence owner. `ConversationRuntime` owns only deterministic activation: recognizing a
supported explicit command, assembling caller-known candidate input, invoking the writer once, and mapping the
decision to a response.

The dependency remains inward and storage-neutral:

```text
apps/chunsik composition root
  -> ConversationRuntime (Core Application orchestration)
       -> MemoryWriter (Core Application policy)
            -> MemoryManager narrowed persistence surface
                 -> MemoryRepository through StorageProvider
```

No Core type gains a concrete storage, SQLite, Discord, CLI, Provider, or adapter dependency. No new port, DI
token, repository, schema, index, vector product, or persistence owner is introduced.

### 2. Runtime dependency decision

Add a **required** `memoryWriter: Pick<MemoryWriter, 'createCandidate' | 'promote'>` collaborator to
`ConversationRuntimeDeps`. Do not add a surrounding orchestration service: it would duplicate facts and turn
precedence already owned by `ConversationRuntime` and would make completion semantics harder to observe. Do not
make the collaborator optional: an optional binding could recognize a memory command without a reliable consumer
or silently disable the feature.

The composition root must construct one `DefaultMemoryWriter` over the same `MemoryManager` instance already
supplied as `memory` and pass it to the runtime in the same implementation slice that adds the consumer. A binding
without the runtime consumer is prohibited.

### 3. Exact activation point

The first slice supports only an explicit save command. In `handleInner`, attempt this deterministic route **after**
all existing pending approval, clarification, apply, commit, push, PR, merge, and cleanup interceptors have had
precedence, and **immediately before** the ordinary `classifier.classify(message)` call. This prevents a memory
phrase from bypassing an active governance workflow and prevents a Provider/classifier result from controlling the
write.

The recognizer accepts only a whole-message, colon-delimited command (surrounding whitespace allowed):

- `기억해: <payload>`
- `기억해줘: <payload>`
- `remember: <payload>` (ASCII case-insensitive)

The prefix must begin the trimmed message, the colon is mandatory, and the trimmed payload must be non-empty.
Negated, quoted, embedded, conversational, or merely similar text is not a command. Unsupported text falls through
unchanged to the existing classifier. Forgetting is not part of this slice: `MemoryWriter.forget` requires an exact
memory id and exact scope, and no ratified conversation contract yet resolves those safely.

### 4. Exact candidate source and input

For a recognized command, the candidate is derived only from the authenticated inbound turn and already-resolved
Actor:

```ts
{
  content: trimmedPayload,
  sourceContent: message.text,
  trigger: 'EXPLICIT_USER_INSTRUCTION',
  kind: 'SEMANTIC',
  provenance: 'USER_PROVIDED',
  authorityLevel: 'USER_CLAIM_OR_INTENT',
  scope: { actorId: actor.id },
  metadata: { sourceReferences: [userMemory.id] }
}
```

`userMemory.id` is the id returned by the existing `recordShortTerm` call for this exact inbound message. The
source is never the Assistant reply, Provider output, `TurnResult.reply`, TOOL record, accumulated transcript,
ContextBundle, or model-generated summary. Actor-only scope is intentional for this first, user-preference-shaped
slice. Session-, project-, episodic-, system-importance-, periodic-consolidation-, supersession-, and forget-command
activation require later bounded decisions; they must not be inferred in this slice.

### 5. Turn-outcome semantics

The activation route calls `createCandidate` and then `promote` exactly once before composing its terminal
`TurnResult`:

| Turn or writer outcome | Durable write behavior | Runtime result |
|---|---|---|
| Explicit command + `PROMOTED` or `SUPERSEDING` | Writer persistence is accepted | `RESPONDED`, with a deterministic saved acknowledgement |
| Explicit command + `DUPLICATE` | No new write | `RESPONDED`, explicitly already remembered |
| Explicit command + `REJECTED` | No write | `RESPONDED`, explicitly not saved and without exposing sensitive candidate text |
| Explicit command + thrown validation/persistence error | No retry or alternate persistence path | `FAILED`, sanitized memory-unavailable response |
| Ordinary successful chat/work/execution turn | No durable candidate and no promotion | Existing result unchanged |
| Failed, denied, cancelled, or awaiting-approval turn | No durable candidate and no promotion | Existing result unchanged |
| Project-analysis or other TOOL output | Existing `TOOL` recording may occur; no durable promotion | Existing result unchanged |

Thus “successful turn” is not itself a promotion trigger. Only the explicit command route can write in this slice.
The acknowledgement is recorded through the existing `recordAssistant` path after the writer decision. A failed
durable write must never be acknowledged as saved.

### 6. Lifecycle and promotion semantics

The activation route must use `memoryWriter.createCandidate` followed by `memoryWriter.promote`; it may not create a
persisted record or call `MemoryManager.saveDurable` directly. Existing writer decisions remain canonical:

- normalized same-scope/same-provenance content is idempotent and returns `DUPLICATE`;
- a changed version can return `SUPERSEDING` only when an already supplied `supersedesMemoryId` passes the existing
  exact-scope/provenance checks (the first activation slice never supplies that field);
- accepted candidates become attributable `LONG_TERM` records through `MemoryManager`;
- writer-owned identity, timestamps, `expiresAt`, and `supersededBy` are never caller-owned;
- exact forgetting stays exclusively behind `MemoryWriter.forget` and is not activated here.

No retention default is invented. The first slice creates no expiry or supersession metadata.

### 7. Failure degradation

Writer failure is isolated to the explicit memory command. The inbound `SHORT_TERM` record already created for the
turn remains ordinary transcript; it is neither rolled back nor promoted through another path. The runtime catches
the activation failure locally, logs only bounded identifiers/error classification (never candidate/source text),
does not retry, does not call a Provider, and returns a sanitized `FAILED` reply stating that durable save could not
be confirmed. Existing unrelated turn behavior and existing TOOL/SHORT_TERM persistence remain unchanged.

`REJECTED` and `DUPLICATE` are policy decisions, not infrastructure exceptions. They receive deterministic
non-secret responses and do not fall through to chat generation. No error path broadens scope, downgrades
authority, or writes through the repository directly.

### 8. Forged lifecycle metadata rejection

The runtime constructs metadata from a fixed allow-list containing only `sourceReferences`; user text is never
parsed as metadata and no cast or object spread from caller data is allowed. `DefaultMemoryWriter.promote` remains
the enforcement boundary: it reconstructs/revalidates the candidate, requires `validationState === 'PENDING'`, and
rejects candidate metadata containing writer-owned `expiresAt` or `supersededBy` before any persistence lookup or
write. Existing forged-metadata tests remain mandatory and runtime tests must additionally prove that command text
resembling metadata cannot populate metadata fields.

### 9. No automatic transcript promotion

The route is an anchored, colon-delimited explicit command, not a post-turn hook over every `TurnResult`. Ordinary
`SHORT_TERM` User/Assistant records, successful responses, repeated statements, Provider output, TOOL output, and
ContextBuilder results never call `MemoryWriter`. `sourceReferences` preserves attribution to the transcript entry
without copying or converting the transcript collection. No embedding, similarity, LLM extraction, provider id, or
periodic scan participates in candidate creation.

### 10. Smallest subsequent implementation slice

After ratification, one bounded implementation should:

1. add the required narrowed `memoryWriter` dependency and private exact recognizer/handler to
   `conversation-runtime.ts` at the activation point above;
2. add memory-result response methods to the existing `ResponseComposer` contract/default implementation, keeping
   all user-facing text out of the runtime;
3. add focused runtime tests for the three exact prefixes, empty/embedded/negated near-misses, pending-flow
   precedence, exact candidate projection, all writer outcomes, persistence failure, no Provider/classifier call on
   a recognized command, no write on ordinary successful/failed/tool/cancelled turns, and metadata non-forging;
4. construct `DefaultMemoryWriter` with the existing `MemoryManager` and pass it to the actual
   `ConversationRuntime` consumer in `apps/chunsik/src/app.module.ts`;
5. update affected test fixtures, run focused tests and `pnpm typecheck`, and request independent architecture and
   implementation review before merge.

That slice must not add a new `IntentType`, change `MemoryType`, add schema/index/vector work, add semantic
retrieval, add provider/LLM extraction, activate project/session/system/consolidation promotion, implement forget or
supersession commands, or modify reviewer dispatch/control-plane code.

## Ratification request

Product Owner and independent Chief Architect are asked to ratify or reject these concrete decisions as one bounded
set: direct required `ConversationRuntimeDeps.memoryWriter` ownership; post-pending-flow/pre-classifier activation;
the exact three-prefix grammar; actor-scoped User-provided semantic candidate projection; explicit-command-only
turn semantics; existing writer lifecycle and forged-metadata enforcement; local failure degradation; and the
single consumer-plus-composition implementation slice above. Source implementation remains blocked until that
ratification is recorded canonically.
