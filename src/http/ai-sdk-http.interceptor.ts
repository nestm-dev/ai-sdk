import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import type { Observable } from "rxjs";
import { mergeMap } from "rxjs";
import { isAiSdkHttpResponse } from "./ai-sdk-response.js";
import { AiSdkResponseSender } from "./ai-sdk-response.sender.js";

interface EventEmitterLike {
	once(event: string, listener: (...arguments_: unknown[]) => void): unknown;
	off?(event: string, listener: (...arguments_: unknown[]) => void): unknown;
	removeListener?(event: string, listener: (...arguments_: unknown[]) => void): unknown;
}

interface RequestLifecycle extends EventEmitterLike {
	readonly aborted?: boolean;
}

interface ResponseLifecycle extends EventEmitterLike {
	readonly destroyed?: boolean;
	readonly writableEnded?: boolean;
}

interface HttpDisconnectBinding {
	readonly signal: AbortSignal;
	dispose(): void;
}

/** Abort reason used when a Nest HTTP client closes a streamed response early. */
export class AiSdkHttpDisconnectError extends Error {
	readonly code = "AI_SDK_HTTP_CLIENT_DISCONNECTED";

	constructor() {
		super("The HTTP client disconnected before the AI SDK response completed.");
		this.name = "AiSdkHttpDisconnectError";
	}
}

@Injectable()
export class AiSdkHttpInterceptor implements NestInterceptor {
	constructor(private readonly sender: AiSdkResponseSender) {}

	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		return next.handle().pipe(
			mergeMap(async (value: unknown) => {
				if (!isAiSdkHttpResponse(value)) {
					return value;
				}

				const http = context.switchToHttp();
				const hostResponse = http.getResponse<unknown>();
				const hostRequest = http.getRequest<unknown>();
				const disconnect = bindHttpDisconnect(hostRequest, hostResponse);
				try {
					const response = await value.resolve({ abortSignal: disconnect.signal });
					await this.sender.send(response, hostResponse, hostRequest);
					return undefined;
				} finally {
					disconnect.dispose();
				}
			}),
		);
	}
}

function bindHttpDisconnect(hostRequest: unknown, hostResponse: unknown): HttpDisconnectBinding {
	const request = asRequestLifecycle(unwrapRaw(hostRequest));
	const response = asResponseLifecycle(unwrapRaw(hostResponse));
	const controller = new AbortController();
	const abort = (): void => {
		if (!controller.signal.aborted) controller.abort(new AiSdkHttpDisconnectError());
	};
	const onAborted = (): void => abort();
	const onClose = (): void => {
		if (response?.writableEnded !== true) abort();
	};

	request?.once("aborted", onAborted);
	response?.once("close", onClose);
	if (
		request?.aborted === true ||
		(response?.destroyed === true && response.writableEnded !== true)
	) {
		abort();
	}

	return {
		signal: controller.signal,
		dispose: () => {
			if (request !== undefined) removeListener(request, "aborted", onAborted);
			if (response !== undefined) removeListener(response, "close", onClose);
		},
	};
}

function unwrapRaw(value: unknown): unknown {
	return typeof value === "object" && value !== null && "raw" in value ? value.raw : value;
}

function asRequestLifecycle(value: unknown): RequestLifecycle | undefined {
	return isEventEmitterLike(value) ? value : undefined;
}

function asResponseLifecycle(value: unknown): ResponseLifecycle | undefined {
	return isEventEmitterLike(value) ? value : undefined;
}

function isEventEmitterLike(value: unknown): value is EventEmitterLike {
	return (
		typeof value === "object" &&
		value !== null &&
		"once" in value &&
		typeof value.once === "function"
	);
}

function removeListener(
	emitter: EventEmitterLike,
	event: string,
	listener: (...arguments_: unknown[]) => void,
): void {
	if (typeof emitter.off === "function") {
		emitter.off(event, listener);
		return;
	}
	emitter.removeListener?.(event, listener);
}
