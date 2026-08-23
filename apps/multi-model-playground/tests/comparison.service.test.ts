import { HttpException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { APICallError, type FinishReason, type LanguageModelUsage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AiModelClientService } from "../src/comparison/ai-model-client.service.ts";
import { MultiModelComparisonService } from "../src/comparison/multi-model-comparison.service.ts";
import type { ProviderGeneration } from "../src/comparison/comparison.types.ts";
import type { ProviderId } from "../src/config/playground-config.service.ts";

const emptyUsage: LanguageModelUsage = {
	inputTokens: 3,
	inputTokenDetails: { noCacheTokens: 3, cacheReadTokens: undefined, cacheWriteTokens: undefined },
	outputTokens: 5,
	outputTokenDetails: { textTokens: 5, reasoningTokens: undefined },
	totalTokens: 8,
};

describe("MultiModelComparisonService", () => {
	let service: MultiModelComparisonService;
	const client = {
		describe: vi.fn((provider: ProviderId) => ({ provider, model: `${provider}-model` })),
		generate: vi.fn<(provider: ProviderId, prompt: string) => Promise<ProviderGeneration>>(),
	};

	beforeEach(async () => {
		const moduleReference = await Test.createTestingModule({
			providers: [MultiModelComparisonService, { provide: AiModelClientService, useValue: client }],
		}).compile();
		service = moduleReference.get(MultiModelComparisonService);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("runs all providers and preserves stable result ordering", async () => {
		client.generate.mockImplementation(async (provider) => generation(provider));

		const comparison = await service.compare({ prompt: "safe prompt" });

		expect(comparison.results.map((result) => result.provider)).toEqual([
			"openai",
			"anthropic",
			"google",
		]);
		expect(comparison.summary).toEqual({ requested: 3, succeeded: 3, failed: 0 });
		expect(client.generate).toHaveBeenCalledTimes(3);
	});

	it("isolates a provider failure and never serializes raw request or response details", async () => {
		const promptSentinel = "private-prompt-sentinel";
		const responseSentinel = "private-provider-response";
		client.generate.mockImplementation(async (provider) => {
			if (provider !== "anthropic") return generation(provider);
			throw new APICallError({
				message: "credential failed",
				url: "https://provider.invalid",
				requestBodyValues: { prompt: promptSentinel },
				statusCode: 401,
				responseBody: responseSentinel,
				responseHeaders: { authorization: "secret" },
				isRetryable: false,
			});
		});

		const comparison = await service.compare({ prompt: promptSentinel });
		const serialized = JSON.stringify(comparison);

		expect(comparison.summary).toEqual({ requested: 3, succeeded: 2, failed: 1 });
		expect(comparison.results[1]).toMatchObject({
			provider: "anthropic",
			status: "error",
			code: "unauthorized",
			retryable: false,
		});
		expect(serialized).not.toContain(promptSentinel);
		expect(serialized).not.toContain(responseSentinel);
		expect(serialized).not.toContain("authorization");
	});

	it("rejects overlapping comparisons before spending on another provider batch", async () => {
		let resolveFirst: (() => void) | undefined;
		const blocked = new Promise<void>((resolve) => {
			resolveFirst = resolve;
		});
		client.generate.mockImplementation(async (provider) => {
			await blocked;
			return generation(provider);
		});
		const first = service.compare({ prompt: "first" });

		const second = service.compare({ prompt: "second" });
		const secondError: unknown = await second.catch((error: unknown) => error);
		expect(secondError).toBeInstanceOf(HttpException);
		expect((secondError as HttpException).getStatus()).toBe(429);
		resolveFirst?.();
		await expect(first).resolves.toMatchObject({ summary: { succeeded: 3 } });
	});

	it("classifies provider timeouts without exposing their details", async () => {
		client.generate.mockRejectedValue(new DOMException("private timeout detail", "TimeoutError"));

		const comparison = await service.compare({ prompt: "safe prompt", providers: ["openai"] });

		expect(comparison.results).toEqual([
			expect.objectContaining({
				provider: "openai",
				status: "error",
				code: "timeout_or_cancelled",
				retryable: true,
			}),
		]);
		expect(JSON.stringify(comparison)).not.toContain("private timeout detail");
	});
});

function generation(provider: ProviderId): ProviderGeneration {
	return {
		provider,
		model: `${provider}-model`,
		text: `${provider} response`,
		finishReason: "stop" as FinishReason,
		usage: emptyUsage,
	};
}
