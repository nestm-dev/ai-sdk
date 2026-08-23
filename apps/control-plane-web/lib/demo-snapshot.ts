import type {
	AiFinishReasonCountsView,
	AiLifecycleMetricsView,
	AiMetricDistributionView,
	AiMetricOutcomesView,
	AiModelMetricsView,
	AiModelPerformanceMetricsView,
	AiObservabilityBucketView,
	AiObservabilitySnapshotV1,
	AiOperationMetricsView,
	AiTokenTotalsView,
	AiUsageMetricsView,
	AiWindowLifecycleMetricsView,
	AiWindowModelMetricsView,
	AiWindowOperationMetricsView,
} from "@nestm/ai-sdk/observability/core";

const DEMO_STARTED_AT = Date.now() - 6 * 60 * 60_000;
const recentOutcomes = [
	[16, 1, 0],
	[22, 0, 1],
	[19, 2, 0],
	[27, 1, 0],
	[31, 0, 0],
	[24, 1, 1],
	[34, 2, 0],
	[38, 1, 0],
	[29, 0, 1],
	[41, 1, 0],
	[36, 0, 0],
	[44, 1, 1],
] as const;

export function createDemoSnapshot(now = Date.now()): AiObservabilitySnapshotV1 {
	const bucketStart = Math.floor(now / 15_000) * 15_000;
	const buckets = Array.from({ length: 60 }, (_, index) => {
		const recentIndex = index - (60 - recentOutcomes.length);
		const values = recentIndex < 0 ? undefined : recentOutcomes[recentIndex];
		return demoBucket(bucketStart - (59 - index) * 15_000, values);
	});

	const operationUsage = usage(
		{
			inputTokens: 1_820_000,
			noCacheInputTokens: 1_366_000,
			cacheReadInputTokens: 454_000,
			cacheWriteInputTokens: 84_000,
			outputTokens: 612_000,
			textOutputTokens: 414_000,
			reasoningOutputTokens: 198_000,
			totalTokens: 2_432_000,
		},
		{
			inputTokens: 1_240,
			noCacheInputTokens: 918,
			cacheReadInputTokens: 911,
			cacheWriteInputTokens: 320,
			outputTokens: 1_240,
			textOutputTokens: 1_102,
			reasoningOutputTokens: 608,
			totalTokens: 1_239,
		},
	);

	return {
		schemaVersion: 1,
		scope: "process",
		startedAt: new Date(DEMO_STARTED_AT).toISOString(),
		capturedAt: new Date(now).toISOString(),
		revision: 8_421,
		totals: {
			operations: operationMetrics({
				started: 1_255,
				active: 7,
				outcomes: outcomes(1_208, 31, 9),
				duration: distribution(1_248, 812, 650, 1_900, 4_800, 8_221),
				usage: operationUsage,
				finishReasons: finishReasons({
					stop: 1_172,
					length: 19,
					"tool-calls": 25,
					error: 31,
					unknown: 1,
				}),
			}),
			steps: lifecycle({
				started: 2_050,
				active: 2,
				outcomes: outcomes(2_000, 31, 9),
				abandoned: { ttl: 2, capacity: 0, parent: 6 },
				duration: distribution(2_040, 478, 350, 1_200, 3_100, 6_401),
			}),
			modelCalls: modelMetrics({
				started: 1_024,
				active: 4,
				outcomes: outcomes(984, 26, 5),
				abandoned: { ttl: 1, capacity: 0, parent: 4 },
				duration: distribution(1_015, 741, 600, 1_900, 4_600, 7_812),
				usage: usage(
					{
						inputTokens: 1_784_000,
						outputTokens: 602_000,
						reasoningOutputTokens: 196_000,
						totalTokens: 2_386_000,
					},
					{
						inputTokens: 1_006,
						outputTokens: 1_006,
						reasoningOutputTokens: 502,
						totalTokens: 1_006,
					},
				),
				finishReasons: finishReasons({ stop: 962, length: 17, "tool-calls": 10, error: 26 }),
				performance: performance({
					ttfo: distribution(486, 281, 180, 720, 1_600, 2_204),
					effectiveOutputRate: distribution(480, 86, 61, 174, 246, 312),
				}),
			}),
			toolExecutions: lifecycle({
				started: 190,
				active: 2,
				outcomes: outcomes(181, 2, 1),
				abandoned: { ttl: 0, capacity: 0, parent: 4 },
				duration: distribution(184, 326, 220, 900, 1_900, 3_114),
			}),
			embeddingCalls: modelMetrics({
				started: 45,
				active: 1,
				outcomes: outcomes(43, 1, 0),
				duration: distribution(44, 188, 150, 420, 790, 822),
				usage: usage({ embeddingTokens: 46_000 }, { embeddingTokens: 44 }),
			}),
			rerankingCalls: modelMetrics({
				started: 17,
				active: 0,
				outcomes: outcomes(16, 1, 0),
				duration: distribution(17, 231, 180, 510, 740, 756),
			}),
		},
		window: { bucketSeconds: 15, maxBuckets: 60, buckets },
		operations: [
			{
				source: "ai-sdk",
				operation: "stream-text",
				functionId: "support-chat",
				overflow: false,
				...operationMetrics({
					started: 684,
					active: 3,
					outcomes: outcomes(657, 18, 6),
					duration: distribution(681, 764, 620, 1_800, 4_300, 7_901),
					usage: scaledUsage(operationUsage, 0.54),
					finishReasons: finishReasons({ stop: 638, length: 12, "tool-calls": 13, error: 18 }),
				}),
			},
			{
				source: "ai-sdk",
				operation: "generate-text",
				functionId: "document-agent",
				overflow: false,
				...operationMetrics({
					started: 419,
					active: 2,
					outcomes: outcomes(403, 10, 4),
					duration: distribution(417, 920, 710, 2_400, 5_100, 8_221),
					usage: scaledUsage(operationUsage, 0.35),
					finishReasons: finishReasons({ stop: 389, length: 7, "tool-calls": 11, error: 10 }),
				}),
			},
			{
				source: "ai-sdk",
				operation: "embed-many",
				overflow: false,
				...operationMetrics({
					started: 88,
					active: 1,
					outcomes: outcomes(84, 3, 0),
					duration: distribution(87, 241, 180, 620, 1_100, 1_342),
					usage: usage({ embeddingTokens: 46_000 }, { embeddingTokens: 87 }),
				}),
			},
		],
		models: [
			modelGroup("openai", "gpt-5.2", 486, 2, outcomes(474, 7, 3), 1_500, 1_280_000),
			modelGroup("anthropic", "claude-sonnet", 318, 1, outcomes(306, 8, 3), 1_900, 742_000),
			modelGroup("google", "gemini-pro", 211, 1, outcomes(202, 7, 1), 2_500, 398_000),
			{
				source: "ai-sdk",
				modality: "embedding",
				provider: "openai",
				model: "text-embedding-3-small",
				overflow: false,
				...modelMetrics({
					started: 45,
					active: 1,
					outcomes: outcomes(43, 1, 0),
					duration: distribution(44, 188, 150, 420, 790, 822),
					usage: usage({ embeddingTokens: 46_000 }, { embeddingTokens: 44 }),
				}),
			},
		],
		tools: [
			toolGroup("knowledge.search", 91, 1, outcomes(88, 1, 0), 510),
			toolGroup("ticket.lookup", 56, 0, outcomes(53, 1, 1), 780),
			toolGroup("document.read", 43, 1, outcomes(40, 0, 0), 340),
		],
		coverage: {
			contentCaptured: false,
			signals: {
				operations: { started: 1_255, completed: 1_248, abandoned: 0 },
				steps: { started: 2_050, completed: 2_040, abandoned: 8 },
				modelCalls: { started: 1_024, completed: 1_015, abandoned: 5 },
				toolExecutions: { started: 190, completed: 184, abandoned: 4 },
				embeddingCalls: { started: 45, completed: 44, abandoned: 0 },
				rerankingCalls: { started: 17, completed: 17, abandoned: 0 },
			},
		},
		collector: {
			events: {
				received: 12_881,
				applied: 12_842,
				discarded: {
					unsupportedVersion: 0,
					invalid: 0,
					duplicate: 24,
					conflict: 0,
					orphanTerminal: 3,
					terminalAfterAbandonment: 4,
					beforeCollectorStart: 0,
					future: 0,
				},
				outsideWindow: 0,
				rejectedFields: { dimension: 0, duration: 0, usage: 0, performance: 0 },
			},
			active: {
				tracked: 17,
				limit: 4_096,
				ttlSeconds: 3_600,
				abandoned: { ttl: 3, capacity: 0, parent: 14 },
			},
			replayProtection: { retained: 12_881, limit: 16_384, ttlSeconds: 3_600, evicted: 0 },
			groups: {
				operations: { retained: 3, concrete: 3, limit: 100, eventsFolded: 0, truncated: false },
				models: { retained: 4, concrete: 4, limit: 100, eventsFolded: 0, truncated: false },
				tools: { retained: 3, concrete: 3, limit: 100, eventsFolded: 0, truncated: false },
			},
			clockRegressions: 0,
			counterSaturated: false,
		},
	};
}

