import { HttpException, HttpStatus } from "@nestjs/common";

const SAFE_HTTP_ERRORS = {
	CHAT_TRANSCRIPT_DIVERGED: {
		status: HttpStatus.CONFLICT,
		message: "The chat changed. Refresh it and try again.",
	},
} as const;

export type SafeHttpErrorCode = keyof typeof SAFE_HTTP_ERRORS;

export class SafeHttpException extends HttpException {
	constructor(readonly code: SafeHttpErrorCode) {
		const definition = SAFE_HTTP_ERRORS[code];
		super({ code }, definition.status);
	}

	get safeMessage(): string {
		return SAFE_HTTP_ERRORS[this.code].message;
	}
}
