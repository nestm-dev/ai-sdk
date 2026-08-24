import {
	BadRequestException,
	ConflictException,
	ValidationPipe,
	type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AiSdkModule } from "@nestm/ai-sdk";
import {
	AiSdkObservabilityModule,
	AiSdkObservabilityService,
	AiSdkObservabilityTelemetryModule,
	initializeAiSdkTelemetry,
} from "@nestm/ai-sdk/observability";
import { MockLanguageModelV4, MockProviderV4 } from "ai/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ChatRepository } from "../src/chats/chat.repository.ts";
import { ChatRunService } from "../src/chats/chat-run.service.ts";
import { ChatService } from "../src/chats/chat.service.ts";
import { ChatsModule } from "../src/chats/chats.module.ts";
import type { PlaygroundChatUIMessage } from "../src/chats/chat.types.ts";
import { PlaygroundConfigService } from "../src/config/playground-config.service.ts";
import { SafeExceptionFilter } from "../src/http/safe-exception.filter.ts";
import { SafeHttpException } from "../src/http/safe-http.exception.ts";

const CONTENT_SENTINEL = "private-chat-content-sentinel";
type LanguageModelV4StreamPart =
	Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer Part>
		? Part
		: never;

describe("durable multi-chat runs", () => {
	let app: INestApplication;
	let chats: ChatService;
	let runs: ChatRunService;
	let repository: ChatRepository;
	let observability: AiSdkObservabilityService;
	let directory: string;
	let baseUrl: string;
	const models = new ControlledModels();

	beforeAll(async () => {
		directory = await mkdtemp(join(tmpdir(), "nestm-ai-sdk-runs-"));
		for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]) {
			vi.stubEnv(key, `test-only-${key.toLowerCase()}-credential`);
		}
		vi.stubEnv("CHAT_STATE_DIR", directory);
		const { PlaygroundConfigModule } = await import("../src/config/playground-config.module.ts");
		const moduleReference = await Test.createTestingModule({
			imports: [
				PlaygroundConfigModule,
				AiSdkModule.forRoot({ providers: models.providers() }),
				AiSdkObservabilityModule.forRoot(),
				AiSdkObservabilityTelemetryModule.register({ registration: "global" }),
				ChatsModule,
			],
		}).compile();
		app = moduleReference.createNestApplication();
		app.useGlobalFilters(new SafeExceptionFilter());
		app.useGlobalPipes(
			new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
		);
		await initializeAiSdkTelemetry(app);
		await app.listen(0, "127.0.0.1");
		baseUrl = await app.getUrl();
		chats = moduleReference.get(ChatService);
		runs = moduleReference.get(ChatRunService);
		repository = moduleReference.get(ChatRepository);
		observability = moduleReference.get(AiSdkObservabilityService);
	});

	afterAll(async () => {
		models.releaseAll();
		if (app) await app.close();
		if (directory) await rm(directory, { recursive: true, force: true });
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it("allows concurrent runs across chats, rejects a second run in one chat, and resumes replay", async () => {
		const first = await chats.create({ provider: "openai", title: "First" });
		const second = await chats.create({ provider: "anthropic", title: "Second" });
		const firstResponse = await runs.stream(first.id, streamRequest(user("first-user")));
		const secondResponse = await runs.stream(second.id, streamRequest(user("second-user")));
		const firstRunId = requireRunId(await firstResponse.resolve());
		const secondRunId = requireRunId(await secondResponse.resolve());

		await waitFor(async () => models.started >= 2);
		await expect(
			runs.stream(first.id, streamRequest(user("first-user"), user("duplicate-user"))),
		).rejects.toBeInstanceOf(ConflictException);
		expect((await repository.get(first.id))?.activeRun?.id).toBe(firstRunId);
		expect((await repository.get(second.id))?.activeRun?.id).toBe(secondRunId);

		const resumed = await (await runs.resume(first.id)).resolve();
		expect(resumed.status).toBe(200);
		const resumedBody = resumed.text();
		models.releaseAll();
		expect(await resumedBody).toContain(CONTENT_SENTINEL);
		await waitFor(async () => (await repository.get(first.id))?.activeRun === null);
		await waitFor(async () => (await repository.get(second.id))?.activeRun === null);
		expect((await (await runs.resume(first.id)).resolve()).status).toBe(204);
	});

	it("lists persisted chats over HTTP when the limit query is omitted", async () => {
		const created = await chats.create({ provider: "openai", title: "HTTP list default" });
		const response = await fetch(`${baseUrl}/playground/v1/chats`);
		const body = (await response.json()) as { readonly chats?: readonly { readonly id: string }[] };

		expect(response.status).toBe(200);
		expect(body.chats?.some((chat) => chat.id === created.id)).toBe(true);
	});

	it("persists provider stream setup failures as failed runs", async () => {
		const chat = await chats.create({ provider: "openai", title: "Provider failure" });
		models.failNext();
		const response = await runs.stream(chat.id, streamRequest(user("failure-user")));
		const resolved = await response.resolve();
		const runId = requireRunId(resolved);
		await resolved.text();

		await waitFor(async () => (await repository.getRun(chat.id, runId))?.status === "failed");
		expect(await repository.getRun(chat.id, runId)).toMatchObject({
			status: "failed",
			errorCode: "generation_failed",
		});
		expect((await repository.get(chat.id))?.activeRun).toBeNull();
	});

	it("rejects message ids and file parts that cannot be restored", async () => {
		const chat = await chats.create({ provider: "google", title: "Persistence validation" });
		const malformedFile = {
			id: "bad-file-user",
			role: "user",
			parts: [{ type: "file", mediaType: "text/plain", url: "not a URL" }],
		} as PlaygroundChatUIMessage;

		await expect(runs.stream(chat.id, streamRequest(user("")))).rejects.toBeInstanceOf(
			BadRequestException,
		);
		await expect(runs.stream(chat.id, streamRequest(user("x".repeat(257))))).rejects.toBeInstanceOf(
			BadRequestException,
		);
		await expect(runs.stream(chat.id, streamRequest(malformedFile))).rejects.toBeInstanceOf(
			BadRequestException,
		);

		expect((await repository.get(chat.id))?.chat.messages).toEqual([]);
		expect((await repository.get(chat.id))?.activeRun).toBeNull();

		const restoredModule = await Test.createTestingModule({
			providers: [
				ChatRepository,
				{
					provide: PlaygroundConfigService,
					useValue: { chatStateDirectory: directory },
				},
			],
		}).compile();
		await restoredModule.init();
		expect((await restoredModule.get(ChatRepository).get(chat.id))?.chat.messages).toEqual([]);
		await restoredModule.close();
	});

	it("cancels only the current keyed run and persists the partial replay log", async () => {
		const chat = await chats.create({ provider: "google", title: "Cancellation" });
		const response = await runs.stream(chat.id, streamRequest(user("cancel-user")));
		const runId = requireRunId(await response.resolve());
		await waitFor(async () => (await repository.get(chat.id))?.activeRun?.id === runId);
		await waitFor(async () => (await repository.readStreamLog(runId)).includes(CONTENT_SENTINEL));

		const cancelled = await runs.cancel(chat.id, runId);

		expect(cancelled.run.status).toBe("cancelled");
		await waitFor(async () => (await repository.get(chat.id))?.activeRun === null);
		expect((await repository.getRun(chat.id, runId))?.status).toBe("cancelled");
		await waitFor(async () => (await repository.readStreamLog(runId)).length > 0);
		expect(await repository.readStreamLog(runId)).toContain(CONTENT_SENTINEL);
		expect(JSON.stringify((await chats.get(chat.id)).messages)).toContain(CONTENT_SENTINEL);
	});

	it("keeps a cancelled chat locked until an abort-ignoring producer exits", async () => {
		const chat = await chats.create({ provider: "anthropic", title: "Slow cancellation" });
		const startedBefore = models.started;
		models.ignoreAbortNext();
		const response = await runs.stream(chat.id, streamRequest(user("slow-cancel-user")));
		const runId = requireRunId(await response.resolve());
		await waitFor(() => models.started > startedBefore);

		const cancelStartedAt = Date.now();
		const cancelled = await runs.cancel(chat.id, runId);
		expect(Date.now() - cancelStartedAt).toBeLessThan(2_000);
		expect(cancelled.run.status).toBe("cancelled");
		expect((await repository.get(chat.id))?.activeRun).toMatchObject({
			id: runId,
			status: "cancelled",
		});
		await expect(
			runs.stream(chat.id, streamRequest(user("slow-cancel-user"), user("overlapping-user"))),
		).rejects.toBeInstanceOf(ConflictException);
		await expect(chats.remove(chat.id)).rejects.toBeInstanceOf(ConflictException);

		models.releaseAll();
		await waitFor(async () => (await repository.get(chat.id))?.activeRun === null);
		await chats.remove(chat.id);
		expect(await repository.readStreamLog(runId)).toBe("");
	});

	it("rejects rewritten history and keeps AI observability content-free", async () => {
		const chat = await chats.create({ provider: "openai", title: "Authority" });
		const original = user("authority-user");
		const startedBefore = models.started;
		const response = await runs.stream(chat.id, streamRequest(original));
		const runId = requireRunId(await response.resolve());
		await waitFor(() => models.started > startedBefore);
		models.releaseAll();
		await waitFor(async () => (await repository.getRun(chat.id, runId))?.status === "completed");
		const persisted = await chats.get(chat.id);
		const rewritten = structuredClone(persisted.messages) as PlaygroundChatUIMessage[];
		const firstPart = rewritten[0]?.parts[0];
		if (firstPart?.type === "text") firstPart.text = "rewritten-history";
		rewritten.push(user("new-user"));

		await expect(runs.stream(chat.id, streamRequest(...rewritten))).rejects.toMatchObject({
			code: "CHAT_TRANSCRIPT_DIVERGED",
		});
		await expect(runs.stream(chat.id, streamRequest(...rewritten))).rejects.toBeInstanceOf(
			SafeHttpException,
		);
		const rejected = await fetch(`${baseUrl}/playground/v1/chats/${chat.id}/stream`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(streamRequest(...rewritten)),
		});
		const rejectionBody = await rejected.json();
		expect(rejected.status).toBe(409);
		expect(rejectionBody).toEqual({
			code: "CHAT_TRANSCRIPT_DIVERGED",
			message: "The chat changed. Refresh it and try again.",
		});
		expect(JSON.stringify(rejectionBody)).not.toContain("rewritten-history");
		const snapshot = observability.snapshot();
		expect(snapshot.coverage.contentCaptured).toBe(false);
		expect(snapshot.totals.operations.started).toBeGreaterThan(0);
		expect(JSON.stringify(snapshot)).not.toContain(CONTENT_SENTINEL);
	});

	it("accepts the JSON wire transcript on consecutive turns", async () => {
		const chat = await chats.create({ provider: "anthropic", title: "Consecutive turns" });
		const startedBeforeFirst = models.started;
		const first = await runs.stream(chat.id, streamRequest(user("wire-first")));
		const firstRunId = requireRunId(await first.resolve());
		await waitFor(() => models.started > startedBeforeFirst);
		models.releaseAll();
		await waitFor(
			async () => (await repository.getRun(chat.id, firstRunId))?.status === "completed",
		);

		const firstTurn = await chats.get(chat.id);
		const wireMessages = JSON.parse(
			JSON.stringify(firstTurn.messages),
		) as PlaygroundChatUIMessage[];
		const startedBeforeSecond = models.started;
		const second = await runs.stream(chat.id, streamRequest(...wireMessages, user("wire-second")));
		const secondRunId = requireRunId(await second.resolve());
		await waitFor(() => models.started > startedBeforeSecond);
		models.releaseAll();
		await waitFor(
			async () => (await repository.getRun(chat.id, secondRunId))?.status === "completed",
		);
		expect((await chats.get(chat.id)).messages).toHaveLength(4);
	});

	it("regenerates an earlier assistant and retries a user turn that was not persisted", async () => {
		const chat = await chats.create({ provider: "openai", title: "Regeneration" });
		const startedBeforeFirst = models.started;
		const first = await runs.stream(chat.id, streamRequest(user("regen-first")));
		const firstRunId = requireRunId(await first.resolve());
		await waitFor(() => models.started > startedBeforeFirst);
		models.releaseAll();
		await waitFor(
			async () => (await repository.getRun(chat.id, firstRunId))?.status === "completed",
		);
		const firstTurn = await chats.get(chat.id);

		const startedBeforeSecond = models.started;
		const second = await runs.stream(
			chat.id,
			streamRequest(...firstTurn.messages, user("regen-second")),
		);
		const secondRunId = requireRunId(await second.resolve());
		await waitFor(() => models.started > startedBeforeSecond);
		models.releaseAll();
		await waitFor(
			async () => (await repository.getRun(chat.id, secondRunId))?.status === "completed",
		);
		const completed = await chats.get(chat.id);
		const earlierPrefix = completed.messages.slice(0, 1) as PlaygroundChatUIMessage[];
		const regenerated = await runs.stream(chat.id, regenerateRequest(...earlierPrefix));
		const regeneratedRunId = requireRunId(await regenerated.resolve());
		await expect(runs.cancel(chat.id, regeneratedRunId)).resolves.toMatchObject({
			run: { status: "cancelled" },
		});

		const retryChat = await chats.create({ provider: "google", title: "Retry" });
		const retried = await runs.stream(retryChat.id, regenerateRequest(user("retry-user")));
		const retryRunId = requireRunId(await retried.resolve());
		await expect(runs.cancel(retryChat.id, retryRunId)).resolves.toMatchObject({
			run: { status: "cancelled" },
		});
	});
});

