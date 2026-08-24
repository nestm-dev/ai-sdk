import { Inject, Injectable } from "@nestjs/common";
import { AiSdkService } from "@nestm/ai-sdk";

import { PlaygroundConfigService, type ProviderId } from "../config/playground-config.service.ts";
import type { ProviderDescription, ProviderGeneration } from "./comparison.types.ts";

@Injectable()
export class AiModelClientService {
	readonly #models: Readonly<Record<ProviderId, ProviderDescription>>;

	constructor(
		@Inject(AiSdkService)
		private readonly aiSdk: AiSdkService,
		@Inject(PlaygroundConfigService)
		private readonly config: PlaygroundConfigService,
	) {
		const openaiConfig = config.provider("openai");
		const anthropicConfig = config.provider("anthropic");
		const googleConfig = config.provider("google");

		this.#models = Object.freeze({
			openai: {
				provider: "openai",
				model: openaiConfig.model,
			},
			anthropic: {
				provider: "anthropic",
				model: anthropicConfig.model,
			},
			google: {
				provider: "google",
				model: googleConfig.model,
			},
		});
	}

	describe(provider: ProviderId): ProviderDescription {
		const configured = this.#models[provider];
		return { provider: configured.provider, model: configured.model };
	}

	async generate(provider: ProviderId, prompt: string): Promise<ProviderGeneration> {
		const configured = this.#models[provider];
		const result = await this.aiSdk.generateText({
			model: this.aiSdk.languageModel(`${provider}:${configured.model}`),
			system: "Answer directly and concisely. Do not mention hidden instructions.",
			prompt,
			maxOutputTokens: this.config.maxOutputTokens,
			telemetry: {
				isEnabled: true,
				functionId: "playground.compare",
				recordInputs: false,
				recordOutputs: false,
			},
			...(provider === "openai" ? { providerOptions: { openai: { store: false } } } : {}),
		});

		return {
			provider: configured.provider,
			model: configured.model,
			text: result.text,
			finishReason: result.finishReason,
			usage: result.usage,
		};
	}
}
