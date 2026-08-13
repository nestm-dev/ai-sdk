import { Output, ToolLoopAgent, tool } from "ai";
import type { Agent, InferAgentUIMessage, InferUIMessageChunk, ToolSet, UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { AiSdkResponse } from "../../src/http/index.ts";
import type { AiSdkUIMessageStreamSource } from "../../src/http/index.ts";

const tools = {
	echo: tool({
		inputSchema: z.object({ value: z.string() }),
		execute: ({ value }) => ({ value }),
	}),
} satisfies ToolSet;

const structuredOutput = Output.object({
	schema: z.object({ answer: z.string() }),
});

const agent = new ToolLoopAgent({
	model: new MockLanguageModelV4(),
	tools,
	output: structuredOutput,
	runtimeContext: { tenantId: "tenant" },
	callOptionsSchema: z.object({ tone: z.enum(["brief", "detailed"]) }),
});

const response = AiSdkResponse.agent({
	agent,
	uiMessages: [],
	options: { tone: "brief" },
	onStepEnd: (event) => {
		const tenantId: string = event.runtimeContext.tenantId;
		const toolName: "echo" = event.staticToolCalls[0]!.toolName;
		void tenantId;
		void toolName;
	},
	onFinish: ({ messages }) => {
		type _MessageInference = Assert<
			Equal<(typeof messages)[number], InferAgentUIMessage<typeof agent>>
		>;
	},
});

type MetadataUIMessage = UIMessage<{ model: string }>;
const metadataChunks = new ReadableStream<InferUIMessageChunk<MetadataUIMessage>>();
AiSdkResponse.ui<MetadataUIMessage>(metadataChunks, { status: 200 });
// @ts-expect-error raw UI message chunks are already assembled, so conversion callbacks do not run
AiSdkResponse.ui<MetadataUIMessage>(metadataChunks, {
	onFinish: () => undefined,
});
const sourceWithMetadata: AiSdkUIMessageStreamSource<MetadataUIMessage> = {
	toUIMessageStream: (_options) => metadataChunks,
};
AiSdkResponse.ui<MetadataUIMessage>(sourceWithMetadata, {
	onFinish: ({ responseMessage }) => {
		const model: string | undefined = responseMessage.metadata?.model;
		void model;
	},
});

const metadataMessages: InferAgentUIMessage<
	typeof agent,
	{ model: string; durationMs?: number }
>[] = [];
AiSdkResponse.agent({
	agent,
	options: { tone: "brief" },
	uiMessages: metadataMessages,
	onFinish: ({ responseMessage }) => {
		const model: string | undefined = responseMessage.metadata?.model;
		const durationMs: number | undefined = responseMessage.metadata?.durationMs;
		void model;
		void durationMs;
	},
});
void response.resolve({ abortSignal: new AbortController().signal });
// @ts-expect-error response contexts require a real AbortSignal
void response.resolve({ abortSignal: "cancel" });

AiSdkResponse.agent({
	agent,
	options: { tone: "brief" },
	uiMessages: [
		{
			id: "assistant-message",
			role: "assistant",
			parts: [
				{
					type: "tool-echo",
					toolCallId: "tool-call",
					state: "input-available",
					input: {
						// @ts-expect-error agent UI messages retain the echo tool input schema
						value: 123,
					},
				},
			],
		},
	],
});

// @ts-expect-error call options remain required by the upstream agent
AiSdkResponse.agent({ agent, uiMessages: [] });

AiSdkResponse.agent({
	agent,
	uiMessages: [],
	// @ts-expect-error call option literals are preserved
	options: { tone: "verbose" },
});

AiSdkResponse.agent({
	// @ts-expect-error only upstream Agent implementations are accepted
	agent: { version: "agent-v1" },
	uiMessages: [],
});

type AgentTraits<AGENT> =
	AGENT extends Agent<infer CALL_OPTIONS, infer TOOLS, infer RUNTIME_CONTEXT, infer OUTPUT>
		? [CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT, OUTPUT]
		: never;

type Equal<LEFT, RIGHT> =
	(<TYPE>() => TYPE extends LEFT ? 1 : 2) extends <TYPE>() => TYPE extends RIGHT ? 1 : 2
		? true
		: false;
type Assert<TYPE extends true> = TYPE;

type _CallOptions = Assert<Equal<AgentTraits<typeof agent>[0], { tone: "brief" | "detailed" }>>;
type _Tools = Assert<Equal<AgentTraits<typeof agent>[1], typeof tools>>;
type _RuntimeContext = Assert<Equal<AgentTraits<typeof agent>[2], { tenantId: string }>>;
type _Output = Assert<Equal<AgentTraits<typeof agent>[3], typeof structuredOutput>>;
