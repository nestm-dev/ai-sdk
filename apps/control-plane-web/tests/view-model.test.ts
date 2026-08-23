import { describe, expect, it } from "vitest";

import { createDemoSnapshot } from "@/lib/demo-snapshot";
import {
	formatPercent,
	resolvedCoverage,
	sortModelGroups,
	successRate,
	tokenField,
} from "@/lib/view-model";

describe("dashboard view model", () => {
	it("does not invent a success percentage for an empty denominator", () => {
		expect(successRate({ success: 0, error: 0, aborted: 0 })).toBeNull();
		expect(formatPercent(null)).toBe("—");
	});

	it("treats completed and explicitly abandoned starts as resolved", () => {
		expect(resolvedCoverage({ started: 10, completed: 7, abandoned: 2 })).toBe(90);
		expect(resolvedCoverage({ started: 0, completed: 0, abandoned: 0 })).toBeNull();
	});

	it("reads totals only from operations and preserves sample coverage", () => {
		const snapshot = createDemoSnapshot();
		const field = tokenField(snapshot, "totalTokens");

		expect(field).toEqual({ total: 2_432_000, samples: 1_239, reported: true });
		expect(field.total).not.toBe(snapshot.totals.modelCalls.usage.totals.totalTokens);
	});

	it("sorts model rows deterministically without mutating the contract", () => {
		const snapshot = createDemoSnapshot();
		const before = [...snapshot.models];
		const sorted = sortModelGroups(snapshot.models);

		expect(sorted[0]?.provider).toBe("openai");
		expect(snapshot.models).toEqual(before);
		expect(sorted).not.toBe(snapshot.models);
	});
});
