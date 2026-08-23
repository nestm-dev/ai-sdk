import type { ModuleMetadata } from "@nestjs/common";

export interface AiSdkObservabilityHttpModuleRegistrationOptions {
	/** Modules that export the locally scoped AiSdkObservabilityService. */
	readonly imports: NonNullable<ModuleMetadata["imports"]>;
}
