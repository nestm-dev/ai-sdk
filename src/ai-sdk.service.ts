import { Inject, Injectable } from "@nestjs/common";
import {
	embed,
	embedMany,
	experimental_generateVideo,
	experimental_streamTranscribe,
	experimental_streamTranslate,
	generateImage,
	generateSpeech,
	generateText,
	registerTelemetry,
	rerank,
	streamText,
	transcribe,
	uploadFile,
	uploadSkill,
} from "ai";
import { AiSdkConfigurationError } from "./ai-sdk.error.ts";
import type { AiSdkResolvedDefaults } from "./ai-sdk.defaults.ts";
import { AI_SDK_REGISTRY, AI_SDK_RESOLVED_DEFAULTS } from "./ai-sdk.tokens.ts";
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
	AiSdkSkills,
	RegisteredAiSdkRegistry,
} from "./ai-sdk.types.ts";

type RegistryResult<
	REGISTRY extends AiSdkRegistry,
	METHOD extends keyof REGISTRY,
> = REGISTRY[METHOD] extends (...arguments_: readonly unknown[]) => infer RESULT ? RESULT : never;

@Injectable()
export class AiSdkService<REGISTRY extends AiSdkRegistry = RegisteredAiSdkRegistry> {
	readonly generateText: typeof generateText = generateText;
	readonly streamText: typeof streamText = streamText;
	readonly embed: typeof embed = embed;
	readonly embedMany: typeof embedMany = embedMany;
	readonly generateImage: typeof generateImage = generateImage;
	readonly rerank: typeof rerank = rerank;
	readonly generateSpeech: typeof generateSpeech = generateSpeech;
	readonly transcribe: typeof transcribe = transcribe;
	readonly uploadFile: typeof uploadFile = uploadFile;
	readonly uploadSkill: typeof uploadSkill = uploadSkill;
	readonly experimental_generateVideo: typeof experimental_generateVideo =
		experimental_generateVideo;
	readonly experimental_streamTranscribe: typeof experimental_streamTranscribe =
		experimental_streamTranscribe;
	readonly experimental_streamTranslate: typeof experimental_streamTranslate =
		experimental_streamTranslate;
	readonly registerTelemetry: typeof registerTelemetry = registerTelemetry;

	constructor(
		@Inject(AI_SDK_REGISTRY) readonly registry: REGISTRY | undefined,
		@Inject(AI_SDK_RESOLVED_DEFAULTS)
		private readonly defaults: AiSdkResolvedDefaults,
	) {}

	languageModel(
		id?: AiSdkRegistryModelId<REGISTRY, "languageModel">,
	): RegistryResult<REGISTRY, "languageModel"> | AiSdkDirectLanguageModel {
		return this.resolve("languageModel", "language", id);
	}

	embeddingModel(
		id?: AiSdkRegistryModelId<REGISTRY, "embeddingModel">,
	): RegistryResult<REGISTRY, "embeddingModel"> | AiSdkDirectEmbeddingModel {
		return this.resolve("embeddingModel", "embedding", id);
	}

	imageModel(
		id?: AiSdkRegistryModelId<REGISTRY, "imageModel">,
	): RegistryResult<REGISTRY, "imageModel"> | AiSdkDirectImageModel {
		return this.resolve("imageModel", "image", id);
	}

	transcriptionModel(
		id?: AiSdkRegistryModelId<REGISTRY, "transcriptionModel">,
	): RegistryResult<REGISTRY, "transcriptionModel"> | AiSdkDirectTranscriptionModel {
		return this.resolve("transcriptionModel", "transcription", id);
	}

	speechModel(
		id?: AiSdkRegistryModelId<REGISTRY, "speechModel">,
	): RegistryResult<REGISTRY, "speechModel"> | AiSdkDirectSpeechModel {
		return this.resolve("speechModel", "speech", id);
	}

	rerankingModel(
		id?: AiSdkRegistryModelId<REGISTRY, "rerankingModel">,
	): RegistryResult<REGISTRY, "rerankingModel"> | AiSdkDirectRerankingModel {
		return this.resolve("rerankingModel", "reranking", id);
	}

	videoModel(
		id?: AiSdkRegistryModelId<REGISTRY, "videoModel">,
	): RegistryResult<REGISTRY, "videoModel"> | AiSdkDirectVideoModel {
		return this.resolve("videoModel", "video", id);
	}

	files(id?: AiSdkRegistryModelId<REGISTRY, "files">): AiSdkFiles {
		return this.resolve("files", "files", id) as AiSdkFiles;
	}

	skills(id?: AiSdkRegistryModelId<REGISTRY, "skills">): AiSdkSkills {
		return this.resolve("skills", "skills", id) as AiSdkSkills;
	}

	private resolve<METHOD extends keyof AiSdkRegistry, DEFAULT extends keyof AiSdkResolvedDefaults>(
		method: METHOD,
		defaultName: DEFAULT,
		id: string | undefined,
	): RegistryResult<REGISTRY, METHOD> | NonNullable<AiSdkResolvedDefaults[DEFAULT]> {
		if (id !== undefined) {
			if (this.registry === undefined) {
				throw new AiSdkConfigurationError(
					"MISSING_REGISTRY",
					`Cannot resolve ${method} "${id}" because no provider registry is configured.`,
				);
			}
			try {
				const resolver = this.registry[method] as (reference: string) => unknown;
				return resolver.call(this.registry, id) as RegistryResult<REGISTRY, METHOD>;
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
		return configured as NonNullable<AiSdkResolvedDefaults[DEFAULT]>;
	}
}
