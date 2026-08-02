import type {
	HarnessAgent,
	HarnessAgentResumeSessionState,
	HarnessAgentSession,
} from "@ai-sdk/harness/agent";
import type { FinishReason } from "ai";
import { describe, expect, it, vi } from "vitest";
import {
	AiSdkHarnessDisconnectedError,
	AiSdkHarnessInvalidTurnError,
	AiSdkHarnessRecoveryRequiredError,
	AiSdkHarnessRunner,
	AiSdkHarnessTimeoutError,
	AiSdkHarnessTurnFailedError,
	warmEphemeralAiSdkHarnessFinalization,
} from "../../src/harness/index.ts";
import {
	InMemoryAiSdkHarnessSessionLeaseManager,
	InMemoryAiSdkHarnessSessionStore,
} from "../../src/harness/testing/index.ts";

const key = { namespace: "tenant", agentKey: "codex", sessionId: "chat" } as const;
const resumeState: HarnessAgentResumeSessionState = {
	type: "resume-session",
	harnessId: "fixture",
	specificationVersion: "harness-v1",
	data: { providerSessionId: "provider-session" },
};

describe("AiSdkHarnessRunner", () => {
	it("holds the lease through final CAS and releases it last", async () => {
		const lifecycle: string[] = [];
		const fixture = createHarnessFixture({ stopState: resumeState, lifecycle });
		const store = new InMemoryAiSdkHarnessSessionStore({ durability: "durable" });
		const leases = new InMemoryAiSdkHarnessSessionLeaseManager();
		const load = store.load.bind(store);
		vi.spyOn(store, "load").mockImplementation(async (...arguments_) => {
			lifecycle.push("load");
			return load(...arguments_);
		});
		const compareAndSwap = store.compareAndSwap.bind(store);
		vi.spyOn(store, "compareAndSwap").mockImplementation(async (...arguments_) => {
			lifecycle.push(`cas:${arguments_[2].status}`);
			return compareAndSwap(...arguments_);
		});
		const acquire = leases.acquire.bind(leases);
		vi.spyOn(leases, "acquire").mockImplementation(async (...arguments_) => {
			lifecycle.push("acquire");
			const lease = await acquire(...arguments_);
			const release = lease.release.bind(lease);
			return {
				...lease,
				release: async (releaseOptions) => {
					lifecycle.push("release");
					await release(releaseOptions);
				},
			};
		});
		const runner = new AiSdkHarnessRunner({
			sessionStore: store,
			leaseManager: leases,
			timeoutMs: 1_000,
			cleanupTimeoutMs: 1_000,
			leaseTtlMs: 500,
		});

		const run = await runner.stream({
			agent: fixture.agent,
			key,
			turn: { kind: "prompt", messages: [] },
		});
		expect(lifecycle).toEqual(["acquire", "load", "cas:running", "create", "stream"]);

		fixture.finish.resolve("stop");
		await run.completion;
		expect(lifecycle).toEqual([
			"acquire",
			"load",
			"cas:running",
			"create",
			"stream",
			"stop",
			"cas:ready",
			"release",
		]);
	});

	it("stops successful durable turns and persists a safe resume checkpoint", async () => {
		const fixture = createHarnessFixture({ stopState: resumeState });
		const store = new InMemoryAiSdkHarnessSessionStore({ durability: "durable" });
		const runner = createRunner(store);
		const run = await runner.stream({
			agent: fixture.agent,
			key,
			turn: { kind: "prompt", messages: [] },
			finalization: {
				success: "stop",
				error: "stop",
				timeout: "stop",
				disconnect: "stop",
			},
		});

		fixture.finish.resolve("stop");
		await expect(run.completion).resolves.toMatchObject({ kind: "success", action: "stop" });
		expect(fixture.stop).toHaveBeenCalledOnce();
		expect(fixture.destroy).not.toHaveBeenCalled();
		expect(await store.load(key)).toMatchObject({
			state: { status: "ready", checkpoint: { kind: "resume", state: resumeState } },
		});
	});

	it("destroys and deletes unfinished durable turns after failure", async () => {
		const fixture = createHarnessFixture({ unfinished: true, stopState: resumeState });
		const store = new InMemoryAiSdkHarnessSessionStore({ durability: "durable" });
		const runner = createRunner(store);
		const run = await runner.stream({
			agent: fixture.agent,
			key,
			turn: { kind: "prompt", messages: [] },
			finalization: {
				success: "stop",
				error: "stop",
				timeout: "stop",
				disconnect: "stop",
			},
		});

		const nativeError = new Error("provider failed");
		fixture.finish.reject(nativeError);
		await expect(run.completion).rejects.toBe(nativeError);
		expect(fixture.destroy).toHaveBeenCalledOnce();
		expect(fixture.stop).not.toHaveBeenCalled();
		expect(await store.load(key)).toBeUndefined();
	});

	it("treats an error finish reason as a durable failure", async () => {
		const fixture = createHarnessFixture({ stopState: resumeState });
		const store = new InMemoryAiSdkHarnessSessionStore({ durability: "durable" });
		const run = await createRunner(store).stream({
			agent: fixture.agent,
			key,
			turn: { kind: "prompt", messages: [] },
		});

		fixture.finish.resolve("error");
		await expect(run.completion).rejects.toBeInstanceOf(AiSdkHarnessTurnFailedError);
		expect(fixture.destroy).toHaveBeenCalledOnce();
		expect(fixture.stop).not.toHaveBeenCalled();
		expect(await store.load(key)).toBeUndefined();
	});

	it("destroys unsafe unfinished state found in a durable store", async () => {
		const store = new InMemoryAiSdkHarnessSessionStore({ durability: "durable" });
		const continueFrom = {
			type: "continue-turn",
			harnessId: "fixture",
			specificationVersion: "harness-v1",
			data: { bridgeToken: "must-not-remain-durable" },
		} as const;
		await store.compareAndSwap(
			key,
			null,
			{ status: "continuable", checkpoint: { kind: "continue", state: continueFrom } },
			"seed",
		);
		const fixture = createHarnessFixture({ unfinished: true, stopState: resumeState });

		await expect(
			createRunner(store).stream({
				agent: fixture.agent,
				key,
				turn: { kind: "continue" },
			}),
		).rejects.toMatchObject({ code: "UNSAFE_DURABLE_STATE" });
		expect(fixture.createSession).toHaveBeenCalledWith(expect.objectContaining({ continueFrom }));
		expect(fixture.destroy).toHaveBeenCalledOnce();
		expect(await store.load(key)).toBeUndefined();
	});

	it("resumes and destroys the exact session when stop unexpectedly returns durable continuation state", async () => {
		const continueFrom = {
			type: "continue-turn",
			harnessId: "fixture",
			specificationVersion: "harness-v1",
			data: { bridgeToken: "must-be-destroyed" },
		} as const;
		const fixture = createHarnessFixture({
			stopState: { ...resumeState, continueFrom },
		});
		const store = new InMemoryAiSdkHarnessSessionStore({ durability: "durable" });
		const run = await createRunner(store).stream({
			agent: fixture.agent,
			key,
			turn: { kind: "prompt", messages: [] },
		});

		fixture.finish.resolve("stop");
		await expect(run.completion).rejects.toMatchObject({ code: "UNSAFE_DURABLE_STATE" });
		expect(fixture.stop).toHaveBeenCalledOnce();
		expect(fixture.createSession).toHaveBeenCalledTimes(2);
		expect(fixture.createSession).toHaveBeenLastCalledWith(
			expect.objectContaining({ resumeFrom: { ...resumeState, continueFrom } }),
		);
		expect(fixture.destroy).toHaveBeenCalledOnce();
		expect(await store.load(key)).toBeUndefined();
	});

	it("finalizes disconnect and timeout exactly once", async () => {
		const disconnectFixture = createHarnessFixture({ unfinished: true, stopState: resumeState });
		const disconnectStore = new InMemoryAiSdkHarnessSessionStore({ durability: "durable" });
		const disconnectRun = await createRunner(disconnectStore).stream({
			agent: disconnectFixture.agent,
			key,
			turn: { kind: "prompt", messages: [] },
		});
		disconnectRun.cancel("socket closed");
		disconnectRun.cancel("duplicate cancellation");
		await expect(disconnectRun.completion).rejects.toBeInstanceOf(AiSdkHarnessDisconnectedError);
		await expect(disconnectRun.completion).rejects.toBeInstanceOf(AiSdkHarnessDisconnectedError);
		expect(disconnectFixture.destroy).toHaveBeenCalledOnce();
		expect(await disconnectStore.load(key)).toBeUndefined();

		const timeoutFixture = createHarnessFixture({ unfinished: true, stopState: resumeState });
		const timeoutStore = new InMemoryAiSdkHarnessSessionStore({ durability: "durable" });
		const timeoutRun = await createRunner(timeoutStore).stream({
			agent: timeoutFixture.agent,
			key,
			turn: { kind: "prompt", messages: [] },
			timeoutMs: 5,
		});
		await expect(timeoutRun.completion).rejects.toBeInstanceOf(AiSdkHarnessTimeoutError);
		expect(timeoutFixture.destroy).toHaveBeenCalledOnce();
		expect(await timeoutStore.load(key)).toBeUndefined();
	});

	it("preserves unfinished continuation only for an ephemeral store", async () => {
		const continueFrom = {
			type: "continue-turn",
			harnessId: "fixture",
			specificationVersion: "harness-v1",
			data: { bridgeToken: "ephemeral-only" },
		} as const;
		const fixture = createHarnessFixture({
			unfinished: true,
			stopState: { ...resumeState, continueFrom },
		});
		const store = new InMemoryAiSdkHarnessSessionStore({ durability: "ephemeral" });
		const runner = createRunner(store);
		const run = await runner.stream({
			agent: fixture.agent,
			key,
			turn: { kind: "prompt", messages: [] },
			finalization: warmEphemeralAiSdkHarnessFinalization,
		});

		fixture.finish.resolve("stop");
		await expect(run.completion).resolves.toMatchObject({ action: "detach" });
		expect(await store.load(key)).toMatchObject({ state: { status: "continuable" } });

		const continuationFixture = createHarnessFixture({ stopState: resumeState });
		const continuationRun = await runner.stream({
			agent: continuationFixture.agent,
			key,
			turn: { kind: "continue" },
			finalization: warmEphemeralAiSdkHarnessFinalization,
		});
		expect(continuationFixture.createSession).toHaveBeenCalledWith(
			expect.objectContaining({ continueFrom }),
		);
		expect(continuationFixture.continueStream).toHaveBeenCalledOnce();
		continuationFixture.finish.resolve("stop");
		await continuationRun.completion;
	});

	it("rejects prompts for unfinished state and continuation without unfinished state", async () => {
		const store = new InMemoryAiSdkHarnessSessionStore({ durability: "ephemeral" });
		const seeded = await store.compareAndSwap(
			key,
			null,
			{
				status: "continuable",
				checkpoint: {
					kind: "continue",
					state: {
						type: "continue-turn",
						harnessId: "fixture",
						specificationVersion: "harness-v1",
						data: {},
					},
				},
			},
			"seed",
		);
		expect(seeded.state.status).toBe("continuable");
		const runner = createRunner(store);
		await expect(
			runner.stream({
				agent: createHarnessFixture({ stopState: resumeState }).agent,
				key,
				turn: { kind: "prompt", messages: [] },
			}),
		).rejects.toBeInstanceOf(AiSdkHarnessInvalidTurnError);

		store.clear();
		await expect(
			runner.stream({
				agent: createHarnessFixture({ stopState: resumeState }).agent,
				key,
				turn: { kind: "continue" },
			}),
		).rejects.toBeInstanceOf(AiSdkHarnessInvalidTurnError);
	});

	it("converts stale running markers to recovery-required", async () => {
		const store = new InMemoryAiSdkHarnessSessionStore({ durability: "durable" });
		await store.compareAndSwap(
			key,
			null,
			{ status: "running", operationId: "crashed", startedAt: 1 },
			"old-fence",
		);
		const runner = createRunner(store);

		await expect(
			runner.stream({
				agent: createHarnessFixture({ stopState: resumeState }).agent,
				key,
				turn: { kind: "prompt", messages: [] },
			}),
		).rejects.toThrow("operation crashed did not finalize");
		expect(await store.load(key)).toMatchObject({ state: { status: "recovery-required" } });
	});

	it("marks durable state recovery-required when session creation fails after the running CAS", async () => {
		const store = new InMemoryAiSdkHarnessSessionStore({ durability: "durable" });
		await store.compareAndSwap(
			key,
			null,
			{ status: "ready", checkpoint: { kind: "resume", state: resumeState } },
			"seed",
		);
		const secret = "bridge-token-must-not-be-persisted";
		const startError = new Error(`resume failed with ${secret}`);
		const fixture = createHarnessFixture({ stopState: resumeState });
		fixture.createSession.mockRejectedValueOnce(startError);

		await expect(
			createRunner(store).stream({
				agent: fixture.agent,
				key,
				turn: { kind: "prompt", messages: [] },
			}),
		).rejects.toBe(startError);
		expect(await store.load(key)).toMatchObject({
			state: {
				status: "recovery-required",
				reason: "session-start-failed-after-running-marker",
			},
		});
		expect(JSON.stringify(await store.load(key))).not.toContain(secret);

		const retryFixture = createHarnessFixture({ stopState: resumeState });
		await expect(
			createRunner(store).stream({
				agent: retryFixture.agent,
				key,
				turn: { kind: "prompt", messages: [] },
			}),
		).rejects.toBeInstanceOf(AiSdkHarnessRecoveryRequiredError);
		expect(retryFixture.createSession).not.toHaveBeenCalled();
	});

	it("marks recovery-required when the final checkpoint commit fails", async () => {
		const fixture = createHarnessFixture({ stopState: resumeState });
		const store = new InMemoryAiSdkHarnessSessionStore({ durability: "durable" });
		const commitError = new Error("checkpoint database unavailable");
		const compareAndSwap = store.compareAndSwap.bind(store);
		let failedCommit = false;
		vi.spyOn(store, "compareAndSwap").mockImplementation(async (...arguments_) => {
			if (!failedCommit && arguments_[2].status === "ready") {
				failedCommit = true;
				throw commitError;
			}
			return compareAndSwap(...arguments_);
		});
		const run = await createRunner(store).stream({
			agent: fixture.agent,
			key,
			turn: { kind: "prompt", messages: [] },
		});

		fixture.finish.resolve("stop");
		await expect(run.completion).rejects.toBe(commitError);
		expect(fixture.stop).toHaveBeenCalledOnce();
		expect(await store.load(key)).toMatchObject({
			state: { status: "recovery-required", reason: "turn-finalization-failed" },
		});
	});

	it("reconciles a checkpoint CAS that committed before reporting failure", async () => {
		const fixture = createHarnessFixture({ stopState: resumeState });
		const store = new InMemoryAiSdkHarnessSessionStore({ durability: "durable" });
		const commitError = new Error("checkpoint response was lost");
		const compareAndSwap = store.compareAndSwap.bind(store);
		let ambiguousCommit = false;
		vi.spyOn(store, "compareAndSwap").mockImplementation(async (...arguments_) => {
			if (!ambiguousCommit && arguments_[2].status === "ready") {
				ambiguousCommit = true;
				await compareAndSwap(...arguments_);
				throw commitError;
			}
			return compareAndSwap(...arguments_);
		});
		const run = await createRunner(store).stream({
			agent: fixture.agent,
			key,
			turn: { kind: "prompt", messages: [] },
		});

		fixture.finish.resolve("stop");
		await expect(run.completion).rejects.toBe(commitError);
		expect(await store.load(key)).toMatchObject({
			state: { status: "recovery-required", reason: "turn-finalization-failed" },
		});
	});

	it("retains the running marker and aggregates errors when recovery persistence also fails", async () => {
		const fixture = createHarnessFixture({ stopState: resumeState });
		const store = new InMemoryAiSdkHarnessSessionStore({ durability: "durable" });
		const commitError = new Error("checkpoint commit unavailable");
		const recoveryError = new Error("recovery marker unavailable");
		const compareAndSwap = store.compareAndSwap.bind(store);
		vi.spyOn(store, "compareAndSwap").mockImplementation(async (...arguments_) => {
			if (arguments_[2].status === "ready") throw commitError;
			if (arguments_[2].status === "recovery-required") throw recoveryError;
			return compareAndSwap(...arguments_);
		});
		const run = await createRunner(store).stream({
			agent: fixture.agent,
			key,
			turn: { kind: "prompt", messages: [] },
		});

		fixture.finish.resolve("stop");
		const failure: unknown = await run.completion.catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(AggregateError);
		if (!(failure instanceof AggregateError)) throw new Error("Expected aggregate store failure.");
		expect(failure.cause).toBe(commitError);
		expect(failure.errors).toEqual([commitError, recoveryError]);
		expect(await store.load(key)).toMatchObject({ state: { status: "running" } });
	});

	it("bounds destructive cleanup and releases the lease after a disconnect", async () => {
		const fixture = createHarnessFixture({ unfinished: true, stopState: resumeState });
		fixture.destroy.mockImplementation(() => new Promise<void>(() => undefined));
		const store = new InMemoryAiSdkHarnessSessionStore({ durability: "durable" });
		const leases = new InMemoryAiSdkHarnessSessionLeaseManager();
		const runner = new AiSdkHarnessRunner({
			sessionStore: store,
			leaseManager: leases,
			timeoutMs: 1_000,
			cleanupTimeoutMs: 20,
			leaseTtlMs: 500,
		});
		const run = await runner.stream({
			agent: fixture.agent,
			key,
			turn: { kind: "prompt", messages: [] },
		});
		const startedAt = Date.now();
		run.cancel("socket closed");
		const failure: unknown = await run.completion.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(AggregateError);
		if (!(failure instanceof AggregateError))
			throw new Error("Expected aggregate cleanup failure.");
		expect(failure.cause).toBeInstanceOf(AiSdkHarnessDisconnectedError);
		expect(Date.now() - startedAt).toBeLessThan(1_000);
		expect(fixture.destroy).toHaveBeenCalledOnce();
		const nextLease = await leases.acquire(key, { ownerId: "after-cleanup", ttlMs: 500 });
		await nextLease.release();
	});
});

