import { Transform, Type } from "class-transformer";
import {
	ArrayMaxSize,
	ArrayMinSize,
	IsArray,
	IsIn,
	IsInt,
	IsOptional,
	IsString,
	IsUUID,
	Max,
	MaxLength,
	Min,
	MinLength,
} from "class-validator";

import { PROVIDER_IDS, type ProviderId } from "../config/playground-config.service.ts";
import { MAX_CHAT_INPUT_MESSAGES } from "./chat.types.ts";

export class CreateChatDto {
	@IsIn(PROVIDER_IDS)
	provider!: ProviderId;

	@IsOptional()
	@IsString()
	@Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
	@MinLength(1)
	@MaxLength(120)
	title?: string;
}

export class UpdateChatDto {
	@IsOptional()
	@IsIn(PROVIDER_IDS)
	provider?: ProviderId;

	@IsOptional()
	@IsString()
	@Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
	@MinLength(1)
	@MaxLength(120)
	title?: string;
}

export class ListChatsDto {
	@IsOptional()
	@IsUUID()
	cursor?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	limit = 50;
}

export class ChatStreamDto {
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(MAX_CHAT_INPUT_MESSAGES)
	messages!: unknown[];

	@IsIn(["submit-message", "regenerate-message"])
	trigger!: "submit-message" | "regenerate-message";

	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(256)
	messageId?: string;
}
