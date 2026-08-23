import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/snapshot/route";
import { createDemoSnapshot } from "@/lib/demo-snapshot";
import { parseAiObservabilitySnapshot } from "@/lib/snapshot-schema";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("private snapshot proxy", () => {
	it("serves a valid demo capture when no upstream is configured", async () => {
		vi.stubEnv("AI_OBSERVABILITY_API_URL", "");

		const response = await GET(new Request("http://dashboard.test/api/snapshot"));

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("x-ai-observability-source")).toBe("demo");
		const body: unknown = await response.json();
		expect(() => parseAiObservabilitySnapshot(body)).not.toThrow();
	});

	it("keeps an optional upstream credential on the server", async () => {
		vi.stubEnv("AI_OBSERVABILITY_API_URL", "http://127.0.0.1:3001/nested/path");
		vi.stubEnv("AI_OBSERVABILITY_API_BEARER_TOKEN", "top-secret");
		const fetchMock = vi.fn().mockResolvedValue(Response.json(createDemoSnapshot()));
		vi.stubGlobal("fetch", fetchMock);

		const response = await GET(new Request("http://dashboard.test/api/snapshot"));

		expect(response.status).toBe(200);
		expect(response.headers.get("x-ai-observability-source")).toBe("live");
		expect(fetchMock).toHaveBeenCalledWith(
			new URL("http://127.0.0.1:3001/ai-observability/v1/snapshot"),
			expect.objectContaining({
				headers: {
					accept: "application/json",
					authorization: "Bearer top-secret",
				},
			}),
		);
		expect(JSON.stringify(await response.json())).not.toContain("top-secret");
	});

	it("returns only a safe error for invalid configuration or an oversized snapshot", async () => {
		vi.stubEnv("AI_OBSERVABILITY_API_URL", "file:///tmp/private.json");
		const invalidConfiguration = await GET(new Request("http://dashboard.test/api/snapshot"));
		expect(await invalidConfiguration.json()).toEqual({
			code: "SOURCE_CONFIGURATION_INVALID",
			message: "The observability snapshot is temporarily unavailable.",
		});

		vi.stubEnv("AI_OBSERVABILITY_API_URL", "http://127.0.0.1:3001");
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					new Response("{}", { headers: { "content-length": String(2 * 1024 * 1024 + 1) } }),
				),
		);
		const oversized = await GET(new Request("http://dashboard.test/api/snapshot"));
		expect(oversized.status).toBe(502);
		expect(await oversized.json()).toEqual({
			code: "SOURCE_SCHEMA_INVALID",
			message: "The observability snapshot is temporarily unavailable.",
		});
	});
});
