import {
	registerTelemetry,
	type InferTelemetryEvent,
	type LanguageModelCallStartEvent,
	type Telemetry,
	type TelemetryOptions,
	type ToolExecutionStartEvent,
} from "ai";

const AI_SDK_TELEMETRY_HUB_KEY = Symbol.for("@nestm/ai-sdk:observability:telemetry-hub/v1");

type TelemetryOnStartEvent = Parameters<NonNullable<Telemetry["onStart"]>>[0];
type TelemetryOnStepStartEvent = Parameters<NonNullable<Telemetry["onStepStart"]>>[0];
type TelemetryOnLanguageModelCallStartEvent = Parameters<
	NonNullable<Telemetry["onLanguageModelCallStart"]>
>[0];
type TelemetryOnLanguageModelCallEndEvent = Parameters<
	NonNullable<Telemetry["onLanguageModelCallEnd"]>
>[0];
type TelemetryOnToolExecutionStartEvent = Parameters<
	NonNullable<Telemetry["onToolExecutionStart"]>
>[0];
type TelemetryOnToolExecutionEndEvent = Parameters<NonNullable<Telemetry["onToolExecutionEnd"]>>[0];
type TelemetryOnStepEndEvent = Parameters<NonNullable<Telemetry["onStepEnd"]>>[0];
type TelemetryOnObjectStepStartEvent = Parameters<NonNullable<Telemetry["onObjectStepStart"]>>[0];
type TelemetryOnObjectStepEndEvent = Parameters<NonNullable<Telemetry["onObjectStepEnd"]>>[0];
type TelemetryOnEmbedStartEvent = Parameters<NonNullable<Telemetry["onEmbedStart"]>>[0];
type TelemetryOnEmbedEndEvent = Parameters<NonNullable<Telemetry["onEmbedEnd"]>>[0];
type TelemetryOnRerankStartEvent = Parameters<NonNullable<Telemetry["onRerankStart"]>>[0];
type TelemetryOnRerankEndEvent = Parameters<NonNullable<Telemetry["onRerankEnd"]>>[0];
type TelemetryOnEndEvent = Parameters<NonNullable<Telemetry["onEnd"]>>[0];
type TelemetryOnAbortEvent = Parameters<NonNullable<Telemetry["onAbort"]>>[0];

type LanguageModelExecutionOptions<RESULT> = Partial<
	InferTelemetryEvent<LanguageModelCallStartEvent>
> & {
	readonly callId: string;
	readonly execute: () => PromiseLike<RESULT>;
};

type ToolExecutionOptions<RESULT> = Partial<InferTelemetryEvent<ToolExecutionStartEvent>> & {
	readonly callId: string;
	readonly toolCallId: string;
	readonly execute: () => PromiseLike<RESULT>;
};

interface GlobalAiSdkTelemetryHubState {
	readonly hub: AiSdkTelemetryHub;
	registered: boolean;
}

type TelemetryCallback<EVENT> = (event: EVENT) => void | PromiseLike<void>;

export interface AiSdkProcessCollectorLease {
	readonly activate: () => void;
	readonly detach: () => void;
}

/**
 * A process-global fan-out point for AI SDK telemetry.
 *
 * AI SDK global telemetry registration is append-only. Keeping one stable hub
 * lets Nest application contexts attach and detach their own adapters without
 * accumulating registrations during tests, hot reload, or application restarts.
 */
export class AiSdkTelemetryHub implements Telemetry {
	readonly #delegates = new Map<symbol, Telemetry>();
	#processCollectorAttachment: symbol | undefined;
	#processCollectorActive = false;

	get attachmentCount(): number {
		return this.#delegates.size;
	}

	get hasProcessCollector(): boolean {
		return this.#processCollectorAttachment !== undefined;
	}

	get hasActiveProcessCollector(): boolean {
		return this.#processCollectorActive;
	}

	attach(delegate: Telemetry): () => void {
		if (delegate === this) {
			return () => undefined;
		}

		const attachment = Symbol("ai-sdk-telemetry-attachment");
		this.#delegates.set(attachment, delegate);
		let attached = true;

		return () => {
			if (!attached) {
				return;
			}

			attached = false;
			this.#delegates.delete(attachment);
		};
	}

	/**
	 * Attaches the single collector allowed to observe process-global AI SDK
	 * telemetry. Additional Nest application contexts must use a per-call
	 * adapter instead of receiving another application's traffic.
	 */
	attachProcessCollector(delegate: Telemetry): () => void {
		const lease = this.claimProcessCollector(delegate);
		lease.activate();
		return () => lease.detach();
	}

