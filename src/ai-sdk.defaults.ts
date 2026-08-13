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
	AI_SDK_REQUEST_DEFAULTS,
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
	AiSdkRequestDefaults,
	AiSdkRegistry,
	AiSdkRegistryModelId,
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

const MAX_TIMER_DURATION_MS = 2_147_483_647;
const REQUEST_DEFAULT_KEYS = new Set(["maxRetries", "timeout"]);
const TIMEOUT_KEYS = new Set(["totalMs", "stepMs", "firstChunkMs", "chunkMs", "toolMs", "tools"]);
const PER_TOOL_TIMEOUT_KEY = /^.+Ms$/u;

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
	assertRequestDefaults(options.requestDefaults);
}

function assertRequestDefaults(defaults: AiSdkRequestDefaults | undefined): void {
	if (defaults === undefined) return;
	if (typeof defaults !== "object" || defaults === null || Array.isArray(defaults)) {
		throw new AiSdkConfigurationError(
			"INVALID_OPTIONS",
			"`requestDefaults` must be an options object.",
		);
	}
	assertKnownKeys(defaults, REQUEST_DEFAULT_KEYS, "requestDefaults");

	if (defaults.maxRetries !== undefined) {
		if (!Number.isInteger(defaults.maxRetries) || defaults.maxRetries < 0) {
			throw new AiSdkConfigurationError(
				"INVALID_OPTIONS",
				"`requestDefaults.maxRetries` must be an integer greater than or equal to 0.",
			);
		}
	}

	const timeout = defaults.timeout;
	if (timeout === undefined) return;
	if (typeof timeout === "number") {
		assertPositiveDuration(timeout, "requestDefaults.timeout");
		return;
	}
	if (typeof timeout !== "object" || timeout === null || Array.isArray(timeout)) {
		throw new AiSdkConfigurationError(
			"INVALID_OPTIONS",
			"`requestDefaults.timeout` must be a positive duration or timeout configuration.",
		);
	}
	assertKnownKeys(timeout, TIMEOUT_KEYS, "requestDefaults.timeout");

	for (const key of ["totalMs", "stepMs", "firstChunkMs", "chunkMs", "toolMs"] as const) {
		const value = timeout[key];
		if (value !== undefined) assertPositiveDuration(value, `requestDefaults.timeout.${key}`);
	}
	const toolTimeouts: unknown = timeout.tools;
	if (toolTimeouts !== undefined) {
		if (typeof toolTimeouts !== "object" || toolTimeouts === null || Array.isArray(toolTimeouts)) {
			throw new AiSdkConfigurationError(
				"INVALID_OPTIONS",
				"`requestDefaults.timeout.tools` must be a timeout record.",
			);
		}
		for (const [key, value] of Object.entries(toolTimeouts)) {
			if (!PER_TOOL_TIMEOUT_KEY.test(key)) {
				throw new AiSdkConfigurationError(
					"INVALID_OPTIONS",
					`\`requestDefaults.timeout.tools.${key}\` must use a non-empty \`{toolName}Ms\` key.`,
				);
			}
			if (value !== undefined) {
				assertPositiveDuration(value, `requestDefaults.timeout.tools.${key}`);
			}
		}
	}
}

function assertKnownKeys(value: object, allowed: ReadonlySet<string>, path: string): void {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			throw new AiSdkConfigurationError(
				"INVALID_OPTIONS",
				`\`${path}.${key}\` is not a supported option.`,
			);
		}
	}
}

function assertPositiveDuration(value: unknown, path: string): void {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value <= 0 ||
		value > MAX_TIMER_DURATION_MS
	) {
		throw new AiSdkConfigurationError(
			"INVALID_OPTIONS",
			`\`${path}\` must be an integer from 1 through ${MAX_TIMER_DURATION_MS}.`,
		);
	}
}

function resolveRequestDefaults(options: AiSdkModuleOptions): AiSdkRequestDefaults {
	assertModuleOptions(options);
	const defaults = options.requestDefaults;
	if (defaults === undefined) return {};

	const resolved = {
		...(defaults.maxRetries === undefined ? {} : { maxRetries: defaults.maxRetries }),
		...(defaults.timeout === undefined ? {} : { timeout: cloneTimeout(defaults.timeout) }),
	} satisfies AiSdkRequestDefaults;
	return Object.freeze(resolved);
}

function cloneTimeout(
	timeout: NonNullable<AiSdkRequestDefaults["timeout"]>,
): NonNullable<AiSdkRequestDefaults["timeout"]> {
	if (typeof timeout === "number") return timeout;
	const cloned = { ...timeout };
	if (timeout.tools !== undefined) cloned.tools = Object.freeze({ ...timeout.tools });
	return Object.freeze(cloned);
}

function createRegistry(options: AiSdkModuleOptions): AiSdkRegistry | undefined {
	assertModuleOptions(options);
	if (options.registry !== undefined) return options.registry;
	if (options.providers === undefined) return undefined;
	return createProviderRegistry(options.providers, options.registryOptions);
}

function resolveDefault<
	REGISTRY extends AiSdkRegistry,
	METHOD extends RegistryMethod,
	RESOLVED extends object,
