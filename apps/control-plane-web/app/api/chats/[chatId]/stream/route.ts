import { z } from "zod";

import { chatStreamRequestSchema } from "@/lib/chat-schema";
import {
	fetchChatUpstream,
	handleChatProxyError,
	invalidChatRequest,
	readBoundedRequestJson,
	streamResponse,
	validateChatMutationRequest,
} from "@/lib/chat-proxy";

export const dynamic = "force-dynamic";

interface ChatStreamRouteContext {
	readonly params: Promise<{ chatId: string }>;
}

export async function POST(request: Request, context: ChatStreamRouteContext): Promise<Response> {
	const rejected = validateChatMutationRequest(request, { jsonBody: true });
	if (rejected) return rejected;
	const chatId = await parsedChatId(context);
	const body = chatStreamRequestSchema.safeParse(await readBoundedRequestJson(request));
	if (!chatId || !body.success) return invalidChatRequest();
	try {
		const upstream = await fetchChatUpstream(
			request,
			`/playground/v1/chats/${encodeURIComponent(chatId)}/stream`,
			{ method: "POST", body: body.data, stream: true },
		);
		return streamResponse(upstream);
	} catch (error) {
		if (request.signal.aborted) throw error;
		return handleChatProxyError(error);
	}
}

export async function GET(request: Request, context: ChatStreamRouteContext): Promise<Response> {
	const chatId = await parsedChatId(context);
	if (!chatId) return invalidChatRequest();
	try {
		const upstream = await fetchChatUpstream(
			request,
			`/playground/v1/chats/${encodeURIComponent(chatId)}/stream`,
			{ method: "GET", stream: true },
		);
		return streamResponse(upstream);
	} catch (error) {
		if (request.signal.aborted) throw error;
		return handleChatProxyError(error);
	}
}

async function parsedChatId(context: ChatStreamRouteContext): Promise<string | undefined> {
	const parsed = z.uuid().safeParse((await context.params).chatId);
	return parsed.success ? parsed.data : undefined;
}
