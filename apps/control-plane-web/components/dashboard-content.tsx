"use client";

import type {
	AiMetricDistributionView,
	AiMetricOutcomesView,
	AiSignalCoverageView,
	AiUsageMetricsView,
} from "@nestm/ai-sdk/observability/core";
import { RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";

import { ModelPlayground } from "@/components/model-playground";
import type { DashboardCapture } from "@/lib/snapshot-client";
import {
	bucketAccessibleLabel,
	collectorIssueCount,
	completedCount,
	formatBucketTime,
	formatCompact,
	formatCount,
	formatDuration,
	formatFreshness,
	formatPercent,
	formatRate,
	formatWindow,
	groupTruncationCount,
	resolvedCoverage,
	sortModelGroups,
	successRate,
	tokenField,
	totalAbandonment,
} from "@/lib/view-model";

export interface DashboardContentProps {
	readonly capture: DashboardCapture;
	readonly now: number;
	readonly refreshing: boolean;
	readonly refreshError?: unknown;
	readonly onRefresh: () => void;
}

export function DashboardContent({
	capture,
	now,
	refreshing,
	refreshError,
	onRefresh,
}: DashboardContentProps) {
	const { snapshot } = capture;
	const operations = snapshot.totals.operations;
	const completed = completedCount(operations.outcomes);
	const buckets = snapshot.window.buckets;
	const maxBucket = Math.max(
		1,
		...buckets.map((bucket) => completedCount(bucket.operations.outcomes)),
	);
	const models = sortModelGroups(snapshot.models).slice(0, 6);
	const issues = collectorIssueCount(snapshot);
	const folded = groupTruncationCount(snapshot);
	const abandoned = totalAbandonment(snapshot);
	const firstBucket = buckets.at(0);
	const lastBucket = buckets.at(-1);
	const totalTokens = tokenField(snapshot, "totalTokens");
	const performance = snapshot.totals.modelCalls.performance;

	return (
		<main className="min-h-screen pb-12">
			<header className="border-b border-white/8 bg-[#09100f]/90 backdrop-blur-xl">
				<div className="mx-auto flex max-w-[1480px] items-center justify-between gap-4 px-5 py-4 sm:px-8">
					<div className="flex items-center gap-3">
						<span aria-hidden="true" className="brand-mark">
							N
						</span>
						<div>
							<p className="text-sm font-semibold tracking-tight text-white">NestM</p>
							<p className="text-[11px] text-[#82928d]">AI observability</p>
						</div>
					</div>
					<div className="flex items-center gap-3">
						<span className={`live-badge ${capture.source === "live" ? "is-live" : ""}`}>
							<span aria-hidden="true" />
							{capture.source === "live" ? "Live process" : "Demo process"}
						</span>
						<span className="hidden font-mono text-[11px] text-[#65746f] sm:inline">
							{formatFreshness(capture.receivedAt, now)}
						</span>
						<button
							aria-label="Refresh telemetry snapshot"
							className="icon-button"
							disabled={refreshing}
							type="button"
							onClick={onRefresh}
						>
							<RefreshCw aria-hidden="true" className={refreshing ? "animate-spin" : ""} />
						</button>
					</div>
				</div>
			</header>

			<div className="mx-auto max-w-[1480px] px-5 pt-8 sm:px-8">
				{refreshError !== undefined ? (
					<div className="stale-banner" role="status" aria-live="polite">
						<TriangleAlert aria-hidden="true" />
						<span>
							The latest refresh failed. Showing the last accepted process snapshot at revision{" "}
							{formatCount(snapshot.revision)}.
						</span>
						<button type="button" onClick={onRefresh}>
							Retry
						</button>
					</div>
				) : null}

				<ModelPlayground onCompleted={onRefresh} />

				<section aria-labelledby="overview-heading">
					<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
						<div>
							<p className="eyebrow">
								{snapshot.scope} telemetry · {formatWindow(snapshot)} · revision{" "}
								{formatCount(snapshot.revision)}
							</p>
							<h1
								id="overview-heading"
								className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl"
							>
								Model operations at a glance
							</h1>
							<p className="mt-2 max-w-2xl text-sm leading-6 text-[#84938e]">
								Content-free lifecycle, latency, usage, and capture completeness for AI operations
								in this NestJS process.
							</p>
						</div>
						<div className="flex items-center gap-2 text-xs text-[#74837e]">
							<span className="coverage-dot" />
							{formatPercent(resolvedCoverage(snapshot.coverage.signals.operations))} of captured
							operation starts resolved
						</div>
					</div>

					<dl className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-5">
						<Metric
							label="Operations started"
							value={formatCount(operations.started)}
							detail={`${formatCount(completed)} completed · ${formatCount(operations.active)} active`}
						/>
						<Metric
							label="Success among completed"
							value={formatPercent(successRate(operations.outcomes))}
							detail={`${formatCount(operations.outcomes.error)} failed · ${formatCount(operations.outcomes.aborted)} aborted`}
							tone="good"
						/>
						<Metric
							label="Operation P95"
							value={formatDuration(operations.durationMs.p95)}
							detail={`P50 ${formatDuration(operations.durationMs.p50)} · P99 ${formatDuration(operations.durationMs.p99)}`}
						/>
						<Metric
							label="Reported total tokens"
							value={totalTokens.reported ? formatCompact(totalTokens.total) : "—"}
							detail={
								totalTokens.reported
									? `${formatCount(totalTokens.samples)} usage samples`
									: "No total-token samples"
							}
						/>
						<Metric
							label="Active operations"
							value={formatCount(operations.active)}
							detail={`${formatCount(snapshot.totals.modelCalls.active)} model · ${formatCount(snapshot.totals.toolExecutions.active)} tool · ${formatCount(snapshot.totals.embeddingCalls.active)} embed`}
							tone="live"
						/>
					</dl>
				</section>

				<section
					className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.75fr)]"
					aria-label="Window activity and reported usage"
				>
					<article className="panel min-w-0 p-5 sm:p-6">
						<div className="flex items-start justify-between gap-4">
							<div>
								<h2 className="panel-title">Outcomes over time</h2>
								<p className="panel-copy">
									Terminal AI operations in {formatCount(snapshot.window.bucketSeconds)}-second
									buckets
								</p>
							</div>
							<ul
								className="flex flex-wrap justify-end gap-3 text-[11px] text-[#82918c]"
								aria-label="Outcome legend"
							>
								<Legend color="#4dd4a3" label="Success" />
								<Legend color="#ff786f" label="Error" />
								<Legend color="#e8ad58" label="Aborted" />
							</ul>
						</div>
						<figure className="mt-7">
							<figcaption className="sr-only">
								Stacked terminal outcome counts across the {formatWindow(snapshot)}.
							</figcaption>
							<ol className="chart-grid" aria-label="Operation outcome buckets">
								{buckets.map((bucket) => {
									const outcomes = bucket.operations.outcomes;
									const total = completedCount(outcomes);
									return (
										<li key={bucket.startedAt} className="chart-column">
											<span className="sr-only">{bucketAccessibleLabel(bucket)}</span>
											<div
												className="chart-stack"
												style={{ height: `${(total / maxBucket) * 100}%` }}
												aria-hidden="true"
											>
												<span
													className="bg-[#4dd4a3]"
													style={{ height: `${segmentPercent(outcomes.success, total)}%` }}
												/>
												<span
													className="bg-[#ff786f]"
													style={{ height: `${segmentPercent(outcomes.error, total)}%` }}
												/>
												<span
													className="bg-[#e8ad58]"
													style={{ height: `${segmentPercent(outcomes.aborted, total)}%` }}
												/>
											</div>
										</li>
									);
								})}
							</ol>
							<div className="mt-2 flex justify-between font-mono text-[10px] text-[#52615c]">
								<span>{firstBucket ? formatBucketTime(firstBucket.startedAt) : "No buckets"}</span>
								<span>{lastBucket ? formatBucketTime(lastBucket.startedAt) : "No buckets"}</span>
							</div>
						</figure>
					</article>

					<article className="panel p-5 sm:p-6">
						<h2 className="panel-title">Reported usage</h2>
						<p className="panel-copy">
							Independent operation totals with their own sample coverage
						</p>
						<div className="token-total mt-6">
							<span>Total tokens</span>
							<strong>{totalTokens.reported ? formatCompact(totalTokens.total) : "—"}</strong>
							<small>
								{totalTokens.reported
									? `${formatCount(totalTokens.samples)} reporting operations`
									: "Not reported"}
							</small>
						</div>
						<dl className="mt-5 space-y-3 text-xs">
							<TokenRow
								color="#7fe2bc"
								label="Input"
								{...usageField(operations.usage, "inputTokens")}
							/>
							<TokenRow
								color="#79a7ff"
								label="Output"
								{...usageField(operations.usage, "outputTokens")}
							/>
							<TokenRow
								color="#c89cff"
								label="↳ Reasoning detail"
								{...usageField(operations.usage, "reasoningOutputTokens")}
							/>
							<TokenRow
								color="#e8ad58"
								label="↳ Cache-read detail"
								{...usageField(operations.usage, "cacheReadInputTokens")}
							/>
						</dl>
						<div className="mt-6 border-t border-white/7 pt-5">
							<h3 className="text-[11px] font-medium text-[#9caaa5]">Streaming performance</h3>
							<div className="mt-3 grid grid-cols-2 gap-3">
								<PerformanceStat
									label="Time to first output P95"
									value={formatDuration(performance.timeToFirstOutputMs.p95)}
									samples={performance.timeToFirstOutputMs.count}
									sampleLabel="streaming samples"
								/>
								<PerformanceStat
									label="Effective output rate P50"
									value={formatRate(performance.effectiveOutputTokensPerSecond.p50)}
									samples={performance.effectiveOutputTokensPerSecond.count}
									sampleLabel="reported samples"
								/>
							</div>
						</div>
					</article>
				</section>

				<section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(330px,0.65fr)]">
					<article className="panel min-w-0 overflow-hidden">
						<div className="border-b border-white/7 px-5 py-5 sm:px-6">
							<h2 className="panel-title">Model breakdown</h2>
							<p className="panel-copy">
								Provider/model attribution; never added to operation totals
							</p>
						</div>
						<div className="overflow-x-auto">
							<table className="w-full min-w-[720px] text-left text-xs">
								<caption className="sr-only">
									Model attempts, success, latency, and independently reported usage
								</caption>
								<thead className="text-[10px] uppercase tracking-[0.12em] text-[#60706a]">
									<tr>
										<th>Provider / model</th>
										<th>Started</th>
										<th>Success</th>
										<th>P95</th>
										<th>Reported tokens</th>
									</tr>
								</thead>
								<tbody>
									{models.length === 0 ? (
										<EmptyTableRow columns={5} label="No model groups captured" />
									) : (
										models.map((row) => {
											const tokens = usageField(row.usage, "totalTokens");
											return (
												<tr
													key={`${row.source}:${row.modality}:${row.provider}:${row.model}:${String(row.overflow)}`}
												>
													<td>
														<span className="provider-mark">
															{row.provider.slice(0, 1).toUpperCase()}
														</span>
														<span className="text-[#c8d2ce]">{row.provider}</span>
														<span className="mx-2 text-[#4f5f59]">/</span>
														<span className="font-mono text-[11px] text-[#7f8e89]">
															{row.model}
														</span>
														{row.modality !== "language" ? (
															<span className="row-tag">{row.modality}</span>
														) : null}
														{row.overflow ? (
															<span className="row-tag is-warning">folded</span>
														) : null}
													</td>
													<td>{formatCount(row.started)}</td>
													<td className="text-[#75d8b2]">
														{formatPercent(successRate(row.outcomes))}
													</td>
													<td>{formatDuration(row.durationMs.p95)}</td>
													<td>
														{tokens.reported ? formatCompact(tokens.total) : "—"}
														<SampleHint samples={tokens.samples} />
													</td>
												</tr>
											);
										})
									)}
								</tbody>
							</table>
						</div>
					</article>

					<article className="panel p-5 sm:p-6">
						<div className="flex items-start justify-between gap-4">
							<div>
								<h2 className="panel-title">Signal quality</h2>
								<p className="panel-copy">
									Captured lifecycle completeness and bounded-state diagnostics
								</p>
							</div>
							<span className="status-pill">
								<ShieldCheck aria-hidden="true" /> Content-free
							</span>
						</div>
						<ul className="mt-5 space-y-4">
							<Quality label="Operations resolved" signal={snapshot.coverage.signals.operations} />
							<Quality label="Model calls resolved" signal={snapshot.coverage.signals.modelCalls} />
							<Quality label="Tools resolved" signal={snapshot.coverage.signals.toolExecutions} />
						</ul>
						<div className="mt-6 grid grid-cols-3 gap-2 border-t border-white/7 pt-5 text-center">
							<SmallStat label="Folded" value={formatCount(folded)} />
							<SmallStat label="Collector notes" value={formatCount(issues)} />
							<SmallStat label="Abandoned" value={formatCount(abandoned)} />
						</div>
						<p className="mt-5 text-[10px] leading-5 text-[#56655f]">
							Scope is one process. Counts are not a multi-replica aggregate, and model or tool
							content is never captured.
						</p>
					</article>
				</section>

				<section className="mt-4 grid gap-4 xl:grid-cols-2" aria-label="Operation and tool groups">
					<BreakdownTable
						title="Operation groups"
						copy="Function-level AI SDK operations"
						rows={snapshot.operations.map((row) => ({
							key: `${row.source}:${row.operation}:${row.functionId ?? ""}:${String(row.overflow)}`,
							name: row.operation,
							context: row.functionId ?? row.source,
							started: row.started,
							active: row.active,
							outcomes: row.outcomes,
							duration: row.durationMs,
							overflow: row.overflow,
						}))}
					/>
					<BreakdownTable
						title="Tool groups"
						copy="Tool lifecycle signals without arguments or results"
						rows={snapshot.tools.map((row) => ({
							key: `${row.source}:${row.tool}:${String(row.overflow)}`,
							name: row.tool,
							context: row.source,
							started: row.started,
							active: row.active,
							outcomes: row.outcomes,
							duration: row.durationMs,
							overflow: row.overflow,
						}))}
					/>
				</section>
			</div>
		</main>
	);
}

