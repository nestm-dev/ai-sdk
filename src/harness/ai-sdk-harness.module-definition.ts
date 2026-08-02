import { ConfigurableModuleBuilder } from "@nestjs/common";
import { AI_SDK_HARNESS_MODULE_OPTIONS } from "./ai-sdk-harness.tokens.ts";
import type {
	AiSdkHarnessModuleExtras,
	AiSdkHarnessModuleOptions,
} from "./ai-sdk-harness.types.ts";

export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } =
	new ConfigurableModuleBuilder<AiSdkHarnessModuleOptions>({
		optionsInjectionToken: AI_SDK_HARNESS_MODULE_OPTIONS,
		alwaysTransient: true,
	})
		.setClassMethodName("forRoot")
		.setFactoryMethodName("createAiSdkHarnessOptions")
		.setExtras<AiSdkHarnessModuleExtras>({ isGlobal: true }, (definition, extras) => ({
			...definition,
			global: extras.isGlobal !== false,
		}))
		.build();

export type AiSdkHarnessForRootOptions = typeof OPTIONS_TYPE;
export type AiSdkHarnessForRootAsyncOptions = typeof ASYNC_OPTIONS_TYPE;
