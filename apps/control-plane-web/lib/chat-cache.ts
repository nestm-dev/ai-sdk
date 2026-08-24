import type { ChatList, ChatSummary } from "@/lib/chat-schema";

export function promoteLatestChat(
	current: ChatList | undefined,
	candidate: ChatSummary,
): ChatList | undefined {
	if (!current) return undefined;
	const latest = current.chats.at(0);
	if (latest && Date.parse(latest.updatedAt) > Date.parse(candidate.updatedAt)) return current;
	return { chats: [candidate], nextCursor: current.nextCursor };
}
