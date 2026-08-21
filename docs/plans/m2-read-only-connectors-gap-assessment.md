# M2 Read-only Connectors Gap Assessment

Status: assessment complete; no connector implementation or runtime activation is included in this slice.

## Decision

The smallest first concrete slice is an **unwired Jira issue-search adapter** in
`@chunsik/connectors`, exercised only with an injected fake transport. It can implement the existing
`ConnectorProvider` contract without changing Core. The first slice is deliberately limited to bounded,
read-only issue discovery: search text in, issue key/summary/browser URL out. It does not resolve issue bodies into
context, write Jira data, read a real credential, call a live endpoint, or register the adapter in the application
runtime.

Jira is the lowest-complexity candidate for this narrow slice:

| Candidate | Fit to `ConnectorItem` | First-slice complications | Assessment |
|---|---|---|---|
| Jira | Issue key is a stable `id`; issue summary is a natural `title`; a browser URL is deterministic. | Rich descriptions use Atlassian Document Format, but the first slice can omit them. | **Choose first.** |
| Confluence | Page id and title map cleanly. | Search excerpts/body formats need markup normalization, and returned links can require base-URL resolution. | Second choice. |
| Slack | Message id can be derived from channel/timestamp. | Messages have no natural title; permalink resolution, channel/thread context, scopes, and pagination add policy and mapping decisions. | Defer. |

This comparison is based on the repository contract and common adapter requirements. Exact vendor endpoint versions,
headers, and scopes must be checked against vendor documentation before a network-capable implementation is approved;
that verification is outside this offline assessment.

## Current Surface

### Core port

`packages/core/src/ports/connector-provider.port.ts` defines:

- `ConnectorQuery`: required free-form `query` plus optional provider-neutral `Metadata` params.
- `ConnectorItem`: required `id` and `title`, with optional `url`, `summary`, and provider-neutral `raw` metadata.
- `ConnectorResult`: `source` plus an item list.
- `ConnectorProvider`: immutable `source` and `readOnly`, asynchronous `isAvailable()`, and asynchronous `query()`.

There are no write methods, provider SDK types, credentials, pagination cursors, HTTP request objects, or platform
types in the port. The shape is sufficient for bounded search-result discovery.

### Core manager

`packages/core/src/application/connector-manager.ts` is a thin registry:

- `list()` returns the injected providers.
- `has(source)` checks source registration.
- `query(source, query)` delegates to the first matching provider.
- An unknown source returns `{ source, items: [] }` rather than throwing.

The manager does not call `isAvailable()`, enforce unique sources, normalize results, paginate, cache, authorize, or
convert connector items to resources. Those behaviors must not be silently added to the Jira adapter.

### Adapter package and composition root

`packages/connectors/src/index.ts` currently exports only the empty, immutable `V1_CONNECTORS` list. Its package has
only `@chunsik/core` as a runtime dependency and no connector SDK or HTTP-client dependency. There are no connector
implementations or tests.

`apps/chunsik/src/app.module.ts` binds that list to the plural `CONNECTOR_PROVIDERS` token and constructs
`ConnectorManager` from the injected `readonly ConnectorProvider[]`. This is the correct composition direction:
`apps/chunsik` imports the concrete adapter package, while Core imports no adapter.

## Gaps for the Jira First Slice

No new Core contract is required for the bounded discovery slice. The missing contracts are adapter-local:

1. `JiraConnectorConfig`
   - reviewed Jira site base URL;
   - account identifier/email where required by the selected auth mode;
   - token supplied directly to the adapter, never placed in `ConnectorQuery`, `ConnectorItem.raw`, errors, or logs;
   - bounded result limit and optional request timeout.
2. An injectable read-only transport
   - accepts only a bounded Jira search request;
   - returns status and JSON needed by the parser;
   - production implementation may use built-in `fetch`, while unit tests must inject a fake and make no network
     calls;
   - permits only the selected read endpoint and `GET` request semantics; no generic method/body escape hatch.
3. Narrow external response types and runtime validation
   - treat all response fields as untrusted;
   - validate the issue key and non-empty summary;
   - ignore unneeded fields and cap item count;
   - produce sanitized errors containing no credential, authorization header, response body, or query echo.
4. Deterministic query construction
   - treat `ConnectorQuery.query` as search text, not caller-supplied raw JQL;
   - escape it into one adapter-owned, read-only issue-search expression;
   - request only the key and summary fields needed by the result mapper;
   - reject blank queries and unsupported params before transport invocation.

