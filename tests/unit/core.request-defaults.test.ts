import { Test } from "@nestjs/testing";
import { generateText, uploadFile } from "ai";
import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { AI_SDK_REGISTRY, AI_SDK_RESOLVED_DEFAULTS } from "../../src/ai-sdk.tokens.ts";
import { AiSdkModule, AiSdkService } from "../../src/index.ts";

const languageUsage = {
	inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function languageModel(): MockLanguageModelV4 {
	return new MockLanguageModelV4({
		doGenerate: {
			content: [{ type: "text", text: "generated" }],
			finishReason: { unified: "stop", raw: undefined },
			usage: languageUsage,
			warnings: [],
		},
	});
}

describe("AiSdkService request defaults", () => {
	it("remains injectable without the additive request-defaults token", async () => {
		const testingModule = await Test.createTestingModule({
			providers: [
				AiSdkService,
				{ provide: AI_SDK_REGISTRY, useValue: undefined },
				{ provide: AI_SDK_RESOLVED_DEFAULTS, useValue: {} },
			],
		}).compile();

		expect(testingModule.get(AiSdkService).generateText).toBe(generateText);
		await testingModule.close();
	});

	it("applies retry and rich timeout defaults while preserving call-site overrides", async () => {
		const testingModule = await Test.createTestingModule({
			imports: [
				AiSdkModule.forRoot({
					requestDefaults: {
						maxRetries: 4,
						timeout: {
							totalMs: 5_000,
							stepMs: 2_000,
							firstChunkMs: 1_500,
							chunkMs: 1_000,
						},
					},
				}),
			],
		}).compile();
		const service = testingModule.get(AiSdkService);
		let configured:
			{ maxRetries: number; timeout: number | Record<string, unknown> | undefined } | undefined;
		let overridden:
			{ maxRetries: number; timeout: number | Record<string, unknown> | undefined } | undefined;

		await service.generateText({
			model: languageModel(),
			prompt: "hello",
			onStart: ({ maxRetries, timeout }) => {
				configured = { maxRetries, timeout };
			},
		});
		await service.generateText({
			model: languageModel(),
			prompt: "hello",
			maxRetries: 0,
			timeout: 250,
			onStart: ({ maxRetries, timeout }) => {
				overridden = { maxRetries, timeout };
			},
		});

		expect(configured).toEqual({
			maxRetries: 4,
			timeout: { totalMs: 5_000, stepMs: 2_000 },
		});
		expect(overridden).toEqual({ maxRetries: 0, timeout: 250 });
		expect(service.generateText).not.toBe(generateText);
		// AI SDK 7 does not expose request controls on upload operations.
		expect(service.uploadFile).toBe(uploadFile);
		await testingModule.close();
	});

	it("converts a total timeout into a signal and composes a caller signal", async () => {
		let providerSignal: AbortSignal | undefined;
		let observedMaxRetries: number | undefined;
		const model = new MockEmbeddingModelV4({
			doEmbed: async ({ values, abortSignal }) => {
				providerSignal = abortSignal;
				return {
					embeddings: values.map(() => [1, 2, 3]),
					usage: { tokens: values.length },
					warnings: [],
				};
			},
		});
		const testingModule = await Test.createTestingModule({
			imports: [
				AiSdkModule.forRoot({
					requestDefaults: { maxRetries: 1, timeout: { totalMs: 5_000 } },
				}),
			],
		}).compile();
		const caller = new AbortController();

		await testingModule.get(AiSdkService).embed({
			model,
			value: "hello",
			abortSignal: caller.signal,
			onStart: ({ maxRetries }) => {
				observedMaxRetries = maxRetries;
			},
		});

		expect(observedMaxRetries).toBe(1);
		expect(providerSignal).toBeDefined();
		expect(providerSignal).not.toBe(caller.signal);
		const reason = new Error("caller cancelled");
		caller.abort(reason);
		expect(providerSignal?.aborted).toBe(true);
		expect(providerSignal?.reason).toBe(reason);
		await testingModule.close();
	});

	it("aborts signal-based operations when the default total deadline expires", async () => {
		let providerSignal: AbortSignal | undefined;
		let providerAbortReason: unknown;
		const model = new MockEmbeddingModelV4({
			doEmbed: ({ abortSignal }) => {
				providerSignal = abortSignal;
				return new Promise((_resolve, reject) => {
					if (abortSignal === undefined) {
						reject(new Error("Expected a request deadline signal."));
						return;
					}
					const rejectWithAbort = () => {
						providerAbortReason = abortSignal.reason;
						reject(abortSignal.reason);
					};
					if (abortSignal.aborted) {
						rejectWithAbort();
						return;
					}
					abortSignal.addEventListener("abort", rejectWithAbort, { once: true });
				});
			},
		});
		const testingModule = await Test.createTestingModule({
			imports: [
				AiSdkModule.forRoot({
					requestDefaults: { maxRetries: 0, timeout: 25 },
				}),
			],
		}).compile();

		await expect(
			testingModule.get(AiSdkService).embed({ model, value: "deadline" }),
		).rejects.toBeDefined();

		expect(providerSignal?.aborted).toBe(true);
		expect(providerAbortReason).toMatchObject({ name: "TimeoutError" });
		await testingModule.close();
	});

	it.each([
		{ requestDefaults: { maxRetries: -1 } },
		{ requestDefaults: { maxRetries: 1.5 } },
		{ requestDefaults: { timeout: 0 } },
		{ requestDefaults: { timeout: 1.5 } },
		{ requestDefaults: { timeout: 2_147_483_648 } },
		{ requestDefaults: { timeout: { chunkMs: Number.POSITIVE_INFINITY } } },
	])("fails fast for invalid request defaults %#", async (options) => {
		await expect(
			Test.createTestingModule({
				imports: [AiSdkModule.forRoot(options)],
			}).compile(),
		).rejects.toMatchObject({ code: "INVALID_OPTIONS", name: "AiSdkConfigurationError" });
	});

	it.each([
		{
			label: "a non-object request-default value",
			options: (() => {
				const options = {};
				Reflect.set(options, "requestDefaults", null);
				return options;
			})(),
		},
		{
			label: "an unknown request-default key",
			options: (() => {
				const options = { requestDefaults: { maxRetries: 0 } };
				Reflect.set(options.requestDefaults, "retryCount", 2);
				return options;
			})(),
		},
		{
			label: "an unknown structured-timeout key",
			options: (() => {
				const options = { requestDefaults: { timeout: { totalMs: 100 } } };
				Reflect.set(options.requestDefaults.timeout, "totlMs", 100);
				return options;
			})(),
		},
		{
			label: "a malformed per-tool timeout key",
			options: (() => {
				const options = {
					requestDefaults: { timeout: { tools: { workspaceWriteMs: 100 } } },
				};
				Reflect.set(options.requestDefaults.timeout.tools, "workspaceWrite", 100);
				return options;
			})(),
		},
	])("rejects $label", async ({ options }) => {
		await expect(
			Test.createTestingModule({
				imports: [AiSdkModule.forRoot(options)],
			}).compile(),
		).rejects.toMatchObject({ code: "INVALID_OPTIONS", name: "AiSdkConfigurationError" });
	});
});