function segmentPercent(value: number, total: number): number {
	return total === 0 ? 0 : (value / total) * 100;
}

function Metric({
	label,
	value,
	detail,
	tone,
}: {
	readonly label: string;
	readonly value: string;
	readonly detail: string;
	readonly tone?: "good" | "live";
}) {
	return (
		<div className="metric-card">
			<dt>{label}</dt>
			<dd
				className={
					tone === "good" ? "text-[#72d9b0]" : tone === "live" ? "text-[#91b6ff]" : "text-white"
				}
			>
				{value}
			</dd>
			<p title={detail}>{detail}</p>
		</div>
	);
}

function Legend({ color, label }: { readonly color: string; readonly label: string }) {
	return (
		<li className="flex items-center gap-1.5">
			<span className="size-2 rounded-[2px]" style={{ background: color }} aria-hidden="true" />
			{label}
		</li>
	);
}

function usageField(usage: AiUsageMetricsView, field: keyof AiUsageMetricsView["totals"]) {
	return {
		total: usage.totals[field],
		samples: usage.samples[field],
		reported: usage.samples[field] > 0,
	};
}

function TokenRow({
	color,
	label,
	total,
	samples,
	reported,
}: {
	readonly color: string;
	readonly label: string;
	readonly total: number;
	readonly samples: number;
	readonly reported: boolean;
}) {
	return (
		<div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
			<dt className="flex items-center gap-2 text-[#7f8e89]">
				<span className="size-2 rounded-full" style={{ background: color }} aria-hidden="true" />
				{label}
			</dt>
			<dd className="font-mono text-[#c5d0cc]">{reported ? formatCompact(total) : "—"}</dd>
			<span className="col-span-2 mt-0.5 pl-4 text-[9px] text-[#53615c]">
				{reported ? `${formatCount(samples)} samples` : "not reported"}
			</span>
		</div>
	);
}

