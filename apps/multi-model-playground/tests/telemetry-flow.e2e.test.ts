import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AiSdkModule, AiSdkService } from "@nestm/ai-sdk";
import {
	AiSdkObservabilityModule,
	AiSdkObservabilityTelemetryModule,
	initializeAiSdkTelemetry,
} from "@nestm/ai-sdk/observability";
import { AiSdkObservabilityHttpModule } from "@nestm/ai-sdk/observability/http";
import type { FastifyInstance } from "fastify";
import { MockLanguageModelV4, MockProviderV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ComparisonModule } from "../src/comparison/comparison.module.ts";
import { SafeExceptionFilter } from "../src/http/safe-exception.filter.ts";

const CONTENT_SENTINEL = "private-prompt-and-output-sentinel";
const providerIds = ["openai", "anthropic", "google"] as const;

describe("playground telemetry flow", () => {
	let app: INestApplication;
	let server: FastifyInstance;
	let aiSdk: AiSdkService;

	beforeAll(async () => {
		for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]) {
			vi.stubEnv(key, `test-only-${key.toLowerCase()}-credential`);
		}
		const { PlaygroundConfigModule } = await import("../src/config/playground-config.module.ts");

		const moduleReference = await Test.createTestingModule({
			imports: [
				PlaygroundConfigModule,
				AiSdkModule.forRoot({ providers: mockProviders() }),
				AiSdkObservabilityModule.forRoot(),
				AiSdkObservabilityTelemetryModule.register({ registration: "global" }),
				AiSdkObservabilityHttpModule,
				ComparisonModule,
			],
		}).compile();
		app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
		aiSdk = moduleReference.get(AiSdkService);
		vi.spyOn(aiSdk, "generateText");
		app.useGlobalFilters(new SafeExceptionFilter());
		app.useGlobalPipes(
			new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
		);
		await initializeAiSdkTelemetry(app);
		server = app.getHttpAdapter().getInstance() as unknown as FastifyInstance;
	});

	afterAll(async () => {
		if (app) await app.close();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it("projects three real AI SDK lifecycles without retaining content", async () => {
		const comparison = await server.inject({
			method: "POST",
			url: "/playground/v1/compare",
			payload: { prompt: CONTENT_SENTINEL },
		});
		expect(comparison.statusCode).toBe(200);
		expect(comparison.json()).toMatchObject({
			summary: { requested: 3, succeeded: 3, failed: 0 },
		});
		expect(aiSdk.generateText).toHaveBeenCalledTimes(3);

		const snapshotResponse = await server.inject({
			method: "GET",
			url: "/ai-observability/v1/snapshot",
		});
		const snapshot = snapshotResponse.json();

		expect(snapshotResponse.statusCode).toBe(200);
		expect(snapshotResponse.headers["cache-control"]).toBe("no-store");
		expect(snapshot.coverage.contentCaptured).toBe(false);
		expect(snapshot.totals.operations).toMatchObject({
			started: 3,
			active: 0,
			outcomes: { success: 3, error: 0, aborted: 0 },
		});
		expect(snapshot.totals.modelCalls).toMatchObject({
			started: 3,
			active: 0,
			outcomes: { success: 3, error: 0, aborted: 0 },
		});
		expect(snapshot.models).toHaveLength(3);
		expect(JSON.stringify(snapshot)).not.toContain(CONTENT_SENTINEL);
	});
});

function mockProviders() {
	return {
		openai: new MockProviderV4({
			languageModels: { "gpt-5-mini": successfulModel("openai", "gpt-5-mini") },
		}),
		anthropic: new MockProviderV4({
			languageModels: {
				"claude-haiku-4-5": successfulModel("anthropic", "claude-haiku-4-5"),
			},
		}),
		google: new MockProviderV4({
			languageModels: {
				"gemini-2.5-flash": successfulModel("google", "gemini-2.5-flash"),
			},
		}),
	};
}

function successfulModel(
	provider: (typeof providerIds)[number],
	modelId: string,
): MockLanguageModelV4 {
	return new MockLanguageModelV4({
		provider: `test.${provider}`,
		modelId,
		doGenerate: async () => ({
			content: [{ type: "text", text: CONTENT_SENTINEL }],
			finishReason: { unified: "stop", raw: "stop" },
			usage: {
				inputTokens: { total: 2, noCache: 2, cacheRead: undefined, cacheWrite: undefined },
				outputTokens: { total: 3, text: 3, reasoning: undefined },
			},
			warnings: [],
			response: { body: { content: CONTENT_SENTINEL } },
		}),
	});
}
