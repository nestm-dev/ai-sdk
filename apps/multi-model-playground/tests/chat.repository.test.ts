import { Test, type TestingModule } from "@nestjs/testing";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ChatRepository, ChatRunConflictError } from "../src/chats/chat.repository.ts";
import {
	isSafeChatMemoryKey,
	MAX_CHAT_INPUT_MESSAGES,
	type PlaygroundChatUIMessage,
} from "../src/chats/chat.types.ts";
import { PlaygroundConfigService } from "../src/config/playground-config.service.ts";

describe("ChatRepository", () => {
	const temporaryDirectories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			temporaryDirectories.splice(0).map(async (directory) => {
				await rm(directory, { recursive: true, force: true });
			}),
		);
	});

	it("persists chats, transcripts, memory, and SSE logs with atomic state writes", async () => {
		const directory = await temporaryDirectory(temporaryDirectories);
		const first = await repositoryModule(directory);
		const repository = first.get(ChatRepository);
		const chatId = "11111111-1111-4111-8111-111111111111";
		const runId = "22222222-2222-4222-8222-222222222222";
		const userMessage = user("user-1", "remember this");

		await repository.create({
			id: chatId,
			title: "Persistent chat",
			provider: "openai",
			model: "gpt-5-mini",
		});
		await repository.writeMemory(chatId, "project", "observability");
		await repository.createStreamLog(runId);
		await repository.appendStreamLog(runId, 'data: {"type":"start"}\n\n');
		await repository.beginRun({
			chatId,
			runId,
			assistantMessageId: "assistant-1",
			messages: [userMessage],
		});
		await repository.completeRun(chatId, runId, {
			status: "completed",
			finishReason: "stop",
			messages: [userMessage, assistant(chatId, runId)],
		});
		await first.close();

		const second = await repositoryModule(directory);
		const restored = second.get(ChatRepository);
		const graph = await restored.get(chatId);

		expect(graph?.chat.messages.map((message) => message.id)).toEqual(["user-1", "assistant-1"]);
		expect(await restored.readMemory(chatId, "project")).toBe("observability");
		expect(await restored.readStreamLog(runId)).toContain('"type":"start"');
		expect(await readdir(directory)).toEqual(expect.arrayContaining(["chats.v1.json", "streams"]));
		expect((await readdir(directory)).some((name) => name.endsWith(".tmp"))).toBe(false);
		await second.close();
	});

	it("keeps in-memory authority identical to its JSON representation", async () => {
		const directory = await temporaryDirectory(temporaryDirectories);
		const first = await repositoryModule(directory);
		const repository = first.get(ChatRepository);
		const chatId = "13131313-1313-4313-8313-131313131313";
		const runId = "24242424-2424-4424-8424-242424242424";
		const userMessage = user("canonical-user", "canonical input");
		const assistantMessage = assistant(chatId, runId, "canonical-assistant");
		const textPart = assistantMessage.parts.find((part) => part.type === "text");
		if (textPart === undefined) throw new Error("Expected an assistant text part.");
		Object.defineProperty(textPart, "providerMetadata", {
			configurable: true,
			enumerable: true,
			value: undefined,
			writable: true,
		});

		await repository.create({
			id: chatId,
			title: "Canonical state",
			provider: "openai",
			model: "gpt-5-mini",
		});
		await repository.beginRun({
			chatId,
			runId,
			assistantMessageId: assistantMessage.id,
			messages: [userMessage],
		});
		await repository.completeRun(chatId, runId, {
			status: "completed",
			finishReason: "stop",
			messages: [userMessage, assistantMessage],
		});

		const immediate = await repository.get(chatId);
		expect(immediate).toStrictEqual(JSON.parse(JSON.stringify(immediate)));
		const immediateTextPart = immediate?.chat.messages[1]?.parts.find(
			(part) => part.type === "text",
		);
		expect(Object.hasOwn(immediateTextPart ?? {}, "providerMetadata")).toBe(false);
		await first.close();

		const second = await repositoryModule(directory);
		expect(await second.get(ChatRepository).get(chatId)).toStrictEqual(immediate);
		await second.close();
	});

	it("serializes concurrent chat mutations and fails closed after an interrupted process run", async () => {
		const directory = await temporaryDirectory(temporaryDirectories);
		const first = await repositoryModule(directory);
		const repository = first.get(ChatRepository);
		const firstChatId = "33333333-3333-4333-8333-333333333333";
		const secondChatId = "44444444-4444-4444-8444-444444444444";
		await Promise.all([
			repository.create({
				id: firstChatId,
				title: "First",
				provider: "anthropic",
				model: "claude-haiku-4-5",
			}),
			repository.create({
				id: secondChatId,
				title: "Second",
				provider: "google",
				model: "gemini-2.5-flash",
			}),
		]);
		await repository.beginRun({
			chatId: firstChatId,
			runId: "55555555-5555-4555-8555-555555555555",
			assistantMessageId: "assistant-interrupted",
			messages: [user("user-interrupted", "keep working")],
		});
		await first.close();

		const second = await repositoryModule(directory);
		const restored = second.get(ChatRepository);
		const page = await restored.list(undefined, 10);
		const interrupted = await restored.getRun(firstChatId, "55555555-5555-4555-8555-555555555555");

		expect(page.graphs).toHaveLength(2);
		expect((await restored.get(firstChatId))?.activeRun).toBeNull();
		expect(interrupted).toMatchObject({ status: "failed", errorCode: "interrupted_by_restart" });
		await second.close();
	});

	it("keeps cancellation active until finalization and clears a stale marker on restart", async () => {
		const directory = await temporaryDirectory(temporaryDirectories);
		const first = await repositoryModule(directory);
		const repository = first.get(ChatRepository);
		const chatId = "12121212-1212-4212-8212-121212121212";
		const runId = "23232323-2323-4232-8232-232323232323";
		await repository.create({
			id: chatId,
			title: "Cancellation marker",
			provider: "openai",
			model: "gpt-5-mini",
		});
		await repository.beginRun({
			chatId,
			runId,
			assistantMessageId: "cancelled-assistant",
			messages: [user("cancelled-user", "please stop")],
		});

		await repository.requestRunCancellation(chatId, runId);
		expect((await repository.get(chatId))?.activeRun).toMatchObject({
			id: runId,
			status: "cancelled",
		});
		await expect(repository.remove(chatId)).rejects.toBeInstanceOf(ChatRunConflictError);
		await first.close();

		const second = await repositoryModule(directory);
		const restored = second.get(ChatRepository);
		expect((await restored.get(chatId))?.activeRun).toBeNull();
		expect(await restored.getRun(chatId, runId)).toMatchObject({ status: "cancelled" });
		await second.close();
	});

	it("does not recreate an active SSE log after it has been removed", async () => {
		const directory = await temporaryDirectory(temporaryDirectories);
		const moduleReference = await repositoryModule(directory);
		const repository = moduleReference.get(ChatRepository);
		const runId = "34343434-3434-4434-8434-343434343434";

		await repository.createStreamLog(runId);
		repository.activateStreamLog(runId);
		await repository.appendStreamLog(runId, "before removal");
		await repository.removeStreamLog(runId);
		await repository.appendStreamLog(runId, "late append");
		await repository.finishStreamLog(runId);

		expect(await repository.readStreamLog(runId)).toBe("");
		await moduleReference.close();
	});

	it("rejects memory keys inherited from Object.prototype", async () => {
		const directory = await temporaryDirectory(temporaryDirectories);
		const moduleReference = await repositoryModule(directory);
		const repository = moduleReference.get(ChatRepository);
		const chatId = "45454545-4545-4454-8454-454545454545";
		await repository.create({
			id: chatId,
			title: "Memory keys",
			provider: "google",
			model: "gemini-2.5-flash",
		});

		for (const key of ["__proto__", "constructor", "toString"]) {
			expect(isSafeChatMemoryKey(key)).toBe(false);
			await expect(repository.readMemory(chatId, key)).rejects.toBeInstanceOf(TypeError);
			await expect(repository.writeMemory(chatId, key, "unsafe")).rejects.toBeInstanceOf(TypeError);
			await expect(repository.deleteMemory(chatId, key)).rejects.toBeInstanceOf(TypeError);
		}
		await repository.writeMemory(chatId, "safe-key", "safe");
		expect(await repository.readMemory(chatId, "safe-key")).toBe("safe");
		await moduleReference.close();
	});

	it("fences late completion writes from a superseded run", async () => {
		const directory = await temporaryDirectory(temporaryDirectories);
		const moduleReference = await repositoryModule(directory);
		const repository = moduleReference.get(ChatRepository);
		const chatId = "66666666-6666-4666-8666-666666666666";
		const firstRunId = "77777777-7777-4777-8777-777777777777";
		const secondRunId = "88888888-8888-4888-8888-888888888888";
		const firstUser = user("first-user", "first");
		const secondUser = user("second-user", "second");
		await repository.create({
			id: chatId,
			title: "Completion fencing",
			provider: "openai",
			model: "gpt-5-mini",
		});
		await repository.beginRun({
			chatId,
			runId: firstRunId,
			assistantMessageId: "first-assistant",
			messages: [firstUser],
		});
		await repository.completeRun(chatId, firstRunId, { status: "cancelled" });
		await repository.beginRun({
			chatId,
			runId: secondRunId,
			assistantMessageId: "second-assistant",
			messages: [firstUser, secondUser],
		});

		await repository.completeRun(chatId, firstRunId, {
			status: "completed",
			messages: [firstUser, assistant(chatId, firstRunId, "first-assistant")],
		});

		const graph = await repository.get(chatId);
		expect(graph?.activeRun?.id).toBe(secondRunId);
		expect(graph?.chat.messages.map((message) => message.id)).toEqual([
			"first-user",
			"second-user",
		]);
		await moduleReference.close();
	});

	it("restores the maximum input history plus its generated assistant message", async () => {
		const directory = await temporaryDirectory(temporaryDirectories);
		const first = await repositoryModule(directory);
		const repository = first.get(ChatRepository);
		const chatId = "99999999-9999-4999-8999-999999999999";
		const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const history = Array.from({ length: MAX_CHAT_INPUT_MESSAGES }, (_, index) =>
			user(`history-${index}`, `message-${index}`),
		);
		await repository.create({
			id: chatId,
			title: "History limit",
			provider: "openai",
			model: "gpt-5-mini",
		});
		await repository.beginRun({
			chatId,
			runId,
			assistantMessageId: "limit-assistant",
			messages: history,
		});
		await repository.completeRun(chatId, runId, {
			status: "completed",
			messages: [...history, assistant(chatId, runId, "limit-assistant")],
		});
		await first.close();

		const second = await repositoryModule(directory);
		const restored = second.get(ChatRepository);
		expect((await restored.get(chatId))?.chat.messages).toHaveLength(MAX_CHAT_INPUT_MESSAGES + 1);
		await second.close();
	});
});

async function temporaryDirectory(registry: string[]): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "nestm-ai-sdk-chat-"));
	registry.push(directory);
	return directory;
}

async function repositoryModule(directory: string): Promise<TestingModule> {
	const moduleReference = await Test.createTestingModule({
		providers: [
			ChatRepository,
			{
				provide: PlaygroundConfigService,
				useValue: { chatStateDirectory: directory },
			},
		],
	}).compile();
	await moduleReference.init();
	return moduleReference;
}

function user(id: string, text: string): PlaygroundChatUIMessage {
	return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistant(
	chatId: string,
	runId: string,
	messageId = "assistant-1",
): PlaygroundChatUIMessage {
	return {
		id: messageId,
		role: "assistant",
		metadata: {
			chatId,
			runId,
			provider: "openai",
			model: "gpt-5-mini",
			startedAt: "2026-08-23T00:00:00.000Z",
			completedAt: "2026-08-23T00:00:01.000Z",
			finishReason: "stop",
		},
		parts: [{ type: "text", text: "Stored" }],
	};
}
