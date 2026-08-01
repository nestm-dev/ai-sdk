import type {
	EmbeddingModel,
	ImageModel,
	LanguageModel,
	ProviderRegistryProvider,
	RerankingModel,
	SpeechModel,
	TranscriptionModel,
} from "ai";
import { createProviderRegistry, experimental_generateVideo } from "ai";

/** Provider records accepted by AI SDK's native `createProviderRegistry`. */
export type AiSdkProviderMap = Parameters<typeof createProviderRegistry>[0];

/** A single provider accepted by AI SDK's native provider registry. */
export type AiSdkProvider = AiSdkProviderMap[string];

/** Options forwarded unchanged to AI SDK's native provider registry. */
export type AiSdkProviderRegistryOptions<SEPARATOR extends string = ":"> = Omit<
	NonNullable<Parameters<typeof createProviderRegistry>[1]>,
	"separator"
> & {
	separator?: SEPARATOR;
};

export type AiSdkRegistryFor<
	PROVIDERS extends AiSdkProviderMap,
	SEPARATOR extends string = ":",
> = ProviderRegistryProvider<PROVIDERS, SEPARATOR>;

/** The widest registry shape used internally by the package. */
export type AiSdkRegistry = ProviderRegistryProvider<AiSdkProviderMap, string>;

export type AiSdkRegistryModelId<REGISTRY extends AiSdkRegistry, METHOD extends keyof REGISTRY> =
	REGISTRY extends ProviderRegistryProvider<infer PROVIDERS, infer SEPARATOR>
		? METHOD extends "files" | "skills"
			? Extract<keyof PROVIDERS, string>
			: `${Extract<keyof PROVIDERS, string>}${SEPARATOR}${string}`
		: string;

export type AiSdkDirectLanguageModel = Exclude<LanguageModel, string>;
export type AiSdkDirectEmbeddingModel = Exclude<EmbeddingModel, string>;
export type AiSdkDirectImageModel = Exclude<ImageModel, string>;
export type AiSdkDirectTranscriptionModel = Exclude<TranscriptionModel, string>;
export type AiSdkDirectSpeechModel = Exclude<SpeechModel, string>;
export type AiSdkDirectRerankingModel = Exclude<RerankingModel, string>;
export type AiSdkDirectVideoModel = Exclude<
	Parameters<typeof experimental_generateVideo>[0]["model"],
	string
>;
export type AiSdkFiles = ReturnType<AiSdkRegistry["files"]>;
export type AiSdkSkills = ReturnType<AiSdkRegistry["skills"]>;

export interface AiSdkDefaults<REGISTRY extends AiSdkRegistry = AiSdkRegistry> {
	language?: AiSdkRegistryModelId<REGISTRY, "languageModel"> | AiSdkDirectLanguageModel;
	embedding?: AiSdkRegistryModelId<REGISTRY, "embeddingModel"> | AiSdkDirectEmbeddingModel;
	image?: AiSdkRegistryModelId<REGISTRY, "imageModel"> | AiSdkDirectImageModel;
	transcription?:
		AiSdkRegistryModelId<REGISTRY, "transcriptionModel"> | AiSdkDirectTranscriptionModel;
	speech?: AiSdkRegistryModelId<REGISTRY, "speechModel"> | AiSdkDirectSpeechModel;
	reranking?: AiSdkRegistryModelId<REGISTRY, "rerankingModel"> | AiSdkDirectRerankingModel;
	video?: AiSdkRegistryModelId<REGISTRY, "videoModel"> | AiSdkDirectVideoModel;
	files?: AiSdkRegistryModelId<REGISTRY, "files"> | AiSdkFiles;
	skills?: AiSdkRegistryModelId<REGISTRY, "skills"> | AiSdkSkills;
}

interface AiSdkBaseModuleOptions<REGISTRY extends AiSdkRegistry> {
	defaults?: AiSdkDefaults<REGISTRY>;
}

export type AiSdkRegistryModuleOptions<REGISTRY extends AiSdkRegistry> =
	AiSdkBaseModuleOptions<REGISTRY> & {
		registry: REGISTRY;
		providers?: never;
		registryOptions?: never;
	};

export type AiSdkProvidersModuleOptions<
	PROVIDERS extends AiSdkProviderMap,
	SEPARATOR extends string = ":",
> = AiSdkBaseModuleOptions<AiSdkRegistryFor<NoInfer<PROVIDERS>, NoInfer<SEPARATOR>>> & {
	registry?: never;
	providers: PROVIDERS;
	registryOptions?: AiSdkProviderRegistryOptions<SEPARATOR>;
};

export interface AiSdkZeroConfigModuleOptions {
	registry?: undefined;
	providers?: undefined;
	registryOptions?: never;
	defaults?: {
		language?: AiSdkDirectLanguageModel;
		embedding?: AiSdkDirectEmbeddingModel;
		image?: AiSdkDirectImageModel;
		transcription?: AiSdkDirectTranscriptionModel;
		speech?: AiSdkDirectSpeechModel;
		reranking?: AiSdkDirectRerankingModel;
		video?: AiSdkDirectVideoModel;
		files?: AiSdkFiles;
		skills?: AiSdkSkills;
	};
}

export type AiSdkModuleOptions<
	PROVIDERS extends AiSdkProviderMap = AiSdkProviderMap,
	SEPARATOR extends string = string,
	REGISTRY extends AiSdkRegistry = AiSdkRegistryFor<PROVIDERS, SEPARATOR>,
> =
	| AiSdkRegistryModuleOptions<REGISTRY>
	| AiSdkProvidersModuleOptions<PROVIDERS, SEPARATOR>
	| AiSdkZeroConfigModuleOptions;

export interface AiSdkModuleExtras {
	isGlobal?: boolean;
}

export interface AiSdkOptionsFactory {
	createAiSdkOptions(): AiSdkModuleOptions | Promise<AiSdkModuleOptions>;
}

/**
 * Augment this interface with `{ registry: typeof registry }` to make that
 * registry the default generic argument of `AiSdkService` application-wide.
 */
export interface AiSdkTypeRegistry {}

export type RegisteredAiSdkRegistry = AiSdkTypeRegistry extends {
	registry: infer REGISTRY;
}
	? REGISTRY extends AiSdkRegistry
		? REGISTRY
		: AiSdkRegistry
	: AiSdkRegistry;

/** Identity helper that retains and validates provider names and separators. */
export function defineAiSdkConfig<const REGISTRY extends AiSdkRegistry>(
	options: AiSdkRegistryModuleOptions<NoInfer<REGISTRY>> & { registry: REGISTRY },
): AiSdkRegistryModuleOptions<REGISTRY>;
export function defineAiSdkConfig<
	const PROVIDERS extends AiSdkProviderMap,
	const SEPARATOR extends string = ":",
>(
	options: AiSdkProvidersModuleOptions<PROVIDERS, SEPARATOR>,
): AiSdkProvidersModuleOptions<PROVIDERS, SEPARATOR>;
export function defineAiSdkConfig(
	options: AiSdkZeroConfigModuleOptions,
): AiSdkZeroConfigModuleOptions;
export function defineAiSdkConfig(): AiSdkZeroConfigModuleOptions;
export function defineAiSdkConfig(options: AiSdkModuleOptions = {}): AiSdkModuleOptions {
	return options;
}
