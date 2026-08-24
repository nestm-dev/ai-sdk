import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	ServiceUnavailableException,
	type OnModuleDestroy,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { AiSdkHttpResponse, AiSdkResponse } from "@nestm/ai-sdk/http";
import {
	convertToModelMessages,
	createAgentUIStreamResponse,
	safeValidateUIMessages,
	type UIDataPartSchemas,
	UI_MESSAGE_STREAM_HEADERS,
} from "ai";
import { z } from "zod";

import { PlaygroundConfigService } from "../config/playground-config.service.ts";
import { SafeHttpException } from "../http/safe-http.exception.ts";
import type { ChatStreamDto } from "./chat.dto.ts";
import { PlaygroundChatAgentFactory } from "./playground-chat-agent.factory.ts";
import { ChatNotFoundError, ChatRepository, ChatRunNotFoundError } from "./chat.repository.ts";
import { mapRepositoryError, projectRun } from "./chat.service.ts";
import type {
	ChatRunView,
	PlaygroundChatMessageMetadata,
	PlaygroundChatUIMessage,
	StoredChatRun,
} from "./chat.types.ts";

const MAX_HISTORY_BYTES = 1024 * 1024;
const CLIENT_STREAM_ERROR = "The chat run could not complete. Try again.";
const DATA_SCHEMAS = {} satisfies UIDataPartSchemas;

export const playgroundChatMessageMetadataSchema = z
	.object({
		chatId: z.uuid(),
		runId: z.uuid(),
		provider: z.enum(["openai", "anthropic", "google"]),
		model: z.string().min(1).max(128),
		startedAt: z.string().datetime({ offset: true }),
		completedAt: z.string().datetime({ offset: true }).optional(),
		durationMs: z.number().int().nonnegative().optional(),
		finishReason: z
			.enum(["stop", "length", "content-filter", "tool-calls", "error", "other"])
			.optional(),
		stepCount: z.number().int().nonnegative().optional(),
		inputTokens: z.number().int().nonnegative().optional(),
		outputTokens: z.number().int().nonnegative().optional(),
		totalTokens: z.number().int().nonnegative().optional(),
	})
	.strict();

interface ActiveChatRun {
	readonly chatId: string;
	readonly run: StoredChatRun;
	readonly abortController: AbortController;
	readonly replay: SseReplayChannel;
	cancelRequested: boolean;
	streamFailed: boolean;
	completion?: Promise<void>;
}

@Injectable()
export class ChatRunService implements OnModuleDestroy {
	readonly #logger = new Logger(ChatRunService.name);
	readonly #active = new Map<string, ActiveChatRun>();

	constructor(
		@Inject(ChatRepository)
		private readonly repository: ChatRepository,
		@Inject(PlaygroundChatAgentFactory)
		private readonly agents: PlaygroundChatAgentFactory,
		@Inject(PlaygroundConfigService)
		private readonly config: PlaygroundConfigService,
	) {}

