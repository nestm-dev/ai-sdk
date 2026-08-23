import {
	Inject,
	Injectable,
	type INestApplicationContext,
	type OnModuleDestroy,
} from "@nestjs/common";
import { AiSdkObservabilityService } from "../ai-sdk-observability.service.ts";
import {
	AiSdkTelemetryAdapter,
	type AiSdkTelemetryAdapterOptions,
} from "./ai-sdk-telemetry-adapter.ts";
import { registerAiSdkTelemetryHub } from "./ai-sdk-telemetry-hub.ts";

export const AI_SDK_OBSERVABILITY_TELEMETRY_OPTIONS = Symbol.for(
	"@nestm/ai-sdk:observability:telemetry-options",
);

export type AiSdkObservabilityTelemetryRegistration = "global" | "manual";

export type AiSdkObservabilityTelemetryRegistrationState =
	"manual" | "provisional" | "active" | "superseded" | "disposed";

export interface AiSdkObservabilityTelemetryAdapterOptions extends Omit<
	AiSdkTelemetryAdapterOptions,
	"sink"
> {
	/**
	 * `manual` (default) requires per-call integration. `global` claims one
	 * provisional process owner that `initializeAiSdkTelemetry()` must commit.
	 */
	readonly registration?: AiSdkObservabilityTelemetryRegistration;
}

/** Lifecycle bridge between a Nest collector and the process-global AI SDK hub. */
@Injectable()
export class AiSdkObservabilityTelemetryService implements OnModuleDestroy {
	readonly #adapter: AiSdkTelemetryAdapter;
	#activate: (() => void) | undefined;
	#detach: (() => void) | undefined;
	#registrationState: AiSdkObservabilityTelemetryRegistrationState = "manual";

	constructor(
		private readonly observability: AiSdkObservabilityService,
		@Inject(AI_SDK_OBSERVABILITY_TELEMETRY_OPTIONS)
		options: AiSdkObservabilityTelemetryAdapterOptions,
	) {
		const { registration = "manual", ...adapterOptions } = options;
		this.#adapter = new AiSdkTelemetryAdapter({
			...adapterOptions,
			sink: this.observability,
		});
		if (registration !== "manual") {
			try {
				const lease = registerAiSdkTelemetryHub().claimProcessCollector(this.#adapter);
				this.#activate = () => lease.activate();
				this.#detach = () => lease.detach();
				this.#registrationState = "provisional";
			} catch (error) {
				this.#adapter.dispose();
				throw error;
			}
		}
	}

	get adapter(): AiSdkTelemetryAdapter {
		return this.#adapter;
	}

	get registrationState(): AiSdkObservabilityTelemetryRegistrationState {
		return this.#registrationState;
	}

	/** Commits exclusive process ownership after Nest initialization succeeds. */
	activateGlobalRegistration(): void {
		if (this.#registrationState === "active") return;
		if (this.#registrationState !== "provisional" || this.#activate === undefined) {
			throw new Error(
				`Cannot activate AI SDK global telemetry from the ${this.#registrationState} registration state.`,
			);
		}

		try {
			this.#activate();
			this.#registrationState = "active";
		} catch (error) {
			this.#registrationState = "superseded";
			throw error;
		} finally {
			this.#activate = undefined;
		}
	}

	dispose(): void {
		if (this.#registrationState === "disposed") return;
		this.#detach?.();
		this.#activate = undefined;
		this.#detach = undefined;
		this.#adapter.dispose();
		this.#registrationState = "disposed";
	}

	onModuleDestroy(): void {
		this.dispose();
	}
}

/**
 * Initializes a Nest context and commits global AI SDK telemetry only after all
 * application lifecycle hooks have completed successfully.
 */
export async function initializeAiSdkTelemetry<APPLICATION extends INestApplicationContext>(
	application: APPLICATION,
): Promise<APPLICATION> {
	const bridge = application.get(AiSdkObservabilityTelemetryService, { strict: false });
	try {
		await application.init();
		bridge.activateGlobalRegistration();
		return application;
	} catch (error) {
		bridge.dispose();
		throw error;
	}
}
