import { Injectable } from "@nestjs/common";

interface EventEmitterLike {
	on(event: string, listener: (...arguments_: unknown[]) => void): unknown;
	once(event: string, listener: (...arguments_: unknown[]) => void): unknown;
	off?(event: string, listener: (...arguments_: unknown[]) => void): unknown;
	removeListener?(event: string, listener: (...arguments_: unknown[]) => void): unknown;
}

interface NodeResponseLike extends EventEmitterLike {
	statusCode: number;
	statusMessage?: string;
	headersSent?: boolean;
	writableEnded?: boolean;
	destroyed?: boolean;
	setHeader(name: string, value: string | readonly string[]): unknown;
	write(chunk: Uint8Array): boolean;
	end(): unknown;
	destroy?(error?: Error): unknown;
	flush?(): unknown;
}

interface RequestLike extends EventEmitterLike {
	method?: string;
	aborted?: boolean;
}

interface FastifyReplyLike {
	raw: unknown;
	hijack(): unknown;
}

interface ResolvedResponseTarget {
	readonly response: NodeResponseLike;
	readonly commitPlatform: () => void;
}

interface TransferState {
	committed: boolean;
	completed: boolean;
	disconnected: boolean;
	terminalError: unknown;
}

/**
 * Sends a Fetch `Response` through either an Express response or Fastify reply.
 *
 * The function only relies on the Node response surface shared by both adapters,
 * keeping Express and Fastify as development-only dependencies.
 */
export async function sendAiSdkResponse(
	fetchResponse: Response,
	hostResponse: unknown,
	hostRequest?: unknown,
): Promise<void> {
	const target = resolveResponseTarget(hostResponse);
	const request = resolveRequest(hostRequest);
	const state: TransferState = {
		committed: false,
		completed: false,
		disconnected: false,
		terminalError: undefined,
	};

	if (request?.aborted === true || target.response.destroyed === true) {
		await fetchResponse.body?.cancel().catch(() => undefined);
		return;
	}

	if (request?.method?.toUpperCase() === "HEAD") {
		await fetchResponse.body?.cancel().catch(() => undefined);
		commitResponse(target, fetchResponse, state);
		finishResponse(target.response, state);
		return;
	}

	if (fetchResponse.body === null) {
		commitResponse(target, fetchResponse, state);
		finishResponse(target.response, state);
		return;
	}

	const reader = fetchResponse.body.getReader();
	const cancel = (reason?: unknown): void => {
		if (state.completed || state.disconnected) {
			return;
		}

		state.disconnected = true;
		void reader.cancel(reason).catch(() => undefined);
	};
	const onClose = (): void => cancel();
	const onAborted = (): void => cancel();
	const onError = (error: unknown): void => {
		state.terminalError = error;
		void reader.cancel(error).catch(() => undefined);
	};

	target.response.once("close", onClose);
	target.response.once("error", onError);
	request?.once("aborted", onAborted);

	try {
		// Do not hijack Fastify or commit headers until the body can be read. If
		// this first read rejects, Nest's normal exception pipeline remains usable.
		let result = await reader.read();
		if (state.disconnected) {
			return;
		}

		commitResponse(target, fetchResponse, state);

		while (!result.done) {
			if (!target.response.write(result.value)) {
				await waitForDrain(target.response, state);
			}
			target.response.flush?.();

			if (state.disconnected) {
				return;
			}

			result = await reader.read();
		}

		if (state.disconnected) {
			return;
		}

		if (state.terminalError !== undefined) {
			throw state.terminalError;
		}

		finishResponse(target.response, state);
	} catch (error) {
		if (hasCommitted(state) && !isDestroyed(target.response)) {
			target.response.destroy?.(error instanceof Error ? error : undefined);
		}
		throw error;
	} finally {
		state.completed = true;
		removeListener(target.response, "close", onClose);
		removeListener(target.response, "error", onError);
		if (request !== undefined) {
			removeListener(request, "aborted", onAborted);
		}
		releaseReader(reader);
	}
}

