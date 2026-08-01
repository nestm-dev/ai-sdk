import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AiSdkModule, AiSdkService, getAiToolsetToken } from "@nestm/ai-sdk";
import { AiSdkHttpModule } from "@nestm/ai-sdk/http";
import { createGateway, type ToolSet } from "ai";
import { AppController } from "./app.controller.js";
import { validateEnvironment, type Environment } from "./environment.js";
import { WeatherToolset } from "./weather.toolset.js";

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			validate: validateEnvironment,
		}),
		AiSdkModule.forRootAsync({
			imports: [ConfigModule],
			inject: [ConfigService],
			useFactory: (config: ConfigService<Environment, true>) => {
				const gateway = createGateway({
					apiKey: config.get("AI_GATEWAY_API_KEY", { infer: true }),
				});

				return {
					providers: { gateway },
					defaults: {
						language: gateway.languageModel("openai/gpt-5-mini"),
					},
				};
			},
		}),
		AiSdkModule.forFeature({
			toolsets: [WeatherToolset],
			agents: [
				{
					name: "assistant",
					inject: [AiSdkService, getAiToolsetToken("weather")],
					useFactory: (ai: AiSdkService, tools: ToolSet) => ({
						model: ai.languageModel(),
						instructions: "Be concise. Use the weather tool for forecast questions.",
						tools,
					}),
				},
			],
		}),
		AiSdkHttpModule.register(),
	],
	controllers: [AppController],
})
export class AppModule {}
