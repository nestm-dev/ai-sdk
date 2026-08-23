# Multi-model observability playground

Private, local-only NestJS reference app for comparing OpenAI, Anthropic, and Google models through
`AiSdkModule` and `AiSdkService.generateText` while feeding content-free AI SDK 7 lifecycle
telemetry into the optional `@nestm/ai-sdk/observability` capability.

The app binds to `127.0.0.1:3001`. It runs selected providers in parallel, preserves partial
successes, and returns only sanitized failure categories. Prompts and generated text are returned
to the requesting dashboard, but are never recorded in the observability events or snapshot.

## Local setup

Copy `.env.example` to the ignored `.env.local`, replace every placeholder with a fresh credential,
then run:

```sh
pnpm run build
pnpm --filter @nestm/ai-sdk-playground dev
```

In another terminal, start the dashboard against this Nest process:

```sh
AI_OBSERVABILITY_API_URL=http://127.0.0.1:3001 \
  pnpm --filter @nestm/ai-sdk-control-plane-web dev
```

Open `http://127.0.0.1:3000`, use the local model lab, then inspect the same-process dashboard
snapshot. Never commit `.env.local`; rotate any credential exposed in source control, logs, or chat.

## Endpoints

- `GET /playground/v1/providers` lists the configured provider/model pairs without exposing keys.
- `POST /playground/v1/compare` accepts a prompt and optional provider allowlist.
- `GET /ai-observability/v1/snapshot` returns the content-free snapshot contract.

## Verify

The workspace-only `supports-color` development pin is intentional. It keeps pnpm's optional peer
context identical for the linked root package and this app, so Nest's `DiscoveryModule` and the
playground bootstrap share one `@nestjs/core` instance.

```sh
pnpm run verify:playground
```
