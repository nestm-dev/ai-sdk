import type { ToolSet } from "ai";
import type { AiSdkResolvedDefaults } from "../ai-sdk.defaults.js";
import type { AiSdkAgent } from "../features/ai-sdk-feature.types.js";
import {
	AI_SDK_EMBEDDING_MODEL,
	AI_SDK_FILES,
	AI_SDK_IMAGE_MODEL,
	AI_SDK_LANGUAGE_MODEL,
	AI_SDK_REGISTRY,
	AI_SDK_REQUEST_DEFAULTS,
	AI_SDK_RERANKING_MODEL,
	AI_SDK_RESOLVED_DEFAULTS,
	AI_SDK_SKILLS,
	AI_SDK_SPEECH_MODEL,
	AI_SDK_TRANSCRIPTION_MODEL,
	AI_SDK_VIDEO_MODEL,
	getAiAgentToken,
	getAiToolsetToken,
} from "../ai-sdk.tokens.js";
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
	AiSdkRequestDefaults,
	AiSdkSkills,
} from "../ai-sdk.types.js";

export interface AiSdkTestingOverrideBuilder {
	overrideProvider(token: unknown): {
		useValue(value: unknown): unknown;
	};
}

function overrideValue<BUILDER extends AiSdkTestingOverrideBuilder>(
	builder: BUILDER,
	token: unknown,
	value: unknown,
): BUILDER {
	builder.overrideProvider(token).useValue(value);
	return builder;
}

export function overrideAiSdkRegistry<BUILDER extends AiSdkTestingOverrideBuilder>(
	builder: BUILDER,
	registry: AiSdkRegistry | undefined,
): BUILDER {
	return overrideValue(builder, AI_SDK_REGISTRY, registry);
}

export function overrideAiSdkResolvedDefaults<BUILDER extends AiSdkTestingOverrideBuilder>(
	builder: BUILDER,
	defaults: AiSdkResolvedDefaults,
): BUILDER {
	return overrideValue(builder, AI_SDK_RESOLVED_DEFAULTS, defaults);
}

export function overrideAiSdkRequestDefaults<BUILDER extends AiSdkTestingOverrideBuilder>(
	builder: BUILDER,
	defaults: AiSdkRequestDefaults,
): BUILDER {
	return overrideValue(builder, AI_SDK_REQUEST_DEFAULTS, defaults);
}

export function overrideAiSdkLanguageModel<BUILDER extends AiSdkTestingOverrideBuilder>(
	builder: BUILDER,
	model: AiSdkDirectLanguageModel,
): BUILDER {
	return overrideValue(builder, AI_SDK_LANGUAGE_MODEL, model);
}

export function overrideAiSdkEmbeddingModel<BUILDER extends AiSdkTestingOverrideBuilder>(
	builder: BUILDER,
	model: AiSdkDirectEmbeddingModel,
): BUILDER {
	return overrideValue(builder, AI_SDK_EMBEDDING_MODEL, model);
}

export function overrideAiSdkImageModel<BUILDER extends AiSdkTestingOverrideBuilder>(
	builder: BUILDER,
	model: AiSdkDirectImageModel,
): BUILDER {
	return overrideValue(builder, AI_SDK_IMAGE_MODEL, model);
}

export function overrideAiSdkTranscriptionModel<BUILDER extends AiSdkTestingOverrideBuilder>(
	builder: BUILDER,
	model: AiSdkDirectTranscriptionModel,
): BUILDER {
	return overrideValue(builder, AI_SDK_TRANSCRIPTION_MODEL, model);
}

export function overrideAiSdkSpeechModel<BUILDER extends AiSdkTestingOverrideBuilder>(
	builder: BUILDER,
	model: AiSdkDirectSpeechModel,
): BUILDER {
	return overrideValue(builder, AI_SDK_SPEECH_MODEL, model);
}

export function overrideAiSdkRerankingModel<BUILDER extends AiSdkTestingOverrideBuilder>(
	builder: BUILDER,
	model: AiSdkDirectRerankingModel,
): BUILDER {
	return overrideValue(builder, AI_SDK_RERANKING_MODEL, model);
}

export function overrideAiSdkVideoModel<BUILDER extends AiSdkTestingOverrideBuilder>(
	builder: BUILDER,
	model: AiSdkDirectVideoModel,
): BUILDER {
	return overrideValue(builder, AI_SDK_VIDEO_MODEL, model);
}

export function overrideAiSdkFiles<BUILDER extends AiSdkTestingOverrideBuilder>(
	builder: BUILDER,
	files: AiSdkFiles,
): BUILDER {
	return overrideValue(builder, AI_SDK_FILES, files);
}

export function overrideAiSdkSkills<BUILDER extends AiSdkTestingOverrideBuilder>(
	builder: BUILDER,
	skills: AiSdkSkills,
): BUILDER {
	return overrideValue(builder, AI_SDK_SKILLS, skills);
}

export function overrideAiSdkToolset<BUILDER extends AiSdkTestingOverrideBuilder>(
	builder: BUILDER,
	name: string,
	tools: ToolSet,
): BUILDER {
	return overrideValue(builder, getAiToolsetToken(name), tools);
}

export function overrideAiSdkAgent<BUILDER extends AiSdkTestingOverrideBuilder>(
	builder: BUILDER,
	name: string,
	agent: AiSdkAgent,
): BUILDER {
	return overrideValue(builder, getAiAgentToken(name), agent);
}