>(
	registry: REGISTRY | undefined,
	method: METHOD,
	configured: NoInfer<RESOLVED> | AiSdkRegistryModelId<REGISTRY, METHOD> | undefined,
	resolve: (registry: REGISTRY, id: AiSdkRegistryModelId<REGISTRY, METHOD>) => RESOLVED,
): RESOLVED | undefined {
	if (configured === undefined || typeof configured !== "string") return configured;
	if (registry === undefined) {
		throw new AiSdkConfigurationError(
			"INVALID_DEFAULT",
			`The ${method} default is a registry reference, but no registry is configured.`,
		);
	}
	try {
		return resolve(registry, configured);
	} catch (cause) {
		throw new AiSdkConfigurationError(
			"INVALID_DEFAULT",
			`Unable to resolve the configured ${method} default "${configured}".`,
			{ cause },
		);
	}
}

function resolveLanguageModel<REGISTRY extends AiSdkRegistry>(
	registry: REGISTRY,
	id: AiSdkRegistryModelId<REGISTRY, "languageModel">,
): AiSdkDirectLanguageModel {
	return registry.languageModel(id);
}

function resolveEmbeddingModel<REGISTRY extends AiSdkRegistry>(
	registry: REGISTRY,
	id: AiSdkRegistryModelId<REGISTRY, "embeddingModel">,
): AiSdkDirectEmbeddingModel {
	return registry.embeddingModel(id);
}

function resolveImageModel<REGISTRY extends AiSdkRegistry>(
	registry: REGISTRY,
	id: AiSdkRegistryModelId<REGISTRY, "imageModel">,
): AiSdkDirectImageModel {
	return registry.imageModel(id);
}

function resolveTranscriptionModel<REGISTRY extends AiSdkRegistry>(
	registry: REGISTRY,
	id: AiSdkRegistryModelId<REGISTRY, "transcriptionModel">,
): AiSdkDirectTranscriptionModel {
	return registry.transcriptionModel(id);
}

function resolveSpeechModel<REGISTRY extends AiSdkRegistry>(
	registry: REGISTRY,
	id: AiSdkRegistryModelId<REGISTRY, "speechModel">,
): AiSdkDirectSpeechModel {
	return registry.speechModel(id);
}

function resolveRerankingModel<REGISTRY extends AiSdkRegistry>(
	registry: REGISTRY,
	id: AiSdkRegistryModelId<REGISTRY, "rerankingModel">,
): AiSdkDirectRerankingModel {
	return registry.rerankingModel(id);
}

function resolveVideoModel<REGISTRY extends AiSdkRegistry>(
	registry: REGISTRY,
	id: AiSdkRegistryModelId<REGISTRY, "videoModel">,
): AiSdkDirectVideoModel {
	return registry.videoModel(id);
}

function resolveFiles<REGISTRY extends AiSdkRegistry>(
	registry: REGISTRY,
	id: AiSdkRegistryModelId<REGISTRY, "files">,
): AiSdkFiles {
	return registry.files(id);
}

function resolveSkills<REGISTRY extends AiSdkRegistry>(
	registry: REGISTRY,
	id: AiSdkRegistryModelId<REGISTRY, "skills">,
): AiSdkSkills {
	return registry.skills(id);
}

function resolveDefaults(
	options: AiSdkModuleOptions,
	registry: AiSdkRegistry | undefined,
): AiSdkResolvedDefaults {
	const defaults = options.defaults;
	if (defaults === undefined) return {};
	return {
		language: resolveDefault(registry, "languageModel", defaults.language, resolveLanguageModel),
		embedding: resolveDefault(
			registry,
			"embeddingModel",
			defaults.embedding,
			resolveEmbeddingModel,
		),
		image: resolveDefault(registry, "imageModel", defaults.image, resolveImageModel),
		transcription: resolveDefault(
			registry,
			"transcriptionModel",
			defaults.transcription,
			resolveTranscriptionModel,
		),
		speech: resolveDefault(registry, "speechModel", defaults.speech, resolveSpeechModel),
		reranking: resolveDefault(
			registry,
			"rerankingModel",
			defaults.reranking,
			resolveRerankingModel,
		),
		video: resolveDefault(registry, "videoModel", defaults.video, resolveVideoModel),
		files: resolveDefault(registry, "files", defaults.files, resolveFiles),
		skills: resolveDefault(registry, "skills", defaults.skills, resolveSkills),
	};
}

const defaultTokenEntries = [
	["language", AI_SDK_LANGUAGE_MODEL],
	["embedding", AI_SDK_EMBEDDING_MODEL],
	["image", AI_SDK_IMAGE_MODEL],
	["transcription", AI_SDK_TRANSCRIPTION_MODEL],
	["speech", AI_SDK_SPEECH_MODEL],
	["reranking", AI_SDK_RERANKING_MODEL],
	["video", AI_SDK_VIDEO_MODEL],
	["files", AI_SDK_FILES],
	["skills", AI_SDK_SKILLS],
] as const satisfies ReadonlyArray<readonly [keyof AiSdkResolvedDefaults, symbol]>;

export const aiSdkCoreProviders: Provider[] = [
	{
		provide: AI_SDK_REQUEST_DEFAULTS,
		inject: [AI_SDK_MODULE_OPTIONS],
		useFactory: resolveRequestDefaults,
	},
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
	...defaultTokenEntries.map(([key, token]): Provider => ({
		provide: token,
		inject: [AI_SDK_RESOLVED_DEFAULTS],
		scope: Scope.TRANSIENT,
		useFactory: (defaults: AiSdkResolvedDefaults): unknown => {
			const value = defaults[key];
			if (value === undefined) {
				throw new AiSdkConfigurationError(
					"MISSING_DEFAULT",
					`No default ${key} provider or model is configured.`,
				);
			}
			return value;
		},
	})),
];
