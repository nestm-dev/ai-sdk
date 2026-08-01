import { Inject } from "@nestjs/common";
import {
	AI_SDK_EMBEDDING_MODEL,
	AI_SDK_FILES,
	AI_SDK_IMAGE_MODEL,
	AI_SDK_LANGUAGE_MODEL,
	AI_SDK_RERANKING_MODEL,
	AI_SDK_SKILLS,
	AI_SDK_SPEECH_MODEL,
	AI_SDK_TRANSCRIPTION_MODEL,
	AI_SDK_VIDEO_MODEL,
	getAiAgentToken,
	getAiToolsetToken,
} from "../ai-sdk.tokens.ts";

type InjectionDecorator = ParameterDecorator & PropertyDecorator;

export function InjectAiToolset(name: string): InjectionDecorator {
	return Inject(getAiToolsetToken(name));
}

export function InjectAiAgent(name: string): InjectionDecorator {
	return Inject(getAiAgentToken(name));
}

export function InjectAiLanguageModel(): InjectionDecorator {
	return Inject(AI_SDK_LANGUAGE_MODEL);
}

export function InjectAiEmbeddingModel(): InjectionDecorator {
	return Inject(AI_SDK_EMBEDDING_MODEL);
}

export function InjectAiImageModel(): InjectionDecorator {
	return Inject(AI_SDK_IMAGE_MODEL);
}

export function InjectAiTranscriptionModel(): InjectionDecorator {
	return Inject(AI_SDK_TRANSCRIPTION_MODEL);
}

export function InjectAiSpeechModel(): InjectionDecorator {
	return Inject(AI_SDK_SPEECH_MODEL);
}

export function InjectAiRerankingModel(): InjectionDecorator {
	return Inject(AI_SDK_RERANKING_MODEL);
}

export function InjectAiVideoModel(): InjectionDecorator {
	return Inject(AI_SDK_VIDEO_MODEL);
}

export function InjectAiFiles(): InjectionDecorator {
	return Inject(AI_SDK_FILES);
}

export function InjectAiSkills(): InjectionDecorator {
	return Inject(AI_SDK_SKILLS);
}
