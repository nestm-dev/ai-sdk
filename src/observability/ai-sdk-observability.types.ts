import type { InMemoryAiObservabilityOptions } from "./core/index.ts";

/** Options used by the default bounded, process-local collector. */
export type AiSdkObservabilityModuleOptions = InMemoryAiObservabilityOptions;

export interface AiSdkObservabilityModuleExtras {
	/** Make the module's exported providers globally injectable. Defaults to true. */
	readonly isGlobal?: boolean;
}

export interface AiSdkObservabilityOptionsFactory {
	createAiSdkObservabilityOptions():
		AiSdkObservabilityModuleOptions | Promise<AiSdkObservabilityModuleOptions>;
}

/** Identity helper that retains literal configuration values. */
export function defineAiSdkObservabilityConfig<
	const OPTIONS extends AiSdkObservabilityModuleOptions,
>(options: OPTIONS): OPTIONS {
	return options;
}
