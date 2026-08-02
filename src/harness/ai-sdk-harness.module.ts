import { Module, type DynamicModule } from "@nestjs/common";
import {
	ConfigurableModuleClass,
	type AiSdkHarnessForRootAsyncOptions,
	type AiSdkHarnessForRootOptions,
} from "./ai-sdk-harness.module-definition.ts";
import { AiSdkHarnessRunner } from "./ai-sdk-harness.runner.ts";
import {
	AI_SDK_HARNESS_MODULE_OPTIONS,
	AI_SDK_HARNESS_SESSION_LEASE_MANAGER,
	AI_SDK_HARNESS_SESSION_STORE,
} from "./ai-sdk-harness.tokens.ts";
import type { AiSdkHarnessModuleOptions } from "./ai-sdk-harness.types.ts";

const harnessProviders = [
	{
		provide: AI_SDK_HARNESS_SESSION_STORE,
		inject: [AI_SDK_HARNESS_MODULE_OPTIONS],
		useFactory: (options: AiSdkHarnessModuleOptions) => options.sessionStore,
	},
	{
		provide: AI_SDK_HARNESS_SESSION_LEASE_MANAGER,
		inject: [AI_SDK_HARNESS_MODULE_OPTIONS],
		useFactory: (options: AiSdkHarnessModuleOptions) => options.leaseManager,
	},
	{
		provide: AiSdkHarnessRunner,
		inject: [AI_SDK_HARNESS_MODULE_OPTIONS],
		useFactory: (options: AiSdkHarnessModuleOptions) => new AiSdkHarnessRunner(options),
	},
];

@Module({
	providers: harnessProviders,
	exports: [
		AI_SDK_HARNESS_MODULE_OPTIONS,
		AI_SDK_HARNESS_SESSION_STORE,
		AI_SDK_HARNESS_SESSION_LEASE_MANAGER,
		AiSdkHarnessRunner,
	],
})
export class AiSdkHarnessModule extends ConfigurableModuleClass {
	static forRoot(options: AiSdkHarnessForRootOptions): DynamicModule {
		return super.forRoot(options);
	}

	static forRootAsync(options: AiSdkHarnessForRootAsyncOptions): DynamicModule {
		return super.forRootAsync(options);
	}
}
