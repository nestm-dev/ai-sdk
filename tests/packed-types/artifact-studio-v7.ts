import type { AiSdkAgent } from "@nestm/ai-sdk";
import { AiSdkResponse, type AiSdkHttpResponse } from "@nestm/ai-sdk/http";
import { MockLanguageModelV4 } from "@nestm/ai-sdk/testing";
import {
	ToolLoopAgent,
	consumeStream,
	safeValidateUIMessages,
	tool,
	type InferAgentUIMessage,
	type InferUITools,
	type TimeoutConfiguration,
	type ToolSet,
	type UIMessage,
} from "ai";
import { z } from "zod";

const optionalTokenCount = z.number().int().nonnegative().optional();
const artifactMessageMetadataSchema = z
	.object({
		startedAt: z.number().int().nonnegative().optional(),
		completedAt: z.number().int().nonnegative().optional(),
		durationMs: z.number().int().nonnegative().optional(),
		model: z.string().min(1).optional(),
		finishReason: z
			.enum(["stop", "length", "content-filter", "tool-calls", "error", "other"])
			.optional(),
		inputTokens: optionalTokenCount,
		outputTokens: optionalTokenCount,
		totalTokens: optionalTokenCount,
		steps: z.number().int().nonnegative().optional(),
	})
	.strict();

type ArtifactMessageMetadata = z.infer<typeof artifactMessageMetadataSchema>;

const pathSchema = z.string().min(1);
const workspaceFileSchema = z
	.object({
		contentType: z.string(),
		etag: z.string().optional(),
		kind: z.literal("file"),
		lastModified: z.string().optional(),
		name: z.string(),
		path: pathSchema,
		size: z.number().int().nonnegative(),
	})
	.strict();
const workspaceDirectorySchema = z
	.object({
		kind: z.literal("directory"),
		name: z.string(),
		path: pathSchema,
	})
	.strict();
const workspacePageSchema = z
	.object({
		cursor: z.string().optional(),
		entries: z.array(z.union([workspaceDirectorySchema, workspaceFileSchema])),
	})
	.strict();
const workspaceTextFileSchema = workspaceFileSchema.extend({ text: z.string() }).strict();
const workspaceConflictSchema = z
	.object({
		kind: z.literal("artifact-conflict"),
		path: pathSchema,
		status: z.literal("already-exists"),
	})
	.strict();
const workspaceWriteInputSchema = z.discriminatedUnion("mode", [
	z
		.object({
			content: z.string(),
			mode: z.literal("create"),
			path: pathSchema,
		})
		.strict(),
	z
		.object({
			content: z.string(),
			etag: z.string().min(1),
			mode: z.literal("replace"),
			path: pathSchema,
		})
		.strict(),
]);

const artifactWorkspaceTools = {
	workspace_list: tool({
		inputSchema: z
			.object({
				cursor: z.string().optional(),
				directory: z.string().optional(),
				limit: z.number().int().positive().optional(),
				recursive: z.boolean().optional(),
			})
			.strict(),
		outputSchema: workspacePageSchema,
	}),
	workspace_stat: tool({
		inputSchema: z.object({ path: pathSchema }).strict(),
		outputSchema: workspaceFileSchema,
	}),
	workspace_read_file: tool({
		inputSchema: z.object({ path: pathSchema }).strict(),
		outputSchema: workspaceTextFileSchema,
	}),
	workspace_write_file: tool({
		inputSchema: workspaceWriteInputSchema,
		outputSchema: z.union([workspaceConflictSchema, workspaceFileSchema]),
	}),
} satisfies ToolSet;

const artifactAgent: AiSdkAgent<never, typeof artifactWorkspaceTools> = new ToolLoopAgent({
	id: "artifact-studio-packed-compat",
	model: new MockLanguageModelV4(),
	tools: artifactWorkspaceTools,
});

type ArtifactWorkspaceUITools = InferUITools<typeof artifactWorkspaceTools>;
type ArtifactUIMessage = InferAgentUIMessage<typeof artifactAgent, ArtifactMessageMetadata>;
type ExpectedArtifactUIMessage = UIMessage<
	ArtifactMessageMetadata,
	never,
	ArtifactWorkspaceUITools
>;
type ArtifactToolName =
	"workspace_list" | "workspace_stat" | "workspace_read_file" | "workspace_write_file";

type Equal<LEFT, RIGHT> =
	(<TYPE>() => TYPE extends LEFT ? 1 : 2) extends <TYPE>() => TYPE extends RIGHT ? 1 : 2
		? true
		: false;
type Assert<TYPE extends true> = TYPE;
type _ExactAgentUIMessage = Assert<Equal<ArtifactUIMessage, ExpectedArtifactUIMessage>>;
type _ExactActiveToolNames = Assert<Equal<keyof ArtifactWorkspaceUITools, ArtifactToolName>>;

const artifactStreamTimeout = {
	totalMs: 90_000,
	stepMs: 45_000,
	firstChunkMs: 15_000,
	chunkMs: 20_000,
	toolMs: 20_000,
} as const satisfies TimeoutConfiguration<typeof artifactWorkspaceTools>;

const artifactMessageFixture: ArtifactUIMessage = {
	id: "assistant-message",
	role: "assistant",
	metadata: { model: "mock-model", startedAt: 1 },
	parts: [
		{
			type: "tool-workspace_write_file",
			toolCallId: "replace-artifact",
			state: "input-available",
			input: {
				content: "# Updated artifact",
				etag: "current-etag",
				mode: "replace",
				path: "notes/artifact.md",
			},
		},
	],
};

async function createArtifactStudioAgentResponse(messages: unknown): Promise<AiSdkHttpResponse> {
	const validation = await safeValidateUIMessages<ArtifactUIMessage>({
		messages,
		metadataSchema: artifactMessageMetadataSchema.optional(),
		tools: artifactAgent.tools,
	});
	if (!validation.success) throw validation.error;

	const validatedMessages: ArtifactUIMessage[] = validation.data;
	const startedAt = Date.now();
	let steps = 0;

	return AiSdkResponse.agent({
		agent: artifactAgent,
		uiMessages: validatedMessages,
		originalMessages: validatedMessages,
		timeout: artifactStreamTimeout,
		consumeSseStream: consumeStream,
		onStepEnd: ({ staticToolCalls }) => {
			steps += 1;
			for (const toolCall of staticToolCalls) {
				const toolName: ArtifactToolName = toolCall.toolName;
				void toolName;
			}
		},
		messageMetadata: ({ part }): ArtifactMessageMetadata | undefined => {
			if (part.type === "start") return { model: "mock-model", startedAt };
			if (part.type !== "finish") return undefined;

			const completedAt = Date.now();
			return {
				completedAt,
				durationMs: completedAt - startedAt,
				finishReason: part.finishReason,
				inputTokens: part.totalUsage.inputTokens,
				model: "mock-model",
				outputTokens: part.totalUsage.outputTokens,
				startedAt,
				steps,
				totalTokens: part.totalUsage.totalTokens,
			};
		},
		onFinish: ({ responseMessage }) => {
			const metadata: ArtifactMessageMetadata | undefined = responseMessage.metadata;
			void metadata?.model;
		},
	});
}

export { artifactMessageFixture, createArtifactStudioAgentResponse };