	async stream(chatId: string, input: ChatStreamDto): Promise<AiSdkHttpResponse> {
		assertBoundedHistory(input.messages);
		const graph = await this.repository.get(chatId);
		if (graph === undefined) throw new NotFoundException("Chat not found.");

		const agent = this.agents.create(graph.chat);
		const validation = await safeValidateUIMessages<PlaygroundChatUIMessage>({
			messages: input.messages,
			metadataSchema: playgroundChatMessageMetadataSchema.optional(),
			dataSchemas: DATA_SCHEMAS,
			tools: agent.tools,
		});
		if (!validation.success) this.#rejectInvalidMessages("sdk-validation");
		if (!messagesBelongToChat(validation.data, chatId)) {
			this.#rejectInvalidMessages("message-identity");
		}
		if (!isAuthoritativeTransition(graph.chat.messages, validation.data, input)) {
			this.#logger.warn({
				event: "playground.chat.request-rejected",
				reason: "authoritative-transition",
			});
			throw new SafeHttpException("CHAT_TRANSCRIPT_DIVERGED");
		}
		try {
			await convertToModelMessages(validation.data, { tools: agent.tools });
		} catch {
			this.#rejectInvalidMessages("model-conversion");
		}

		const runId = randomUUID();
		const assistantMessageId = `assistant-${randomUUID()}`;
		await this.repository.createStreamLog(runId);
		let started: Awaited<ReturnType<ChatRepository["beginRun"]>>;
		try {
			started = await this.repository.beginRun({
				chatId,
				runId,
				assistantMessageId,
				messages: validation.data,
			});
		} catch (error: unknown) {
			await this.repository.removeStreamLog(runId);
			throw mapRepositoryError(error);
		}

		const active: ActiveChatRun = {
			chatId,
			run: started.run,
			abortController: new AbortController(),
			replay: new SseReplayChannel(this.config.chatReplayMaxBytes),
			cancelRequested: false,
			streamFailed: false,
		};
		this.#active.set(chatId, active);
		let steps = 0;
		const startedAtMs = Date.parse(started.run.startedAt);

		try {
			const response = await createAgentUIStreamResponse({
				agent,
				uiMessages: validation.data,
				originalMessages: validation.data,
				generateMessageId: () => assistantMessageId,
				abortSignal: active.abortController.signal,
				timeout: {
					totalMs: this.config.chatRunTimeoutMs,
					stepMs: this.config.providerTimeoutMs,
					firstChunkMs: Math.min(15_000, this.config.providerTimeoutMs),
					chunkMs: Math.min(30_000, this.config.providerTimeoutMs),
					toolMs: 20_000,
				},
				sendReasoning: true,
				sendSources: true,
				onStepEnd: () => {
					steps += 1;
				},
				messageMetadata: ({ part }): PlaygroundChatMessageMetadata | undefined => {
					const base: PlaygroundChatMessageMetadata = {
						chatId,
						runId,
						provider: started.run.provider,
						model: started.run.model,
						startedAt: started.run.startedAt,
					};
					if (part.type === "start") return base;
					if (part.type !== "finish") return undefined;
					const completedAt = new Date().toISOString();
					return {
						...base,
						completedAt,
						durationMs: Math.max(0, Date.parse(completedAt) - startedAtMs),
						finishReason: part.finishReason,
						stepCount: steps,
						...(part.totalUsage.inputTokens === undefined
							? {}
							: { inputTokens: part.totalUsage.inputTokens }),
						...(part.totalUsage.outputTokens === undefined
							? {}
							: { outputTokens: part.totalUsage.outputTokens }),
						...(part.totalUsage.totalTokens === undefined
							? {}
							: { totalTokens: part.totalUsage.totalTokens }),
					};
				},
				onEnd: async ({ messages, isAborted, finishReason }) => {
					const failed = active.streamFailed || isAborted || finishReason === "error";
					await this.repository.completeRun(chatId, runId, {
						status: active.cancelRequested ? "cancelled" : failed ? "failed" : "completed",
						messages,
						...(finishReason === undefined ? {} : { finishReason }),
						...(!active.cancelRequested && failed
							? { errorCode: "generation_failed" as const }
							: {}),
					});
				},
				onError: (error) => {
					active.streamFailed = true;
					this.#logFailure("playground.chat.stream-failed", error);
					return CLIENT_STREAM_ERROR;
				},
				headers: {
					"cache-control": "no-store",
					"x-chat-run-id": runId,
				},
				consumeSseStream: ({ stream }) => {
					this.repository.activateStreamLog(runId);
					active.completion = this.#consume(active, stream);
					void active.completion.catch(() => undefined);
				},
			});
			return AiSdkResponse.from(response);
		} catch (error: unknown) {
			this.#active.delete(chatId);
			active.replay.close();
			await this.#markFailed(active);
			this.#logFailure("playground.chat.start-failed", error);
			throw new ServiceUnavailableException(CLIENT_STREAM_ERROR);
		}
	}

	async resume(chatId: string): Promise<AiSdkHttpResponse> {
		const graph = await this.repository.get(chatId);
		if (graph === undefined) throw new NotFoundException("Chat not found.");
		if (graph.activeRun === null) return AiSdkResponse.from(new Response(null, { status: 204 }));

		const active = this.#active.get(chatId);
		if (active === undefined || active.run.id !== graph.activeRun.id) {
			return AiSdkResponse.from(new Response(null, { status: 204 }));
		}
		return AiSdkResponse.from(
			new Response(active.replay.subscribe(), {
				headers: {
					...UI_MESSAGE_STREAM_HEADERS,
					"cache-control": "no-store",
					"x-chat-run-id": active.run.id,
				},
			}),
		);
	}

	async cancel(chatId: string, runId: string): Promise<{ readonly run: ChatRunView }> {
		const run = await this.repository.getRun(chatId, runId);
		if (run === undefined) throw new NotFoundException("Chat run not found.");
		const active = this.#active.get(chatId);
		if (run.status !== "running" || active === undefined || active.run.id !== runId) {
			throw new ConflictException("The run is not the current active run.");
		}

		active.cancelRequested = true;
		active.abortController.abort(new ChatRunCancelledError());
		let cancelled: StoredChatRun;
		try {
			cancelled = await this.repository.requestRunCancellation(chatId, runId);
		} catch (error: unknown) {
			throw mapRepositoryError(error);
		}
		if (active.completion !== undefined) {
			await settleWithin(
				active.completion.catch(() => undefined),
				750,
			);
		}
		return { run: projectRun(cancelled) };
	}

	async onModuleDestroy(): Promise<void> {
		const activeRuns = [...this.#active.values()];
		for (const active of activeRuns) {
			active.cancelRequested = true;
			active.abortController.abort(new ChatRunCancelledError());
		}
		await settleWithin(
			Promise.allSettled(
				activeRuns.map(async (active) => {
					if (active.completion !== undefined) await active.completion;
				}),
			),
			1_000,
		);
	}

	async #consume(active: ActiveChatRun, stream: ReadableStream<string>): Promise<void> {
		const reader = stream.getReader();
		try {
			while (true) {
				const chunk = await reader.read();
				if (chunk.done) break;
				await this.repository.appendStreamLog(active.run.id, chunk.value);
				active.replay.publish(chunk.value);
			}
		} catch (error: unknown) {
			if (!active.cancelRequested) {
				active.abortController.abort(error);
				void reader.cancel(error).catch(() => undefined);
				this.#logFailure("playground.chat.consume-failed", error);
				await this.#markFailed(active);
			}
		} finally {
			reader.releaseLock();
			await this.repository.finishStreamLog(active.run.id);
			active.replay.close();
			if (this.#active.get(active.chatId) === active) this.#active.delete(active.chatId);
			await this.#finalizeIfStillActive(active);
		}
	}

	async #markFailed(active: ActiveChatRun): Promise<void> {
		try {
			await this.repository.completeRun(active.chatId, active.run.id, {
				status: active.cancelRequested ? "cancelled" : "failed",
				...(active.cancelRequested ? {} : { errorCode: "generation_failed" as const }),
			});
		} catch (error: unknown) {
			if (!(error instanceof ChatNotFoundError) && !(error instanceof ChatRunNotFoundError)) {
				this.#logFailure("playground.chat.finalize-failed", error);
			}
		}
	}

	async #finalizeIfStillActive(active: ActiveChatRun): Promise<void> {
		try {
			const graph = await this.repository.get(active.chatId);
			if (graph?.activeRun?.id === active.run.id) await this.#markFailed(active);
		} catch (error: unknown) {
			this.#logFailure("playground.chat.finalize-check-failed", error);
		}
	}

	#logFailure(event: string, error: unknown): void {
		const errorType =
			error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(error.name)
				? error.name
				: "Error";
		this.#logger.error({ event, errorType });
	}

	#rejectInvalidMessages(
		reason: "message-identity" | "model-conversion" | "sdk-validation",
	): never {
		this.#logger.warn({ event: "playground.chat.request-rejected", reason });
		throw new BadRequestException("Invalid AI SDK UI messages.");
	}
}

