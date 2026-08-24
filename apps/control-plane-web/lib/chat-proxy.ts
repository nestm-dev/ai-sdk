import type { z } from "zod";

import { localUpstreamEndpoint } from "@/lib/local-upstream";

const CRUD_TIMEOUT_MS = 15_000;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 4 * 1024;
const CHAT_TRANSCRIPT_DIVERGED = "CHAT_TRANSCRIPT_DIVERGED";
const UI_MESSAGE_STREAM_HEADERS = {
	"cache-control": "no-cache",
	connection: "keep-alive",
	"content-type": "text/event-stream",
	"x-accel-buffering": "no",
	"x-vercel-ai-ui-message-stream": "v1",
} as const;

interface MutationRequestPolicy {
	readonly jsonBody?: boolean;
}

export type MutationRequestViolation = "content-type" | "origin";

export function mutationRequestViolation(
	request: Request,
	policy: MutationRequestPolicy = {},
): MutationRequestViolation | undefined {
	const requestOrigin = new URL(request.url).origin;
	const origin = request.headers.get("origin");
	const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
	if (
		(fetchSite !== undefined && fetchSite !== "same-origin" && fetchSite !== "none") ||
		origin === "null" ||
		(origin && origin !== requestOrigin)
	) {
		return "origin";
	}

	if (policy.jsonBody) {
		const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
		if (mediaType !== "application/json") return "content-type";
	}

	return undefined;
}

export function validateChatMutationRequest(
	request: Request,
	policy: MutationRequestPolicy = {},
): Response | undefined {
	const violation = mutationRequestViolation(request, policy);
	if (violation === "origin") {
		return safeChatError("CHAT_ORIGIN_FORBIDDEN", 403);
	}
	if (violation === "content-type") {
		return safeChatError("CHAT_CONTENT_TYPE_UNSUPPORTED", 415);
	}
	return undefined;
}

export async function fetchChatUpstream(
	request: Request,
	path: string,
	init: Readonly<{ method: "DELETE" | "GET" | "PATCH" | "POST"; body?: unknown; stream?: boolean }>,
): Promise<Response> {
	const baseUrl = process.env.AI_OBSERVABILITY_API_URL?.trim();
	if (!baseUrl) throw new ChatProxyError("CHAT_NOT_CONNECTED", 503);

	let endpoint: URL;
	try {
		endpoint = localUpstreamEndpoint(baseUrl, path);
	} catch {
		throw new ChatProxyError("CHAT_CONFIGURATION_INVALID", 503);
	}

	const bearerToken = process.env.AI_OBSERVABILITY_API_BEARER_TOKEN?.trim();
	try {
		return await fetch(endpoint, {
			method: init.method,
			cache: "no-store",
			headers: {
				accept: init.stream ? "text/event-stream" : "application/json",
				...(init.body === undefined ? {} : { "content-type": "application/json" }),
				...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
			},
			...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
			signal: init.stream
				? request.signal
				: AbortSignal.any([request.signal, AbortSignal.timeout(CRUD_TIMEOUT_MS)]),
		});
	} catch (error) {
		if (request.signal.aborted) throw error;
		throw new ChatProxyError("CHAT_UPSTREAM_UNAVAILABLE", 502);
	}
}

export async function readBoundedRequestJson(request: Request): Promise<unknown> {
	try {
		const declaredLength = Number(request.headers.get("content-length"));
		if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) return undefined;
		if (!request.body) return undefined;

		const reader = request.body.getReader();
		const chunks: Uint8Array[] = [];
		let totalBytes = 0;
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			totalBytes += chunk.value.byteLength;
			if (totalBytes > MAX_REQUEST_BYTES) {
				await reader.cancel();
				return undefined;
			}
			chunks.push(chunk.value);
		}

		const body = new Uint8Array(totalBytes);
		let offset = 0;
		for (const chunk of chunks) {
			body.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return JSON.parse(new TextDecoder().decode(body));
	} catch {
		return undefined;
	}
}

export async function validatedJsonResponse<Output>(
	upstream: Response,
	schema: z.ZodType<Output>,
): Promise<Response> {
	if (!upstream.ok) return upstreamFailure(upstream);
	try {
		const parsed = schema.safeParse(JSON.parse(await readBoundedResponse(upstream)));
		if (!parsed.success) return safeChatError("CHAT_RESPONSE_INVALID", 502);
		return Response.json(parsed.data, { headers: { "cache-control": "no-store" } });
	} catch {
		return safeChatError("CHAT_RESPONSE_INVALID", 502);
	}
}

export async function streamResponse(upstream: Response): Promise<Response> {
	if (upstream.status === 204) {
		return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
	}
	if (!upstream.ok) return upstreamFailure(upstream);
	if (!upstream.body) return safeChatError("CHAT_UPSTREAM_REJECTED", 502);
	if (!upstream.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
		return safeChatError("CHAT_STREAM_INVALID", 502);
	}

	const headers = new Headers(UI_MESSAGE_STREAM_HEADERS);
	const runId = upstream.headers.get("x-chat-run-id");
	if (runId && /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(runId)) headers.set("x-chat-run-id", runId);
	return new Response(upstream.body, { status: 200, headers });
}

export async function emptyUpstreamResponse(upstream: Response): Promise<Response> {
	return upstream.status === 204
		? new Response(null, { status: 204, headers: { "cache-control": "no-store" } })
		: upstreamFailure(upstream);
}

export function handleChatProxyError(error: unknown): Response {
	return error instanceof ChatProxyError
		? safeChatError(error.code, error.status)
		: safeChatError("CHAT_UPSTREAM_UNAVAILABLE", 502);
}

export function invalidChatRequest(): Response {
	return safeChatError("CHAT_REQUEST_INVALID", 400);
}

async function readBoundedResponse(
	response: Response,
	maxBytes = MAX_RESPONSE_BYTES,
): Promise<string> {
	const declaredLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error();
	if (!response.body) return "";

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) break;
		totalBytes += chunk.value.byteLength;
		if (totalBytes > maxBytes) {
			await reader.cancel();
			throw new Error();
		}
		chunks.push(chunk.value);
	}

	const body = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(body);
}

async function upstreamFailure(upstream: Response): Promise<Response> {
	const status = upstream.status;
	const safeStatus =
		status === 400 || status === 404 || status === 409 || status === 429 ? status : 502;
	const preservedCode = await preservedUpstreamErrorCode(upstream, safeStatus);
	return safeChatError(
		preservedCode ??
			(safeStatus === 409
				? "CHAT_CONFLICT"
				: safeStatus === 404
					? "CHAT_NOT_FOUND"
					: "CHAT_UPSTREAM_REJECTED"),
		safeStatus,
	);
}

async function preservedUpstreamErrorCode(
	upstream: Response,
	status: number,
): Promise<typeof CHAT_TRANSCRIPT_DIVERGED | undefined> {
	if (status !== 409) return undefined;
	try {
		const value = JSON.parse(
			await readBoundedResponse(upstream, MAX_ERROR_RESPONSE_BYTES),
		) as unknown;
		return typeof value === "object" &&
			value !== null &&
			(value as Record<string, unknown>).code === CHAT_TRANSCRIPT_DIVERGED
			? CHAT_TRANSCRIPT_DIVERGED
			: undefined;
	} catch {
		return undefined;
	}
}

function safeChatError(code: string, status: number): Response {
	return Response.json(
		{ code, message: "The chat service could not complete this request." },
		{ status, headers: { "cache-control": "no-store" } },
	);
}

class ChatProxyError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
	) {
		super(code);
	}
}
