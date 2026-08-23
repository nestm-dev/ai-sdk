# AI observability control plane

Private reference dashboard for the versioned `AiObservabilitySnapshotV1` contract. It is a
workspace application, not an export or published runtime file of `@nestm/ai-sdk`.

The separation is intentional:

```text
neutral events → bounded collector → Nest HTTP projection → private server proxy → dashboard
```

The published package owns the first three boundaries. This app demonstrates one control-plane
experience without making React, Next.js, storage, authentication, or a dashboard vendor part of
the library contract.

## Run locally

Build the workspace package, then start the app:

```sh
pnpm run build
pnpm --filter @nestm/ai-sdk-control-plane-web dev
```

With no environment configured, `/api/snapshot` serves a realistic demo snapshot. To connect one
NestJS process, copy `.env.example` to `.env.local` and set:

```sh
AI_OBSERVABILITY_API_URL=http://127.0.0.1:3001
```

The URL is the loopback-only base origin of the Nest application; the proxy reads
`/ai-observability/v1/snapshot`. For an upstream protected by a bearer credential, set the optional
server-only `AI_OBSERVABILITY_API_BEARER_TOKEN`. Neither variable is sent to the browser.

The dashboard also proxies `POST /api/compare` to the local playground. Model responses remain in
transient browser state and are not stored in the observability snapshot.

This reference app has no Sites or `chatgpt.site` hosting integration. It runs as a normal local
workspace application.

## Security boundary

- Keep the dashboard private with platform authentication and authorization.
- Keep the Nest snapshot route behind application-owned auth, CORS, and rate limits.
- The app validates every upstream response against schema version 1 and rejects responses over
  2 MiB.
- Polling occurs every five seconds while the page is visible. A failed refresh preserves the last
  accepted snapshot; a lower revision is rejected only within the same process epoch.
- The current contract is process-scoped. Multi-replica aggregation belongs in a future durable
  query/control-plane adapter, not in this browser.
- Operation usage is the consumption view. Provider/model usage is attribution and must never be
  added to operation usage.
- The collector and dashboard never retain prompts, outputs, reasoning content, tool arguments, or
  tool results.

## Verify

```sh
pnpm --filter @nestm/ai-sdk-control-plane-web verify
```
