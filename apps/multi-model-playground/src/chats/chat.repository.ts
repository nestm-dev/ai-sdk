import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

import { PROVIDER_IDS } from "../config/playground-config.service.ts";
import { PlaygroundConfigService } from "../config/playground-config.service.ts";
import {
	isSafeChatMemoryKey,
	MAX_STORED_CHAT_MESSAGES,
	type RunCompletion,
	type StoredChat,
	type StoredChatRun,
	type StoredChatStateV1,
} from "./chat.types.ts";

const STATE_FILENAME = "chats.v1.json";
const STREAM_DIRECTORY = "streams";

const persistedMessageSchema = z
	.object({
		id: z.string().min(1).max(256),
		role: z.enum(["user", "assistant"]),
		metadata: z.unknown().optional(),
		parts: z.array(z.unknown()),
	})
	.passthrough();

const storedChatSchema = z.object({
	id: z.uuid(),
	title: z.string().min(1).max(120),
	provider: z.enum(PROVIDER_IDS),
	model: z.string().min(1).max(128),
	createdAt: z.string(),
	updatedAt: z.string(),
	messages: z.array(persistedMessageSchema).max(MAX_STORED_CHAT_MESSAGES),
	memory: z.record(z.string(), z.string()),
	activeRunId: z.uuid().nullable(),
});

const storedRunSchema = z.object({
	id: z.uuid(),
	chatId: z.uuid(),
	assistantMessageId: z.string().min(1).max(256),
	provider: z.enum(PROVIDER_IDS),
	model: z.string().min(1).max(128),
	status: z.enum(["running", "completed", "failed", "cancelled"]),
	startedAt: z.string(),
	completedAt: z.string().nullable(),
	finishReason: z
		.enum(["stop", "length", "content-filter", "tool-calls", "error", "other"])
		.optional(),
	errorCode: z.enum(["generation_failed", "interrupted_by_restart"]).optional(),
});

const storedStateSchema = z.object({
	version: z.literal(1),
	chats: z.record(z.string(), storedChatSchema),
	runs: z.record(z.string(), storedRunSchema),
});

export interface StoredChatGraph {
	readonly chat: StoredChat;
	readonly activeRun: StoredChatRun | null;
}

export class ChatNotFoundError extends Error {}
export class ChatRunConflictError extends Error {}
export class ChatRunNotFoundError extends Error {}

@Injectable()
export class ChatRepository implements OnModuleInit {
	readonly #directory: string;
	readonly #statePath: string;
	readonly #streamDirectory: string;
	#state: StoredChatStateV1 = emptyState();
	#mutationTail: Promise<void> = Promise.resolve();
	readonly #streamTails = new Map<string, Promise<void>>();
	readonly #activeStreamLogs = new Set<string>();
	readonly #removedActiveStreamLogs = new Set<string>();

	constructor(@Inject(PlaygroundConfigService) config: PlaygroundConfigService) {
		this.#directory = resolve(config.chatStateDirectory);
		this.#statePath = resolve(this.#directory, STATE_FILENAME);
		this.#streamDirectory = resolve(this.#directory, STREAM_DIRECTORY);
	}

