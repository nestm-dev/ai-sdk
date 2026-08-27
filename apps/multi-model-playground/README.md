# Multi-model observability playground

Private, local-only NestJS reference app for comparing and chatting with OpenAI, Anthropic, and
Google models through `AiSdkModule`. The comparison lab uses `AiSdkService.generateText`; durable
multi-chat uses AI SDK 7 `ToolLoopAgent` and the `@nestm/ai-sdk/http` UI-message stream bridge. Both
feed content-free lifecycle telemetry into the optional `@nestm/ai-sdk/observability` capability.

The app binds to `127.0.0.1:3001`. Comparison requests run selected providers in parallel and
preserve partial successes. Chat runs are limited to one active run per chat, while different chats
can keep generating concurrently. Prompts, generated text, reasoning, sources, and tool states are
returned to the requesting dashboard, but are never recorded in observability events or snapshots.

## Local setup

Copy `.env.example` to the ignored `.env.local`. Create fresh provider credentials and place them in
the exact variables `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and
`GOOGLE_GENERATIVE_AI_API_KEY`. Never reuse credentials posted in chat, source control, terminal
history, or logs; revoke and rotate any credential that was exposed. Then run:

```sh
pnpm run build
pnpm --filter @nestm/ai-sdk-playground dev
```

In another terminal, start the dashboard against this Nest process:

```sh
AI_OBSERVABILITY_API_URL=http://127.0.0.1:3001 \
  pnpm --filter @nestm/ai-sdk-control-plane-web dev
```

Open `http://127.0.0.1:3000`, use the local model lab or chat workspace, then inspect the
same-process dashboard snapshot. The model variables select the concrete model behind each UI
provider choice: `OPENAI_MODEL`, `ANTHROPIC_MODEL`, and `GOOGLE_MODEL`.

## Endpoints

- `GET /playground/v1/providers` lists the configured provider/model pairs without exposing keys.
- `POST /playground/v1/compare` accepts a prompt and optional provider allowlist.
- `GET /playground/v1/chats?limit=50&cursor=<chat-id>` returns
  `{ chats: ChatSummary[], nextCursor: string | null }`, newest first.
- `POST /playground/v1/chats` creates a chat from
  `{ provider: "openai" | "anthropic" | "google", title?: string }`.
- `GET /playground/v1/chats/:chatId` returns the chat, typed AI SDK UI messages, and active-run
  metadata.
- `PATCH /playground/v1/chats/:chatId` changes `{ title?, provider? }`. Provider changes are rejected
  while that chat is running.
- `DELETE /playground/v1/chats/:chatId` returns `204`; deleting an active chat is rejected.
- `POST /playground/v1/chats/:chatId/stream` accepts
  `{ messages, trigger: "submit-message" | "regenerate-message", messageId? }` and returns an AI SDK
  UI-message SSE stream. The `x-chat-run-id` response header identifies the stable run.
- `GET /playground/v1/chats/:chatId/stream` replays the current in-process SSE stream, including its
  buffered prefix. It returns `204` when the chat is idle or its producer is not in this process.
- `POST /playground/v1/chats/:chatId/runs/:runId/cancel` cancels only that chat's current matching
  run. Missing, stale, and already-finished run IDs are never allowed to cancel another run.
- `GET /ai-observability/v1/snapshot` returns the content-free snapshot contract.

The server treats its stored transcript as authoritative: clients may append one new user message,
submit the approval response for the final assistant tool call, or regenerate an authoritative
prefix. A client cannot rewrite older messages. Chat responses can include metadata, reasoning,
sources, files, and typed tool states for provider-native web search, calculator, current time,
bounded slow wait, content-free observability inspection, and durable memory. Every durable-memory
call is approval-gated.

## Local durability and resume

`CHAT_STATE_DIR` defaults to the ignored `apps/multi-model-playground/.data` directory when the app
is started from that package. Chat metadata, transcripts, run records, and durable memory are saved
to an atomically replaced JSON state file. Each run also gets an append-only `.sse` transcript under
`.data/streams`; files are created with owner-only permissions.

Generation is eagerly started and consumed by a server-owned stream branch, so closing the browser,
navigating to another page, or disconnecting the HTTP subscriber does not cancel it. Reopening an
active chat uses the GET resume endpoint. The replay prefix is bounded by `CHAT_REPLAY_MAX_BYTES`,
and a run is bounded by `CHAT_RUN_TIMEOUT_MS`. `CHAT_MAX_OUTPUT_TOKENS` controls chat output
separately from the comparison lab's smaller `MAX_OUTPUT_TOKENS` value.

This demo has no external worker or distributed stream broker. A Nest process restart therefore
cannot continue the provider request or live SSE replay. On startup, any persisted `running` run is
marked `failed` with the internal `interrupted_by_restart` category and the chat is made available
for a new run; completed messages and the append-only SSE log remain on disk.

## Verify

The workspace `supports-color` development pins are intentional. They keep pnpm's optional peer
context identical for the linked root package and this app, so Nest's `DiscoveryModule` and the
playground bootstrap share one `@nestjs/core` instance.

```sh
pnpm run verify:playground
```
