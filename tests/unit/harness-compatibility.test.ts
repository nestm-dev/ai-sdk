import { HarnessAgent } from "@ai-sdk/harness/agent";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import { createCodex } from "@ai-sdk/harness-codex";
import { createVercelSandbox } from "@ai-sdk/sandbox-vercel";
import { describe, expect, it } from "vitest";
import {
	AI_SDK_HARNESS_COMPATIBILITY,
	assertAiSdkHarnessCompatibility,
} from "../../src/harness/index.ts";

describe("Harness release-train compatibility", () => {
	it("loads the exact supported AI SDK and Harness train", () => {
		expect(assertAiSdkHarnessCompatibility).not.toThrow();
		expect(AI_SDK_HARNESS_COMPATIBILITY).toEqual({ ai: "7.0.52", harness: "1.0.58" });
	});

	it("constructs the real Claude Code and Codex adapters without provider calls", () => {
		const sandbox = createVercelSandbox({ runtime: "node24", ports: [43_123] });
		const claude = new HarnessAgent({ harness: createClaudeCode(), sandbox });
		const codex = new HarnessAgent({
			harness: createCodex(),
			sandbox,
			permissionMode: "allow-all",
		});

		expect(claude.harnessId).toBe("claude-code");
		expect(codex.harnessId).toBe("codex");
	});
});
