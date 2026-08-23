import { Module, type DynamicModule } from "@nestjs/common";
import { AiSdkObservabilityHttpController } from "./ai-sdk-observability-http.controller.ts";
import type { AiSdkObservabilityHttpModuleRegistrationOptions } from "./ai-sdk-observability-http.types.ts";

/**
 * Optional HTTP projection for an application-owned dashboard.
 *
 * Import it only where `AiSdkObservabilityService` is visible (global by default)
 * and apply the host application's own guards and transport policies.
 */
@Module({ controllers: [AiSdkObservabilityHttpController] })
export class AiSdkObservabilityHttpModule {
	/** Attach the controller to a module that exports a non-global service. */
	static register(options: AiSdkObservabilityHttpModuleRegistrationOptions): DynamicModule {
		return {
			module: AiSdkObservabilityHttpModule,
			imports: [...options.imports],
		};
	}
}
