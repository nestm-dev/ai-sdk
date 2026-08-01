import type { INestApplication } from "@nestjs/common";
import { Controller, Get, Module } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ToolLoopAgent } from "ai";
import type { UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiSdkHttpResponse } from "../../src/http/index.js";
import { AiSdkHttpModule, AiSdkResponse } from "../../src/http/index.js";

const testHttpAdapter = process.env.TEST_HTTP_ADAPTER ?? "express";

interface CancellationProbe {
	readonly cancelled: Promise<void>;
	resolve(): void;
}

function createCancellationProbe(): CancellationProbe {
	let resolveCancellation: (() => void) | undefined;
	const cancelled = new Promise<void>((resolve) => {
		resolveCancellation = resolve;
	});

	return {
		cancelled,
		resolve: () => resolveCancellation?.(),
	};
}

let disconnectProbe = createCancellationProbe();

@Controller("http")
class HttpTestController {
	@Get("plain")
	plain(): { ok: boolean } {
		return { ok: true };
	}

	@Get("text")
	text(): AiSdkHttpResponse {
		return AiSdkResponse.text(textStream("hello", " ", "world"), {
			status: 201,
			statusText: "AI Created",
			headers: { "x-ai-response": "text" },
		});
	}

	@Get("ui")
	ui(): AiSdkHttpResponse {
		const chunks: UIMessageChunk[] = [
			{ type: "start", messageId: "message-1" },
			{ type: "text-start", id: "text-1" },
			{ type: "text-delta", id: "text-1", delta: "from ui" },
			{ type: "text-end", id: "text-1" },
			{ type: "finish", finishReason: "stop" },
		];
		return AiSdkResponse.ui(valueStream(chunks));
	}

	@Get("agent")
	agent(): AiSdkHttpResponse {
		const model = new MockLanguageModelV4({
			doStream: {
				stream: valueStream([
					{ type: "stream-start" as const, warnings: [] },
					{ type: "text-start" as const, id: "text-1" },
					{ type: "text-delta" as const, id: "text-1", delta: "from agent" },
					{ type: "text-end" as const, id: "text-1" },
					{
						type: "finish" as const,
						finishReason: { unified: "stop" as const, raw: "stop" },
						usage: {
							inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
							outputTokens: { total: 2, text: 2, reasoning: 0 },
						},
					},
				]),
			},
		});
		const agent = new ToolLoopAgent({ model });

		return AiSdkResponse.agent({
			agent,
			uiMessages: [
				{
					id: "user-1",
					role: "user",
					parts: [{ type: "text", text: "hello" }],
				},
			],
		});
	}

	@Get("binary")
	binary(): AiSdkHttpResponse {
		const headers = new Headers({ "content-type": "application/octet-stream" });
		headers.append("set-cookie", "first=1; Path=/");
		headers.append("set-cookie", "second=2; Path=/");

		return AiSdkResponse.from(
			new Response(Uint8Array.of(0, 127, 128, 255), {
				status: 202,
				headers,
			}),
		);
	}

	@Get("error-before-headers")
	errorBeforeHeaders(): AiSdkHttpResponse {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(new Error("expected test stream failure"));
			},
		});
		return AiSdkResponse.from(new Response(body, { status: 202 }));
	}

	@Get("error-after-headers")
	errorAfterHeaders(): AiSdkHttpResponse {
		let pulls = 0;
		const body = new ReadableStream<Uint8Array>(
			{
				async pull(controller) {
					pulls += 1;
					if (pulls === 1) {
						controller.enqueue(new TextEncoder().encode("partial response"));
						return;
					}

					await new Promise<void>((resolve) => setTimeout(resolve, 50));
					controller.error(new Error("expected post-header stream failure"));
				},
			},
			{ highWaterMark: 0 },
		);

		return AiSdkResponse.from(
			new Response(body, {
				status: 206,
				headers: { "content-type": "text/plain", "x-stream-state": "committed" },
			}),
		);
	}

	@Get("disconnect")
	disconnect(): AiSdkHttpResponse {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("connected"));
			},
			cancel() {
				disconnectProbe.resolve();
			},
		});

		return AiSdkResponse.from(new Response(body, { headers: { "content-type": "text/plain" } }));
	}
}

