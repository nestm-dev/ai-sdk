import { Module, type DynamicModule } from "@nestjs/common";
import {
	ConfigurableModuleClass,
	type AiSdkObservabilityForRootAsyncOptions,
	type AiSdkObservabilityForRootOptions,
} from "./ai-sdk-observability.module-definition.ts";
import { AiSdkObservabilityService } from "./ai-sdk-observability.service.ts";
import { AI_SDK_OBSERVABILITY_MODULE_OPTIONS } from "./ai-sdk-observability.tokens.ts";

@Module({
	providers: [AiSdkObservabilityService],
	exports: [AI_SDK_OBSERVABILITY_MODULE_OPTIONS, AiSdkObservabilityService],
})
export class AiSdkObservabilityModule extends ConfigurableModuleClass {
	static forRoot(options: AiSdkObservabilityForRootOptions = {}): DynamicModule {
		return super.forRoot(options);
	}

	static forRootAsync(options: AiSdkObservabilityForRootAsyncOptions): DynamicModule {
		return super.forRootAsync(options);
	}
}
