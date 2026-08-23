import { Controller, Get, Header } from "@nestjs/common";
import type { AiObservabilitySnapshotV1 } from "../core/index.ts";
import { AiSdkObservabilityService } from "../ai-sdk-observability.service.ts";

/**
 * Read-only dashboard projection.
 *
 * The package intentionally installs no guards or authorization policy. Host
 * applications must protect this route using their own authentication,
 * tenancy, CORS, and rate-limit controls.
 */
@Controller("ai-observability/v1")
export class AiSdkObservabilityHttpController {
	constructor(private readonly observability: AiSdkObservabilityService) {}

	@Get("snapshot")
	@Header("Cache-Control", "no-store")
	getSnapshot(): AiObservabilitySnapshotV1 {
		return this.observability.snapshot();
	}
}
