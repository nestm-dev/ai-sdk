# @nestm/ai-sdk

Provider-neutral [AI SDK](https://ai-sdk.dev) 7 integration for **NestJS 12**. It adds typed
configuration and dependency injection around AI SDK models, tools, agents, uploads, and streaming
HTTP responses without hiding the upstream APIs.

- `AiSdkModule.forRoot()` and `forRootAsync()` with provider registries or zero configuration
- Optional eager defaults for every AI SDK model modality plus files and skills
- `AiSdkService` façades that preserve the exact upstream call signatures
- Decorated Nest providers with `@AiToolset()` and `@AiTool()`
- Named toolsets and agents with `useValue`, `useFactory`, `useClass`, and `useExisting`
- Express and Fastify response streaming through `@nestm/ai-sdk/http`
- Full AI SDK V4 mocks and Nest overrides through `@nestm/ai-sdk/testing`

Provider SDKs remain application-owned. Install and configure only the providers your application
uses; this package does not depend on OpenAI, Anthropic, Google, MCP, or another concrete provider.

## Requirements

- Node 22.12 or newer
- NestJS `^12.0.0-alpha.5`
- AI SDK `>=7 <8`
- ESM

> **NestJS prerelease peer note:** current NestJS 12 alpha packages still declare NestJS 11 ranges
> for some sibling peers. With pnpm, allow NestJS 12 for those peers in `pnpm-workspace.yaml`. With
> npm, use an equivalent override or `--legacy-peer-deps` until the upstream ranges are updated.

## Installation

```bash
pnpm add @nestm/ai-sdk ai @nestjs/common @nestjs/core reflect-metadata rxjs
```

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

The module does not merge operation options. Models, tools, structured output, retries, timeouts,
headers, provider options, callbacks, telemetry, sandbox settings, approvals, and runtime context stay
visible at each call site. Errors thrown by AI SDK or providers pass through unchanged; only module
configuration failures use `AiSdkConfigurationError`.

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
import { AiSdkHttpModule, AiSdkResponse } from "@nestm/ai-sdk/http";

@Module({ imports: [AiSdkHttpModule.register()] })
export class HttpModule {}

@Controller("ai")
export class AiController {
	constructor(private readonly ai: AiSdkService) {}

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

The bridge preserves status, status text, headers, multiple `Set-Cookie` values, binary chunks,
backpressure, and disconnect cancellation for Express and Fastify. Errors before headers are sent
remain available to Nest's exception pipeline; errors after a stream is committed terminate the
connection. For custom integrations, inject `AiSdkResponseSender` or call `sendAiSdkResponse()`.

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
	imports: [createAiSdkTestingModule()],
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
metadata. Configure `telemetry`/`experimental_telemetry` explicitly at each call and review exporters
before enabling them for sensitive workloads.

Treat model-requested tool execution and approval as untrusted input. Apply application authorization,
tenant isolation, argument validation, timeouts, and audit logging before side effects. The package
does not grant tool permission or persist approval state.

APIs prefixed with `experimental_` intentionally track AI SDK 7 and may change in a compatible package
release when upstream experimental contracts change. Pin prerelease versions when adopting them.

## Non-goals

This package does not provide provider-specific configuration adapters, deprecated
`generateObject`/`streamObject` façades, UI framework hooks, an owned MCP client, RAG/vector-store
abstractions, or custom realtime transports. Import those capabilities from AI SDK or their provider
packages directly.

## License

BSD-3-Clause
