import { describe, expect, it } from "vitest";

import {
	errorOriginAfterFinish,
	hasPendingToolApproval,
	hasSuccessfulAssistantCompletion,
	retryFromAuthoritativeChat,
} from "@/lib/chat-message-state";
import type { PlaygroundUIMessage } from "@/lib/chat-schema";

describe("chat message state", () => {
	it("retains generation provenance when onFinish follows onError", () => {
		expect(errorOriginAfterFinish("generation", true)).toBe("generation");
		expect(errorOriginAfterFinish("generation", false)).toBeUndefined();
	});

	it("blocks new turns only while a tool approval is unresolved", () => {
		expect(hasPendingToolApproval([messageWithToolState("approval-requested")])).toBe(true);
		expect(hasPendingToolApproval([messageWithToolState("approval-responded")])).toBe(false);
	});

	it("clears a reconnect error only for an authoritatively completed assistant", () => {
		const base = {
			id: "assistant-1",
			role: "assistant" as const,
			parts: [{ type: "text" as const, text: "partial" }],
		};

		expect(hasSuccessfulAssistantCompletion([{ ...base }])).toBe(false);
		expect(
			hasSuccessfulAssistantCompletion([
				{
					...base,
					metadata: {
						completedAt: "2026-08-23T20:00:00.000Z",
						finishReason: "error",
					},
				},
			]),
		).toBe(false);
		expect(
			hasSuccessfulAssistantCompletion([
				{
					...base,
					metadata: {
						completedAt: "2026-08-23T20:00:00.000Z",
						finishReason: "stop",
					},
				},
			]),
		).toBe(true);
	});

	it("replaces stale useChat messages synchronously before regeneration", async () => {
		const staleMessages: PlaygroundUIMessage[] = [
			{ id: "stale-user", role: "user", parts: [{ type: "text", text: "stale" }] },
		];
		const authoritativeMessages: PlaygroundUIMessage[] = [
			{ id: "live-user", role: "user", parts: [{ type: "text", text: "live" }] },
		];
		let clientMessages = staleMessages;
		const events: string[] = [];

		const action = await retryFromAuthoritativeChat({
			chat: { activeRun: null, messages: authoritativeMessages },
			clientMessages: staleMessages,
			errorOrigin: "generation",
			setMessages: (messages) => {
				clientMessages = messages;
				events.push("messages");
			},
			clearError: () => events.push("clear"),
			resumeStream: async () => undefined,
			regenerate: async () => {
				events.push("regenerate");
				expect(clientMessages).toEqual([...authoritativeMessages, ...staleMessages]);
				expect(clientMessages).not.toBe(authoritativeMessages);
			},
		});

		expect(action).toBe("regenerate");
		expect(events).toEqual(["messages", "clear", "regenerate"]);
	});
});

function messageWithToolState(
	state: "approval-requested" | "approval-responded",
): PlaygroundUIMessage {
	return {
		id: `message-${state}`,
		role: "assistant",
		parts: [
			state === "approval-requested"
				? {
						type: "dynamic-tool",
						toolName: "remember",
						toolCallId: "tool-1",
						state,
						input: { key: "answer", value: "42" },
						approval: { id: "approval-1" },
					}
				: {
						type: "dynamic-tool",
						toolName: "remember",
						toolCallId: "tool-1",
						state,
						input: { key: "answer", value: "42" },
						approval: { id: "approval-1", approved: true },
					},
		],
	};
}
