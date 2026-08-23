import type {
	AiFinishReason,
	AiModelModality,
	AiModelPerformance,
	AiObservabilityClock,
	AiObservabilityEvent,
	AiObservabilityOutcome,
	AiObservabilitySink,
	AiTokenUsage,
} from "./events.ts";
import { AI_OBSERVABILITY_EVENT_SCHEMA_VERSION } from "./events.ts";
import {
	AI_OBSERVABILITY_ACTIVE_TTL_MS,
	AI_OBSERVABILITY_BUCKET_COUNT,
	AI_OBSERVABILITY_BUCKET_MS,
	AI_OBSERVABILITY_DURATION_BOUNDS_MS,
	AI_OBSERVABILITY_MAX_ACTIVE_ENTITIES,
	AI_OBSERVABILITY_MAX_MODEL_GROUPS,
	AI_OBSERVABILITY_MAX_OPERATION_GROUPS,
	AI_OBSERVABILITY_MAX_REPLAY_ENTRIES,
	AI_OBSERVABILITY_MAX_TOOL_GROUPS,
	AI_OBSERVABILITY_RATE_BOUNDS_PER_SECOND,
	AI_OBSERVABILITY_REPLAY_TTL_MS,
	AI_OBSERVABILITY_SNAPSHOT_SCHEMA_VERSION,
	type AiCollectorDiagnosticsView,
	type AiCollectorGroupDiagnosticsView,
	type AiLifecycleMetricsView,
	type AiMetricDistributionView,
	type AiModelGroupView,
	type AiModelMetricsView,
	type AiModelPerformanceMetricsView,
	type AiObservabilityBucketView,
	type AiObservabilitySnapshotV1,
	type AiObservabilityTotalsView,
	type AiOperationGroupView,
	type AiOperationMetricsView,
	type AiToolGroupView,
	type AiTokenTotalsView,
	type AiUsageMetricsView,
	type AiWindowLifecycleMetricsView,
	type AiWindowModelMetricsView,
	type AiWindowOperationMetricsView,
} from "./snapshot.ts";

const MAX_SAFE_COUNT = Number.MAX_SAFE_INTEGER;
const MAX_FOUR_DIGIT_YEAR_TIMESTAMP_MS = 253_402_300_799_999;
const MAX_FUTURE_SKEW_MS = 1_000;
const MAX_DURATION_MS = 24 * 60 * 60_000;
const MAX_TOKEN_VALUE = 1_000_000_000_000;
const MAX_RATE_VALUE = 1_000_000_000;
const MAX_DIMENSION_LENGTH = 128;
const MAX_ID_LENGTH = 256;
const MAX_GROUPS_HARD_LIMIT = 1_000;
const MAX_ACTIVE_HARD_LIMIT = 65_536;
const MAX_REPLAY_HARD_LIMIT = 131_072;
const MAX_TTL_MS = 24 * 60 * 60_000;
const DIMENSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,127}$/;

const TOKEN_FIELDS = Object.freeze([
	"inputTokens",
	"noCacheInputTokens",
	"cacheReadInputTokens",
	"cacheWriteInputTokens",
	"outputTokens",
	"textOutputTokens",
	"reasoningOutputTokens",
	"totalTokens",
	"embeddingTokens",
] as const);

const FINISH_REASONS = new Set<AiFinishReason>([
	"stop",
	"length",
	"content-filter",
	"tool-calls",
	"error",
	"other",
	"unknown",
]);

type TokenField = (typeof TOKEN_FIELDS)[number];
type EntityKind = "operation" | "step" | "model" | "tool" | "embedding" | "reranking";
type AbandonmentReason = "ttl" | "capacity" | "parent";
type StartedEvent = Extract<AiObservabilityEvent, { type: `${string}.started` }>;
type CompletedEvent = Extract<AiObservabilityEvent, { type: `${string}.completed` }>;

export interface InMemoryAiObservabilityOptions {
	/** Deterministic Unix-epoch millisecond clock. */
	readonly clock?: AiObservabilityClock;
	readonly activeTtlMs?: number;
	readonly maxActiveEntities?: number;
	readonly replayTtlMs?: number;
	readonly maxReplayEntries?: number;
	readonly maxOperationGroups?: number;
	readonly maxModelGroups?: number;
	readonly maxToolGroups?: number;
}

interface ResolvedOptions {
	readonly activeTtlMs: number;
	readonly maxActiveEntities: number;
	readonly replayTtlMs: number;
	readonly maxReplayEntries: number;
	readonly maxOperationGroups: number;
	readonly maxModelGroups: number;
	readonly maxToolGroups: number;
}

interface MutableOutcomes {
	success: number;
	error: number;
	aborted: number;
}

interface MutableAbandoned {
	ttl: number;
	capacity: number;
	parent: number;
}

interface MutableDistribution {
	count: number;
	sum: number;
	max: number;
	readonly bins: number[];
	readonly bounds: readonly number[];
}

type MutableTokenTotals = Record<TokenField, number>;

interface MutableUsage {
	readonly totals: MutableTokenTotals;
	readonly samples: MutableTokenTotals;
}

interface MutablePerformance {
	readonly timeToFirstOutputMs: MutableDistribution;
	readonly effectiveOutputTokensPerSecond: MutableDistribution;
	readonly outputTokensPerSecond: MutableDistribution;
	readonly inputTokensPerSecond: MutableDistribution;
	readonly effectiveTotalTokensPerSecond: MutableDistribution;
}

interface MutableAggregate {
	started: number;
	active: number;
	readonly outcomes: MutableOutcomes;
	readonly abandoned: MutableAbandoned;
	readonly durationMs: MutableDistribution;
	readonly usage: MutableUsage;
	readonly finishReasons: Record<AiFinishReason, number>;
	readonly performance: MutablePerformance;
}

interface MutableTotals {
	readonly operations: MutableAggregate;
	readonly steps: MutableAggregate;
	readonly modelCalls: MutableAggregate;
	readonly toolExecutions: MutableAggregate;
	readonly embeddingCalls: MutableAggregate;
	readonly rerankingCalls: MutableAggregate;
}

interface BucketSlot {
	startMs: number;
	totals: MutableTotals;
}

interface OperationDimension {
	readonly source: string;
	readonly operation: string;
	readonly functionId?: string;
	readonly overflow: boolean;
}

interface ModelDimension {
	readonly source: string;
	readonly modality: AiModelModality;
	readonly provider: string;
	readonly model: string;
	readonly overflow: boolean;
}

interface ToolDimension {
	readonly source: string;
	readonly tool: string;
	readonly overflow: boolean;
}

interface GroupEntry<DIMENSION> {
	readonly dimension: DIMENSION;
	readonly aggregate: MutableAggregate;
}

interface GroupRegistry<DIMENSION> {
	readonly entries: Map<string, GroupEntry<DIMENSION>>;
	readonly limit: number;
	concrete: number;
	eventsFolded: number;
}

interface ActiveEntity {
	readonly key: string;
	readonly kind: EntityKind;
	readonly operationId: string;
	readonly entityId: string;
	readonly parentKey?: string;
	readonly signature: string;
	readonly aggregates: readonly MutableAggregate[];
	readonly startedAt: number;
	lastSeenAt: number;
}

interface OperationCorrectionState {
	readonly source: string;
	readonly aggregates: readonly MutableAggregate[];
	readonly terminalBucketStartMs?: number;
	readonly outcome: AiObservabilityOutcome;
	readonly finishReason?: AiFinishReason;
}