function PerformanceStat({
	label,
	value,
	samples,
	sampleLabel,
}: {
	readonly label: string;
	readonly value: string;
	readonly samples: number;
	readonly sampleLabel: string;
}) {
	return (
		<div className="performance-stat">
			<p>{label}</p>
			<strong>{samples > 0 ? value : "—"}</strong>
			<span>
				{formatCount(samples)} {sampleLabel}
			</span>
		</div>
	);
}

function Quality({
	label,
	signal,
}: {
	readonly label: string;
	readonly signal: AiSignalCoverageView;
}) {
	const percent = resolvedCoverage(signal);
	const resolved = signal.completed + signal.abandoned;
	return (
		<li>
			<div className="mb-2 flex items-center justify-between gap-3 text-xs">
				<span className="text-[#a2afaa]">{label}</span>
				<span className="font-mono text-[10px] text-[#677670]">
					{formatCount(resolved)} / {formatCount(signal.started)}
				</span>
			</div>
			<div
				aria-label={`${label}: ${formatPercent(percent)}`}
				aria-valuemax={100}
				aria-valuemin={0}
				aria-valuenow={percent === null ? undefined : Math.min(100, percent)}
				className="quality-track"
				role="progressbar"
			>
				<span style={{ width: `${percent === null ? 0 : Math.min(100, percent)}%` }} />
			</div>
		</li>
	);
}

