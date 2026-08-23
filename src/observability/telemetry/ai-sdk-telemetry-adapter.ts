import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
	InferTelemetryEvent,
	LanguageModelUsage,
	Telemetry,
	ToolExecutionStartEvent,
} from "ai";
import {
	AI_OBSERVABILITY_EVENT_SCHEMA_VERSION,
	type AiFinishReason,
	type AiModelPerformance,
	type AiObservabilityClock,
	type AiObservabilityEvent,
	type AiObservabilityEventBase,
	type AiObservabilityOutcome,
	type AiObservabilitySink,
	type AiTokenUsage,
} from "../core/index.ts";

const DEFAULT_MAX_ACTIVE_OPERATIONS = 1_024;
const DEFAULT_MAX_ACTIVE_CHILDREN = 256;
const MAX_ACTIVE_OPERATIONS_HARD_LIMIT = 65_536;
const MAX_ACTIVE_CHILDREN_HARD_LIMIT = 4_096;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_DIMENSION_LENGTH = 128;

type TelemetryStartEvent = Parameters<NonNullable<Telemetry["onStart"]>>[0];
type TelemetryStepStartEvent = Parameters<NonNullable<Telemetry["onStepStart"]>>[0];
type TelemetryModelStartEvent = Parameters<NonNullable<Telemetry["onLanguageModelCallStart"]>>[0];
type TelemetryModelEndEvent = Parameters<NonNullable<Telemetry["onLanguageModelCallEnd"]>>[0];
type TelemetryToolStartEvent = Parameters<NonNullable<Telemetry["onToolExecutionStart"]>>[0];
type TelemetryToolEndEvent = Parameters<NonNullable<Telemetry["onToolExecutionEnd"]>>[0];
type TelemetryStepEndEvent = Parameters<NonNullable<Telemetry["onStepEnd"]>>[0];
type TelemetryObjectStepStartEvent = Parameters<NonNullable<Telemetry["onObjectStepStart"]>>[0];
type TelemetryObjectStepEndEvent = Parameters<NonNullable<Telemetry["onObjectStepEnd"]>>[0];
type TelemetryEmbedStartEvent = Parameters<NonNullable<Telemetry["onEmbedStart"]>>[0];
type TelemetryEmbedEndEvent = Parameters<NonNullable<Telemetry["onEmbedEnd"]>>[0];
type TelemetryRerankStartEvent = Parameters<NonNullable<Telemetry["onRerankStart"]>>[0];
type TelemetryRerankEndEvent = Parameters<NonNullable<Telemetry["onRerankEnd"]>>[0];
type TelemetryEndEvent = Parameters<NonNullable<Telemetry["onEnd"]>>[0];
type TelemetryAbortEvent = Parameters<NonNullable<Telemetry["onAbort"]>>[0];

type ToolExecutionOptions<RESULT> = Partial<InferTelemetryEvent<ToolExecutionStartEvent>> & {
	readonly callId: string;
	readonly toolCallId: string;
	readonly execute: () => PromiseLike<RESULT>;
};

interface ActiveChild {
	readonly entityId: string;
	readonly parentEntityId: string;
	readonly startedAt: number;
}

interface ActiveStep extends ActiveChild {
	readonly stepNumber: number;
}

interface ActiveOperation {
	readonly sdkCallId: string;
	readonly entityId: string;
	readonly operationId: string;
	readonly operation: string;
	readonly startedAt: number;
	readonly streaming: boolean;
	readonly parentEntityId?: string;
	currentStep?: ActiveStep;
	currentModel?: ActiveChild;
	modelOrdinal: number;
	rerankingOrdinal: number;
	readonly tools: Map<string, ActiveChild>;
	readonly embeddings: Map<string, ActiveChild>;
	readonly rerankings: ActiveChild[];
}

interface CompletedOperation {
	readonly entityId: string;
	readonly operationId: string;
	readonly parentEntityId?: string;
	readonly outcome: AiObservabilityOutcome;
}

interface NestedExecutionContext {
	readonly operationId: string;
	readonly parentEntityId: string;
}

interface TelemetryErrorEvent {
	readonly callId: string;
	readonly error: unknown;
}

export type AiSdkErrorClassifier = (
	error: unknown,
) => Extract<AiObservabilityOutcome, "error" | "aborted">;

