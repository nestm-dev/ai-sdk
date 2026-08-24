import type { UIMessage } from "ai";
import { z } from "zod";

import { providerIdSchema, type ProviderId } from "@/lib/compare-schema";

const safeCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestampSchema = z.string().datetime({ offset: true });
export const MAX_CHAT_INPUT_MESSAGES = 200;

export const chatMessageMetadataSchema = z
	.object({
		chatId: z.uuid().optional(),
		runId: z.uuid().optional(),
		provider: providerIdSchema.optional(),
		model: z.string().trim().min(1).max(128).optional(),
		startedAt: z.union([safeCount, timestampSchema]).optional(),
		completedAt: z.union([safeCount, timestampSchema]).optional(),
		durationMs: safeCount.optional(),
		finishReason: z.string().trim().min(1).max(64).optional(),
		stepCount: safeCount.optional(),
		inputTokens: safeCount.optional(),
		outputTokens: safeCount.optional(),
		totalTokens: safeCount.optional(),
	})
	.passthrough();

export type ChatMessageMetadata = z.infer<typeof chatMessageMetadataSchema>;
export type PlaygroundUIMessage = UIMessage<ChatMessageMetadata>;

const boundedString = z.string().max(2 * 1024 * 1024);
const webUrlSchema = boundedString
	.min(1)
	.refine((value) => hasProtocol(value, ["http:", "https:"]), {
		message: "Expected an HTTP(S) URL.",
	});
const fileUrlSchema = boundedString
	.min(1)
	.refine((value) => hasProtocol(value, ["data:", "http:", "https:"]), {
		message: "Expected a data or HTTP(S) URL.",
	});
const partIdSchema = z.string().trim().min(1).max(256);
const partStateSchema = z.enum(["streaming", "done"]);
const jsonValueSchema = z.json();
const providerMetadataSchema = z.record(
	z.string().trim().min(1).max(128),
	z.record(z.string().trim().min(1).max(256), jsonValueSchema),
);
const providerReferenceSchema = z.record(
	z.string().trim().min(1).max(128),
	z.string().trim().min(1).max(512),
);
const toolMetadataSchema = z.record(z.string().trim().min(1).max(256), jsonValueSchema);

const providerMetadataFields = {
	providerMetadata: providerMetadataSchema.optional(),
} as const;

const textPartSchema = z
	.object({
		type: z.literal("text"),
		text: boundedString,
		state: partStateSchema.optional(),
		...providerMetadataFields,
	})
	.strict();

const reasoningPartSchema = z
	.object({
		type: z.literal("reasoning"),
		id: partIdSchema.optional(),
		text: boundedString,
		state: partStateSchema.optional(),
		...providerMetadataFields,
	})
	.strict();

const customPartSchema = z
	.object({
		type: z.literal("custom"),
		kind: z
			.string()
			.trim()
			.regex(/^[^.\s]+\.[^\s]+$/u)
			.max(256),
		...providerMetadataFields,
	})
	.strict();

const sourceUrlPartSchema = z
	.object({
		type: z.literal("source-url"),
		sourceId: partIdSchema,
		url: webUrlSchema,
		title: boundedString.optional(),
		...providerMetadataFields,
	})
	.strict();

const sourceDocumentPartSchema = z
	.object({
		type: z.literal("source-document"),
		sourceId: partIdSchema,
		mediaType: z.string().trim().min(1).max(256),
		title: boundedString,
		filename: z.string().trim().min(1).max(512).optional(),
		...providerMetadataFields,
	})
	.strict();

const filePartSchema = z
	.object({
		type: z.literal("file"),
		mediaType: z.string().trim().min(1).max(256),
		filename: z.string().trim().min(1).max(512).optional(),
		url: fileUrlSchema,
		providerReference: providerReferenceSchema.optional(),
		...providerMetadataFields,
	})
	.strict();

const reasoningFilePartSchema = z
	.object({
		type: z.literal("reasoning-file"),
		mediaType: z.string().trim().min(1).max(256),
		url: fileUrlSchema,
		...providerMetadataFields,
	})
	.strict();

