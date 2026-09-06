import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AiSdkRunStreamError,
	AiSdkRunStreamRegistry,
	type AiSdkRunReplay,
} from "../../../src/runs/index.js";

type Event = { value: string; terminal?: boolean };
function replay(): AiSdkRunReplay<Event> {
	const events: Event[] = [];
	return {
		append(event) {
			if (events.length >= 4) throw new Error("Projection full");
			events.push(event);
		},
		createCursor() {
			let index = 0;
			return () => {
				const next = events.slice(index);
				index = events.length;
				return { events: next, done: events.at(-1)?.terminal ?? false };
			};
		},
	};
}
const live = new AbortController().signal;
const registries: AiSdkRunStreamRegistry<Event, string>[] = [];
function registry(
	options: {
		maxRuns?: number;
		executionTimeoutMs?: number;
		replayRetentionMs?: number;
		registrationGraceMs?: number;
		onStreamError?: (key: string, error: unknown) => void;
	} = {},
) {
	const value = new AiSdkRunStreamRegistry<Event, string>({ createReplay: replay, ...options });
	registries.push(value);
	return value;
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
async function collect(events: AsyncIterable<Event>) {
	const result: Event[] = [];
	for await (const event of events) result.push(event);
	return result;
}
function aborted(signal: AbortSignal) {
	if (signal.aborted) return Promise.resolve();
	return new Promise<void>((resolve) =>
		signal.addEventListener("abort", () => resolve(), { once: true }),
	);
}
afterEach(async () => {
	await Promise.all(registries.splice(0).map((r) => r.shutdown()));
	vi.useRealTimers();
});

describe("process-local run streams", () => {
	it("runs once while detached subscribers reconnect to their own projected prefix and tail", async () => {
		const r = registry();
		const reservation = r.reserve("inventory");
		const tail = deferred<void>();
		let executions = 0;
		r.launch(reservation, async () => ({
			metadata: "inventory",
			events: (async function* () {
				executions++;
				yield { value: "a" };
				await tail.promise;
				yield { value: "b", terminal: true };
			})(),
		}));
		const detached = new AbortController();
		const first = await r.subscribe("inventory", detached.signal);
		expect(first?.metadata).toBe("inventory");
		const iterator = first!.events[Symbol.asyncIterator]();
		expect((await iterator.next()).value).toEqual({ value: "a" });
		detached.abort();
		expect((await iterator.next()).done).toBe(true);
		expect(reservation.signal.aborted).toBe(false);
		const second = await r.subscribe("inventory", live);
		const output = collect(second!.events);
		tail.resolve();
		expect(await output).toEqual([{ value: "a" }, { value: "b", terminal: true }]);
		expect(await collect((await r.subscribe("inventory", live))!.events)).toEqual(await output);
		expect(executions).toBe(1);
		expect(() => r.launch(reservation, async () => second!)).toThrow(AiSdkRunStreamError);
		expect(() => r.reserve("inventory")).toThrow(AiSdkRunStreamError);
	});
	it("retains terminal events after explicit cancellation and waits for producer cleanup", async () => {
		const r = registry();
		const reservation = r.reserve("job");
		let cleaned = false;
		r.launch(reservation, async (signal) => ({
			metadata: "job",
			events: (async function* () {
				try {
					yield { value: "started" };
					await aborted(signal);
					yield { value: "cancelled", terminal: true };
				} finally {
					cleaned = true;
				}
			})(),
		}));
		const output = collect((await r.subscribe("job", live))!.events);
		expect(r.cancel("job")).toBe(true);
		expect(r.cancel("job")).toBe(true);
		expect(await output).toEqual([{ value: "started" }, { value: "cancelled", terminal: true }]);
		expect(cleaned).toBe(true);
		expect(r.cancel("job")).toBe(false);
		expect(r.cancel("missing")).toBe(false);
	});
	it("drains a late producer after the deadline so its finally block persists terminal state", async () => {
		vi.useFakeTimers();
		const r = registry({ executionTimeoutMs: 10 });
		const reservation = r.reserve("late");
		const ready = deferred<void>();
		let cleaned = false;
		r.launch(reservation, async () => {
			await ready.promise;
			return {
				metadata: "late",
				events: (async function* () {
					try {
						yield { value: "terminal", terminal: true };
					} finally {
						cleaned = true;
					}
				})(),
			};
		});
		const subscribed = r.subscribe("late", live);
		await vi.advanceTimersByTimeAsync(10);
		expect(await subscribed).toBeNull();
		expect(reservation.signal.reason).toMatchObject({ name: "TimeoutError" });
		ready.resolve();
		await r.shutdown();
		expect(cleaned).toBe(true);
	});
	it("bounds capacity and replay retention without evicting active runs", async () => {
		vi.useFakeTimers();
		const r = registry({ maxRuns: 1, replayRetentionMs: 60 });
		const reservation = r.reserve("one");
		expect(() => r.reserve("two")).toThrow(
			expect.objectContaining({ code: "RUN_CAPACITY_EXCEEDED" }),
		);
		r.launch(reservation, async () => ({
			metadata: "one",
			events: (async function* () {
				yield { value: "done", terminal: true };
			})(),
		}));
		await collect((await r.subscribe("one", live))!.events);
		await vi.advanceTimersByTimeAsync(59);
		expect(await r.subscribe("one", live)).not.toBeNull();
		await vi.advanceTimersByTimeAsync(1);
		expect(await r.subscribe("one", live)).toBeNull();
		const next = r.reserve("one");
		expect(next).not.toBe(reservation);
		expect(() =>
			r.launch(reservation, async () => {
				throw new Error();
			}),
		).toThrow(AiSdkRunStreamError);
	});
	it("evicts only completed replay under pressure and does not let old timers delete new reservations", async () => {
		vi.useFakeTimers();
		const r = registry({ maxRuns: 1, replayRetentionMs: 60 });
		const first = r.reserve("one");
		r.failReservation(first, new Error("failed"));
		const other = r.reserve("two");
		expect(await r.subscribe("one", live)).toBeNull();
		r.failReservation(other, new Error("failed"));
		const replacement = r.reserve("one");
		await vi.advanceTimersByTimeAsync(60);
		expect(() => r.reserve("one")).toThrow(AiSdkRunStreamError);
		expect(replacement.signal.aborted).toBe(false);
	});
	it("waits briefly for registration and detaches readiness without cancelling the reserved execution", async () => {
		vi.useFakeTimers();
		const r = registry({ registrationGraceMs: 25 });
		const waiting = r.subscribeWhenAvailable("job", live);
		await vi.advanceTimersByTimeAsync(10);
		const reservation = r.reserve("job");
		r.launch(reservation, async () => ({
			metadata: "job",
			events: (async function* () {
				yield { value: "done", terminal: true };
			})(),
		}));
		expect((await waiting)?.metadata).toBe("job");
		const missing = r.subscribeWhenAvailable("missing", live);
		await vi.advanceTimersByTimeAsync(25);
		expect(await missing).toBeNull();
		const pending = r.reserve("pending");
		const detached = new AbortController();
		const subscription = r.subscribe("pending", detached.signal);
		detached.abort();
		expect(await subscription).toBeNull();
		expect(pending.signal.aborted).toBe(false);
	});
	it("rejects forged reservations, delivers startup errors and validates metadata before readiness", async () => {
		const r = registry();
		const reservation = r.reserve("job");
		expect(() =>
			r.launch({ ...reservation }, async () => {
				throw new Error();
			}),
		).toThrow(AiSdkRunStreamError);
		const failure = new Error("startup");
		r.failReservation(reservation, failure);
		await expect(r.subscribe("job", live)).rejects.toBe(failure);
		const mismatch = r.reserve("mismatch");
		let cleaned = false;
		r.launch(
			mismatch,
			async () => ({
				metadata: "wrong",
				events: (async function* () {
					try {
						yield { value: "unexpected" };
					} finally {
						cleaned = true;
					}
				})(),
			}),
			() => {
				throw failure;
			},
		);
		expect(await r.subscribe("mismatch", live)).toBeNull();
		await r.shutdown();
		expect(cleaned).toBe(true);
		expect(mismatch.signal.aborted).toBe(true);
	});
	it("aborts before iterator cleanup when the host replay bound rejects an event", async () => {
		const reported = vi.fn();
		const r = registry({ onStreamError: reported });
		const reservation = r.reserve("job");
		let cleaned = false;
		r.launch(reservation, async (signal) => ({
			metadata: "job",
			events: (async function* () {
				try {
					for (let i = 0; i < 5; i++) yield { value: String(i) };
				} finally {
					await aborted(signal);
					cleaned = true;
				}
			})(),
		}));
		const result = await collect((await r.subscribe("job", live))!.events);
		expect(result).toHaveLength(4);
		expect(reservation.signal.aborted).toBe(true);
		expect(cleaned).toBe(true);
		expect(reported).toHaveBeenCalledOnce();
	});
	it("shutdown is idempotent, waits for late startup and wakes registration waiters", async () => {
		const r = registry();
		const reservation = r.reserve("late");
		const ready = deferred<void>();
		let cleaned = false;
		r.launch(reservation, async () => {
			await ready.promise;
			return {
				metadata: "late",
				events: (async function* () {
					try {
						yield { value: "done", terminal: true };
					} finally {
						cleaned = true;
					}
				})(),
			};
		});
		const waiting = r.subscribeWhenAvailable("missing", live);
		const stopping = r.shutdown();
		expect(r.shutdown()).toBe(stopping);
		expect(await waiting).toBeNull();
		expect(reservation.signal.reason).toMatchObject({ name: "ShutdownError" });
		expect(() => r.reserve("another")).toThrow(AiSdkRunStreamError);
		let stopped = false;
		void stopping.then(() => {
			stopped = true;
		});
		await Promise.resolve();
		expect(stopped).toBe(false);
		ready.resolve();
		await stopping;
		expect(cleaned).toBe(true);
	});
});
