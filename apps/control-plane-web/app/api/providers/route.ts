import { providerCatalogSchema } from "@/lib/chat-schema";
import { fetchChatUpstream, handleChatProxyError, validatedJsonResponse } from "@/lib/chat-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
	try {
		const upstream = await fetchChatUpstream(request, "/playground/v1/providers", {
			method: "GET",
		});
		return await validatedJsonResponse(upstream, providerCatalogSchema);
	} catch (error) {
		if (request.signal.aborted) throw error;
		return handleChatProxyError(error);
	}
}
