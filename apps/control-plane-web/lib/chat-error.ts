const CHAT_ERROR_CODE_PATTERN = /^CHAT_[A-Z0-9_]{1,63}$/u;
const MAX_ERROR_MESSAGE_LENGTH = 300;

export class ChatApiError extends Error {
	override readonly name = "ChatApiError";

	constructor(
		message: string,
		readonly code: string,
		readonly status: number,
	) {
		super(message);
	}
}

export async function chatResponseError(response: Response, fallback: string): Promise<Error> {
	try {
		const value = (await response.json()) as unknown;
		if (typeof value !== "object" || value === null) return new Error(fallback);
		const { code, message } = value as Record<string, unknown>;
		if (
			typeof code === "string" &&
			CHAT_ERROR_CODE_PATTERN.test(code) &&
			typeof message === "string" &&
			message.trim() !== ""
		) {
			return new ChatApiError(message.slice(0, MAX_ERROR_MESSAGE_LENGTH), code, response.status);
		}
	} catch {
		// The local proxy intentionally exposes no raw upstream error body.
	}
	return new Error(fallback);
}

export async function fetchChatTransport(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> {
	const response = await fetch(input, init);
	if (!response.ok) {
		throw await chatResponseError(response, "The chat service could not complete this request.");
	}
	return response;
}
