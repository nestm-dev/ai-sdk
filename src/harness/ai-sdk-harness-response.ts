import type { HarnessAgent } from "@ai-sdk/harness/agent";
import {
	convertToModelMessages,
	toUIMessageStream,
	type UIMessage,
	type UIMessageChunk,
	type UIMessageStreamOptions,
} from "ai";
import { AiSdkResponse, type AiSdkHttpResponse } from "../http/ai-sdk-response.ts";
import type { AiSdkHarnessRunner } from "./ai-sdk-harness.runner.ts";
import type {
	AiSdkHarnessFinalizationPolicy,
	AiSdkHarnessSessionKey,
	InferAiSdkHarnessUIMessage,
} from "./ai-sdk-harness.types.ts";

export interface AiSdkHarnessUiResponseInit {
	readonly status?: number;
	readonly statusText?: string;
	readonly headers?: HeadersInit;
}

export interface AiSdkHarnessUiResponseOptions<
	AGENT extends HarnessAgent,
	UI_MESSAGE extends UIMessage = InferAiSdkHarnessUIMessage<AGENT>,
> {
	readonly runner: AiSdkHarnessRunner;
	readonly agent: AGENT;
	readonly key: AiSdkHarnessSessionKey;
	readonly turn: { readonly kind: "prompt" | "continue" };
	readonly uiMessages: readonly UI_MESSAGE[];
	readonly abortSignal?: AbortSignal;
	readonly timeoutMs?: number;
	readonly finalization?: AiSdkHarnessFinalizationPolicy;
	readonly streamOptions?: UIMessageStreamOptions<UI_MESSAGE>;
	readonly response?: AiSdkHarnessUiResponseInit;
}

export class AiSdkHarnessResponse {
	private constructor() {}

	static async ui<
		AGENT extends HarnessAgent,
		UI_MESSAGE extends UIMessage = InferAiSdkHarnessUIMessage<AGENT>,
	>(options: AiSdkHarnessUiResponseOptions<AGENT, UI_MESSAGE>): Promise<AiSdkHttpResponse> {
		const uiMessages = [...options.uiMessages];
		const modelMessages = await convertToModelMessages(uiMessages, {
			tools: options.agent.tools,
		});
		const run = await options.runner.stream({
			agent: options.agent,
			key: options.key,
			turn:
				options.turn.kind === "prompt"
					? { kind: "prompt", messages: modelMessages }
					: { kind: "continue", messages: modelMessages },
			abortSignal: options.abortSignal,
			timeoutMs: options.timeoutMs,
			finalization: options.finalization,
		});
		try {
			const cancellationBridge = preserveCancellationReason(run.stream.stream);
			const uiStream = toUIMessageStream<AGENT["tools"], UI_MESSAGE>({
				stream: cancellationBridge.stream,
				tools: options.agent.tools,
				originalMessages: uiMessages,
				...options.streamOptions,
			});

			return AiSdkResponse.ui(
				linkRunLifecycle(uiStream, run, cancellationBridge.record),
				options.response,
			);
		} catch (error) {
			run.cancel(error);
			await run.completion.catch(() => undefined);
			throw error;
		}
	}
}

function linkRunLifecycle(
	stream: ReadableStream<UIMessageChunk>,
	run: {
		readonly completion: PromiseLike<unknown>;
		cancel(reason?: unknown): void;
	},
	recordCancellationReason: (reason?: unknown) => void,
): ReadableStream<UIMessageChunk> {
	const reader = stream.getReader();
	const completion = Promise.resolve(run.completion);
	// Finalization is autonomous. Observe rejection immediately so an abandoned
	// HTTP body cannot create an unhandled rejection before it is read/cancelled.
	void completion.catch(() => undefined);
	let released = false;
	const release = (): void => {
		if (released) return;
		released = true;
		try {
			reader.releaseLock();
		} catch {
			// A pending read/cancel may keep the reader locked briefly.
		}
	};
	return new ReadableStream<UIMessageChunk>({
		async pull(controller) {
			try {
				const chunk = await reader.read();
				if (!chunk.done) {
					controller.enqueue(chunk.value);
					return;
				}
				await completion;
				release();
				controller.close();
			} catch (error) {
				release();
				controller.error(error);
			}
		},
		async cancel(reason) {
			recordCancellationReason(reason);
			run.cancel(reason);
			try {
				await reader.cancel(reason).catch(() => undefined);
				await completion.catch(() => undefined);
			} finally {
				release();
			}
		},
	});
}

/**
 * Node 22.12 can replace a cancellation reason with an internal TransformStream
 * TypeError while propagating cancellation through the AI SDK's transform
 * chain. Keep the public reason at the source boundary without changing the
 * pull-based stream behavior.
 */
function preserveCancellationReason<T>(source: ReadableStream<T>): {
	readonly stream: ReadableStream<T>;
	readonly record: (reason?: unknown) => void;
} {
	const reader = source.getReader();
	let cancelled = false;
	let hasRecordedReason = false;
	let recordedReason: unknown;
	let released = false;
	const release = (): void => {
		if (released) return;
		released = true;
		try {
			reader.releaseLock();
		} catch {
			// A pending read/cancel may keep the reader locked briefly.
		}
	};

	return {
		stream: new ReadableStream<T>({
			async pull(controller) {
				try {
					const chunk = await reader.read();
					if (cancelled) return;
					if (!chunk.done) {
						controller.enqueue(chunk.value);
						return;
					}
					release();
					controller.close();
				} catch (error) {
					if (cancelled) return;
					release();
					controller.error(error);
				}
			},
			async cancel(reason) {
				cancelled = true;
				try {
					await reader.cancel(hasRecordedReason ? recordedReason : reason);
				} finally {
					release();
				}
			},
		}),
		record(reason) {
			hasRecordedReason = true;
			recordedReason = reason;
		},
	};
}
