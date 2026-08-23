# M2 Long-term and Agentic Memory Architecture Proposal

Status: **PROPOSED / ARCHITECTURE REVIEW REQUIRED**. This document is the first-deliverable architecture
assessment requested for M2. It makes no ratified architecture decision, selects no vector-storage product, and
authorizes no implementation, dependency, schema, migration, runtime, provider, network, or data mutation.

## Decision summary

Long-term memory should augment the existing short-term memory, `ContextBuilder`, `PromptComposer`, and canonical
repositories through four distinct tiers:

1. Working Memory is the bounded, per-run view assembled from the current `Task` and `ContextBundle`.
2. Episodic Memory is durable, attributable history about events and interactions selected for later recall.
3. Semantic Long-Term Memory is durable, attributable knowledge such as preferences and stable learned facts.
4. Canonical Structured State is authoritative application state owned by its existing aggregate repositories.

The first three tiers may contribute provider-facing context. Canonical Structured State never becomes a vector
similarity corpus and is never replaced, updated, or resolved by similarity search. Where a current Task needs a
canonical fact, the owning application service performs an exact repository lookup and `PromptComposer` presents
the resulting current-turn fact under ADR-0063. Memory retrieval supplies bounded background and continuity only.

This proposal preserves the fixed `MemoryType` values in `ARCHITECTURE.md`. The four tiers are responsibility and
retrieval tiers, not a replacement enum. A later ratified design may map durable entries to existing `LONG_TERM`,
`PROJECT`, and `TOOL` records with explicit metadata, but must not change the enum or persistence contract without
an amending ADR.

## Repository assessment

The classifications describe behavior present at the current repository HEAD, not names or reserved seams alone.

| Capability | Classification | Evidence and boundary |
|---|---|---|
| `SHORT_TERM` memory | **ALREADY_COMPLETE** | `MemoryManager` persists User and Assistant turns, scopes them to Session (or channel/thread fallback), preserves role metadata, caps each Session at 30 records, and retrieves a newest bounded window. ADR-0017 remains the controlling policy. |
| `ContextBuilder` ranking, compression, and budgeting | **ALREADY_COMPLETE** | The optional M2 path has deterministic relevance/recency selection, role weights, character or approximate-token budgets, active-project-first allocation, bounded tail compression, chronological output, and preserved ADR-0063 labels. With no configuration it preserves flat N=10 ADR-0017 behavior. This proposal does not duplicate or replace that pipeline. |
| `PromptComposer` provenance and authority rendering | **ALREADY_COMPLETE** | It renders Task-owned current facts separately from non-authoritative project background and structured User/Assistant transcript, preserving provenance and epistemic status under ADR-0063. |
| `VectorProvider` port | **PARTIALLY_COMPLETE** | The provider-neutral `init/upsert/query/delete` port and DI token exist, and embedding generation is correctly separate. `LocalVectorProvider` is a skeleton whose mutation/query operations throw `NotImplementedError`; no durable-memory index lifecycle or recall integration exists. |
| `MemoryManager` CRUD/scope | **PARTIALLY_COMPLETE** | It implements bounded short-term writes/reads/pruning plus PROJECT and TOOL writes and latest PROJECT lookup over `MemoryRepository`. It has no durable promotion/update/supersession policy, generic long-term writer, hybrid retriever, vector-index synchronization, durable-memory deletion workflow, or retention policy. Its legacy `buildContextFiles` renderer must not become a second retrieval pipeline. |
| `PROJECT` memory | **PARTIALLY_COMPLETE** | Project summaries are persisted and exactly retrieved for the active `Task.projectId`, then included by `ContextBuilder` as non-authoritative background. There is no retention, version/supersession model, deduplication, or cross-project semantic recall. Exact active-project lookup must remain preferred over similarity. |
| `TOOL` memory | **PARTIALLY_COMPLETE** | Project-analysis output is persisted with project/session scope, but `ContextBuilder` does not retrieve it and no durable promotion, authority, deduplication, or retention contract exists. Persisting a tool output does not make its content authoritative. |
| `WORKING` memory type behavior | **MISSING** | The enum value exists, but the intended working-memory responsibility is currently represented by transient `Task` plus rebuilt `ContextBundle`; there is no separate persisted WORKING-memory lifecycle. Persisting Session context snapshots remains forbidden and is not required. |
| `LONG_TERM` memory behavior | **MISSING** | The enum and legacy context-file heading exist, but no write/promotion, retrieval, authority, indexing, forgetting, or ContextBuilder integration is implemented. |
| A vector product decision | **NOT_APPLICABLE** | Product selection is deliberately outside this proposal. Options are evaluated below only against the storage-neutral boundary. |

