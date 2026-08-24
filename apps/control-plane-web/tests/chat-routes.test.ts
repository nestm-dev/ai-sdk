import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as listChatsRoute, POST as createChatRoute } from "@/app/api/chats/route";
import {
	DELETE as deleteChatRoute,
	PATCH as updateChatRoute,
} from "@/app/api/chats/[chatId]/route";
import {
	GET as resumeChatRoute,
	POST as streamChatRoute,
} from "@/app/api/chats/[chatId]/stream/route";
import { POST as cancelRunRoute } from "@/app/api/chats/[chatId]/runs/[runId]/cancel/route";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("chat loopback proxy", () => {
	it("requires explicit loopback configuration", async () => {
		vi.stubEnv("AI_OBSERVABILITY_API_URL", "");
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const response = await listChatsRoute(request("/api/chats"));

		expect(response.status).toBe(503);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(await response.json()).toMatchObject({ code: "CHAT_NOT_CONNECTED" });
	});

	it("forwards and strictly validates the paginated chat list", async () => {
		stubLoopback();
		const summary = chatSummary();
		const fetchMock = vi
			.fn()
			.mockResolvedValue(Response.json({ chats: [summary], nextCursor: null }));
		vi.stubGlobal("fetch", fetchMock);

		const response = await listChatsRoute(request("/api/chats"));

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual({ chats: [summary], nextCursor: null });
		expect(fetchMock).toHaveBeenCalledWith(
			new URL("http://127.0.0.1:3001/playground/v1/chats"),
			expect.objectContaining({ method: "GET", cache: "no-store" }),
		);
	});

	it("forwards validated chat pagination and rejects unknown query fields", async () => {
		stubLoopback();
		const fetchMock = vi.fn().mockResolvedValue(Response.json({ chats: [], nextCursor: null }));
		vi.stubGlobal("fetch", fetchMock);

		const paginated = await listChatsRoute(request(`/api/chats?cursor=${CHAT_ID}&limit=25`));
		const invalid = await listChatsRoute(request("/api/chats?unexpected=true"));

		expect(paginated.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledWith(
			new URL(`http://127.0.0.1:3001/playground/v1/chats?cursor=${CHAT_ID}&limit=25`),
			expect.objectContaining({ method: "GET" }),
		);
		expect(invalid.status).toBe(400);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("rejects invalid create and update bodies before contacting upstream", async () => {
		stubLoopback();
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const createResponse = await createChatRoute(
			jsonRequest("/api/chats", { provider: "openai", title: "x".repeat(121) }),
		);
		const updateResponse = await updateChatRoute(
			jsonRequest(`/api/chats/${CHAT_ID}`, { title: "Rename", extra: true }, "PATCH"),
			chatContext(),
		);

		expect(createResponse.status).toBe(400);
		expect(updateResponse.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects cross-origin create, update, delete, stream, and cancel mutations", async () => {
		stubLoopback();
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const foreignHeaders = { origin: "https://attacker.example", "sec-fetch-site": "cross-site" };

		const responses = await Promise.all([
			createChatRoute(jsonRequest("/api/chats", { provider: "openai" }, "POST", foreignHeaders)),
			updateChatRoute(
				jsonRequest(`/api/chats/${CHAT_ID}`, { title: "Rename" }, "PATCH", foreignHeaders),
				chatContext(),
			),
			deleteChatRoute(request(`/api/chats/${CHAT_ID}`, "DELETE", foreignHeaders), chatContext()),
			streamChatRoute(
				jsonRequest(
					`/api/chats/${CHAT_ID}/stream`,
					{
						messages: [{ id: "message-1", role: "user", parts: [{ type: "text", text: "hello" }] }],
						trigger: "submit-message",
					},
					"POST",
					foreignHeaders,
				),
				chatContext(),
			),
			cancelRunRoute(
				request(`/api/chats/${CHAT_ID}/runs/${RUN_ID}/cancel`, "POST", foreignHeaders),
				cancelContext(),
			),
		]);

		expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403]);
		for (const response of responses) {
			expect(await response.json()).toMatchObject({ code: "CHAT_ORIGIN_FORBIDDEN" });
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("requires application/json for create, update, and stream bodies", async () => {
		stubLoopback();
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const textHeaders = { "content-type": "text/plain" };

		const responses = await Promise.all([
			createChatRoute(
				requestWithBody("/api/chats", JSON.stringify({ provider: "openai" }), "POST", textHeaders),
			),
			updateChatRoute(
				requestWithBody(
					`/api/chats/${CHAT_ID}`,
					JSON.stringify({ title: "Rename" }),
					"PATCH",
					textHeaders,
				),
				chatContext(),
			),
			streamChatRoute(
				requestWithBody(
					`/api/chats/${CHAT_ID}/stream`,
					JSON.stringify({ messages: [], trigger: "submit-message" }),
					"POST",
					textHeaders,
				),
				chatContext(),
			),
		]);

		expect(responses.map((response) => response.status)).toEqual([415, 415, 415]);
		for (const response of responses) {
			expect(await response.json()).toMatchObject({ code: "CHAT_CONTENT_TYPE_UNSUPPORTED" });
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("streams sanitized AI SDK requests and preserves the run id", async () => {
		stubLoopback();
		const fetchMock = vi.fn().mockResolvedValue(
			new Response('data: {"type":"start"}\n\n', {
				headers: {
					"content-type": "text/event-stream; charset=utf-8",
					"x-chat-run-id": RUN_ID,
				},
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const body = {
			messages: [{ id: "message-1", role: "user", parts: [{ type: "text", text: "hello" }] }],
			trigger: "submit-message",
		};

		const response = await streamChatRoute(
			jsonRequest(`/api/chats/${CHAT_ID}/stream`, body),
			chatContext(),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(response.headers.get("x-chat-run-id")).toBe(RUN_ID);
		expect(await response.text()).toContain('"type":"start"');
		expect(fetchMock).toHaveBeenCalledWith(
			new URL(`http://127.0.0.1:3001/playground/v1/chats/${CHAT_ID}/stream`),
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify(body),
			}),
		);
	});

	it("preserves the safe transcript-divergence code without forwarding upstream content", async () => {
		stubLoopback();
		const fetchMock = vi.fn().mockResolvedValue(
			Response.json(
				{
					code: "CHAT_TRANSCRIPT_DIVERGED",
					message: "private upstream transcript details",
				},
				{ status: 409 },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const response = await streamChatRoute(
			jsonRequest(`/api/chats/${CHAT_ID}/stream`, {
				messages: [{ id: "message-1", role: "user", parts: [{ type: "text", text: "hello" }] }],
				trigger: "regenerate-message",
			}),
			chatContext(),
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			code: "CHAT_TRANSCRIPT_DIVERGED",
			message: "The chat service could not complete this request.",
		});
	});

	it("supports idle resume, explicit cancellation, and idle deletion", async () => {
		stubLoopback();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(Response.json({ run: cancelledRun() }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetchMock);

		const resume = await resumeChatRoute(request(`/api/chats/${CHAT_ID}/stream`), chatContext());
		const cancel = await cancelRunRoute(
			request(`/api/chats/${CHAT_ID}/runs/${RUN_ID}/cancel`, "POST"),
			cancelContext(),
		);
		const deleted = await deleteChatRoute(
			request(`/api/chats/${CHAT_ID}`, "DELETE"),
			chatContext(),
		);

		expect(resume.status).toBe(204);
		expect(cancel.status).toBe(200);
		expect(await cancel.json()).toEqual({ run: cancelledRun() });
		expect(deleted.status).toBe(204);
		expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit).method)).toEqual([
			"GET",
			"POST",
			"DELETE",
		]);
	});
});

const CHAT_ID = "24670caf-8bb0-4f72-bb6f-de197c12d97f";
const RUN_ID = "d9428888-122b-4a22-8e5e-2e1d4d6ce092";

function stubLoopback() {
	vi.stubEnv("AI_OBSERVABILITY_API_URL", "http://127.0.0.1:3001");
}

function chatContext() {
	return { params: Promise.resolve({ chatId: CHAT_ID }) };
}

function cancelContext() {
	return { params: Promise.resolve({ chatId: CHAT_ID, runId: RUN_ID }) };
}

function request(path: string, method = "GET", headers?: HeadersInit): Request {
	return new Request(`http://dashboard.test${path}`, {
		method,
		headers: { origin: "http://dashboard.test", ...headers },
	});
}

function jsonRequest(path: string, body: unknown, method = "POST", headers?: HeadersInit): Request {
	return new Request(`http://dashboard.test${path}`, {
		method,
		headers: {
			origin: "http://dashboard.test",
			"content-type": "application/json; charset=utf-8",
			...headers,
		},
		body: JSON.stringify(body),
	});
}

function requestWithBody(
	path: string,
	body: BodyInit,
	method: string,
	headers?: HeadersInit,
): Request {
	return new Request(`http://dashboard.test${path}`, {
		method,
		headers: { origin: "http://dashboard.test", ...headers },
		body,
	});
}

function chatSummary() {
	return {
		id: CHAT_ID,
		title: "New chat",
		provider: "openai",
		model: "gpt-5-mini",
		createdAt: "2026-08-23T18:00:00.000Z",
		updatedAt: "2026-08-23T18:00:00.000Z",
		messageCount: 0,
		activeRun: null,
	};
}

function cancelledRun() {
	return {
		id: RUN_ID,
		status: "cancelled",
		provider: "openai",
		model: "gpt-5-mini",
		startedAt: "2026-08-23T18:00:00.000Z",
		completedAt: "2026-08-23T18:00:01.000Z",
	};
}
