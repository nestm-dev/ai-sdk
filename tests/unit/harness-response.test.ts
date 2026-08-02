import type { HarnessAgent } from "@ai-sdk/harness/agent";
import type { TextStreamPart, ToolSet, UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import {
	AiSdkHarnessResponse,
	type AiSdkHarnessRunner,
	type AiSdkHarnessStreamResult,
} from "../../src/harness/index.ts";

describe("AiSdkHarnessResponse", () => {
	it("converts UI messages, preserves pull streaming, and waits for finalization", async () => {
		const completion = promiseController<void>();
		const runnerStream = vi.fn(async (_input: unknown) => ({
			stream: {
				stream: valueStream<TextStreamPart<ToolSet>>([
					{ type: "text-start", id: "text-1" },
					{ type: "text-delta", id: "text-1", text: "hello" },
					{ type: "text-end", id: "text-1" },
				]),
			} as AiSdkHarnessStreamResult,
			completion: completion.promise,
			cancel: vi.fn(),
		}));
		const runner = { stream: runnerStream } as unknown as AiSdkHarnessRunner;
		const agent = { tools: {} } as unknown as HarnessAgent;
		const uiMessages: UIMessage[] = [
			{ id: "message-1", role: "user", parts: [{ type: "text", text: "say hello" }] },
		];
		const result = await AiSdkHarnessResponse.ui({
			runner,
			agent,
			key: { namespace: "tenant", agentKey: "fixture", sessionId: "chat" },
			turn: { kind: "prompt" },
			uiMessages,
		});
		const response = await result.resolve();
		const bodyPromise = response.text();

		await vi.waitFor(() => expect(runnerStream).toHaveBeenCalledOnce());
		expect(runnerStream).toHaveBeenCalledWith(
			expect.objectContaining({
				turn: expect.objectContaining({ kind: "prompt", messages: expect.any(Array) }),
			}),
		);
		completion.resolve();
		const body = await bodyPromise;
		expect(body).toContain('data: {"type":"text-delta","id":"text-1","delta":"hello"}');
		expect(body).toContain("data: [DONE]");
	});

	it("preserves finalization error identity after the UI stream ends", async () => {
		const completion = promiseController<void>();
		const finalizationError = new Error("checkpoint commit failed");
		const runner = {
			stream: vi.fn(async () => ({
				stream: {
					stream: valueStream<TextStreamPart<ToolSet>>([]),
				} as AiSdkHarnessStreamResult,
				completion: completion.promise,
				cancel: vi.fn(),
			})),
		} as unknown as AiSdkHarnessRunner;
		const agent = { tools: {} } as unknown as HarnessAgent;
		const result = await AiSdkHarnessResponse.ui({
			runner,
			agent,
			key: { namespace: "tenant", agentKey: "fixture", sessionId: "chat" },
			turn: { kind: "prompt" },
			uiMessages: [],
		});
		const response = await result.resolve();
		const body = response.text();

		completion.reject(finalizationError);
		await expect(body).rejects.toBe(finalizationError);
	});

	it("forwards body cancellation while Harness cleanup completes", async () => {
		const completion = promiseController<void>();
		const cancel = vi.fn();
		const sourceCancel = vi.fn();
		const stream = new ReadableStream<TextStreamPart<ToolSet>>({
			start(controller) {
				controller.enqueue({ type: "text-start", id: "text-1" });
				controller.enqueue({ type: "text-delta", id: "text-1", text: "pending" });
			},
			cancel: sourceCancel,
		});
		const runner = {
			stream: vi.fn(async () => ({
				stream: { stream } as AiSdkHarnessStreamResult,
				completion: completion.promise,
				cancel,
			})),
		} as unknown as AiSdkHarnessRunner;
		const agent = { tools: {} } as unknown as HarnessAgent;
		const result = await AiSdkHarnessResponse.ui({
			runner,
			agent,
			key: { namespace: "tenant", agentKey: "fixture", sessionId: "chat" },
			turn: { kind: "prompt" },
			uiMessages: [],
		});
		const response = await result.resolve();
		const reader = response.body?.getReader();
		if (reader === undefined) throw new Error("Expected a response body.");
		await reader.read();

		const reason = new Error("client disconnected");
		const cancellation = reader.cancel(reason);
		await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith(reason));
		completion.resolve();
		await cancellation;

		expect(sourceCancel).toHaveBeenCalledWith(reason);
	});
});

function valueStream<T>(values: readonly T[]): ReadableStream<T> {
	return new ReadableStream<T>({
		start(controller) {
			for (const value of values) controller.enqueue(value);
			controller.close();
		},
	});
}

function promiseController<T>() {
	let resolvePromise!: (value: T | PromiseLike<T>) => void;
	let rejectPromise!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return { promise, resolve: resolvePromise, reject: rejectPromise };
}
