import { afterEach, expect, it, vi } from "vitest";
import { streamText, tool, wrapLanguageModel } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { z } from "zod";
import { createAiSdkModelTimeoutMiddleware } from "../../src/ai-sdk-model-timeout.ts";

afterEach(() => vi.useRealTimers());
const usage = {
	inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 1, text: 1, reasoning: 0 },
};

it("clears provider deadlines before a long tool executes", async () => {
	vi.useFakeTimers();
	const execute = vi.fn(async () => {
		await new Promise((resolve) => setTimeout(resolve, 200));
		return "saved";
	});
	const model = wrapLanguageModel({
		model: new MockLanguageModelV4({
			doStream: async () => ({
				stream: simulateReadableStream({
					initialDelayInMs: null,
					chunkDelayInMs: null,
					chunks: [
						{ type: "stream-start", warnings: [] },
						{ type: "tool-call", toolName: "writer", toolCallId: "write", input: "{}" },
						{ type: "finish", finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage },
					],
				}),
			}),
		}),
		middleware: createAiSdkModelTimeoutMiddleware({ totalMs: 50, chunkMs: 20 }),
	});
	const result = streamText({
		model,
		prompt: "Write",
		timeout: { totalMs: 1000, toolMs: 500 },
		tools: { writer: tool({ inputSchema: z.object({}), execute }) },
	});
	const completed = result.toolResults;
	await vi.advanceTimersByTimeAsync(250);
	expect(await completed).toHaveLength(1);
	expect(execute).toHaveBeenCalledOnce();
	expect(await result.finishReason).toBe("tool-calls");
	expect(vi.getTimerCount()).toBe(0);
});

it.each(["first", "chunk", "total"] as const)(
	"cancels a stalled %s provider stream",
	async (kind) => {
		vi.useFakeTimers();
		const cancel = vi.fn();
		const model = wrapLanguageModel({
			model: new MockLanguageModelV4({
				doStream: async () => ({
					stream: new ReadableStream({
						start(controller) {
							if (kind === "chunk") controller.enqueue({ type: "text-start", id: "text" });
						},
						cancel,
					}),
				}),
			}),
			middleware: createAiSdkModelTimeoutMiddleware(
				kind === "first"
					? { firstChunkMs: 20 }
					: kind === "chunk"
						? { chunkMs: 20 }
						: { totalMs: 20 },
			),
		});
		const response = await model.doStream({ prompt: [] });
		const consume = (async () => {
			for await (const _ of response.stream) {
				/* drain */
			}
		})();
		const rejection = expect(consume).rejects.toMatchObject({ name: "TimeoutError" });
		await vi.advanceTimersByTimeAsync(25);
		await rejection;
		expect(cancel).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	},
);

it("links caller cancellation and releases a cancelled consumer", async () => {
	const cancel = vi.fn();
	const abort = new AbortController();
	const model = wrapLanguageModel({
		model: new MockLanguageModelV4({
			doStream: async () => ({ stream: new ReadableStream({ cancel }) }),
		}),
		middleware: createAiSdkModelTimeoutMiddleware({ totalMs: 1000 }),
	});
	const response = await model.doStream({ prompt: [], abortSignal: abort.signal });
	const reader = response.stream.getReader();
	const pending = reader.read();
	abort.abort(new Error("revoked"));
	await expect(pending).rejects.toThrow("revoked");
	expect(cancel).toHaveBeenCalledOnce();
	const second = await model.doStream({ prompt: [] });
	await second.stream.cancel("stopped");
	expect(cancel).toHaveBeenCalledTimes(2);
});
