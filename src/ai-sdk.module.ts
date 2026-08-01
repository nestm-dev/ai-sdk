import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import type { DynamicModule } from "@nestjs/common";
import { aiSdkCoreProviders } from "./ai-sdk.defaults.ts";
import {
	ConfigurableModuleClass,
	type AiSdkForRootAsyncOptions,
	type AiSdkForRootOptions,
} from "./ai-sdk.module-definition.ts";
import { AiSdkService } from "./ai-sdk.service.ts";
import {
	AI_SDK_EMBEDDING_MODEL,
	AI_SDK_FILES,
	AI_SDK_IMAGE_MODEL,
	AI_SDK_LANGUAGE_MODEL,
	AI_SDK_MODULE_OPTIONS,
	AI_SDK_REGISTRY,
	AI_SDK_RERANKING_MODEL,
	AI_SDK_SKILLS,
	AI_SDK_SPEECH_MODEL,
	AI_SDK_TRANSCRIPTION_MODEL,
	AI_SDK_VIDEO_MODEL,
} from "./ai-sdk.tokens.ts";
import { AiSdkFeatureDiscoveryService } from "./features/ai-sdk-feature-discovery.service.ts";
import { createAiSdkFeatureModule } from "./features/ai-sdk-feature.providers.ts";
import type {
	AiSdkFeatureAsyncOptions,
	AiSdkFeatureOptions,
} from "./features/ai-sdk-feature.types.ts";

@Module({})
export class AiSdkFeatureModule {}

const exportedCoreProviders = [
	AI_SDK_MODULE_OPTIONS,
	AI_SDK_REGISTRY,
	AI_SDK_LANGUAGE_MODEL,
	AI_SDK_EMBEDDING_MODEL,
	AI_SDK_IMAGE_MODEL,
	AI_SDK_TRANSCRIPTION_MODEL,
	AI_SDK_SPEECH_MODEL,
	AI_SDK_RERANKING_MODEL,
	AI_SDK_VIDEO_MODEL,
	AI_SDK_FILES,
	AI_SDK_SKILLS,
	AiSdkService,
];

@Module({
	imports: [DiscoveryModule],
	providers: [...aiSdkCoreProviders, AiSdkService, AiSdkFeatureDiscoveryService],
	exports: exportedCoreProviders,
})
export class AiSdkModule extends ConfigurableModuleClass {
	static forRoot(options: AiSdkForRootOptions = {}): DynamicModule {
		return super.forRoot(options);
	}

	static forRootAsync(options: AiSdkForRootAsyncOptions): DynamicModule {
		return super.forRootAsync(options);
	}

	static forFeature(options: AiSdkFeatureOptions = {}): DynamicModule {
		return createAiSdkFeatureModule(AiSdkFeatureModule, options);
	}

	static forFeatureAsync(options: AiSdkFeatureAsyncOptions): DynamicModule {
		return createAiSdkFeatureModule(AiSdkFeatureModule, options);
	}
}
