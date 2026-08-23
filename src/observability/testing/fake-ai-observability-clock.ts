import type { AiObservabilityClock } from "../core/index.ts";

const MAX_FOUR_DIGIT_YEAR_TIMESTAMP_MS = 253_402_300_799_999;

function assertTimestamp(value: number, label: string): void {
	if (!Number.isInteger(value)) {
		throw new TypeError(`${label} must be an integer Unix epoch millisecond timestamp.`);
	}
	if (value < 0 || value > MAX_FOUR_DIGIT_YEAR_TIMESTAMP_MS) {
		throw new RangeError(`${label} must be between 0 and ${MAX_FOUR_DIGIT_YEAR_TIMESTAMP_MS}.`);
	}
}

/** Deterministic, manually advanced clock for collector and HTTP tests. */
export class FakeAiObservabilityClock {
	#timeMs: number;

	constructor(initialTimeMs = 0) {
		assertTimestamp(initialTimeMs, "initialTimeMs");
		this.#timeMs = initialTimeMs;
	}

	/** Function passed directly to `InMemoryAiObservabilityOptions.clock`. */
	readonly now: AiObservabilityClock = () => this.#timeMs;

	get currentTimeMs(): number {
		return this.#timeMs;
	}

	set(timeMs: number): void {
		assertTimestamp(timeMs, "timeMs");
		this.#timeMs = timeMs;
	}

	advanceBy(durationMs: number): number {
		if (!Number.isInteger(durationMs)) {
			throw new TypeError("durationMs must be an integer number of milliseconds.");
		}
		if (durationMs < 0) {
			throw new RangeError("durationMs must be greater than or equal to zero.");
		}
		const nextTimeMs = this.#timeMs + durationMs;
		assertTimestamp(nextTimeMs, "resulting timeMs");
		this.#timeMs = nextTimeMs;
		return this.#timeMs;
	}
}

export function createFakeAiObservabilityClock(initialTimeMs = 0): FakeAiObservabilityClock {
	return new FakeAiObservabilityClock(initialTimeMs);
}