## MEMORY_TIERS

### Tier 1: Working Memory

Working Memory is the transient, bounded information required for one run. Its authoritative current-turn portion
is the `Task`; its continuity/background portion is the `ContextBundle` rebuilt by the existing `ContextBuilder`.
It includes current Task facts, the selected recent transcript, exact active-project background, and later a bounded
set of recalled durable memories. It is discarded after the run and must not be snapshotted onto `Session`.

The existing `MemoryType.WORKING` name does not require persisted working-memory records. If it is ever used, it
must have an explicit short lifecycle and must not create a parallel source of current Task truth.

`immediatelyPreviousUserTurn` is a deterministically derived Working-Memory projection over exact `SHORT_TERM`
transcript entries for the current conversation/session scope; it is not Canonical Structured State or Tier 4 owned
state. It MUST be derived only from exact `SHORT_TERM` transcript entries belonging to that current scope. It MUST
NOT be satisfied by episodic, semantic, project, cross-session, or any other durable-memory retrieval, and it remains
non-vector-retrievable. Retrieval similarity MUST NOT influence which entry is treated as
`immediatelyPreviousUserTurn`.

### Tier 2: Episodic Memory

Episodic Memory records attributable events: what the User asked, what operation occurred, what outcome was
observed, and when. It is not the ordinary transcript. A durable episode is a bounded summary or structured event
reference promoted because later recall has expected value. It retains source references, scope, time, provenance,
and epistemic status. Assistant or tool summaries remain non-authoritative unless separately grounded in canonical
evidence; even then, the canonical repository remains the source of the fact.

### Tier 3: Semantic Long-Term Memory

Semantic Long-Term Memory records stable, reusable knowledge such as an explicitly saved User preference, a
project convention, or a durable concept derived from one or more episodes. Each entry carries provenance,
authority, scope, confidence/epistemic status, and source references. Contradictory or newer entries supersede rather
than silently rewrite history. Model-generated synthesis is a proposal for memory, never an authority escalation.

### Tier 4: Canonical Structured State

Canonical Structured State consists of existing domain aggregates and repositories, including `Session`, `Task`,
`TaskRun`, `Project`, `ApprovalRequest`, `PatchSet`, `WorkspaceChange`, `CommandExecution`, and their lifecycle
rules. Reads are exact, typed, and owned by the relevant application service. Retention follows each aggregate's
own governance and audit contract, not memory relevance or vector-store policy.

**Hard boundary:** vector similarity may locate a non-authoritative memory that refers to a canonical entity id. It
may not establish that entity's current state, choose among conflicting canonical records, mutate the entity, or
serve as a substitute for an exact repository lookup. Canonical Structured State is explicitly not replaced by
vector similarity retrieval.

The following are Canonical Structured State examples and are **NEVER vector-retrievable**: `activeProjectId`,
approvals, milestone/task state, ratified ADR state, and execution state. Each MUST remain deterministic and MUST be
read through its existing exact, typed ownership path; each MUST NOT be served through vector similarity retrieval,
even when a durable memory refers to the same entity or event.

## MEMORY_WRITE_POLICY

### Ordinary transcript versus durable memory

The existing ADR-0017 flow continues to write inbound and outbound turns as `SHORT_TERM`. Ordinary greetings,
repetition, transient status, speculative Assistant text, provider output, and full tool output do not become
durable memory merely because they occurred or were persisted as transcript.

The default promotion model is **NOT embed-every-message**. Ordinary transcript remains ordinary transcript unless
it meets a defined promotion criterion. The only promotion trigger categories, and the bounded triggers mapped to
each category, are:

- **Explicit User instruction:** a User instruction to remember or forget something, or project knowledge the User
  explicitly saves under project scope without replacing the `Project` aggregate.
- **System-detected importance under a ratified deterministic policy:** a deterministic, verified application event
  whose owning policy declares it recall-worthy, or a stable User preference repeated or confirmed under a ratified
  promotion rule.
- **Periodic consolidation under a ratified, bounded policy:** a bounded summary of completed episodes proposed for
  promotion, with source record ids retained.

A trigger creates a durable-memory candidate only; it does not bypass the validation and authority rules below.

