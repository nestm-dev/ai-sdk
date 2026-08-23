import { Injectable } from "@nestjs/common";
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
	constructor(private readonly values: ConfigService<PlaygroundEnvironment, true>) {}

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