function hasCommitted(state: TransferState): boolean {
	return state.committed;
}

function isDestroyed(response: NodeResponseLike): boolean {
	return response.destroyed === true;
}

@Injectable()
export class AiSdkResponseSender {
	send(fetchResponse: Response, hostResponse: unknown, hostRequest?: unknown): Promise<void> {
		return sendAiSdkResponse(fetchResponse, hostResponse, hostRequest);
	}
}

function commitResponse(
	target: ResolvedResponseTarget,
	fetchResponse: Response,
	state: TransferState,
): void {
	target.commitPlatform();
	const response = target.response;
	response.statusCode = fetchResponse.status;
	if (fetchResponse.statusText.length > 0) {
		response.statusMessage = fetchResponse.statusText;
	}

	for (const [name, value] of fetchResponse.headers) {
		if (name.toLowerCase() !== "set-cookie") {
			response.setHeader(name, value);
		}
	}

	const cookies = fetchResponse.headers.getSetCookie();
	if (cookies.length > 0) {
		response.setHeader("set-cookie", cookies);
	}

	state.committed = true;
}

function finishResponse(response: NodeResponseLike, state: TransferState): void {
	state.completed = true;
	if (response.writableEnded !== true) {
		response.end();
	}
}

function resolveResponseTarget(value: unknown): ResolvedResponseTarget {
	if (isFastifyReply(value)) {
		if (!isNodeResponse(value.raw)) {
			throw new TypeError("The Fastify reply does not expose a writable raw response.");
		}

		return {
			response: value.raw,
			commitPlatform: () => {
				value.hijack();
			},
		};
	}

	if (!isNodeResponse(value)) {
		throw new TypeError("Expected an Express response or Fastify reply.");
	}

	return {
		response: value,
		commitPlatform: () => undefined,
	};
}

function isFastifyReply(value: unknown): value is FastifyReplyLike {
	return (
		typeof value === "object" &&
		value !== null &&
		"raw" in value &&
		"hijack" in value &&
		typeof value.hijack === "function"
	);
}

function isNodeResponse(value: unknown): value is NodeResponseLike {
	return (
		typeof value === "object" &&
		value !== null &&
		"setHeader" in value &&
		typeof value.setHeader === "function" &&
		"write" in value &&
		typeof value.write === "function" &&
		"end" in value &&
		typeof value.end === "function" &&
		"on" in value &&
		typeof value.on === "function" &&
		"once" in value &&
		typeof value.once === "function"
	);
}

function isRequestLike(value: unknown): value is RequestLike {
	return (
		typeof value === "object" &&
		value !== null &&
		"on" in value &&
		typeof value.on === "function" &&
		"once" in value &&
		typeof value.once === "function"
	);
}

function resolveRequest(value: unknown): RequestLike | undefined {
	if (typeof value === "object" && value !== null && "raw" in value && isRequestLike(value.raw)) {
		return value.raw;
	}
	return isRequestLike(value) ? value : undefined;
}

function waitForDrain(response: NodeResponseLike, state: TransferState): Promise<void> {
	return new Promise((resolve, reject) => {
		const cleanup = (): void => {
			removeListener(response, "drain", onDrain);
			removeListener(response, "close", onClose);
			removeListener(response, "error", onError);
		};
		const onDrain = (): void => {
			cleanup();
			resolve();
		};
		const onClose = (): void => {
			cleanup();
			state.disconnected = true;
			resolve();
		};
		const onError = (error: unknown): void => {
			cleanup();
			state.terminalError = error;
			reject(error);
		};

		response.once("drain", onDrain);
		response.once("close", onClose);
		response.once("error", onError);
	});
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

function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
	try {
		reader.releaseLock();
	} catch {
		// A pending cancel/read can temporarily keep the reader locked. Releasing
		// is only a resource cleanup optimization in that case.
	}
}