Promotion is two-stage: candidate extraction followed by policy validation. Candidate extraction may eventually use
an AI capability, but the `MemoryWriter` validates allowed type, scope, size, provenance, authority, source
references, duplication, and retention class before durable persistence. Provider output cannot write directly to
`MemoryRepository` or `VectorProvider`.

### Promotion invariants

- Never promote a secret, credential, authentication material, or content forbidden by the applicable resource
  policy.
- Never store provider id as memory meaning or branch promotion policy on provider id.
- Never upgrade `USER_CLAIM_OR_INTENT`, `ASSISTANT_NON_AUTHORITATIVE`, or non-authoritative background to an
  authoritative current fact solely through repetition, summarization, embedding similarity, or persistence.
- Store a bounded normalized statement plus provenance and source references, not an unbounded transcript copy.
- Exact duplicates are idempotent. Meaningfully changed knowledge creates a new version linked by `supersedes`;
  it does not erase audit history unless an explicit forgetting policy requires deletion.
- A memory write and its derived vector index update have one application-level outcome: the durable record is the
  source of truth, while a failed index update leaves an observable, repairable out-of-sync state rather than
  rolling truth into the vector store.

## Scope model

Scope is a filter and authority boundary before it is a ranking signal. The conceptual scopes are:

| Scope | Meaning | Interaction |
|---|---|---|
| conversation | The current platform conversation, represented today by channel/thread when no Session is available. | Narrowest continuity fallback; never permits unrelated conversation recall. |
| session | The application conversation lifecycle identified by `sessionId`. | Preferred transcript/episode boundary. A Session-scoped entry is not automatically visible in another Session. |
| project | Knowledge applicable to one `projectId`. | Eligible only when the current Task has that exact project, unless a later explicit cross-project request authorizes broader retrieval. Exact PROJECT summary lookup remains separate and first. |
| user | Durable preferences or knowledge attributable to one User identity. | May cross Sessions for that User, but is not shared with another User and does not override current Task facts or project-local rules. |

Retrieval computes the eligible union intentionally, never by an unscoped repository scan. For a normal Task that
union is: exact conversation/session entries, exact project entries when `Task.projectId` exists, and exact user
entries. An entry carrying multiple scope keys must satisfy all populated keys. Narrower scope wins ties; a current
session/project entry normally outranks a user-global entry. Conflicts are retained and labeled rather than merged
across scopes. Project-local knowledge overrides a conflicting user-global preference only for that project and
only as background, not as a canonical current fact.

The existing `MemoryScope` can express session, project, user, channel, and thread constraints. Whether a separate
conversation identifier or richer scope-policy type is necessary is an implementation-design question for the
ratifying ADR; it must not be inferred by overloading a platform-specific id into a new Core contract.

## RETRIEVAL_MODEL

Retrieval is a bounded pipeline owned by the application layer and feeding the existing `ContextBuilder`:

1. Derive allowed exact scopes from the current `Task` and authenticated identity context.
2. Retrieve exact active-project background through the existing `projectMemory(task.projectId)` path.
3. Fetch a bounded lexical/metadata candidate set from the durable `MemoryRepository`.
4. When embeddings are available, query `VectorProvider` for a bounded semantic candidate set and resolve returned
   ids back to authoritative `MemoryRecord` values.
5. Reject missing, expired, tombstoned, wrong-scope, wrong-owner, disallowed-type, and provenance-incomplete records.
6. Merge by memory id, exact-deduplicate by normalized content hash, near-deduplicate, then hybrid-rank.
7. Return a bounded, structured recall set to `ContextBuilder`, which performs the existing final selection,
   compression, chronological handling where applicable, and character/token budgeting.

For each eligible candidate, use a normalized, explainable score:

```text
score =
  w_semantic  * semanticRelevance
+ w_recency   * recency
+ w_importance* importance
+ w_scope     * scopeMatch
+ w_authority * authorityFit
- w_redundancy* redundancy
```

All component values are bounded to `[0, 1]`; weights are finite, non-negative configuration and need not be chosen
in this proposal. Stable tie-breaks are narrower scope, newer relevant source, then memory id. `authorityFit` means
fitness for the requested use, not a claim that content is externally true. For example, an explicit User
preference can have strong authority for recalling that preference while remaining a User-provided claim. Current
Core facts bypass this ranking and retain precedence under ADR-0063.

Semantic relevance may combine embedding similarity with the existing deterministic keyword-overlap signal. If an
embedding generator or vector adapter is unavailable, retrieval degrades to bounded lexical/metadata scoring; it
must not fail the entire Task or silently broaden scope.

