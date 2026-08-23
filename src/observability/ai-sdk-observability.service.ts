import { Inject, Injectable } from "@nestjs/common";
import { InMemoryAiObservabilityCollector } from "./core/index.ts";
import { AI_SDK_OBSERVABILITY_MODULE_OPTIONS } from "./ai-sdk-observability.tokens.ts";
import type { AiSdkObservabilityModuleOptions } from "./ai-sdk-observability.types.ts";

/**
 * Nest injectable wrapper around the default bounded, process-local collector.
 *
 * Applications can record neutral lifecycle events through the inherited sink
 * API and read immutable dashboard projections through `snapshot()`.
 */
@Injectable()
export class AiSdkObservabilityService extends InMemoryAiObservabilityCollector {
	constructor(
		@Inject(AI_SDK_OBSERVABILITY_MODULE_OPTIONS) options: AiSdkObservabilityModuleOptions,
	) {
		super(options);
	}
}