function demoBucket(
	startedAt: number,
	values: readonly [number, number, number] | undefined,
): AiObservabilityBucketView {
	const operationOutcomes = values === undefined ? outcomes() : outcomes(...values);
	const completed = completedCount(operationOutcomes);
	const operationDuration =
		completed === 0 ? distribution() : distribution(completed, 740, 600, 1_900, 4_200, 5_400);
	const operationWindow = windowOperation({
		started: completed + (completed > 0 ? 1 : 0),
		outcomes: operationOutcomes,
		duration: operationDuration,
		usage:
			completed === 0
				? usage()
				: usage(
						{
							inputTokens: completed * 1_380,
							outputTokens: completed * 462,
							totalTokens: completed * 1_842,
						},
						{ inputTokens: completed, outputTokens: completed, totalTokens: completed },
					),
		finishReasons: finishReasons({
			stop: operationOutcomes.success,
			error: operationOutcomes.error,
		}),
	});
	return {
		startedAt: new Date(startedAt).toISOString(),
		operations: operationWindow,
		steps: windowLifecycle({
			started: completed * 2,
			outcomes: outcomes(completed * 2 - operationOutcomes.error, operationOutcomes.error),
			duration: operationDuration,
		}),
		modelCalls: windowModel({
			started: completed,
			outcomes: operationOutcomes,
			duration: operationDuration,
			usage: operationWindow.usage,
			finishReasons: operationWindow.finishReasons,
			performance: performance({
				ttfo:
					completed === 0
						? distribution()
						: distribution(Math.ceil(completed * 0.4), 270, 180, 720, 1_500, 1_800),
			}),
		}),
		toolExecutions: windowLifecycle({
			started: Math.floor(completed * 0.15),
			outcomes: outcomes(Math.floor(completed * 0.15)),
			duration:
				completed === 0
					? distribution()
					: distribution(Math.floor(completed * 0.15), 320, 200, 900, 1_700, 2_100),
		}),
		embeddingCalls: windowModel(),
		rerankingCalls: windowModel(),
	};
}

