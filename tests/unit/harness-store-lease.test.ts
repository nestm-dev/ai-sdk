import { describe, expect, it } from "vitest";
import {
	AiSdkHarnessSessionBusyError,
	AiSdkHarnessStateConflictError,
} from "../../src/harness/index.ts";
import {
	InMemoryAiSdkHarnessSessionLeaseManager,
	InMemoryAiSdkHarnessSessionStore,
} from "../../src/harness/testing/index.ts";

const key = { namespace: "tenant", agentKey: "claude", sessionId: "chat" } as const;

describe("Harness in-memory coordination", () => {
	it("enforces revisions and fencing tokens", async () => {
		const store = new InMemoryAiSdkHarnessSessionStore({ durability: "durable" });
		const created = await store.compareAndSwap(
			key,
			null,
			{ status: "running", operationId: "one", startedAt: 1 },
			"fence-1",
		);

		await expect(
			store.compareAndSwap(
				key,
				null,
				{ status: "running", operationId: "two", startedAt: 2 },
				"fence-2",
			),
		).rejects.toBeInstanceOf(AiSdkHarnessStateConflictError);
		await expect(store.delete(key, created.revision, "stale-fence")).rejects.toBeInstanceOf(
			AiSdkHarnessStateConflictError,
		);
		await store.delete(key, created.revision, "fence-1");
		expect(await store.load(key)).toBeUndefined();
	});

	it("issues monotonic fences and rejects concurrent owners", async () => {
		const leases = new InMemoryAiSdkHarnessSessionLeaseManager();
		const first = await leases.acquire(key, { ownerId: "one", ttlMs: 1_000 });
		await expect(leases.acquire(key, { ownerId: "two", ttlMs: 1_000 })).rejects.toBeInstanceOf(
			AiSdkHarnessSessionBusyError,
		);
		await first.release();

		const second = await leases.acquire(key, { ownerId: "two", ttlMs: 1_000 });
		expect(BigInt(second.fencingToken)).toBeGreaterThan(BigInt(first.fencingToken));
		await second.release();
	});
});
