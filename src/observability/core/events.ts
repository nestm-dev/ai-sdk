export const AI_OBSERVABILITY_EVENT_SCHEMA_VERSION = 1 as const;

export type AiObservabilityClock = () => number;
export type AiObservabilityMaybePromise<T> = T | PromiseLike<T>;

export type AiObservabilityOutcome = "success" | "error" | "aborted";
export type AiModelModality = "language" | "embedding" | "reranking" | "other";
export type AiFinishReason =
	"stop" | "length" | "content-filter" | "tool-calls" | "error" | "other" | "unknown";

/** Content-free, normalized token usage. Raw provider usage is intentionally absent. */
export interface AiTokenUsage {
	readonly inputTokens?: number;
	readonly noCacheInputTokens?: number;
	readonly cacheReadInputTokens?: number;
	readonly cacheWriteInputTokens?: number;
	readonly outputTokens?: number;
	readonly textOutputTokens?: number;
	readonly reasoningOutputTokens?: number;
	readonly totalTokens?: number;
	readonly embeddingTokens?: number;
}

/** Content-free performance fields supported by AI SDK 7 and other adapters. */
export interface AiModelPerformance {
	readonly timeToFirstOutputMs?: number;
	readonly effectiveOutputTokensPerSecond?: number;
	readonly outputTokensPerSecond?: number;
	readonly inputTokensPerSecond?: number;
	readonly effectiveTotalTokensPerSecond?: number;
}

export interface AiObservabilityEventBase {
	readonly schemaVersion: typeof AI_OBSERVABILITY_EVENT_SCHEMA_VERSION;
	/** Stable identifier for replay protection. It is never exposed in snapshots. */
	readonly eventId: string;
	/** Identifies this operation, step, model call, tool execution, or model sub-call. */
	readonly entityId: string;
	/** Identifies the outer logical AI operation. It is never exposed in snapshots. */
	readonly operationId: string;
	/** Stable adapter name, for example `ai-sdk`. */
	readonly source: string;
	/** Unix epoch milliseconds. */
	readonly timestamp: number;
	/** Optional lifecycle parent used only for bounded in-flight correlation. */
	readonly parentEntityId?: string;
}

export interface AiOperationStartedEvent extends AiObservabilityEventBase {
	readonly type: "operation.started";
	/** Stable operation name such as `generate-text`, `stream-text`, or `embed-many`. */
	readonly operation: string;
	readonly functionId?: string;
	readonly provider?: string;
	readonly model?: string;
	readonly streaming?: boolean;
}

export interface AiOperationCompletedEvent extends AiObservabilityEventBase {
	readonly type: "operation.completed";
	readonly outcome: AiObservabilityOutcome;
	readonly durationMs?: number;
	readonly finishReason?: AiFinishReason;
	/** Operation-level usage. It is aggregated separately from model-call usage. */
	readonly usage?: AiTokenUsage;
	readonly stepCount?: number;
}

/**
 * Reclassifies a successful operation when post-processing fails after an
 * upstream runtime has already emitted its terminal callback.
 */
export interface AiOperationOutcomeCorrectedEvent extends AiObservabilityEventBase {
	readonly type: "operation.outcome-corrected";
	readonly outcome: Extract<AiObservabilityOutcome, "error" | "aborted">;
}

export interface AiStepStartedEvent extends AiObservabilityEventBase {
	readonly type: "step.started";
	readonly stepNumber: number;
	readonly provider?: string;
	readonly model?: string;
}

export interface AiStepCompletedEvent extends AiObservabilityEventBase {
	readonly type: "step.completed";
	readonly outcome: AiObservabilityOutcome;
	readonly durationMs?: number;
	readonly finishReason?: AiFinishReason;
}

export interface AiModelStartedEvent extends AiObservabilityEventBase {
	readonly type: "model.started";
	readonly provider: string;
	readonly model: string;
	readonly streaming: boolean;
}

export interface AiModelCompletedEvent extends AiObservabilityEventBase {
	readonly type: "model.completed";
	readonly outcome: AiObservabilityOutcome;
	readonly durationMs?: number;
	readonly finishReason?: AiFinishReason;
	readonly usage?: AiTokenUsage;
	readonly performance?: AiModelPerformance;
}

export interface AiToolStartedEvent extends AiObservabilityEventBase {
	readonly type: "tool.started";
	readonly toolName: string;
	readonly dynamic?: boolean;
	readonly providerExecuted?: boolean;
}

export interface AiToolCompletedEvent extends AiObservabilityEventBase {
	readonly type: "tool.completed";
	readonly outcome: AiObservabilityOutcome;
	readonly durationMs?: number;
}

export interface AiEmbeddingStartedEvent extends AiObservabilityEventBase {
	readonly type: "embedding.started";
	readonly provider: string;
	readonly model: string;
	readonly batchSize: number;
}

export interface AiEmbeddingCompletedEvent extends AiObservabilityEventBase {
	readonly type: "embedding.completed";
	readonly outcome: AiObservabilityOutcome;
	readonly durationMs?: number;
	readonly usage?: Pick<AiTokenUsage, "embeddingTokens">;
}

export interface AiRerankingStartedEvent extends AiObservabilityEventBase {
	readonly type: "reranking.started";
	readonly provider: string;
	readonly model: string;
	readonly documentCount: number;
}

export interface AiRerankingCompletedEvent extends AiObservabilityEventBase {
	readonly type: "reranking.completed";
	readonly outcome: AiObservabilityOutcome;
	readonly durationMs?: number;
	readonly resultCount?: number;
}

export type AiObservabilityEvent =
	| AiOperationStartedEvent
	| AiOperationCompletedEvent
	| AiOperationOutcomeCorrectedEvent
	| AiStepStartedEvent
	| AiStepCompletedEvent
	| AiModelStartedEvent
	| AiModelCompletedEvent
	| AiToolStartedEvent
	| AiToolCompletedEvent
	| AiEmbeddingStartedEvent
	| AiEmbeddingCompletedEvent
	| AiRerankingStartedEvent
	| AiRerankingCompletedEvent;

export interface AiObservabilitySink {
	record(events: readonly AiObservabilityEvent[]): AiObservabilityMaybePromise<void>;
}
