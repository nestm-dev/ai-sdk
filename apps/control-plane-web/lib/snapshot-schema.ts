import type { AiObservabilitySnapshotV1 } from "@nestm/ai-sdk/observability/core";
import { z } from "zod";

const safeCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const finiteMetric = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER);
const nullableMetric = finiteMetric.nullable();
const dateTime = z.string().datetime({ offset: true });
const dimension = z.string().min(1).max(128);

const outcomesSchema = z
	.object({ success: safeCount, error: safeCount, aborted: safeCount })
	.strict();

const abandonedSchema = z
	.object({ ttl: safeCount, capacity: safeCount, parent: safeCount })
	.strict();

const distributionSchema = z
	.object({
		count: safeCount,
		average: nullableMetric,
		p50: nullableMetric,
		p95: nullableMetric,
		p99: nullableMetric,
		max: nullableMetric,
	})
	.strict()
	.superRefine((distribution, context) => {
		const values = [
			distribution.average,
			distribution.p50,
			distribution.p95,
			distribution.p99,
			distribution.max,
		];
		if (distribution.count === 0 && values.some((value) => value !== null)) {
			context.addIssue({ code: "custom", message: "Empty distributions must use null metrics." });
		}
		if (distribution.count > 0 && values.some((value) => value === null)) {
			context.addIssue({ code: "custom", message: "Sampled distributions require every metric." });
		}
		if (
			distribution.p50 !== null &&
			distribution.p95 !== null &&
			distribution.p99 !== null &&
			distribution.max !== null &&
			!(
				distribution.p50 <= distribution.p95 &&
				distribution.p95 <= distribution.p99 &&
				distribution.p99 <= distribution.max
			)
		) {
			context.addIssue({ code: "custom", message: "Distribution percentiles are unordered." });
		}
	});

const tokenTotalsSchema = z
	.object({
		inputTokens: safeCount,
		noCacheInputTokens: safeCount,
		cacheReadInputTokens: safeCount,
		cacheWriteInputTokens: safeCount,
		outputTokens: safeCount,
		textOutputTokens: safeCount,
		reasoningOutputTokens: safeCount,
		totalTokens: safeCount,
		embeddingTokens: safeCount,
	})
	.strict();

const usageSchema = z.object({ totals: tokenTotalsSchema, samples: tokenTotalsSchema }).strict();

const finishReasonsSchema = z
	.object({
		stop: safeCount,
		length: safeCount,
		"content-filter": safeCount,
		"tool-calls": safeCount,
		error: safeCount,
		other: safeCount,
		unknown: safeCount,
	})
	.strict();

const performanceSchema = z
	.object({
		timeToFirstOutputMs: distributionSchema,
		effectiveOutputTokensPerSecond: distributionSchema,
		outputTokensPerSecond: distributionSchema,
		inputTokensPerSecond: distributionSchema,
		effectiveTotalTokensPerSecond: distributionSchema,
	})
	.strict();

const lifecycleSchema = z
	.object({
		started: safeCount,
		active: safeCount,
		outcomes: outcomesSchema,
		abandoned: abandonedSchema,
		durationMs: distributionSchema,
	})
	.strict();

const windowLifecycleSchema = lifecycleSchema.omit({ active: true });
const operationMetricsSchema = lifecycleSchema.extend({
	usage: usageSchema,
	finishReasons: finishReasonsSchema,
});
const windowOperationMetricsSchema = windowLifecycleSchema.extend({
	usage: usageSchema,
	finishReasons: finishReasonsSchema,
});
const modelMetricsSchema = operationMetricsSchema.extend({ performance: performanceSchema });
const windowModelMetricsSchema = windowOperationMetricsSchema.extend({
	performance: performanceSchema,
});

const totalsSchema = z
	.object({
		operations: operationMetricsSchema,
		steps: lifecycleSchema,
		modelCalls: modelMetricsSchema,
		toolExecutions: lifecycleSchema,
		embeddingCalls: modelMetricsSchema,
		rerankingCalls: modelMetricsSchema,
	})
	.strict();

const bucketSchema = z
	.object({
		startedAt: dateTime,
		operations: windowOperationMetricsSchema,
		steps: windowLifecycleSchema,
		modelCalls: windowModelMetricsSchema,
		toolExecutions: windowLifecycleSchema,
		embeddingCalls: windowModelMetricsSchema,
		rerankingCalls: windowModelMetricsSchema,
	})
	.strict();

const operationGroupSchema = operationMetricsSchema.extend({
	source: dimension,
	operation: dimension,
	functionId: dimension.optional(),
	overflow: z.boolean(),
});

const modelGroupSchema = modelMetricsSchema.extend({
	source: dimension,
	modality: z.enum(["language", "embedding", "reranking", "other"]),
	provider: dimension,
	model: dimension,
	overflow: z.boolean(),
});

