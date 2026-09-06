export interface AiSdkRunStream<Event, Metadata> {
	readonly metadata: Metadata;
	readonly events: AsyncIterable<Event>;
}
export interface AiSdkRunReservation {
	readonly key: string;
	readonly signal: AbortSignal;
}
/** A host-owned bounded projection. Each cursor reads only its own unsent prefix/tail. */
export interface AiSdkRunReplay<Event> {
	append(event: Event): void;
	createCursor(): () => Readonly<{ events: readonly Event[]; done: boolean }>;
}
export interface AiSdkRunStreamRegistryOptions<Event> {
	readonly createReplay: (key: string) => AiSdkRunReplay<Event>;
	readonly maxRuns?: number;
	readonly executionTimeoutMs?: number;
	readonly replayRetentionMs?: number;
	readonly registrationGraceMs?: number;
	readonly onStreamError?: (key: string, error: unknown) => void;
}
export class AiSdkRunStreamError extends Error {
	constructor(readonly code: "RUN_CAPACITY_EXCEEDED" | "RUN_UNAVAILABLE") {
		super(
			code === "RUN_CAPACITY_EXCEEDED"
				? "Run stream capacity is unavailable."
				: "The run stream is unavailable.",
		);
		this.name = "AiSdkRunStreamError";
	}
}
type Readiness<Metadata> =
	| Readonly<{ status: "ready"; metadata: Metadata }>
	| Readonly<{ status: "failed"; error: unknown }>;
interface Run<Event, Metadata> {
	readonly reservation: AiSdkRunReservation;
	readonly controller: AbortController;
	readonly replay: AiSdkRunReplay<Event>;
	readonly ready: Promise<Readiness<Metadata>>;
	readonly resolveReady: (readiness: Readiness<Metadata>) => void;
	readonly waiters: Set<() => void>;
	activeTimer?: ReturnType<typeof setTimeout>;
	cleanupTimer?: ReturnType<typeof setTimeout>;
	task?: Promise<void>;
	available: boolean;
	finished: boolean;
	revision: number;
}

/** Process-local execution ownership and reconnectable typed delivery; no persistence or framework dependency. */
export class AiSdkRunStreamRegistry<Event, Metadata> {
	readonly #options: Required<Omit<AiSdkRunStreamRegistryOptions<Event>, "onStreamError">> &
		Pick<AiSdkRunStreamRegistryOptions<Event>, "onStreamError">;
	readonly #runs = new Map<string, Run<Event, Metadata>>();
	readonly #registration = new Map<string, Set<() => void>>();
	#shutdownTask?: Promise<void>;
	#stopping = false;

