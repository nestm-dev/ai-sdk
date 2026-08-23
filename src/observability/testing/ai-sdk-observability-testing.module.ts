import { Module, type DynamicModule } from "@nestjs/common";
import type { InMemoryAiObservabilityOptions } from "../core/index.ts";
import { AiSdkObservabilityModule } from "../ai-sdk-observability.module.ts";
import { FakeAiObservabilityClock } from "./fake-ai-observability-clock.ts";

export interface AiSdkObservabilityTestingModuleOptions extends Omit<
	InMemoryAiObservabilityOptions,
	"clock"
> {
	/** Reuse a clock when several test modules must share one timeline. */
	readonly clock?: FakeAiObservabilityClock;
	/** Initial Unix time in milliseconds for an automatically created clock. */
	readonly initialTimeMs?: number;
}

/** Local-scope observability module with a deterministic injectable clock. */
@Module({})
export class AiSdkObservabilityTestingModule {
	static forRoot(options: AiSdkObservabilityTestingModuleOptions = {}): DynamicModule {
		const { clock: providedClock, initialTimeMs = 0, ...collectorOptions } = options;
		const clock = providedClock ?? new FakeAiObservabilityClock(initialTimeMs);

		return {
			module: AiSdkObservabilityTestingModule,
			imports: [
				AiSdkObservabilityModule.forRoot({
					...collectorOptions,
					clock: clock.now,
					isGlobal: false,
				}),
			],
			providers: [{ provide: FakeAiObservabilityClock, useValue: clock }],
			exports: [AiSdkObservabilityModule, FakeAiObservabilityClock],
		};
	}
}
