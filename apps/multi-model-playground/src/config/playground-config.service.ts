import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { PlaygroundEnvironment } from "./environment.ts";

export const PROVIDER_IDS = ["openai", "anthropic", "google"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderConfiguration {
	readonly provider: ProviderId;
	readonly apiKey: string;
	readonly model: string;
}

@Injectable()
export class PlaygroundConfigService {
	constructor(
		@Inject(ConfigService)
		private readonly values: ConfigService<PlaygroundEnvironment, true>,
	) {}

	get port(): number {
		return this.values.get("PORT", { infer: true });
	}

	get dashboardOrigin(): string {
		return this.values.get("DASHBOARD_ORIGIN", { infer: true });
	}

	get providerTimeoutMs(): number {
		return this.values.get("PROVIDER_TIMEOUT_MS", { infer: true });
	}

	get maxOutputTokens(): number {
		return this.values.get("MAX_OUTPUT_TOKENS", { infer: true });
	}

	get chatStateDirectory(): string {
		return this.values.get("CHAT_STATE_DIR", { infer: true });
	}

	get chatRunTimeoutMs(): number {
		return this.values.get("CHAT_RUN_TIMEOUT_MS", { infer: true });
	}

	get chatReplayMaxBytes(): number {
		return this.values.get("CHAT_REPLAY_MAX_BYTES", { infer: true });
	}

	get chatMaxOutputTokens(): number {
		return this.values.get("CHAT_MAX_OUTPUT_TOKENS", { infer: true });
	}

	provider(provider: ProviderId): ProviderConfiguration {
		switch (provider) {
			case "openai":
				return {
					provider,
					apiKey: this.values.get("OPENAI_API_KEY", { infer: true }),
					model: this.values.get("OPENAI_MODEL", { infer: true }),
				};
			case "anthropic":
				return {
					provider,
					apiKey: this.values.get("ANTHROPIC_API_KEY", { infer: true }),
					model: this.values.get("ANTHROPIC_MODEL", { infer: true }),
				};
			case "google":
				return {
					provider,
					apiKey: this.values.get("GOOGLE_GENERATIVE_AI_API_KEY", { infer: true }),
					model: this.values.get("GOOGLE_MODEL", { infer: true }),
				};
		}
	}
}