	async onModuleInit(): Promise<void> {
		await mkdir(this.#streamDirectory, { recursive: true, mode: 0o700 });
		try {
			const persisted = JSON.parse(await readFile(this.#statePath, "utf8")) as unknown;
			const parsed = storedStateSchema.safeParse(persisted);
			if (!parsed.success) throw new Error("The local chat state file is invalid.");
			this.#state = parsed.data as unknown as StoredChatStateV1;
		} catch (error: unknown) {
			if (!isMissingFile(error)) throw error;
			this.#state = await this.#persist(this.#state);
		}

		if (
			Object.values(this.#state.runs).some((run) => run.status === "running") ||
			Object.values(this.#state.chats).some((chat) => chat.activeRunId !== null)
		) {
			await this.#mutate((draft) => {
				const completedAt = new Date().toISOString();
				for (const run of Object.values(draft.runs)) {
					if (run.status !== "running") continue;
					run.status = "failed";
					run.completedAt = completedAt;
					run.errorCode = "interrupted_by_restart";
				}
				for (const chat of Object.values(draft.chats)) {
					if (chat.activeRunId === null) continue;
					chat.activeRunId = null;
					chat.updatedAt = completedAt;
				}
			});
		}
	}

	async list(
		cursor: string | undefined,
		limit: number,
	): Promise<{
		readonly graphs: readonly StoredChatGraph[];
		readonly nextCursor: string | null;
	}> {
		await this.#mutationTail;
		const chats = Object.values(this.#state.chats).toSorted(
			(left, right) =>
				right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
		);
		const cursorIndex = cursor === undefined ? -1 : chats.findIndex((chat) => chat.id === cursor);
		const start = cursor === undefined ? 0 : cursorIndex + 1;
		const page = start <= 0 && cursor !== undefined ? [] : chats.slice(start, start + limit);
		const nextCursor = start + page.length < chats.length ? (page.at(-1)?.id ?? null) : null;
		return {
			graphs: page.map((chat) => this.#graph(this.#state, chat)),
			nextCursor,
		};
	}

	async get(chatId: string): Promise<StoredChatGraph | undefined> {
		await this.#mutationTail;
		const chat = this.#state.chats[chatId];
		return chat === undefined ? undefined : this.#graph(this.#state, chat);
	}

	async create(input: {
		readonly id: string;
		readonly title: string;
		readonly provider: StoredChat["provider"];
		readonly model: string;
	}): Promise<StoredChatGraph> {
		return this.#mutate((draft) => {
			const timestamp = new Date().toISOString();
			const chat: StoredChat = {
				id: input.id,
				title: input.title,
				provider: input.provider,
				model: input.model,
				createdAt: timestamp,
				updatedAt: timestamp,
				messages: [],
				memory: {},
				activeRunId: null,
			};
			draft.chats[chat.id] = chat;
			return this.#graph(draft, chat);
		});
	}

	async update(
		chatId: string,
		input: {
			readonly title?: string;
			readonly provider?: StoredChat["provider"];
			readonly model?: string;
		},
	): Promise<StoredChatGraph> {
		return this.#mutate((draft) => {
			const chat = requireChat(draft, chatId);
			if (
				chat.activeRunId !== null &&
				(input.provider !== undefined || input.model !== undefined)
			) {
				throw new ChatRunConflictError("Cannot change a provider while a run is active.");
			}
			if (input.title !== undefined) chat.title = input.title;
			if (input.provider !== undefined) chat.provider = input.provider;
			if (input.model !== undefined) chat.model = input.model;
			chat.updatedAt = new Date().toISOString();
			return this.#graph(draft, chat);
		});
	}

