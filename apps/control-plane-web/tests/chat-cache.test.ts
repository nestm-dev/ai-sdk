import { describe, expect, it } from "vitest";

import { promoteLatestChat } from "@/lib/chat-cache";
import type { ChatList } from "@/lib/chat-schema";

describe("chat list cache", () => {
	it("promotes a newly updated chat without replacing a newer root result", () => {
		const current = {
			chats: [summary(REMAINING_CHAT_ID, "2026-08-23T18:02:00.000Z")],
			nextCursor: REMAINING_CHAT_ID,
		} satisfies ChatList;

		expect(
			promoteLatestChat(current, summary(DELETED_CHAT_ID, "2026-08-23T18:03:00.000Z")),
		).toEqual({
			chats: [summary(DELETED_CHAT_ID, "2026-08-23T18:03:00.000Z")],
			nextCursor: REMAINING_CHAT_ID,
		});
		expect(promoteLatestChat(current, summary(DELETED_CHAT_ID, "2026-08-23T18:01:00.000Z"))).toBe(
			current,
		);
	});
});

const DELETED_CHAT_ID = "24670caf-8bb0-4f72-bb6f-de197c12d97f";
const REMAINING_CHAT_ID = "8eb66fd4-6f38-4e91-bfa5-42ce79497b14";

function summary(id: string, updatedAt: string) {
	return {
		id,
		title: id === DELETED_CHAT_ID ? "Deleted" : "Remaining",
		provider: "openai" as const,
		model: "gpt-5-mini",
		createdAt: "2026-08-23T18:00:00.000Z",
		updatedAt,
		messageCount: 0,
		activeRun: null,
	};
}
