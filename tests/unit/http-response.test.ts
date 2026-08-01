import type { UIMessageChunk } from "ai";
import { streamText } from "ai";
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