	/**
	 * Claims process telemetry provisionally during Nest provider construction.
	 * A failed bootstrap can be superseded until `activate()` explicitly commits
	 * the owner after the application has initialized successfully.
	 */
	claimProcessCollector(delegate: Telemetry): AiSdkProcessCollectorLease {
		if (delegate === this) {
			throw new TypeError("The AI SDK telemetry hub cannot collect itself.");
		}
		if (this.#processCollectorAttachment !== undefined && this.#processCollectorActive) {
			throw new Error(
				'A process-global AI observability collector is already attached. Use registration: "manual" with per-call telemetry integrations for additional Nest application contexts.',
			);
		}
		if (this.#processCollectorAttachment !== undefined) {
			this.#delegates.delete(this.#processCollectorAttachment);
		}

		const attachment = Symbol("ai-sdk-process-collector-attachment");
		this.#delegates.set(attachment, delegate);
		this.#processCollectorAttachment = attachment;
		this.#processCollectorActive = false;
		let attached = true;

		const detach = () => {
			if (!attached) return;
			attached = false;
			if (this.#processCollectorAttachment !== attachment) return;
			this.#delegates.delete(attachment);
			this.#processCollectorAttachment = undefined;
			this.#processCollectorActive = false;
		};

		return {
			activate: () => {
				if (!attached || this.#processCollectorAttachment !== attachment) {
					throw new Error(
						"The provisional AI observability collector was superseded before module initialization.",
					);
				}
				this.#processCollectorActive = true;
			},
			detach,
		};
	}

	onStart(event: TelemetryOnStartEvent): Promise<void> {
		return this.#dispatch(event, (delegate) => delegate.onStart);
	}

	onStepStart(event: TelemetryOnStepStartEvent): Promise<void> {
		return this.#dispatch(event, (delegate) => delegate.onStepStart);
	}

	onLanguageModelCallStart(event: TelemetryOnLanguageModelCallStartEvent): Promise<void> {
		return this.#dispatch(event, (delegate) => delegate.onLanguageModelCallStart);
	}

	onLanguageModelCallEnd(event: TelemetryOnLanguageModelCallEndEvent): Promise<void> {
		return this.#dispatch(event, (delegate) => delegate.onLanguageModelCallEnd);
	}

	onToolExecutionStart(event: TelemetryOnToolExecutionStartEvent): Promise<void> {
		return this.#dispatch(event, (delegate) => delegate.onToolExecutionStart);
	}

	onToolExecutionEnd(event: TelemetryOnToolExecutionEndEvent): Promise<void> {
		return this.#dispatch(event, (delegate) => delegate.onToolExecutionEnd);
	}

	onStepEnd(event: TelemetryOnStepEndEvent): Promise<void> {
		return this.#dispatch(event, (delegate) => delegate.onStepEnd);
	}

	onObjectStepStart(event: TelemetryOnObjectStepStartEvent): Promise<void> {
		return this.#dispatch(event, (delegate) => delegate.onObjectStepStart);
	}

	onObjectStepEnd(event: TelemetryOnObjectStepEndEvent): Promise<void> {
		return this.#dispatch(event, (delegate) => delegate.onObjectStepEnd);
	}

	onEmbedStart(event: TelemetryOnEmbedStartEvent): Promise<void> {
		return this.#dispatch(event, (delegate) => delegate.onEmbedStart);
	}

	onEmbedEnd(event: TelemetryOnEmbedEndEvent): Promise<void> {
		return this.#dispatch(event, (delegate) => delegate.onEmbedEnd);
	}

	onRerankStart(event: TelemetryOnRerankStartEvent): Promise<void> {
		return this.#dispatch(event, (delegate) => delegate.onRerankStart);
	}

	onRerankEnd(event: TelemetryOnRerankEndEvent): Promise<void> {
		return this.#dispatch(event, (delegate) => delegate.onRerankEnd);
	}

	onEnd(event: TelemetryOnEndEvent): Promise<void> {
		return this.#dispatch(event, (delegate) => delegate.onEnd);
	}

	onAbort(event: TelemetryOnAbortEvent): Promise<void> {
		return this.#dispatch(event, (delegate) => delegate.onAbort);
	}

	onError(event: unknown): Promise<void> {
		return this.#dispatch(event, (delegate) => delegate.onError);
	}

	async executeLanguageModelCall<RESULT>(
		options: LanguageModelExecutionOptions<RESULT>,
	): Promise<RESULT> {
		const delegates = [...this.#delegates.values()];

		const invoke = async (index: number): Promise<RESULT> => {
			const delegate = delegates[index];
			if (delegate == null) {
				return await options.execute();
			}
			const wrapper = delegate.executeLanguageModelCall;
			if (wrapper == null) {
				return await invoke(index + 1);
			}

			let next: Promise<RESULT> | undefined;
			const executeNext = (): Promise<RESULT> => (next ??= invoke(index + 1));

			try {
				await wrapper({
					...options,
					execute: executeNext,
				});
			} catch {
				// Integration failures must not replace the observed model result.
			}

			return await executeNext();
		};

		return await invoke(0);
	}

	async executeTool<RESULT>(options: ToolExecutionOptions<RESULT>): Promise<RESULT> {
		const delegates = [...this.#delegates.values()];

		const invoke = async (index: number): Promise<RESULT> => {
			const delegate = delegates[index];
			if (delegate == null) {
				return await options.execute();
			}
			const wrapper = delegate.executeTool;
			if (wrapper == null) {
				return await invoke(index + 1);
			}

			let next: Promise<RESULT> | undefined;
			const executeNext = (): Promise<RESULT> => (next ??= invoke(index + 1));

			try {
				await wrapper({
					...options,
					execute: executeNext,
				});
			} catch {
				// Integration failures must not replace the observed tool result.
			}

			return await executeNext();
		};

		return await invoke(0);
	}

	async #dispatch<EVENT>(
		event: EVENT,
		select: (delegate: Telemetry) => TelemetryCallback<EVENT> | undefined,
	): Promise<void> {
		await Promise.allSettled(
			[...this.#delegates.values()].map(async (delegate) => {
				const callback = select(delegate);
				await callback?.call(delegate, event);
			}),
		);
	}
}

function globalHubState(): GlobalAiSdkTelemetryHubState {
	const registry = globalThis as typeof globalThis & Record<PropertyKey, unknown>;
	const existing = registry[AI_SDK_TELEMETRY_HUB_KEY];

	if (isGlobalHubState(existing)) {
		return existing;
	}

	const state: GlobalAiSdkTelemetryHubState = {
		hub: new AiSdkTelemetryHub(),
		registered: false,
	};
	registry[AI_SDK_TELEMETRY_HUB_KEY] = state;
	return state;
}

function isGlobalHubState(value: unknown): value is GlobalAiSdkTelemetryHubState {
	if (typeof value !== "object" || value == null) {
		return false;
	}

	const candidate = value as Partial<GlobalAiSdkTelemetryHubState>;
	return (
		typeof candidate.registered === "boolean" &&
		typeof candidate.hub?.attach === "function" &&
		typeof candidate.hub?.onStart === "function"
	);
}

/** Returns the stable process-global hub without registering it as a side effect. */
export function getAiSdkTelemetryHub(): AiSdkTelemetryHub {
	return globalHubState().hub;
}

/** Registers the process-global hub with AI SDK at most once. */
export function registerAiSdkTelemetryHub(): AiSdkTelemetryHub {
	const state = globalHubState();
	if (!state.registered) {
		registerTelemetry(state.hub);
		state.registered = true;
	}

	return state.hub;
}

export function isAiSdkTelemetryHubRegistered(): boolean {
	return globalHubState().registered;
}

export function composeAiSdkTelemetryOptions(): TelemetryOptions;
export function composeAiSdkTelemetryOptions<const OPTIONS extends TelemetryOptions>(
	telemetry: OPTIONS | undefined,
	...additionalIntegrations: Telemetry[]
): Omit<OPTIONS, "integrations"> & Pick<TelemetryOptions, "integrations">;
/**
 * Adds the Nestm hub to per-call telemetry integrations without mutating the
 * supplied options or integration array.
 *
 * AI SDK replaces global integrations whenever a per-call list is present, so
 * callers must compose every integration they want to keep for that call.
 */
export function composeAiSdkTelemetryOptions(
	telemetry?: TelemetryOptions,
	...additionalIntegrations: Telemetry[]
): TelemetryOptions {
	const configured = telemetry?.integrations;
	const localIntegrations =
		configured == null ? [] : Array.isArray(configured) ? configured : [configured];
	const integrations: Telemetry[] = [];

	for (const integration of [
		getAiSdkTelemetryHub(),
		...localIntegrations,
		...additionalIntegrations,
	]) {
		if (!integrations.includes(integration)) {
			integrations.push(integration);
		}
	}

	return {
		...telemetry,
		integrations,
	};
}
