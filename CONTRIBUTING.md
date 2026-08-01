# Contributing

## Setup

```bash
corepack enable
pnpm install
```

Node 22.12 or newer is required. The package is ESM-only and targets NestJS 12 and AI SDK 7.

## Workflow

```bash
pnpm run check          # Oxlint, Prettier, and TypeScript
pnpm run test           # unit, Express/Fastify E2E, and compile-time tests
pnpm run build          # tsdown output in dist/
pnpm run verify:pack    # build, Publint, and packed-consumer types
pnpm run example:build  # compile the example without making API calls
pnpm run verify         # all local release gates
```

Add a Changeset for every user-visible change with `pnpm changeset`.

## Ground rules

- Preserve exact upstream AI SDK call signatures; do not merge hidden defaults into operation options.
- Keep provider packages consumer-owned. The library may depend on `ai`, but not a concrete provider SDK.
- Keep the root, `http`, and `testing` entry points independently importable and side-effect free.
- Preserve ESM output and emitted decorator metadata. The CI build verifies both package shape and metadata.
- Tests must not call live models. Use `@nestm/ai-sdk/testing` and the mocks from `ai/test`.
- HTTP changes must pass the same E2E scenarios with both Express and Fastify.

## Pull requests

Keep changes focused, document public behavior, include regression coverage, and make sure `pnpm run verify`
passes before requesting review.
