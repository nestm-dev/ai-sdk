import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelPlayground } from "@/components/model-playground";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("model playground", () => {
	it("runs selected providers, renders partial results, and refreshes telemetry", async () => {
		const onCompleted = vi.fn();
		const fetchMock = vi.fn().mockResolvedValue(Response.json(comparisonResponse()));
		vi.stubGlobal("fetch", fetchMock);
		render(<ModelPlayground onCompleted={onCompleted} />);

		expect(screen.getByLabelText("OpenAI")).toBeChecked();
		expect(screen.getByLabelText("Anthropic")).toBeChecked();
		expect(screen.getByLabelText("Gemini")).toBeChecked();
		fireEvent.click(screen.getByRole("button", { name: "Run 3 models" }));

		expect(await screen.findByText("OpenAI response")).toBeVisible();
		expect(screen.getByText("Gemini response")).toBeVisible();
		expect(screen.getByText("Credential rejected by provider.")).toBeVisible();
		expect(screen.getByText("2 succeeded · 1 failed")).toBeVisible();
		expect(onCompleted).toHaveBeenCalledOnce();
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/compare",
			expect.objectContaining({ method: "POST", cache: "no-store" }),
		);
	});

	it("keeps provider failures generic and allows clearing transient outputs", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(comparisonResponse())));
		render(<ModelPlayground onCompleted={() => undefined} />);

		fireEvent.click(screen.getByRole("button", { name: "Run 3 models" }));
		await screen.findByText("OpenAI response");
		fireEvent.click(screen.getByRole("button", { name: "Clear responses" }));

		await waitFor(() => expect(screen.queryByText("OpenAI response")).not.toBeInTheDocument());
	});

	it("shows a safe connection error", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));
		render(<ModelPlayground onCompleted={() => undefined} />);

		fireEvent.click(screen.getByRole("button", { name: "Run 3 models" }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"The local playground could not complete this comparison",
		);
	});
});

function comparisonResponse() {
	return {
		runId: "24670caf-8bb0-4f72-bb6f-de197c12d97f",
		startedAt: "2026-08-23T18:00:00.000Z",
		results: [
			{
				provider: "openai",
				model: "gpt-5-mini",
				status: "success",
				text: "OpenAI response",
				finishReason: "stop",
				latencyMs: 120,
				usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 },
			},
			{
				provider: "anthropic",
				model: "claude-haiku-4-5",
				status: "error",
				code: "unauthorized",
				retryable: false,
				latencyMs: 80,
			},
			{
				provider: "google",
				model: "gemini-2.5-flash",
				status: "success",
				text: "Gemini response",
				finishReason: "stop",
				latencyMs: 100,
				usage: { inputTokens: null, outputTokens: null, totalTokens: null },
			},
		],
		summary: { requested: 3, succeeded: 2, failed: 1 },
	};
}
