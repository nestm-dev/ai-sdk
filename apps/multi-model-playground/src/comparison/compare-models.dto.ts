import {
	ArrayNotEmpty,
	ArrayUnique,
	IsArray,
	IsIn,
	IsOptional,
	IsString,
	MaxLength,
	MinLength,
} from "class-validator";
import { Transform } from "class-transformer";

import { PROVIDER_IDS, type ProviderId } from "../config/playground-config.service.ts";

export class CompareModelsDto {
	@IsString()
	@Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
	@MinLength(1)
	@MaxLength(1_000)
	prompt!: string;

	@IsOptional()
	@IsArray()
	@ArrayNotEmpty()
	@ArrayUnique()
	@IsIn(PROVIDER_IDS, { each: true })
	providers?: ProviderId[];
}
