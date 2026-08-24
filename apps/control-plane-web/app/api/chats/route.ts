import { chatListSchema, chatViewSchema, createChatRequestSchema } from "@/lib/chat-schema";
import {
	fetchChatUpstream,
	handleChatProxyError,
	invalidChatRequest,
	readBoundedRequestJson,
	validateChatMutationRequest,
	validatedJsonResponse,
} from "@/lib/chat-proxy";
import { z } from "zod";

export const dynamic = "force-dynamic";

const listChatsQuerySchema = z
	.object({
		cursor: z.uuid().optional(),
		limit: z.coerce.number().int().min(1).max(100).optional(),
	})
	.strict();

export async function GET(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const raw = Object.fromEntries(url.searchParams);
	const parsed = listChatsQuerySchema.safeParse(raw);
	if (!parsed.success) return invalidChatRequest();
	const upstreamQuery = new URLSearchParams();
	if (parsed.data.cursor) upstreamQuery.set("cursor", parsed.data.cursor);
	if (parsed.data.limit !== undefined) upstreamQuery.set("limit", String(parsed.data.limit));
	const suffix = upstreamQuery.size === 0 ? "" : `?${upstreamQuery.toString()}`;
	try {
		const upstream = await fetchChatUpstream(request, `/playground/v1/chats${suffix}`, {
			method: "GET",
		});
		return await validatedJsonResponse(upstream, chatListSchema);
	} catch (error) {
		if (request.signal.aborted) throw error;
		return handleChatProxyError(error);
	}
}

export async function POST(request: Request): Promise<Response> {
	const rejected = validateChatMutationRequest(request, { jsonBody: true });
	if (rejected) return rejected;
	const parsed = createChatRequestSchema.safeParse(await readBoundedRequestJson(request));
	if (!parsed.success) return invalidChatRequest();

	try {
		const upstream = await fetchChatUpstream(request, "/playground/v1/chats", {
			method: "POST",
			body: parsed.data,
		});
		return await validatedJsonResponse(upstream, chatViewSchema);
	} catch (error) {
		if (request.signal.aborted) throw error;
		return handleChatProxyError(error);
	}
}