type ReplayEntry =
	| { readonly kind: "event"; readonly seenAt: number }
	| {
			readonly kind: "entity";
			readonly seenAt: number;
			readonly state: "completed" | "abandoned" | "orphan";
			readonly fingerprint?: string;
			readonly operationCorrection?: OperationCorrectionState;
	  };

interface MutableDiagnostics {
	eventsReceived: number;
	eventsApplied: number;
	readonly discarded: {
		unsupportedVersion: number;
		invalid: number;
		duplicate: number;
		conflict: number;
		orphanTerminal: number;
		terminalAfterAbandonment: number;
		beforeCollectorStart: number;
		future: number;
	};
	outsideWindow: number;
	readonly rejectedFields: {
		dimension: number;
		duration: number;
		usage: number;
		performance: number;
	};
	readonly activeAbandoned: MutableAbandoned;
	replayEvicted: number;
	clockRegressions: number;
	counterSaturated: boolean;
}

interface NormalizedTerminalDetails {
	readonly usage?: AiTokenUsage;
	readonly finishReason?: AiFinishReason;
	readonly performance?: AiModelPerformance;
}

interface ProjectedDimension<DIMENSION> {
	readonly dimension: DIMENSION;
	readonly lossy: boolean;
}

/**
 * Process-local, fixed-memory metrics collector. It never stores prompts,
 * outputs, tool arguments/results, raw errors, provider metadata, or arbitrary
 * attributes. Correlation identifiers live only in bounded replay/in-flight maps.
 */
