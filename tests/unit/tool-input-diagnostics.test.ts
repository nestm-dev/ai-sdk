import { InvalidToolInputError, streamText, tool, type ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAiSdkToolInputDiagnostics } from "../../src/index.ts";

const usage = {
	inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 1, text: 1, reasoning: 0 },
};
type ModelResponse = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type StreamPart = ModelResponse["stream"] extends ReadableStream<infer Part> ? Part : never;
function response(parts: StreamPart[]): ModelResponse {
	return {
		stream: new ReadableStream({
			start(controller) {
				controller.enqueue({ type: "stream-start", warnings: [] });
				for (const part of parts) controller.enqueue(part);
				controller.enqueue({
					type: "finish",
					finishReason: { unified: parts.length ? "tool-calls" : "stop", raw: undefined },
					usage,
				});
				controller.close();
			},
		}),
	};
}

describe("bounded model-facing tool input diagnostics", () => {
	it.each([
		JSON.stringify({ content: "PRIVATE_REJECTED_BODY_" + "x".repeat(40_000) }),
		JSON.stringify({ content: "é".repeat(16_385) }),
		JSON.stringify({ content: 123 }),
		'{"content":',
	])("sanitizes validation failures before the next native model call", async (input) => {
		const diagnostics = createAiSdkToolInputDiagnostics();
		const execute = vi.fn(() => "saved");
		const toModelOutput = vi.fn(() => ({ type: "text" as const, value: "hook" }));
		const model = new MockLanguageModelV4({
			doStream: [
				response([{ type: "tool-call", toolName: "append", toolCallId: "call-1", input }]),
				response([]),
			],
		});
		const result = streamText({
			model,
			messages: [{ role: "user", content: "Write a file" }],
			stopWhen: [],
			tools: {
				append: tool({
					inputSchema: z.strictObject({
						content: z
							.string()
							.max(32768)
							.refine(
								(value) => new TextEncoder().encode(value).byteLength <= 32768,
								"PRIVATE_CUSTOM_ERROR",
							),
					}),
					execute,
					toModelOutput,
				}),
			},
			onStepEnd: diagnostics.recordStep,
			prepareStep: ({ messages }) => ({ messages: diagnostics.prepareMessages(messages) }),
		});
		await result.consumeStream();
		const calls = (await result.steps)[0]!.toolCalls;
		expect(calls[0]?.invalid).toBe(true);
		expect(InvalidToolInputError.isInstance(calls[0]?.error)).toBe(true);
		expect(execute).not.toHaveBeenCalled();
		expect(toModelOutput).not.toHaveBeenCalled();
		const prompt = model.doStreamCalls[1]!.prompt;
		const toolMessage = prompt.find((message) => message.role === "tool");
		const output = JSON.stringify(toolMessage);
		expect(output).toContain("INVALID_TOOL_INPUT");
		expect(output).not.toContain("PRIVATE_REJECTED_BODY");
		expect(output).not.toContain("PRIVATE_CUSTOM_ERROR");
		expect(output).not.toContain("é".repeat(10));
		const part = toolMessage?.content[0];
		if (part?.type !== "tool-result") throw new Error("Missing result");
		expect(new TextEncoder().encode(JSON.stringify(part.output)).byteLength).toBeLessThan(2100);
		if (input.includes("123")) expect(output).toContain("invalid_type");
		if (input.includes("PRIVATE_REJECTED_BODY")) {
			expect(output).toContain("maximum");
			expect(output).toContain("32768");
			// Source stays once in the original assistant tool call, never duplicated in the error.
			expect(JSON.stringify(prompt).match(/PRIVATE_REJECTED_BODY_/gu)).toHaveLength(1);
		}
		diagnostics.clear();
	});

	it("preserves successful source diagnostics, unrelated errors, pairing and provider options", () => {
		const diagnostics = createAiSdkToolInputDiagnostics();
		const error = new InvalidToolInputError({
			toolName: "edit",
			toolInput: "{}",
			cause: new Error("PRIVATE_EXCEPTION"),
		});
		diagnostics.recordStep({
			toolCalls: [
				{
					type: "tool-call",
					toolName: "edit",
					toolCallId: "failed",
					input: {},
					dynamic: true,
					invalid: true,
					error,
				},
			],
		});
		const messages: ModelMessage[] = [
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolName: "edit",
						toolCallId: "failed",
						providerOptions: { google: { marker: "retained" } },
						output: { type: "error-json", value: { private: "error" } },
					},
					{
						type: "tool-result",
						toolName: "edit",
						toolCallId: "admission",
						output: {
							type: "json",
							value: { valid: false, draftId: "retained", diagnostics: ["source context"] },
						},
					},
					{
						type: "tool-result",
						toolName: "other",
						toolCallId: "failed",
						output: { type: "error-text", value: "owned failure" },
					},
				],
			},
		];
		const source = JSON.stringify(messages);
		const projected = diagnostics.prepareMessages(messages);
		expect(JSON.stringify(messages)).toBe(source);
		expect(projected[0]).toMatchObject({
			content: [
				{
					toolCallId: "failed",
					toolName: "edit",
					providerOptions: { google: { marker: "retained" } },
				},
				messages[0]!.content[1],
				messages[0]!.content[2],
			],
		});
		expect(JSON.stringify(projected)).not.toContain("PRIVATE_EXCEPTION");
		diagnostics.clear();
		expect(diagnostics.prepareMessages(messages)).toEqual(messages);
	});

	it("bounds nested issue paths and never formats arbitrary issue messages or values", () => {
		const diagnostics = createAiSdkToolInputDiagnostics();
		const error = new InvalidToolInputError({
			toolName: "edit",
			toolInput: "SECRET",
			cause: {
				issues: Array.from({ length: 200 }, () => ({
					code: "custom",
					path: ["changes", 0, "💾".repeat(500)],
					message: "SECRET",
					input: "SECRET",
				})),
			},
		});
		diagnostics.recordStep({
			toolCalls: [
				{
					type: "tool-call",
					toolName: "edit",
					toolCallId: "failed",
					input: {},
					dynamic: true,
					invalid: true,
					error,
				},
			],
		});
		const projected = diagnostics.prepareMessages([
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolName: "edit",
						toolCallId: "failed",
						output: { type: "error-text", value: "SECRET" },
					},
				],
			},
		]);
		expect(JSON.stringify(projected)).not.toContain("SECRET");
		const message = projected[0];
		if (message?.role !== "tool") throw new Error("Missing result");
		const part = message.content[0];
		if (part?.type !== "tool-result" || part.output.type !== "error-text")
			throw new Error("Missing diagnostic");
		expect(new TextEncoder().encode(part.output.value).byteLength).toBeLessThanOrEqual(2048);
		expect(JSON.parse(part.output.value).issues.length).toBeLessThanOrEqual(8);
	});
});
