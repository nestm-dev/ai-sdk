import { z } from "zod";

import { cancelRunResponseSchema } from "@/lib/chat-schema";
import {
	fetchChatUpstream,
	handleChatProxyError,
	invalidChatRequest,
	validateChatMutationRequest,
	validatedJsonResponse,
} from "@/lib/chat-proxy";

export const dynamic = "force-dynamic";

interface CancelRouteContext {
	readonly params: Promise<{ chatId: string; runId: string }>;
}

export async function POST(request: Request, context: CancelRouteContext): Promise<Response> {
	const rejected = validateChatMutationRequest(request);
	if (rejected) return rejected;
	const params = await context.params;
	const chatId = z.uuid().safeParse(params.chatId);
	const runId = z.uuid().safeParse(params.runId);
	if (!chatId.success || !runId.success) return invalidChatRequest();
	try {
		const upstream = await fetchChatUpstream(
			request,
			`/playground/v1/chats/${encodeURIComponent(chatId.data)}/runs/${encodeURIComponent(runId.data)}/cancel`,
			{ method: "POST" },
		);
		return await validatedJsonResponse(upstream, cancelRunResponseSchema);
	} catch (error) {
		if (request.signal.aborted) throw error;
		return handleChatProxyError(error);
	}
}
