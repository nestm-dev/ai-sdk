import { Module, type INestApplication } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	AiSdkObservabilityModule,
	AiSdkObservabilityService,
} from "../../../src/observability/index.ts";
import { AiSdkObservabilityHttpModule } from "../../../src/observability/http/index.ts";
import { FakeAiObservabilityClock } from "../../../src/observability/testing/index.ts";

const testHttpAdapter = process.env.TEST_HTTP_ADAPTER ?? "express";
const clock = new FakeAiObservabilityClock(1_700_000_000_000);

@Module({
	imports: [
		AiSdkObservabilityHttpModule.register({
			imports: [
				AiSdkObservabilityModule.forRoot({
					clock: clock.now,
					isGlobal: false,
				}),
			],
		}),
	],
})
class HttpTestModule {}

function hasNumericRevision(value: unknown): value is { readonly revision: number } {
	return (
		typeof value === "object" &&
		value !== null &&
		"revision" in value &&
		typeof value.revision === "number"
	);
}

describe(`AI observability HTTP projection (${testHttpAdapter})`, () => {
	let app: INestApplication;

	beforeAll(async () => {
		const moduleReference = await Test.createTestingModule({ imports: [HttpTestModule] }).compile();
		app = moduleReference.createNestApplication(
			testHttpAdapter === "fastify" ? new FastifyAdapter() : new ExpressAdapter(),
			{ logger: false },
		);
		await app.init();
		if (testHttpAdapter === "fastify") await app.getHttpAdapter().getInstance().ready();
		await app.listen(0, "127.0.0.1");

		const observability = app.get(AiSdkObservabilityService);
		observability.record([
			{
				schemaVersion: 1,
				eventId: "operation:1:start",
				entityId: "operation:1",
				operationId: "operation:1",
				source: "e2e",
				timestamp: clock.currentTimeMs,
				type: "operation.started",
				operation: "stream-text",
				functionId: "support-chat",
			},
		]);
		clock.advanceBy(25);
		observability.record([
			{
				schemaVersion: 1,
				eventId: "operation:1:complete",
				entityId: "operation:1",
				operationId: "operation:1",
				source: "e2e",
				timestamp: clock.currentTimeMs,
				type: "operation.completed",
				outcome: "success",
				durationMs: 25,
				usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
			},
		]);
	});

	afterAll(async () => {
		await app.close();
	});

	it("serves a bounded, non-cacheable dashboard snapshot", async () => {
		const response = await request(app.getHttpServer()).get("/ai-observability/v1/snapshot");

		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toBe("no-store");
		const body: unknown = response.body;
		expect(body).toMatchObject({
			schemaVersion: 1,
			scope: "process",
			totals: {
				operations: {
					started: 1,
					active: 0,
					outcomes: { success: 1, error: 0, aborted: 0 },
					usage: {
						totals: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
					},
				},
			},
			operations: [
				{
					source: "e2e",
					operation: "stream-text",
					functionId: "support-chat",
					outcomes: { success: 1, error: 0, aborted: 0 },
				},
			],
		});
		if (!hasNumericRevision(body)) {
			throw new TypeError("Snapshot revision was not numeric.");
		}
		expect(body.revision).toBeGreaterThan(0);
	});
});
