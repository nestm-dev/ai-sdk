import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { PlaygroundConfigService } from "../config/playground-config.service.ts";
import type { CreateChatDto, ListChatsDto, UpdateChatDto } from "./chat.dto.ts";
import {
	ChatNotFoundError,
	ChatRepository,
	ChatRunConflictError,
	type StoredChatGraph,
} from "./chat.repository.ts";
import type {
	ChatPageView,
	ChatRunView,
	ChatSummaryView,
	ChatView,
	StoredChatRun,
} from "./chat.types.ts";

@Injectable()
export class ChatService {
	constructor(
		@Inject(ChatRepository)
		private readonly repository: ChatRepository,
		@Inject(PlaygroundConfigService)
		private readonly config: PlaygroundConfigService,
	) {}

	async list(query: ListChatsDto): Promise<ChatPageView> {
		const page = await this.repository.list(query.cursor, query.limit ?? 50);
		return {
			chats: page.graphs.map(projectSummary),
			nextCursor: page.nextCursor,
		};
	}

	async create(input: CreateChatDto): Promise<ChatView> {
		const provider = this.config.provider(input.provider);
		return projectChat(
			await this.repository.create({
				id: randomUUID(),
				title: input.title ?? "New chat",
				provider: provider.provider,
				model: provider.model,
			}),
		);
	}

	async get(chatId: string): Promise<ChatView> {
		const graph = await this.repository.get(chatId);
		if (graph === undefined) throw new NotFoundException("Chat not found.");
		return projectChat(graph);
	}

	async update(chatId: string, input: UpdateChatDto): Promise<ChatView> {
		if (input.provider === undefined && input.title === undefined) {
			throw new BadRequestException("At least one chat field is required.");
		}
		const provider =
			input.provider === undefined ? undefined : this.config.provider(input.provider);
		try {
			return projectChat(
				await this.repository.update(chatId, {
					...(input.title === undefined ? {} : { title: input.title }),
					...(provider === undefined ? {} : { provider: provider.provider, model: provider.model }),
				}),
			);
		} catch (error: unknown) {
			throw mapRepositoryError(error);
		}
	}

	async remove(chatId: string): Promise<void> {
		try {
			await this.repository.remove(chatId);
		} catch (error: unknown) {
			throw mapRepositoryError(error);
		}
	}
}

export function projectRun(run: StoredChatRun): ChatRunView {
	return {
		id: run.id,
		status: run.status,
		provider: run.provider,
		model: run.model,
		startedAt: run.startedAt,
		completedAt: run.completedAt,
	};
}

function projectSummary(graph: StoredChatGraph): ChatSummaryView {
	return {
		id: graph.chat.id,
		title: graph.chat.title,
		provider: graph.chat.provider,
		model: graph.chat.model,
		createdAt: graph.chat.createdAt,
		updatedAt: graph.chat.updatedAt,
		messageCount: graph.chat.messages.length,
		activeRun: graph.activeRun === null ? null : projectRun(graph.activeRun),
	};
}

function projectChat(graph: StoredChatGraph): ChatView {
	return {
		...projectSummary(graph),
		messages: structuredClone(graph.chat.messages),
	};
}

export function mapRepositoryError(error: unknown): Error {
	if (error instanceof ChatNotFoundError) return new NotFoundException("Chat not found.");
	if (error instanceof ChatRunConflictError) return new ConflictException("Chat run conflict.");
	return error instanceof Error ? error : new Error("Chat persistence failed.");
}
