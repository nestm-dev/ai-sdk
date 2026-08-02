export type AiSdkHarnessErrorCode =
	| "BUSY"
	| "STATE_CONFLICT"
	| "INVALID_TURN"
	| "RECOVERY_REQUIRED"
	| "UNSAFE_DURABLE_STATE"
	| "LEASE_LOST"
	| "TIMEOUT"
	| "DISCONNECTED"
	| "TURN_FAILED"
	| "FINALIZATION_FAILED"
	| "VERSION_MISMATCH";

export class AiSdkHarnessError extends Error {
	readonly code: AiSdkHarnessErrorCode;

	constructor(code: AiSdkHarnessErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "AiSdkHarnessError";
		this.code = code;
	}
}

export class AiSdkHarnessSessionBusyError extends AiSdkHarnessError {
	constructor(sessionId: string) {
		super("BUSY", `AI SDK Harness session "${sessionId}" is already leased.`);
		this.name = "AiSdkHarnessSessionBusyError";
	}
}

export class AiSdkHarnessStateConflictError extends AiSdkHarnessError {
	constructor(sessionId: string) {
		super("STATE_CONFLICT", `AI SDK Harness session "${sessionId}" changed concurrently.`);
		this.name = "AiSdkHarnessStateConflictError";
	}
}

export class AiSdkHarnessRecoveryRequiredError extends AiSdkHarnessError {
	constructor(sessionId: string, reason: string, options?: ErrorOptions) {
		super(
			"RECOVERY_REQUIRED",
			`AI SDK Harness session "${sessionId}" requires explicit recovery: ${reason}`,
			options,
		);
		this.name = "AiSdkHarnessRecoveryRequiredError";
	}
}

export class AiSdkHarnessInvalidTurnError extends AiSdkHarnessError {
	constructor(sessionId: string, message: string) {
		super("INVALID_TURN", `AI SDK Harness session "${sessionId}" ${message}`);
		this.name = "AiSdkHarnessInvalidTurnError";
	}
}

export class AiSdkHarnessLeaseLostError extends AiSdkHarnessError {
	constructor(sessionId: string, options?: ErrorOptions) {
		super("LEASE_LOST", `AI SDK Harness session "${sessionId}" lost its lease.`, options);
		this.name = "AiSdkHarnessLeaseLostError";
	}
}

export class AiSdkHarnessTimeoutError extends AiSdkHarnessError {
	constructor(sessionId: string, timeoutMs: number) {
		super("TIMEOUT", `AI SDK Harness session "${sessionId}" exceeded ${timeoutMs} ms.`);
		this.name = "AiSdkHarnessTimeoutError";
	}
}

export class AiSdkHarnessDisconnectedError extends AiSdkHarnessError {
	constructor(sessionId: string, reason?: unknown) {
		super("DISCONNECTED", `AI SDK Harness session "${sessionId}" was disconnected.`, {
			cause: reason,
		});
		this.name = "AiSdkHarnessDisconnectedError";
	}
}

export class AiSdkHarnessTurnFailedError extends AiSdkHarnessError {
	constructor(sessionId: string) {
		super("TURN_FAILED", `AI SDK Harness session "${sessionId}" finished with an error.`);
		this.name = "AiSdkHarnessTurnFailedError";
	}
}