class ControlledModels {
	#started = 0;
	readonly #behaviors: Array<"normal" | "fail" | "ignore-abort"> = [];
	readonly #releases: Array<() => void> = [];

	get started(): number {
		return this.#started;
	}

	failNext(): void {
		this.#behaviors.push("fail");
	}

	ignoreAbortNext(): void {
		this.#behaviors.push("ignore-abort");
	}

	providers() {
		return {
			openai: new MockProviderV4({
				languageModels: { "gpt-5-mini": this.#model("openai", "gpt-5-mini") },
			}),
			anthropic: new MockProviderV4({
				languageModels: {
					"claude-haiku-4-5": this.#model("anthropic", "claude-haiku-4-5"),
				},
			}),
			google: new MockProviderV4({
				languageModels: { "gemini-2.5-flash": this.#model("google", "gemini-2.5-flash") },
			}),
		};
	}

	releaseAll(): void {
		for (const release of this.#releases.splice(0)) release();
	}

	#model(provider: string, modelId: string): MockLanguageModelV4 {
		return new MockLanguageModelV4({
			provider: `test.${provider}`,
			modelId,
			doStream: async ({ abortSignal }) => {
				this.#started += 1;
				const behavior = this.#behaviors.shift() ?? "normal";
				if (behavior === "fail") throw new Error("Synthetic provider setup failure.");
				return { stream: this.#stream(abortSignal, behavior === "ignore-abort") };
			},
		});
	}

	#stream(
		abortSignal: AbortSignal | undefined,
		ignoreAbort: boolean,
	): ReadableStream<LanguageModelV4StreamPart> {
		return new ReadableStream<LanguageModelV4StreamPart>({
			start: (controller) => {
				let closed = false;
				controller.enqueue({ type: "stream-start", warnings: [] });
				controller.enqueue({ type: "text-start", id: "text-1" });
				controller.enqueue({ type: "text-delta", id: "text-1", delta: CONTENT_SENTINEL });
				const release = (): void => {
					if (closed) return;
					closed = true;
					controller.enqueue({ type: "text-end", id: "text-1" });
					controller.enqueue({
						type: "finish",
						finishReason: { unified: "stop", raw: "stop" },
						usage: {
							inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
							outputTokens: { total: 3, text: 3, reasoning: 0 },
						},
					});
					controller.close();
				};
				this.#releases.push(release);
				if (!ignoreAbort) {
					abortSignal?.addEventListener(
						"abort",
						() => {
							if (closed) return;
							closed = true;
							controller.error(abortSignal.reason);
						},
						{ once: true },
					);
				}
			},
		});
	}
}

function streamRequest(...messages: PlaygroundChatUIMessage[]) {
	return { messages, trigger: "submit-message" as const };
}

function regenerateRequest(...messages: PlaygroundChatUIMessage[]) {
	return { messages, trigger: "regenerate-message" as const };
}

function user(id: string, text = CONTENT_SENTINEL): PlaygroundChatUIMessage {
	return { id, role: "user", parts: [{ type: "text", text }] };
}

function requireRunId(response: Response): string {
	const runId = response.headers.get("x-chat-run-id");
	if (runId === null) throw new Error("Expected a run id header.");
	return runId;
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (!(await predicate())) {
		if (Date.now() >= deadline) throw new Error("Timed out waiting for chat state.");
		await new Promise<void>((resolve) => setTimeout(resolve, 10));
	}
}
