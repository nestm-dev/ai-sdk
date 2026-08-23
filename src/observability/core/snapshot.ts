import type { AiFinishReason, AiModelModality, AiObservabilityOutcome } from "./events.ts";

export const AI_OBSERVABILITY_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const AI_OBSERVABILITY_BUCKET_MS = 15_000;
export const AI_OBSERVABILITY_BUCKET_COUNT = 60;
export const AI_OBSERVABILITY_MAX_OPERATION_GROUPS = 100;
export const AI_OBSERVABILITY_MAX_MODEL_GROUPS = 100;
export const AI_OBSERVABILITY_MAX_TOOL_GROUPS = 100;
export const AI_OBSERVABILITY_MAX_ACTIVE_ENTITIES = 4_096;
export const AI_OBSERVABILITY_ACTIVE_TTL_MS = 60 * 60_000;
export const AI_OBSERVABILITY_MAX_REPLAY_ENTRIES = 16_384;
export const AI_OBSERVABILITY_REPLAY_TTL_MS = 60 * 60_000;

export const AI_OBSERVABILITY_DURATION_BOUNDS_MS = Object.freeze([
	5,
	10,
	25,
	50,
	100,
	250,
	500,
	1_000,
	2_500,
	5_000,
	10_000,
	30_000,
	60_000,
	120_000,
	300_000,
	600_000,
	1_800_000,
	Number.POSITIVE_INFINITY,
] as const);

export const AI_OBSERVABILITY_RATE_BOUNDS_PER_SECOND = Object.freeze([
	1,
	5,
	10,
	25,
	50,
	100,
	250,
	500,
	1_000,
	2_500,
	5_000,
	10_000,
	Number.POSITIVE_INFINITY,
] as const);

export interface AiMetricDistributionView {
	readonly count: number;
	readonly average: number | null;
	readonly p50: number | null;
	readonly p95: number | null;
	readonly p99: number | null;
	readonly max: number | null;
}

export interface AiMetricOutcomesView {
	readonly success: number;
	readonly error: number;
	readonly aborted: number;
}

export interface AiMetricAbandonedView {
	readonly ttl: number;
	readonly capacity: number;
	readonly parent: number;
}

export interface AiTokenTotalsView {
	readonly inputTokens: number;
	readonly noCacheInputTokens: number;
	readonly cacheReadInputTokens: number;
	readonly cacheWriteInputTokens: number;
	readonly outputTokens: number;
	readonly textOutputTokens: number;
	readonly reasoningOutputTokens: number;
	readonly totalTokens: number;
	readonly embeddingTokens: number;
}

/** `samples` distinguishes an unreported field from a reported zero. */
export interface AiUsageMetricsView {
	readonly totals: AiTokenTotalsView;
	readonly samples: AiTokenTotalsView;
}

export type AiFinishReasonCountsView = Readonly<Record<AiFinishReason, number>>;

export interface AiLifecycleMetricsView {
	readonly started: number;
	readonly active: number;
	readonly outcomes: AiMetricOutcomesView;
	readonly abandoned: AiMetricAbandonedView;
	readonly durationMs: AiMetricDistributionView;
}

export interface AiOperationMetricsView extends AiLifecycleMetricsView {
	readonly usage: AiUsageMetricsView;
	readonly finishReasons: AiFinishReasonCountsView;
}

export interface AiModelPerformanceMetricsView {
	readonly timeToFirstOutputMs: AiMetricDistributionView;
	readonly effectiveOutputTokensPerSecond: AiMetricDistributionView;
	readonly outputTokensPerSecond: AiMetricDistributionView;
	readonly inputTokensPerSecond: AiMetricDistributionView;
	readonly effectiveTotalTokensPerSecond: AiMetricDistributionView;
}

export interface AiModelMetricsView extends AiLifecycleMetricsView {
	readonly usage: AiUsageMetricsView;
	readonly finishReasons: AiFinishReasonCountsView;
	readonly performance: AiModelPerformanceMetricsView;
}

/** Rolling buckets contain event counts and distributions, not point-in-time gauges. */
export type AiWindowLifecycleMetricsView = Omit<AiLifecycleMetricsView, "active">;

export interface AiWindowOperationMetricsView extends AiWindowLifecycleMetricsView {
	readonly usage: AiUsageMetricsView;
	readonly finishReasons: AiFinishReasonCountsView;
}

export interface AiWindowModelMetricsView extends AiWindowLifecycleMetricsView {
	readonly usage: AiUsageMetricsView;
	readonly finishReasons: AiFinishReasonCountsView;
	readonly performance: AiModelPerformanceMetricsView;
}