class ChatRunCancelledError extends Error {
	override readonly name = "ChatRunCancelledError";
}

async function settleWithin(operation: Promise<unknown>, timeoutMs: number): Promise<boolean> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation.then(() => true),
			new Promise<boolean>((resolve) => {
				timeout = setTimeout(() => resolve(false), timeoutMs);
			}),
		]);
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
	}
}

class SseReplayChannel {
	readonly #encoder = new TextEncoder();
	readonly #chunks: Uint8Array[] = [];
	readonly #subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();
	#bytes = 0;
	#closed = false;

	constructor(private readonly maxBytes: number) {}

	publish(chunk: string): void {
		if (this.#closed) return;
		const encoded = this.#encoder.encode(chunk);
		if (this.#bytes + encoded.byteLength > this.maxBytes) {
			throw new Error("The active chat replay buffer exceeded its configured limit.");
		}
		this.#bytes += encoded.byteLength;
		this.#chunks.push(encoded);
		for (const subscriber of [...this.#subscribers]) {
			try {
				subscriber.enqueue(encoded);
			} catch {
				this.#subscribers.delete(subscriber);
			}
		}
	}

	subscribe(): ReadableStream<Uint8Array> {
		let subscriber: ReadableStreamDefaultController<Uint8Array> | undefined;
		return new ReadableStream<Uint8Array>({
			start: (controller) => {
				subscriber = controller;
				for (const chunk of this.#chunks) controller.enqueue(chunk);
				if (this.#closed) controller.close();
				else this.#subscribers.add(controller);
			},
			cancel: () => {
				if (subscriber !== undefined) this.#subscribers.delete(subscriber);
			},
		});
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		for (const subscriber of this.#subscribers) {
			try {
				subscriber.close();
			} catch {
				// A disconnected subscriber is already closed.
			}
		}
		this.#subscribers.clear();
	}
}

function assertBoundedHistory(messages: readonly unknown[]): void {
	if (new TextEncoder().encode(JSON.stringify(messages)).byteLength > MAX_HISTORY_BYTES) {
		throw new BadRequestException("Chat history is too large.");
	}
}

function messagesBelongToChat(
	messages: readonly PlaygroundChatUIMessage[],
	chatId: string,
): boolean {
	const ids = new Set<string>();
	for (const message of messages) {
		if (
			message.role === "system" ||
			message.id.length === 0 ||
			message.id.length > 256 ||
			ids.has(message.id)
		) {
			return false;
		}
		if (message.role === "user" && message.metadata !== undefined) return false;
		if (message.metadata !== undefined && message.metadata.chatId !== chatId) return false;
		ids.add(message.id);
	}
	return true;
}

function isAuthoritativeTransition(
	stored: readonly PlaygroundChatUIMessage[],
	incoming: readonly PlaygroundChatUIMessage[],
	request: Pick<ChatStreamDto, "trigger" | "messageId">,
): boolean {
	// UI messages cross both HTTP and durable JSON storage boundaries. AI SDK
	// stream objects can retain own optional properties whose value is undefined,
	// while JSON correctly omits them. Compare the wire representation so an
	// absent property and an explicitly undefined property do not look like a
	// rewritten transcript.
	return isCanonicalAuthoritativeTransition(
		jsonRoundTripMessages(stored),
		jsonRoundTripMessages(incoming),
		request,
	);
}

function isCanonicalAuthoritativeTransition(
	stored: readonly PlaygroundChatUIMessage[],
	incoming: readonly PlaygroundChatUIMessage[],
	request: Pick<ChatStreamDto, "trigger" | "messageId">,
): boolean {
	if (request.trigger === "regenerate-message") {
		if (request.messageId === undefined) {
			if (
				incoming.length === stored.length + 1 &&
				incoming.at(-1)?.role === "user" &&
				isDeepStrictEqual(incoming.slice(0, -1), stored)
			) {
				return true;
			}
			if (
				incoming.length === stored.length &&
				incoming.at(-1)?.role === "user" &&
				isDeepStrictEqual(incoming, stored)
			) {
				return true;
			}
			return (
				stored[incoming.length]?.role === "assistant" &&
				isDeepStrictEqual(incoming, stored.slice(0, incoming.length))
			);
		}
		const targetIndex = stored.findIndex((message) => message.id === request.messageId);
		if (targetIndex < 0) return false;
		const target = stored[targetIndex];
		if (target === undefined) return false;
		const prefixLength = target.role === "assistant" ? targetIndex : targetIndex + 1;
		return isDeepStrictEqual(incoming, stored.slice(0, prefixLength));
	}

	if (
		incoming.length === stored.length + 1 &&
		incoming.at(-1)?.role === "user" &&
		isDeepStrictEqual(incoming.slice(0, -1), stored)
	) {
		return true;
	}

	if (incoming.length !== stored.length || stored.length === 0) return false;
	if (!isDeepStrictEqual(incoming.slice(0, -1), stored.slice(0, -1))) return false;
	const previous = stored.at(-1);
	const updated = incoming.at(-1);
	return previous !== undefined && updated !== undefined && isApprovalOnlyUpdate(previous, updated);
}

function jsonRoundTripMessages(
	messages: readonly PlaygroundChatUIMessage[],
): PlaygroundChatUIMessage[] {
	return JSON.parse(JSON.stringify(messages)) as PlaygroundChatUIMessage[];
}

function isApprovalOnlyUpdate(
	previous: PlaygroundChatUIMessage,
	updated: PlaygroundChatUIMessage,
): boolean {
	if (
		previous.role !== "assistant" ||
		updated.role !== "assistant" ||
		previous.id !== updated.id ||
		!isDeepStrictEqual(previous.metadata, updated.metadata) ||
		previous.parts.length !== updated.parts.length
	) {
		return false;
	}

	let approvalChanged = false;
	for (const [index, previousPart] of previous.parts.entries()) {
		const updatedPart = updated.parts[index];
		if (updatedPart === undefined) return false;
		if (isDeepStrictEqual(previousPart, updatedPart)) continue;
		if (!isRecord(previousPart) || !isRecord(updatedPart)) return false;
		const previousRecord: Record<string, unknown> = previousPart;
		const updatedRecord: Record<string, unknown> = updatedPart;
		if (
			typeof previousRecord.type !== "string" ||
			!previousRecord.type.startsWith("tool-") ||
			updatedRecord.type !== previousRecord.type ||
			previousRecord.state !== "approval-requested" ||
			updatedRecord.state !== "approval-responded" ||
			!isRecord(previousRecord.approval) ||
			!isRecord(updatedRecord.approval) ||
			updatedRecord.approval.id !== previousRecord.approval.id ||
			typeof updatedRecord.approval.approved !== "boolean"
		) {
			return false;
		}
		const normalizedApproval = structuredClone(updatedRecord.approval);
		delete normalizedApproval.approved;
		delete normalizedApproval.reason;
		if (!isDeepStrictEqual(previousRecord.approval, normalizedApproval)) return false;
		const normalized = structuredClone(updatedRecord);
		normalized.state = previousRecord.state;
		normalized.approval = previousRecord.approval;
		if (!isDeepStrictEqual(previousRecord, normalized)) return false;
		approvalChanged = true;
	}
	return approvalChanged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
