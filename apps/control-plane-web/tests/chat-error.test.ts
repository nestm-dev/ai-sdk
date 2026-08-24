import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatApiError, chatResponseError, fetchChatTransport } from "@/lib/chat-error";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("safe chat errors", () => {
	it("preserves a bounded structured proxy error for the AI SDK transport", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				Response.json(
					{
						code: "CHAT_TRANSCRIPT_DIVERGED",
						message: "The chat service could not complete this request.",
					},
					{ status: 409 },
				),
			),
		);

		const error = await fetchChatTransport("/api/chats/example/stream").catch(
			(value: unknown) => value,
		);

		expect(error).toBeInstanceOf(ChatApiError);
		expect(error).toMatchObject({
			code: "CHAT_TRANSCRIPT_DIVERGED",
			status: 409,
			message: "The chat service could not complete this request.",
		});
	});

	it("falls back when a response is not a safe structured chat error", async () => {
		const error = await chatResponseError(
			Response.json({ code: "PRIVATE-UPSTREAM-CODE", message: "private detail" }, { status: 500 }),
			"Safe fallback",
		);

		expect(error).not.toBeInstanceOf(ChatApiError);
		expect(error.message).toBe("Safe fallback");
	});
});
