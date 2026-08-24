import {
	Body,
	Controller,
	Delete,
	Get,
	Header,
	HttpCode,
	HttpStatus,
	Inject,
	Param,
	ParseUUIDPipe,
	Patch,
	Post,
	Query,
} from "@nestjs/common";

import { ChatStreamDto, CreateChatDto, ListChatsDto, UpdateChatDto } from "./chat.dto.ts";
import { ChatRunService } from "./chat-run.service.ts";
import { ChatService } from "./chat.service.ts";

const NO_STORE = "no-store";
const uuid = () => new ParseUUIDPipe({ version: "4" });

@Controller("playground/v1/chats")
export class ChatController {
	constructor(
		@Inject(ChatService)
		private readonly chats: ChatService,
		@Inject(ChatRunService)
		private readonly runs: ChatRunService,
	) {}

	@Get()
	@Header("Cache-Control", NO_STORE)
	list(@Query() query: ListChatsDto) {
		return this.chats.list(query);
	}

	@Post()
	@Header("Cache-Control", NO_STORE)
	create(@Body() input: CreateChatDto) {
		return this.chats.create(input);
	}

	@Get(":chatId/stream")
	@Header("Cache-Control", NO_STORE)
	resume(@Param("chatId", uuid()) chatId: string) {
		return this.runs.resume(chatId);
	}

	@Post(":chatId/stream")
	@HttpCode(HttpStatus.OK)
	@Header("Cache-Control", NO_STORE)
	stream(@Param("chatId", uuid()) chatId: string, @Body() input: ChatStreamDto) {
		return this.runs.stream(chatId, input);
	}

	@Post(":chatId/runs/:runId/cancel")
	@HttpCode(HttpStatus.OK)
	@Header("Cache-Control", NO_STORE)
	cancel(@Param("chatId", uuid()) chatId: string, @Param("runId", uuid()) runId: string) {
		return this.runs.cancel(chatId, runId);
	}

	@Get(":chatId")
	@Header("Cache-Control", NO_STORE)
	get(@Param("chatId", uuid()) chatId: string) {
		return this.chats.get(chatId);
	}

	@Patch(":chatId")
	@Header("Cache-Control", NO_STORE)
	update(@Param("chatId", uuid()) chatId: string, @Body() input: UpdateChatDto) {
		return this.chats.update(chatId, input);
	}

	@Delete(":chatId")
	@HttpCode(HttpStatus.NO_CONTENT)
	remove(@Param("chatId", uuid()) chatId: string): Promise<void> {
		return this.chats.remove(chatId);
	}
}