const stepStartPartSchema = z.object({ type: z.literal("step-start") }).strict();

const dataPartSchema = z
	.object({
		type: z
			.string()
			.trim()
			.regex(/^data-[A-Za-z0-9][A-Za-z0-9._-]{0,122}$/u),
		id: partIdSchema.optional(),
		data: jsonValueSchema,
	})
	.strict();

const approvalBaseFields = {
	id: partIdSchema,
	isAutomatic: z.boolean().optional(),
	signature: boundedString.optional(),
} as const;

const approvalRequestedSchema = z
	.object({
		...approvalBaseFields,
		approved: z.never().optional(),
		reason: z.never().optional(),
	})
	.strict();

const approvalRespondedSchema = z
	.object({
		...approvalBaseFields,
		approved: z.boolean(),
		reason: boundedString.optional(),
	})
	.strict();

const approvalGrantedSchema = approvalRespondedSchema.extend({ approved: z.literal(true) });
const approvalDeniedSchema = approvalRespondedSchema.extend({ approved: z.literal(false) });

const toolCommonFields = {
	toolCallId: partIdSchema,
	title: boundedString.optional(),
	toolMetadata: toolMetadataSchema.optional(),
	providerExecuted: z.boolean().optional(),
} as const;

const toolProviderFields = {
	callProviderMetadata: providerMetadataSchema.optional(),
	resultProviderMetadata: providerMetadataSchema.optional(),
} as const;

const toolStateSchemas = [
	z
		.object({
			state: z.literal("input-streaming"),
			input: jsonValueSchema.optional(),
			output: z.never().optional(),
			errorText: z.never().optional(),
			callProviderMetadata: toolProviderFields.callProviderMetadata,
			approval: z.never().optional(),
		})
		.strict(),
	z
		.object({
			state: z.literal("input-available"),
			input: jsonValueSchema,
			output: z.never().optional(),
			errorText: z.never().optional(),
			callProviderMetadata: toolProviderFields.callProviderMetadata,
			approval: z.never().optional(),
		})
		.strict(),
	z
		.object({
			state: z.literal("approval-requested"),
			input: jsonValueSchema,
			output: z.never().optional(),
			errorText: z.never().optional(),
			callProviderMetadata: toolProviderFields.callProviderMetadata,
			approval: approvalRequestedSchema,
		})
		.strict(),
	z
		.object({
			state: z.literal("approval-responded"),
			input: jsonValueSchema,
			output: z.never().optional(),
			errorText: z.never().optional(),
			callProviderMetadata: toolProviderFields.callProviderMetadata,
			approval: approvalRespondedSchema,
		})
		.strict(),
	z
		.object({
			state: z.literal("output-available"),
			input: jsonValueSchema,
			output: jsonValueSchema,
			errorText: z.never().optional(),
			...toolProviderFields,
			preliminary: z.boolean().optional(),
			approval: approvalGrantedSchema.optional(),
		})
		.strict(),
	z
		.object({
			state: z.literal("output-error"),
			input: jsonValueSchema.optional(),
			rawInput: jsonValueSchema.optional(),
			output: z.never().optional(),
			errorText: boundedString.min(1),
			...toolProviderFields,
			approval: approvalGrantedSchema.optional(),
		})
		.strict(),
	z
		.object({
			state: z.literal("output-denied"),
			input: jsonValueSchema,
			output: z.never().optional(),
			errorText: z.never().optional(),
			callProviderMetadata: toolProviderFields.callProviderMetadata,
			approval: approvalDeniedSchema,
		})
		.strict(),
] as const;

function toolPartSchema(typeFields: Readonly<Record<string, z.ZodType>>) {
	return z.union(
		toolStateSchemas.map((stateSchema) =>
			z.object({ ...typeFields, ...toolCommonFields, ...stateSchema.shape }).strict(),
		),
	);
}

const staticToolPartSchema = toolPartSchema({
	type: z
		.string()
		.trim()
		.regex(/^tool-[A-Za-z0-9][A-Za-z0-9._-]{0,122}$/u),
});
const dynamicToolPartSchema = toolPartSchema({
	type: z.literal("dynamic-tool"),
	toolName: z.string().trim().min(1).max(128),
});

