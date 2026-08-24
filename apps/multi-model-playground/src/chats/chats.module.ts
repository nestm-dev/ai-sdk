import { Module } from "@nestjs/common";
import { AiSdkHttpModule } from "@nestm/ai-sdk/http";

import { ChatController } from "./chat.controller.ts";
import { ChatRepository } from "./chat.repository.ts";
import { ChatRunService } from "./chat-run.service.ts";
import { ChatService } from "./chat.service.ts";
import { PlaygroundChatAgentFactory } from "./playground-chat-agent.factory.ts";
import { PlaygroundChatToolsService } from "./playground-chat-tools.service.ts";

@Module({
	imports: [AiSdkHttpModule.register()],
	controllers: [ChatController],
	providers: [
		ChatRepository,
		ChatService,
		ChatRunService,
		PlaygroundChatToolsService,
		PlaygroundChatAgentFactory,
	],
	exports: [ChatRepository, ChatRunService, ChatService],
})
export class ChatsModule {}
