import { Module, type DynamicModule, type ModuleMetadata } from "@nestjs/common";
import {
	AI_SDK_OBSERVABILITY_TELEMETRY_OPTIONS,
	AiSdkObservabilityTelemetryService,
	type AiSdkObservabilityTelemetryAdapterOptions,
} from "./ai-sdk-observability-telemetry.service.ts";

export interface AiSdkObservabilityTelemetryModuleOptions extends AiSdkObservabilityTelemetryAdapterOptions {
	readonly imports?: ModuleMetadata["imports"];
}

@Module({})
export class AiSdkObservabilityTelemetryModule {
	static register(options: AiSdkObservabilityTelemetryModuleOptions = {}): DynamicModule {
		const { imports, ...adapterOptions } = options;

		return {
			module: AiSdkObservabilityTelemetryModule,
			imports: imports == null ? [] : [...imports],
			providers: [
				{
					provide: AI_SDK_OBSERVABILITY_TELEMETRY_OPTIONS,
					useValue: adapterOptions,
				},
				AiSdkObservabilityTelemetryService,
			],
			exports: [AiSdkObservabilityTelemetryService],
		};
	}
}