@Module({
	imports: [AiSdkHttpModule],
	controllers: [HttpTestController],
})
class HttpTestModule {}

describe(`AI SDK HTTP bridge (${testHttpAdapter})`, () => {
	let app: INestApplication;
	let baseUrl: string;

	beforeAll(async () => {
		const moduleReference = await Test.createTestingModule({
			imports: [HttpTestModule],
		}).compile();
		app = moduleReference.createNestApplication(
			testHttpAdapter === "fastify" ? new FastifyAdapter() : new ExpressAdapter(),
			{ logger: false },
		);
		await app.init();
		if (testHttpAdapter === "fastify") {
			await app.getHttpAdapter().getInstance().ready();
		}
		await app.listen(0, "127.0.0.1");
		baseUrl = await app.getUrl();
	});

	afterAll(async () => {
		await app.close();
	});

	it("leaves ordinary Nest handler values unchanged", async () => {
		const response = await request(app.getHttpServer()).get("/http/plain");

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ ok: true });
	});

	it("streams text with Fetch response metadata", async () => {
		const response = await request(app.getHttpServer()).get("/http/text");
		const nodeResponse = response as unknown as { res: { statusMessage: string } };

		expect(response.status).toBe(201);
		expect(nodeResponse.res.statusMessage).toBe("AI Created");
		expect(response.headers["content-type"]).toContain("text/plain");
		expect(response.headers["x-ai-response"]).toBe("text");
		expect(response.text).toBe("hello world");
	});

	it("streams UI messages in the AI SDK SSE protocol", async () => {
		const response = await request(app.getHttpServer()).get("/http/ui");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain("text/event-stream");
		expect(response.text).toContain('data: {"type":"text-delta","id":"text-1","delta":"from ui"}');
		expect(response.text).toContain("data: [DONE]");
	});

	it("runs agents through the upstream agent UI response helper", async () => {
		const response = await request(app.getHttpServer()).get("/http/agent");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain("text/event-stream");
		expect(response.text).toContain("from agent");
		expect(response.text).toContain("data: [DONE]");
	});

	it("preserves binary bytes and multiple Set-Cookie headers", async () => {
		const response = await request(app.getHttpServer()).get("/http/binary").buffer(true);

		expect(response.status).toBe(202);
		expect(response.headers["set-cookie"]).toEqual(["first=1; Path=/", "second=2; Path=/"]);
		expect(response.body).toEqual(Buffer.from([0, 127, 128, 255]));
	});

	it("keeps Nest exception handling available before headers are committed", async () => {
		const response = await request(app.getHttpServer()).get("/http/error-before-headers");

		expect(response.status).toBe(500);
		expect(response.body).toMatchObject({
			statusCode: 500,
			message: "Internal server error",
		});
	});

	it("terminates the connection when a stream fails after headers are committed", async () => {
		const response = await fetch(`${baseUrl}/http/error-after-headers`);
		const reader = response.body?.getReader();
		if (reader === undefined) throw new Error("Expected a streamed response body");

		expect(response.status).toBe(206);
		expect(response.headers.get("x-stream-state")).toBe("committed");
		const first = await reader.read();
		expect(first.done).toBe(false);
		expect(new TextDecoder().decode(first.value)).toBe("partial response");
		await expect(reader.read()).rejects.toThrow();
	});

	it("cancels the Fetch stream when the network client disconnects", async () => {
		disconnectProbe = createCancellationProbe();
		const abortController = new AbortController();
		const response = await fetch(`${baseUrl}/http/disconnect`, {
			signal: abortController.signal,
		});
		const reader = response.body?.getReader();
		if (reader === undefined) throw new Error("Expected a streamed response body");

		const first = await reader.read();
		expect(new TextDecoder().decode(first.value)).toBe("connected");
		const pendingRead = reader.read();
		abortController.abort();

		await expect(pendingRead).rejects.toThrow();
		await settleWithin(disconnectProbe.cancelled, 5_000);
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

async function settleWithin(promise: Promise<void>, timeoutMilliseconds: number): Promise<void> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(
					() => reject(new Error("Timed out waiting for stream cancellation")),
					timeoutMilliseconds,
				);
			}),
		]);
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
	}
}
