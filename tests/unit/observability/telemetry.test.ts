import { Injectable, Module, type OnApplicationBootstrap, type OnModuleInit } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { APICallError, embed, embedMany, generateText, Output, rerank, type Telemetry } from "ai";
import { MockEmbeddingModelV4, MockLanguageModelV4, MockRerankingModelV4 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";
import {
	AiSdkObservabilityModule,
	AiSdkObservabilityService,
	AiSdkObservabilityTelemetryModule,
	AiSdkObservabilityTelemetryService,
	AiSdkTelemetryAdapter,
	AiSdkTelemetryHub,
	composeAiSdkTelemetryOptions,
	getAiSdkTelemetryHub,
	InMemoryAiObservabilityCollector,
	initializeAiSdkTelemetry,
	registerAiSdkTelemetryHub,
	type AiObservabilityEvent,
} from "../../../src/observability/index.ts";

const SECRET = "secret-prompt-output-tool-error-value";
const FAILED_BOOTSTRAP = Symbol("FAILED_BOOTSTRAP");
const languageUsage = {
	inputTokens: { total: 7, noCache: 5, cacheRead: 2, cacheWrite: 1 },
	outputTokens: { total: 3, text: 2, reasoning: 1 },
};

class RecordingSink {
	readonly events: AiObservabilityEvent[] = [];

	record(events: readonly AiObservabilityEvent[]): void {
		this.events.push(...events);
	}
}

function successfulModel(text = SECRET): MockLanguageModelV4 {
	return new MockLanguageModelV4({
		modelId: "test-model",
		doGenerate: async () => ({
			content: [
				{
					type: "reasoning",
					text: SECRET,
					providerMetadata: { fixture: { secret: SECRET } },
				},
				{
					type: "text",
					text,
					providerMetadata: { fixture: { secret: SECRET } },
				},
			],
			finishReason: { unified: "stop", raw: "stop" },
			usage: { ...languageUsage, raw: { secret: SECRET } },
			warnings: [],
			providerMetadata: { fixture: { secret: SECRET } },
			request: { body: { secret: SECRET } },
			response: {
				id: "provider-response",
				timestamp: new Date("2026-08-23T00:00:00.000Z"),
				modelId: "test-model-response",
				headers: { "x-secret": SECRET },
				body: { secret: SECRET },
			},
		}),
	});
}

@Injectable()
class InitHookAiCaller implements OnModuleInit, OnApplicationBootstrap {
	async onModuleInit(): Promise<void> {
		await generateText({ model: successfulModel("module init"), prompt: "safe" });
	}

	async onApplicationBootstrap(): Promise<void> {
		await generateText({ model: successfulModel("application bootstrap"), prompt: "safe" });
	}
}

@Module({ providers: [InitHookAiCaller] })
class EarlyCallerModule {}

@Injectable()
class FailingInitHook implements OnModuleInit {
	onModuleInit(): void {
		throw new Error("late init failed");
	}
}

@Module({ providers: [FailingInitHook] })
class FailingInitModule {}

@Injectable()
class FailingBootstrapHook implements OnApplicationBootstrap {
	onApplicationBootstrap(): void {
		throw new Error("late bootstrap failed");
	}
}

@Module({ providers: [FailingBootstrapHook] })
class FailingBootstrapModule {}

describe("AI SDK telemetry adapter", () => {
	const modules: TestingModule[] = [];

	afterEach(async () => {
		await Promise.all(modules.splice(0).map((moduleReference) => moduleReference.close()));
	});

	it("maps a real generateText lifecycle without retaining content", async () => {
		const sink = new RecordingSink();
		let timestamp = 1_777_000_000_000;
		const adapter = new AiSdkTelemetryAdapter({
			sink,
			clock: () => timestamp++,
			generateEventId: (() => {
				let sequence = 0;
				return () => `event:${++sequence}`;
			})(),
		});

		const result = await generateText({
			model: successfulModel(),
			prompt: SECRET,
			headers: { authorization: SECRET },
			providerOptions: { fixture: { secret: SECRET } },
			telemetry: {
				integrations: adapter,
				functionId: "support-chat",
				recordInputs: true,
				recordOutputs: true,
			},
		});

		expect(result.text).toBe(SECRET);
		expect(sink.events.map((event) => event.type)).toEqual([
			"operation.started",
			"step.started",
			"model.started",
			"model.completed",
			"step.completed",
			"operation.completed",
		]);
		expect(sink.events[0]).toMatchObject({
			type: "operation.started",
			operation: "generate-text",
			functionId: "support-chat",
			streaming: false,
		});
		expect(sink.events.find((event) => event.type === "model.completed")).toMatchObject({
			outcome: "success",
			usage: {
				inputTokens: 7,
				cacheReadInputTokens: 2,
				outputTokens: 3,
				reasoningOutputTokens: 1,
				totalTokens: 10,
			},
		});
		expect(JSON.stringify(sink.events)).not.toContain(SECRET);
		expect(adapter.activeOperationCount).toBe(0);
	});

	it("maps unsafe dimensions to explicit fallbacks without partial sanitization", async () => {
		const sink = new RecordingSink();
		const unsafeProvider = `customer ${SECRET} α`;
		const unsafeModel = `customer ${SECRET} β`;
		const adapter = new AiSdkTelemetryAdapter({ sink, source: unsafeProvider });
		const model = new MockLanguageModelV4({
			provider: unsafeProvider,
			modelId: unsafeModel,
			doGenerate: async () => ({
				content: [{ type: "text", text: "safe" }],
				finishReason: { unified: "stop", raw: "stop" },
				usage: languageUsage,
				warnings: [],
			}),
		});

		await generateText({
			model,
			prompt: "safe",
			telemetry: {
				integrations: adapter,
				functionId: unsafeModel,
			},
		});

		expect(sink.events[0]).toMatchObject({
			type: "operation.started",
			source: "ai-sdk",
			functionId: "unknown",
			provider: "unknown",
			model: "unknown",
		});
		expect(sink.events.find((event) => event.type === "model.started")).toMatchObject({
			provider: "unknown",
			model: "unknown",
		});
		expect(JSON.stringify(sink.events)).not.toContain("customer");
		expect(JSON.stringify(sink.events)).not.toContain(SECRET);
	});

	it("records real model failure, structurally guards unknown errors, and isolates sink failure", async () => {
		const sink = new RecordingSink();
		const adapter = new AiSdkTelemetryAdapter({ sink });
		const failingModel = new MockLanguageModelV4({
			doGenerate: async () => {
				throw new Error(SECRET);
			},
		});

		await expect(
			generateText({
				model: failingModel,
				prompt: SECRET,
				maxRetries: 0,
				telemetry: { integrations: adapter },
			}),
		).rejects.toThrow(SECRET);

		const terminal = sink.events.findLast((event) => event.type === "operation.completed");
		expect(terminal).toMatchObject({ type: "operation.completed", outcome: "error" });
		expect(JSON.stringify(sink.events)).not.toContain(SECRET);
		expect(adapter.activeOperationCount).toBe(0);
		const eventCount = sink.events.length;
		await adapter.onError(SECRET);
		expect(sink.events).toHaveLength(eventCount);

		const isolated = new AiSdkTelemetryAdapter({
			sink: {
				record() {
					throw new Error("sink unavailable");
				},
			},
		});
		const result = await generateText({
			model: successfulModel("still succeeds"),
			prompt: "safe",
			telemetry: { integrations: isolated },
		});
		expect(result.text).toBe("still succeeds");
	});

	it("corrects a completed operation when asynchronous structured-output parsing fails", async () => {
		const sink = new RecordingSink();
		const adapter = new AiSdkTelemetryAdapter({ sink });
		const slowFailingOutput = {
			name: "slow-fail",
			responseFormat: Promise.resolve({ type: "text" as const }),
			async parseCompleteOutput(): Promise<never> {
				await new Promise<void>((resolve) => setTimeout(resolve, 20));
				throw new Error("slow parse failed");
			},
			async parsePartialOutput(): Promise<undefined> {
				return undefined;
			},
			createElementStreamTransform(): undefined {
				return undefined;
			},
		} satisfies Output.Output<never, never, never>;

		await expect(
			generateText({
				model: successfulModel("valid provider output"),
				prompt: "safe",
				output: slowFailingOutput,
				telemetry: { integrations: adapter },
			}),
		).rejects.toThrow("slow parse failed");

		const terminals = sink.events.filter((event) => event.type === "operation.completed");
		expect(terminals).toHaveLength(1);
		expect(terminals[0]).toMatchObject({ outcome: "success" });
		expect(sink.events.filter((event) => event.type === "operation.outcome-corrected")).toEqual([
			expect.objectContaining({ outcome: "error" }),
		]);
		expect(JSON.stringify(sink.events)).not.toContain(SECRET);
		expect(adapter.activeOperationCount).toBe(0);
	});

	it("keeps a successful structured-output operation successful", async () => {
		const sink = new RecordingSink();
		const adapter = new AiSdkTelemetryAdapter({ sink });

		const result = await generateText({
			model: successfulModel('{"answer":42}'),
			prompt: "safe",
			output: Output.json(),
			telemetry: { integrations: adapter },
		});
		expect(result.output).toEqual({ answer: 42 });

		expect(sink.events.filter((event) => event.type === "operation.completed")).toEqual([
			expect.objectContaining({ outcome: "success" }),
		]);
		expect(sink.events.some((event) => event.type === "operation.outcome-corrected")).toBe(false);
		expect(adapter.activeOperationCount).toBe(0);
	});

	it("maps embedding, reranking, and tool errors without values or results", async () => {
		const sink = new RecordingSink();
		let timestamp = 1_777_000_000_000;
		const adapter = new AiSdkTelemetryAdapter({
			sink,
			clock: () => timestamp++,
			errorClassifier: (error) =>
				error instanceof Error && error.name === "AbortError" ? "aborted" : "error",
		});
		const embeddingModel = new MockEmbeddingModelV4({
			modelId: "embedding-model",
			doEmbed: async ({ values }) => ({
				embeddings: values.map(() => [0.1, 0.2, 0.3]),
				usage: { tokens: values.length * 2 },
				warnings: [],
			}),
		});
		const rerankingModel = new MockRerankingModelV4({
			modelId: "rerank-model",
			doRerank: async () => ({
				ranking: [{ index: 0, relevanceScore: 0.9 }],
				warnings: [],
			}),
		});

		await embed({
			model: embeddingModel,
			value: SECRET,
			telemetry: { integrations: adapter },
		});
		await rerank({
			model: rerankingModel,
			query: SECRET,
			documents: [SECRET],
			telemetry: { integrations: adapter },
		});
		await adapter.onToolExecutionStart({
			callId: "manual-call",
			messages: [{ role: "user", content: SECRET }],
			toolCall: {
				type: "tool-call",
				toolCallId: "tool-call-1",
				toolName: "lookup",
				input: SECRET,
				dynamic: true,
			},
			toolContext: { userId: SECRET, tenantId: SECRET },
		});
		await adapter.onToolExecutionEnd({
			callId: "manual-call",
			messages: [{ role: "user", content: SECRET }],
			toolCall: {
				type: "tool-call",
				toolCallId: "tool-call-1",
				toolName: "lookup",
				input: SECRET,
				dynamic: true,
			},
			toolContext: { userId: SECRET, tenantId: SECRET },
			toolExecutionMs: 5,
			toolOutput: {
				type: "tool-error",
				toolCallId: "tool-call-1",
				toolName: "lookup",
				input: SECRET,
				error: new Error(SECRET),
				dynamic: true,
			},
		});

		expect(sink.events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "embedding.started", batchSize: 1 }),
				expect.objectContaining({
					type: "embedding.completed",
					usage: { embeddingTokens: 2 },
				}),
				expect.objectContaining({ type: "reranking.started", documentCount: 1 }),
				expect.objectContaining({ type: "reranking.completed", resultCount: 1 }),
				expect.objectContaining({ type: "tool.started", toolName: "lookup" }),
				expect.objectContaining({ type: "tool.completed", outcome: "error" }),
			]),
		);
		expect(JSON.stringify(sink.events)).not.toContain(SECRET);
	});

	it("correlates a successful rerank retry to the latest provider attempt", async () => {
		const sink = new RecordingSink();
		const adapter = new AiSdkTelemetryAdapter({ sink });
		let attempts = 0;
		const model = new MockRerankingModelV4({
			modelId: "retry-rerank-model",
			doRerank: async () => {
				attempts++;
				if (attempts === 1) {
					throw new APICallError({
						message: SECRET,
						url: "https://provider.invalid/rerank",
						requestBodyValues: { secret: SECRET },
						statusCode: 429,
						responseHeaders: { "retry-after-ms": "0" },
						responseBody: SECRET,
						isRetryable: true,
					});
				}

				return {
					ranking: [{ index: 0, relevanceScore: 0.95 }],
					warnings: [],
				};
			},
		});

		await rerank({
			model,
			query: SECRET,
			documents: [SECRET],
			maxRetries: 1,
			telemetry: { integrations: adapter },
		});

		const rerankingEvents = sink.events.filter((event) => event.type.startsWith("reranking."));
		expect(attempts).toBe(2);
		expect(rerankingEvents.map((event) => event.type)).toEqual([
			"reranking.started",
			"reranking.completed",
			"reranking.started",
			"reranking.completed",
		]);
		expect(rerankingEvents[1]).toMatchObject({
			entityId: rerankingEvents[0]?.entityId,
			outcome: "error",
		});
		expect(rerankingEvents[3]).toMatchObject({
			entityId: rerankingEvents[2]?.entityId,
			outcome: "success",
			resultCount: 1,
		});
		expect(rerankingEvents[0]?.entityId).not.toBe(rerankingEvents[2]?.entityId);
		expect(JSON.stringify(sink.events)).not.toContain(SECRET);
		expect(adapter.activeOperationCount).toBe(0);
	});

	it("classifies a superseded embedding attempt as an error after a successful retry", async () => {
		const sink = new RecordingSink();
		const collector = new InMemoryAiObservabilityCollector();
		const adapter = new AiSdkTelemetryAdapter({
			sink: {
				record(events) {
					sink.record(events);
					collector.record(events);
				},
			},
		});
		let attempts = 0;
		const model = new MockEmbeddingModelV4({
			modelId: "retry-embedding-model",
			doEmbed: async ({ values }) => {
				attempts++;
				if (attempts === 1) throw retryableApiError();
				return {
					embeddings: values.map(() => [0.1, 0.2]),
					usage: { tokens: values.length * 2 },
					warnings: [],
				};
			},
		});

		await embed({
			model,
			value: SECRET,
			maxRetries: 1,
			telemetry: { integrations: adapter },
		});

		const embeddingEvents = sink.events.filter((event) => event.type.startsWith("embedding."));
		expect(attempts).toBe(2);
		expect(embeddingEvents.map((event) => event.type)).toEqual([
			"embedding.started",
			"embedding.started",
			"embedding.completed",
			"embedding.completed",
		]);
		expect(embeddingEvents.filter((event) => event.type === "embedding.completed")).toEqual([
			expect.objectContaining({ outcome: "success" }),
			expect.objectContaining({ outcome: "error" }),
		]);
		expect(collector.snapshot().totals.embeddingCalls).toMatchObject({
			started: 2,
			active: 0,
			outcomes: { success: 1, error: 1 },
			abandoned: { parent: 0 },
		});
		expect(JSON.stringify(sink.events)).not.toContain(SECRET);
	});

	it("preserves parallel embedMany retry attempts without content correlation", async () => {
		const sink = new RecordingSink();
		const collector = new InMemoryAiObservabilityCollector();
		const adapter = new AiSdkTelemetryAdapter({
			sink: {
				record(events) {
					sink.record(events);
					collector.record(events);
				},
			},
		});
		const attempts = new Map<string, number>();
		const retryValue = `${SECRET}:retry`;
		const model = new MockEmbeddingModelV4({
			modelId: "parallel-retry-embedding-model",
			maxEmbeddingsPerCall: 1,
			supportsParallelCalls: true,
			doEmbed: async ({ values }) => {
				const value = values[0] ?? "missing";
				const attempt = (attempts.get(value) ?? 0) + 1;
				attempts.set(value, attempt);
				if (value === retryValue && attempt === 1) throw retryableApiError();
				return {
					embeddings: values.map(() => [0.3, 0.4]),
					usage: { tokens: values.length },
					warnings: [],
				};
			},
		});

		await embedMany({
			model,
			values: [retryValue, `${SECRET}:parallel`],
			maxRetries: 1,
			telemetry: { integrations: adapter },
		});

		const starts = sink.events.filter((event) => event.type === "embedding.started");
		const terminals = sink.events.filter((event) => event.type === "embedding.completed");
		expect(starts).toHaveLength(3);
		expect(terminals.filter((event) => event.outcome === "success")).toHaveLength(2);
		expect(terminals.filter((event) => event.outcome === "error")).toHaveLength(1);
		expect(collector.snapshot().totals.embeddingCalls).toMatchObject({
			started: 3,
			active: 0,
			outcomes: { success: 2, error: 1 },
			abandoned: { parent: 0 },
		});
		expect(JSON.stringify(sink.events)).not.toContain(SECRET);
	});

	it("composes local integrations immutably and registers one process-global hub", () => {
		const hub = getAiSdkTelemetryHub();
		const local: Telemetry = {};
		const configured = [local];
		const options = {
			functionId: "chat",
			integrations: configured,
		};

		const composed = composeAiSdkTelemetryOptions(options, local);

		expect(composed).not.toBe(options);
		expect(composed.integrations).toEqual([hub, local]);
		expect(configured).toEqual([local]);
		expect(options.integrations).toBe(configured);

		const before =
			globalThis.AI_SDK_TELEMETRY_INTEGRATIONS?.filter((integration) => integration === hub)
				.length ?? 0;
		registerAiSdkTelemetryHub();
		registerAiSdkTelemetryHub();
		const after =
			globalThis.AI_SDK_TELEMETRY_INTEGRATIONS?.filter((integration) => integration === hub)
				.length ?? 0;
		expect(after).toBe(before === 0 ? 1 : before);
	});

	it("skips delegates without wrappers and isolates wrapper failures", async () => {
		const hub = new AiSdkTelemetryHub();
		let wrapperCalled = false;
		let executionCount = 0;
		const detachPassive = hub.attach({});
		const detachWrapper = hub.attach({
			async executeTool({ execute }) {
				wrapperCalled = true;
				await execute();
				throw new Error("observer wrapper failed");
			},
		});

		const result = await hub.executeTool({
			callId: "call",
			toolCallId: "tool-call",
			execute: async () => {
				executionCount++;
				return 42;
			},
		});

		expect(result).toBe(42);
		expect(wrapperCalled).toBe(true);
		expect(executionCount).toBe(1);
		detachPassive();
		detachWrapper();
		expect(hub.attachmentCount).toBe(0);
	});

	it("registers and detaches the Nest bridge with application lifecycle", async () => {
		let timestamp = Date.now();
		const hub = getAiSdkTelemetryHub();
		const attachmentsBefore = hub.attachmentCount;
		const moduleReference = await Test.createTestingModule({
			imports: [
				AiSdkObservabilityTelemetryModule.register({
					imports: [
						AiSdkObservabilityModule.forRoot({
							clock: () => timestamp,
							isGlobal: false,
						}),
					],
					registration: "global",
					clock: () => timestamp++,
				}),
			],
		}).compile();
		modules.push(moduleReference);
		await initializeAiSdkTelemetry(moduleReference);

		expect(hub.attachmentCount).toBe(attachmentsBefore + 1);
		expect(moduleReference.get(AiSdkObservabilityTelemetryService).registrationState).toBe(
			"active",
		);
		expect(() =>
			moduleReference.get(AiSdkObservabilityTelemetryService).activateGlobalRegistration(),
		).not.toThrow();
		const result = await generateText({ model: successfulModel("nest bridge"), prompt: "hi" });
		expect(result.text).toBe("nest bridge");
		expect(
			moduleReference.get(AiSdkObservabilityService).snapshot().totals.operations,
		).toMatchObject({
			started: 1,
			active: 0,
			outcomes: { success: 1, error: 0, aborted: 0 },
		});

		await moduleReference.close();
		modules.splice(modules.indexOf(moduleReference), 1);
		expect(hub.attachmentCount).toBe(attachmentsBefore);
	});

	it("observes module and application bootstrap hooks before committing ownership", async () => {
		const moduleReference = await Test.createTestingModule({
			imports: [
				EarlyCallerModule,
				AiSdkObservabilityTelemetryModule.register({
					imports: [AiSdkObservabilityModule.forRoot({ isGlobal: false })],
					registration: "global",
				}),
			],
		}).compile();
		modules.push(moduleReference);
		await initializeAiSdkTelemetry(moduleReference);

		expect(
			moduleReference.get(AiSdkObservabilityService).snapshot().totals.operations,
		).toMatchObject({
			started: 2,
			active: 0,
			outcomes: { success: 2 },
		});
	});

	it("fails fast instead of broadcasting process telemetry across Nest contexts", async () => {
		const first = await Test.createTestingModule({
			imports: [
				AiSdkObservabilityTelemetryModule.register({
					imports: [AiSdkObservabilityModule.forRoot({ isGlobal: false })],
					registration: "global",
				}),
			],
		}).compile();
		modules.push(first);
		await initializeAiSdkTelemetry(first);

		let initializationError: unknown;
		try {
			await Test.createTestingModule({
				imports: [
					AiSdkObservabilityTelemetryModule.register({
						imports: [AiSdkObservabilityModule.forRoot({ isGlobal: false })],
						registration: "global",
					}),
				],
			}).compile();
		} catch (error) {
			initializationError = error;
		}
		if (!(initializationError instanceof Error)) {
			throw new TypeError("Expected the second context to fail with an Error.");
		}
		expect(initializationError.message).toMatch(/process-global.*already attached/i);
	});

	it("supersedes a provisional collector left by a failed Nest bootstrap", async () => {
		const hub = getAiSdkTelemetryHub();
		const attachmentsBefore = hub.attachmentCount;
		let bootstrapError: unknown;
		try {
			await Test.createTestingModule({
				imports: [
					AiSdkObservabilityTelemetryModule.register({
						imports: [AiSdkObservabilityModule.forRoot({ isGlobal: false })],
						registration: "global",
					}),
				],
				providers: [
					{
						provide: FAILED_BOOTSTRAP,
						inject: [AiSdkObservabilityTelemetryService],
						useFactory: () => {
							throw new Error("bootstrap failed");
						},
					},
				],
			}).compile();
		} catch (error) {
			bootstrapError = error;
		}
		expect(bootstrapError).toBeInstanceOf(Error);
		expect(hub.hasProcessCollector).toBe(true);
		expect(hub.hasActiveProcessCollector).toBe(false);

		const replacement = await Test.createTestingModule({
			imports: [
				AiSdkObservabilityTelemetryModule.register({
					imports: [AiSdkObservabilityModule.forRoot({ isGlobal: false })],
					registration: "global",
				}),
			],
		}).compile();
		modules.push(replacement);
		await initializeAiSdkTelemetry(replacement);
		expect(hub.attachmentCount).toBe(attachmentsBefore + 1);
		expect(hub.hasActiveProcessCollector).toBe(true);

		await generateText({ model: successfulModel("recovered"), prompt: "safe" });
		expect(replacement.get(AiSdkObservabilityService).snapshot().totals.operations.started).toBe(1);
	});

	it("keeps a failed lifecycle bootstrap replaceable until explicit activation", async () => {
		const hub = getAiSdkTelemetryHub();
		const failed = await Test.createTestingModule({
			imports: [
				AiSdkObservabilityTelemetryModule.register({
					imports: [AiSdkObservabilityModule.forRoot({ isGlobal: false })],
					registration: "global",
				}),
				FailingInitModule,
			],
		}).compile();

		await expect(failed.init()).rejects.toThrow("late init failed");
		expect(hub.hasProcessCollector).toBe(true);
		expect(hub.hasActiveProcessCollector).toBe(false);

		const replacement = await Test.createTestingModule({
			imports: [
				AiSdkObservabilityTelemetryModule.register({
					imports: [AiSdkObservabilityModule.forRoot({ isGlobal: false })],
					registration: "global",
				}),
			],
		}).compile();
		modules.push(replacement);
		await initializeAiSdkTelemetry(replacement);

		expect(hub.hasActiveProcessCollector).toBe(true);
		expect(() =>
			failed.get(AiSdkObservabilityTelemetryService).activateGlobalRegistration(),
		).toThrow(/superseded/i);
		failed.get(AiSdkObservabilityTelemetryService).dispose();
		expect(hub.hasActiveProcessCollector).toBe(true);
	});

	it("rolls back a provisional lease when the initialization helper fails", async () => {
		const hub = getAiSdkTelemetryHub();
		const attachmentsBefore = hub.attachmentCount;
		const failed = await Test.createTestingModule({
			imports: [
				AiSdkObservabilityTelemetryModule.register({
					imports: [AiSdkObservabilityModule.forRoot({ isGlobal: false })],
					registration: "global",
				}),
				FailingBootstrapModule,
			],
		}).compile();

		await expect(initializeAiSdkTelemetry(failed)).rejects.toThrow("late bootstrap failed");
		expect(hub.attachmentCount).toBe(attachmentsBefore);
		expect(failed.get(AiSdkObservabilityTelemetryService).registrationState).toBe("disposed");
	});

	it("defaults to an isolated per-call adapter without a global attachment", async () => {
		const hub = getAiSdkTelemetryHub();
		const attachmentsBefore = hub.attachmentCount;
		const moduleReference = await Test.createTestingModule({
			imports: [
				AiSdkObservabilityTelemetryModule.register({
					imports: [AiSdkObservabilityModule.forRoot({ isGlobal: false })],
				}),
			],
		}).compile();
		modules.push(moduleReference);
		await moduleReference.init();

		const bridge = moduleReference.get(AiSdkObservabilityTelemetryService);
		expect(hub.attachmentCount).toBe(attachmentsBefore);
		expect(bridge.registrationState).toBe("manual");
		await generateText({
			model: successfulModel("isolated"),
			prompt: "safe",
			telemetry: { integrations: bridge.adapter },
		});

		expect(
			moduleReference.get(AiSdkObservabilityService).snapshot().totals.operations,
		).toMatchObject({
			started: 1,
			active: 0,
			outcomes: { success: 1, error: 0, aborted: 0 },
		});
	});
});

function retryableApiError(): APICallError {
	return new APICallError({
		message: SECRET,
		url: "https://provider.invalid/embedding",
		requestBodyValues: { secret: SECRET },
		statusCode: 429,
		responseHeaders: { "retry-after-ms": "0" },
		responseBody: SECRET,
		isRetryable: true,
	});
}
