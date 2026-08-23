import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ObservabilityDashboard } from "@/components/observability-dashboard";
import { createDemoSnapshot } from "@/lib/demo-snapshot";
import type { AiObservabilityDashboardDataSource, DashboardCapture } from "@/lib/snapshot-client";

describe("dashboard query states", () => {
	it("shows a bounded loading state", () => {
		const source: AiObservabilityDashboardDataSource = {
			snapshot: () => new Promise<DashboardCapture>(() => undefined),
		};
		renderWithClient(<ObservabilityDashboard source={source} />);

		expect(screen.getByText("Connecting to process telemetry")).toBeVisible();
	});

	it("shows a safe initial error with an explicit retry", async () => {
		const source: AiObservabilityDashboardDataSource = {
			snapshot: vi.fn().mockRejectedValue(new Error("Safe source message")),
		};
		renderWithClient(<ObservabilityDashboard source={source} />);

		expect(await screen.findByRole("alert")).toHaveTextContent("Safe source message");
		expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
	});

	it("retains stale data and clears the warning after recovery", async () => {
		const first = capture(8_421);
		const recovered = capture(8_422);
		const snapshot = vi
			.fn()
			.mockResolvedValueOnce(first)
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce(recovered);
		renderWithClient(<ObservabilityDashboard source={{ snapshot }} />);

		expect(await screen.findByText("Demo process")).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "Refresh telemetry snapshot" }));
		expect(await screen.findByRole("status")).toHaveTextContent("last accepted");

		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
		expect(snapshot).toHaveBeenCalledTimes(3);
	});
});

function capture(revision: number): DashboardCapture {
	return {
		snapshot: { ...createDemoSnapshot(), revision },
		source: "demo",
		receivedAt: Date.now(),
	};
}

function renderWithClient(ui: ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