function outcomes(success = 0, error = 0, aborted = 0): AiMetricOutcomesView {
	return { success, error, aborted };
}

function completedCount(value: AiMetricOutcomesView): number {
	return value.success + value.error + value.aborted;
}

function distribution(
	count = 0,
	average: number | null = null,
	p50: number | null = null,
	p95: number | null = null,
	p99: number | null = null,
	max: number | null = null,
): AiMetricDistributionView {
	return { count, average, p50, p95, p99, max };
}

function tokenTotals(values: Partial<AiTokenTotalsView> = {}): AiTokenTotalsView {
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
		...values,
	};
}

function usage(
	totals: Partial<AiTokenTotalsView> = {},
	samples: Partial<AiTokenTotalsView> = {},
): AiUsageMetricsView {
	return { totals: tokenTotals(totals), samples: tokenTotals(samples) };
}

function scaledUsage(value: AiUsageMetricsView, scale: number): AiUsageMetricsView {
	return {
		totals: mapTokenTotals(value.totals, scale),
		samples: mapTokenTotals(value.samples, scale),
	};
}

function mapTokenTotals(value: AiTokenTotalsView, scale: number): AiTokenTotalsView {
	return Object.fromEntries(
		Object.entries(value).map(([key, amount]) => [key, Math.round(amount * scale)]),
	) as unknown as AiTokenTotalsView;
}

function finishReasons(values: Partial<AiFinishReasonCountsView> = {}): AiFinishReasonCountsView {
	return {
		stop: 0,
		length: 0,
		"content-filter": 0,
		"tool-calls": 0,
		error: 0,
		other: 0,
		unknown: 0,
		...values,
	};
}

