# Personal Work Surface

M3A-1 exposes one read-only answer to “Show me what I need to work on.” It is a rebuildable, non-authoritative
application projection under ADR-0074, not a work database or workflow.

## Contract

- `ResourceRef { source, externalId }` is the stable value identity of an external input. It is not an Aggregate,
  connector payload, cache record, or output Artifact.
- `WorkSurfaceQuery.forActor(actor)` resolves only explicit `Actor.identities` entries for `jira` and `github`.
  It never fabricates, infers, or auto-links an identity.
- Jira and GitHub are queried through read-only `ConnectorProvider` implementations using the semantic
  `personal-work` query. Connector protocol rendering remains inside each adapter.
- Items are normalized to `ResourceRef`-backed application DTOs and stably sorted by source, title, and external id.
- Each source reports `AVAILABLE`, `IDENTITY_MISSING`, `NOT_CONFIGURED`, or `UNAVAILABLE`. A one-source result is
  explicitly `PARTIAL`; an unavailable source can never be silently rendered as “you have no work.”

## Live Identity Reachability

M3A-1 supplies no Actor Jira/GitHub identity-provisioning path. `ActorManager.resolveFromContext` seeds only the
inbound platform identity, while `ActorRepository` exposes no Jira/GitHub identity writer. Therefore, in the live
product both sources resolve `IDENTITY_MISSING` and the Work Surface is `UNAVAILABLE`; the merged, Jira-only, and
GitHub-only behavior in this slice is exercised through injected identities and fakes.

A separate approved slice must supply an Actor Jira/GitHub identity-linking path before the live Work Surface can
become `AVAILABLE`. This is an explicit Chief Architect / Product Owner M3 sequencing need. Adding identity write
behavior here would violate M3A-1's read-only/no-write boundary.

## Boundaries

The surface persists nothing and introduces no `WorkItem`, repository, table, migration, lifecycle, connector
write, MCP/tool seam, agent, handoff, trigger, scheduler, receipt, ledger, graph, Workflow, or event sourcing.
GitHub pull-request lifecycle and writes remain exclusively on `RepositoryHostingProvider`. Conversation Runtime
only recognizes the bounded intent, invokes `WorkSurfaceQuery`, and hands the result to `ResponseComposer`.