export interface AiObservabilityTotalsView {
	readonly operations: AiOperationMetricsView;
	readonly steps: AiLifecycleMetricsView;
	readonly modelCalls: AiModelMetricsView;
	readonly toolExecutions: AiLifecycleMetricsView;
	readonly embeddingCalls: AiModelMetricsView;
	readonly rerankingCalls: AiModelMetricsView;
}

export interface AiObservabilityBucketView {
	readonly startedAt: string;
	readonly operations: AiWindowOperationMetricsView;
	readonly steps: AiWindowLifecycleMetricsView;
	readonly modelCalls: AiWindowModelMetricsView;
	readonly toolExecutions: AiWindowLifecycleMetricsView;
	readonly embeddingCalls: AiWindowModelMetricsView;
	readonly rerankingCalls: AiWindowModelMetricsView;
}

export interface AiOperationGroupView extends AiOperationMetricsView {
	readonly source: string;
	readonly operation: string;
	readonly functionId?: string;
	readonly overflow: boolean;
}

export interface AiModelGroupView extends AiModelMetricsView {
	readonly source: string;
	readonly modality: AiModelModality;
	readonly provider: string;
	readonly model: string;
	readonly overflow: boolean;
}

export interface AiToolGroupView extends AiLifecycleMetricsView {
	readonly source: string;
	readonly tool: string;
	readonly overflow: boolean;
}

export interface AiCollectorDiscardedEventsView {
	readonly unsupportedVersion: number;
	readonly invalid: number;
	readonly duplicate: number;
	readonly conflict: number;
	readonly orphanTerminal: number;
	readonly terminalAfterAbandonment: number;
	readonly beforeCollectorStart: number;
	readonly future: number;
}

export interface AiCollectorRejectedFieldsView {
	readonly dimension: number;
	readonly duration: number;
	readonly usage: number;
	readonly performance: number;
}

export interface AiCollectorGroupDiagnosticsView {
	readonly retained: number;
	readonly concrete: number;
	readonly limit: number;
	readonly eventsFolded: number;
	readonly truncated: boolean;
}

export interface AiCollectorDiagnosticsView {
	readonly events: {
		readonly received: number;
		readonly applied: number;
		readonly discarded: AiCollectorDiscardedEventsView;
		/** Applied to lifetime totals but outside the rolling window. */
		readonly outsideWindow: number;
		readonly rejectedFields: AiCollectorRejectedFieldsView;
	};
	readonly active: {
		readonly tracked: number;
		readonly limit: number;
		readonly ttlSeconds: number;
		readonly abandoned: AiMetricAbandonedView;
	};
	readonly replayProtection: {
		readonly retained: number;
		readonly limit: number;
		readonly ttlSeconds: number;
		readonly evicted: number;
	};
	readonly groups: {
		readonly operations: AiCollectorGroupDiagnosticsView;
		readonly models: AiCollectorGroupDiagnosticsView;
		readonly tools: AiCollectorGroupDiagnosticsView;
	};
	readonly clockRegressions: number;
	readonly counterSaturated: boolean;
}

export interface AiSignalCoverageView {
	readonly started: number;
	readonly completed: number;
	readonly abandoned: number;
}

export interface AiObservabilityCoverageView {
	/** The v1 collector never retains model or tool content. */
	readonly contentCaptured: false;
	readonly signals: {
		readonly operations: AiSignalCoverageView;
		readonly steps: AiSignalCoverageView;
		readonly modelCalls: AiSignalCoverageView;
		readonly toolExecutions: AiSignalCoverageView;
		readonly embeddingCalls: AiSignalCoverageView;
		readonly rerankingCalls: AiSignalCoverageView;
	};
}

export interface AiObservabilitySnapshotV1 {
	readonly schemaVersion: typeof AI_OBSERVABILITY_SNAPSHOT_SCHEMA_VERSION;
	readonly scope: "process";
	readonly startedAt: string;
	readonly capturedAt: string;
	readonly revision: number;
	readonly totals: AiObservabilityTotalsView;
	readonly window: {
		readonly bucketSeconds: number;
		readonly maxBuckets: number;
		readonly buckets: readonly AiObservabilityBucketView[];
	};
	readonly operations: readonly AiOperationGroupView[];
	readonly models: readonly AiModelGroupView[];
	readonly tools: readonly AiToolGroupView[];
	readonly coverage: AiObservabilityCoverageView;
	readonly collector: AiCollectorDiagnosticsView;
}

export const AI_OBSERVABILITY_OUTCOMES: readonly AiObservabilityOutcome[] = Object.freeze([
	"success",
	"error",
	"aborted",
]);