Typed pagination, resource resolution, content expansion, comments, attachments, transition/write APIs, retries,
caching, and webhook ingestion are not first-slice gaps; they are explicitly deferred.

## Authentication Requirements

The minimal Jira Cloud model is adapter-local basic authentication using an account identifier/email and API token.
OAuth installation flows, refresh-token persistence, and Jira Server/Data Center variants are separate product and
security decisions and are not part of the first slice.

The implementation must keep these boundaries:

- Configuration owns the site URL and auth material; callers cannot override either through `params`.
- The token is used only to form the outbound authorization header inside the adapter transport.
- `isAvailable()` reports local configuration readiness only in the unwired first slice; it must not probe Jira.
- Unit tests use synthetic credentials and an injected fake transport.
- Real secret configuration/read, endpoint verification, network execution, runtime activation, and Live UAT require
their own exact-scope authorization and are not implied by this assessment.

## Data Mapping

For each validated issue returned by the bounded search:

| `ConnectorItem` field | Jira source | Rule |
|---|---|---|
| `id` | issue key | Required, for example `PROJ-123`; skip malformed entries. |
| `title` | `fields.summary` | Required non-empty string. |
| `url` | configured site URL + `/browse/` + encoded issue key | Construct deterministically; never trust an arbitrary API-provided URL. |
| `summary` | omitted | Rich description/status rendering is outside the first slice. |
| `raw` | bounded metadata only | If needed, include allow-listed primitives such as issue type or status name; never copy the full response. |

`ConnectorResult.source` is always the adapter constant `jira`, not response data. Preserve API order and enforce a
small configured maximum. Do not map the result to `Artifact`; connector results are inputs.

## Proposed Package Structure

The first implementation should remain inside the existing adapter package:

```text
packages/connectors/
  src/
    index.ts                         # public exports; keep V1_CONNECTORS empty in the unwired slice
    jira/
      jira-connector-provider.ts     # ConnectorProvider implementation and mapping
      jira-read-transport.ts         # narrow interface + fetch-backed implementation
      jira-types.ts                  # config and private external response shapes
      jira-connector-provider.test.ts
```

No Atlassian SDK is needed for the first slice. The package continues to depend inward only on `@chunsik/core` plus
platform libraries used by its own implementation. It must not import another adapter or NestJS.

## Composition-root Wiring Plan

Wiring and activation follow the adapter-only implementation as a separate bounded step:

1. Extend the existing application config path with optional Jira settings; validate and sanitize them there. Do not
   read environment variables inside `@chunsik/connectors`.
2. In `apps/chunsik/src/app.module.ts`, construct `JiraConnectorProvider` only when the complete reviewed config is
   present.
3. Replace the static empty binding value with a composition-root-created immutable
   `readonly ConnectorProvider[]`, then bind it to `CONNECTOR_PROVIDERS` exactly as today.
4. Keep `ConnectorManager` construction unchanged.
5. Add composition tests proving absent/partial configuration yields no registered Jira provider and complete fake
   configuration yields exactly one `source === 'jira'` provider. Production wiring tests must not invoke `query()`.

This plan preserves manual compile-time registration and the `apps -> adapters -> core` dependency direction. It
does not authorize actual runtime/network activation.

## Boundary Verification and Architecture Note

The proposed first slice fits the existing `ConnectorProvider` boundary because it only implements `source`,
`readOnly`, local `isAvailable()`, and `query()` and returns only `ConnectorResult`. It needs no Core import beyond
the existing public types, no Core port/domain/application edit, no schema or persistence change, and no
provider-specific branch in `ConnectorManager`.

There is a pre-existing architecture/documentation gap that this slice must not conceal: ADR-0005 and
`ARCHITECTURE.md` describe read connectors as future `ResourceResolver` implementations producing `ResourceRef`, but
neither type exists in current Core and the implemented connector seam instead uses `ConnectorProvider` and
`ConnectorItem`. Therefore the Jira slice is valid only as **connector discovery through the already-implemented
port**. Feeding Jira content into `ContextBuilder`, claiming `ResourceResolver` conformance, or changing Core to
bridge the two would be an architectural follow-up requiring an accepted decision/ADR before implementation.

## Acceptance Boundary for the Implementation Slice

The next implementation task can be bounded to the adapter class, narrow transport, exports, and fake-transport unit
tests described above. It passes when deterministic mapping, malformed-response rejection, bounds, sanitized failures,
read-only request construction, and zero-network tests pass with `pnpm typecheck` and `pnpm test`.

It must stop before application config changes, composition-root registration, credential access, external network
calls, runtime start/stop/restart, Discord actions, Live UAT, push, PR, or merge.
