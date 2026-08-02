import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import {
	AI_SDK_HARNESS_SESSION_LEASE_MANAGER,
	AI_SDK_HARNESS_SESSION_STORE,
	AiSdkHarnessModule,
	AiSdkHarnessRunner,
} from "../../src/harness/index.ts";
import {
	InMemoryAiSdkHarnessSessionLeaseManager,
	InMemoryAiSdkHarnessSessionStore,
} from "../../src/harness/testing/index.ts";

describe("AiSdkHarnessModule", () => {
	it("registers application-owned stores without replacing their identity", async () => {
		const sessionStore = new InMemoryAiSdkHarnessSessionStore({ durability: "durable" });
		const leaseManager = new InMemoryAiSdkHarnessSessionLeaseManager();
		const moduleReference = await Test.createTestingModule({
			imports: [AiSdkHarnessModule.forRoot({ sessionStore, leaseManager, isGlobal: false })],
		}).compile();

		expect(moduleReference.get(AI_SDK_HARNESS_SESSION_STORE)).toBe(sessionStore);
		expect(moduleReference.get(AI_SDK_HARNESS_SESSION_LEASE_MANAGER)).toBe(leaseManager);
		expect(moduleReference.get(AiSdkHarnessRunner)).toBeInstanceOf(AiSdkHarnessRunner);
		await moduleReference.close();
	});

	it("supports async factories", async () => {
		const sessionStore = new InMemoryAiSdkHarnessSessionStore();
		const leaseManager = new InMemoryAiSdkHarnessSessionLeaseManager();
		const moduleReference = await Test.createTestingModule({
			imports: [
				AiSdkHarnessModule.forRootAsync({
					isGlobal: false,
					useFactory: async () => ({ sessionStore, leaseManager }),
				}),
			],
		}).compile();

		expect(moduleReference.get(AiSdkHarnessRunner)).toBeInstanceOf(AiSdkHarnessRunner);
		await moduleReference.close();
	});
});
