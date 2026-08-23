import { Module } from "@nestjs/common";

import { AiModelClientService } from "./ai-model-client.service.ts";
import { ComparisonController } from "./comparison.controller.ts";
import { MultiModelComparisonService } from "./multi-model-comparison.service.ts";

@Module({
	controllers: [ComparisonController],
	providers: [AiModelClientService, MultiModelComparisonService],
})
export class ComparisonModule {}
