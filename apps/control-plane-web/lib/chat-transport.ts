import { DefaultChatTransport } from "ai";
import { z } from "zod";

import { fetchChatTransport } from "@/lib/chat-error";
import type { PlaygroundUIMessage } from "@/lib/chat-schema";

export function createPlaygroundChatTransport(
	chatId: string,
): DefaultChatTransport<PlaygroundUIMessage> {
	const id = z.uuid().parse(chatId);
	const streamPath = `/api/chats/${encodeURIComponent(id)}/stream`;
	return new DefaultChatTransport<PlaygroundUIMessage>({
		api: streamPath,
		fetch: fetchChatTransport,
		prepareSendMessagesRequest: ({ messages, messageId, trigger }) => ({
			api: streamPath,
			body: {
				messages: preparePlaygroundChatMessages(messages),
				trigger,
				...(messageId === undefined ? {} : { messageId }),
			},
		}),
		prepareReconnectToStreamRequest: () => ({ api: streamPath }),
	});
}

/**
 * assistant-ui adds client-only composer metadata (currently `{ custom: {} }`)
 * to user turns. It is not model input and the durable API intentionally only
 * accepts server-authored metadata, so remove it at the transport boundary.
 */
export function preparePlaygroundChatMessages(
	messages: readonly PlaygroundUIMessage[],
): PlaygroundUIMessage[] {
	return messages.map((message) => {
		if (message.role !== "user" || message.metadata === undefined) return message;
		const messageWithoutMetadata = { ...message };
		delete messageWithoutMetadata.metadata;
		return messageWithoutMetadata;
	});
}
