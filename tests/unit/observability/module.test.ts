import { Inject, Injectable, Module } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
	AiSdkObservabilityModule,
	AiSdkObservabilityService,
	isAiSdkTelemetryHubRegistered,
	type AiObservabilityClock,
} from "../../../src/observability/index.ts";
import {
	AiSdkObservabilityTestingModule,
	FakeAiObservabilityClock,
} from "../../../src/observability/testing/index.ts";

const CONFIGURED_CLOCK = Symbol("CONFIGURED_CLOCK");
const asyncClock = new FakeAiObservabilityClock(1_700_000_000_000);

@Module({
	providers: [{ provide: CONFIGURED_CLOCK, useValue: asyncClock.now }],
	exports: [CONFIGURED_CLOCK],
})
class ConfigurationFixtureModule {}

@Injectable()
class GlobalConsumer {
	constructor(
		@Inject(AiSdkObservabilityService)
		readonly observability: AiSdkObservabilityService,
	) {}
}

@Module({ providers: [GlobalConsumer], exports: [GlobalConsumer] })
class GlobalConsumerModule {}

function recordCompletedOperation(
	observability: AiSdkObservabilityService,
	clock: FakeAiObservabilityClock,
): void {
	const operationId = `operation:${clock.currentTimeMs}`;

	observability.record([
		{
			schemaVersion: 1,
			eventId: `${operationId}:start`,
			entityId: operationId,
			operationId,
			source: "nest-test",
			timestamp: clock.currentTimeMs,
			type: "operation.started",
			operation: "generate-text",
			functionId: "chat",
		},
	]);
	clock.advanceBy(10);
	observability.record([
		{
			schemaVersion: 1,
			eventId: `${operationId}:complete`,
			entityId: operationId,
			operationId,
			source: "nest-test",
			timestamp: clock.currentTimeMs,
			type: "operation.completed",
			outcome: "success",
			durationMs: 10,
		},
	]);
}

describe("AiSdkObservabilityModule", () => {
	const modules: TestingModule[] = [];

	afterEach(async () => {
		await Promise.all(modules.splice(0).map((moduleReference) => moduleReference.close()));
	});

	it("builds the bounded collector through synchronous configuration", async () => {
		const clock = new FakeAiObservabilityClock(1_700_000_000_000);
		const moduleReference = await Test.createTestingModule({
			imports: [AiSdkObservabilityModule.forRoot({ clock: clock.now, isGlobal: false })],
		}).compile();
		modules.push(moduleReference);
		const observability = moduleReference.get(AiSdkObservabilityService);

		recordCompletedOperation(observability, clock);

		expect(observability.snapshot().totals.operations).toMatchObject({
			started: 1,
			active: 0,
			outcomes: { success: 1, error: 0, aborted: 0 },
		});
	});

	it("does not register process-global AI SDK telemetry", async () => {
		expect(isAiSdkTelemetryHubRegistered()).toBe(false);
		const moduleReference = await Test.createTestingModule({
			imports: [AiSdkObservabilityModule.forRoot({ isGlobal: false })],
		}).compile();
		modules.push(moduleReference);

		expect(moduleReference.get(AiSdkObservabilityService)).toBeDefined();
		expect(isAiSdkTelemetryHubRegistered()).toBe(false);
	});

	it("supports injected asynchronous configuration", async () => {
		const moduleReference = await Test.createTestingModule({
			imports: [
				AiSdkObservabilityModule.forRootAsync({
					imports: [ConfigurationFixtureModule],
					inject: [CONFIGURED_CLOCK],
					isGlobal: false,
					useFactory: (clock: AiObservabilityClock) => ({ clock }),
				}),
			],
		}).compile();
		modules.push(moduleReference);

		const observability = moduleReference.get(AiSdkObservabilityService);

		expect(observability.snapshot().capturedAt).toBe("2023-11-14T22:13:20.000Z");
	});

	it("is global by default", async () => {
		const moduleReference = await Test.createTestingModule({
			imports: [AiSdkObservabilityModule.forRoot(), GlobalConsumerModule],
		}).compile();
		modules.push(moduleReference);

		const consumer = moduleReference.get(GlobalConsumer);

		expect(consumer.observability).toBe(moduleReference.get(AiSdkObservabilityService));
	});

	it("provides a local collector and deterministic clock through the testing module", async () => {
		const moduleReference = await Test.createTestingModule({
			imports: [AiSdkObservabilityTestingModule.forRoot({ initialTimeMs: 1_700_000_000_000 })],
		}).compile();
		modules.push(moduleReference);
		const observability = moduleReference.get(AiSdkObservabilityService);
		const clock = moduleReference.get(FakeAiObservabilityClock);

		recordCompletedOperation(observability, clock);

		expect(clock.currentTimeMs).toBe(1_700_000_000_010);
		const snapshot = observability.snapshot();
		expect(snapshot.revision).toBeGreaterThan(0);
		expect(snapshot).toMatchObject({
			capturedAt: "2023-11-14T22:13:20.010Z",
		});
	});
});

describe("FakeAiObservabilityClock", () => {
	it("supports deterministic set and advance operations", () => {
		const clock = new FakeAiObservabilityClock(100);

		expect(clock.now()).toBe(100);
		expect(clock.advanceBy(25)).toBe(125);
		clock.set(200);
		expect(clock.now()).toBe(200);
	});

	it("rejects invalid and backwards advances", () => {
		expect(() => new FakeAiObservabilityClock(Number.NaN)).toThrow(TypeError);
		expect(() => new FakeAiObservabilityClock(-1)).toThrow(RangeError);
		const clock = new FakeAiObservabilityClock();

		expect(() => clock.advanceBy(-1)).toThrow(RangeError);
		expect(() => clock.advanceBy(0.5)).toThrow(TypeError);
		expect(() => clock.set(Number.POSITIVE_INFINITY)).toThrow(TypeError);
	});
});
