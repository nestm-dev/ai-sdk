import type { z } from "zod";

import {
	cancelRunResponseSchema,
	chatListSchema,
	chatViewSchema,
	createChatRequestSchema,
	providerCatalogSchema,
	updateChatRequestSchema,
	type ChatList,
	type ChatView,
	type ProviderDescription,
	type RunView,
} from "@/lib/chat-schema";
import type { ProviderId } from "@/lib/compare-schema";
import { chatResponseError } from "@/lib/chat-error";

export const chatQueryKeys = {
	all: ["playground-chats"] as const,
	detail: (chatId: string) => ["playground-chats", chatId] as const,
	providers: ["playground-chat-providers"] as const,
	sidebar: ["playground-chats", "sidebar"] as const,
};

export async function listChats(
	options: Readonly<{ cursor?: string; limit?: number; signal?: AbortSignal }> = {},
): Promise<ChatList> {
	const query = new URLSearchParams();
	if (options.cursor) query.set("cursor", options.cursor);
	if (options.limit !== undefined) query.set("limit", String(options.limit));
	const suffix = query.size === 0 ? "" : `?${query.toString()}`;
	return requestJson(
		`/api/chats${suffix}`,
		chatListSchema,
		{ signal: options.signal },
		"Chats could not be loaded.",
	);
}

export async function getChat(chatId: string, signal?: AbortSignal): Promise<ChatView> {
	return requestJson(
		`/api/chats/${encodeURIComponent(chatId)}`,
		chatViewSchema,
		{ signal },
		"This chat could not be loaded.",
	);
}

export async function createChat(provider: ProviderId, title?: string): Promise<ChatView> {
	const body = createChatRequestSchema.parse({
		provider,
		...(title === undefined ? {} : { title }),
	});
	return requestJson(
		"/api/chats",
		chatViewSchema,
		{ method: "POST", body: JSON.stringify(body) },
		"A new chat could not be created.",
	);
}

export async function updateChat(
	chatId: string,
	input: Readonly<{ provider?: ProviderId; title?: string }>,
): Promise<ChatView> {
	const body = updateChatRequestSchema.parse(input);
	return requestJson(
		`/api/chats/${encodeURIComponent(chatId)}`,
		chatViewSchema,
		{ method: "PATCH", body: JSON.stringify(body) },
		"The chat could not be updated.",
	);
}

export async function deleteChat(chatId: string): Promise<void> {
	const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}`, {
		method: "DELETE",
		cache: "no-store",
	});
	if (!response.ok) throw await chatResponseError(response, "The chat could not be deleted.");
}

export async function cancelChatRun(chatId: string, runId: string): Promise<RunView> {
	const response = await requestJson(
		`/api/chats/${encodeURIComponent(chatId)}/runs/${encodeURIComponent(runId)}/cancel`,
		cancelRunResponseSchema,
		{ method: "POST" },
		"The active run could not be cancelled.",
	);
	return response.run;
}

export async function listChatProviders(
	signal?: AbortSignal,
): Promise<readonly ProviderDescription[]> {
	const result = await requestJson(
		"/api/providers",
		providerCatalogSchema,
		{ signal },
		"Models could not be loaded.",
	);
	return result.providers;
}

async function requestJson<Output>(
	path: string,
	schema: z.ZodType<Output>,
	init: RequestInit,
	fallback: string,
): Promise<Output> {
	const response = await fetch(path, {
		cache: "no-store",
		headers: { accept: "application/json", "content-type": "application/json" },
		...init,
	});
	if (!response.ok) throw await chatResponseError(response, fallback);
	const parsed = schema.safeParse(await response.json());
	if (!parsed.success) throw new Error(fallback);
	return parsed.data;
}
