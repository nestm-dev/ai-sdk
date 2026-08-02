import type {
	HarnessAgent,
	HarnessAgentContinueTurnState,
	HarnessAgentResumeSessionState,
} from "@ai-sdk/harness/agent";
import type { InferUITools, ModelMessage, ToolSet, UIDataTypes, UIMessage } from "ai";

export interface AiSdkHarnessSessionKey {
	readonly namespace: string;
	readonly agentKey: string;
	readonly sessionId: string;
}

export type AiSdkHarnessCheckpoint =
	| { readonly kind: "resume"; readonly state: HarnessAgentResumeSessionState }
	| { readonly kind: "continue"; readonly state: HarnessAgentContinueTurnState };

export type AiSdkHarnessSessionState =
	| {
			readonly status: "ready";
			readonly checkpoint: Extract<AiSdkHarnessCheckpoint, { kind: "resume" }>;
	  }
	| {
			readonly status: "continuable";
			readonly checkpoint: Extract<AiSdkHarnessCheckpoint, { kind: "continue" }>;
	  }
	| {
			readonly status: "running";
			readonly operationId: string;
			readonly startedAt: number;
	  }
	| {
			readonly status: "recovery-required";
			readonly reason: string;
	  };

export interface AiSdkHarnessSessionRecord {
	readonly state: AiSdkHarnessSessionState;
	readonly revision: string;
	readonly fencingToken: string;
}

export interface AiSdkHarnessStoreOperationOptions {
	readonly abortSignal?: AbortSignal;
}

export interface AiSdkHarnessSessionStore {
	readonly durability: "ephemeral" | "durable";

	load(
		key: AiSdkHarnessSessionKey,
		options?: AiSdkHarnessStoreOperationOptions,
	): Promise<AiSdkHarnessSessionRecord | undefined>;

	compareAndSwap(
		key: AiSdkHarnessSessionKey,
		expectedRevision: string | null,
		next: AiSdkHarnessSessionState,
		fencingToken: string,
		options?: AiSdkHarnessStoreOperationOptions,
	): Promise<AiSdkHarnessSessionRecord>;

	delete(
		key: AiSdkHarnessSessionKey,
		expectedRevision: string | null,
		fencingToken: string,
		options?: AiSdkHarnessStoreOperationOptions,
	): Promise<void>;
}

export interface AiSdkHarnessSessionLease {
	readonly key: AiSdkHarnessSessionKey;
	readonly ownerId: string;
	readonly fencingToken: string;
	readonly signal: AbortSignal;

	renew(options: { readonly ttlMs: number; readonly abortSignal?: AbortSignal }): Promise<void>;

	release(options?: { readonly abortSignal?: AbortSignal }): Promise<void>;
}

export interface AiSdkHarnessSessionLeaseManager {
	acquire(
		key: AiSdkHarnessSessionKey,
		options: {
			readonly ownerId: string;
			readonly ttlMs: number;
			readonly abortSignal?: AbortSignal;
		},
	): Promise<AiSdkHarnessSessionLease>;
}

export type AiSdkHarnessTurn =
	| { readonly kind: "prompt"; readonly messages: readonly ModelMessage[] }
	| { readonly kind: "continue"; readonly messages?: readonly ModelMessage[] };

export type AiSdkHarnessFinalizationAction = "detach" | "stop" | "destroy";
export type AiSdkHarnessCompletionKind = "success" | "error" | "timeout" | "disconnect";

export interface AiSdkHarnessFinalizationPolicy {
	readonly success: AiSdkHarnessFinalizationAction;
	readonly error: AiSdkHarnessFinalizationAction;
	readonly timeout: AiSdkHarnessFinalizationAction;
	readonly disconnect: AiSdkHarnessFinalizationAction;
}

export const durableSafeAiSdkHarnessFinalization: AiSdkHarnessFinalizationPolicy = Object.freeze({
	success: "stop",
	error: "destroy",
	timeout: "destroy",
	disconnect: "destroy",
});

export const warmEphemeralAiSdkHarnessFinalization: AiSdkHarnessFinalizationPolicy = Object.freeze({
	success: "detach",
	error: "destroy",
	timeout: "stop",
	disconnect: "stop",
});

export interface AiSdkHarnessModuleOptions {
	readonly sessionStore: AiSdkHarnessSessionStore;
	readonly leaseManager: AiSdkHarnessSessionLeaseManager;
	readonly timeoutMs?: number;
	readonly cleanupTimeoutMs?: number;
	readonly leaseTtlMs?: number;
	readonly ownerId?: string;
	readonly finalization?: AiSdkHarnessFinalizationPolicy;
}

export interface AiSdkHarnessModuleExtras {
	readonly isGlobal?: boolean;
}

export interface AiSdkHarnessOptionsFactory {
	createAiSdkHarnessOptions(): AiSdkHarnessModuleOptions | PromiseLike<AiSdkHarnessModuleOptions>;
}

export interface AiSdkHarnessStreamOptions<AGENT extends HarnessAgent = HarnessAgent> {
	readonly agent: AGENT;
	readonly key: AiSdkHarnessSessionKey;
	readonly turn: AiSdkHarnessTurn;
	readonly abortSignal?: AbortSignal;
	readonly timeoutMs?: number;
	readonly finalization?: AiSdkHarnessFinalizationPolicy;
}

export interface AiSdkHarnessRunOutcome {
	readonly kind: AiSdkHarnessCompletionKind;
	readonly action: AiSdkHarnessFinalizationAction;
	readonly checkpoint?: AiSdkHarnessCheckpoint;
}

export interface AiSdkHarnessRun<RESULT> {
	readonly stream: RESULT;
	readonly completion: Promise<AiSdkHarnessRunOutcome>;
	cancel(reason?: unknown): void;
}

export type AiSdkHarnessStreamResult<AGENT extends HarnessAgent = HarnessAgent> = Awaited<
	ReturnType<AGENT["stream"]>
>;

export type InferAiSdkHarnessUIMessage<
	AGENT extends { readonly tools: ToolSet },
	METADATA = unknown,
	DATA_PARTS extends UIDataTypes = never,
> = UIMessage<METADATA, DATA_PARTS, InferUITools<AGENT["tools"]>>;
