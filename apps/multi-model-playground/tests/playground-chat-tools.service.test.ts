import { asSchema } from "ai";
import { describe, expect, it, vi } from "vitest";

import { PlaygroundChatToolsService } from "../src/chats/playground-chat-tools.service.ts";

describe("playground chat tools", () => {
	it("emits an Anthropic-compatible top-level object schema for durable memory", async () => {
		const service = new PlaygroundChatToolsService(
			{
				readMemory: vi.fn(),
				writeMemory: vi.fn(),
				deleteMemory: vi.fn(),
			} as never,
			{ snapshot: vi.fn() } as never,
		);
		const memoryTool = service.forChat("chat-id", "anthropic").durable_memory;
		if (memoryTool === undefined || !("inputSchema" in memoryTool)) {
			throw new Error("Expected the durable memory tool.");
		}

		const jsonSchema = await asSchema(memoryTool.inputSchema).jsonSchema;

		expect(jsonSchema).toMatchObject({
			type: "object",
			properties: {
				action: { enum: ["read", "write", "delete"] },
				key: { type: "string" },
				value: { type: "string" },
			},
		});
	});
});
