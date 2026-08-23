import { queryOptions } from "@tanstack/react-query";

import {
	dashboardDataSource,
	type AiObservabilityDashboardDataSource,
} from "@/lib/snapshot-client";

export const SNAPSHOT_POLL_INTERVAL_MS = 5_000;

export const snapshotQueryKey = ["ai-observability", "snapshot"] as const;

export function snapshotQueryOptions(
	source: AiObservabilityDashboardDataSource = dashboardDataSource,
) {
	return queryOptions({
		queryKey: snapshotQueryKey,
		queryFn: ({ signal }) => source.snapshot(signal),
		refetchInterval: SNAPSHOT_POLL_INTERVAL_MS,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: "always",
		retry: false,
	});
}