export interface AiSdkTelemetryAdapterOptions {
	readonly sink: AiObservabilitySink;
	readonly clock?: AiObservabilityClock;
	readonly source?: string;
	readonly maxActiveOperations?: number;
	readonly maxActiveChildrenPerOperation?: number;
	readonly errorClassifier?: AiSdkErrorClassifier;
	readonly generateEventId?: () => string;
}

/** Maps AI SDK 7 lifecycle callbacks into the neutral, content-free event model. */
export class AiSdkTelemetryAdapter implements Telemetry {
	readonly #sink: AiObservabilitySink;
	readonly #clock: AiObservabilityClock;
	readonly #source: string;
	readonly #maxActiveOperations: number;
	readonly #maxActiveChildren: number;
	readonly #classifyError: AiSdkErrorClassifier;
	readonly #generateEventId: () => string;
	readonly #active = new Map<string, ActiveOperation>();
	readonly #recentlyCompleted = new Map<string, CompletedOperation>();
	readonly #nestedExecution = new AsyncLocalStorage<NestedExecutionContext>();

	constructor(options: AiSdkTelemetryAdapterOptions) {
		this.#sink = options.sink;
		this.#clock = options.clock ?? Date.now;
		this.#source = boundedDimension(options.source ?? "ai-sdk", "ai-sdk");
		this.#maxActiveOperations = positiveInteger(
			options.maxActiveOperations,
			DEFAULT_MAX_ACTIVE_OPERATIONS,
			MAX_ACTIVE_OPERATIONS_HARD_LIMIT,
		);
		this.#maxActiveChildren = positiveInteger(
			options.maxActiveChildrenPerOperation,
			DEFAULT_MAX_ACTIVE_CHILDREN,
			MAX_ACTIVE_CHILDREN_HARD_LIMIT,
		);
		this.#classifyError = options.errorClassifier ?? (() => "error");

		if (options.generateEventId != null) {
			this.#generateEventId = options.generateEventId;
		} else {
			const prefix = randomUUID();
			let sequence = 0;
			this.#generateEventId = () => `${prefix}:${++sequence}`;
		}
	}

	get activeOperationCount(): number {
		return this.#active.size;
	}

	dispose(): void {
		this.#active.clear();
		this.#recentlyCompleted.clear();
		this.#nestedExecution.disable();
	}

	async onStart(event: TelemetryStartEvent): Promise<void> {
		const timestamp = this.#now();
		const sdkCallId = normalizeCallId(event.callId);
		const nested = this.#nestedExecution.getStore();
		const entityId = operationEntityId(sdkCallId);
		const operationId = nested?.operationId ?? entityId;
		const operation = normalizeOperation(event.operationId);
		const streaming = isStreamingOperation(operation);
		const active: ActiveOperation = {
			sdkCallId,
			entityId,
			operationId,
			operation,
			startedAt: timestamp,
			streaming,
			parentEntityId: nested?.parentEntityId,
			modelOrdinal: 0,
			rerankingOrdinal: 0,
			tools: new Map(),
			embeddings: new Map(),
			rerankings: [],
		};

		this.#rememberOperation(active);
		this.#recentlyCompleted.delete(sdkCallId);

		await this.#record([
			{
				...this.#base(entityId, operationId, timestamp, nested?.parentEntityId),
				type: "operation.started",
				operation,
				functionId: optionalDimension(event.functionId),
				provider: optionalDimension(event.provider),
				model: optionalDimension(event.modelId),
				streaming,
			},
		]);
	}

	async onStepStart(event: TelemetryStepStartEvent): Promise<void> {
		const timestamp = this.#now();
		const active = this.#active.get(normalizeCallId(event.callId));
		const operation = this.#correlation(event.callId, active);
		const entityId = stepEntityId(operation.entityId, event.stepNumber);
		if (active != null) {
			active.currentStep = {
				entityId,
				parentEntityId: active.entityId,
				startedAt: timestamp,
				stepNumber: event.stepNumber,
			};
		}

		await this.#record([
			{
				...this.#base(entityId, operation.operationId, timestamp, operation.entityId),
				type: "step.started",
				stepNumber: event.stepNumber,
				provider: optionalDimension(event.provider),
				model: optionalDimension(event.modelId),
			},
		]);
	}

	async onLanguageModelCallStart(event: TelemetryModelStartEvent): Promise<void> {
		const timestamp = this.#now();
		const active = this.#active.get(normalizeCallId(event.callId));
		const operation = this.#correlation(event.callId, active);
		const ordinal = active == null ? 0 : active.modelOrdinal++;
		const entityId = modelEntityId(operation.entityId, ordinal);
		const parentEntityId = active?.currentStep?.entityId ?? operation.entityId;
		if (active != null) {
			active.currentModel = { entityId, parentEntityId, startedAt: timestamp };
		}

		await this.#record([
			{
				...this.#base(entityId, operation.operationId, timestamp, parentEntityId),
				type: "model.started",
				provider: boundedDimension(event.provider, "unknown"),
				model: boundedDimension(event.modelId, "unknown"),
				streaming: active?.streaming ?? false,
			},
		]);
	}

	async onLanguageModelCallEnd(event: TelemetryModelEndEvent): Promise<void> {
		const timestamp = this.#now();
		const active = this.#active.get(normalizeCallId(event.callId));
		const operation = this.#correlation(event.callId, active);
		const child =
			active?.currentModel ??
			this.#fallbackChild(
				modelEntityId(operation.entityId, active?.modelOrdinal ?? 0),
				active?.currentStep?.entityId ?? operation.entityId,
				timestamp,
			);
		if (active != null) {
			active.currentModel = undefined;
		}

		await this.#record([
			{
				...this.#base(child.entityId, operation.operationId, timestamp, child.parentEntityId),
				type: "model.completed",
				outcome: outcomeForFinishReason(event.finishReason),
				durationMs: finiteNonNegative(event.performance.responseTimeMs),
				finishReason: normalizeFinishReason(event.finishReason),
				usage: normalizeLanguageUsage(event.usage),
				performance: normalizeModelPerformance(event.performance),
			},
		]);
	}

	async onToolExecutionStart(event: TelemetryToolStartEvent): Promise<void> {
		const timestamp = this.#now();
		const active = this.#active.get(normalizeCallId(event.callId));
		const operation = this.#correlation(event.callId, active);
		const toolCallId = boundedIdentifier(event.toolCall.toolCallId, "unknown-tool-call");
		const entityId = toolEntityId(operation.entityId, toolCallId);
		const parentEntityId = active?.currentStep?.entityId ?? operation.entityId;
		if (active != null) {
			boundedMapSet(
				active.tools,
				toolCallId,
				{ entityId, parentEntityId, startedAt: timestamp },
				this.#maxActiveChildren,
			);
		}

		await this.#record([
			{
				...this.#base(entityId, operation.operationId, timestamp, parentEntityId),
				type: "tool.started",
				toolName: boundedDimension(event.toolCall.toolName, "unknown"),
				dynamic: event.toolCall.dynamic === true,
				providerExecuted: event.toolCall.providerExecuted === true,
			},
		]);
	}

	async onToolExecutionEnd(event: TelemetryToolEndEvent): Promise<void> {
		const timestamp = this.#now();
		const active = this.#active.get(normalizeCallId(event.callId));
		const operation = this.#correlation(event.callId, active);
		const toolCallId = boundedIdentifier(event.toolCall.toolCallId, "unknown-tool-call");
		const child =
			active?.tools.get(toolCallId) ??
			this.#fallbackChild(
				toolEntityId(operation.entityId, toolCallId),
				active?.currentStep?.entityId ?? operation.entityId,
				timestamp,
			);
		active?.tools.delete(toolCallId);
		const outcome =
			event.toolOutput.type === "tool-error"
				? this.#errorOutcome(event.toolOutput.error)
				: "success";

		await this.#record([
			{
				...this.#base(child.entityId, operation.operationId, timestamp, child.parentEntityId),
				type: "tool.completed",
				outcome,
				durationMs: finiteNonNegative(event.toolExecutionMs),
			},
		]);
	}

	async onStepEnd(event: TelemetryStepEndEvent): Promise<void> {
		const timestamp = this.#now();
		const active = this.#active.get(normalizeCallId(event.callId));
		const operation = this.#correlation(event.callId, active);
		const child =
			active?.currentStep?.stepNumber === event.stepNumber
				? active.currentStep
				: this.#fallbackStep(operation.entityId, event.stepNumber, timestamp);
		if (active?.currentStep?.stepNumber === event.stepNumber) {
			active.currentStep = undefined;
		}

		await this.#record([
			{
				...this.#base(child.entityId, operation.operationId, timestamp, child.parentEntityId),
				type: "step.completed",
				outcome: outcomeForFinishReason(event.finishReason),
				durationMs: finiteNonNegative(event.performance.stepTimeMs),
				finishReason: normalizeFinishReason(event.finishReason),
			},
		]);
	}

	async onObjectStepStart(event: TelemetryObjectStepStartEvent): Promise<void> {
		const timestamp = this.#now();
		const active = this.#active.get(normalizeCallId(event.callId));
		const operation = this.#correlation(event.callId, active);
		const step = this.#fallbackStep(operation.entityId, event.stepNumber, timestamp);
		const modelId = modelEntityId(operation.entityId, active?.modelOrdinal ?? 0);
		const model: ActiveChild = {
			entityId: modelId,
			parentEntityId: step.entityId,
			startedAt: timestamp,
		};
		if (active != null) {
			active.currentStep = step;
			active.currentModel = model;
			active.modelOrdinal++;
		}

		await this.#record([
			{
				...this.#base(step.entityId, operation.operationId, timestamp, operation.entityId),
				type: "step.started",
				stepNumber: event.stepNumber,
				provider: optionalDimension(event.provider),
				model: optionalDimension(event.modelId),
			},
			{
				...this.#base(model.entityId, operation.operationId, timestamp, step.entityId),
				type: "model.started",
				provider: boundedDimension(event.provider, "unknown"),
				model: boundedDimension(event.modelId, "unknown"),
				streaming: active?.streaming ?? false,
			},
		]);
	}

	async onObjectStepEnd(event: TelemetryObjectStepEndEvent): Promise<void> {
		const timestamp = this.#now();
		const active = this.#active.get(normalizeCallId(event.callId));
		const operation = this.#correlation(event.callId, active);
		const step =
			active?.currentStep ?? this.#fallbackStep(operation.entityId, event.stepNumber, timestamp);
		const model =
			active?.currentModel ??
			this.#fallbackChild(
				modelEntityId(operation.entityId, active?.modelOrdinal ?? 0),
				step.entityId,
				timestamp,
			);
		if (active != null) {
			active.currentModel = undefined;
			active.currentStep = undefined;
		}
		const finishReason = normalizeFinishReason(event.finishReason);
		const outcome = outcomeForFinishReason(event.finishReason);

		await this.#record([
			{
				...this.#base(model.entityId, operation.operationId, timestamp, model.parentEntityId),
				type: "model.completed",
				outcome,
				durationMs: elapsed(model.startedAt, timestamp),
				finishReason,
				usage: normalizeLanguageUsage(event.usage),
				performance: normalizeModelPerformance({
					timeToFirstOutputMs: event.msToFirstChunk,
				}),
			},
			{
				...this.#base(step.entityId, operation.operationId, timestamp, step.parentEntityId),
				type: "step.completed",
				outcome,
				durationMs: elapsed(step.startedAt, timestamp),
				finishReason,
			},
		]);
	}

	async onEmbedStart(event: TelemetryEmbedStartEvent): Promise<void> {
		const timestamp = this.#now();
		const active = this.#active.get(normalizeCallId(event.callId));
		const operation = this.#correlation(event.callId, active);
		const embedCallId = boundedIdentifier(event.embedCallId, "unknown-embedding-call");
		const entityId = embeddingEntityId(operation.entityId, embedCallId);
		const child = { entityId, parentEntityId: operation.entityId, startedAt: timestamp };
		if (active != null) {
			boundedMapSet(active.embeddings, embedCallId, child, this.#maxActiveChildren);
		}

		await this.#record([
			{
				...this.#base(entityId, operation.operationId, timestamp, operation.entityId),
				type: "embedding.started",
				provider: boundedDimension(event.provider, "unknown"),
				model: boundedDimension(event.modelId, "unknown"),
				batchSize: event.values.length,
			},
		]);
	}

	async onEmbedEnd(event: TelemetryEmbedEndEvent): Promise<void> {
		const timestamp = this.#now();
		const active = this.#active.get(normalizeCallId(event.callId));
		const operation = this.#correlation(event.callId, active);
		const embedCallId = boundedIdentifier(event.embedCallId, "unknown-embedding-call");
		const child =
			active?.embeddings.get(embedCallId) ??
			this.#fallbackChild(
				embeddingEntityId(operation.entityId, embedCallId),
				operation.entityId,
				timestamp,
			);
		active?.embeddings.delete(embedCallId);

		await this.#record([
			{
				...this.#base(child.entityId, operation.operationId, timestamp, child.parentEntityId),
				type: "embedding.completed",
				outcome: "success",
				durationMs: elapsed(child.startedAt, timestamp),
				usage: embeddingUsage(event.usage.tokens),
			},
		]);
	}

	async onRerankStart(event: TelemetryRerankStartEvent): Promise<void> {
		const timestamp = this.#now();
		const active = this.#active.get(normalizeCallId(event.callId));
		const operation = this.#correlation(event.callId, active);
		const ordinal = active == null ? 0 : active.rerankingOrdinal++;
		const child: ActiveChild = {
			entityId: rerankingEntityId(operation.entityId, ordinal),
			parentEntityId: operation.entityId,
			startedAt: timestamp,
		};
		const retryFailures: AiObservabilityEvent[] = [];
		if (active != null) {
			for (const previousAttempt of active.rerankings.splice(0)) {
				retryFailures.push({
					...this.#base(
						previousAttempt.entityId,
						operation.operationId,
						timestamp,
						previousAttempt.parentEntityId,
					),
					type: "reranking.completed",
					outcome: "error",
					durationMs: elapsed(previousAttempt.startedAt, timestamp),
				});
			}
			active.rerankings.push(child);
			while (active.rerankings.length > this.#maxActiveChildren) {
				active.rerankings.shift();
			}
		}

		await this.#record([
			...retryFailures,
			{
				...this.#base(child.entityId, operation.operationId, timestamp, child.parentEntityId),
				type: "reranking.started",
				provider: boundedDimension(event.provider, "unknown"),
				model: boundedDimension(event.modelId, "unknown"),
				documentCount: event.documents.length,
			},
		]);
	}

	async onRerankEnd(event: TelemetryRerankEndEvent): Promise<void> {
		const timestamp = this.#now();
		const active = this.#active.get(normalizeCallId(event.callId));
		const operation = this.#correlation(event.callId, active);
		const child =
			active?.rerankings.pop() ??
			this.#fallbackChild(
				rerankingEntityId(operation.entityId, Math.max(0, (active?.rerankingOrdinal ?? 1) - 1)),
				operation.entityId,
				timestamp,
			);

		await this.#record([
			{
				...this.#base(child.entityId, operation.operationId, timestamp, child.parentEntityId),
				type: "reranking.completed",
				outcome: "success",
				durationMs: elapsed(child.startedAt, timestamp),
				resultCount: event.ranking.length,
			},
		]);
	}

	async onEnd(event: TelemetryEndEvent): Promise<void> {
		const sdkCallId = normalizeCallId(event.callId);
		if (this.#recentlyCompleted.has(sdkCallId)) {
			return;
		}

		const timestamp = this.#now();
		const active = this.#active.get(sdkCallId);
		const operation = this.#correlation(sdkCallId, active);
		const finishReason = finishReasonFromEndEvent(event);
		const error = "error" in event ? event.error : undefined;
		const outcome =
			error != null ? this.#errorOutcome(error) : finishReason === "error" ? "error" : "success";

		const completion: Extract<AiObservabilityEvent, { type: "operation.completed" }> = {
			...this.#base(operation.entityId, operation.operationId, timestamp, active?.parentEntityId),
			type: "operation.completed",
			outcome,
			durationMs: active == null ? undefined : elapsed(active.startedAt, timestamp),
			finishReason,
			usage: usageFromEndEvent(event),
			stepCount: "steps" in event ? event.steps.length : undefined,
		};

		const unresolvedEmbeddingOutcome = outcome === "aborted" ? "aborted" : "error";
		const unresolvedEmbeddings: AiObservabilityEvent[] = [];
		for (const child of active?.embeddings.values() ?? []) {
			unresolvedEmbeddings.push({
				...this.#base(child.entityId, operation.operationId, timestamp, child.parentEntityId),
				type: "embedding.completed",
				outcome: unresolvedEmbeddingOutcome,
				durationMs: elapsed(child.startedAt, timestamp),
			});
		}
		active?.embeddings.clear();

		await this.#record([...unresolvedEmbeddings, completion]);
		this.#completeOperation(sdkCallId, {
			entityId: operation.entityId,
			operationId: operation.operationId,
			...(active?.parentEntityId === undefined ? {} : { parentEntityId: active.parentEntityId }),
			outcome,
		});
	}

	async onAbort(event: TelemetryAbortEvent): Promise<void> {
		await this.#completeFromFailure(event.callId, "aborted");
	}

	async onError(event: unknown): Promise<void> {
		if (!isTelemetryErrorEvent(event)) {
			return;
		}

		await this.#completeFromFailure(event.callId, this.#errorOutcome(event.error));
	}

	executeTool<RESULT>(options: ToolExecutionOptions<RESULT>): PromiseLike<RESULT> {
		const active = this.#active.get(normalizeCallId(options.callId));
		const operation = this.#correlation(options.callId, active);
		const toolCallId = boundedIdentifier(options.toolCallId, "unknown-tool-call");
		const context: NestedExecutionContext = {
			operationId: operation.operationId,
			parentEntityId: toolEntityId(operation.entityId, toolCallId),
		};

		return this.#nestedExecution.run(context, options.execute);
	}

	async #completeFromFailure(
		callId: string,
		outcome: Extract<AiObservabilityOutcome, "error" | "aborted">,
	): Promise<void> {
		const sdkCallId = normalizeCallId(callId);
		const completed = this.#recentlyCompleted.get(sdkCallId);
		if (completed !== undefined) {
			if (completed.outcome === "success") {
				const timestamp = this.#now();
				this.#rememberCompleted(sdkCallId, { ...completed, outcome });
				await this.#record([
					{
						...this.#base(
							completed.entityId,
							completed.operationId,
							timestamp,
							completed.parentEntityId,
						),
						type: "operation.outcome-corrected",
						outcome,
					},
				]);
			}
			return;
		}

		const timestamp = this.#now();
		const active = this.#active.get(sdkCallId);
		const operation = this.#correlation(sdkCallId, active);
		const events: AiObservabilityEvent[] = [];

		if (active?.currentModel != null) {
			events.push({
				...this.#base(
					active.currentModel.entityId,
					operation.operationId,
					timestamp,
					active.currentModel.parentEntityId,
				),
				type: "model.completed",
				outcome,
				durationMs: elapsed(active.currentModel.startedAt, timestamp),
			});
		}

		for (const child of active?.tools.values() ?? []) {
			events.push({
				...this.#base(child.entityId, operation.operationId, timestamp, child.parentEntityId),
				type: "tool.completed",
				outcome,
				durationMs: elapsed(child.startedAt, timestamp),
			});
		}

		for (const child of active?.embeddings.values() ?? []) {
			events.push({
				...this.#base(child.entityId, operation.operationId, timestamp, child.parentEntityId),
				type: "embedding.completed",
				outcome,
				durationMs: elapsed(child.startedAt, timestamp),
			});
		}

		for (const child of active?.rerankings ?? []) {
			events.push({
				...this.#base(child.entityId, operation.operationId, timestamp, child.parentEntityId),
				type: "reranking.completed",
				outcome,
				durationMs: elapsed(child.startedAt, timestamp),
			});
		}

		if (active?.currentStep != null) {
			events.push({
				...this.#base(
					active.currentStep.entityId,
					operation.operationId,
					timestamp,
					active.currentStep.parentEntityId,
				),
				type: "step.completed",
				outcome,
				durationMs: elapsed(active.currentStep.startedAt, timestamp),
			});
		}

		events.push({
			...this.#base(operation.entityId, operation.operationId, timestamp, active?.parentEntityId),
			type: "operation.completed",
			outcome,
			durationMs: active == null ? undefined : elapsed(active.startedAt, timestamp),
		});

		await this.#record(events);
		this.#completeOperation(sdkCallId, {
			entityId: operation.entityId,
			operationId: operation.operationId,
			...(active?.parentEntityId === undefined ? {} : { parentEntityId: active.parentEntityId }),
			outcome,
		});
	}

	#base(
		entityId: string,
		operationId: string,
		timestamp: number,
		parentEntityId?: string,
	): AiObservabilityEventBase {
		return {
			schemaVersion: AI_OBSERVABILITY_EVENT_SCHEMA_VERSION,
			eventId: boundedIdentifier(this.#safeEventId(), randomUUID()),
			entityId,
			operationId,
			source: this.#source,
			timestamp,
			parentEntityId,
		};
	}

	#safeEventId(): string {
		try {
			return this.#generateEventId();
		} catch {
			return randomUUID();
		}
	}

	#now(): number {
		try {
			const value = this.#clock();
			return Number.isFinite(value) ? value : Date.now();
		} catch {
			return Date.now();
		}
	}

	#errorOutcome(error: unknown): Extract<AiObservabilityOutcome, "error" | "aborted"> {
		try {
			return this.#classifyError(error) === "aborted" ? "aborted" : "error";
		} catch {
			return "error";
		}
	}

	#rememberOperation(active: ActiveOperation): void {
		this.#active.delete(active.sdkCallId);
		while (this.#active.size >= this.#maxActiveOperations) {
			const oldest = this.#active.keys().next().value;
			if (oldest == null) {
				break;
			}
			this.#active.delete(oldest);
		}
		this.#active.set(active.sdkCallId, active);
	}

	#completeOperation(callId: string, completed: CompletedOperation): void {
		this.#active.delete(callId);
		this.#rememberCompleted(callId, completed);
	}

	#rememberCompleted(callId: string, completed: CompletedOperation): void {
		this.#recentlyCompleted.delete(callId);
		this.#recentlyCompleted.set(callId, completed);
		while (this.#recentlyCompleted.size > this.#maxActiveOperations) {
			const oldest = this.#recentlyCompleted.keys().next().value;
			if (oldest == null) {
				break;
			}
			this.#recentlyCompleted.delete(oldest);
		}
	}

	#correlation(
		callId: string,
		active: ActiveOperation | undefined,
	): { readonly entityId: string; readonly operationId: string } {
		const entityId = active?.entityId ?? operationEntityId(callId);
		return {
			entityId,
			operationId: active?.operationId ?? entityId,
		};
	}

	#fallbackChild(entityId: string, parentEntityId: string, startedAt: number): ActiveChild {
		return { entityId, parentEntityId, startedAt };
	}

	#fallbackStep(
		parentOperationEntityId: string,
		stepNumber: number,
		startedAt: number,
	): ActiveStep {
		return {
			entityId: stepEntityId(parentOperationEntityId, stepNumber),
			parentEntityId: parentOperationEntityId,
			startedAt,
			stepNumber,
		};
	}

	async #record(events: readonly AiObservabilityEvent[]): Promise<void> {
		if (events.length === 0) {
			return;
		}

		try {
			await this.#sink.record(events);
		} catch {
			// Observability must never replace the observed AI operation result.
		}
	}
}