const toolGroupSchema = lifecycleSchema.extend({
	source: dimension,
	tool: dimension,
	overflow: z.boolean(),
});

const signalCoverageSchema = z
	.object({ started: safeCount, completed: safeCount, abandoned: safeCount })
	.strict();

const groupDiagnosticsSchema = z
	.object({
		retained: safeCount,
		concrete: safeCount,
		limit: safeCount.min(1).max(1_000),
		eventsFolded: safeCount,
		truncated: z.boolean(),
	})
	.strict();

const collectorSchema = z
	.object({
		events: z
			.object({
				received: safeCount,
				applied: safeCount,
				discarded: z
					.object({
						unsupportedVersion: safeCount,
						invalid: safeCount,
						duplicate: safeCount,
						conflict: safeCount,
						orphanTerminal: safeCount,
						terminalAfterAbandonment: safeCount,
						beforeCollectorStart: safeCount,
						future: safeCount,
					})
					.strict(),
				outsideWindow: safeCount,
				rejectedFields: z
					.object({
						dimension: safeCount,
						duration: safeCount,
						usage: safeCount,
						performance: safeCount,
					})
					.strict(),
			})
			.strict(),
		active: z
			.object({
				tracked: safeCount,
				limit: safeCount.min(1).max(65_536),
				ttlSeconds: safeCount.min(1),
				abandoned: abandonedSchema,
			})
			.strict(),
		replayProtection: z
			.object({
				retained: safeCount,
				limit: safeCount.min(1).max(131_072),
				ttlSeconds: safeCount.min(1),
				evicted: safeCount,
			})
			.strict(),
		groups: z
			.object({
				operations: groupDiagnosticsSchema,
				models: groupDiagnosticsSchema,
				tools: groupDiagnosticsSchema,
			})
			.strict(),
		clockRegressions: safeCount,
		counterSaturated: z.boolean(),
	})
	.strict();

export const aiObservabilitySnapshotSchema = z
	.object({
		schemaVersion: z.literal(1),
		scope: z.literal("process"),
		startedAt: dateTime,
		capturedAt: dateTime,
		revision: safeCount,
		totals: totalsSchema,
		window: z
			.object({
				bucketSeconds: z.literal(15),
				maxBuckets: z.literal(60),
				buckets: z.array(bucketSchema).max(60),
			})
			.strict(),
		operations: z.array(operationGroupSchema).max(1_000),
		models: z.array(modelGroupSchema).max(1_000),
		tools: z.array(toolGroupSchema).max(1_000),
		coverage: z
			.object({
				contentCaptured: z.literal(false),
				signals: z
					.object({
						operations: signalCoverageSchema,
						steps: signalCoverageSchema,
						modelCalls: signalCoverageSchema,
						toolExecutions: signalCoverageSchema,
						embeddingCalls: signalCoverageSchema,
						rerankingCalls: signalCoverageSchema,
					})
					.strict(),
			})
			.strict(),
		collector: collectorSchema,
	})
	.strict()
	.superRefine((snapshot, context) => {
		const startedAt = Date.parse(snapshot.startedAt);
		const capturedAt = Date.parse(snapshot.capturedAt);
		if (startedAt > capturedAt) {
			context.addIssue({ code: "custom", message: "Capture precedes process start." });
		}

		let previous = Number.NEGATIVE_INFINITY;
		for (const [index, bucket] of snapshot.window.buckets.entries()) {
			const current = Date.parse(bucket.startedAt);
			if (current <= previous || current > capturedAt) {
				context.addIssue({
					code: "custom",
					path: ["window", "buckets", index, "startedAt"],
					message: "Window buckets must be strictly ordered and not in the future.",
				});
			}
			previous = current;
		}

		checkUnique(
			snapshot.operations.map((row) =>
				JSON.stringify([row.source, row.operation, row.functionId ?? null, row.overflow]),
			),
			["operations"],
			context,
		);
		checkUnique(
			snapshot.models.map((row) =>
				JSON.stringify([row.source, row.modality, row.provider, row.model, row.overflow]),
			),
			["models"],
			context,
		);
		checkUnique(
			snapshot.tools.map((row) => JSON.stringify([row.source, row.tool, row.overflow])),
			["tools"],
			context,
		);
	});

function checkUnique(
	keys: readonly string[],
	path: readonly PropertyKey[],
	context: z.RefinementCtx,
): void {
	if (new Set(keys).size !== keys.length) {
		context.addIssue({
			code: "custom",
			path: [...path],
			message: "Group identities must be unique.",
		});
	}
}

export function parseAiObservabilitySnapshot(input: unknown): AiObservabilitySnapshotV1 {
	return aiObservabilitySnapshotSchema.parse(input) as AiObservabilitySnapshotV1;
}
