import type { FinishReason, LanguageModelUsage } from "ai";

import type { ProviderId } from "../config/playground-config.service.ts";

export type SafeFailureCode =
	| "unauthorized"
	| "rate_limited"
	| "timeout_or_cancelled"
	| "request_rejected"
	| "provider_unavailable"
	| "generation_failed";

export interface ProviderDescription {
	readonly provider: ProviderId;
	readonly model: string;
}

export interface ProviderGeneration extends ProviderDescription {
	readonly text: string;
	readonly finishReason: FinishReason;
	readonly usage: LanguageModelUsage;
}

export interface SafeUsageView {
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
	readonly totalTokens: number | null;
}

export interface ProviderSuccessView extends ProviderDescription {
	readonly status: "success";
	readonly text: string;
	readonly finishReason: FinishReason;
	readonly latencyMs: number;
	readonly usage: SafeUsageView;
}

export interface ProviderFailureView extends ProviderDescription {
	readonly status: "error";
	readonly code: SafeFailureCode;
	readonly retryable: boolean;
	readonly latencyMs: number;
}

export type ProviderComparisonView = ProviderSuccessView | ProviderFailureView;

export interface ComparisonView {
	readonly runId: string;
	readonly startedAt: string;
	readonly results: readonly ProviderComparisonView[];
	readonly summary: {
		readonly requested: number;
		readonly succeeded: number;
		readonly failed: number;
	};
}