### Bounded retrieval and deduplication contract

Every implementation must configure and test finite limits for repository candidates per scope, vector `topK`,
merged candidates, returned memories, per-memory characters, total recall characters/tokens, and retrieval time.
No method permits an unbounded `list()` or whole-history scan on the Task path.

Exact duplicates use an application-owned normalized-content hash plus compatible scope and provenance. Near
duplicates use a configured similarity threshold and maximal-marginal-relevance-style redundancy penalty. A group
retains the entry with the best authority fit, scope specificity, and freshness while preserving source references
to the grouped records. Deduplication affects prompt inclusion, not durable audit deletion. Entries that conflict in
meaning are not duplicates and must remain separately attributable.

The retriever returns score components and selection reasons for deterministic tests and audit, but these details
are application metadata and are not exposed to the User by default.

## AUTHORITY_MODEL

ADR-0063 remains controlling. Every recalled entry must keep source provenance separate from epistemic status.
Persistence proves that a record exists and where it came from; it does not prove the truth of its content.

The durable representation therefore needs, conceptually:

- stable memory id, tier/kind, content, scopes, created/updated time, and retention class;
- provenance identifying User, Assistant, Core Runtime, Project Memory, Tool/Connector result, or legacy unknown;
- epistemic status compatible with ADR-0063, plus any future status only through a ratified extension;
- source record/entity references and observation time;
- importance and optional confidence values with their derivation, never provider identity as authority;
- version/supersession links, normalized-content hash, and optional derived vector id/index version.

Prompt-facing mapping stays conservative:

- Task-derived verified facts remain `CORE_RUNTIME / AUTHORITATIVE_CURRENT_FACT` and bypass memory ranking.
- Explicit User preferences/claims remain User-provided claim or intent input.
- Assistant-derived episodes or semantic summaries remain Assistant-generated non-authoritative content.
- PROJECT, TOOL, CONNECTOR, and recalled long-term material render as attributable non-authoritative background
  unless a separate exact canonical lookup establishes a current fact.
- Legacy or malformed authority metadata fails closed as non-authoritative background/transcript and receives no
  authority boost.

Contradictions are resolved by current authoritative Task facts first, then exact canonical reads, then explicit
supersession within the same scope, then narrower scope and recency. Similarity score never overrides these rules.

## STORAGE_BOUNDARY

Persistence ownership is separated into three non-overlapping responsibilities: structured memory metadata,
embeddings/vector representation, and canonical state persistence.

1. **Structured memory metadata** is owned by the StorageProvider memory repository (`MemoryRepository`), including
   durable memory content, provenance, scope, lifecycle, and retention state.
2. **Embeddings/vector representation** is owned by the replaceable `VectorProvider` adapter as a derived,
   rebuildable index that maps results back to memory ids.
3. **Canonical state persistence** remains owned by the existing `Session`, `Task`, `Project`, and `Approval`
   repositories (and the other existing typed aggregate repositories).

The vector store NEVER owns unrelated canonical state. This separation does not authorize a new persistence
technology or move an existing aggregate across repository boundaries.

`MemoryRepository` remains the durable source of truth for memory content, provenance, scope, lifecycle, and
retention state. Infrastructure-specific query optimization can be added through narrow Core ports or specialized
repository methods only after ratification; Core must not express SQL, SQLite extensions, pgvector operators,
vendor filters, or vector-database types.

`VectorProvider` remains a replaceable derived-index port. It stores vectors and bounded metadata needed to map
results back to memory ids. It does not own memory content, scope authorization, provenance, retention, authority,
embedding generation, or canonical state. The index is rebuildable from durable memory plus the configured
embedding capability. Delete/forget operations delete or tombstone the durable record first under policy, then
remove derived vectors; stale vector hits are rejected when the record cannot be resolved.

Embedding generation remains an `AiProvider` capability as required by `ARCHITECTURE.md`. Embedding inputs must be
bounded and policy-filtered. Model identity and embedding/index version may be operational metadata needed for
rebuild compatibility, but provider id never becomes semantic authority or a Core branch.

Canonical Structured State stays in the existing typed repositories and is never copied wholesale into vector
storage. A memory may retain an opaque domain id reference; the owning service must resolve it exactly when current
state matters.

## Conceptual application contracts

The names below express responsibility only. They are not approved public APIs and must not be added until an ADR
ratifies exact domain shapes.

