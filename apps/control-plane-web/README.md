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

The chat workspace uses the local `multi-model-playground` as its durable Nest backend. Copy that
app's `.env.example` to its ignored `.env.local`, replace the placeholders with fresh provider
credentials, then build the workspace and run both apps in separate terminals:

```sh
pnpm run build

pnpm --filter @nestm/ai-sdk-playground dev
```

```sh
AI_OBSERVABILITY_API_URL=http://127.0.0.1:3001 \
pnpm --filter @nestm/ai-sdk-control-plane-web dev
```

Open `http://127.0.0.1:3000`. Never commit either app's local environment file. With no control-plane
environment configured, `/api/snapshot` still serves a realistic demo snapshot, while chat routes
return a safe not-connected response.

The control-plane proxy can also be configured through its `.env.local`:

```sh
AI_OBSERVABILITY_API_URL=http://127.0.0.1:3001
```

The URL must be the loopback-only base origin of the Nest application. For an upstream protected by
a bearer credential, set the optional server-only `AI_OBSERVABILITY_API_BEARER_TOKEN`. Neither
variable is sent to the browser.

The dashboard also proxies `POST /api/compare` to the local playground. Model responses remain in
transient browser state and are not stored in the observability snapshot.

This reference app has no Sites or `chatgpt.site` hosting integration. It runs as a normal local
workspace application.

## Chat workspace

The root route selects the most recently updated conversation or creates a new OpenAI conversation
when none exists. `/c/[chatId]` provides the ChatGPT-style thread and the persistent sidebar remains
available on both chat and observability pages. From the workspace you can:

- create and switch between saved conversations;
- page through older conversations from the sidebar;
- delete idle conversations while active runs remain protected;
- choose the configured OpenAI, Claude, or Gemini model before a run;
- render streaming Markdown, reasoning, sources, files and images, tool inputs/outputs, tool errors,
  and approval controls;
- keep the composer locked while an approval is pending so approval responses cannot be orphaned;
- attach up to three images, text, JSON, or PDF files totaling 256 KiB and request sourced answers
  through each provider's native web-search tool;
- copy or regenerate a response and inspect message-level provider, model, timing, token, step, and
  finish metadata;
- open `/observability` without cancelling a running conversation.

Each saved conversation accepts up to 200 input messages (about 100 complete turns). At that
boundary the composer becomes read-only and offers a one-click new conversation using the same
provider, while the full original transcript remains available.

Each `/c/[chatId]` runtime mounts only after its persisted messages load and is keyed by chat ID.
Submitting uses `POST /api/chats/[chatId]/stream`. Revisiting a conversation with an authoritative
active run reconnects with `GET /api/chats/[chatId]/stream`; idle chats do not open a resume request.
Route changes explicitly close only the browser subscriber. The backend's independent consumer
keeps the run alive. The explicit Stop control first calls the server cancel route for the current
run and then stops the local stream.

The browser talks only to same-origin routes. Their loopback-only Nest mirrors are:

- `GET|POST /api/chats` for listing and creating conversations;
- `GET|PATCH|DELETE /api/chats/[chatId]` for a saved conversation;
- `POST|GET /api/chats/[chatId]/stream` for starting/regenerating and resuming streams;
- `POST /api/chats/[chatId]/runs/[runId]/cancel` for explicit cancellation;
- `GET /api/providers` for the configured provider/model catalog.

`/observability` preserves the snapshot dashboard and comparison lab. `/api/snapshot` remains
read-only, while `/api/compare` applies the same-origin JSON mutation policy used by chat writes.

## Security boundary

- Keep the dashboard private with platform authentication and authorization.
- Keep the Nest snapshot route behind application-owned auth, CORS, and rate limits.
- Chat, comparison, and provider proxy routes accept only a configured loopback origin, validate
  IDs and bounded request bodies, strictly validate JSON responses, and stream only
  `text/event-stream` responses.
- The app validates every upstream response against its versioned schema and enforces bounded
  per-endpoint request and response sizes.
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
