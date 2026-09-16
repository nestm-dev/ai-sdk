import type { LanguageModelMiddleware } from "ai";

export interface AiSdkModelTimeoutOptions {
	/** Covers one provider request, including reasoning before the first output. */
	readonly totalMs?: number;
	readonly firstChunkMs?: number;
	/** Starts after substantive output, not block-start metadata; excludes tool execution. */
	readonly chunkMs?: number;
}

/** Model-only deadlines. Keep turn/tool deadlines on streamText's native timeout. */
export function createAiSdkModelTimeoutMiddleware(
	options: AiSdkModelTimeoutOptions,
): LanguageModelMiddleware {
	for (const value of Object.values(options)) {
		if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0))
			throw new RangeError("Model timeouts must be positive integer milliseconds.");
	}
	const controllers = new WeakMap<object, AbortController>();
	return {
		specificationVersion: "v4",
		transformParams: async ({ params, type }) => {
			if (type !== "stream") return params;
			const controller = new AbortController();
			const transformed = {
				...params,
				abortSignal: AbortSignal.any([
					controller.signal,
					...(params.abortSignal === undefined ? [] : [params.abortSignal]),
				]),
			};
			controllers.set(transformed, controller);
			return transformed;
		},
		wrapStream: async ({ params, doStream }) => {
			const controller = controllers.get(params);
			if (controller === undefined || params.abortSignal === undefined)
				throw new TypeError("Missing model timeout request context.");
			const signal = params.abortSignal;
			const deadline = (duration: number | undefined, label: string) =>
				duration === undefined
					? undefined
					: setTimeout(
							() => controller.abort(new DOMException(`${label} model timeout`, "TimeoutError")),
							duration,
						);
			const total = deadline(options.totalMs, "Total");
			let first = deadline(options.firstChunkMs, "First chunk");
			let chunk: ReturnType<typeof setTimeout> | undefined;
			let cancelRead: (() => void) | undefined;
			const cleanup = () => {
				clearTimeout(total);
				clearTimeout(first);
				clearTimeout(chunk);
				if (cancelRead !== undefined) signal.removeEventListener("abort", cancelRead);
				controllers.delete(params);
			};
			try {
				signal.throwIfAborted();
				const result = await abortable(doStream(), signal);
				const reader = result.stream.getReader();
				cancelRead = () => {
					void reader.cancel(signal.reason).catch(() => {});
				};
				signal.addEventListener("abort", cancelRead, { once: true });
				return {
					...result,
					stream: new ReadableStream({
						async pull(target) {
							try {
								signal.throwIfAborted();
								const next = await reader.read();
								signal.throwIfAborted();
								if (next.done) {
									cleanup();
									target.close();
									return;
								}
								if (next.value.type === "finish" || next.value.type === "error") cleanup();
								else if (isOutput(next.value)) {
									clearTimeout(first);
									first = undefined;
									clearTimeout(chunk);
									chunk = deadline(options.chunkMs, "Chunk");
								}
								target.enqueue(next.value);
							} catch (error) {
								cleanup();
								target.error(error);
							}
						},
						async cancel(reason) {
							cleanup();
							controller.abort(reason);
							await reader.cancel(reason);
						},
					}),
				};
			} catch (error) {
				cleanup();
				throw error;
			}
		},
	};
}

function isOutput(part: { type: string; delta?: string }): boolean {
	if (["text-delta", "reasoning-delta", "tool-input-delta"].includes(part.type))
		return (part.delta?.length ?? 0) > 0;
	return ["tool-call", "tool-result", "file", "source"].includes(part.type);
}

function abortable<Result>(work: PromiseLike<Result>, signal: AbortSignal): Promise<Result> {
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
		void Promise.resolve(work)
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", abort));
	});
}
