import { afterEach, describe, expect, it, vi } from "vitest";

import { createDemoSnapshot } from "@/lib/demo-snapshot";
import { HttpAiObservabilityDashboardDataSource } from "@/lib/snapshot-client";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("HTTP dashboard data source", () => {
	it("strictly parses a live snapshot and records client receipt time", async () => {
		const snapshot = createDemoSnapshot();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-23T14:00:00.000Z"));
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(jsonResponse(snapshot, { "x-ai-observability-source": "live" })),
		);

		const capture = await new HttpAiObservabilityDashboardDataSource("/snapshot").snapshot();

		expect(capture).toEqual({
			snapshot,
			source: "live",
			receivedAt: Date.parse("2026-08-23T14:00:00.000Z"),
		});
	});

	it("accepts equal revisions and rejects only lower revisions in one process epoch", async () => {
		const snapshot = createDemoSnapshot();
		const lower = { ...snapshot, revision: snapshot.revision - 1 };
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(snapshot))
			.mockResolvedValueOnce(jsonResponse(snapshot))
			.mockResolvedValueOnce(jsonResponse(lower));
		vi.stubGlobal("fetch", fetchMock);
		const source = new HttpAiObservabilityDashboardDataSource();

		await expect(source.snapshot()).resolves.toMatchObject({ snapshot });
		await expect(source.snapshot()).resolves.toMatchObject({ snapshot });
		await expect(source.snapshot()).rejects.toMatchObject({ code: "stale" });
	});

	it("accepts a lower revision after the process restarts", async () => {
		const snapshot = createDemoSnapshot();
		const restarted = {
			...snapshot,
			startedAt: new Date(Date.parse(snapshot.startedAt) + 1_000).toISOString(),
			revision: 1,
		};
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(jsonResponse(snapshot))
				.mockResolvedValueOnce(jsonResponse(restarted)),
		);
		const source = new HttpAiObservabilityDashboardDataSource();

		await source.snapshot();
		await expect(source.snapshot()).resolves.toMatchObject({ snapshot: restarted });
	});

	it("maps hostile or oversized responses to a safe invalid error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response('{"prompt":"secret"}', {
					headers: { "content-length": String(2 * 1024 * 1024 + 1) },
				}),
			),
		);

		await expect(new HttpAiObservabilityDashboardDataSource().snapshot()).rejects.toMatchObject({
			code: "invalid",
		});
	});

	it("preserves aborts so React Query can cancel superseded reads", async () => {
		const abort = new DOMException("aborted", "AbortError");
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));

		await expect(new HttpAiObservabilityDashboardDataSource().snapshot()).rejects.toBe(abort);
	});
});

function jsonResponse(value: unknown, headers: Record<string, string> = {}): Response {
	return Response.json(value, { headers });
}
