import { Inject, Injectable } from "@nestjs/common";
import { AiSdkService } from "@nestm/ai-sdk";
import { stepCountIs, ToolLoopAgent } from "ai";

import { PlaygroundConfigService } from "../config/playground-config.service.ts";
import type { StoredChat } from "./chat.types.ts";
import {
	PlaygroundChatToolsService,
	type PlaygroundChatTools,
} from "./playground-chat-tools.service.ts";

@Injectable()
export class PlaygroundChatAgentFactory {
	constructor(
		@Inject(AiSdkService)
		private readonly aiSdk: AiSdkService,
		@Inject(PlaygroundConfigService)
		private readonly config: PlaygroundConfigService,
		@Inject(PlaygroundChatToolsService)
		private readonly tools: PlaygroundChatToolsService,
	) {}

	create(
		chat: Pick<StoredChat, "id" | "provider" | "model">,
	): ToolLoopAgent<never, PlaygroundChatTools> {
		return new ToolLoopAgent({
			id: `playground-chat-${chat.id}`,
			model: this.aiSdk.languageModel(`${chat.provider}:${chat.model}`),
			instructions: [
				"You are a helpful local AI SDK playground agent.",
				"Answer directly, use tools when useful, and never claim a tool ran unless its result is present.",
				"Use the provider web search tool when the user asks for current information or sourced citations.",
				"Use durable_memory only when the user explicitly asks to remember, recall, or forget something.",
				"The durable_memory tool always requires explicit user approval.",
			].join("\n"),
			tools: this.tools.forChat(chat.id, chat.provider),
			toolApproval: { durable_memory: "user-approval" },
			stopWhen: stepCountIs(10),
			maxRetries: 0,
			maxOutputTokens: this.config.chatMaxOutputTokens,
			telemetry: {
				isEnabled: true,
				functionId: "playground.chat",
				recordInputs: false,
				recordOutputs: false,
			},
			...(chat.provider === "openai" ? { providerOptions: { openai: { store: false } } } : {}),
		});
	}
}

export type PlaygroundChatAgent = ReturnType<PlaygroundChatAgentFactory["create"]>;