export class InMemoryAiObservabilityCollector implements AiObservabilitySink {
	readonly #clock: AiObservabilityClock;
	readonly #options: ResolvedOptions;
	readonly #startedAtMs: number;
	#lastNowMs: number;
	#revision = 0;
	readonly #totals = mutableTotals();
	readonly #buckets: Array<BucketSlot | undefined> = Array.from({
		length: AI_OBSERVABILITY_BUCKET_COUNT,
	});
	readonly #operations: GroupRegistry<OperationDimension>;
	readonly #models: GroupRegistry<ModelDimension>;
	readonly #tools: GroupRegistry<ToolDimension>;
	readonly #active = new Map<string, ActiveEntity>();
	readonly #childrenByParent = new Map<string, Set<string>>();
	readonly #replay = new Map<string, ReplayEntry>();
	readonly #diagnostics: MutableDiagnostics = {
		eventsReceived: 0,
		eventsApplied: 0,
		discarded: {
			unsupportedVersion: 0,
			invalid: 0,
			duplicate: 0,
			conflict: 0,
			orphanTerminal: 0,
			terminalAfterAbandonment: 0,
			beforeCollectorStart: 0,
			future: 0,
		},
		outsideWindow: 0,
		rejectedFields: { dimension: 0, duration: 0, usage: 0, performance: 0 },
		activeAbandoned: { ttl: 0, capacity: 0, parent: 0 },
		replayEvicted: 0,
		clockRegressions: 0,
		counterSaturated: false,
	};

	constructor(options: InMemoryAiObservabilityOptions = {}) {
		if (options.clock !== undefined && typeof options.clock !== "function") {
			throw new TypeError("clock must be a function.");
		}
		this.#clock = options.clock ?? Date.now;
		this.#options = resolveOptions(options);
		this.#startedAtMs = readTimestamp(this.#clock);
		this.#lastNowMs = this.#startedAtMs;
		this.#operations = groupRegistry(this.#options.maxOperationGroups);
		this.#models = groupRegistry(this.#options.maxModelGroups);
		this.#tools = groupRegistry(this.#options.maxToolGroups);
	}

	record(events: readonly AiObservabilityEvent[]): void {
		for (const event of events) this.#recordOne(event);
	}

	snapshot(): AiObservabilitySnapshotV1 {
		const capturedAtMs = this.#now();
		this.#expireActive(capturedAtMs);
		this.#pruneReplay(capturedAtMs);
		const snapshot: AiObservabilitySnapshotV1 = {
			schemaVersion: AI_OBSERVABILITY_SNAPSHOT_SCHEMA_VERSION,
			scope: "process",
			startedAt: toIsoTimestamp(this.#startedAtMs),
			capturedAt: toIsoTimestamp(capturedAtMs),
			revision: this.#revision,
			totals: totalsView(this.#totals),
			window: {
				bucketSeconds: AI_OBSERVABILITY_BUCKET_MS / 1_000,
				maxBuckets: AI_OBSERVABILITY_BUCKET_COUNT,
				buckets: this.#bucketViews(capturedAtMs),
			},
			operations: [...this.#operations.entries.values()]
				.map(({ dimension, aggregate }) => ({ ...dimension, ...operationView(aggregate) }))
				.toSorted(compareOperationGroups),
			models: [...this.#models.entries.values()]
				.map(({ dimension, aggregate }) => ({ ...dimension, ...modelView(aggregate) }))
				.toSorted(compareModelGroups),
			tools: [...this.#tools.entries.values()]
				.map(({ dimension, aggregate }) => ({ ...dimension, ...lifecycleView(aggregate) }))
				.toSorted(compareToolGroups),
			coverage: {
				contentCaptured: false,
				signals: {
					operations: signalCoverage(this.#totals.operations),
					steps: signalCoverage(this.#totals.steps),
					modelCalls: signalCoverage(this.#totals.modelCalls),
					toolExecutions: signalCoverage(this.#totals.toolExecutions),
					embeddingCalls: signalCoverage(this.#totals.embeddingCalls),
					rerankingCalls: signalCoverage(this.#totals.rerankingCalls),
				},
			},
			collector: this.#collectorView(),
		};
		return deepFreeze(snapshot);
	}

	#recordOne(event: AiObservabilityEvent): void {
		const now = this.#now();
		this.#expireActive(now);
		this.#pruneReplay(now);
		this.#incrementDiagnostic("eventsReceived");

		if (!event || typeof event !== "object") {
			this.#discard("invalid");
			return;
		}
		if (event.schemaVersion !== AI_OBSERVABILITY_EVENT_SCHEMA_VERSION) {
			this.#discard("unsupportedVersion");
			return;
		}
		if (
			!validIdentifier(event.eventId) ||
			!validIdentifier(event.entityId) ||
			!validIdentifier(event.operationId) ||
			typeof event.source !== "string" ||
			(event.parentEntityId !== undefined && !validIdentifier(event.parentEntityId))
		) {
			this.#discard("invalid");
			return;
		}

		if (!validTimestamp(event.timestamp)) {
			this.#discard("invalid");
			return;
		}
		if (event.timestamp < this.#startedAtMs) {
			this.#discard("beforeCollectorStart");
			return;
		}
		if (event.timestamp > now + MAX_FUTURE_SKEW_MS) {
			this.#discard("future");
			return;
		}
		const effectiveTimestamp = Math.min(event.timestamp, now);
		if (!this.#validLifecycleShape(event)) {
			this.#discard("invalid");
			return;
		}

		const eventReplayKey = replayEventKey(event.eventId);
		if (this.#replay.has(eventReplayKey)) {
			this.#discard("duplicate");
			return;
		}
		this.#rememberReplay(eventReplayKey, { kind: "event", seenAt: now });

		switch (event.type) {
			case "operation.started":
			case "step.started":
			case "model.started":
			case "tool.started":
			case "embedding.started":
			case "reranking.started":
				this.#recordStarted(event, effectiveTimestamp, now);
				return;
			case "operation.completed":
			case "step.completed":
			case "model.completed":
			case "tool.completed":
			case "embedding.completed":
			case "reranking.completed":
				this.#recordCompleted(event, effectiveTimestamp, now);
				return;
			case "operation.outcome-corrected":
				this.#recordOperationCorrection(event, now);
				return;
			default:
				this.#discard("invalid");
		}
	}

	#validLifecycleShape(event: AiObservabilityEvent): boolean {
		switch (event.type) {
			case "operation.started":
			case "step.started":
			case "model.started":
			case "tool.started":
			case "embedding.started":
			case "reranking.started":
				return (
					this.#validStartedEvent(event) &&
					(event.parentEntityId === undefined || event.parentEntityId !== event.entityId)
				);
			case "operation.completed":
			case "step.completed":
			case "model.completed":
			case "tool.completed":
			case "embedding.completed":
			case "reranking.completed":
				return validOutcome(event.outcome);
			case "operation.outcome-corrected":
				return event.outcome === "error" || event.outcome === "aborted";
			default:
				return false;
		}
	}

	#recordStarted(event: StartedEvent, timestamp: number, now: number): void {
		const kind = eventKind(event.type);
		if (!this.#validStartedEvent(event)) {
			this.#discard("invalid");
			return;
		}
		const key = entityKey(event.operationId, event.entityId);
		const projection = this.#projectStartedEvent(event);
		const parentKey =
			event.parentEntityId === undefined
				? undefined
				: entityKey(event.operationId, event.parentEntityId);
		if (parentKey === key) {
			this.#discard("invalid");
			return;
		}
		const signature = JSON.stringify([kind, projection.signature, parentKey ?? null]);
		const current = this.#active.get(key);
		if (current !== undefined) {
			this.#discard(current.signature === signature ? "duplicate" : "conflict");
			return;
		}
		const tombstone = this.#replay.get(replayEntityKey(key));
		if (tombstone?.kind === "entity") {
			this.#discard("duplicate");
			return;
		}

		const protectedAncestors =
			parentKey === undefined ? new Set<string>() : this.#touchAncestors(parentKey, now);
		const admitted = this.#ensureActiveCapacity(timestamp, now, protectedAncestors);
		const groupAggregate = projection.group();
		const aggregate = totalAggregate(this.#totals, kind);
		const aggregates = groupAggregate === undefined ? [aggregate] : [aggregate, groupAggregate];
		for (const target of aggregates) this.#incrementStarted(target);
		const bucket = this.#bucket(timestamp, now);
		if (bucket === undefined) this.#incrementDiagnostic("outsideWindow");
		else incrementStartedPlain(totalAggregate(bucket, kind));

		const active: ActiveEntity = {
			key,
			kind,
			operationId: event.operationId,
			entityId: event.entityId,
			...(parentKey === undefined ? {} : { parentKey }),
			signature,
			aggregates,
			startedAt: timestamp,
			lastSeenAt: now,
		};
		this.#active.set(key, active);
		if (parentKey !== undefined) this.#linkChild(parentKey, key);
		if (!admitted) this.#abandon(active, "capacity", timestamp, now);
		this.#incrementDiagnostic("eventsApplied");
	}

	#recordCompleted(event: CompletedEvent, timestamp: number, now: number): void {
		if (!validOutcome(event.outcome)) {
			this.#discard("invalid");
			return;
		}
		const kind = eventKind(event.type);
		const key = entityKey(event.operationId, event.entityId);
		const active = this.#active.get(key);
		const fingerprint = JSON.stringify([kind, event.outcome]);
		if (active === undefined) {
			const tombstone = this.#replay.get(replayEntityKey(key));
			if (tombstone?.kind === "entity") {
				if (tombstone.state === "abandoned") {
					this.#discard("terminalAfterAbandonment");
				} else {
					this.#discard(
						tombstone.fingerprint === undefined || tombstone.fingerprint === fingerprint
							? "duplicate"
							: "conflict",
					);
				}
				return;
			}
			this.#rememberReplay(replayEntityKey(key), {
				kind: "entity",
				seenAt: now,
				state: "orphan",
				fingerprint,
			});
			this.#discard("orphanTerminal");
			return;
		}
		if (active.kind !== kind) {
			this.#discard("conflict");
			return;
		}
		const terminalSource = this.#projectDimension(event.source);
		const startedSource = JSON.parse(active.signature)[1]?.[0] as unknown;
		if (typeof startedSource === "string" && terminalSource !== startedSource) {
			this.#discard("conflict");
			return;
		}

		const durationMs = this.#terminalDuration(event, active, timestamp);
		const details = this.#normalizeTerminalDetails(event);
		for (const target of active.aggregates) {
			this.#incrementTerminal(target, event.outcome, durationMs);
			this.#recordTerminalDetails(target, details);
		}
		const bucket = this.#bucket(timestamp, now);
		let terminalBucketStartMs: number | undefined;
		if (bucket === undefined) this.#incrementDiagnostic("outsideWindow");
		else {
			terminalBucketStartMs = bucketStart(timestamp);
			const target = totalAggregate(bucket, kind);
			incrementTerminalPlain(target, event.outcome, durationMs);
			this.#recordTerminalDetails(target, details);
		}

		this.#active.delete(key);
		this.#unlinkChild(active);
		this.#rememberReplay(replayEntityKey(key), {
			kind: "entity",
			seenAt: now,
			state: "completed",
			fingerprint,
			...(kind !== "operation"
				? {}
				: {
						operationCorrection: {
							source: terminalSource,
							aggregates: active.aggregates,
							...(terminalBucketStartMs === undefined ? {} : { terminalBucketStartMs }),
							outcome: event.outcome,
							...(details.finishReason === undefined ? {} : { finishReason: details.finishReason }),
						} satisfies OperationCorrectionState,
					}),
		});
		if (active.parentKey !== undefined) this.#touchAncestors(active.parentKey, now);
		this.#abandonChildren(key, "parent", timestamp, now);
		this.#incrementDiagnostic("eventsApplied");
	}

	#recordOperationCorrection(
		event: Extract<AiObservabilityEvent, { type: "operation.outcome-corrected" }>,
		now: number,
	): void {
		const key = entityKey(event.operationId, event.entityId);
		const tombstone = this.#replay.get(replayEntityKey(key));
		if (tombstone?.kind !== "entity") {
			this.#discard("orphanTerminal");
			return;
		}
		if (tombstone.state === "abandoned") {
			this.#discard("terminalAfterAbandonment");
			return;
		}
		const correction = tombstone.operationCorrection;
		if (tombstone.state !== "completed" || correction === undefined) {
			this.#discard("conflict");
			return;
		}
		if (this.#projectDimension(event.source) !== correction.source) {
			this.#discard("conflict");
			return;
		}
		if (correction.outcome === event.outcome) {
			this.#discard("duplicate");
			return;
		}
		if (correction.outcome !== "success") {
			this.#discard("conflict");
			return;
		}

		const correctedFinishReason = event.outcome === "error" ? "error" : undefined;
		for (const aggregate of correction.aggregates) {
			replaceOutcome(aggregate, correction.outcome, event.outcome);
			replaceFinishReason(aggregate, correction.finishReason, correctedFinishReason);
		}
		const originalBucketStartMs = correction.terminalBucketStartMs;
		if (originalBucketStartMs !== undefined) {
			const slot = this.#buckets[bucketIndex(originalBucketStartMs)];
			if (slot?.startMs === originalBucketStartMs) {
				const aggregate = totalAggregate(slot.totals, "operation");
				replaceOutcome(aggregate, correction.outcome, event.outcome);
				replaceFinishReason(aggregate, correction.finishReason, correctedFinishReason);
			}
		}

		const corrected: OperationCorrectionState = {
			...correction,
			outcome: event.outcome,
			...(correctedFinishReason === undefined
				? { finishReason: undefined }
				: { finishReason: correctedFinishReason }),
		};
		this.#rememberReplay(replayEntityKey(key), {
			...tombstone,
			seenAt: now,
			fingerprint: JSON.stringify(["operation", event.outcome]),
			operationCorrection: corrected,
		});
		this.#incrementDiagnostic("eventsApplied");
	}

	#validStartedEvent(event: StartedEvent): boolean {
		switch (event.type) {
			case "operation.started":
				return (
					typeof event.operation === "string" &&
					(event.functionId === undefined || typeof event.functionId === "string") &&
					(event.provider === undefined || typeof event.provider === "string") &&
					(event.model === undefined || typeof event.model === "string") &&
					(event.streaming === undefined || typeof event.streaming === "boolean")
				);
			case "step.started":
				return (
					Number.isSafeInteger(event.stepNumber) &&
					event.stepNumber >= 0 &&
					(event.provider === undefined || typeof event.provider === "string") &&
					(event.model === undefined || typeof event.model === "string")
				);
			case "model.started":
				return (
					typeof event.provider === "string" &&
					typeof event.model === "string" &&
					typeof event.streaming === "boolean"
				);
			case "tool.started":
				return (
					typeof event.toolName === "string" &&
					(event.dynamic === undefined || typeof event.dynamic === "boolean") &&
					(event.providerExecuted === undefined || typeof event.providerExecuted === "boolean")
				);
			case "embedding.started":
				return (
					typeof event.provider === "string" &&
					typeof event.model === "string" &&
					Number.isSafeInteger(event.batchSize) &&
					event.batchSize >= 0
				);
			case "reranking.started":
				return (
					typeof event.provider === "string" &&
					typeof event.model === "string" &&
					Number.isSafeInteger(event.documentCount) &&
					event.documentCount >= 0
				);
		}
		return false;
	}

	#projectStartedEvent(event: StartedEvent): {
		readonly signature: readonly unknown[];
		readonly group: () => MutableAggregate | undefined;
	} {
		const source = this.#projectDimension(event.source);
		switch (event.type) {
			case "operation.started": {
				const operation = this.#projectDimension(event.operation);
				const rawFunctionId = event.functionId;
				const functionId =
					rawFunctionId === undefined ? undefined : this.#projectDimension(rawFunctionId);
				const lossy =
					source === "other" && event.source !== "other"
						? true
						: operation === "other" && event.operation !== "other"
							? true
							: rawFunctionId !== undefined && functionId === "other" && rawFunctionId !== "other";
				const projected = {
					dimension: {
						source,
						operation,
						...(functionId === undefined ? {} : { functionId }),
						overflow: false,
					},
					lossy,
				} satisfies ProjectedDimension<OperationDimension>;
				return {
					signature: [source, operation, functionId ?? null],
					group: () => this.#operationAggregate(projected),
				};
			}
			case "model.started":
			case "embedding.started":
			case "reranking.started": {
				const provider = this.#projectDimension(event.provider);
				const model = this.#projectDimension(event.model);
				const modality =
					event.type === "model.started"
						? "language"
						: event.type === "embedding.started"
							? "embedding"
							: "reranking";
				const projected = {
					dimension: { source, modality, provider, model, overflow: false },
					lossy:
						(source === "other" && event.source !== "other") ||
						(provider === "other" && event.provider !== "other") ||
						(model === "other" && event.model !== "other"),
				} satisfies ProjectedDimension<ModelDimension>;
				return {
					signature: [source, modality, provider, model],
					group: () => this.#modelAggregate(projected),
				};
			}
			case "tool.started": {
				const tool = this.#projectDimension(event.toolName);
				const projected = {
					dimension: { source, tool, overflow: false },
					lossy:
						(source === "other" && event.source !== "other") ||
						(tool === "other" && event.toolName !== "other"),
				} satisfies ProjectedDimension<ToolDimension>;
				return {
					signature: [source, tool],
					group: () => this.#toolAggregate(projected),
				};
			}
			case "step.started":
				return { signature: [source, event.stepNumber], group: () => undefined };
		}
		throw new TypeError("Unsupported started event type.");
	}

	#operationAggregate(projected: ProjectedDimension<OperationDimension>): MutableAggregate {
		return this.#resolveGroup(
			this.#operations,
			projected,
			(dimension) =>
				JSON.stringify([dimension.source, dimension.operation, dimension.functionId ?? null]),
			{ source: "other", operation: "other", overflow: true },
		);
	}

	#modelAggregate(projected: ProjectedDimension<ModelDimension>): MutableAggregate {
		return this.#resolveGroup(
			this.#models,
			projected,
			(dimension) =>
				JSON.stringify([dimension.source, dimension.modality, dimension.provider, dimension.model]),
			{
				source: "other",
				modality: "other",
				provider: "other",
				model: "other",
				overflow: true,
			},
		);
	}

	#toolAggregate(projected: ProjectedDimension<ToolDimension>): MutableAggregate {
		return this.#resolveGroup(
			this.#tools,
			projected,
			(dimension) => JSON.stringify([dimension.source, dimension.tool]),
			{ source: "other", tool: "other", overflow: true },
		);
	}

	#resolveGroup<DIMENSION extends { readonly overflow: boolean }>(
		registry: GroupRegistry<DIMENSION>,
		projected: ProjectedDimension<DIMENSION>,
		keyOf: (dimension: DIMENSION) => string,
		overflowDimension: DIMENSION,
	): MutableAggregate {
		const concreteKey = `concrete:${keyOf(projected.dimension)}`;
		if (!projected.lossy) {
			const current = registry.entries.get(concreteKey);
			if (current !== undefined) return current.aggregate;
			const hasOverflow = [...registry.entries.keys()].some((key) => key.startsWith("overflow:"));
			const admissionLimit = hasOverflow ? registry.limit : registry.limit - 1;
			if (registry.entries.size < admissionLimit) {
				const aggregate = mutableAggregate();
				registry.entries.set(concreteKey, { dimension: projected.dimension, aggregate });
				registry.concrete += 1;
				return aggregate;
			}
		}
		registry.eventsFolded = this.#add(registry.eventsFolded, 1);
		const overflowKey = "overflow:all";
		const overflow = registry.entries.get(overflowKey);
		if (overflow !== undefined) return overflow.aggregate;
		if (registry.entries.size >= registry.limit) {
			// Model modalities can each create an overflow row. Fold into the first
			// existing overflow row if a very small configured limit is exhausted.
			const anyOverflow = [...registry.entries.entries()].find(([key]) =>
				key.startsWith("overflow:"),
			);
			if (anyOverflow !== undefined) return anyOverflow[1].aggregate;
		}
		const aggregate = mutableAggregate();
		registry.entries.set(overflowKey, { dimension: overflowDimension, aggregate });
		return aggregate;
	}

	#projectDimension(value: string): string {
		if (value.length <= MAX_DIMENSION_LENGTH && DIMENSION_PATTERN.test(value)) return value;
		this.#incrementRejectedField("dimension");
		return "other";
	}

	#terminalDuration(event: CompletedEvent, active: ActiveEntity, timestamp: number): number {
		if (event.durationMs !== undefined) {
			const normalized = normalizeMetricValue(event.durationMs, MAX_DURATION_MS);
			if (normalized !== undefined) return normalized;
			this.#incrementRejectedField("duration");
		}
		return normalizeMetricValue(Math.max(0, timestamp - active.startedAt), MAX_DURATION_MS) ?? 0;
	}

	#normalizeTerminalDetails(event: CompletedEvent): NormalizedTerminalDetails {
		const usage =
			event.type === "operation.completed" ||
			event.type === "model.completed" ||
			event.type === "embedding.completed"
				? this.#normalizeUsage(event.usage)
				: undefined;
		const finishReason =
			event.type === "operation.completed" || event.type === "model.completed"
				? normalizeFinishReason(event.finishReason)
				: undefined;
		const performance =
			event.type === "model.completed" ? this.#normalizePerformance(event.performance) : undefined;
		return {
			...(usage === undefined ? {} : { usage }),
			...(finishReason === undefined ? {} : { finishReason }),
			...(performance === undefined ? {} : { performance }),
		};
	}

	#normalizeUsage(values: AiTokenUsage | undefined): AiTokenUsage | undefined {
		if (values === undefined) return undefined;
		if (typeof values !== "object" || values === null || Array.isArray(values)) {
			this.#incrementRejectedField("usage");
			return undefined;
		}
		const normalized: Partial<Record<TokenField, number>> = {};
		for (const field of TOKEN_FIELDS) {
			const raw = values[field];
			if (raw === undefined) continue;
			if (!Number.isSafeInteger(raw) || raw < 0 || raw > MAX_TOKEN_VALUE) {
				this.#incrementRejectedField("usage");
				continue;
			}
			normalized[field] = raw;
		}
		return normalized;
	}

	#recordTerminalDetails(aggregate: MutableAggregate, details: NormalizedTerminalDetails): void {
		this.#recordUsage(aggregate.usage, details.usage);
		this.#recordFinishReason(aggregate, details.finishReason);
		this.#recordPerformance(aggregate, details.performance);
	}

	#recordUsage(usage: MutableUsage, values: AiTokenUsage | undefined): void {
		if (values === undefined) return;
		for (const field of TOKEN_FIELDS) {
			const value = values[field];
			if (value === undefined) continue;
			usage.totals[field] = this.#add(usage.totals[field], value);
			usage.samples[field] = this.#add(usage.samples[field], 1);
		}
	}

	#recordFinishReason(aggregate: MutableAggregate, value: AiFinishReason | undefined): void {
		if (value === undefined) return;
		aggregate.finishReasons[value] = this.#add(aggregate.finishReasons[value], 1);
	}

	#normalizePerformance(
		performance: AiModelPerformance | undefined,
	): AiModelPerformance | undefined {
		if (performance === undefined) return undefined;
		if (typeof performance !== "object" || performance === null || Array.isArray(performance)) {
			this.#incrementRejectedField("performance");
			return undefined;
		}
		const normalized: Partial<Record<keyof AiModelPerformance, number>> = {};
		for (const [field, maximum] of [
			["timeToFirstOutputMs", MAX_DURATION_MS],
			["effectiveOutputTokensPerSecond", MAX_RATE_VALUE],
			["outputTokensPerSecond", MAX_RATE_VALUE],
			["inputTokensPerSecond", MAX_RATE_VALUE],
			["effectiveTotalTokensPerSecond", MAX_RATE_VALUE],
		] as const) {
			const value = performance[field];
			if (value === undefined) continue;
			const normalizedValue = normalizeMetricValue(value, maximum);
			if (normalizedValue === undefined) {
				this.#incrementRejectedField("performance");
				continue;
			}
			normalized[field] = normalizedValue;
		}
		return normalized;
	}

	#recordPerformance(
		aggregate: MutableAggregate,
		performance: AiModelPerformance | undefined,
	): void {
		if (performance === undefined) return;
		for (const field of [
			"timeToFirstOutputMs",
			"effectiveOutputTokensPerSecond",
			"outputTokensPerSecond",
			"inputTokensPerSecond",
			"effectiveTotalTokensPerSecond",
		] as const) {
			const value = performance[field];
			if (value !== undefined) this.#recordDistribution(aggregate.performance[field], value);
		}
	}

	#incrementStarted(aggregate: MutableAggregate): void {
		aggregate.started = this.#add(aggregate.started, 1);
		aggregate.active = this.#add(aggregate.active, 1);
	}

	#incrementTerminal(
		aggregate: MutableAggregate,
		outcome: AiObservabilityOutcome,
		durationMs: number,
	): void {
		aggregate.active = Math.max(0, aggregate.active - 1);
		aggregate.outcomes[outcome] = this.#add(aggregate.outcomes[outcome], 1);
		this.#recordDistribution(aggregate.durationMs, durationMs);
	}

	#recordDistribution(distribution: MutableDistribution, value: number): void {
		distribution.count = this.#add(distribution.count, 1);
		distribution.sum = this.#add(distribution.sum, value);
		distribution.max = Math.max(distribution.max, value);
		const index = distribution.bounds.findIndex((bound) => value <= bound);
		const resolved = index === -1 ? distribution.bounds.length - 1 : index;
		distribution.bins[resolved] = this.#add(distribution.bins[resolved] ?? 0, 1);
	}

	#ensureActiveCapacity(
		timestamp: number,
		now: number,
		protectedKeys: ReadonlySet<string>,
	): boolean {
		if (this.#active.size < this.#options.maxActiveEntities) return true;
		for (const candidate of this.#active.values()) {
			if (protectedKeys.has(candidate.key)) continue;
			this.#abandon(candidate, "capacity", timestamp, now);
			return true;
		}
		return false;
	}

	#expireActive(now: number): void {
		while (true) {
			const oldest = this.#active.values().next().value;
			if (oldest === undefined || now - oldest.lastSeenAt < this.#options.activeTtlMs) return;
			this.#abandon(oldest, "ttl", now, now);
		}
	}

	#abandon(entity: ActiveEntity, reason: AbandonmentReason, timestamp: number, now: number): void {
		if (!this.#abandonOne(entity, reason, timestamp, now)) return;
		this.#abandonChildren(entity.key, "parent", timestamp, now);
	}

	#abandonOne(
		entity: ActiveEntity,
		reason: AbandonmentReason,
		timestamp: number,
		now: number,
	): boolean {
		if (!this.#active.delete(entity.key)) return false;
		this.#unlinkChild(entity);
		for (const aggregate of entity.aggregates) {
			aggregate.active = Math.max(0, aggregate.active - 1);
			aggregate.abandoned[reason] = this.#add(aggregate.abandoned[reason], 1);
		}
		const bucket = this.#bucket(timestamp, now);
		if (bucket === undefined) this.#incrementDiagnostic("outsideWindow");
		else {
			const aggregate = totalAggregate(bucket, entity.kind);
			aggregate.abandoned[reason] = this.#add(aggregate.abandoned[reason], 1);
		}
		this.#diagnostics.activeAbandoned[reason] = this.#add(
			this.#diagnostics.activeAbandoned[reason],
			1,
		);
		this.#rememberReplay(replayEntityKey(entity.key), {
			kind: "entity",
			seenAt: now,
			state: "abandoned",
		});
		this.#bumpRevision();
		return true;
	}

	#abandonChildren(
		parentKey: string,
		reason: AbandonmentReason,
		timestamp: number,
		now: number,
	): void {
		const pending = [...(this.#childrenByParent.get(parentKey) ?? [])].toSorted();
		this.#childrenByParent.delete(parentKey);
		const visited = new Set<string>([parentKey]);
		for (let index = 0; index < pending.length; index += 1) {
			const childKey = pending[index];
			if (childKey === undefined || visited.has(childKey)) continue;
			visited.add(childKey);
			pending.push(...[...(this.#childrenByParent.get(childKey) ?? [])].toSorted());
			this.#childrenByParent.delete(childKey);
			const current = this.#active.get(childKey);
			if (current !== undefined) this.#abandonOne(current, reason, timestamp, now);
		}
	}

	#linkChild(parentKey: string, childKey: string): void {
		const children = this.#childrenByParent.get(parentKey);
		if (children === undefined) this.#childrenByParent.set(parentKey, new Set([childKey]));
		else children.add(childKey);
	}

	#unlinkChild(entity: ActiveEntity): void {
		if (entity.parentKey === undefined) return;
		const siblings = this.#childrenByParent.get(entity.parentKey);
		if (siblings === undefined) return;
		siblings.delete(entity.key);
		if (siblings.size === 0) this.#childrenByParent.delete(entity.parentKey);
	}

	#touchAncestors(key: string, now: number): ReadonlySet<string> {
		const touched = new Set<string>();
		let currentKey: string | undefined = key;
		while (currentKey !== undefined && !touched.has(currentKey)) {
			const current = this.#active.get(currentKey);
			if (current === undefined) return touched;
			touched.add(currentKey);
			current.lastSeenAt = now;
			this.#active.delete(currentKey);
			this.#active.set(currentKey, current);
			currentKey = current.parentKey;
		}
		return touched;
	}

	#bucket(timestamp: number, now: number): MutableTotals | undefined {
		const startMs = bucketStart(timestamp);
		const currentStartMs = bucketStart(now);
		const retainedStartMs =
			currentStartMs - (AI_OBSERVABILITY_BUCKET_COUNT - 1) * AI_OBSERVABILITY_BUCKET_MS;
		if (startMs < retainedStartMs || startMs > currentStartMs) return undefined;
		const index = bucketIndex(startMs);
		let slot = this.#buckets[index];
		if (slot?.startMs !== startMs) {
			slot = { startMs, totals: mutableTotals() };
			this.#buckets[index] = slot;
		}
		return slot.totals;
	}

	#bucketViews(capturedAtMs: number): readonly AiObservabilityBucketView[] {
		const currentStartMs = bucketStart(capturedAtMs);
		const retainedStartMs =
			currentStartMs - (AI_OBSERVABILITY_BUCKET_COUNT - 1) * AI_OBSERVABILITY_BUCKET_MS;
		const firstStartMs = Math.max(retainedStartMs, bucketStart(this.#startedAtMs));
		const buckets: AiObservabilityBucketView[] = [];
		for (
			let startMs = firstStartMs;
			startMs <= currentStartMs;
			startMs += AI_OBSERVABILITY_BUCKET_MS
		) {
			const slot = this.#buckets[bucketIndex(startMs)];
			buckets.push({
				startedAt: toIsoTimestamp(Math.max(startMs, this.#startedAtMs)),
				...windowTotalsView(slot?.startMs === startMs ? slot.totals : mutableTotals()),
			});
		}
		return buckets;
	}

	#rememberReplay(key: string, entry: ReplayEntry): void {
		this.#replay.delete(key);
		this.#replay.set(key, entry);
		while (this.#replay.size > this.#options.maxReplayEntries) {
			const oldest = this.#replay.keys().next().value;
			if (oldest === undefined) break;
			this.#replay.delete(oldest);
			this.#diagnostics.replayEvicted = this.#add(this.#diagnostics.replayEvicted, 1);
		}
	}

	#pruneReplay(now: number): void {
		while (true) {
			const first = this.#replay.entries().next().value;
			if (first === undefined || now - first[1].seenAt < this.#options.replayTtlMs) return;
			this.#replay.delete(first[0]);
			this.#diagnostics.replayEvicted = this.#add(this.#diagnostics.replayEvicted, 1);
			this.#bumpRevision();
		}
	}

	#collectorView(): AiCollectorDiagnosticsView {
		return {
			events: {
				received: this.#diagnostics.eventsReceived,
				applied: this.#diagnostics.eventsApplied,
				discarded: { ...this.#diagnostics.discarded },
				outsideWindow: this.#diagnostics.outsideWindow,
				rejectedFields: { ...this.#diagnostics.rejectedFields },
			},
			active: {
				tracked: this.#active.size,
				limit: this.#options.maxActiveEntities,
				ttlSeconds: this.#options.activeTtlMs / 1_000,
				abandoned: { ...this.#diagnostics.activeAbandoned },
			},
			replayProtection: {
				retained: this.#replay.size,
				limit: this.#options.maxReplayEntries,
				ttlSeconds: this.#options.replayTtlMs / 1_000,
				evicted: this.#diagnostics.replayEvicted,
			},
			groups: {
				operations: groupDiagnostics(this.#operations),
				models: groupDiagnostics(this.#models),
				tools: groupDiagnostics(this.#tools),
			},
			clockRegressions: this.#diagnostics.clockRegressions,
			counterSaturated: this.#diagnostics.counterSaturated,
		};
	}

	#discard(reason: keyof MutableDiagnostics["discarded"]): void {
		this.#diagnostics.discarded[reason] = this.#add(this.#diagnostics.discarded[reason], 1);
	}

	#incrementRejectedField(field: keyof MutableDiagnostics["rejectedFields"]): void {
		this.#diagnostics.rejectedFields[field] = this.#add(this.#diagnostics.rejectedFields[field], 1);
	}

	#incrementDiagnostic(field: "eventsReceived" | "eventsApplied" | "outsideWindow"): void {
		this.#diagnostics[field] = this.#add(this.#diagnostics[field], 1);
		if (field === "eventsReceived") this.#bumpRevision();
	}

	#add(current: number, increment: number): number {
		const next = current + increment;
		if (next <= MAX_SAFE_COUNT) return next;
		this.#diagnostics.counterSaturated = true;
		return MAX_SAFE_COUNT;
	}

	#bumpRevision(): void {
		this.#revision = Math.min(MAX_SAFE_COUNT, this.#revision + 1);
	}

	#now(): number {
		const current = readTimestamp(this.#clock);
		if (current >= this.#lastNowMs) {
			this.#lastNowMs = current;
			return current;
		}
		this.#diagnostics.clockRegressions = this.#add(this.#diagnostics.clockRegressions, 1);
		this.#bumpRevision();
		return this.#lastNowMs;
	}
}

function resolveOptions(options: InMemoryAiObservabilityOptions): ResolvedOptions {
	return {
		activeTtlMs: boundedInteger(
			options.activeTtlMs,
			AI_OBSERVABILITY_ACTIVE_TTL_MS,
			1_000,
			MAX_TTL_MS,
			"activeTtlMs",
		),
		maxActiveEntities: boundedInteger(
			options.maxActiveEntities,
			AI_OBSERVABILITY_MAX_ACTIVE_ENTITIES,
			1,
			MAX_ACTIVE_HARD_LIMIT,
			"maxActiveEntities",
		),
		replayTtlMs: boundedInteger(
			options.replayTtlMs,
			AI_OBSERVABILITY_REPLAY_TTL_MS,
			1_000,
			MAX_TTL_MS,
			"replayTtlMs",
		),
		maxReplayEntries: boundedInteger(
			options.maxReplayEntries,
			AI_OBSERVABILITY_MAX_REPLAY_ENTRIES,
			2,
			MAX_REPLAY_HARD_LIMIT,
			"maxReplayEntries",
		),
		maxOperationGroups: boundedInteger(
			options.maxOperationGroups,
			AI_OBSERVABILITY_MAX_OPERATION_GROUPS,
			1,
			MAX_GROUPS_HARD_LIMIT,
			"maxOperationGroups",
		),
		maxModelGroups: boundedInteger(
			options.maxModelGroups,
			AI_OBSERVABILITY_MAX_MODEL_GROUPS,
			1,
			MAX_GROUPS_HARD_LIMIT,
			"maxModelGroups",
		),
		maxToolGroups: boundedInteger(
			options.maxToolGroups,
			AI_OBSERVABILITY_MAX_TOOL_GROUPS,
			1,
			MAX_GROUPS_HARD_LIMIT,
			"maxToolGroups",
		),
	};
}

function boundedInteger(
	value: number | undefined,
	fallback: number,
	minimum: number,
	maximum: number,
	name: string,
): number {
	const resolved = value ?? fallback;
	if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
		throw new RangeError(
			`${name} must be an integer between ${String(minimum)} and ${String(maximum)}.`,
		);
	}
	return resolved;
}

function groupRegistry<DIMENSION>(limit: number): GroupRegistry<DIMENSION> {
	return { entries: new Map(), limit, concrete: 0, eventsFolded: 0 };
}

function mutableTotals(): MutableTotals {
	return {
		operations: mutableAggregate(),
		steps: mutableAggregate(),
		modelCalls: mutableAggregate(),
		toolExecutions: mutableAggregate(),
		embeddingCalls: mutableAggregate(),
		rerankingCalls: mutableAggregate(),
	};
}

function mutableAggregate(): MutableAggregate {
	return {
		started: 0,
		active: 0,
		outcomes: { success: 0, error: 0, aborted: 0 },
		abandoned: { ttl: 0, capacity: 0, parent: 0 },
		durationMs: mutableDistribution(AI_OBSERVABILITY_DURATION_BOUNDS_MS),
		usage: { totals: mutableTokenTotals(), samples: mutableTokenTotals() },
		finishReasons: {
			stop: 0,
			length: 0,
			"content-filter": 0,
			"tool-calls": 0,
			error: 0,
			other: 0,
			unknown: 0,
		},
		performance: {
			timeToFirstOutputMs: mutableDistribution(AI_OBSERVABILITY_DURATION_BOUNDS_MS),
			effectiveOutputTokensPerSecond: mutableDistribution(AI_OBSERVABILITY_RATE_BOUNDS_PER_SECOND),
			outputTokensPerSecond: mutableDistribution(AI_OBSERVABILITY_RATE_BOUNDS_PER_SECOND),
			inputTokensPerSecond: mutableDistribution(AI_OBSERVABILITY_RATE_BOUNDS_PER_SECOND),
			effectiveTotalTokensPerSecond: mutableDistribution(AI_OBSERVABILITY_RATE_BOUNDS_PER_SECOND),
		},
	};
}

function mutableDistribution(bounds: readonly number[]): MutableDistribution {
	return { count: 0, sum: 0, max: 0, bins: bounds.map(() => 0), bounds };
}

function mutableTokenTotals(): MutableTokenTotals {
	return {
		inputTokens: 0,
		noCacheInputTokens: 0,
		cacheReadInputTokens: 0,
		cacheWriteInputTokens: 0,
		outputTokens: 0,
		textOutputTokens: 0,
		reasoningOutputTokens: 0,
		totalTokens: 0,
		embeddingTokens: 0,
	};
}

function totalAggregate(totals: MutableTotals, kind: EntityKind): MutableAggregate {
	switch (kind) {
		case "operation":
			return totals.operations;
		case "step":
			return totals.steps;
		case "model":
			return totals.modelCalls;
		case "tool":
			return totals.toolExecutions;
		case "embedding":
			return totals.embeddingCalls;
		case "reranking":
			return totals.rerankingCalls;
	}
	throw new TypeError("Unsupported entity kind.");
}

function eventKind(type: AiObservabilityEvent["type"]): EntityKind {
	if (type.startsWith("operation.")) return "operation";
	if (type.startsWith("step.")) return "step";
	if (type.startsWith("model.")) return "model";
	if (type.startsWith("tool.")) return "tool";
	if (type.startsWith("embedding.")) return "embedding";
	return "reranking";
}

function incrementStartedPlain(aggregate: MutableAggregate): void {
	aggregate.started = Math.min(MAX_SAFE_COUNT, aggregate.started + 1);
}

function incrementTerminalPlain(
	aggregate: MutableAggregate,
	outcome: AiObservabilityOutcome,
	durationMs: number,
): void {
	aggregate.outcomes[outcome] = Math.min(MAX_SAFE_COUNT, aggregate.outcomes[outcome] + 1);
	recordDistributionPlain(aggregate.durationMs, durationMs);
}

function replaceOutcome(
	aggregate: MutableAggregate,
	previous: AiObservabilityOutcome,
	next: AiObservabilityOutcome,
): void {
	aggregate.outcomes[previous] = Math.max(0, aggregate.outcomes[previous] - 1);
	aggregate.outcomes[next] = Math.min(MAX_SAFE_COUNT, aggregate.outcomes[next] + 1);
}

function replaceFinishReason(
	aggregate: MutableAggregate,
	previous: AiFinishReason | undefined,
	next: AiFinishReason | undefined,
): void {
	if (previous !== undefined) {
		aggregate.finishReasons[previous] = Math.max(0, aggregate.finishReasons[previous] - 1);
	}
	if (next !== undefined) {
		aggregate.finishReasons[next] = Math.min(MAX_SAFE_COUNT, aggregate.finishReasons[next] + 1);
	}
}

function recordDistributionPlain(distribution: MutableDistribution, value: number): void {
	distribution.count = Math.min(MAX_SAFE_COUNT, distribution.count + 1);
	distribution.sum = Math.min(MAX_SAFE_COUNT, distribution.sum + value);
	distribution.max = Math.max(distribution.max, value);
	const index = distribution.bounds.findIndex((bound) => value <= bound);
	const resolved = index === -1 ? distribution.bounds.length - 1 : index;
	distribution.bins[resolved] = Math.min(MAX_SAFE_COUNT, (distribution.bins[resolved] ?? 0) + 1);
}

function lifecycleView(aggregate: MutableAggregate): AiLifecycleMetricsView {
	return {
		started: aggregate.started,
		active: aggregate.active,
		outcomes: { ...aggregate.outcomes },
		abandoned: { ...aggregate.abandoned },
		durationMs: distributionView(aggregate.durationMs),
	};
}

function operationView(aggregate: MutableAggregate): AiOperationMetricsView {
	return {
		...lifecycleView(aggregate),
		usage: usageView(aggregate.usage),
		finishReasons: { ...aggregate.finishReasons },
	};
}

function modelView(aggregate: MutableAggregate): AiModelMetricsView {
	return {
		...lifecycleView(aggregate),
		usage: usageView(aggregate.usage),
		finishReasons: { ...aggregate.finishReasons },
		performance: performanceView(aggregate.performance),
	};
}

function totalsView(totals: MutableTotals): AiObservabilityTotalsView {
	return {
		operations: operationView(totals.operations),
		steps: lifecycleView(totals.steps),
		modelCalls: modelView(totals.modelCalls),
		toolExecutions: lifecycleView(totals.toolExecutions),
		embeddingCalls: modelView(totals.embeddingCalls),
		rerankingCalls: modelView(totals.rerankingCalls),
	};
}

function windowLifecycleView(aggregate: MutableAggregate): AiWindowLifecycleMetricsView {
	return {
		started: aggregate.started,
		outcomes: { ...aggregate.outcomes },
		abandoned: { ...aggregate.abandoned },
		durationMs: distributionView(aggregate.durationMs),
	};
}

function windowOperationView(aggregate: MutableAggregate): AiWindowOperationMetricsView {
	return {
		...windowLifecycleView(aggregate),
		usage: usageView(aggregate.usage),
		finishReasons: { ...aggregate.finishReasons },
	};
}

function windowModelView(aggregate: MutableAggregate): AiWindowModelMetricsView {
	return {
		...windowLifecycleView(aggregate),
		usage: usageView(aggregate.usage),
		finishReasons: { ...aggregate.finishReasons },
		performance: performanceView(aggregate.performance),
	};
}

function windowTotalsView(totals: MutableTotals): Omit<AiObservabilityBucketView, "startedAt"> {
	return {
		operations: windowOperationView(totals.operations),
		steps: windowLifecycleView(totals.steps),
		modelCalls: windowModelView(totals.modelCalls),
		toolExecutions: windowLifecycleView(totals.toolExecutions),
		embeddingCalls: windowModelView(totals.embeddingCalls),
		rerankingCalls: windowModelView(totals.rerankingCalls),
	};
}

function distributionView(distribution: MutableDistribution): AiMetricDistributionView {
	if (distribution.count === 0) {
		return { count: 0, average: null, p50: null, p95: null, p99: null, max: null };
	}
	return {
		count: distribution.count,
		average: roundMetric(distribution.sum / distribution.count),
		p50: histogramPercentile(distribution, 0.5),
		p95: histogramPercentile(distribution, 0.95),
		p99: histogramPercentile(distribution, 0.99),
		max: distribution.max,
	};
}

function histogramPercentile(distribution: MutableDistribution, percentile: number): number {
	const target = Math.max(1, Math.ceil(distribution.count * percentile));
	let cumulative = 0;
	for (const [index, count] of distribution.bins.entries()) {
		cumulative += count;
		if (cumulative < target) continue;
		const bound = distribution.bounds[index] ?? Number.POSITIVE_INFINITY;
		return Number.isFinite(bound) ? Math.min(bound, distribution.max) : distribution.max;
	}
	return distribution.max;
}

function usageView(usage: MutableUsage): AiUsageMetricsView {
	return {
		totals: { ...usage.totals } satisfies AiTokenTotalsView,
		samples: { ...usage.samples } satisfies AiTokenTotalsView,
	};
}

function performanceView(performance: MutablePerformance): AiModelPerformanceMetricsView {
	return {
		timeToFirstOutputMs: distributionView(performance.timeToFirstOutputMs),
		effectiveOutputTokensPerSecond: distributionView(performance.effectiveOutputTokensPerSecond),
		outputTokensPerSecond: distributionView(performance.outputTokensPerSecond),
		inputTokensPerSecond: distributionView(performance.inputTokensPerSecond),
		effectiveTotalTokensPerSecond: distributionView(performance.effectiveTotalTokensPerSecond),
	};
}

function groupDiagnostics<DIMENSION>(
	registry: GroupRegistry<DIMENSION>,
): AiCollectorGroupDiagnosticsView {
	return {
		retained: registry.entries.size,
		concrete: registry.concrete,
		limit: registry.limit,
		eventsFolded: registry.eventsFolded,
		truncated: registry.eventsFolded > 0,
	};
}

function signalCoverage(aggregate: MutableAggregate): {
	readonly started: number;
	readonly completed: number;
	readonly abandoned: number;
} {
	return {
		started: aggregate.started,
		completed: aggregate.outcomes.success + aggregate.outcomes.error + aggregate.outcomes.aborted,
		abandoned: aggregate.abandoned.ttl + aggregate.abandoned.capacity + aggregate.abandoned.parent,
	};
}

function compareOperationGroups(left: AiOperationGroupView, right: AiOperationGroupView): number {
	return (
		Number(left.overflow) - Number(right.overflow) ||
		left.source.localeCompare(right.source) ||
		left.operation.localeCompare(right.operation) ||
		(left.functionId ?? "").localeCompare(right.functionId ?? "")
	);
}

function compareModelGroups(left: AiModelGroupView, right: AiModelGroupView): number {
	return (
		Number(left.overflow) - Number(right.overflow) ||
		left.modality.localeCompare(right.modality) ||
		left.source.localeCompare(right.source) ||
		left.provider.localeCompare(right.provider) ||
		left.model.localeCompare(right.model)
	);
}

function compareToolGroups(left: AiToolGroupView, right: AiToolGroupView): number {
	return (
		Number(left.overflow) - Number(right.overflow) ||
		left.source.localeCompare(right.source) ||
		left.tool.localeCompare(right.tool)
	);
}

function validIdentifier(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) return false;
	for (const character of value) {
		const codePoint = character.codePointAt(0);
		if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) return false;
	}
	return true;
}