	async remove(chatId: string): Promise<void> {
		const runIds = await this.#mutate((draft) => {
			const chat = requireChat(draft, chatId);
			if (chat.activeRunId !== null) {
				throw new ChatRunConflictError("Cannot delete a chat while a run is active.");
			}
			const ids = Object.values(draft.runs)
				.filter((run) => run.chatId === chatId)
				.map((run) => run.id);
			for (const runId of ids) delete draft.runs[runId];
			delete draft.chats[chatId];
			return ids;
		});
		await Promise.all(runIds.map(async (runId) => await this.removeStreamLog(runId)));
	}

	async beginRun(input: {
		readonly chatId: string;
		readonly runId: string;
		readonly assistantMessageId: string;
		readonly messages: Readonly<StoredChat["messages"]>;
	}): Promise<{ readonly chat: StoredChat; readonly run: StoredChatRun }> {
		return this.#mutate((draft) => {
			const chat = requireChat(draft, input.chatId);
			if (chat.activeRunId !== null) {
				throw new ChatRunConflictError("A run is already active for this chat.");
			}
			const startedAt = new Date().toISOString();
			const run: StoredChatRun = {
				id: input.runId,
				chatId: chat.id,
				assistantMessageId: input.assistantMessageId,
				provider: chat.provider,
				model: chat.model,
				status: "running",
				startedAt,
				completedAt: null,
			};
			chat.messages = structuredClone([...input.messages]);
			chat.activeRunId = run.id;
			chat.updatedAt = startedAt;
			if (chat.title === "New chat") chat.title = suggestedTitle(chat.messages);
			draft.runs[run.id] = run;
			return { chat: structuredClone(chat), run: structuredClone(run) };
		});
	}

	async completeRun(
		chatId: string,
		runId: string,
		completion: RunCompletion,
	): Promise<StoredChatRun> {
		return this.#mutate((draft) => {
			const chat = requireChat(draft, chatId);
			const run = draft.runs[runId];
			if (run === undefined || run.chatId !== chatId) throw new ChatRunNotFoundError();
			const isCurrentRun = chat.activeRunId === runId;
			const completedAt = new Date().toISOString();
			if (isCurrentRun && completion.messages !== undefined) {
				chat.messages = structuredClone([...completion.messages]);
			}
			if (isCurrentRun) chat.updatedAt = completedAt;
			if (run.status === "running") {
				run.status = completion.status;
				run.completedAt = completedAt;
				if (completion.finishReason !== undefined) run.finishReason = completion.finishReason;
				if (completion.errorCode !== undefined) run.errorCode = completion.errorCode;
			}
			if (isCurrentRun) chat.activeRunId = null;
			return structuredClone(run);
		});
	}

	async requestRunCancellation(chatId: string, runId: string): Promise<StoredChatRun> {
		return this.#mutate((draft) => {
			const chat = requireChat(draft, chatId);
			const run = draft.runs[runId];
			if (run === undefined || run.chatId !== chatId) throw new ChatRunNotFoundError();
			if (run.status === "cancelled") return structuredClone(run);
			if (run.status !== "running" || chat.activeRunId !== runId) {
				throw new ChatRunConflictError("The run is not the current active run.");
			}
			const completedAt = new Date().toISOString();
			run.status = "cancelled";
			run.completedAt = completedAt;
			chat.updatedAt = completedAt;
			return structuredClone(run);
		});
	}

	async getRun(chatId: string, runId: string): Promise<StoredChatRun | undefined> {
		await this.#mutationTail;
		const run = this.#state.runs[runId];
		return run?.chatId === chatId ? structuredClone(run) : undefined;
	}

	async readMemory(chatId: string, key: string): Promise<string | null> {
		assertSafeMemoryKey(key);
		await this.#mutationTail;
		const chat = this.#state.chats[chatId];
		if (chat === undefined) throw new ChatNotFoundError();
		return Object.hasOwn(chat.memory, key) ? (chat.memory[key] ?? null) : null;
	}

	async writeMemory(chatId: string, key: string, value: string): Promise<void> {
		assertSafeMemoryKey(key);
		await this.#mutate((draft) => {
			const chat = requireChat(draft, chatId);
			chat.memory[key] = value;
			chat.updatedAt = new Date().toISOString();
		});
	}

	async deleteMemory(chatId: string, key: string): Promise<boolean> {
		assertSafeMemoryKey(key);
		return this.#mutate((draft) => {
			const chat = requireChat(draft, chatId);
			const existed = Object.hasOwn(chat.memory, key);
			delete chat.memory[key];
			chat.updatedAt = new Date().toISOString();
			return existed;
		});
	}

	async createStreamLog(runId: string): Promise<void> {
		const handle = await open(this.streamPath(runId), "wx", 0o600);
		await handle.close();
		this.#removedActiveStreamLogs.delete(runId);
	}

	activateStreamLog(runId: string): void {
		this.#activeStreamLogs.add(runId);
	}

	appendStreamLog(runId: string, chunk: string): Promise<void> {
		if (this.#removedActiveStreamLogs.has(runId)) return Promise.resolve();
		const previous = this.#streamTails.get(runId) ?? Promise.resolve();
		const next = previous.then(async () => {
			await appendFile(this.streamPath(runId), chunk, { encoding: "utf8", mode: 0o600 });
		});
		this.#streamTails.set(
			runId,
			next.catch(() => undefined),
		);
		return next;
	}

	async readStreamLog(runId: string): Promise<string> {
		await this.#streamTails.get(runId);
		try {
			return await readFile(this.streamPath(runId), "utf8");
		} catch (error: unknown) {
			if (isMissingFile(error)) return "";
			throw error;
		}
	}

	async removeStreamLog(runId: string): Promise<void> {
		if (this.#activeStreamLogs.has(runId)) this.#removedActiveStreamLogs.add(runId);
		await this.#streamTails.get(runId);
		this.#streamTails.delete(runId);
		await ignoreMissingUnlink(this.streamPath(runId));
	}

	async finishStreamLog(runId: string): Promise<void> {
		await this.#streamTails.get(runId);
		this.#streamTails.delete(runId);
		this.#activeStreamLogs.delete(runId);
		this.#removedActiveStreamLogs.delete(runId);
	}

	streamPath(runId: string): string {
		return resolve(this.#streamDirectory, `${runId}.sse`);
	}

	#graph(state: StoredChatStateV1, chat: StoredChat): StoredChatGraph {
		const activeRun = chat.activeRunId === null ? null : (state.runs[chat.activeRunId] ?? null);
		return structuredClone({ chat, activeRun });
	}

	#mutate<RESULT>(mutation: (draft: StoredChatStateV1) => RESULT): Promise<RESULT> {
		const operation = this.#mutationTail.then(async () => {
			const draft = structuredClone(this.#state);
			const result = mutation(draft);
			this.#state = await this.#persist(draft);
			return structuredClone(result);
		});
		this.#mutationTail = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;
	}

	async #persist(state: StoredChatStateV1): Promise<StoredChatStateV1> {
		const temporary = resolve(
			this.#directory,
			`.${STATE_FILENAME}.${process.pid}.${randomUUID()}.tmp`,
		);
		const serialized = `${JSON.stringify(state, null, 2)}\n`;
		const canonical = storedStateSchema.parse(
			JSON.parse(serialized),
		) as unknown as StoredChatStateV1;
		let handle: Awaited<ReturnType<typeof open>> | undefined;
		try {
			handle = await open(temporary, "wx", 0o600);
			await handle.writeFile(serialized, "utf8");
			await handle.sync();
			await handle.close();
			handle = undefined;
			await rename(temporary, this.#statePath);
			return canonical;
		} catch (error: unknown) {
			await handle?.close().catch(() => undefined);
			await ignoreMissingUnlink(temporary);
			throw error;
		}
	}
}

function emptyState(): StoredChatStateV1 {
	return { version: 1, chats: {}, runs: {} };
}

function requireChat(state: StoredChatStateV1, chatId: string): StoredChat {
	const chat = state.chats[chatId];
	if (chat === undefined) throw new ChatNotFoundError();
	return chat;
}

function assertSafeMemoryKey(key: string): void {
	if (!isSafeChatMemoryKey(key)) throw new TypeError("Invalid chat memory key.");
}

function suggestedTitle(messages: Readonly<StoredChat["messages"]>): string {
	for (const message of messages) {
		if (message.role !== "user") continue;
		const text = message.parts.find(
			(part): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
				part.type === "text",
		)?.text;
		if (text !== undefined && text.trim() !== "") {
			return text.trim().replaceAll(/\s+/gu, " ").slice(0, 120);
		}
	}
	return "New chat";
}

function isMissingFile(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { readonly code?: unknown }).code === "ENOENT"
	);
}

async function ignoreMissingUnlink(path: string): Promise<void> {
	try {
		await unlink(path);
	} catch (error: unknown) {
		if (!isMissingFile(error)) throw error;
	}
}
