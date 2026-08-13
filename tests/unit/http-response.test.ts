import type { UIMessageChunk } from "ai";
import { streamText, ToolLoopAgent } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { AiSdkHttpResponse, AiSdkResponse, isAiSdkHttpResponse } from "../../src/http/index.js";

describe("AiSdkResponse", () => {
	it("wraps existing Fetch responses and promises", async () => {
		const direct = AiSdkResponse.from(new Response("direct", { status: 202 }));
		const promised = AiSdkResponse.from(Promise.resolve(new Response("promised")));

		expect(direct).toBeInstanceOf(AiSdkHttpResponse);
		expect(isAiSdkHttpResponse(direct)).toBe(true);
		expect(isAiSdkHttpResponse(new Response())).toBe(false);
		expect((await direct.resolve()).status).toBe(202);
		expect(await (await promised.resolve()).text()).toBe("promised");
	});

	it("creates text responses from streams and stream results", async () => {
		const stream = textStream("hello", " world");
		const result = AiSdkResponse.text(
			{ textStream: stream },
			{ status: 201, headers: { "x-result": "text" } },
		);
		const response = await result.resolve();

		expect(response.status).toBe(201);
		expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
		expect(response.headers.get("x-result")).toBe("text");
		expect(await response.text()).toBe("hello world");
	});

	it("creates AI SDK UI message SSE responses", async () => {
		const chunks: UIMessageChunk[] = [
			{ type: "start", messageId: "message-1" },
			{ type: "text-start", id: "text-1" },
			{ type: "text-delta", id: "text-1", delta: "hello" },
			{ type: "text-end", id: "text-1" },
			{ type: "finish", finishReason: "stop" },
		];
		const response = await AiSdkResponse.ui(valueStream(chunks)).resolve();
		const body = await response.text();

		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(body).toContain('data: {"type":"text-delta","id":"text-1","delta":"hello"}');
		expect(body).toContain("data: [DONE]");
	});

	it("accepts native streamText results without losing their stream types", () => {
		const acceptResult = (result: ReturnType<typeof streamText>): void => {
			AiSdkResponse.text(result);
			AiSdkResponse.ui(result);
		};

		expect(acceptResult).toBeTypeOf("function");
	});

	it("defers agent execution and forwards the HTTP lifecycle signal", async () => {
		let providerSignal: AbortSignal | undefined;
		const model = new MockLanguageModelV4({
			doStream: async ({ abortSignal }) => {
				providerSignal = abortSignal;
				return {
					stream: valueStream([
						{ type: "stream-start" as const, warnings: [] },
						{ type: "text-start" as const, id: "text-1" },
						{ type: "text-delta" as const, id: "text-1", delta: "hello" },
						{ type: "text-end" as const, id: "text-1" },
						{
							type: "finish" as const,
							finishReason: { unified: "stop" as const, raw: undefined },
							usage: {
								inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
								outputTokens: { total: 1, text: 1, reasoning: 0 },
							},
						},
					]),
				};
			},
		});
		const responseResult = AiSdkResponse.agent({
			agent: new ToolLoopAgent({ model }),
			uiMessages: [
				{
					id: "user-1",
					role: "user",
					parts: [{ type: "text", text: "hello" }],
				},
			],
		});
		const http = new AbortController();

		expect(providerSignal).toBeUndefined();
		const response = await responseResult.resolve({ abortSignal: http.signal });
		expect(await responseResult.resolve()).toBe(response);
		await response.text();

		expect(providerSignal).toBe(http.signal);
	});
});

function textStream(...chunks: string[]): ReadableStream<string> {
	return valueStream(chunks);
}

function valueStream<T>(chunks: readonly T[]): ReadableStream<T> {
	return new ReadableStream<T>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(chunk);
			}
			controller.close();
		},
	});
}
