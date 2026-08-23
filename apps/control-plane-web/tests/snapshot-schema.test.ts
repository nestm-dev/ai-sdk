import { InMemoryAiObservabilityCollector } from "@nestm/ai-sdk/observability/core";
import { describe, expect, it } from "vitest";

import { createDemoSnapshot } from "@/lib/demo-snapshot";
import { aiObservabilitySnapshotSchema, parseAiObservabilitySnapshot } from "@/lib/snapshot-schema";

describe("AI observability snapshot boundary", () => {
	it("accepts both the full demo and an empty collector snapshot", () => {
		const demo = createDemoSnapshot();
		const empty = new InMemoryAiObservabilityCollector().snapshot();

		expect(parseAiObservabilitySnapshot(demo)).toEqual(demo);
		expect(parseAiObservabilitySnapshot(empty)).toEqual(empty);
	});

	it("rejects unknown schema versions and extra fields", () => {
		const demo = createDemoSnapshot();

		expect(aiObservabilitySnapshotSchema.safeParse({ ...demo, schemaVersion: 2 }).success).toBe(
			false,
		);
		expect(
			aiObservabilitySnapshotSchema.safeParse({ ...demo, secretPrompt: "never" }).success,
		).toBe(false);
	});

	it("rejects malformed distributions", () => {
		const demo = createDemoSnapshot();
		const invalid = {
			...demo,
			totals: {
				...demo.totals,
				operations: {
					...demo.totals.operations,
					durationMs: { ...demo.totals.operations.durationMs, p50: 2_000, p95: 500 },
				},
			},
		};

		expect(aiObservabilitySnapshotSchema.safeParse(invalid).success).toBe(false);
	});

	it("rejects unordered buckets and duplicate group identities", () => {
		const demo = createDemoSnapshot();
		const unordered = {
			...demo,
			window: { ...demo.window, buckets: demo.window.buckets.toReversed() },
		};
		const duplicate = {
			...demo,
			models: [...demo.models, demo.models[0]!],
		};

		expect(aiObservabilitySnapshotSchema.safeParse(unordered).success).toBe(false);
		expect(aiObservabilitySnapshotSchema.safeParse(duplicate).success).toBe(false);
	});
});
