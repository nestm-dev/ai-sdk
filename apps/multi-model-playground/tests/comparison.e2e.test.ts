import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AiModelClientService } from "../src/comparison/ai-model-client.service.ts";
import { ComparisonController } from "../src/comparison/comparison.controller.ts";
import { MultiModelComparisonService } from "../src/comparison/multi-model-comparison.service.ts";
import type { ProviderGeneration } from "../src/comparison/comparison.types.ts";
import type { ProviderId } from "../src/config/playground-config.service.ts";
import { SafeExceptionFilter } from "../src/http/safe-exception.filter.ts";

describe("comparison HTTP flow", () => {
	let app: INestApplication;
	let server: FastifyInstance;
	const client = {
		describe: (provider: ProviderId) => ({ provider, model: `${provider}-model` }),
		generate: vi.fn<(provider: ProviderId, prompt: string) => Promise<ProviderGeneration>>(
			async (provider) => ({
				provider,
				model: `${provider}-model`,
				text: `${provider} result`,
				finishReason: "stop",
				usage: {
					inputTokens: 2,
					inputTokenDetails: {
						noCacheTokens: 2,
						cacheReadTokens: undefined,
						cacheWriteTokens: undefined,
					},
					outputTokens: 3,
					outputTokenDetails: { textTokens: 3, reasoningTokens: undefined },
					totalTokens: 5,
				},
			}),
		),
	};

	beforeAll(async () => {
		const moduleReference = await Test.createTestingModule({
			controllers: [ComparisonController],
			providers: [MultiModelComparisonService, { provide: AiModelClientService, useValue: client }],
		}).compile();
		app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
		app.useGlobalFilters(new SafeExceptionFilter());
		app.useGlobalPipes(
			new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
		);
		await app.init();
		server = app.getHttpAdapter().getInstance() as unknown as FastifyInstance;
	});

	afterAll(async () => {
		await app.close();
	});

	it("returns a bounded no-store comparison response", async () => {
		const response = await server.inject({
			method: "POST",
			url: "/playground/v1/compare",
			payload: { prompt: "compare safely", providers: ["openai", "google"] },
		});

		expect(response.statusCode).toBe(200);
		expect(response.headers["cache-control"]).toBe("no-store");
		expect(response.json()).toMatchObject({
			summary: { requested: 2, succeeded: 2, failed: 0 },
			results: [{ provider: "openai" }, { provider: "google" }],
		});
	});

	it("rejects unknown fields without echoing prompt content", async () => {
		const prompt = "private prompt must not be echoed";
		const response = await server.inject({
			method: "POST",
			url: "/playground/v1/compare",
			payload: { prompt, extra: "not-allowed" },
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({
			code: "REQUEST_INVALID",
			message: "The comparison request is invalid.",
		});
		expect(response.body).not.toContain(prompt);
	});

	it("rejects whitespace-only prompts before invoking a provider", async () => {
		client.generate.mockClear();
		const response = await server.inject({
			method: "POST",
			url: "/playground/v1/compare",
			payload: { prompt: "   " },
		});

		expect(response.statusCode).toBe(400);
		expect(client.generate).not.toHaveBeenCalled();
	});
});
