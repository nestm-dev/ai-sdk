export type AiSdkConfigurationErrorCode =
	| "DUPLICATE_FEATURE"
	| "INVALID_DEFAULT"
	| "INVALID_FEATURE"
	| "INVALID_OPTIONS"
	| "INVALID_REFERENCE"
	| "MISSING_DEFAULT"
	| "MISSING_REGISTRY";

/** An error in Nest module configuration, rather than an upstream AI SDK call. */
export class AiSdkConfigurationError extends Error {
	readonly code: AiSdkConfigurationErrorCode;

	constructor(code: AiSdkConfigurationErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "AiSdkConfigurationError";
		this.code = code;
	}
}
