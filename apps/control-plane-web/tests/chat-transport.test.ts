import { describe, expect, it } from "vitest";

import { preparePlaygroundChatMessages } from "@/lib/chat-transport";
import type { PlaygroundUIMessage } from "@/lib/chat-schema";

describe("preparePlaygroundChatMessages", () => {
	it("removes assistant-ui composer metadata from user turns", () => {
		const user = {
			id: "user-1",
			role: "user",
			parts: [{ type: "text", text: "hello" }],
			metadata: { custom: {} },
		} satisfies PlaygroundUIMessage;

		const prepared = preparePlaygroundChatMessages([user]);

		expect(prepared).toEqual([
			{ id: "user-1", role: "user", parts: [{ type: "text", text: "hello" }] },
		]);
		expect(user.metadata).toEqual({ custom: {} });
	});

	it("preserves server-authored assistant metadata", () => {
		const assistant = {
			id: "assistant-1",
			role: "assistant",
			parts: [{ type: "text", text: "hello" }],
			metadata: { provider: "openai", model: "gpt-5-mini" },
		} satisfies PlaygroundUIMessage;

		expect(preparePlaygroundChatMessages([assistant])).toEqual([assistant]);
	});
});
