import {
	ArgumentsHost,
	Catch,
	HttpException,
	HttpStatus,
	type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

import { SafeHttpException } from "./safe-http.exception.ts";

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
	catch(exception: unknown, host: ArgumentsHost): void {
		const response = host.switchToHttp().getResponse<FastifyReply>();
		const status =
			exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
		response.status(status).send({
			code: exception instanceof SafeHttpException ? exception.code : safeCode(status),
			message: exception instanceof SafeHttpException ? exception.safeMessage : safeMessage(status),
		});
	}
}

function safeCode(status: number): string {
	if (status === HttpStatus.BAD_REQUEST) return "REQUEST_INVALID";
	if (status === HttpStatus.TOO_MANY_REQUESTS) return "COMPARISON_IN_PROGRESS";
	return status >= 500 ? "PLAYGROUND_FAILURE" : "REQUEST_REJECTED";
}

function safeMessage(status: number): string {
	if (status === HttpStatus.BAD_REQUEST) return "The comparison request is invalid.";
	if (status === HttpStatus.TOO_MANY_REQUESTS) {
		return "A model comparison is already running.";
	}
	return "The playground could not complete the request.";
}
