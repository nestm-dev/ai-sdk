import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { sendAiSdkResponse } from "../../src/http/index.js";

class TestResponse extends EventEmitter {
	statusCode = 200;
	statusMessage = "";
	headersSent = false;
	writableEnded = false;
	destroyed = false;
	readonly headers = new Map<string, string | readonly string[]>();
	readonly chunks: Uint8Array[] = [];
	readonly flush = vi.fn();
	readonly destroy = vi.fn((error?: Error) => {
		this.destroyed = true;
		return error;
	});
	writeResult = true;

	setHeader(name: string, value: string | readonly string[]): void {
		this.headers.set(name.toLowerCase(), value);
	}

	write(chunk: Uint8Array): boolean {
		this.headersSent = true;
		this.chunks.push(Uint8Array.from(chunk));
		return this.writeResult;
	}

	end(): void {
		this.headersSent = true;
		this.writableEnded = true;
	}

	body(): Uint8Array {
		return Uint8Array.from(Buffer.concat(this.chunks.map((chunk) => Buffer.from(chunk))));
	}
}

describe("sendAiSdkResponse", () => {
	it("preserves status, status text, headers, multiple cookies, and binary chunks", async () => {
		const headers = new Headers({ "content-type": "application/octet-stream" });
		headers.append("set-cookie", "first=1; Path=/");
		headers.append("set-cookie", "second=2; Path=/");
		const response = new TestResponse();
		const bytes = Uint8Array.from([0, 1, 127, 128, 255]);

		await sendAiSdkResponse(
			new Response(bytes, { status: 201, statusText: "Created by AI", headers }),
			response,
		);

		expect(response.statusCode).toBe(201);
		expect(response.statusMessage).toBe("Created by AI");
		expect(response.headers.get("content-type")).toBe("application/octet-stream");
		expect(response.headers.get("set-cookie")).toEqual(["first=1; Path=/", "second=2; Path=/"]);
		expect(response.body()).toEqual(bytes);
		expect(response.writableEnded).toBe(true);
	});

	it("waits for drain when the Node response applies backpressure", async () => {
		const response = new TestResponse();
		response.writeResult = false;
		const transfer = sendAiSdkResponse(
			new Response(byteStream(Uint8Array.of(1), Uint8Array.of(2))),
			response,
		);

		await waitUntil(() => response.chunks.length === 1);
		expect(response.writableEnded).toBe(false);
		response.writeResult = true;
		response.emit("drain");
		await transfer;

		expect(response.chunks).toEqual([Uint8Array.of(1), Uint8Array.of(2)]);
		expect(response.flush).toHaveBeenCalledTimes(2);
	});

	it("cancels the Fetch body when the client disconnects", async () => {
		const response = new TestResponse();
		let cancelReason: unknown = Symbol("not-cancelled");
		const body = new ReadableStream<Uint8Array>({
			start(streamController) {
				streamController.enqueue(Uint8Array.of(1));
			},
			cancel(reason) {
				cancelReason = reason;
			},
		});
		const transfer = sendAiSdkResponse(new Response(body), response);

		await waitUntil(() => response.chunks.length === 1);
		response.emit("close");
		await transfer;

		expect(cancelReason).toBeUndefined();
		expect(response.writableEnded).toBe(false);
	});

	it("does not mistake a completed incoming request for a client disconnect", async () => {
		const response = new TestResponse();
		const request = new EventEmitter();
		let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				streamController = controller;
				controller.enqueue(Uint8Array.of(1));
			},
			cancel,
		});
		const transfer = sendAiSdkResponse(new Response(body), response, request);

		await waitUntil(() => response.chunks.length === 1);
		request.emit("close");
		streamController?.enqueue(Uint8Array.of(2));
		streamController?.close();
		await transfer;

		expect(cancel).not.toHaveBeenCalled();
		expect(response.chunks).toEqual([Uint8Array.of(1), Uint8Array.of(2)]);
		expect(response.writableEnded).toBe(true);
	});

	it("leaves the platform response untouched when the first body read fails", async () => {
		const streamError = new Error("failed before headers");
		const response = new TestResponse();
		const hijack = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(streamError);
			},
		});

		await expect(
			sendAiSdkResponse(new Response(body, { status: 202 }), { raw: response, hijack }),
		).rejects.toBe(streamError);
		expect(hijack).not.toHaveBeenCalled();
		expect(response.headersSent).toBe(false);
		expect(response.statusCode).toBe(200);
		expect(response.destroy).not.toHaveBeenCalled();
	});

	it("hijacks Fastify and destroys a committed response on a late stream failure", async () => {
		const streamError = new Error("failed after headers");
		const response = new TestResponse();
		const hijack = vi.fn();
		let pulls = 0;
		const body = new ReadableStream<Uint8Array>(
			{
				pull(controller) {
					pulls += 1;
					if (pulls === 1) {
						controller.enqueue(Uint8Array.of(7));
						return;
					}
					controller.error(streamError);
				},
			},
			{ highWaterMark: 0 },
		);

		await expect(sendAiSdkResponse(new Response(body), { raw: response, hijack })).rejects.toBe(
			streamError,
		);
		expect(hijack).toHaveBeenCalledOnce();
		expect(response.chunks).toEqual([Uint8Array.of(7)]);
		expect(response.destroy).toHaveBeenCalledWith(streamError);
	});

	it("does not transfer a response body for HEAD requests", async () => {
		const response = new TestResponse();
		const request = new EventEmitter() as EventEmitter & { method: string };
		request.method = "HEAD";
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({ cancel });

		await sendAiSdkResponse(
			new Response(body, { headers: { "x-head": "yes" } }),
			response,
			request,
		);

		expect(cancel).toHaveBeenCalledOnce();
		expect(response.chunks).toHaveLength(0);
		expect(response.headers.get("x-head")).toBe("yes");
		expect(response.writableEnded).toBe(true);
	});
});

function byteStream(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(chunk);
			}
			controller.close();
		},
	});
}

async function waitUntil(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) {
			return;
		}
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	throw new Error("Timed out waiting for condition.");
}
