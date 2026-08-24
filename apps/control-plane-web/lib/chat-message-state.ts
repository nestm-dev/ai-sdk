import type { ChatView, PlaygroundUIMessage } from "@/lib/chat-schema";

export type ChatErrorOrigin = "generation" | "resume";

export function errorOriginAfterFinish(
	current: ChatErrorOrigin | undefined,
	isError: boolean,
): ChatErrorOrigin | undefined {
	return isError ? current : undefined;
}

export function hasPendingToolApproval(messages: readonly PlaygroundUIMessage[]): boolean {
	return messages.some((message) =>
		message.parts.some(
			(part) =>
				(part.type === "dynamic-tool" || part.type.startsWith("tool-")) &&
				"state" in part &&
				part.state === "approval-requested",
		),
	);
}

export function hasSuccessfulAssistantCompletion(
	messages: readonly PlaygroundUIMessage[],
): boolean {
	const lastMessage = messages.at(-1);
	if (lastMessage?.role !== "assistant") return false;
	const metadata = lastMessage.metadata;
	return (
		metadata?.completedAt !== undefined &&
		metadata.finishReason !== undefined &&
		metadata.finishReason !== "error"
	);
}

export type ChatRetryAction = "clear" | "regenerate" | "resume";

export async function retryFromAuthoritativeChat(options: {
	readonly chat: Pick<ChatView, "activeRun" | "messages">;
	readonly clientMessages: readonly PlaygroundUIMessage[];
	readonly errorOrigin: ChatErrorOrigin | undefined;
	readonly clearError: () => void;
	readonly regenerate: () => Promise<void>;
	readonly resumeStream: () => Promise<void>;
	readonly setMessages: (messages: PlaygroundUIMessage[]) => void;
}): Promise<ChatRetryAction> {
	// useChat reads its store synchronously when regenerate starts. Reconcile in
	// this event handler, rather than waiting for the cache-driven effect, so a
	// stale request cannot repeat the same transcript-divergence response.
	const retryMessages = retryMessagesFromAuthoritativeChat(
		options.chat,
		options.clientMessages,
		options.errorOrigin,
	);
	options.setMessages(retryMessages);
	options.clearError();

	if (options.chat.activeRun !== null) {
		await options.resumeStream();
		return "resume";
	}
	if (
		options.errorOrigin !== "generation" &&
		(hasSuccessfulAssistantCompletion(options.chat.messages) ||
			!options.chat.messages.some((message) => message.role === "user"))
	) {
		return "clear";
	}

	await options.regenerate();
	return "regenerate";
}

function retryMessagesFromAuthoritativeChat(
	chat: Pick<ChatView, "activeRun" | "messages">,
	clientMessages: readonly PlaygroundUIMessage[],
	errorOrigin: ChatErrorOrigin | undefined,
): PlaygroundUIMessage[] {
	const authoritative = [...chat.messages];
	if (chat.activeRun !== null || errorOrigin !== "generation") return authoritative;

	// A transcript conflict means the rejected local user turn was never stored.
	// Rebase that turn onto the authoritative history so Retry does not silently
	// regenerate an older prompt or discard what the user just submitted.
	const pendingUser = clientMessages.at(-1);
	if (
		pendingUser?.role !== "user" ||
		authoritative.some((message) => message.id === pendingUser.id)
	) {
		return authoritative;
	}
	return [...authoritative, pendingUser];
}
