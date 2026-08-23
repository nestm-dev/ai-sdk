"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, LoaderCircle, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { DashboardContent } from "@/components/dashboard-content";
import type { AiObservabilityDashboardDataSource } from "@/lib/snapshot-client";
import { snapshotQueryOptions } from "@/lib/snapshot-query";

export function ObservabilityDashboard({
	source,
}: {
	readonly source?: AiObservabilityDashboardDataSource;
}) {
	const query = useQuery(snapshotQueryOptions(source));
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => window.clearInterval(timer);
	}, []);

	if (!query.data && query.isPending) return <LoadingState />;

	if (!query.data) {
		const message =
			query.error instanceof Error
				? query.error.message
				: "The observability source is temporarily unavailable.";
		return <ErrorState message={message} onRetry={() => void query.refetch()} />;
	}

	return (
		<DashboardContent
			capture={query.data}
			now={now}
			refreshing={query.isFetching}
			refreshError={query.isError ? query.error : undefined}
			onRefresh={() => void query.refetch()}
		/>
	);
}

function LoadingState() {
	return (
		<main className="state-shell" aria-busy="true" aria-live="polite">
			<div className="state-card">
				<span aria-hidden="true" className="brand-mark state-brand">
					N
				</span>
				<LoaderCircle aria-hidden="true" className="state-icon animate-spin" />
				<h1>Connecting to process telemetry</h1>
				<p>Validating the latest bounded, content-free snapshot.</p>
			</div>
		</main>
	);
}

function ErrorState({
	message,
	onRetry,
}: {
	readonly message: string;
	readonly onRetry: () => void;
}) {
	return (
		<main className="state-shell">
			<div className="state-card" role="alert">
				<span aria-hidden="true" className="brand-mark state-brand">
					N
				</span>
				<AlertTriangle aria-hidden="true" className="state-icon text-[#e8ad58]" />
				<h1>Snapshot unavailable</h1>
				<p>{message}</p>
				<button className="primary-button mt-6" type="button" onClick={onRetry}>
					<RotateCcw aria-hidden="true" />
					Try again
				</button>
			</div>
		</main>
	);
}
