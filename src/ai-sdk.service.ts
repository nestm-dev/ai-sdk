import { Inject, Injectable, Optional } from "@nestjs/common";
import {
	embed,
	embedMany,
	experimental_generateVideo,
	experimental_streamTranscribe,
	experimental_streamTranslate,
	generateImage,
	generateSpeech,
	generateText,
	getTotalTimeoutMs,
	registerTelemetry,
	rerank,
	streamText,
	transcribe,
	uploadFile,
	uploadSkill,
} from "ai";
import { combineAbortSignals } from "./ai-sdk.abort.ts";
import { AiSdkConfigurationError } from "./ai-sdk.error.ts";
import type { AiSdkResolvedDefaults } from "./ai-sdk.defaults.ts";
import {
	AI_SDK_REGISTRY,
	AI_SDK_REQUEST_DEFAULTS,
	AI_SDK_RESOLVED_DEFAULTS,
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
	AiSdkRegistry,
	AiSdkRegistryModelId,
	AiSdkRequestDefaults,
	AiSdkSkills,
	RegisteredAiSdkRegistry,
} from "./ai-sdk.types.ts";

type UnaryAiSdkOperation = (options: never) => unknown;

interface OperationRequestControls {
	readonly retries: boolean;
	readonly timeout: "native" | "native-nonstream" | "signal" | "none";
}

const RETRY_AND_NATIVE_TIMEOUT = { retries: true, timeout: "native" } as const;
const RETRY_AND_NONSTREAM_TIMEOUT = { retries: true, timeout: "native-nonstream" } as const;
const RETRY_AND_SIGNAL_TIMEOUT = { retries: true, timeout: "signal" } as const;
const SIGNAL_TIMEOUT = { retries: false, timeout: "signal" } as const;

type RegistryResult<
	REGISTRY extends AiSdkRegistry,
	METHOD extends keyof REGISTRY,
> = REGISTRY[METHOD] extends (...arguments_: readonly unknown[]) => infer RESULT ? RESULT : never;

@Injectable()
export class AiSdkService<REGISTRY extends AiSdkRegistry = RegisteredAiSdkRegistry> {
	readonly generateText: typeof generateText;
	readonly streamText: typeof streamText;
	readonly embed: typeof embed;
	readonly embedMany: typeof embedMany;
	readonly generateImage: typeof generateImage;
	readonly rerank: typeof rerank;
	readonly generateSpeech: typeof generateSpeech;
	readonly transcribe: typeof transcribe;
	readonly uploadFile: typeof uploadFile = uploadFile;
	readonly uploadSkill: typeof uploadSkill = uploadSkill;
	readonly experimental_generateVideo: typeof experimental_generateVideo;
	readonly experimental_streamTranscribe: typeof experimental_streamTranscribe;
	readonly experimental_streamTranslate: typeof experimental_streamTranslate;
	readonly registerTelemetry: typeof registerTelemetry = registerTelemetry;

	constructor(
		@Inject(AI_SDK_REGISTRY) readonly registry: REGISTRY | undefined,
		@Inject(AI_SDK_RESOLVED_DEFAULTS)
		private readonly defaults: AiSdkResolvedDefaults,
		@Optional()
		@Inject(AI_SDK_REQUEST_DEFAULTS)
		requestDefaults: AiSdkRequestDefaults = {},
	) {
		this.generateText = withRequestDefaults(
			generateText,
			requestDefaults,
			RETRY_AND_NONSTREAM_TIMEOUT,
		);
		this.streamText = withRequestDefaults(streamText, requestDefaults, RETRY_AND_NATIVE_TIMEOUT);
		this.embed = withRequestDefaults(embed, requestDefaults, RETRY_AND_SIGNAL_TIMEOUT);
		this.embedMany = withRequestDefaults(embedMany, requestDefaults, RETRY_AND_SIGNAL_TIMEOUT);
		this.generateImage = withRequestDefaults(
			generateImage,
			requestDefaults,
			RETRY_AND_SIGNAL_TIMEOUT,
		);
		this.rerank = withRequestDefaults(rerank, requestDefaults, RETRY_AND_SIGNAL_TIMEOUT);
		this.generateSpeech = withRequestDefaults(
			generateSpeech,
			requestDefaults,
			RETRY_AND_SIGNAL_TIMEOUT,
		);
		this.transcribe = withRequestDefaults(transcribe, requestDefaults, RETRY_AND_SIGNAL_TIMEOUT);
		this.experimental_generateVideo = withRequestDefaults(
			experimental_generateVideo,
			requestDefaults,
			RETRY_AND_SIGNAL_TIMEOUT,
		);
		this.experimental_streamTranscribe = withRequestDefaults(
			experimental_streamTranscribe,
			requestDefaults,
			SIGNAL_TIMEOUT,
		);
		this.experimental_streamTranslate = withRequestDefaults(
			experimental_streamTranslate,
			requestDefaults,
			SIGNAL_TIMEOUT,
		);
	}

	languageModel(
		id?: AiSdkRegistryModelId<REGISTRY, "languageModel">,
	): RegistryResult<REGISTRY, "languageModel"> | AiSdkDirectLanguageModel {
		return this.resolve("languageModel", "language", id, (registry, reference) =>
			registry.languageModel(reference),
		);
	}

	embeddingModel(
		id?: AiSdkRegistryModelId<REGISTRY, "embeddingModel">,
	): RegistryResult<REGISTRY, "embeddingModel"> | AiSdkDirectEmbeddingModel {
		return this.resolve("embeddingModel", "embedding", id, (registry, reference) =>
			registry.embeddingModel(reference),
		);
	}

