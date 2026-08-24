import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { Inject, Injectable } from "@nestjs/common";
import { setTimeout as delay } from "node:timers/promises";
import { AiSdkObservabilityService } from "@nestm/ai-sdk/observability";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import type { ProviderId } from "../config/playground-config.service.ts";
import { ChatRepository } from "./chat.repository.ts";
import { isSafeChatMemoryKey } from "./chat.types.ts";

const calculatorInputSchema = z.object({
	left: z.number().finite(),
	operator: z.enum(["add", "subtract", "multiply", "divide"]),
	right: z.number().finite(),
});

// Anthropic requires every custom tool input schema to have a top-level object
// type. A discriminated union serializes as a top-level oneOf instead, so keep
// the wire schema object-shaped and enforce the action/value relationship here.
const memoryInputSchema = z
	.object({
		action: z.enum(["read", "write", "delete"]),
		key: memoryKey(),
		value: z.string().max(2_000).optional(),
	})
	.superRefine((input, context) => {
		if (input.action === "write" && input.value === undefined) {
			context.addIssue({
				code: "custom",
				path: ["value"],
				message: "A memory write requires a value.",
			});
		}
		if (input.action !== "write" && input.value !== undefined) {
			context.addIssue({
				code: "custom",
				path: ["value"],
				message: "Only a memory write accepts a value.",
			});
		}
	});

@Injectable()
export class PlaygroundChatToolsService {
	constructor(
		@Inject(ChatRepository)
		private readonly repository: ChatRepository,
		@Inject(AiSdkObservabilityService)
		private readonly observability: AiSdkObservabilityService,
	) {}

	forChat(chatId: string, provider: ProviderId): PlaygroundChatTools {
		return {
			...providerSearchTools(provider),
			calculator: tool({
				description: "Perform one deterministic arithmetic operation.",
				inputSchema: calculatorInputSchema,
				execute: ({ left, operator, right }) => {
					if (operator === "divide" && right === 0) {
						return { ok: false as const, error: "division_by_zero" as const };
					}
					const value = calculate(left, operator, right);
					return Number.isFinite(value)
						? { ok: true as const, value }
						: { ok: false as const, error: "non_finite_result" as const };
				},
			}),
			current_time: tool({
				description: "Read the current time, optionally formatted in an IANA time zone.",
				inputSchema: z.object({ timezone: z.string().trim().min(1).max(64).default("UTC") }),
				execute: ({ timezone }) => {
					const now = new Date();
					return {
						iso: now.toISOString(),
						timezone,
						formatted: new Intl.DateTimeFormat("en-US", {
							dateStyle: "full",
							timeStyle: "long",
							timeZone: timezone,
						}).format(now),
					};
				},
			}),
			slow_wait: tool({
				description:
					"Wait for a bounded duration. Use this to demonstrate background runs and stream resume.",
				inputSchema: z.object({ milliseconds: z.number().int().min(100).max(15_000) }),
				execute: async ({ milliseconds }, options) => {
					await delay(milliseconds, undefined, { signal: options.abortSignal });
					return { waitedMs: milliseconds };
				},
			}),
			observability_inspect: tool({
				description:
					"Inspect the local content-free AI observability snapshot and summarize current usage.",
				inputSchema: z.object({}),
				execute: () => {
					const snapshot = this.observability.snapshot();
					return {
						schemaVersion: snapshot.schemaVersion,
						scope: snapshot.scope,
						capturedAt: snapshot.capturedAt,
						revision: snapshot.revision,
						contentCaptured: snapshot.coverage.contentCaptured,
						operations: snapshot.totals.operations,
						modelCalls: snapshot.totals.modelCalls,
						toolExecutions: snapshot.totals.toolExecutions,
						models: snapshot.models.map((model) => ({
							provider: model.provider,
							model: model.model,
							started: model.started,
							active: model.active,
							outcomes: model.outcomes,
						})),
					};
				},
			}),
			durable_memory: tool({
				description:
					"Read, write, or delete a small durable key/value memory for this chat. Every call requires user approval.",
				inputSchema: memoryInputSchema,
				execute: async (input) => {
					switch (input.action) {
						case "read":
							return {
								action: input.action,
								key: input.key,
								value: await this.repository.readMemory(chatId, input.key),
							};
						case "write":
							if (input.value === undefined) {
								throw new Error("A validated memory write must include a value.");
							}
							await this.repository.writeMemory(chatId, input.key, input.value);
							return { action: input.action, key: input.key, saved: true as const };
						case "delete":
							return {
								action: input.action,
								key: input.key,
								deleted: await this.repository.deleteMemory(chatId, input.key),
							};
					}
				},
			}),
		};
	}
}

export type PlaygroundChatTools = ToolSet;

function providerSearchTools(provider: ProviderId): ToolSet {
	switch (provider) {
		case "openai":
			return { web_search: openai.tools.webSearch({ searchContextSize: "medium" }) };
		case "anthropic":
			return { web_search: anthropic.tools.webSearch_20250305({ maxUses: 3 }) };
		case "google":
			return {
				google_search: google.tools.googleSearch({ searchTypes: { webSearch: {} } }),
			};
	}
}

function memoryKey() {
	return z
		.string()
		.trim()
		.min(1)
		.max(64)
		.regex(/^[A-Za-z0-9._-]+$/u)
		.refine(isSafeChatMemoryKey, "Memory key is reserved.");
}

function calculate(
	left: number,
	operator: z.infer<typeof calculatorInputSchema>["operator"],
	right: number,
): number {
	switch (operator) {
		case "add":
			return left + right;
		case "subtract":
			return left - right;
		case "multiply":
			return left * right;
		case "divide":
			return left / right;
	}
}
