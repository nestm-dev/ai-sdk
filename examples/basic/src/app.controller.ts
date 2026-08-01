import { Body, Controller, Post } from "@nestjs/common";
import { InjectAiAgent, type AiSdkAgent } from "@nestm/ai-sdk";
import { AiSdkResponse, type AiSdkHttpResponse } from "@nestm/ai-sdk/http";
import type { InferAgentUIMessage } from "ai";

interface ChatBody {
	messages: InferAgentUIMessage<AiSdkAgent>[];
}

@Controller("ai")
export class AppController {
	constructor(
		@InjectAiAgent("assistant")
		private readonly assistant: AiSdkAgent,
	) {}

	@Post("chat")
	chat(@Body() body: ChatBody): AiSdkHttpResponse {
		return AiSdkResponse.agent({
			agent: this.assistant,
			uiMessages: body.messages,
		});
	}
}