function isTelemetryErrorEvent(value: unknown): value is TelemetryErrorEvent {
	if (typeof value !== "object" || value == null) {
		return false;
	}

	const candidate = value as Partial<TelemetryErrorEvent>;
	return typeof candidate.callId === "string" && "error" in candidate;
}

function positiveInteger(value: number | undefined, fallback: number, hardLimit: number): number {
	return value == null || !Number.isFinite(value) || value < 1
		? fallback
		: Math.min(hardLimit, Math.max(1, Math.floor(value)));
}

function boundedIdentifier(value: string, fallback: string): string {
	let normalized = "";
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		normalized += codePoint < 32 || codePoint === 127 ? "?" : character;
		if (normalized.length >= MAX_IDENTIFIER_LENGTH) {
			break;
		}
	}
	normalized = normalized.slice(0, MAX_IDENTIFIER_LENGTH);
	return normalized.length === 0 ? fallback : normalized;
}

function boundedDimension(value: string, fallback: string): string {
	return isSafeDimension(value) ? value : fallback;
}

function optionalDimension(value: string | undefined): string | undefined {
	return value == null ? undefined : boundedDimension(value, "unknown");
}

function isAsciiAlphaNumeric(codePoint: number): boolean {
	return (
		(codePoint >= 48 && codePoint <= 57) ||
		(codePoint >= 65 && codePoint <= 90) ||
		(codePoint >= 97 && codePoint <= 122)
	);
}