	imageModel(
		id?: AiSdkRegistryModelId<REGISTRY, "imageModel">,
	): RegistryResult<REGISTRY, "imageModel"> | AiSdkDirectImageModel {
		return this.resolve("imageModel", "image", id, (registry, reference) =>
			registry.imageModel(reference),
		);
	}

	transcriptionModel(
		id?: AiSdkRegistryModelId<REGISTRY, "transcriptionModel">,
	): RegistryResult<REGISTRY, "transcriptionModel"> | AiSdkDirectTranscriptionModel {
		return this.resolve("transcriptionModel", "transcription", id, (registry, reference) =>
			registry.transcriptionModel(reference),
		);
	}

	speechModel(
		id?: AiSdkRegistryModelId<REGISTRY, "speechModel">,
	): RegistryResult<REGISTRY, "speechModel"> | AiSdkDirectSpeechModel {
		return this.resolve("speechModel", "speech", id, (registry, reference) =>
			registry.speechModel(reference),
		);
	}

	rerankingModel(
		id?: AiSdkRegistryModelId<REGISTRY, "rerankingModel">,
	): RegistryResult<REGISTRY, "rerankingModel"> | AiSdkDirectRerankingModel {
		return this.resolve("rerankingModel", "reranking", id, (registry, reference) =>
			registry.rerankingModel(reference),
		);
	}

	videoModel(
		id?: AiSdkRegistryModelId<REGISTRY, "videoModel">,
	): RegistryResult<REGISTRY, "videoModel"> | AiSdkDirectVideoModel {
		return this.resolve("videoModel", "video", id, (registry, reference) =>
			registry.videoModel(reference),
		);
	}

	files(id?: AiSdkRegistryModelId<REGISTRY, "files">): AiSdkFiles {
		return this.resolve("files", "files", id, (registry, reference) => registry.files(reference));
	}

	skills(id?: AiSdkRegistryModelId<REGISTRY, "skills">): AiSdkSkills {
		return this.resolve("skills", "skills", id, (registry, reference) =>
			registry.skills(reference),
		);
	}

	private resolve<DEFAULT extends keyof AiSdkResolvedDefaults, ID extends string, RESULT>(
		method: keyof AiSdkRegistry,
		defaultName: DEFAULT,
		id: ID | undefined,
		resolve: (registry: REGISTRY, id: ID) => RESULT,
	): RESULT | NonNullable<AiSdkResolvedDefaults[DEFAULT]> {
		if (id !== undefined) {
			if (this.registry === undefined) {
				throw new AiSdkConfigurationError(
					"MISSING_REGISTRY",
					`Cannot resolve ${method} "${id}" because no provider registry is configured.`,
				);
			}
			try {
				return resolve(this.registry, id);
			} catch (cause) {
				throw new AiSdkConfigurationError(
					"INVALID_REFERENCE",
					`Unable to resolve ${method} registry reference "${id}".`,
					{ cause },
				);
			}
		}

		const configured = this.defaults[defaultName];
		if (configured === undefined) {
			throw new AiSdkConfigurationError(
				"MISSING_DEFAULT",
				`No default ${defaultName} provider or model is configured.`,
			);
		}
		return configured;
	}
}

function withRequestDefaults<OPERATION extends UnaryAiSdkOperation>(
	operation: OPERATION,
	defaults: AiSdkRequestDefaults,
	controls: OperationRequestControls,
): OPERATION {
	const appliesRetries = controls.retries && defaults.maxRetries !== undefined;
	const appliesTimeout = controls.timeout !== "none" && defaults.timeout !== undefined;
	if (!appliesRetries && !appliesTimeout) return operation;

	// A function proxy retains the exact upstream generic/overload type while
	// changing only the unary options object passed to the operation.
	return new Proxy(operation, {
		apply(target, _thisArgument: unknown, argumentsList: unknown[]): unknown {
			if (argumentsList.length === 0) return Reflect.apply(target, undefined, argumentsList);
			const forwardedArguments = [...argumentsList];
			forwardedArguments[0] = mergeRequestDefaults(argumentsList[0], defaults, controls);
			return Reflect.apply(target, undefined, forwardedArguments);
		},
	});
}

function mergeRequestDefaults(
	options: unknown,
	defaults: AiSdkRequestDefaults,
	controls: OperationRequestControls,
): unknown {
	if (!isRecord(options)) return options;
	const merged: Record<PropertyKey, unknown> = { ...options };

	if (controls.retries && options.maxRetries === undefined && defaults.maxRetries !== undefined) {
		merged.maxRetries = defaults.maxRetries;
	}

	if (defaults.timeout === undefined) return merged;
	if (controls.timeout === "native" || controls.timeout === "native-nonstream") {
		if (options.timeout === undefined) {
			merged.timeout =
				controls.timeout === "native-nonstream"
					? withoutStreamingTimeouts(defaults.timeout)
					: defaults.timeout;
		}
		return merged;
	}
	if (controls.timeout !== "signal") return merged;

	const totalTimeoutMs = getTotalTimeoutMs(defaults.timeout);
	if (totalTimeoutMs === undefined) return merged;
	const timeoutSignal = AbortSignal.timeout(totalTimeoutMs);
	merged.abortSignal = combineAbortSignals(options.abortSignal, timeoutSignal);
	return merged;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return typeof value === "object" && value !== null;
}

function withoutStreamingTimeouts(
	timeout: NonNullable<AiSdkRequestDefaults["timeout"]>,
): NonNullable<AiSdkRequestDefaults["timeout"]> {
	if (typeof timeout === "number") return timeout;
	const supported = { ...timeout };
	delete supported.firstChunkMs;
	delete supported.chunkMs;
	return supported;
}
