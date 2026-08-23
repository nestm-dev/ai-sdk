import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { Module } from "@nestjs/common";
import { AiSdkModule } from "@nestm/ai-sdk";
import {
	AiSdkObservabilityModule,
	AiSdkObservabilityTelemetryModule,
} from "@nestm/ai-sdk/observability";
import { AiSdkObservabilityHttpModule } from "@nestm/ai-sdk/observability/http";

import { ComparisonModule } from "./comparison/comparison.module.ts";
import { PlaygroundConfigModule } from "./config/playground-config.module.ts";
import { PlaygroundConfigService } from "./config/playground-config.service.ts";

@Module({
	imports: [
		PlaygroundConfigModule,
		AiSdkModule.forRootAsync({
			imports: [PlaygroundConfigModule],
			inject: [PlaygroundConfigService],
			useFactory: (config: PlaygroundConfigService) => ({
				providers: {
					openai: createOpenAI({ apiKey: config.provider("openai").apiKey }),
					anthropic: createAnthropic({ apiKey: config.provider("anthropic").apiKey }),
					google: createGoogle({ apiKey: config.provider("google").apiKey }),
				},
				requestDefaults: {
					maxRetries: 0,
					timeout: { totalMs: config.providerTimeoutMs },
				},
			}),
		}),
		AiSdkObservabilityModule.forRoot(),
		AiSdkObservabilityTelemetryModule.register({ registration: "global" }),
		AiSdkObservabilityHttpModule,
		ComparisonModule,
	],
})
export class AppModule {}
