import { HarnessAgent } from "@ai-sdk/harness/agent";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import { createCodex } from "@ai-sdk/harness-codex";
import { createVercelSandbox } from "@ai-sdk/sandbox-vercel";
import {
	AiSdkHarnessResponse,
	AiSdkHarnessRunner,
	type InferAiSdkHarnessUIMessage,
} from "../../src/harness/index.ts";
import {
	InMemoryAiSdkHarnessSessionLeaseManager,
	InMemoryAiSdkHarnessSessionStore,
} from "../../src/harness/testing/index.ts";

const sandbox = createVercelSandbox({ runtime: "node24", ports: [43_123] });
const claude = new HarnessAgent({
	harness: createClaudeCode(),
	sandbox,
	permissionMode: "allow-reads",
});
const codex = new HarnessAgent({
	harness: createCodex(),
	sandbox,
	permissionMode: "allow-all",
});
const runner = new AiSdkHarnessRunner({
	sessionStore: new InMemoryAiSdkHarnessSessionStore(),
	leaseManager: new InMemoryAiSdkHarnessSessionLeaseManager(),
});

type ClaudeUiMessage = InferAiSdkHarnessUIMessage<typeof claude>;
declare const uiMessages: readonly ClaudeUiMessage[];
declare const exerciseTypes: boolean;

if (exerciseTypes) {
	void runner.stream({
		agent: claude,
		key: { namespace: "tenant", agentKey: "claude", sessionId: "chat" },
		turn: { kind: "prompt", messages: [] },
	});
	void runner.stream({
		agent: codex,
		key: { namespace: "tenant", agentKey: "codex", sessionId: "chat" },
		turn: { kind: "continue" },
	});
	void AiSdkHarnessResponse.ui({
		runner,
		agent: claude,
		key: { namespace: "tenant", agentKey: "claude", sessionId: "chat" },
		turn: { kind: "prompt" },
		uiMessages,
	});
}
