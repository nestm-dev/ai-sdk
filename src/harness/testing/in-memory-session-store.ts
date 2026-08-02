import { AiSdkHarnessStateConflictError } from "../ai-sdk-harness.errors.ts";
import type {
	AiSdkHarnessSessionKey,
	AiSdkHarnessSessionRecord,
	AiSdkHarnessSessionState,
	AiSdkHarnessSessionStore,
	AiSdkHarnessStoreOperationOptions,
} from "../ai-sdk-harness.types.ts";

export interface InMemoryAiSdkHarnessSessionStoreOptions {
	readonly durability?: AiSdkHarnessSessionStore["durability"];
}

/** Deterministic CAS store intended for unit tests and ephemeral local runs. */
export class InMemoryAiSdkHarnessSessionStore implements AiSdkHarnessSessionStore {
	readonly durability: AiSdkHarnessSessionStore["durability"];
	private readonly records = new Map<string, AiSdkHarnessSessionRecord>();
	private revision = 0;

	constructor(options: InMemoryAiSdkHarnessSessionStoreOptions = {}) {
		this.durability = options.durability ?? "ephemeral";
	}

	async load(
		key: AiSdkHarnessSessionKey,
		options?: AiSdkHarnessStoreOperationOptions,
	): Promise<AiSdkHarnessSessionRecord | undefined> {
		throwIfAborted(options?.abortSignal);
		const record = this.records.get(serializeKey(key));
		return record === undefined ? undefined : structuredClone(record);
	}

	async compareAndSwap(
		key: AiSdkHarnessSessionKey,
		expectedRevision: string | null,
		next: AiSdkHarnessSessionState,
		fencingToken: string,
		options?: AiSdkHarnessStoreOperationOptions,
	): Promise<AiSdkHarnessSessionRecord> {
		throwIfAborted(options?.abortSignal);
		const serializedKey = serializeKey(key);
		const current = this.records.get(serializedKey);
		if ((current?.revision ?? null) !== expectedRevision) {
			throw new AiSdkHarnessStateConflictError(key.sessionId);
		}
		const record: AiSdkHarnessSessionRecord = {
			state: structuredClone(next),
			revision: String(++this.revision),
			fencingToken,
		};
		this.records.set(serializedKey, record);
		return structuredClone(record);
	}

	async delete(
		key: AiSdkHarnessSessionKey,
		expectedRevision: string | null,
		fencingToken: string,
		options?: AiSdkHarnessStoreOperationOptions,
	): Promise<void> {
		throwIfAborted(options?.abortSignal);
		const serializedKey = serializeKey(key);
		const current = this.records.get(serializedKey);
		if (
			(current?.revision ?? null) !== expectedRevision ||
			(current !== undefined && current.fencingToken !== fencingToken)
		) {
			throw new AiSdkHarnessStateConflictError(key.sessionId);
		}
		this.records.delete(serializedKey);
	}

	clear(): void {
		this.records.clear();
	}
}

function serializeKey(key: AiSdkHarnessSessionKey): string {
	return JSON.stringify([key.namespace, key.agentKey, key.sessionId]);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason;
}
