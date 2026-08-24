import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatSidebar } from "@/components/chat-sidebar";
import type { ChatSummary } from "@/lib/chat-schema";

describe("chat sidebar", () => {
	it("shows persisted chats, active runs, and protects running chats from deletion", () => {
		const onCreate = vi.fn();
		const onDelete = vi.fn();
		const onLoadMore = vi.fn();
		render(
			<ChatSidebar
				activePath={`/c/${ACTIVE_CHAT_ID}`}
				chats={[chatSummary(ACTIVE_CHAT_ID, true), chatSummary(IDLE_CHAT_ID, false)]}
				creating={false}
				loading={false}
				loadingMore={false}
				mobileOpen={false}
				onClose={() => undefined}
				onCreate={onCreate}
				onDelete={onDelete}
				onLoadMore={onLoadMore}
			/>,
		);

		expect(screen.getByRole("link", { name: /Active chat/u })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.getByRole("status", { name: "Run active" })).toBeVisible();
		expect(screen.getByRole("button", { name: "Delete Active chat" })).toBeDisabled();

		fireEvent.click(screen.getByRole("button", { name: "Delete Idle chat" }));
		expect(onDelete).toHaveBeenCalledWith(IDLE_CHAT_ID);

		fireEvent.click(screen.getByRole("button", { name: "New chat" }));
		expect(onCreate).toHaveBeenCalledOnce();

		fireEvent.click(screen.getByRole("button", { name: "Load older chats" }));
		expect(onLoadMore).toHaveBeenCalledOnce();
	});

	it("keeps observability navigation available when the chat list fails", () => {
		render(
			<ChatSidebar
				activePath="/observability"
				chats={[]}
				creating={false}
				error="Chat service unavailable"
				loading={false}
				loadingMore={false}
				mobileOpen={true}
				onClose={() => undefined}
				onCreate={() => undefined}
				onDelete={() => undefined}
			/>,
		);

		expect(screen.getByRole("link", { name: "Observability" })).toHaveClass("is-active");
		expect(screen.getByText("Chat service unavailable")).toBeVisible();
	});
});

const ACTIVE_CHAT_ID = "24670caf-8bb0-4f72-bb6f-de197c12d97f";
const IDLE_CHAT_ID = "8eb66fd4-6f38-4e91-bfa5-42ce79497b14";

function chatSummary(id: string, active: boolean): ChatSummary {
	return {
		id,
		title: active ? "Active chat" : "Idle chat",
		provider: active ? "anthropic" : "openai",
		model: active ? "claude-haiku-4-5" : "gpt-5-mini",
		createdAt: "2026-08-23T18:00:00.000Z",
		updatedAt: "2026-08-23T18:01:00.000Z",
		messageCount: active ? 3 : 0,
		activeRun: active
			? {
					id: "d9428888-122b-4a22-8e5e-2e1d4d6ce092",
					status: "running",
					provider: "anthropic",
					model: "claude-haiku-4-5",
					startedAt: "2026-08-23T18:01:00.000Z",
					completedAt: null,
				}
			: null,
	};
}
