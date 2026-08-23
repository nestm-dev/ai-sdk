import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/compare/route";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("local comparison proxy", () => {
	it("requires an explicitly configured local playground", async () => {
		vi.stubEnv("AI_OBSERVABILITY_API_URL", "");

		const response = await POST(compareRequest({ prompt: "hello" }));

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ code: "PLAYGROUND_NOT_CONNECTED" });
	});

	it("validates input before contacting the upstream", async () => {
		vi.stubEnv("AI_OBSERVABILITY_API_URL", "http://127.0.0.1:3001");
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const response = await POST(compareRequest({ prompt: "", extra: "not allowed" }));

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns only a strictly validated, no-store comparison", async () => {
		vi.stubEnv("AI_OBSERVABILITY_API_URL", "http://127.0.0.1:3001");
		const comparison = comparisonResponse();
		const fetchMock = vi.fn().mockResolvedValue(Response.json(comparison));
		vi.stubGlobal("fetch", fetchMock);

		const response = await POST(
			compareRequest({ prompt: "compare", providers: ["openai", "anthropic", "google"] }),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual(comparison);
		expect(fetchMock).toHaveBeenCalledWith(
			new URL("http://127.0.0.1:3001/playground/v1/compare"),
			expect.objectContaining({ method: "POST", cache: "no-store" }),
		);
	});

	it("rejects hostile upstream shapes without forwarding their content", async () => {
		vi.stubEnv("AI_OBSERVABILITY_API_URL", "http://127.0.0.1:3001");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(Response.json({ secret: "provider-body-sentinel" })),
		);

		const response = await POST(compareRequest({ prompt: "safe" }));
		const serialized = JSON.stringify(await response.json());

		expect(response.status).toBe(502);
		expect(serialized).not.toContain("provider-body-sentinel");
	});

	it("rejects oversized requests and mismatched provider results", async () => {
		vi.stubEnv("AI_OBSERVABILITY_API_URL", "http://127.0.0.1:3001");
		const fetchMock = vi.fn().mockResolvedValue(Response.json(comparisonResponse()));
		vi.stubGlobal("fetch", fetchMock);

		const oversized = await POST(compareRequest({ prompt: "x".repeat(5_000) }));
		expect(oversized.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();

		const mismatched = await POST(
			compareRequest({ prompt: "safe", providers: ["openai", "google"] }),
		);
		expect(mismatched.status).toBe(502);
		expect(await mismatched.json()).toMatchObject({ code: "PLAYGROUND_RESPONSE_INVALID" });
	});

	it("rejects non-loopback upstreams", async () => {
		vi.stubEnv("AI_OBSERVABILITY_API_URL", "https://api.example.test");
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const response = await POST(compareRequest({ prompt: "safe" }));

		expect(response.status).toBe(503);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

function compareRequest(body: unknown): Request {
	return new Request("http://dashboard.test/api/compare", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

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