```ts
interface MemoryRetriever {
  retrieve(request: MemoryRetrievalRequest): Promise<MemoryRecallSet>;
}

interface MemoryWriter {
  propose(candidate: MemoryWriteCandidate): Promise<MemoryWriteDecision>;
  forget(request: MemoryForgetRequest): Promise<MemoryForgetResult>;
}
```

`MemoryRetrievalRequest` carries the current Task-derived query, allowed scope set, allowed tiers/kinds, and hard
candidate/output budgets. `MemoryRecallSet` contains structured recalled entries, score components, provenance,
epistemic status, and source references. It contains no storage-driver or vector-vendor type.

`MemoryWriteCandidate` carries bounded content, proposed tier/kind, scope, provenance/status, sources, importance,
and retention class. `MemoryWriteDecision` records accepted, duplicate, rejected, or superseding outcomes with a
policy reason. `MemoryWriter` is the sole durable promotion/forgetting policy owner; it composes storage and the
derived index rather than letting adapters or Providers write memory directly.

These contracts belong in Core Application/ports only if implementation proves an external implementation
boundary is needed. `MemoryManager` remains the CRUD/scope system-of-record service. The ratifying ADR must decide
whether it implements these responsibilities or collaborates with narrow services, avoiding a god-interface and a
second context builder.

## CONTEXTBUILDER_INTEGRATION

Integration augments the existing sequence:

```text
Task
  -> exact SHORT_TERM and active PROJECT retrieval (existing)
  -> MemoryRetriever durable recall (new, bounded, optional)
  -> ContextBuilder final rank/select/compress/budget (existing owner)
  -> ContextBundle with structured provenance and epistemic status
  -> PromptComposer ADR-0063 layering (existing)
  -> provider-neutral PromptSpec
```

`MemoryRetriever` performs candidate discovery, scope enforcement, durable-memory hybrid scoring, and recall-level
deduplication. `ContextBuilder` remains the single owner of final per-run context assembly and token/character
budgeting. It allocates explicit sub-budgets among current conversation, exact active-project background, and
durable recall; it must preserve the newest continuity turns required by the existing contract. Durable recall may
not starve current Task facts, required recent turns, or exact active-project background.

Recalled durable memories MUST NOT be inserted into `conversationTranscript`; durable memories enter
`ContextBundle` only through the separately defined recall/background representation. `SHORT_TERM` transcript
entries remain exact conversation-continuity data. Semantic similarity or near-deduplication MUST NOT remove or
replace an exact `SHORT_TERM` transcript entry because it resembles a durable-memory entry. When a durable-memory
candidate duplicates or paraphrases an exact transcript entry, deduplication may suppress the durable candidate,
never the exact transcript entry.

The explicit integration ownership chain is: `MemoryRetriever` retrieves candidates -> those candidates merge with
existing `ContextBuilder`-owned entries -> `ContextBuilder` performs unified ranking -> dedupe -> token budgeting ->
provider-facing context. `ContextBuilder` remains the single final-budget owner across both existing entries and
durable recall; `MemoryRetriever`, `PromptComposer`, and provider adapters may not establish a competing final
budget.

`ContextBundle` will need a ratified structured representation for recalled episodic/semantic entries because its
current `backgroundResources` type admits only `PROJECT_MEMORY`. Extending that public Core domain contract is an
architecture change and requires Chief Architect review and Product Owner ratification before implementation.
PromptComposer then renders recalled entries as a distinct, explicitly non-authoritative durable-memory section or
an equivalent structured background section. Provider-specific rendering remains in adapters, and stateless CLI
context-file materialization remains a workspace concern.

The legacy `MemoryManager.buildContextFiles` method must not be expanded into long-term retrieval. It predates the
separated `ContextBuilder` responsibility and would create a competing pipeline.

## RETENTION_POLICY

Retention is tier- and scope-specific, explicit, and deterministic:

- Working Memory: discard at run completion; never persist a Session context snapshot.
- `SHORT_TERM`: preserve ADR-0017's maximum 30 records per Session and current N=10 retrieval. Any TTL or byte cap is
  a future ratified change, not silently introduced here.
- Episodic Memory: apply configurable age, count/bytes per scope, importance, last-access, and supersession rules.
  Low-importance stale episodes expire before explicitly pinned or referenced episodes.
- Semantic Long-Term Memory: no default immortality. Revalidate or expire time-sensitive entries; retain explicit
  stable preferences until superseded, forgotten, or their configured retention class expires.
