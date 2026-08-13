export const AI_SDK_MODULE_OPTIONS = Symbol.for("@nestm/ai-sdk:module-options");
export const AI_SDK_REGISTRY = Symbol.for("@nestm/ai-sdk:registry");
export const AI_SDK_RESOLVED_DEFAULTS = Symbol.for("@nestm/ai-sdk:resolved-defaults");
export const AI_SDK_REQUEST_DEFAULTS = Symbol.for("@nestm/ai-sdk:request-defaults");

export const AI_SDK_LANGUAGE_MODEL = Symbol.for("@nestm/ai-sdk:model:language");
export const AI_SDK_EMBEDDING_MODEL = Symbol.for("@nestm/ai-sdk:model:embedding");
export const AI_SDK_IMAGE_MODEL = Symbol.for("@nestm/ai-sdk:model:image");
export const AI_SDK_TRANSCRIPTION_MODEL = Symbol.for("@nestm/ai-sdk:model:transcription");
export const AI_SDK_SPEECH_MODEL = Symbol.for("@nestm/ai-sdk:model:speech");
export const AI_SDK_RERANKING_MODEL = Symbol.for("@nestm/ai-sdk:model:reranking");
export const AI_SDK_VIDEO_MODEL = Symbol.for("@nestm/ai-sdk:model:video");
export const AI_SDK_FILES = Symbol.for("@nestm/ai-sdk:files");
export const AI_SDK_SKILLS = Symbol.for("@nestm/ai-sdk:skills");

export type AiSdkFeatureKind = "agent" | "toolset";

export function normalizeAiFeatureName(name: string): string {
	const normalized = name.trim();
	if (normalized.length === 0) {
		throw new TypeError("AI SDK feature names must not be empty.");
	}
	return normalized;
}

export function getAiToolsetToken(name: string): string {
	return `@nestm/ai-sdk:toolset:${normalizeAiFeatureName(name)}`;
}

export function getAiAgentToken(name: string): string {
	return `@nestm/ai-sdk:agent:${normalizeAiFeatureName(name)}`;
}

export function getAiLanguageModelToken(): typeof AI_SDK_LANGUAGE_MODEL {
	return AI_SDK_LANGUAGE_MODEL;
}

export function getAiEmbeddingModelToken(): typeof AI_SDK_EMBEDDING_MODEL {
	return AI_SDK_EMBEDDING_MODEL;
}

export function getAiImageModelToken(): typeof AI_SDK_IMAGE_MODEL {
	return AI_SDK_IMAGE_MODEL;
}

export function getAiTranscriptionModelToken(): typeof AI_SDK_TRANSCRIPTION_MODEL {
	return AI_SDK_TRANSCRIPTION_MODEL;
}

export function getAiSpeechModelToken(): typeof AI_SDK_SPEECH_MODEL {
	return AI_SDK_SPEECH_MODEL;
}

export function getAiRerankingModelToken(): typeof AI_SDK_RERANKING_MODEL {
	return AI_SDK_RERANKING_MODEL;
}

export function getAiVideoModelToken(): typeof AI_SDK_VIDEO_MODEL {
	return AI_SDK_VIDEO_MODEL;
}

export function getAiFilesToken(): typeof AI_SDK_FILES {
	return AI_SDK_FILES;
}

export function getAiSkillsToken(): typeof AI_SDK_SKILLS {
	return AI_SDK_SKILLS;
}