function createRunner(store: InMemoryAiSdkHarnessSessionStore): AiSdkHarnessRunner {
	return new AiSdkHarnessRunner({
		sessionStore: store,
		leaseManager: new InMemoryAiSdkHarnessSessionLeaseManager(),
		timeoutMs: 1_000,
		cleanupTimeoutMs: 1_000,
		leaseTtlMs: 500,
	});
}

function createHarnessFixture(options: {
	readonly unfinished?: boolean;
	readonly stopState: HarnessAgentResumeSessionState;
	readonly lifecycle?: string[];
}) {
	const finish = promiseController<FinishReason>();
	const stop = vi.fn(async () => {
		options.lifecycle?.push("stop");
		return options.stopState;
	});
	const detach = vi.fn(async () => options.stopState);
	const destroy = vi.fn(async () => {
		options.lifecycle?.push("destroy");
	});
	const session = {
		hasUnfinishedTurn: () => options.unfinished ?? false,
		stop,
		detach,
		destroy,
	} as unknown as HarnessAgentSession;
	const result = {
		finishReason: finish.promise,
		stream: new ReadableStream({ start() {} }),
	} as unknown as Awaited<ReturnType<HarnessAgent["stream"]>>;
	const createSession = vi.fn(async () => {
		options.lifecycle?.push("create");
		return session;
	});
	const stream = vi.fn(async () => {
		options.lifecycle?.push("stream");
		return result;
	});
	const continueStream = vi.fn(async () => result);
	const agent = {
		tools: {},
		createSession,
		stream,
		continueStream,
	} as unknown as HarnessAgent;
	return {
		agent,
		continueStream,
		createSession,
		destroy,
		finish,
		stop,
	};
}

function promiseController<T>() {
	let resolvePromise!: (value: T) => void;
	let rejectPromise!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return { promise, resolve: resolvePromise, reject: rejectPromise };
}
