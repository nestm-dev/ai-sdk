import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DashboardContent } from "@/components/dashboard-content";
import { createDemoSnapshot } from "@/lib/demo-snapshot";

function renderDashboard(refreshError?: unknown) {
	const onRefresh = vi.fn();
	render(
		<DashboardContent
			capture={{ snapshot: createDemoSnapshot(), source: "demo", receivedAt: 1_000 }}
			now={5_000}
			refreshing={false}
			refreshError={refreshError}
			onRefresh={onRefresh}
		/>,
	);
	return onRefresh;
}

describe("dashboard content", () => {
	it("renders the validated process contract without combining attribution totals", () => {
		renderDashboard();

		expect(
			screen.getByRole("heading", { level: 1, name: "Model operations at a glance" }),
		).toBeVisible();
		expect(screen.getByText("Demo process")).toBeVisible();
		expect(
			screen.getByText("Provider/model attribution; never added to operation totals"),
		).toBeVisible();
		expect(screen.getByText("Function-level AI SDK operations")).toBeVisible();
		expect(screen.getByText("Tool lifecycle signals without arguments or results")).toBeVisible();
		expect(screen.getByText("Content-free")).toBeVisible();
		expect(screen.queryByText(/cost/i)).not.toBeInTheDocument();
	});

	it("exposes every chart bucket and unambiguous table headers", () => {
		renderDashboard();
		const chart = screen.getByRole("list", { name: "Operation outcome buckets" });
		const modelTable = screen.getByRole("table", { name: /Model attempts/ });

		expect(within(chart).getAllByRole("listitem")).toHaveLength(60);
		expect(within(modelTable).getByRole("columnheader", { name: "Started" })).toBeVisible();
		expect(
			within(modelTable).queryByRole("columnheader", { name: "Calls" }),
		).not.toBeInTheDocument();
	});

	it("keeps the accepted snapshot visible after a refresh error", () => {
		const onRefresh = renderDashboard(new Error("offline"));

		expect(screen.getByRole("status")).toHaveTextContent(
			"Showing the last accepted process snapshot",
		);
		expect(screen.getByRole("heading", { name: "Model operations at a glance" })).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(onRefresh).toHaveBeenCalledOnce();
	});
});
