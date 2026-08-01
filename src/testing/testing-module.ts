import type { DynamicModule } from "@nestjs/common";
import { AiSdkModule } from "../ai-sdk.module.js";
import type { AiSdkDefaults } from "../ai-sdk.types.js";
import {
	createMockAiProvider,
	type CreateMockAiProviderOptions,
	type MockAiProviderV4,
} from "./mock-provider.js";

export interface AiSdkTestingModuleOptions {
	/** Registry key for the mock provider. Defaults to `mock`. */
	providerName?: string;
	/** A complete mock provider, or options used to construct one. */
	provider?: MockAiProviderV4 | CreateMockAiProviderOptions;
	/** Overrides for the generated direct-model and upload defaults. */
	defaults?: AiSdkDefaults;
	/** Testing modules are local by default to prevent cross-test leakage. */
	isGlobal?: boolean;
}

function isMockProvider(
	value: MockAiProviderV4 | CreateMockAiProviderOptions,
): value is MockAiProviderV4 {
	return "specificationVersion" in value && typeof value.languageModel === "function";
}

/**
 * Returns a ready-to-import `AiSdkModule` backed only by AI SDK V4 mocks.
 * It never performs network I/O and configures a default for every modality.
 */
export function createAiSdkTestingModule(options: AiSdkTestingModuleOptions = {}): DynamicModule {
	const providerName = options.providerName ?? "mock";
	const providerSource = options.provider ?? {};
	const provider = isMockProvider(providerSource)
		? providerSource
		: createMockAiProvider(providerSource);
	const defaults = options.defaults;

	return AiSdkModule.forRoot({
		providers: { [providerName]: provider },
		defaults: {
			language: defaults?.language ?? provider.languageModel("default"),
			embedding: defaults?.embedding ?? provider.embeddingModel("default"),
			image: defaults?.image ?? provider.imageModel("default"),
			transcription: defaults?.transcription ?? provider.transcriptionModel("default"),
			speech: defaults?.speech ?? provider.speechModel("default"),
			reranking: defaults?.reranking ?? provider.rerankingModel("default"),
			video: defaults?.video ?? provider.videoModel("default"),
			files: defaults?.files ?? provider.files(),
			skills: defaults?.skills ?? provider.skills(),
		},
		isGlobal: options.isGlobal ?? false,
	});
}
