# @nestm/ai-sdk

Provider-neutral [AI SDK](https://ai-sdk.dev) 7 integration for **NestJS 12**. It adds typed
configuration and dependency injection around AI SDK models, tools, agents, uploads, and streaming
HTTP responses without hiding the upstream APIs.

- `AiSdkModule.forRoot()` and `forRootAsync()` with provider registries or zero configuration
- Optional eager defaults for every AI SDK model modality plus files and skills
- `AiSdkService` façades that preserve exact upstream signatures with optional request defaults
- Decorated Nest providers with `@AiToolset()` and `@AiTool()`
- Named toolsets and agents with `useValue`, `useFactory`, `useClass`, and `useExisting`
- Express and Fastify response streaming through `@nestm/ai-sdk/http`
- Full AI SDK V4 mocks and Nest overrides through `@nestm/ai-sdk/testing`
- Experimental, fenced Harness orchestration through `@nestm/ai-sdk/harness`
- Optional bounded, content-free telemetry through `@nestm/ai-sdk/observability`

Provider SDKs remain application-owned. Install and configure only the providers your application
uses; this package does not depend on OpenAI, Anthropic, Google, MCP, or another concrete provider.

## Requirements

- Node 22.12 or newer
- NestJS `^12.0.0`
- AI SDK `>=7.0.52 <8`
- ESM

The optional Harness entrypoint currently requires the exact compatibility pair `ai@7.0.83` and
`@ai-sdk/harness@1.0.92`. Claude Code and Codex adapters are tested as one release train; see the
Harness section before upgrading any one package independently.

## Installation

```bash
pnpm add @nestm/ai-sdk@alpha ai zod @nestjs/common @nestjs/core reflect-metadata rxjs
npm install @nestm/ai-sdk@alpha ai zod @nestjs/common @nestjs/core reflect-metadata rxjs
```

The package is currently on an alpha release train, so use the `alpha` dist-tag until a stable
release is promoted to `latest`.

Add the provider package used by your application separately. AI SDK's built-in Gateway provider is
available from `ai` and needs no additional package.

## Quick start

AI SDK can resolve Gateway model strings itself, so registration may be empty:

```ts
import { Module } from "@nestjs/common";
import { AiSdkModule } from "@nestm/ai-sdk";

@Module({
	imports: [AiSdkModule.forRoot()],
})
export class AppModule {}
```

```ts
import { Injectable } from "@nestjs/common";
import { AiSdkService } from "@nestm/ai-sdk";

@Injectable()
export class SummaryService {
	constructor(private readonly ai: AiSdkService) {}

	async summarize(input: string): Promise<string> {
		const result = await this.ai.generateText({
			model: "openai/gpt-5-mini",
			prompt: `Summarize: ${input}`,
		});
		return result.text;
	}
}
```

Set `AI_GATEWAY_API_KEY` according to the AI SDK Gateway documentation. `AiSdkModule` is global by
default; pass `isGlobal: false` when module-local registration is preferred.

## Configuration

### Provider map and defaults

Pass already-created providers and optional defaults. Provider names and model IDs remain typed:

```ts
import { createGateway } from "ai";
import { AiSdkModule, defineAiSdkConfig } from "@nestm/ai-sdk";

const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY });

const aiConfig = defineAiSdkConfig({
	providers: { gateway },
	defaults: {
		language: "gateway:openai/gpt-5-mini",
		embedding: "gateway:openai/text-embedding-3-small",
		image: "gateway:openai/gpt-image-1-mini",
	},
});

AiSdkModule.forRoot(aiConfig);
```

For a direct provider, install that provider SDK in the application and pass its prebuilt provider in
the same way. It remains a consumer dependency rather than an `@nestm/ai-sdk` dependency:

```bash
pnpm add @ai-sdk/openai
```

```ts
import { createOpenAI } from "@ai-sdk/openai";

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

AiSdkModule.forRoot({
	providers: { openai },
	defaults: { language: "openai:gpt-5-mini" },
});
```

`registryOptions` forwards every native `createProviderRegistry` option, including custom separators
and language/image middleware:

```ts
AiSdkModule.forRoot({
	providers: { gateway },
	registryOptions: {
		separator: "/",
		languageModelMiddleware: [firstMiddleware, secondMiddleware],
		imageModelMiddleware,
	},
	defaults: { language: "gateway/openai/gpt-5-mini" },
});
```

### Prebuilt registry

Use `registry` instead of `providers` when the application already owns an AI SDK registry. The two
modes are intentionally mutually exclusive.

```ts
import { createProviderRegistry } from "ai";

const registry = createProviderRegistry({ gateway }, { separator: "/" });

AiSdkModule.forRoot({
	registry,
	defaults: { language: "gateway/openai/gpt-5-mini" },
});
```

Defaults may also be direct model/API instances, which is useful when no registry lookup is needed:

```ts
AiSdkModule.forRoot({
	providers: { gateway },
	defaults: {
		language: gateway.languageModel("openai/gpt-5-mini"),
	},
});
```

All string defaults are resolved during application bootstrap. Unknown providers or model IDs fail
fast with `AiSdkConfigurationError` rather than failing on the first request.

### Async configuration

`forRootAsync()` supports Nest's `useFactory`, `useClass`, and `useExisting` patterns:

```ts
AiSdkModule.forRootAsync({
	imports: [ConfigModule],
	inject: [ConfigService],
	useFactory: (config: ConfigService) => {
		const gateway = createGateway({
			apiKey: config.getOrThrow("AI_GATEWAY_API_KEY"),
		});
		return {
			providers: { gateway },
			defaults: { language: gateway.languageModel("openai/gpt-5-mini") },
		};
	},
});
```

For class-based configuration, implement `AiSdkOptionsFactory.createAiSdkOptions()`.

### Request defaults and resilience

AI SDK already retries retryable provider calls twice by default. Use `requestDefaults` when the
application needs one validated policy for calls made through `AiSdkService`:

```ts
AiSdkModule.forRoot({
	providers: { gateway },
	requestDefaults: {
		maxRetries: 1,
		timeout: {
			totalMs: 60_000,
			stepMs: 20_000,
			firstChunkMs: 10_000,
			chunkMs: 15_000,
			toolMs: 20_000,
			tools: { workspace_write_fileMs: 10_000 },
		},
	},
});
```

The module validates these values during bootstrap and copies the configuration so later mutation
cannot change a running service. `generateText` and `streamText` receive AI SDK 7's native timeout
configuration; streaming-only fields are omitted from `generateText`. For other operations that
accept an `abortSignal`, a numeric timeout or `totalMs` becomes a deadline signal and is combined
with the caller's signal. Retry defaults are applied only to upstream operations that expose
`maxRetries`. Call-site `maxRetries` and text `timeout` values take precedence.

AI SDK 7 does not expose retry or cancellation options for `uploadFile` and `uploadSkill`, so the
package leaves those calls unchanged. A reusable default abort signal is also deliberately rejected
as a design: once aborted, a singleton signal would cancel every later request.

Named `ToolLoopAgent` settings remain explicit because they can have different cost and side-effect
budgets. Set `maxRetries` while constructing the agent, then set a total/step/chunk/tool `timeout` or
`abortSignal` on each `agent.generate()` / `agent.stream()` call. `AiSdkResponse.agent()` composes its
signal with the Nest HTTP connection automatically, so an Express or Fastify disconnect aborts the
upstream agent and its tools.

Retries cover retryable provider requests; they are not a substitute for idempotency in mutating
tools. Follow the native [AI SDK settings](https://ai-sdk.dev/docs/ai-sdk-core/settings) and inspect
failures with native guards such as `RetryError.isInstance(error)` and
`APICallError.isInstance(error)`. The wrapper never replaces provider errors.

### Application-wide registry typing

`defineAiSdkConfig()` preserves literal providers and separators. To make a registry the default
generic for every injected `AiSdkService`, augment `AiSdkTypeRegistry` once in the application:

```ts
const registry = createProviderRegistry({ gateway });

declare module "@nestm/ai-sdk" {
	interface AiSdkTypeRegistry {
		registry: typeof registry;
	}
}
```

You can also use `AiSdkService<typeof registry>` locally.

## Models and operations

Accessors accept an explicit registry ID or use the configured default:

```ts
const defaultModel = ai.languageModel();
const anotherModel = ai.languageModel("gateway:anthropic/claude-sonnet-4.5");

const result = await ai.generateText({
	model: defaultModel,
	prompt: "Write a haiku about dependency injection.",
	maxRetries: 1,
});
```

Default injection is also available without injecting the service:

```ts
constructor(
	@InjectAiLanguageModel() private readonly model: AiSdkDirectLanguageModel,
) {}
```

The model/API accessors are `languageModel`, `embeddingModel`, `imageModel`, `transcriptionModel`,
`speechModel`, `rerankingModel`, `videoModel`, `files`, and `skills`. Matching decorators are exported
for each default: `@InjectAiLanguageModel()`, `@InjectAiEmbeddingModel()`, `@InjectAiImageModel()`,
`@InjectAiTranscriptionModel()`, `@InjectAiSpeechModel()`, `@InjectAiRerankingModel()`,
`@InjectAiVideoModel()`, `@InjectAiFiles()`, and `@InjectAiSkills()`.

`AiSdkService` exposes these readonly AI SDK functions with their exact upstream `typeof` signatures:

| Capability               | Service property                                                |
| ------------------------ | --------------------------------------------------------------- |
| Text generation          | `generateText`, `streamText`                                    |
| Embeddings               | `embed`, `embedMany`                                            |
| Images                   | `generateImage`                                                 |
| Reranking                | `rerank`                                                        |
| Speech and transcription | `generateSpeech`, `transcribe`                                  |
| Files and skills         | `uploadFile`, `uploadSkill`                                     |
| Video                    | `experimental_generateVideo`                                    |
| Streaming speech         | `experimental_streamTranscribe`, `experimental_streamTranslate` |
| Telemetry registration   | `registerTelemetry`                                             |

Except for optional `requestDefaults`, models, tools, structured output, headers, provider options,
callbacks, telemetry, sandbox settings, approvals, and runtime context stay visible at each call
site. Errors thrown by AI SDK or providers pass through unchanged; only module configuration
failures use `AiSdkConfigurationError`.

## Toolsets

Decorated toolsets are ordinary Nest providers and retain constructor injection and scope:

```ts
import { Injectable } from "@nestjs/common";
import { AiTool, AiToolset } from "@nestm/ai-sdk";
import { z } from "zod";

@AiToolset("weather")
@Injectable()
export class WeatherToolset {
	constructor(private readonly weather: WeatherService) {}

	@AiTool({
		description: "Look up current weather",
		inputSchema: z.object({ city: z.string() }),
	})
	lookup({ city }: { city: string }) {
		return this.weather.lookup(city);
	}
}

@Module({
	imports: [AiSdkModule.forFeature({ toolsets: [WeatherToolset] })],
})
export class WeatherModule {}
```

The decorated method becomes the bound `execute` implementation and may return a value, a promise,
or an async iterable. `@AiTool()` accepts every current nondeprecated function-tool option except
`execute`; create approvals at the call/agent boundary so authorization remains explicit.

Direct `ToolSet` values and factories support dynamic, provider-defined, or MCP-created tools:

```ts
AiSdkModule.forFeature({
	imports: [McpModule],
	toolsets: [
		{
			name: "mcp",
			inject: [McpClient],
			useFactory: (client: McpClient) => client.tools(),
		},
	],
});
```

Inject the resolved set with `@InjectAiToolset("mcp")` or `getAiToolsetToken("mcp")`.

## Named agents

Register an existing AI SDK `Agent` or `ToolLoopAgent`, or pass complete `ToolLoopAgentSettings` and
let the module construct it:

```ts
import type { ToolSet } from "ai";

AiSdkModule.forFeature({
	agents: [
		{
			name: "support",
			inject: [AiSdkService, getAiToolsetToken("weather")],
			useFactory: (ai: AiSdkService, tools: ToolSet) => ({
				model: ai.languageModel(),
				instructions: "Answer support questions and use tools when needed.",
				tools,
			}),
		},
	],
});
```

`useValue`, `useFactory`, `useClass`, and `useExisting` are supported for both named agents and direct
toolsets. Class factories implement `createAiAgent()` or `createAiToolset()`. `forFeatureAsync()` uses
the same definitions with per-factory `inject` arrays. Duplicate names fail module bootstrap.

```ts
constructor(@InjectAiAgent("support") private readonly agent: AiSdkAgent) {}
```

## Streaming HTTP responses

Import the optional HTTP integration once. It installs an interceptor that recognizes only opaque
`AiSdkHttpResponse` results; normal Nest controller values are unchanged.

```ts
import { AiSdkService, InjectAiAgent, type AiSdkAgent } from "@nestm/ai-sdk";
import { AiSdkHttpModule, AiSdkResponse } from "@nestm/ai-sdk/http";
import type { UIMessage } from "ai";

@Module({ imports: [AiSdkHttpModule.register()] })
export class HttpModule {}

@Controller("ai")
export class AiController {
	constructor(
		private readonly ai: AiSdkService,
		@InjectAiAgent("support") private readonly agent: AiSdkAgent,
	) {}

	@Post("text")
	text(@Body("prompt") prompt: string) {
		const result = this.ai.streamText({
			model: this.ai.languageModel(),
			prompt,
		});
		return AiSdkResponse.text(result);
	}

	@Post("chat")
	chat(@Body("messages") messages: UIMessage[]) {
		return AiSdkResponse.agent({ agent: this.agent, uiMessages: messages });
	}
}
```

- `AiSdkResponse.from(response)` bridges any Fetch `Response`.
- `AiSdkResponse.text(stream, init)` creates a text stream response.
- `AiSdkResponse.ui(stream, options)` creates an AI SDK UI-message stream response.
- `AiSdkResponse.agent(options)` runs an agent and creates its UI-message stream response.

`AiSdkResponse.agent()` derives its accepted UI messages, metadata callbacks, tools, call options,
runtime context, and output directly from the concrete agent. This matches AI SDK 7's agent helper:
agent responses do not advertise custom `data-*` parts that the upstream helper cannot emit. Compose
a custom UI-message stream and pass it to `AiSdkResponse.ui()` when application-specific data parts
are required. The raw-chunk `ui()` overload accepts response initialization only; conversion
callbacks such as `messageMetadata` and `onFinish` belong on a source with `toUIMessageStream()`.

The bridge preserves status, status text, headers, multiple `Set-Cookie` values, binary chunks,
backpressure, and disconnect cancellation for Express and Fastify. Errors before headers are sent
remain available to Nest's exception pipeline; errors after a stream is committed terminate the
connection. Agent responses are created lazily after the interceptor has bound the socket lifecycle;
the connection signal is composed with an explicit `abortSignal`, and AI SDK's `consumeStream`
integration ensures abort finalizers run. The abort reason is an `AiSdkHttpDisconnectError`. For
custom integrations, inject `AiSdkResponseSender`, call `sendAiSdkResponse()`, or pass an
`AiSdkHttpResponseContext` to `response.resolve(context)`.

Once streaming starts, AI SDK stream failures are normally delivered through `onError` and stream
parts instead of being thrown synchronously. Log the original `unknown` error server-side and return
only a safe client message. When creating a UI stream outside `AiSdkResponse.agent()`, follow AI
SDK's [stream abort guidance](https://ai-sdk.dev/docs/troubleshooting/stream-abort-handling) and
provide `consumeSseStream: consumeStream` when an abort signal controls the upstream operation.

## AI SDK Harness orchestration

`@nestm/ai-sdk/harness` runs a concrete upstream `HarnessAgent` while keeping registration and
routing application-owned. A fenced lease is held from checkpoint load through final persistence;
every state transition is a compare-and-swap. A stale `running` marker becomes
`recovery-required`, so the runner never silently starts a second prompt after an uncertain crash.
The runner attempts the same fail-closed marker when session creation fails after the `running` CAS
or when a final checkpoint cannot be committed. If the store itself is unavailable, the existing
`running` marker remains and is converted on the next load. An operator must explicitly reconcile or
reset either state. Recovery reasons are fixed metadata codes; native error messages are never copied
into durable state.

```ts
import { AiSdkHarnessModule, durableSafeAiSdkHarnessFinalization } from "@nestm/ai-sdk/harness";

AiSdkHarnessModule.forRoot({
	sessionStore,
	leaseManager,
	timeoutMs: 120_000,
	cleanupTimeoutMs: 10_000,
	leaseTtlMs: 30_000,
	finalization: durableSafeAiSdkHarnessFinalization,
});
```

The application supplies and owns the session store, lease manager, concrete agent, adapter, and
sandbox provider. The runner owns only the session handle it creates for a turn:

```ts
const run = await runner.stream({
	agent,
	key: { namespace: tenantId, agentKey: "claude-primary", sessionId: chatId },
	turn: { kind: "prompt", messages: modelMessages },
	abortSignal,
});

run.stream;
await run.completion;
```

Prompt and continuation are intentionally distinct. A prompt is rejected when the checkpoint holds
an unfinished turn; `continue` is rejected without one. Durable stores reject detach policies and
never persist `continueFrom`: success stops and saves only a completed resume state, while error,
timeout, disconnect, or any unfinished turn destroys the session and deletes its checkpoint.
`warmEphemeralAiSdkHarnessFinalization` enables detach/continuation only for explicitly ephemeral
stores.

As a defensive invariant check, if a durable `stop()` unexpectedly returns `continueFrom` even though
the session reported no unfinished turn, the runner resumes that exact session from the returned
in-memory state, destroys it, then deletes the checkpoint and fails the run. Cleanup uses one absolute
deadline, and the fenced lease is released last.

`AiSdkHarnessResponse.ui()` converts UI messages, invokes the runner, converts the upstream Harness
stream with AI SDK's `toUIMessageStream`, and returns the existing opaque HTTP response type. Stream
cancellation is forwarded to the run before final cleanup.

The tested candidate train is `ai@7.0.83`, `@ai-sdk/harness@1.0.92`,
`@ai-sdk/harness-claude-code@1.0.96`, `@ai-sdk/harness-codex@1.0.94`, and
`@ai-sdk/sandbox-vercel@1.0.92`. `@ai-sdk/workflow-harness` is deliberately not exported: its
time-slice continuation can contain the same bridge credential and is not safe for durable storage.

## Optional observability

Observability is an explicit capability of this package, not a separate service or an automatic
side effect of `AiSdkModule`. The root `@nestm/ai-sdk` entry point does not export or load it. Import
only the layers an application needs:

| Entry point                           | Purpose                                                    |
| ------------------------------------- | ---------------------------------------------------------- |
| `@nestm/ai-sdk/observability`         | Nest collector, service, and optional AI SDK telemetry hub |
| `@nestm/ai-sdk/observability/core`    | Framework-neutral events and bounded in-memory aggregation |
| `@nestm/ai-sdk/observability/http`    | Read-only, platform-neutral Nest snapshot controller       |
| `@nestm/ai-sdk/observability/testing` | Deterministic clock and local-scope Nest testing module    |

The event and snapshot schemas are deliberately content-free. Prompts, generated output,
reasoning, tool arguments and results, request headers, provider metadata, raw errors, user IDs,
and tenant IDs are not accepted by the neutral contracts and are never copied into snapshots.
Correlation IDs exist only in bounded in-flight and replay maps and are not projected.

### Explicit Nest and AI SDK registration

Register the process-local collector and the AI SDK bridge separately. This keeps telemetry off
unless the application has deliberately opted into both pieces:

```ts
import { Module } from "@nestjs/common";
import { AiSdkModule } from "@nestm/ai-sdk";
import {
	AiSdkObservabilityModule,
	AiSdkObservabilityTelemetryModule,
} from "@nestm/ai-sdk/observability";
import { AiSdkObservabilityHttpModule } from "@nestm/ai-sdk/observability/http";

@Module({
	imports: [
		AiSdkModule.forRoot(),
		AiSdkObservabilityModule.forRoot({
			activeTtlMs: 60 * 60_000,
			maxOperationGroups: 100,
			maxModelGroups: 100,
			maxToolGroups: 100,
		}),
		AiSdkObservabilityTelemetryModule.register({ registration: "global" }),
		AiSdkObservabilityHttpModule,
	],
})
export class AppModule {}
```

Global telemetry is provisionally attached during Nest construction so later initialization hooks
are visible, but ownership is committed only after the complete Nest initialization transaction
succeeds. Use the helper instead of calling `app.init()` separately; it rolls back a failed
candidate and prevents two active global collectors from silently receiving the same events:

```ts
import { NestFactory } from "@nestjs/core";
import { initializeAiSdkTelemetry } from "@nestm/ai-sdk/observability";

const app = await NestFactory.create(AppModule);
await initializeAiSdkTelemetry(app);
await app.listen(3000);
```

Calls still execute through the NestM façade. Stable `functionId` values group logical features,
while both upstream content-recording switches remain disabled:

```ts
import { Injectable } from "@nestjs/common";
import { AiSdkService } from "@nestm/ai-sdk";

@Injectable()
export class SummaryService {
	constructor(private readonly ai: AiSdkService) {}

	run(prompt: string) {
		return this.ai.generateText({
			model: this.ai.languageModel(),
			prompt,
			telemetry: {
				isEnabled: true,
				functionId: "summary",
				recordInputs: false,
				recordOutputs: false,
			},
		});
	}
}
```

The NestM adapter discards content independently of the two recording flags. Keeping both flags
false also protects any other integration that honors AI SDK's input/output controls. When a call
supplies its own `telemetry.integrations`, use `composeAiSdkTelemetryOptions()` to include the NestM
hub because AI SDK replaces, rather than extends, globally registered integrations at that call.
Manual per-call registration is the default and is the correct mode for multiple Nest contexts in
one process.

### Bounded snapshots

`AiSdkObservabilityHttpModule` exposes a read-only response with `Cache-Control: no-store`:

```text
GET /ai-observability/v1/snapshot
```

The strict v1 snapshot separates lifetime totals from a rolling 15-minute window and includes
operation outcomes, duration estimates, normalized token categories, model time-to-first-output and
throughput, finish reasons, bounded operation/model/tool groups, and explicit overflow, replay,
rejected-field, signal-coverage, and abandonment diagnostics. Operation usage is the total view;
model-call usage is its provider/model breakdown, so the two must not be added together.

Aggregation has fixed ceilings for rolling buckets, dimension groups, active entities, replay
entries, and late-outcome corrections. Excess dimensions fold into `other`; stale or excessive
in-flight work is marked abandoned instead of growing memory without bound. The default collector
is process-local, so multi-replica applications must aggregate snapshots in their own control plane.

The HTTP module installs no authentication or authorization guard. Protect it with application-owned
authentication, tenant policy, CORS, and rate limits. The endpoint contains no tenant or user
dimension by design.

### Framework-neutral events and tests

Other runtimes can emit the same strict event union without importing Nest or the AI SDK:

```ts
import {
	InMemoryAiObservabilityCollector,
	type AiObservabilityEvent,
} from "@nestm/ai-sdk/observability/core";

const collector = new InMemoryAiObservabilityCollector();
collector.record([
	{
		schemaVersion: 1,
		eventId: "event-1",
		entityId: "operation-1",
		operationId: "operation-1",
		source: "custom-runtime",
		timestamp: Date.now(),
		type: "operation.started",
		operation: "agent-run",
	} satisfies AiObservabilityEvent,
]);
```

Tests can use `AiSdkObservabilityTestingModule` and `FakeAiObservabilityClock` for deterministic
snapshots without contacting a provider.

### Private local dashboard and multi-model playground

`apps/control-plane-web` is a private reference dashboard with strict runtime schema validation,
bounded upstream responses, last-good-snapshot retention, demo data, and coverage-aware views.
`apps/multi-model-playground` is a private Nest app that configures `AiSdkModule` and executes OpenAI,
Anthropic, and Google calls through `AiSdkService.generateText`. Provider failures are isolated, so
one failed model does not discard successful comparisons.

Both apps bind or connect only to loopback addresses. Provider SDKs, credentials, React, Next.js,
TanStack Query, and the dashboard runtime remain private workspace dependencies; the apps are absent
from package exports and published files. Copy the documented `.env.example` placeholders to your
own ignored environment only when running locally. Never commit a real `.env.local`.

```sh
pnpm run build
pnpm --filter @nestm/ai-sdk-playground dev
AI_OBSERVABILITY_API_URL=http://127.0.0.1:3001 \
	pnpm --filter @nestm/ai-sdk-control-plane-web dev
```

## Testing

The testing subpath wraps AI SDK's V4 mocks and never contacts a provider:

```ts
import { Test } from "@nestjs/testing";
import {
	MockLanguageModelV4,
	createAiSdkTestingModule,
	overrideAiSdkLanguageModel,
} from "@nestm/ai-sdk/testing";

const builder = Test.createTestingModule({
	imports: [
		createAiSdkTestingModule({
			requestDefaults: { maxRetries: 0, timeout: 5_000 },
		}),
	],
	providers: [SummaryService],
});

const model = new MockLanguageModelV4({ doGenerate: mockGenerateResult });
overrideAiSdkLanguageModel(builder, model);
const testingModule = await builder.compile();
```

`createMockAiProvider()` includes language, embedding, image, transcription, speech, reranking, video,
files, and skills support. `createMockFilesApi()` and `createMockSkillsApi()` record calls and return
deterministic provider references. Override helpers cover the registry, resolved defaults, every
default modality, and named agents/toolsets.

## Safety and telemetry

AI SDK telemetry and callbacks can contain prompts, generated content, tool arguments, and provider
metadata. The optional NestM observability adapter above intentionally rejects that content, but
other integrations may not. Configure `telemetry`/`experimental_telemetry` explicitly at each call
and review every exporter before enabling it for sensitive workloads.

Treat model-requested tool execution and approval as untrusted input. Apply application authorization,
tenant isolation, argument validation, timeouts, and audit logging before side effects. The package
does not grant tool permission or persist approval state.

APIs prefixed with `experimental_` intentionally track AI SDK 7 and may change in a compatible package
release when upstream experimental contracts change. Pin prerelease versions when adopting them.

## Non-goals

This package does not provide provider-specific configuration adapters, deprecated
`generateObject`/`streamObject` façades, UI framework hooks, an owned MCP client, RAG/vector-store
abstractions, custom realtime transports, a cross-runtime dispatcher, or durable Workflow Harness
persistence. Import provider capabilities from AI SDK or their provider packages directly.

## License

BSD-3-Clause
