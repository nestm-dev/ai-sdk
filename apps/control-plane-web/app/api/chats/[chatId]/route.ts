import { z } from "zod";

import { chatViewSchema, updateChatRequestSchema } from "@/lib/chat-schema";
import {
	emptyUpstreamResponse,
	fetchChatUpstream,
	handleChatProxyError,
	invalidChatRequest,
	readBoundedRequestJson,
	validateChatMutationRequest,
	validatedJsonResponse,
} from "@/lib/chat-proxy";

export const dynamic = "force-dynamic";

interface ChatRouteContext {
	readonly params: Promise<{ chatId: string }>;
}

export async function GET(request: Request, context: ChatRouteContext): Promise<Response> {
	const chatId = await parsedChatId(context);
	if (!chatId) return invalidChatRequest();
	try {
		const upstream = await fetchChatUpstream(
			request,
			`/playground/v1/chats/${encodeURIComponent(chatId)}`,
			{ method: "GET" },
		);
		return await validatedJsonResponse(upstream, chatViewSchema);
	} catch (error) {
		if (request.signal.aborted) throw error;
		return handleChatProxyError(error);
	}
}

export async function PATCH(request: Request, context: ChatRouteContext): Promise<Response> {
	const rejected = validateChatMutationRequest(request, { jsonBody: true });
	if (rejected) return rejected;
	const chatId = await parsedChatId(context);
	const body = updateChatRequestSchema.safeParse(await readBoundedRequestJson(request));
	if (!chatId || !body.success) return invalidChatRequest();
	try {
		const upstream = await fetchChatUpstream(
			request,
			`/playground/v1/chats/${encodeURIComponent(chatId)}`,
			{ method: "PATCH", body: body.data },
		);
		return await validatedJsonResponse(upstream, chatViewSchema);
	} catch (error) {
		if (request.signal.aborted) throw error;
		return handleChatProxyError(error);
	}
}

export async function DELETE(request: Request, context: ChatRouteContext): Promise<Response> {
	const rejected = validateChatMutationRequest(request);
	if (rejected) return rejected;
	const chatId = await parsedChatId(context);
	if (!chatId) return invalidChatRequest();
	try {
		const upstream = await fetchChatUpstream(
			request,
			`/playground/v1/chats/${encodeURIComponent(chatId)}`,
			{ method: "DELETE" },
		);
		return emptyUpstreamResponse(upstream);
	} catch (error) {
		if (request.signal.aborted) throw error;
		return handleChatProxyError(error);
	}
}

async function parsedChatId(context: ChatRouteContext): Promise<string | undefined> {
	const parsed = z.uuid().safeParse((await context.params).chatId);
	return parsed.success ? parsed.data : undefined;
}
