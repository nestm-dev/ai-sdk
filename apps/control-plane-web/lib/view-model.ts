import type {
	AiMetricAbandonedView,
	AiMetricOutcomesView,
	AiModelGroupView,
	AiObservabilitySnapshotV1,
	AiSignalCoverageView,
	AiTokenTotalsView,
} from "@nestm/ai-sdk/observability/core";

const compactNumber = new Intl.NumberFormat("en", {
	notation: "compact",
	maximumFractionDigits: 2,
});
const plainNumber = new Intl.NumberFormat("en");
const percentNumber = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const decimalNumber = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const utcTime = new Intl.DateTimeFormat("en-GB", {
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hourCycle: "h23",
	timeZone: "UTC",
});

export function completedCount(outcomes: AiMetricOutcomesView): number {
	return outcomes.success + outcomes.error + outcomes.aborted;
}

export function successRate(outcomes: AiMetricOutcomesView): number | null {
	const completed = completedCount(outcomes);
	return completed === 0 ? null : (outcomes.success / completed) * 100;
}

export function resolvedCoverage(signal: AiSignalCoverageView): number | null {
	return signal.started === 0
		? null
		: ((signal.completed + signal.abandoned) / signal.started) * 100;
}

export function abandonmentCount(abandoned: AiMetricAbandonedView): number {
	return abandoned.ttl + abandoned.capacity + abandoned.parent;
}

export function formatCount(value: number): string {
	return plainNumber.format(value);
}

export function formatCompact(value: number): string {
	return compactNumber.format(value);
}

export function formatPercent(value: number | null): string {
	return value === null ? "—" : `${percentNumber.format(value)}%`;
}

export function formatDuration(value: number | null): string {
	if (value === null) return "—";
	if (value >= 1_000) return `${decimalNumber.format(value / 1_000)} s`;
	return `${decimalNumber.format(value)} ms`;
}

export function formatRate(value: number | null): string {
	return value === null ? "—" : `${decimalNumber.format(value)} tok/s`;
}

export function formatBucketTime(value: string): string {
	return `${utcTime.format(new Date(value))} UTC`;
}

export function formatWindow(snapshot: AiObservabilitySnapshotV1): string {
	const seconds = snapshot.window.bucketSeconds * snapshot.window.buckets.length;
	return seconds < 60
		? `${String(seconds)} second window`
		: `${decimalNumber.format(seconds / 60)} minute window`;
}

export function formatFreshness(receivedAt: number, now: number): string {
	const seconds = Math.max(0, Math.round((now - receivedAt) / 1_000));
	return seconds < 2 ? "updated now" : `updated ${String(seconds)}s ago`;
}

export function tokenField(
	snapshot: AiObservabilitySnapshotV1,
	field: keyof AiTokenTotalsView,
): { readonly total: number; readonly samples: number; readonly reported: boolean } {
	const usage = snapshot.totals.operations.usage;
	return {
		total: usage.totals[field],
		samples: usage.samples[field],
		reported: usage.samples[field] > 0,
	};
}

export function sortModelGroups(groups: readonly AiModelGroupView[]): readonly AiModelGroupView[] {
	return groups.toSorted((left, right) => {
		const volume = completedCount(right.outcomes) - completedCount(left.outcomes);
		if (volume !== 0) return volume;
		const provider = left.provider.localeCompare(right.provider);
		if (provider !== 0) return provider;
		const model = left.model.localeCompare(right.model);
		if (model !== 0) return model;
		return left.modality.localeCompare(right.modality);
	});
}

export function bucketAccessibleLabel(
	bucket: AiObservabilitySnapshotV1["window"]["buckets"][number],
): string {
	const outcomes = bucket.operations.outcomes;
	return `${formatBucketTime(bucket.startedAt)}: ${String(outcomes.success)} successful, ${String(outcomes.error)} failed, ${String(outcomes.aborted)} aborted; operation p95 ${formatDuration(bucket.operations.durationMs.p95)}.`;
}

export function collectorIssueCount(snapshot: AiObservabilitySnapshotV1): number {
	const discarded = Object.values(snapshot.collector.events.discarded).reduce(
		(sum, count) => sum + count,
		0,
	);
	const rejected = Object.values(snapshot.collector.events.rejectedFields).reduce(
		(sum, count) => sum + count,
		0,
	);
	return (
		discarded +
		rejected +
		snapshot.collector.clockRegressions +
		snapshot.collector.replayProtection.evicted
	);
}

export function totalAbandonment(snapshot: AiObservabilitySnapshotV1): number {
	return (
		abandonmentCount(snapshot.totals.operations.abandoned) +
		abandonmentCount(snapshot.totals.steps.abandoned) +
		abandonmentCount(snapshot.totals.modelCalls.abandoned) +
		abandonmentCount(snapshot.totals.toolExecutions.abandoned) +
		abandonmentCount(snapshot.totals.embeddingCalls.abandoned) +
		abandonmentCount(snapshot.totals.rerankingCalls.abandoned)
	);
}

export function groupTruncationCount(snapshot: AiObservabilitySnapshotV1): number {
	return (
		snapshot.collector.groups.operations.eventsFolded +
		snapshot.collector.groups.models.eventsFolded +
		snapshot.collector.groups.tools.eventsFolded
	);
}
