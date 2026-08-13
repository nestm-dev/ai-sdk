import { Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
	AiSdkModule,
	AiSdkService,
	AiTool,
	AiToolset,
	InjectAiAgent,
	InjectAiLanguageModel,
	defineAiSdkConfig,
	getAiToolsetToken,
	type AiSdkAgent,
	type AiSdkDirectLanguageModel,
} from "@nestm/ai-sdk";
import { AiSdkHttpModule, AiSdkResponse, type AiSdkHttpResponse } from "@nestm/ai-sdk/http";
import {
	AiSdkHarnessModule,
	AiSdkHarnessRunner,
	durableSafeAiSdkHarnessFinalization,
} from "@nestm/ai-sdk/harness";
import {
	InMemoryAiSdkHarnessSessionLeaseManager,
	InMemoryAiSdkHarnessSessionStore,
} from "@nestm/ai-sdk/harness/testing";
import {
	MockLanguageModelV4,
	createAiSdkTestingModule,
	createMockAiProvider,
	overrideAiSdkLanguageModel,
} from "@nestm/ai-sdk/testing";
import { Output, createProviderRegistry, type ToolSet } from "ai";
import { z } from "zod";

const provider = createMockAiProvider();
const registry = createProviderRegistry({ mock: provider });
const config = defineAiSdkConfig({
	registry,
	requestDefaults: {
		maxRetries: 1,
		timeout: { totalMs: 30_000, stepMs: 10_000, chunkMs: 5_000 },
	},
	defaults: {
		language: provider.languageModel("default"),
		embedding: provider.embeddingModel("default"),
		image: provider.imageModel("default"),
		transcription: provider.transcriptionModel("default"),
		speech: provider.speechModel("default"),
		reranking: provider.rerankingModel("default"),
		video: provider.videoModel("default"),
		files: provider.files(),
		skills: provider.skills(),
	},
});

declare module "@nestm/ai-sdk" {
	interface AiSdkTypeRegistry {
		registry: typeof registry;
	}
}

@AiToolset("echo")
@Injectable()
class EchoToolset {
	@AiTool({
		description: "Echo input",
		inputSchema: z.object({ value: z.string() }),
		outputSchema: z.object({ value: z.string() }),
	})
	echo(input: { value: string }): { value: string } {
		return input;
	}
}

const rootModule = AiSdkModule.forRoot(config);
const featureModule = AiSdkModule.forFeature({
	toolsets: [EchoToolset],
	agents: [
		{
			name: "echo",
			inject: [AiSdkService, getAiToolsetToken("echo")],
			useFactory: (ai: AiSdkService, tools: ToolSet) => ({
				model: ai.languageModel(),
				tools,
			}),
		},
	],
});
const httpModule = AiSdkHttpModule.register();
const harnessStore = new InMemoryAiSdkHarnessSessionStore({ durability: "durable" });
const harnessLeases = new InMemoryAiSdkHarnessSessionLeaseManager();
const harnessModule = AiSdkHarnessModule.forRoot({
	sessionStore: harnessStore,
	leaseManager: harnessLeases,
	finalization: durableSafeAiSdkHarnessFinalization,
	isGlobal: false,
});
const harnessRunner = new AiSdkHarnessRunner({
	sessionStore: harnessStore,
	leaseManager: harnessLeases,
});
const testingModule = createAiSdkTestingModule({ requestDefaults: { maxRetries: 0 } });
const httpResponse: AiSdkHttpResponse = AiSdkResponse.text(new ReadableStream<string>());
void httpResponse.resolve({ abortSignal: new AbortController().signal });

@Injectable()
class Consumer {
	constructor(
		private readonly ai: AiSdkService,
		@InjectAiLanguageModel()
		readonly model: AiSdkDirectLanguageModel,
		@InjectAiAgent("echo") readonly agent: AiSdkAgent,
	) {}

	run() {
		return this.ai.generateText({
			model: this.model,
			prompt: "typed",
			output: Output.object({ schema: z.object({ answer: z.string() }) }),
		});
	}
}

const builder = Test.createTestingModule({
	imports: [testingModule],
	providers: [Consumer],
});
overrideAiSdkLanguageModel(builder, new MockLanguageModelV4());

export {
	Consumer,
	builder,
	featureModule,
	harnessModule,
	harnessRunner,
	httpModule,
	httpResponse,
	rootModule,
	testingModule,
};
