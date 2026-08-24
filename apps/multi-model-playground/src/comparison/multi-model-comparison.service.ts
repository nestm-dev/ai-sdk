import { APICallError, LoadAPIKeyError } from "ai";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { PROVIDER_IDS, type ProviderId } from "../config/playground-config.service.ts";
import { AiModelClientService } from "./ai-model-client.service.ts";
import type { CompareModelsDto } from "./compare-models.dto.ts";
import type {
	ComparisonView,
	ProviderComparisonView,
	ProviderFailureView,
	SafeFailureCode,
} from "./comparison.types.ts";

@Injectable()
export class MultiModelComparisonService {
	#activeComparisons = 0;

	constructor(@Inject(AiModelClientService) private readonly client: AiModelClientService) {}

	providers() {
		return PROVIDER_IDS.map((provider) => this.client.describe(provider));
	}

	async compare(input: CompareModelsDto): Promise<ComparisonView> {
		if (this.#activeComparisons >= 1) {
			throw new HttpException(
				"A model comparison is already running.",
				HttpStatus.TOO_MANY_REQUESTS,
			);
		}

		this.#activeComparisons += 1;
		const startedAt = new Date().toISOString();
		const providers = input.providers ?? [...PROVIDER_IDS];
		try {
			const results = await Promise.all(
				providers.map((provider) => this.#runProvider(provider, input.prompt)),
			);
			const succeeded = results.filter((result) => result.status === "success").length;
			return {
				runId: randomUUID(),
				startedAt,
				results,
				summary: {
					requested: results.length,
					succeeded,
					failed: results.length - succeeded,
				},
			};
		} finally {
			this.#activeComparisons -= 1;
		}
	}

	async #runProvider(provider: ProviderId, prompt: string): Promise<ProviderComparisonView> {
		const startedAt = performance.now();
		try {
			const result = await this.client.generate(provider, prompt);
			return {
				provider: result.provider,
				model: result.model,
				status: "success",
				text: result.text,
				finishReason: result.finishReason,
				latencyMs: elapsedMilliseconds(startedAt),
				usage: {
					inputTokens: result.usage.inputTokens ?? null,
					outputTokens: result.usage.outputTokens ?? null,
					totalTokens: result.usage.totalTokens ?? null,
				},
			};
		} catch (error: unknown) {
			return {
				...this.client.describe(provider),
				status: "error",
				...safeFailure(error),
				latencyMs: elapsedMilliseconds(startedAt),
			};
		}
	}
}

function safeFailure(error: unknown): Pick<ProviderFailureView, "code" | "retryable"> {
	if (LoadAPIKeyError.isInstance(error)) {
		return { code: "unauthorized", retryable: false };
	}
	if (APICallError.isInstance(error)) {
		return classifyApiFailure(error.statusCode, error.isRetryable);
	}
	if (isAbortLikeError(error)) {
		return { code: "timeout_or_cancelled", retryable: true };
	}
	return { code: "generation_failed", retryable: false };
}

function classifyApiFailure(
	statusCode: number | undefined,
	retryable: boolean,
): Pick<ProviderFailureView, "code" | "retryable"> {
	let code: SafeFailureCode;
	if (statusCode === 401 || statusCode === 403) code = "unauthorized";
	else if (statusCode === 408) code = "timeout_or_cancelled";
	else if (statusCode === 429) code = "rate_limited";
	else if (statusCode !== undefined && statusCode >= 500) code = "provider_unavailable";
	else code = "request_rejected";
	return { code, retryable };
}

function isAbortLikeError(error: unknown): boolean {
	return (
		error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")
	);
}

function elapsedMilliseconds(startedAt: number): number {
	return Math.max(0, Math.round(performance.now() - startedAt));
}
