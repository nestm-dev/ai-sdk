import { ConfigurableModuleBuilder } from "@nestjs/common";
import { AI_SDK_MODULE_OPTIONS } from "./ai-sdk.tokens.ts";
import type { AiSdkModuleExtras, AiSdkModuleOptions } from "./ai-sdk.types.ts";

export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } =
	new ConfigurableModuleBuilder<AiSdkModuleOptions>({
		optionsInjectionToken: AI_SDK_MODULE_OPTIONS,
		alwaysTransient: true,
	})
		.setClassMethodName("forRoot")
		.setFactoryMethodName("createAiSdkOptions")
		.setExtras<AiSdkModuleExtras>({ isGlobal: true }, (definition, extras) => ({
			...definition,
			global: extras.isGlobal !== false,
		}))
		.build();

export type AiSdkForRootOptions = typeof OPTIONS_TYPE;
export type AiSdkForRootAsyncOptions = typeof ASYNC_OPTIONS_TYPE;
