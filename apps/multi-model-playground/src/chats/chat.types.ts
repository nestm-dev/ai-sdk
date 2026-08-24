import type { FinishReason, InferUITools, LanguageModelUsage, ToolSet, UIMessage } from "ai";

import type { ProviderId } from "../config/playground-config.service.ts";

export const MAX_CHAT_INPUT_MESSAGES = 200;
export const MAX_STORED_CHAT_MESSAGES = MAX_CHAT_INPUT_MESSAGES + 1;

const RESERVED_CHAT_MEMORY_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype));

export function isSafeChatMemoryKey(key: string): boolean {
	return !RESERVED_CHAT_MEMORY_KEYS.has(key);
}

export type ChatRunStatus = "running" | "completed" | "failed" | "cancelled";

export interface PlaygroundChatMessageMetadata {
	readonly chatId: string;
	readonly runId: string;
	readonly provider: ProviderId;
	readonly model: string;
	readonly startedAt: string;
	readonly completedAt?: string;
	readonly durationMs?: number;
	readonly finishReason?: FinishReason;
	readonly stepCount?: number;
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly totalTokens?: number;
}

export type PlaygroundChatUIMessage = UIMessage<
	PlaygroundChatMessageMetadata,
	never,
	InferUITools<ToolSet>
>;

export interface StoredChat {
	readonly id: string;
	title: string;
	provider: ProviderId;
	model: string;
	readonly createdAt: string;
	updatedAt: string;
	messages: PlaygroundChatUIMessage[];
	memory: Record<string, string>;
	activeRunId: string | null;
}

export interface StoredChatRun {
	readonly id: string;
	readonly chatId: string;
	readonly assistantMessageId: string;
	readonly provider: ProviderId;
	readonly model: string;
	status: ChatRunStatus;
	readonly startedAt: string;
	completedAt: string | null;
	finishReason?: FinishReason;
	errorCode?: "generation_failed" | "interrupted_by_restart";
}

export interface ChatRunView {
	readonly id: string;
	readonly status: ChatRunStatus;
	readonly provider: ProviderId;
	readonly model: string;
	readonly startedAt: string;
	readonly completedAt: string | null;
}

export interface ChatSummaryView {
	readonly id: string;
	readonly title: string;
	readonly provider: ProviderId;
	readonly model: string;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly messageCount: number;
	readonly activeRun: ChatRunView | null;
}

export interface ChatView extends ChatSummaryView {
	readonly messages: readonly PlaygroundChatUIMessage[];
}

export interface ChatPageView {
	readonly chats: readonly ChatSummaryView[];
	readonly nextCursor: string | null;
}

export interface RunCompletion {
	readonly status: Exclude<ChatRunStatus, "running">;
	readonly messages?: readonly PlaygroundChatUIMessage[];
	readonly finishReason?: FinishReason;
	readonly usage?: LanguageModelUsage;
	readonly errorCode?: StoredChatRun["errorCode"];
}

export interface StoredChatStateV1 {
	readonly version: 1;
	readonly chats: Record<string, StoredChat>;
	readonly runs: Record<string, StoredChatRun>;
}