	constructor(options: AiSdkRunStreamRegistryOptions<Event>) {
		this.#options = {
			...options,
			maxRuns: positive(options.maxRuns ?? 256),
			executionTimeoutMs: positive(options.executionTimeoutMs ?? 15 * 60_000),
			replayRetentionMs: positive(options.replayRetentionMs ?? 60_000),
			registrationGraceMs: positive(options.registrationGraceMs ?? 250),
		};
	}

	reserve(
		key: string,
		executionDeadlineAt = new Date(Date.now() + this.#options.executionTimeoutMs),
	): AiSdkRunReservation {
		if (this.#stopping || key.length === 0 || this.#runs.has(key)) throw unavailable();
		// Terminal entries are expendable under capacity pressure, never active executions.
		if (this.#runs.size >= this.#options.maxRuns) {
			for (const record of this.#runs.values()) {
				if (record.finished) this.#remove(record);
				if (this.#runs.size < this.#options.maxRuns) break;
			}
		}
		if (this.#runs.size >= this.#options.maxRuns)
			throw new AiSdkRunStreamError("RUN_CAPACITY_EXCEEDED");
		const remaining = Math.min(
			this.#options.executionTimeoutMs,
			executionDeadlineAt.getTime() - Date.now(),
		);
		if (!Number.isFinite(remaining)) throw unavailable();
		const replay = this.#options.createReplay(key);
		const controller = new AbortController();
		let resolveReady: (value: Readiness<Metadata>) => void = () => undefined;
		const ready = new Promise<Readiness<Metadata>>((resolve) => {
			resolveReady = resolve;
		});
		const reservation = Object.freeze({ key, signal: controller.signal });
		const record: Run<Event, Metadata> = {
			reservation,
			controller,
			replay,
			ready,
			resolveReady,
			waiters: new Set(),
			available: false,
			finished: false,
			revision: 0,
		};
		this.#runs.set(key, record);
		const expire = () => {
			if (!record.finished && !controller.signal.aborted)
				controller.abort(new DOMException("Run execution expired.", "TimeoutError"));
		};
		if (remaining <= 0) expire();
		else record.activeTimer = timer(expire, remaining);
		this.#wakeRegistration(key);
		return reservation;
	}

	launch(
		reservation: AiSdkRunReservation,
		start: (signal: AbortSignal) => Promise<AiSdkRunStream<Event, Metadata>>,
		validate?: (metadata: Metadata) => void,
	): void {
		const record = this.#findReservation(reservation);
		if (record === undefined || record.task !== undefined || record.finished) throw unavailable();
		record.task = Promise.resolve().then(() => this.#launch(record, start, validate));
	}

	failReservation(reservation: AiSdkRunReservation, error: unknown): void {
		const record = this.#findReservation(reservation);
		if (record === undefined || record.task !== undefined || record.finished) return;
		record.resolveReady({ status: "failed", error });
		this.#finish(record);
	}

	async subscribe(
		key: string,
		signal: AbortSignal,
	): Promise<AiSdkRunStream<Event, Metadata> | null> {
		const record = this.#runs.get(key);
		if (record === undefined) return null;
		const readiness = await this.#waitForReadiness(record, signal);
		if (readiness === null) return null;
		if (readiness.status === "failed") throw readiness.error;
		return Object.freeze({
			metadata: readiness.metadata,
			events: this.#subscription(record, signal),
		});
	}

	async subscribeWhenAvailable(
		key: string,
		signal: AbortSignal,
	): Promise<AiSdkRunStream<Event, Metadata> | null> {
		const available = await this.subscribe(key, signal);
		if (available !== null || signal.aborted) return available;
		await this.#waitForRegistration(key, signal);
		if (signal.aborted) return null;
		return this.subscribe(key, signal);
	}

	cancel(
		key: string,
		reason: unknown = new DOMException("Run cancellation requested.", "AbortError"),
	): boolean {
		const record = this.#runs.get(key);
		if (record === undefined || record.finished) return false;
		if (record.controller.signal.aborted)
			return (
				record.controller.signal.reason instanceof DOMException &&
				record.controller.signal.reason.name === "AbortError"
			);
		record.controller.abort(reason);
		return true;
	}

	shutdown(): Promise<void> {
		this.#shutdownTask ??= this.#stop();
		return this.#shutdownTask;
	}

	async #stop(): Promise<void> {
		this.#stopping = true;
		for (const key of this.#registration.keys()) this.#wakeRegistration(key);
		const records = [...this.#runs.values()];
		for (const record of records) {
			clearTimeout(record.cleanupTimer);
			if (!record.controller.signal.aborted)
				record.controller.abort(
					new DOMException("Run registry is shutting down.", "ShutdownError"),
				);
		}
		await Promise.allSettled(records.flatMap(({ task }) => (task === undefined ? [] : [task])));
		for (const record of records) {
			this.#wake(record);
			this.#remove(record);
		}
	}

	async #launch(
		record: Run<Event, Metadata>,
		start: (signal: AbortSignal) => Promise<AiSdkRunStream<Event, Metadata>>,
		validate?: (metadata: Metadata) => void,
	): Promise<void> {
		try {
			const stream = await start(record.controller.signal);
			try {
				record.controller.signal.throwIfAborted();
				validate?.(stream.metadata);
			} catch (error) {
				record.controller.abort(error);
				await drain(stream.events);
				throw error;
			}
			record.available = true;
			record.resolveReady({ status: "ready", metadata: stream.metadata });
			for await (const event of stream.events) {
				try {
					record.replay.append(event);
				} catch (error) {
					record.controller.abort(error);
					throw error;
				}
				record.revision += 1;
				this.#wake(record);
			}
		} catch (error) {
			record.resolveReady({ status: "failed", error });
			try {
				this.#options.onStreamError?.(record.reservation.key, error);
			} catch {
				/* Reporting never owns execution cleanup. */
			}
		} finally {
			this.#finish(record);
		}
	}

	async #waitForReadiness(
		record: Run<Event, Metadata>,
		signal: AbortSignal,
	): Promise<Readiness<Metadata> | null> {
		if (signal.aborted || (!record.available && record.controller.signal.aborted)) return null;
		return new Promise((resolve) => {
			let settled = false;
			const settle = (readiness: Readiness<Metadata> | null) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener("abort", onAbort);
				record.controller.signal.removeEventListener("abort", onAbort);
				resolve(readiness);
			};
			const onAbort = () => settle(null);
			signal.addEventListener("abort", onAbort, { once: true });
			record.controller.signal.addEventListener("abort", onAbort, { once: true });
			void record.ready.then(settle);
			if (signal.aborted || (!record.available && record.controller.signal.aborted)) settle(null);
		});
	}

	#finish(record: Run<Event, Metadata>): void {
		if (record.finished) return;
		record.finished = true;
		clearTimeout(record.activeTimer);
		this.#wake(record);
		record.cleanupTimer = timer(() => this.#remove(record), this.#options.replayRetentionMs);
	}

	async *#subscription(record: Run<Event, Metadata>, signal: AbortSignal): AsyncGenerator<Event> {
		const read = record.replay.createCursor();
		while (!signal.aborted) {
			const revision = record.revision;
			const projection = read();
			for (const event of projection.events) {
				if (signal.aborted) return;
				yield event;
			}
			if (projection.done || (record.finished && record.revision === revision)) return;
			await this.#waitForChange(record, revision, signal);
		}
	}

	async #waitForChange(
		record: Run<Event, Metadata>,
		revision: number,
		signal: AbortSignal,
	): Promise<void> {
		if (signal.aborted || record.finished || record.revision !== revision) return;
		await new Promise<void>((resolve) => {
			let settled = false;
			const settle = () => {
				if (settled) return;
				settled = true;
				record.waiters.delete(settle);
				signal.removeEventListener("abort", settle);
				resolve();
			};
			record.waiters.add(settle);
			signal.addEventListener("abort", settle, { once: true });
			if (signal.aborted || record.finished || record.revision !== revision) settle();
		});
	}

	async #waitForRegistration(key: string, signal: AbortSignal): Promise<void> {
		if (signal.aborted || this.#stopping || this.#runs.has(key)) return;
		await new Promise<void>((resolve) => {
			let settled = false;
			let deadline: ReturnType<typeof setTimeout> | undefined;
			const settle = () => {
				if (settled) return;
				settled = true;
				clearTimeout(deadline);
				const waiters = this.#registration.get(key);
				waiters?.delete(settle);
				if (waiters?.size === 0) this.#registration.delete(key);
				signal.removeEventListener("abort", settle);
				resolve();
			};
			const waiters = this.#registration.get(key) ?? new Set<() => void>();
			waiters.add(settle);
			this.#registration.set(key, waiters);
			signal.addEventListener("abort", settle, { once: true });
			deadline = timer(settle, this.#options.registrationGraceMs);
			if (signal.aborted || this.#stopping || this.#runs.has(key)) settle();
		});
	}

	#findReservation(reservation: AiSdkRunReservation): Run<Event, Metadata> | undefined {
		const record = this.#runs.get(reservation.key);
		return record?.reservation === reservation ? record : undefined;
	}
	#wake(record: Run<Event, Metadata>): void {
		for (const wake of record.waiters) wake();
	}
	#wakeRegistration(key: string): void {
		for (const wake of this.#registration.get(key) ?? []) wake();
	}
	#remove(record: Run<Event, Metadata>): void {
		if (this.#runs.get(record.reservation.key) !== record) return;
		clearTimeout(record.activeTimer);
		clearTimeout(record.cleanupTimer);
		this.#runs.delete(record.reservation.key);
	}
}
function positive(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
		throw new RangeError("Run stream limits must be positive safe timer integers.");
	return value;
}
function unavailable(): AiSdkRunStreamError {
	return new AiSdkRunStreamError("RUN_UNAVAILABLE");
}
function timer(work: () => void, duration: number): ReturnType<typeof setTimeout> {
	const value = setTimeout(work, duration);
	value.unref();
	return value;
}
async function drain<Event>(events: AsyncIterable<Event>): Promise<void> {
	try {
		for await (const _event of events) {
			/* The rejected producer still owns its cleanup. */
		}
	} catch {
		/* Already rejected; draining is only for cleanup. */
	}
}