interface LifecycleInput {
	readonly started?: number;
	readonly active?: number;
	readonly outcomes?: AiMetricOutcomesView;
	readonly abandoned?: AiLifecycleMetricsView["abandoned"];
	readonly duration?: AiMetricDistributionView;
}

function lifecycle(input: LifecycleInput = {}): AiLifecycleMetricsView {
	return {
		started: input.started ?? 0,
		active: input.active ?? 0,
		outcomes: input.outcomes ?? outcomes(),
		abandoned: input.abandoned ?? { ttl: 0, capacity: 0, parent: 0 },
		durationMs: input.duration ?? distribution(),
	};
}

function windowLifecycle(input: Omit<LifecycleInput, "active"> = {}): AiWindowLifecycleMetricsView {
	const value = lifecycle(input);
	return {
		started: value.started,
		outcomes: value.outcomes,
		abandoned: value.abandoned,
		durationMs: value.durationMs,
	};
}

function operationMetrics(
	input: LifecycleInput & {
		readonly usage?: AiUsageMetricsView;
		readonly finishReasons?: AiFinishReasonCountsView;
	} = {},
): AiOperationMetricsView {
	return {
		...lifecycle(input),
		usage: input.usage ?? usage(),
		finishReasons: input.finishReasons ?? finishReasons(),
	};
}

function windowOperation(
	input: Omit<LifecycleInput, "active"> & {
		readonly usage?: AiUsageMetricsView;
		readonly finishReasons?: AiFinishReasonCountsView;
	} = {},
): AiWindowOperationMetricsView {
	return {
		...windowLifecycle(input),
		usage: input.usage ?? usage(),
		finishReasons: input.finishReasons ?? finishReasons(),
	};
}

function performance(
	values: {
		readonly ttfo?: AiMetricDistributionView;
		readonly effectiveOutputRate?: AiMetricDistributionView;
	} = {},
): AiModelPerformanceMetricsView {
	return {
		timeToFirstOutputMs: values.ttfo ?? distribution(),
		effectiveOutputTokensPerSecond: values.effectiveOutputRate ?? distribution(),
		outputTokensPerSecond: distribution(),
		inputTokensPerSecond: distribution(),
		effectiveTotalTokensPerSecond: distribution(),
	};
}

function modelMetrics(
	input: Parameters<typeof operationMetrics>[0] & {
		readonly performance?: AiModelPerformanceMetricsView;
	} = {},
): AiModelMetricsView {
	return { ...operationMetrics(input), performance: input.performance ?? performance() };
}

function windowModel(
	input: Parameters<typeof windowOperation>[0] & {
		readonly performance?: AiModelPerformanceMetricsView;
	} = {},
): AiWindowModelMetricsView {
	return { ...windowOperation(input), performance: input.performance ?? performance() };
}

function modelGroup(
	provider: string,
	model: string,
	started: number,
	active: number,
	modelOutcomes: AiMetricOutcomesView,
	p95: number,
	totalTokens: number,
) {
	const completed = completedCount(modelOutcomes);
	return {
		source: "ai-sdk",
		modality: "language" as const,
		provider,
		model,
		overflow: false,
		...modelMetrics({
			started,
			active,
			outcomes: modelOutcomes,
			duration: distribution(
				completed,
				Math.round(p95 * 0.45),
				Math.round(p95 * 0.32),
				p95,
				Math.round(p95 * 2.3),
				Math.round(p95 * 3.2),
			),
			usage: usage({ totalTokens }, { totalTokens: completed }),
			finishReasons: finishReasons({ stop: modelOutcomes.success, error: modelOutcomes.error }),
		}),
	};
}

function toolGroup(
	tool: string,
	started: number,
	active: number,
	toolOutcomes: AiMetricOutcomesView,
	p95: number,
) {
	const completed = completedCount(toolOutcomes);
	return {
		source: "ai-sdk",
		tool,
		overflow: false,
		...lifecycle({
			started,
			active,
			outcomes: toolOutcomes,
			abandoned: { ttl: 0, capacity: 0, parent: Math.max(0, started - active - completed) },
			duration: distribution(
				completed,
				Math.round(p95 * 0.45),
				Math.round(p95 * 0.3),
				p95,
				Math.round(p95 * 1.8),
				Math.round(p95 * 2.1),
			),
		}),
	};
}
