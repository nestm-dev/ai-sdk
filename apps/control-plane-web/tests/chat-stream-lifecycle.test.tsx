import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
	discoveredChatRunAction,
	useDetachChatStreamOnUnmount,
	useInitialChatRunId,
} from "@/lib/chat-stream-lifecycle";

describe("chat stream lifecycle", () => {
	it("detaches the latest local stream subscriber when navigating away", () => {
		const firstStop = vi.fn(async () => undefined);
		const latestStop = vi.fn(async () => undefined);
		const hook = renderHook(({ stop }) => useDetachChatStreamOnUnmount(stop), {
			initialProps: { stop: firstStop },
		});

		hook.rerender({ stop: latestStop });
		expect(firstStop).not.toHaveBeenCalled();
		expect(latestStop).not.toHaveBeenCalled();

		hook.unmount();
		expect(firstStop).not.toHaveBeenCalled();
		expect(latestStop).toHaveBeenCalledOnce();
	});

	it("keeps the initial run frozen so polling cannot duplicate the POST consumer", () => {
		const hook = renderHook(({ runId }) => useInitialChatRunId(runId), {
			initialProps: { runId: undefined as string | undefined },
		});

		expect(hook.result.current).toBeUndefined();
		hook.rerender({ runId: "run-a" });
		expect(hook.result.current).toBeUndefined();
	});

	it("distinguishes a later external run from the run resumed on mount", () => {
		const hook = renderHook(
			({ runId }) => {
				const initialRunId = useInitialChatRunId(runId);
				return {
					initialRunId,
					shouldLateResume: runId !== undefined && runId !== initialRunId,
				};
			},
			{ initialProps: { runId: "run-a" as string | undefined } },
		);

		expect(hook.result.current).toEqual({
			initialRunId: "run-a",
			shouldLateResume: false,
		});

		hook.rerender({ runId: undefined });
		expect(hook.result.current.shouldLateResume).toBe(false);

		hook.rerender({ runId: "run-b" });
		expect(hook.result.current).toEqual({
			initialRunId: "run-a",
			shouldLateResume: true,
		});
	});

	it("resumes a locally started run once when its browser subscriber fails", () => {
		const locallyConsumedRunIds = new Set<string>();
		const baseState = {
			activeRunId: "run-b",
			generationRequested: false,
			initialRunId: "run-a",
			lastResumeRunId: undefined,
			locallyConsumedRunIds,
		} as const;

		expect(discoveredChatRunAction({ ...baseState, clientStatus: "streaming" })).toBe(
			"record-local",
		);
		locallyConsumedRunIds.add("run-b");
		expect(discoveredChatRunAction({ ...baseState, clientStatus: "error" })).toBe("resume");
		expect(
			discoveredChatRunAction({
				...baseState,
				clientStatus: "error",
				lastResumeRunId: "run-b",
			}),
		).toBe("wait");
	});
});