const messagePartSchema = z.union([
	textPartSchema,
	reasoningPartSchema,
	customPartSchema,
	sourceUrlPartSchema,
	sourceDocumentPartSchema,
	filePartSchema,
	reasoningFilePartSchema,
	stepStartPartSchema,
	dataPartSchema,
	staticToolPartSchema,
	dynamicToolPartSchema,
]);

function hasProtocol(value: string, allowedProtocols: readonly string[]): boolean {
	try {
		return allowedProtocols.includes(new URL(value).protocol);
	} catch {
		return false;
	}
}

export const playgroundUIMessageSchema = z
	.object({
		id: z.string().trim().min(1).max(256),
		role: z.enum(["system", "user", "assistant"]),
		parts: z.array(messagePartSchema).max(256),
		metadata: chatMessageMetadataSchema.optional(),
	})
	.strict();

export const runStatusSchema = z.enum(["running", "completed", "failed", "cancelled"]);

export const runViewSchema = z
	.object({
		id: z.uuid(),
		status: runStatusSchema,
		provider: providerIdSchema,
		model: z.string().trim().min(1).max(128),
		startedAt: timestampSchema,
		completedAt: timestampSchema.nullable(),
	})
	.strict();

export type RunView = z.infer<typeof runViewSchema>;

export const chatSummarySchema = z
	.object({
		id: z.uuid(),
		title: z.string().trim().min(1).max(120),
		provider: providerIdSchema,
		model: z.string().trim().min(1).max(128),
		createdAt: timestampSchema,
		updatedAt: timestampSchema,
		messageCount: safeCount,
		activeRun: runViewSchema.nullable(),
	})
	.strict();

export type ChatSummary = z.infer<typeof chatSummarySchema>;

const chatViewWireSchema = chatSummarySchema.extend({
	messages: z.array(playgroundUIMessageSchema).max(1_000),
});

export interface ChatView extends ChatSummary {
	readonly messages: PlaygroundUIMessage[];
}

export const chatViewSchema: z.ZodType<ChatView> = chatViewWireSchema.transform(
	(value) => value as ChatView,
);

export const chatListSchema = z
	.object({
		chats: z.array(chatSummarySchema).max(100),
		nextCursor: z.uuid().nullable(),
	})
	.strict();
export type ChatList = z.infer<typeof chatListSchema>;

export const createChatRequestSchema = z
	.object({
		provider: providerIdSchema,
		title: z.string().trim().min(1).max(120).optional(),
	})
	.strict();

export const updateChatRequestSchema = z
	.object({
		provider: providerIdSchema.optional(),
		title: z.string().trim().min(1).max(120).optional(),
	})
	.strict()
	.refine((input) => input.provider !== undefined || input.title !== undefined, {
		message: "At least one chat field is required.",
	});

export const chatStreamRequestSchema = z
	.object({
		messages: z.array(playgroundUIMessageSchema).min(1).max(MAX_CHAT_INPUT_MESSAGES),
		trigger: z.enum(["submit-message", "regenerate-message"]),
		messageId: z.string().trim().min(1).max(256).optional(),
	})
	.strict();

export const cancelRunResponseSchema = z.object({ run: runViewSchema }).strict();

const providerDescriptionSchema = z
	.object({
		provider: providerIdSchema,
		model: z.string().trim().min(1).max(128),
	})
	.strict();

export const providerCatalogSchema = z
	.object({ providers: z.array(providerDescriptionSchema).length(3) })
	.strict()
	.superRefine((catalog, context) => {
		const providers = catalog.providers.map((entry) => entry.provider);
		if (new Set(providers).size !== providers.length) {
			context.addIssue({
				code: "custom",
				path: ["providers"],
				message: "Providers must be unique.",
			});
		}
	});

export type ProviderDescription = z.infer<typeof providerDescriptionSchema>;

export const CHAT_PROVIDER_LABELS: Readonly<Record<ProviderId, string>> = Object.freeze({
	openai: "OpenAI",
	anthropic: "Claude",
	google: "Gemini",
});
