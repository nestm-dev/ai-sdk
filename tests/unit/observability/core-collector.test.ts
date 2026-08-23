import { describe, expect, it } from "vitest";

import {
	AI_OBSERVABILITY_BUCKET_COUNT,
	AI_OBSERVABILITY_BUCKET_MS,
	InMemoryAiObservabilityCollector,
	type AiModelCompletedEvent,
	type AiModelStartedEvent,
	type AiObservabilityEvent,
	type AiOperationCompletedEvent,
	type AiOperationStartedEvent,
} from "../../../src/observability/core/index.ts";

const INITIAL_TIME = Date.parse("2026-08-23T12:00:00.000Z");

describe("InMemoryAiObservabilityCollector", () => {
	it("aggregates a content-free operation, model call, and tool timeline", () => {
		let now = INITIAL_TIME;
		const collector = new InMemoryAiObservabilityCollector({ clock: () => now });

		collector.record([
			{
				...base("op:start", "op", "op", now),
				type: "operation.started",
				operation: "stream-text",
				functionId: "support-chat",
				streaming: true,
				prompt: "secret-prompt-that-must-never-be-retained",
			} as AiOperationStartedEvent,
		]);
		now += 10;
		collector.record([
			{
				...base("model:start", "model:0", "op", now, "op"),
				type: "model.started",
				provider: "openai",
				model: "gpt-test",
				streaming: true,
			} satisfies AiModelStartedEvent,
		]);
		now += 50;
		collector.record([
			{
				...base("model:end", "model:0", "op", now, "op"),
				type: "model.completed",
				outcome: "success",
				durationMs: 50,
				finishReason: "stop",
				usage: {
					inputTokens: 10,
					cacheReadInputTokens: 4,
					outputTokens: 5,
					totalTokens: 15,
				},
				performance: {
					timeToFirstOutputMs: 20,
					outputTokensPerSecond: 100,
					effectiveTotalTokensPerSecond: 300,
				},
			} satisfies AiModelCompletedEvent,
		]);
		now += 10;
		collector.record([
			{
				...base("tool:start", "tool:1", "op", now, "op"),
				type: "tool.started",
				toolName: "weather.lookup",
			},
		]);
		now += 40;
		collector.record([
			{
				...base("tool:end", "tool:1", "op", now, "op"),
				type: "tool.completed",
				outcome: "success",
				durationMs: 40,
			},
		]);
		now += 10;
		collector.record([
			{
				...base("op:end", "op", "op", now),
				type: "operation.completed",
				outcome: "success",
				durationMs: 120,
				finishReason: "stop",
				usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
			} satisfies AiOperationCompletedEvent,
		]);

		const snapshot = collector.snapshot();
		expect(snapshot).toMatchObject({
			schemaVersion: 1,
			scope: "process",
			revision: 6,
			coverage: {
				contentCaptured: false,
				signals: {
					operations: { started: 1, completed: 1, abandoned: 0 },
					modelCalls: { started: 1, completed: 1, abandoned: 0 },
					toolExecutions: { started: 1, completed: 1, abandoned: 0 },
				},
			},
			totals: {
				operations: {
					started: 1,
					active: 0,
					outcomes: { success: 1, error: 0, aborted: 0 },
					durationMs: { count: 1, average: 120, p50: 120, p95: 120, p99: 120, max: 120 },
					usage: {
						totals: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
						samples: { inputTokens: 1, outputTokens: 1, totalTokens: 1 },
					},
				},
				modelCalls: {
					outcomes: { success: 1, error: 0, aborted: 0 },
					usage: {
						totals: { inputTokens: 10, cacheReadInputTokens: 4, outputTokens: 5 },
						samples: { inputTokens: 1, cacheReadInputTokens: 1, outputTokens: 1 },
					},
					finishReasons: { stop: 1 },
					performance: {
						timeToFirstOutputMs: { count: 1, average: 20 },
						outputTokensPerSecond: { count: 1, average: 100 },
					},
				},
				toolExecutions: { started: 1, active: 0, outcomes: { success: 1 } },
			},
		});
		expect(snapshot.operations).toEqual([
			expect.objectContaining({
				source: "test",
				operation: "stream-text",
				functionId: "support-chat",
				overflow: false,
			}),
		]);
		expect(snapshot.models).toEqual([
			expect.objectContaining({
				modality: "language",
				provider: "openai",
				model: "gpt-test",
			}),
		]);
		expect(snapshot.tools).toEqual([
			expect.objectContaining({ tool: "weather.lookup", overflow: false }),
		]);
		expect(JSON.stringify(snapshot)).not.toContain("secret-prompt");
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.totals.modelCalls.performance)).toBe(true);
	});

	it("deduplicates replays and rejects orphan or conflicting terminals", () => {
		let now = INITIAL_TIME;
		const collector = new InMemoryAiObservabilityCollector({ clock: () => now });
		const start: AiOperationStartedEvent = {
			...base("op:start", "op", "op", now),
			type: "operation.started",
			operation: "generate-text",
		};
		collector.record([start, start]);
		collector.record([{ ...start, eventId: "op:start:again" }]);
		now += 10;
		const end: AiOperationCompletedEvent = {
			...base("op:end", "op", "op", now),
			type: "operation.completed",
			outcome: "success",
		};
		collector.record([end, end]);
		collector.record([{ ...end, eventId: "op:end:conflict", outcome: "error" }]);
		collector.record([
			{
				...base("orphan:end", "orphan", "orphan", now),
				type: "operation.completed",
				outcome: "error",
			},
		]);

		const snapshot = collector.snapshot();
		expect(snapshot.totals.operations).toMatchObject({
			started: 1,
			active: 0,
			outcomes: { success: 1, error: 0, aborted: 0 },
		});
		expect(snapshot.collector.events).toMatchObject({
			received: 7,
			applied: 2,
			discarded: {
				duplicate: 3,
				conflict: 1,
				orphanTerminal: 1,
			},
		});
	});

	it("corrects a successful outer operation when post-processing later fails", () => {
		let now = INITIAL_TIME;
		const collector = new InMemoryAiObservabilityCollector({ clock: () => now });
		collector.record([operationStart("corrected", now)]);
		now += 10;
		collector.record([
			{
				...base("corrected:end", "corrected", "corrected", now),
				type: "operation.completed",
				outcome: "success",
				finishReason: "stop",
				durationMs: 10,
			},
		]);
		now += 20;
		collector.record([
			{
				...base("corrected:outcome", "corrected", "corrected", now),
				type: "operation.outcome-corrected",
				outcome: "error",
			},
		]);

		const snapshot = collector.snapshot();
		expect(snapshot.totals.operations).toMatchObject({
			started: 1,
			active: 0,
			outcomes: { success: 0, error: 1, aborted: 0 },
			finishReasons: { stop: 0, error: 1 },
			durationMs: { count: 1, average: 10 },
		});
		expect(snapshot.operations[0]).toMatchObject({
			outcomes: { success: 0, error: 1 },
			finishReasons: { stop: 0, error: 1 },
		});
		expect(
			snapshot.window.buckets.reduce((sum, bucket) => sum + bucket.operations.outcomes.success, 0),
		).toBe(0);
		expect(
			snapshot.window.buckets.reduce((sum, bucket) => sum + bucket.operations.outcomes.error, 0),
		).toBe(1);
		expect(snapshot.coverage.signals.operations).toEqual({
			started: 1,
			completed: 1,
			abandoned: 0,
		});
		expect(snapshot.collector.events.applied).toBe(3);
	});

	it("bounds active state and turns missing terminals into explicit abandonment", () => {
		let now = INITIAL_TIME;
		const collector = new InMemoryAiObservabilityCollector({
			clock: () => now,
			activeTtlMs: 1_000,
			maxActiveEntities: 2,
		});

		collector.record([operationStart("a", now), operationStart("b", now)]);
		now += 1;
		collector.record([operationStart("c", now)]);
		let snapshot = collector.snapshot();
		expect(snapshot.totals.operations).toMatchObject({
			started: 3,
			active: 2,
			abandoned: { capacity: 1, ttl: 0, parent: 0 },
		});

		now += 1_000;
		snapshot = collector.snapshot();
		expect(snapshot.totals.operations).toMatchObject({
			active: 0,
			abandoned: { capacity: 1, ttl: 2, parent: 0 },
		});
		expect(snapshot.collector.active).toMatchObject({
			tracked: 0,
			limit: 2,
			ttlSeconds: 1,
			abandoned: { capacity: 1, ttl: 2 },
		});

		collector.record([
			{
				...base("a:end", "a", "a", now),
				type: "operation.completed",
				outcome: "success",
			},
		]);
		expect(collector.snapshot().collector.events.discarded.terminalAfterAbandonment).toBe(1);
	});

	it("protects an active parent when admitting a child at capacity", () => {
		let now = INITIAL_TIME;
		const collector = new InMemoryAiObservabilityCollector({
			clock: () => now,
			maxActiveEntities: 2,
		});

		collector.record([{ ...operationStart("parent", now), operation: "parent" }]);
		now += 1;
		collector.record([{ ...operationStart("unrelated", now), operation: "unrelated" }]);
		now += 1;
		collector.record([
			{
				...base("child:start", "child", "parent", now, "parent"),
				type: "model.started",
				provider: "openai",
				model: "gpt-test",
				streaming: false,
			},
		]);

		const snapshot = collector.snapshot();
		expect(snapshot.operations.find(({ operation }) => operation === "parent")).toMatchObject({
			active: 1,
			abandoned: { capacity: 0 },
		});
		expect(snapshot.operations.find(({ operation }) => operation === "unrelated")).toMatchObject({
			active: 0,
			abandoned: { capacity: 1 },
		});
		expect(snapshot.totals.modelCalls.active).toBe(1);
		expect(snapshot.collector.active.tracked).toBe(2);
	});

	it("abandons a new child when capacity is entirely its ancestor chain", () => {
		const now = INITIAL_TIME;
		const collector = new InMemoryAiObservabilityCollector({
			clock: () => now,
			maxActiveEntities: 2,
		});

		collector.record([
			operationStart("root", now),
			{
				...base("step:start", "step", "root", now, "root"),
				type: "step.started",
				stepNumber: 0,
			},
			{
				...base("model:start", "model", "root", now, "step"),
				type: "model.started",
				provider: "openai",
				model: "gpt-test",
				streaming: false,
			},
		]);

		const snapshot = collector.snapshot();
		expect(snapshot.totals.operations.active).toBe(1);
		expect(snapshot.totals.steps.active).toBe(1);
		expect(snapshot.totals.modelCalls).toMatchObject({
			started: 1,
			active: 0,
			abandoned: { capacity: 1 },
		});
		expect(snapshot.collector.active.tracked).toBe(2);
	});

	it("keeps lifetime totals while rotating a fixed fifteen-minute window", () => {
		let now = INITIAL_TIME;
		const collector = new InMemoryAiObservabilityCollector({ clock: () => now });
		collector.record([operationStart("one", now)]);
		now += 1;
		collector.record([
			{
				...base("one:end", "one", "one", now),
				type: "operation.completed",
				outcome: "success",
				durationMs: 1,
			},
		]);

		now += AI_OBSERVABILITY_BUCKET_MS * (AI_OBSERVABILITY_BUCKET_COUNT + 1);
		const snapshot = collector.snapshot();
		expect(snapshot.totals.operations.started).toBe(1);
		expect(snapshot.window.buckets).toHaveLength(AI_OBSERVABILITY_BUCKET_COUNT);
		expect(
			snapshot.window.buckets.reduce((sum, bucket) => sum + bucket.operations.started, 0),
		).toBe(0);
		expect(
			snapshot.window.buckets.reduce((sum, bucket) => sum + bucket.operations.outcomes.success, 0),
		).toBe(0);
		expect(snapshot.window.buckets.some((bucket) => "active" in bucket.operations)).toBe(false);
	});

	it("keeps embedding and reranking model signals distinct and content-free", () => {
		let now = INITIAL_TIME;
		const collector = new InMemoryAiObservabilityCollector({ clock: () => now });
		collector.record([
			{
				...base("embedding:start", "embedding:0", "embed-op", now),
				type: "embedding.started",
				provider: "openai",
				model: "embedding-test",
				batchSize: 2,
			},
			{
				...base("reranking:start", "reranking:0", "rerank-op", now),
				type: "reranking.started",
				provider: "cohere",
				model: "rerank-test",
				documentCount: 4,
			},
		]);
		now += 20;
		collector.record([
			{
				...base("embedding:end", "embedding:0", "embed-op", now),
				type: "embedding.completed",
				outcome: "success",
				usage: { embeddingTokens: 12 },
			},
			{
				...base("reranking:end", "reranking:0", "rerank-op", now),
				type: "reranking.completed",
				outcome: "success",
				resultCount: 2,
			},
		]);

		const snapshot = collector.snapshot();
		expect(snapshot.totals.embeddingCalls).toMatchObject({
			started: 1,
			outcomes: { success: 1 },
			usage: {
				totals: { embeddingTokens: 12 },
				samples: { embeddingTokens: 1 },
			},
		});
		expect(snapshot.totals.rerankingCalls).toMatchObject({
			started: 1,
			outcomes: { success: 1 },
		});
		expect(snapshot.models.map(({ modality }) => modality)).toEqual(["embedding", "reranking"]);
	});

	it("abandons incomplete child telemetry when its parent terminates", () => {
		let now = INITIAL_TIME;
		const collector = new InMemoryAiObservabilityCollector({ clock: () => now });
		collector.record([operationStart("parent", now)]);
		collector.record([
			{
				...base("child:start", "child", "parent", now, "parent"),
				type: "model.started",
				provider: "openai",
				model: "gpt-test",
				streaming: false,
			},
		]);
		now += 10;
		collector.record([
			{
				...base("parent:end", "parent", "parent", now),
				type: "operation.completed",
				outcome: "error",
			},
		]);

		const snapshot = collector.snapshot();
		expect(snapshot.totals.modelCalls).toMatchObject({
			started: 1,
			active: 0,
			abandoned: { parent: 1 },
		});
		expect(snapshot.coverage.signals.modelCalls).toEqual({
			started: 1,
			completed: 0,
			abandoned: 1,
		});
	});

	it("folds high-cardinality dimensions into explicit bounded overflow rows", () => {
		let now = INITIAL_TIME;
		const collector = new InMemoryAiObservabilityCollector({
			clock: () => now,
			maxOperationGroups: 3,
			maxModelGroups: 3,
			maxToolGroups: 3,
		});
		for (const [index, operation] of ["other", "op-1", "op-2", "op-3", "op-4"].entries()) {
			const id = `operation-${String(index)}`;
			collector.record([
				{
					...operationStart(id, now),
					operation,
				},
			]);
			now += 1;
			collector.record([
				{
					...base(`${id}:end`, id, id, now),
					type: "operation.completed",
					outcome: "success",
				},
			]);
			now += 1;
		}

		const snapshot = collector.snapshot();
		expect(snapshot.operations).toHaveLength(3);
		expect(snapshot.operations.filter(({ operation }) => operation === "other")).toHaveLength(2);
		expect(snapshot.operations.find(({ overflow }) => overflow)).toMatchObject({
			operation: "other",
			started: 3,
			outcomes: { success: 3 },
		});
		expect(snapshot.collector.groups.operations).toMatchObject({
			retained: 3,
			concrete: 2,
			limit: 3,
			eventsFolded: 3,
			truncated: true,
		});
	});

	it("rejects unsafe numeric fields without losing the lifecycle terminal", () => {
		let now = INITIAL_TIME;
		const collector = new InMemoryAiObservabilityCollector({ clock: () => now });
		collector.record([
			{
				...base("model:start", "model", "op", now),
				type: "model.started",
				provider: "openai",
				model: "gpt-test",
				streaming: false,
			},
		]);
		now += 25;
		collector.record([
			{
				...base("model:end", "model", "op", now),
				type: "model.completed",
				outcome: "success",
				durationMs: Number.NaN,
				usage: { inputTokens: -1, outputTokens: 0.5, totalTokens: 0 },
				performance: { timeToFirstOutputMs: Number.POSITIVE_INFINITY },
			},
		]);

		const snapshot = collector.snapshot();
		expect(snapshot.totals.modelCalls).toMatchObject({
			outcomes: { success: 1 },
			durationMs: { count: 1, average: 25 },
			usage: {
				totals: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
				samples: { inputTokens: 0, outputTokens: 0, totalTokens: 1 },
			},
		});
		expect(snapshot.collector.events.rejectedFields).toEqual({
			dimension: 0,
			duration: 1,
			usage: 2,
			performance: 1,
		});
	});

	it("validates configuration and event timestamps", () => {
		expect(
			() => new InMemoryAiObservabilityCollector({ clock: () => 253_402_300_800_000 }),
		).toThrow(/valid Unix epoch/);
		expect(() => new InMemoryAiObservabilityCollector({ maxOperationGroups: 0 })).toThrow(
			/maxOperationGroups/,
		);

		let now = INITIAL_TIME;
		const collector = new InMemoryAiObservabilityCollector({ clock: () => now });
		collector.record([operationStart("future", now + 2_000)]);
		collector.record([operationStart("past", now - 1)]);
		Reflect.apply(Reflect.get(collector, "record"), collector, [
			[
				{
					...operationStart("unsupported", now),
					schemaVersion: 2,
				},
			],
		]);
		expect(collector.snapshot().collector.events.discarded).toMatchObject({
			future: 1,
			beforeCollectorStart: 1,
			unsupportedVersion: 1,
		});
	});

	it("abandons a deep parent chain without recursive stack growth", () => {
		const now = INITIAL_TIME;
		const depth = 6_000;
		const collector = new InMemoryAiObservabilityCollector({
			clock: () => now,
			maxActiveEntities: depth + 1,
		});
		const starts: AiObservabilityEvent[] = [operationStart("root", now)];
		for (let index = 0; index < depth; index += 1) {
			const entityId = `step:${String(index)}`;
			starts.push({
				...base(
					`${entityId}:start`,
					entityId,
					"root",
					now,
					index === 0 ? "root" : `step:${String(index - 1)}`,
				),
				type: "step.started",
				stepNumber: index,
			});
		}

		collector.record(starts);
		expect(() =>
			collector.record([
				{
					...base("root:end", "root", "root", now),
					type: "operation.completed",
					outcome: "success",
				},
			]),
		).not.toThrow();

		const snapshot = collector.snapshot();
		expect(snapshot.collector.active.tracked).toBe(0);
		expect(snapshot.totals.steps).toMatchObject({
			started: depth,
			active: 0,
			abandoned: { parent: depth },
		});
	});

	it("refreshes every ancestor in a deep active chain", () => {
		let now = INITIAL_TIME;
		const depth = 41;
		const collector = new InMemoryAiObservabilityCollector({
			clock: () => now,
			activeTtlMs: 1_000,
		});
		const starts: AiObservabilityEvent[] = [operationStart("root", now)];
		for (let index = 0; index < depth; index += 1) {
			const entityId = `step:${String(index)}`;
			starts.push({
				...base(
					`${entityId}:start`,
					entityId,
					"root",
					now,
					index === 0 ? "root" : `step:${String(index - 1)}`,
				),
				type: "step.started",
				stepNumber: index,
			});
		}
		collector.record(starts);

		now += 999;
		collector.record([
			{
				...base("leaf-tool:start", "leaf-tool", "root", now, `step:${String(depth - 1)}`),
				type: "tool.started",
				toolName: "keep-alive",
			},
		]);
		now += 1;

		const snapshot = collector.snapshot();
		expect(snapshot.collector.active.tracked).toBe(depth + 2);
		expect(snapshot.totals.operations.active).toBe(1);
		expect(snapshot.totals.steps.active).toBe(depth);
		expect(snapshot.totals.toolExecutions.active).toBe(1);
	});

	it("contains malformed runtime event shapes instead of throwing", () => {
		const now = INITIAL_TIME;
		const collector = new InMemoryAiObservabilityCollector({ clock: () => now });
		const runtimeRecord = Reflect.get(collector, "record");

		expect(() =>
			Reflect.apply(runtimeRecord, collector, [
				[
					{ ...operationStart("bad-source", now), source: null },
					{ ...operationStart("bad-parent", now), parentEntityId: null },
					{ ...operationStart("bad-function", now), functionId: null },
				],
			]),
		).not.toThrow();
		expect(collector.snapshot().collector.events).toMatchObject({
			received: 3,
			applied: 0,
			discarded: { invalid: 3 },
		});
	});

	it("does not let an invalid event poison a replay identifier", () => {
		const now = INITIAL_TIME;
		const collector = new InMemoryAiObservabilityCollector({ clock: () => now });
		const invalid = { ...operationStart("reused", now), operation: null };
		Reflect.apply(Reflect.get(collector, "record"), collector, [[invalid]]);
		collector.record([operationStart("reused", now)]);
		collector.record([operationStart("future-reused", now + 2_000)]);
		collector.record([operationStart("future-reused", now)]);

		expect(collector.snapshot().collector.events).toMatchObject({
			received: 4,
			applied: 2,
			discarded: { invalid: 1, future: 1, duplicate: 0 },
		});
	});
});

function base(
	eventId: string,
	entityId: string,
	operationId: string,
	timestamp: number,
	parentEntityId?: string,
): Omit<AiOperationStartedEvent, "type" | "operation"> {
	return {
		schemaVersion: 1,
		eventId,
		entityId,
		operationId,
		source: "test",
		timestamp,
		...(parentEntityId === undefined ? {} : { parentEntityId }),
	};
}

function operationStart(id: string, timestamp: number): AiOperationStartedEvent {
	return {
		...base(`${id}:start`, id, id, timestamp),
		type: "operation.started",
		operation: "generate-text",
	};
}