- PROJECT/TOOL/CONNECTOR memory: retain by owning project/resource policy. Deactivation or deletion of an owning
  entity makes entries ineligible immediately; physical cleanup follows the approved lifecycle.
- Canonical Structured State: governed only by its aggregate/audit retention rules, never by memory decay.

Explicit User forget requests require exact authenticated scope resolution and a previewable, auditable policy.
They may delete/tombstone eligible memories and derived vectors, but may not erase canonical audit records whose
governance requires retention. Scope-wide, non-disposable, or irreversible deletion remains a separate approval and
data-safety boundary.

Retention jobs are bounded by record count/time and idempotent. They never call a Provider. Index cleanup is
derivative and retryable. Expired/tombstoned records are filtered before ranking even if a stale vector hit remains.

## VECTOR_ADAPTER_OPTIONS

No option is selected. A later adapter decision should use measured corpus size, local-first operation, dependency
cost, backup/rebuild behavior, metadata-filter capability, operational complexity, Team Edition needs, and privacy.

| Option | Advantages | Costs and risks | Boundary fit |
|---|---|---|---|
| SQLite-compatible/local vector storage | Strong local-first fit; can align backup/location with existing local data; low operational burden. | Extension availability and portability vary; schema/migration and native-extension packaging may be complex; must not leak SQLite/vector-extension types into Core. | Valid as a dedicated adapter behind `VectorProvider`; product/extension selection remains open. |
| Application-side embedding similarity | Simplest dependency model for a small bounded corpus; deterministic cosine similarity can be fake-tested; index can be a local rebuildable file or records. | O(n) scans, memory use, concurrency, crash consistency, and rebuild time limit scale; requires strict candidate bounds and versioning. | Valid for a small local adapter if all storage and math stay outside Core and no unbounded Runtime scan occurs. |
| PostgreSQL with pgvector | Mature relational metadata filtering and transactional coordination; plausible Team Edition evolution. | Adds a server and operational burden that conflict with the simplest personal/local deployment; coupling memory and index transactions needs design. | Valid future adapter; no Postgres or pgvector type/operator may cross the port. |
| Dedicated vector database | Purpose-built approximate-nearest-neighbor indexing, filtering, and scale. | Highest operational/dependency/privacy burden; backup, availability, version compatibility, and local-first packaging require evidence. | Valid future adapter only if it implements the same bounded port and remains a rebuildable derived index. |

The current `LocalVectorProvider` skeleton does not imply selection of SQLite, an application-side index, pgvector,
Qdrant, or any other product. Its comments are illustrative, not a ratified product decision.

## Proposed delivery sequence after ratification

1. Ratify the tier, write/promotion, scope, authority, retention, and ContextBundle extension contracts in an ADR.
2. Add pure domain/application policy tests for eligibility, hybrid score components, deduplication, supersession,
   bounded output, and fail-closed authority mapping. No adapter or schema change in this slice.
3. Implement storage-neutral `MemoryRetriever`/`MemoryWriter` responsibilities over fakes and integrate an optional,
   default-off durable recall input into the existing `ContextBuilder` budget.
4. Select one vector adapter only through a separate evidence-based decision. Implement it with fake embedding
   generation and no Runtime/network activation.
5. Add persistence/index lifecycle and bounded retention only after any required schema/migration ADR and local/dev
   DB authorization checks.
6. Consider Runtime activation and UAT as separate Strict approval boundaries.

Each slice must preserve legacy flat short-term behavior when durable recall is absent or disabled. Autonomous
agent loops remain out of scope under `ARCHITECTURE.md`; “agentic memory” here means memory suitable for a future
agent profile/runtime, not authorization to build that runtime.

## Non-goals and approval boundary

This proposal does not:

- select a vector database, embedding model, or provider;
- implement vector search, embedding generation, memory promotion, forgetting, schema, migration, or code;
- replace `SHORT_TERM`, `ContextBuilder`, `PromptComposer`, canonical repositories, or exact project lookup;
- make transcript, Assistant output, TOOL output, PROJECT memory, or similarity results authoritative current facts;
- persist Working Memory or any context/memory snapshot on `Session`;
- add an autonomous loop, workflow engine, dynamic plugin loader, or provider-specific Core behavior;
- authorize DB access/mutation, Runtime, application Provider/network execution, Discord, secrets, Live UAT, push,
  PR, or merge.

The next step is exactly one independent Chief Architect architecture review. Product Owner ratification is required
before any public contract, persistence, adapter selection, or implementation task is issued.
