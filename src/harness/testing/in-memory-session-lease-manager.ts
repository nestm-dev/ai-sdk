import {
	AiSdkHarnessLeaseLostError,
	AiSdkHarnessSessionBusyError,
} from "../ai-sdk-harness.errors.ts";
import type {
	AiSdkHarnessSessionKey,
	AiSdkHarnessSessionLease,
	AiSdkHarnessSessionLeaseManager,
} from "../ai-sdk-harness.types.ts";

interface LeaseState {
	readonly key: AiSdkHarnessSessionKey;
	readonly ownerId: string;
	readonly fencingToken: string;
	readonly controller: AbortController;
	expiresAt: number;
}

/** In-process fenced lease manager for tests and single-process ephemeral use. */
export class InMemoryAiSdkHarnessSessionLeaseManager implements AiSdkHarnessSessionLeaseManager {
	private readonly leases = new Map<string, LeaseState>();
	private readonly fencingCounters = new Map<string, bigint>();

	async acquire(
		key: AiSdkHarnessSessionKey,
		options: {
			readonly ownerId: string;
			readonly ttlMs: number;
			readonly abortSignal?: AbortSignal;
		},
	): Promise<AiSdkHarnessSessionLease> {
		throwIfAborted(options.abortSignal);
		const serializedKey = serializeKey(key);
		const existing = this.leases.get(serializedKey);
		if (existing !== undefined && existing.expiresAt > Date.now()) {
			throw new AiSdkHarnessSessionBusyError(key.sessionId);
		}
		if (existing !== undefined) {
			existing.controller.abort(new AiSdkHarnessLeaseLostError(key.sessionId));
		}

		const fencingToken = this.nextFencingToken(serializedKey);
		const state: LeaseState = {
			key: structuredClone(key),
			ownerId: options.ownerId,
			fencingToken,
			controller: new AbortController(),
			expiresAt: Date.now() + options.ttlMs,
		};
		this.leases.set(serializedKey, state);
		return this.createLease(serializedKey, state);
	}

	private createLease(serializedKey: string, state: LeaseState): AiSdkHarnessSessionLease {
		let released = false;
		return {
			key: structuredClone(state.key),
			ownerId: state.ownerId,
			fencingToken: state.fencingToken,
			signal: state.controller.signal,
			renew: async (options) => {
				throwIfAborted(options.abortSignal);
				const current = this.leases.get(serializedKey);
				if (
					released ||
					current?.fencingToken !== state.fencingToken ||
					state.expiresAt <= Date.now()
				) {
					const error = new AiSdkHarnessLeaseLostError(state.key.sessionId);
					state.controller.abort(error);
					throw error;
				}
				state.expiresAt = Date.now() + options.ttlMs;
			},
			release: async (options) => {
				throwIfAborted(options?.abortSignal);
				if (released) return;
				released = true;
				if (this.leases.get(serializedKey)?.fencingToken === state.fencingToken) {
					this.leases.delete(serializedKey);
				}
			},
		};
	}

	private nextFencingToken(serializedKey: string): string {
		const token = (this.fencingCounters.get(serializedKey) ?? 0n) + 1n;
		this.fencingCounters.set(serializedKey, token);
		return token.toString();
	}
}

function serializeKey(key: AiSdkHarnessSessionKey): string {
	return JSON.stringify([key.namespace, key.agentKey, key.sessionId]);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason;
}
