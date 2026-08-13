export function combineAbortSignals(
	configured: unknown,
	fallback: AbortSignal | undefined,
): AbortSignal | undefined {
	if (fallback !== undefined && !isAbortSignal(fallback)) {
		throw new TypeError("The fallback signal must be an AbortSignal.");
	}
	if (configured === undefined) return fallback;
	if (!isAbortSignal(configured)) {
		throw new TypeError("`abortSignal` must be an AbortSignal.");
	}
	if (fallback === undefined || configured === fallback) return configured;

	// AbortSignal.any performs the final platform brand check while retaining
	// support for signals created in another JavaScript realm.
	return AbortSignal.any([configured, fallback]);
}

function isAbortSignal(value: unknown): value is AbortSignal {
	return (
		typeof value === "object" &&
		value !== null &&
		"aborted" in value &&
		typeof value.aborted === "boolean" &&
		"addEventListener" in value &&
		typeof value.addEventListener === "function" &&
		"removeEventListener" in value &&
		typeof value.removeEventListener === "function"
	);
}