function SmallStat({ label, value }: { readonly label: string; readonly value: string }) {
	return (
		<div>
			<p className="font-mono text-sm text-[#cbd5d1]">{value}</p>
			<p className="mt-1 text-[10px] text-[#60706a]">{label}</p>
		</div>
	);
}

function SampleHint({ samples }: { readonly samples: number }) {
	return samples > 0 ? <span className="sample-hint">{formatCount(samples)} samples</span> : null;
}

function EmptyTableRow({ columns, label }: { readonly columns: number; readonly label: string }) {
	return (
		<tr>
			<td className="empty-table" colSpan={columns}>
				{label}
			</td>
		</tr>
	);
}

interface BreakdownRow {
	readonly key: string;
	readonly name: string;
	readonly context: string;
	readonly started: number;
	readonly active: number;
	readonly outcomes: AiMetricOutcomesView;
	readonly duration: AiMetricDistributionView;
	readonly overflow: boolean;
}

function BreakdownTable({
	title,
	copy,
	rows,
}: {
	readonly title: string;
	readonly copy: string;
	readonly rows: readonly BreakdownRow[];
}) {
	return (
		<article className="panel min-w-0 overflow-hidden">
			<div className="border-b border-white/7 px-5 py-5 sm:px-6">
				<h2 className="panel-title">{title}</h2>
				<p className="panel-copy">{copy}</p>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full min-w-[560px] text-left text-xs">
					<caption className="sr-only">
						{title}: started, active, success among completed, and latency
					</caption>
					<thead className="text-[10px] uppercase tracking-[0.12em] text-[#60706a]">
						<tr>
							<th>Name</th>
							<th>Started</th>
							<th>Active</th>
							<th>Success</th>
							<th>P95</th>
						</tr>
					</thead>
					<tbody>
						{rows.length === 0 ? (
							<EmptyTableRow columns={5} label={`No ${title.toLowerCase()} captured`} />
						) : (
							rows.slice(0, 8).map((row) => (
								<tr key={row.key}>
									<td>
										<span className="font-mono text-[11px] text-[#c8d2ce]">{row.name}</span>
										<span className="sample-hint">{row.context}</span>
										{row.overflow ? <span className="row-tag is-warning">folded</span> : null}
									</td>
									<td>{formatCount(row.started)}</td>
									<td>{formatCount(row.active)}</td>
									<td className="text-[#75d8b2]">{formatPercent(successRate(row.outcomes))}</td>
									<td>{formatDuration(row.duration.p95)}</td>
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>
		</article>
	);
}