function validTimestamp(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= 0 &&
		value <= MAX_FOUR_DIGIT_YEAR_TIMESTAMP_MS
	);
}

function validOutcome(value: unknown): value is AiObservabilityOutcome {
	return value === "success" || value === "error" || value === "aborted";
}

function normalizeFinishReason(value: AiFinishReason | undefined): AiFinishReason | undefined {
	if (value === undefined) return undefined;
	return FINISH_REASONS.has(value) ? value : "unknown";
}

function normalizeMetricValue(value: number, maximum: number): number | undefined {
	if (!Number.isFinite(value) || value < 0 || value > maximum) return undefined;
	return roundMetric(value);
}

function roundMetric(value: number): number {
	return Math.round(value * 1_000) / 1_000;
}

function entityKey(operationId: string, entityId: string): string {
	return JSON.stringify([operationId, entityId]);
}

function replayEventKey(eventId: string): string {
	return `event:${eventId}`;
}

function replayEntityKey(key: string): string {
	return `entity:${key}`;
}

function bucketStart(timestamp: number): number {
	return Math.floor(timestamp / AI_OBSERVABILITY_BUCKET_MS) * AI_OBSERVABILITY_BUCKET_MS;
}

function bucketIndex(startMs: number): number {
	const epoch = Math.floor(startMs / AI_OBSERVABILITY_BUCKET_MS);
	return (
		((epoch % AI_OBSERVABILITY_BUCKET_COUNT) + AI_OBSERVABILITY_BUCKET_COUNT) %
		AI_OBSERVABILITY_BUCKET_COUNT
	);
}

function readTimestamp(clock: AiObservabilityClock): number {
	const timestamp = clock();
	if (!validTimestamp(timestamp)) {
		throw new TypeError("clock must return a valid Unix epoch millisecond timestamp.");
	}
	return timestamp;
}

function toIsoTimestamp(timestamp: number): string {
	return new Date(timestamp).toISOString();
}

function deepFreeze<T>(value: T): T {
	if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