function isSafeDimension(value: string): boolean {
	if (
		value.length === 0 ||
		value.length > MAX_DIMENSION_LENGTH ||
		!isAsciiAlphaNumeric(value.codePointAt(0) ?? 0)
	) {
		return false;
	}

	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (!isAsciiAlphaNumeric(codePoint) && !"_.:/@+-".includes(character)) {
			return false;
		}
	}
	return true;
}

function normalizeOperation(operationId: string): string {
	switch (operationId) {
		case "ai.generateText":
			return "generate-text";
		case "ai.streamText":
			return "stream-text";
		case "ai.generateObject":
			return "generate-object";
		case "ai.streamObject":
			return "stream-object";
		case "ai.embed":
			return "embed";
		case "ai.embedMany":
			return "embed-many";
		case "ai.rerank":
			return "rerank";
		default:
			if (!isSafeDimension(operationId)) {
				return "other";
			}
			return boundedDimension(
				operationId
					.replace(/^ai\./, "")
					.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
					.toLowerCase(),
				"other",
			);
	}
}

function isStreamingOperation(operation: string): boolean {
	return operation === "stream-text" || operation === "stream-object";
}

function normalizeFinishReason(value: unknown): AiFinishReason {
	switch (value) {
		case "stop":
		case "length":
		case "content-filter":
		case "tool-calls":
		case "error":
		case "other":
		case "unknown":
			return value;
		default:
			return "unknown";
	}
}

