import { ConfigurableModuleBuilder } from "@nestjs/common";
import { AI_SDK_OBSERVABILITY_MODULE_OPTIONS } from "./ai-sdk-observability.tokens.ts";
import type {
	AiSdkObservabilityModuleExtras,
	AiSdkObservabilityModuleOptions,
} from "./ai-sdk-observability.types.ts";

export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } =
	new ConfigurableModuleBuilder<AiSdkObservabilityModuleOptions>({
		optionsInjectionToken: AI_SDK_OBSERVABILITY_MODULE_OPTIONS,
		alwaysTransient: true,
	})
		.setClassMethodName("forRoot")
		.setFactoryMethodName("createAiSdkObservabilityOptions")
		.setExtras<AiSdkObservabilityModuleExtras>({ isGlobal: true }, (definition, extras) => ({
			...definition,
			global: extras.isGlobal !== false,
		}))
		.build();

export type AiSdkObservabilityForRootOptions = typeof OPTIONS_TYPE;
export type AiSdkObservabilityForRootAsyncOptions = typeof ASYNC_OPTIONS_TYPE;
