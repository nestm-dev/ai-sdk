import { Scope } from "@nestjs/common";
import type { Provider } from "@nestjs/common";
import { createProviderRegistry } from "ai";
import { AiSdkConfigurationError } from "./ai-sdk.error.ts";
import {
	AI_SDK_EMBEDDING_MODEL,
	AI_SDK_FILES,
	AI_SDK_IMAGE_MODEL,
	AI_SDK_LANGUAGE_MODEL,
	AI_SDK_MODULE_OPTIONS,
	AI_SDK_REGISTRY,
	AI_SDK_RERANKING_MODEL,
	AI_SDK_RESOLVED_DEFAULTS,
	AI_SDK_SKILLS,
	AI_SDK_SPEECH_MODEL,
	AI_SDK_TRANSCRIPTION_MODEL,
	AI_SDK_VIDEO_MODEL,
} from "./ai-sdk.tokens.ts";
import type {
	AiSdkDirectEmbeddingModel,
	AiSdkDirectImageModel,
	AiSdkDirectLanguageModel,
	AiSdkDirectRerankingModel,
	AiSdkDirectSpeechModel,
	AiSdkDirectTranscriptionModel,
	AiSdkDirectVideoModel,
	AiSdkFiles,
	AiSdkModuleOptions,
	AiSdkRegistry,
	AiSdkSkills,
} from "./ai-sdk.types.ts";

export interface AiSdkResolvedDefaults {
	language?: AiSdkDirectLanguageModel;
	embedding?: AiSdkDirectEmbeddingModel;
	image?: AiSdkDirectImageModel;
	transcription?: AiSdkDirectTranscriptionModel;
	speech?: AiSdkDirectSpeechModel;
	reranking?: AiSdkDirectRerankingModel;
	video?: AiSdkDirectVideoModel;
	files?: AiSdkFiles;
	skills?: AiSdkSkills;
}

type RegistryMethod = keyof Pick<
	AiSdkRegistry,
	| "languageModel"
	| "embeddingModel"
	| "imageModel"
	| "transcriptionModel"
	| "speechModel"
	| "rerankingModel"
	| "videoModel"
	| "files"
	| "skills"
>;

function assertModuleOptions(options: AiSdkModuleOptions): void {
	if (options.registry !== undefined && options.providers !== undefined) {
		throw new AiSdkConfigurationError(
			"INVALID_OPTIONS",
			"Configure either `registry` or `providers`, not both.",
		);
	}
	if (options.registryOptions !== undefined && options.providers === undefined) {
		throw new AiSdkConfigurationError(
			"INVALID_OPTIONS",
			"`registryOptions` requires a `providers` map.",
		);
	}
}

function createRegistry(options: AiSdkModuleOptions): AiSdkRegistry | undefined {
	assertModuleOptions(options);
	if (options.registry !== undefined) return options.registry;
	if (options.providers === undefined) return undefined;
	return createProviderRegistry(options.providers, options.registryOptions);
}

function resolveDefault(
	registry: AiSdkRegistry | undefined,
	method: RegistryMethod,
	configured: unknown,
): unknown {
	if (configured === undefined || typeof configured !== "string") return configured;
	if (registry === undefined) {
		throw new AiSdkConfigurationError(
			"INVALID_DEFAULT",
			`The ${method} default is a registry reference, but no registry is configured.`,
		);
	}
	try {
		const resolver = registry[method] as (id: string) => unknown;
		return resolver.call(registry, configured);
	} catch (cause) {
		throw new AiSdkConfigurationError(
			"INVALID_DEFAULT",
			`Unable to resolve the configured ${method} default "${configured}".`,
			{ cause },
		);
	}
}

function resolveDefaults(
	options: AiSdkModuleOptions,
	registry: AiSdkRegistry | undefined,
): AiSdkResolvedDefaults {
	const defaults = options.defaults;
	if (defaults === undefined) return {};
	return {
		language: resolveDefault(registry, "languageModel", defaults.language) as
			AiSdkDirectLanguageModel | undefined,
		embedding: resolveDefault(registry, "embeddingModel", defaults.embedding) as
			AiSdkDirectEmbeddingModel | undefined,
		image: resolveDefault(registry, "imageModel", defaults.image) as
			AiSdkDirectImageModel | undefined,
		transcription: resolveDefault(registry, "transcriptionModel", defaults.transcription) as
			AiSdkDirectTranscriptionModel | undefined,
		speech: resolveDefault(registry, "speechModel", defaults.speech) as
			AiSdkDirectSpeechModel | undefined,
		reranking: resolveDefault(registry, "rerankingModel", defaults.reranking) as
			AiSdkDirectRerankingModel | undefined,
		video: resolveDefault(registry, "videoModel", defaults.video) as
			AiSdkDirectVideoModel | undefined,
		files: resolveDefault(registry, "files", defaults.files) as AiSdkFiles | undefined,
		skills: resolveDefault(registry, "skills", defaults.skills) as AiSdkSkills | undefined,
	};
}

const defaultTokenMap = {
	language: AI_SDK_LANGUAGE_MODEL,
	embedding: AI_SDK_EMBEDDING_MODEL,
	image: AI_SDK_IMAGE_MODEL,
	transcription: AI_SDK_TRANSCRIPTION_MODEL,
	speech: AI_SDK_SPEECH_MODEL,
	reranking: AI_SDK_RERANKING_MODEL,
	video: AI_SDK_VIDEO_MODEL,
	files: AI_SDK_FILES,
	skills: AI_SDK_SKILLS,
} as const;

export const aiSdkCoreProviders: Provider[] = [
	{
		provide: AI_SDK_REGISTRY,
		inject: [AI_SDK_MODULE_OPTIONS],
		useFactory: createRegistry,
	},
	{
		provide: AI_SDK_RESOLVED_DEFAULTS,
		inject: [AI_SDK_MODULE_OPTIONS, AI_SDK_REGISTRY],
		useFactory: resolveDefaults,
	},
	...Object.entries(defaultTokenMap).map(([key, token]): Provider => ({
		provide: token,
		inject: [AI_SDK_RESOLVED_DEFAULTS],
		scope: Scope.TRANSIENT,
		useFactory: (defaults: AiSdkResolvedDefaults): unknown => {
			const defaultName = key as keyof AiSdkResolvedDefaults;
			const value = defaults[defaultName];
			if (value === undefined) {
				throw new AiSdkConfigurationError(
					"MISSING_DEFAULT",
					`No default ${defaultName} provider or model is configured.`,
				);
			}
			return value;
		},
	})),
];