function outcomeForFinishReason(
	value: unknown,
): Extract<AiObservabilityOutcome, "success" | "error"> {
	return normalizeFinishReason(value) === "error" ? "error" : "success";
}

function finiteNonNegative(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function elapsed(startedAt: number, completedAt: number): number {
	return Math.max(0, completedAt - startedAt);
}

function normalizeLanguageUsage(usage: LanguageModelUsage): AiTokenUsage | undefined {
	const normalized: AiTokenUsage = {
		inputTokens: finiteNonNegative(usage.inputTokens),
		noCacheInputTokens: finiteNonNegative(usage.inputTokenDetails.noCacheTokens),
		cacheReadInputTokens: finiteNonNegative(usage.inputTokenDetails.cacheReadTokens),
		cacheWriteInputTokens: finiteNonNegative(usage.inputTokenDetails.cacheWriteTokens),
		outputTokens: finiteNonNegative(usage.outputTokens),
		textOutputTokens: finiteNonNegative(usage.outputTokenDetails.textTokens),
		reasoningOutputTokens: finiteNonNegative(usage.outputTokenDetails.reasoningTokens),
		totalTokens: finiteNonNegative(usage.totalTokens),
	};

	return hasDefinedValue(normalized) ? normalized : undefined;
}

function embeddingUsage(tokens: number): Pick<AiTokenUsage, "embeddingTokens"> | undefined {
	const embeddingTokens = finiteNonNegative(tokens);
	return embeddingTokens == null ? undefined : { embeddingTokens };
}

function normalizeModelPerformance(
	performance: Partial<AiModelPerformance>,
): AiModelPerformance | undefined {
	const normalized: AiModelPerformance = {
		timeToFirstOutputMs: finiteNonNegative(performance.timeToFirstOutputMs),
		effectiveOutputTokensPerSecond: finiteNonNegative(performance.effectiveOutputTokensPerSecond),
		outputTokensPerSecond: finiteNonNegative(performance.outputTokensPerSecond),
		inputTokensPerSecond: finiteNonNegative(performance.inputTokensPerSecond),
		effectiveTotalTokensPerSecond: finiteNonNegative(performance.effectiveTotalTokensPerSecond),
	};

	return hasDefinedValue(normalized) ? normalized : undefined;
}

function hasDefinedValue(value: object): boolean {
	return Object.values(value).some((item) => item !== undefined);
}

function finishReasonFromEndEvent(event: TelemetryEndEvent): AiFinishReason | undefined {
	return "finishReason" in event ? normalizeFinishReason(event.finishReason) : undefined;
}

function usageFromEndEvent(event: TelemetryEndEvent): AiTokenUsage | undefined {
	if (!("usage" in event)) {
		return undefined;
	}

	return "tokens" in event.usage
		? embeddingUsage(event.usage.tokens)
		: normalizeLanguageUsage(event.usage);
}

function boundedMapSet<KEY, VALUE>(
	map: Map<KEY, VALUE>,
	key: KEY,
	value: VALUE,
	maxSize: number,
): void {
	map.delete(key);
	while (map.size >= maxSize) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) {
			break;
		}
		map.delete(oldest);
	}
	map.set(key, value);
}

function operationEntityId(callId: string): string {
	return normalizeCallId(callId);
}

function normalizeCallId(callId: string): string {
	return boundedIdentifier(callId, "unknown-call");
}

function stepEntityId(operationId: string, stepNumber: number): string {
	return boundedIdentifier(`${operationId}:step:${stepNumber}`, "unknown-step");
}

function modelEntityId(operationId: string, ordinal: number): string {
	return boundedIdentifier(`${operationId}:model:${ordinal}`, "unknown-model-call");
}

function toolEntityId(operationId: string, toolCallId: string): string {
	return boundedIdentifier(`${operationId}:tool:${toolCallId}`, "unknown-tool-call");
}

function embeddingEntityId(operationId: string, embedCallId: string): string {
	return boundedIdentifier(`${operationId}:embedding:${embedCallId}`, "unknown-embedding-call");
}

function rerankingEntityId(operationId: string, ordinal: number): string {
	return boundedIdentifier(`${operationId}:reranking:${ordinal}`, "unknown-reranking-call");
}
