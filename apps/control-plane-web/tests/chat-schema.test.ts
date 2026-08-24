import { describe, expect, it } from "vitest";

import {
	chatStreamRequestSchema,
	MAX_CHAT_INPUT_MESSAGES,
	playgroundUIMessageSchema,
} from "@/lib/chat-schema";

describe("chat stream request bounds", () => {
	it("accepts the documented history limit and rejects one more message", () => {
		const messages = Array.from({ length: MAX_CHAT_INPUT_MESSAGES }, (_, index) => ({
			id: `message-${index}`,
			role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
			parts: [{ type: "text", text: String(index) }],
		}));

		expect(chatStreamRequestSchema.safeParse({ messages, trigger: "submit-message" }).success).toBe(
			true,
		);
		expect(
			chatStreamRequestSchema.safeParse({
				messages: [
					...messages,
					{ id: "overflow", role: "user", parts: [{ type: "text", text: "overflow" }] },
				],
				trigger: "submit-message",
			}).success,
		).toBe(false);
	});
});

describe("AI SDK UI message parts", () => {
	it("accepts representative content, source, file, data, and every tool state", () => {
		const parts = [
			{ type: "text", text: "Answer", state: "done" },
			{ type: "reasoning", id: "reasoning-1", text: "Reasoning", state: "streaming" },
			{
				type: "custom",
				kind: "provider.signature",
				providerMetadata: { openai: { itemId: "item-1" } },
			},
			{ type: "source-url", sourceId: "source-1", url: "https://example.com", title: "Web" },
			{
				type: "source-document",
				sourceId: "source-2",
				mediaType: "application/pdf",
				title: "Paper",
				filename: "paper.pdf",
			},
			{
				type: "file",
				mediaType: "image/png",
				filename: "chart.png",
				url: "data:image/png;base64,AA==",
			},
			{ type: "reasoning-file", mediaType: "text/plain", url: "data:text/plain,trace" },
			{ type: "step-start" },
			{ type: "data-observability", id: "data-1", data: { traceId: "trace-1" } },
			{ type: "tool-wait", toolCallId: "call-1", state: "input-streaming" },
			{ type: "tool-wait", toolCallId: "call-2", state: "input-available", input: { ms: 10 } },
			{
				type: "tool-memory",
				toolCallId: "call-3",
				state: "approval-requested",
				input: { value: "remember" },
				approval: { id: "approval-1" },
			},
			{
				type: "tool-memory",
				toolCallId: "call-4",
				state: "approval-responded",
				input: { value: "remember" },
				approval: { id: "approval-2", approved: true },
			},
			{
				type: "tool-calculator",
				toolCallId: "call-5",
				state: "output-available",
				input: { expression: "1 + 1" },
				output: { result: 2 },
			},
			{
				type: "dynamic-tool",
				toolName: "remote_tool",
				toolCallId: "call-6",
				state: "output-error",
				input: {},
				errorText: "Unavailable",
			},
			{
				type: "tool-memory",
				toolCallId: "call-7",
				state: "output-denied",
				input: { value: "secret" },
				approval: { id: "approval-3", approved: false, reason: "No" },
			},
		];

		expect(
			playgroundUIMessageSchema.safeParse({ id: "message-1", role: "assistant", parts }).success,
		).toBe(true);
	});

	it.each([
		["text without text", { type: "text" }],
		["file without a URL", { type: "file", mediaType: "image/png" }],
		["unsafe source URL", { type: "source-url", sourceId: "source-1", url: "javascript:alert(1)" }],
		[
			"tool output without required input",
			{ type: "tool-calculator", toolCallId: "call-1", state: "output-available", output: 2 },
		],
		[
			"tool approval with the wrong decision",
			{
				type: "tool-memory",
				toolCallId: "call-2",
				state: "output-denied",
				input: {},
				approval: { id: "approval-1", approved: true },
			},
		],
	])("rejects malformed %s parts", (_label, part) => {
		expect(
			playgroundUIMessageSchema.safeParse({ id: "message-1", role: "assistant", parts: [part] })
				.success,
		).toBe(false);
	});
});
