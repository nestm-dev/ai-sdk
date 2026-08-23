import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post } from "@nestjs/common";

import { CompareModelsDto } from "./compare-models.dto.ts";
import { MultiModelComparisonService } from "./multi-model-comparison.service.ts";

@Controller("playground/v1")
export class ComparisonController {
	constructor(private readonly comparisons: MultiModelComparisonService) {}

	@Get("providers")
	@Header("Cache-Control", "no-store")
	providers() {
		return { providers: this.comparisons.providers() };
	}

	@Post("compare")
	@HttpCode(HttpStatus.OK)
	@Header("Cache-Control", "no-store")
	compare(@Body() input: CompareModelsDto) {
		return this.comparisons.compare(input);
	}
}
