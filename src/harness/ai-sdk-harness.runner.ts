import { randomUUID } from "node:crypto";
import {
	collectHarnessAgentToolApprovalContinuations,
	collectHarnessAgentToolResultContinuations,
	type HarnessAgent,
	type HarnessAgentSession,
} from "@ai-sdk/harness/agent";
import {
	AiSdkHarnessDisconnectedError,
	AiSdkHarnessError,
	AiSdkHarnessInvalidTurnError,
	AiSdkHarnessLeaseLostError,
	AiSdkHarnessRecoveryRequiredError,
	AiSdkHarnessTimeoutError,
	AiSdkHarnessTurnFailedError,
} from "./ai-sdk-harness.errors.ts";
import { assertAiSdkHarnessCompatibility } from "./ai-sdk-harness-compatibility.ts";
import type {
	AiSdkHarnessCheckpoint,
	AiSdkHarnessCompletionKind,
	AiSdkHarnessFinalizationAction,
	AiSdkHarnessFinalizationPolicy,
	AiSdkHarnessModuleOptions,
	AiSdkHarnessRun,
	AiSdkHarnessRunOutcome,
	AiSdkHarnessSessionLease,
	AiSdkHarnessSessionRecord,
	AiSdkHarnessSessionState,
	AiSdkHarnessStreamOptions,
	AiSdkHarnessStreamResult,
} from "./ai-sdk-harness.types.ts";
import { durableSafeAiSdkHarnessFinalization } from "./ai-sdk-harness.types.ts";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_CLEANUP_TIMEOUT_MS = 10_000;
const DEFAULT_LEASE_TTL_MS = 30_000;
const START_RECOVERY_REASON = "session-start-failed-after-running-marker";
const FINALIZATION_RECOVERY_REASON = "turn-finalization-failed";
const noop = (): void => undefined;

interface ActiveTurn {
	readonly controller: AbortController;
	readonly timeout: ReturnType<typeof setTimeout>;
	removeExternalAbortListener: () => void;
	removeLeaseAbortListener: () => void;
	stopRenewing: () => void;
	completionKind: AiSdkHarnessCompletionKind | undefined;
	primaryError: unknown;
}

interface FinalizeInput {
	readonly agent: HarnessAgent;
	readonly session: HarnessAgentSession;
	readonly lease: AiSdkHarnessSessionLease;
	readonly runningRecord: AiSdkHarnessSessionRecord;
	readonly kind: AiSdkHarnessCompletionKind;
	readonly policy: AiSdkHarnessFinalizationPolicy;
	readonly stopRenewing?: () => void;
}

/**
 * Runs one Harness turn under a fenced lease and a CAS-protected checkpoint.
 * The runner owns only the session handle it creates; stores and lease managers
 * remain application-owned.
 */
export class AiSdkHarnessRunner {
	private readonly sessionStore: AiSdkHarnessModuleOptions["sessionStore"];
	private readonly leaseManager: AiSdkHarnessModuleOptions["leaseManager"];
	private readonly timeoutMs: number;
	private readonly cleanupTimeoutMs: number;
	private readonly leaseTtlMs: number;
	private readonly ownerId: string;
	private readonly finalization: AiSdkHarnessFinalizationPolicy;

	constructor(options: AiSdkHarnessModuleOptions) {
		assertAiSdkHarnessCompatibility();
		this.sessionStore = options.sessionStore;
		this.leaseManager = options.leaseManager;
		this.timeoutMs = positiveDuration(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
		this.cleanupTimeoutMs = positiveDuration(
			options.cleanupTimeoutMs,
			DEFAULT_CLEANUP_TIMEOUT_MS,
			"cleanupTimeoutMs",
		);
		this.leaseTtlMs = positiveDuration(options.leaseTtlMs, DEFAULT_LEASE_TTL_MS, "leaseTtlMs");
		this.ownerId = options.ownerId?.trim() || `${process.pid}:${randomUUID()}`;
		this.finalization = options.finalization ?? durableSafeAiSdkHarnessFinalization;
		this.assertPolicyAllowed(this.finalization);
	}

	async stream<AGENT extends HarnessAgent>(
		options: AiSdkHarnessStreamOptions<AGENT>,
	): Promise<AiSdkHarnessRun<AiSdkHarnessStreamResult<AGENT>>> {
		assertSessionKey(options.key);
		const policy = options.finalization ?? this.finalization;
		this.assertPolicyAllowed(policy);
		const timeoutMs = positiveDuration(options.timeoutMs, this.timeoutMs, "timeoutMs");
		const timeoutDeadline = Date.now() + timeoutMs;
		const initialController = new AbortController();
		const removeInitialAbortListener = forwardAbort(options.abortSignal, initialController);
		const timeoutError = new AiSdkHarnessTimeoutError(options.key.sessionId, timeoutMs);
		const initialTimeout = setTimeout(() => initialController.abort(timeoutError), timeoutMs);
		initialTimeout.unref?.();

		let lease: AiSdkHarnessSessionLease | undefined;
		let previousRecord: AiSdkHarnessSessionRecord | undefined;
		let runningRecord: AiSdkHarnessSessionRecord | undefined;
		let session: HarnessAgentSession | undefined;
		let active: ActiveTurn | undefined;
		let stopInitialRenewing: () => void = noop;
		let removeInitialLeaseAbortListener: () => void = noop;

		try {
			lease = await this.leaseManager.acquire(options.key, {
				ownerId: this.ownerId,
				ttlMs: this.leaseTtlMs,
				abortSignal: initialController.signal,
			});
			const acquiredLease = lease;
			removeInitialLeaseAbortListener = forwardAbort(
				acquiredLease.signal,
				initialController,
				() =>
					new AiSdkHarnessLeaseLostError(options.key.sessionId, {
						cause: acquiredLease.signal.reason,
					}),
			);
			stopInitialRenewing = startLeaseRenewal({
				lease,
				ttlMs: this.leaseTtlMs,
				onError: (error) =>
					initialController.abort(
						new AiSdkHarnessLeaseLostError(options.key.sessionId, { cause: error }),
					),
			});
			previousRecord = await this.sessionStore.load(options.key, {
				abortSignal: initialController.signal,
			});
			previousRecord = await this.resolveLoadState(
				options.key.sessionId,
				previousRecord,
				lease,
				initialController.signal,
			);
			const unsafeDurableCheckpoint =
				this.sessionStore.durability === "durable" &&
				hasUnfinishedCheckpoint(previousRecord?.state);
			if (!unsafeDurableCheckpoint) {
				validateTurn(options.key.sessionId, options.turn.kind, previousRecord?.state);
			}

			runningRecord = await this.sessionStore.compareAndSwap(
				options.key,
				previousRecord?.revision ?? null,
				{
					status: "running",
					operationId: randomUUID(),
					startedAt: Date.now(),
				},
				lease.fencingToken,
				{ abortSignal: initialController.signal },
			);

			const checkpoint = checkpointFromRecord(previousRecord);
			session = await options.agent.createSession({
				sessionId: options.key.sessionId,
				...(checkpoint?.kind === "resume" ? { resumeFrom: checkpoint.state } : {}),
				...(checkpoint?.kind === "continue" ? { continueFrom: checkpoint.state } : {}),
				abortSignal: initialController.signal,
			});
			initialController.signal.throwIfAborted();
			if (unsafeDurableCheckpoint) {
				throw new AiSdkHarnessError(
					"UNSAFE_DURABLE_STATE",
					"A durable Harness store contained unfinished continuation state; the session was destroyed and the checkpoint was deleted.",
				);
			}

			stopInitialRenewing();
			removeInitialLeaseAbortListener();
			const activeTurn = this.activateTurn({
				lease,
				externalSignal: options.abortSignal,
				timeoutMs: Math.max(1, timeoutDeadline - Date.now()),
				timeoutError,
			});
			active = activeTurn;
			clearTimeout(initialTimeout);
			removeInitialAbortListener();

			const stream = await startAgentStream(
				options.agent,
				session,
				options.turn,
				activeTurn.controller.signal,
			);
			const completion = this.completeTurn({
				agent: options.agent,
				stream,
				session,
				lease,
				runningRecord,
				active: activeTurn,
				policy,
			});

			return {
				stream,
				completion,
				cancel: (reason?: unknown) => {
					if (activeTurn.controller.signal.aborted) return;
					activeTurn.completionKind = "disconnect";
					const error = new AiSdkHarnessDisconnectedError(options.key.sessionId, reason);
					activeTurn.primaryError = error;
					activeTurn.controller.abort(error);
				},
			};
		} catch (error) {
			clearTimeout(initialTimeout);
			removeInitialAbortListener();
			removeInitialLeaseAbortListener();
			const failureSignal = active?.controller.signal ?? initialController.signal;
			const kind = active?.completionKind ?? classifyAbort(failureSignal, error);
			let cleanupError: unknown;
			if (session !== undefined && lease !== undefined && runningRecord !== undefined) {
				if (active !== undefined) this.deactivateTurn(active, false);
				try {
					await this.finalizeAndRelease({
						agent: options.agent,
						session,
						lease,
						runningRecord,
						kind,
						policy,
						stopRenewing: active?.stopRenewing ?? stopInitialRenewing,
					});
				} catch (finalizationError) {
					cleanupError = finalizationError;
				}
				lease = undefined;
			}
			if (lease !== undefined) {
				const cleanupDeadline = Date.now() + this.cleanupTimeoutMs;
				const cleanupController = new AbortController();
				const cleanupTimer = setTimeout(
					() => cleanupController.abort(new Error("Harness setup cleanup deadline exceeded.")),
					this.cleanupTimeoutMs,
				);
				cleanupTimer.unref?.();
				try {
					if (runningRecord !== undefined) {
						try {
							await bounded(
								this.restoreAfterStartFailure(
									options.key,
									lease,
									runningRecord,
									previousRecord,
									cleanupController.signal,
								),
								remaining(cleanupDeadline),
								"start checkpoint recovery",
							);
						} catch (restoreError) {
							cleanupError = restoreError;
						}
					}
					stopInitialRenewing();
					try {
						await bounded(lease.release(), remaining(cleanupDeadline), "lease release");
					} catch (releaseError) {
						cleanupError =
							cleanupError === undefined
								? releaseError
								: new AggregateError(
										[cleanupError, releaseError],
										"Harness setup cleanup and lease release both failed.",
										{ cause: cleanupError },
									);
					}
				} finally {
					clearTimeout(cleanupTimer);
				}
			}
			const normalizedError = normalizeAbortError(options.key.sessionId, failureSignal, error);
			if (cleanupError !== undefined) {
				throw aggregateFailures(
					normalizedError,
					cleanupError,
					"Harness setup and cleanup both failed.",
				);
			}
			throw normalizedError;
		}
	}

	private activateTurn(input: {
		readonly lease: AiSdkHarnessSessionLease;
		readonly externalSignal?: AbortSignal;
		readonly timeoutMs: number;
		readonly timeoutError: AiSdkHarnessTimeoutError;
	}): ActiveTurn {
		const controller = new AbortController();
		const active: ActiveTurn = {
			controller,
			timeout: setTimeout(() => {
				active.completionKind = "timeout";
				active.primaryError = input.timeoutError;
				controller.abort(input.timeoutError);
			}, input.timeoutMs),
			removeExternalAbortListener: () => undefined,
			removeLeaseAbortListener: () => undefined,
			stopRenewing: () => undefined,
			completionKind: undefined,
			primaryError: undefined,
		};
		active.timeout.unref?.();
		active.removeExternalAbortListener = forwardAbort(input.externalSignal, controller, () => {
			active.completionKind = "disconnect";
			active.primaryError = new AiSdkHarnessDisconnectedError(
				input.lease.key.sessionId,
				input.externalSignal?.reason,
			);
			return active.primaryError;
		});
		active.removeLeaseAbortListener = forwardAbort(input.lease.signal, controller, () => {
			active.completionKind = "error";
			active.primaryError = new AiSdkHarnessLeaseLostError(input.lease.key.sessionId, {
				cause: input.lease.signal.reason,
			});
			return active.primaryError;
		});
		active.stopRenewing = startLeaseRenewal({
			lease: input.lease,
			ttlMs: this.leaseTtlMs,
			onError: (error) => {
				if (controller.signal.aborted) return;
				active.completionKind = "error";
				active.primaryError = new AiSdkHarnessLeaseLostError(input.lease.key.sessionId, {
					cause: error,
				});
				controller.abort(active.primaryError);
			},
		});
		return active;
	}

	private async completeTurn(input: {
		readonly agent: HarnessAgent;
		readonly stream: AiSdkHarnessStreamResult;
		readonly session: HarnessAgentSession;
		readonly lease: AiSdkHarnessSessionLease;
		readonly runningRecord: AiSdkHarnessSessionRecord;
		readonly active: ActiveTurn;
		readonly policy: AiSdkHarnessFinalizationPolicy;
	}): Promise<AiSdkHarnessRunOutcome> {
		let kind: AiSdkHarnessCompletionKind = "success";
		let primaryError: unknown;
		try {
			const finishReason = await raceWithAbort(
				input.stream.finishReason,
				input.active.controller.signal,
			);
			if (finishReason === "error") {
				kind = "error";
				primaryError = new AiSdkHarnessTurnFailedError(input.lease.key.sessionId);
			}
		} catch (error) {
			kind = input.active.completionKind ?? classifyAbort(input.active.controller.signal, error);
			primaryError = input.active.primaryError ?? error;
		}

		this.deactivateTurn(input.active, false);
		let outcome: AiSdkHarnessRunOutcome;
		try {
			outcome = await this.finalizeAndRelease({
				agent: input.agent,
				session: input.session,
				lease: input.lease,
				runningRecord: input.runningRecord,
				kind,
				policy: input.policy,
				stopRenewing: input.active.stopRenewing,
			});
		} catch (finalizationError) {
			if (primaryError !== undefined) {
				throw aggregateFailures(
					primaryError,
					finalizationError,
					"Harness turn and finalization both failed.",
				);
			}
			throw finalizationError;
		}
		if (primaryError !== undefined) throw primaryError;
		return outcome;
	}

	private async finalizeAndRelease(input: FinalizeInput): Promise<AiSdkHarnessRunOutcome> {
		const deadline = Date.now() + this.cleanupTimeoutMs;
		const cleanupController = new AbortController();
		const cleanupTimer = setTimeout(
			() => cleanupController.abort(new Error("Harness cleanup deadline exceeded.")),
			this.cleanupTimeoutMs,
		);
		cleanupTimer.unref?.();
		let primaryError: unknown;
		let outcome: AiSdkHarnessRunOutcome | undefined;
		try {
			const unfinished = input.session.hasUnfinishedTurn();
			const requestedAction = input.policy[input.kind];
			const action =
				this.sessionStore.durability === "durable" && (input.kind !== "success" || unfinished)
					? "destroy"
					: requestedAction;
			outcome = await this.applyFinalization({
				agent: input.agent,
				session: input.session,
				lease: input.lease,
				runningRecord: input.runningRecord,
				kind: input.kind,
				action,
				deadline,
				abortSignal: cleanupController.signal,
			});
		} catch (error) {
			primaryError = error;
			if (!(error instanceof AiSdkHarnessError && error.code === "UNSAFE_DURABLE_STATE")) {
				try {
					await bounded(
						this.markRecoveryRequired(input, cleanupController.signal),
						remaining(deadline),
						"recovery marker",
					);
				} catch (recoveryError) {
					primaryError = aggregateFailures(
						error,
						recoveryError,
						"Harness finalization and recovery marking both failed.",
					);
				}
			}
		} finally {
			input.stopRenewing?.();
			try {
				await bounded(input.lease.release(), remaining(deadline), "lease release");
			} catch (releaseError) {
				primaryError =
					primaryError === undefined
						? releaseError
						: new AggregateError(
								[primaryError, releaseError],
								"Harness cleanup and lease release both failed.",
								{ cause: primaryError },
							);
			}
			clearTimeout(cleanupTimer);
		}
		if (primaryError !== undefined) throw primaryError;
		if (outcome === undefined) {
			throw new AiSdkHarnessError(
				"FINALIZATION_FAILED",
				"Harness finalization produced no outcome.",
			);
		}
		return outcome;
	}

	private async applyFinalization(input: {
		readonly agent: HarnessAgent;
		readonly session: HarnessAgentSession;
		readonly lease: AiSdkHarnessSessionLease;
		readonly runningRecord: AiSdkHarnessSessionRecord;
		readonly kind: AiSdkHarnessCompletionKind;
		readonly action: AiSdkHarnessFinalizationAction;
		readonly deadline: number;
		readonly abortSignal: AbortSignal;
	}): Promise<AiSdkHarnessRunOutcome> {
		if (input.action === "destroy") {
			await bounded(input.session.destroy(), remaining(input.deadline), "session destroy");
			await bounded(
				this.sessionStore.delete(
					input.lease.key,
					input.runningRecord.revision,
					input.lease.fencingToken,
					{ abortSignal: input.abortSignal },
				),
				remaining(input.deadline),
				"checkpoint delete",
			);
			return { kind: input.kind, action: input.action };
		}

		const resumeState = await bounded(
			input.action === "stop" ? input.session.stop() : input.session.detach(),
			remaining(input.deadline),
			`session ${input.action}`,
		);
		if (this.sessionStore.durability === "durable" && resumeState.continueFrom !== undefined) {
			const destructiveSession = await bounded(
				input.agent.createSession({
					sessionId: input.lease.key.sessionId,
					resumeFrom: resumeState,
					abortSignal: input.abortSignal,
				}),
				remaining(input.deadline),
				"unsafe durable session resume",
			);
			await bounded(
				destructiveSession.destroy(),
				remaining(input.deadline),
				"unsafe durable session destroy",
			);
			await bounded(
				this.sessionStore.delete(
					input.lease.key,
					input.runningRecord.revision,
					input.lease.fencingToken,
					{ abortSignal: input.abortSignal },
				),
				remaining(input.deadline),
				"unsafe checkpoint delete",
			);
			throw new AiSdkHarnessError(
				"UNSAFE_DURABLE_STATE",
				"A durable Harness store cannot persist unfinished continuation state.",
			);
		}

		const checkpoint: AiSdkHarnessCheckpoint =
			resumeState.continueFrom === undefined
				? { kind: "resume", state: resumeState }
				: { kind: "continue", state: resumeState.continueFrom };
		const next: AiSdkHarnessSessionState =
			checkpoint.kind === "resume"
				? { status: "ready", checkpoint }
				: { status: "continuable", checkpoint };
		await bounded(
			this.sessionStore.compareAndSwap(
				input.lease.key,
				input.runningRecord.revision,
				next,
				input.lease.fencingToken,
				{ abortSignal: input.abortSignal },
			),
			remaining(input.deadline),
			"checkpoint commit",
		);
		return { kind: input.kind, action: input.action, checkpoint };
	}

	private async resolveLoadState(
		sessionId: string,
		record: AiSdkHarnessSessionRecord | undefined,
		lease: AiSdkHarnessSessionLease,
		abortSignal: AbortSignal,
	): Promise<AiSdkHarnessSessionRecord | undefined> {
		if (record?.state.status === "running") {
			const reason = `operation ${record.state.operationId} did not finalize`;
			const recovered = await this.sessionStore.compareAndSwap(
				lease.key,
				record.revision,
				{
					status: "recovery-required",
					reason,
				},
				lease.fencingToken,
				{ abortSignal },
			);
			throw new AiSdkHarnessRecoveryRequiredError(
				sessionId,
				recovered.state.status === "recovery-required" ? recovered.state.reason : reason,
			);
		}
		if (record?.state.status === "recovery-required") {
			throw new AiSdkHarnessRecoveryRequiredError(sessionId, record.state.reason);
		}
		return record;
	}

	private async restoreAfterStartFailure(
		key: AiSdkHarnessSessionLease["key"],
		lease: AiSdkHarnessSessionLease,
		runningRecord: AiSdkHarnessSessionRecord,
		previousRecord: AiSdkHarnessSessionRecord | undefined,
		abortSignal: AbortSignal,
	): Promise<void> {
		if (this.sessionStore.durability === "durable") {
			await this.sessionStore.compareAndSwap(
				key,
				runningRecord.revision,
				{
					status: "recovery-required",
					reason: START_RECOVERY_REASON,
				},
				lease.fencingToken,
				{ abortSignal },
			);
			return;
		}
		if (previousRecord === undefined) {
			await this.sessionStore.delete(key, runningRecord.revision, lease.fencingToken, {
				abortSignal,
			});
			return;
		}
		await this.sessionStore.compareAndSwap(
			key,
			runningRecord.revision,
			previousRecord.state,
			lease.fencingToken,
			{ abortSignal },
		);
	}

	private async markRecoveryRequired(
		input: FinalizeInput,
		abortSignal: AbortSignal,
	): Promise<void> {
		const recoveryState = {
			status: "recovery-required",
			reason: FINALIZATION_RECOVERY_REASON,
		} as const;
		try {
			await this.sessionStore.compareAndSwap(
				input.lease.key,
				input.runningRecord.revision,
				recoveryState,
				input.lease.fencingToken,
				{ abortSignal },
			);
			return;
		} catch (markerError) {
			let observed: AiSdkHarnessSessionRecord | undefined;
			try {
				observed = await this.sessionStore.load(input.lease.key, { abortSignal });
			} catch (loadError) {
				throw aggregateFailures(
					markerError,
					loadError,
					"Harness recovery marking and reconciliation load both failed.",
				);
			}

			// A delete or recovery CAS may have committed before its transport
			// reported failure. Both observed states are already fail-closed.
			if (observed === undefined || observed.state.status === "recovery-required") return;
			if (observed.fencingToken !== input.lease.fencingToken) throw markerError;

			// A final checkpoint CAS may likewise have committed and then thrown.
			// Re-CAS that same fenced revision to recovery-required so the caller's
			// failed operation can never be mistaken for a clean prompt boundary.
			await this.sessionStore.compareAndSwap(
				input.lease.key,
				observed.revision,
				recoveryState,
				input.lease.fencingToken,
				{ abortSignal },
			);
		}
	}

	private deactivateTurn(active: ActiveTurn, stopRenewing = true): void {
		clearTimeout(active.timeout);
		active.removeExternalAbortListener();
		active.removeLeaseAbortListener();
		if (stopRenewing) active.stopRenewing();
	}

	private assertPolicyAllowed(policy: AiSdkHarnessFinalizationPolicy): void {
		if (this.sessionStore.durability === "durable" && Object.values(policy).includes("detach")) {
			throw new AiSdkHarnessError(
				"UNSAFE_DURABLE_STATE",
				"Durable Harness stores reject detach finalization because continuation state can contain bridge credentials.",
			);
		}
	}
}

async function startAgentStream<AGENT extends HarnessAgent>(
	agent: AGENT,
	session: HarnessAgentSession,
	turn: AiSdkHarnessStreamOptions["turn"],
	abortSignal: AbortSignal,
): Promise<AiSdkHarnessStreamResult<AGENT>> {
	// The upstream base HarnessAgent method erases the concrete agent's generic
	// StreamTextResult. Both branches preserve it at runtime, so this assertion
	// restores the caller's AGENT-specific result without widening the public API.
	if (turn.kind === "prompt") {
		return agent.stream({ messages: [...turn.messages], session, abortSignal }) as Promise<
			AiSdkHarnessStreamResult<AGENT>
		>;
	}
	const messages = turn.messages ?? [];
	return agent.continueStream({
		session,
		toolApprovalContinuations: collectHarnessAgentToolApprovalContinuations({ messages }),
		toolResultContinuations: collectHarnessAgentToolResultContinuations({ messages }),
		abortSignal,
	}) as Promise<AiSdkHarnessStreamResult<AGENT>>;
}

function validateTurn(
	sessionId: string,
	kind: AiSdkHarnessStreamOptions["turn"]["kind"],
	state: AiSdkHarnessSessionState | undefined,
): void {
	if (kind === "prompt" && state?.status === "continuable") {
		throw new AiSdkHarnessInvalidTurnError(
			sessionId,
			"has an unfinished turn; an explicit continuation is required.",
		);
	}
	if (kind === "continue" && state?.status !== "continuable") {
		throw new AiSdkHarnessInvalidTurnError(sessionId, "has no unfinished turn to continue.");
	}
}

function checkpointFromRecord(
	record: AiSdkHarnessSessionRecord | undefined,
): AiSdkHarnessCheckpoint | undefined {
	return record?.state.status === "ready" || record?.state.status === "continuable"
		? record.state.checkpoint
		: undefined;
}

function hasUnfinishedCheckpoint(state: AiSdkHarnessSessionState | undefined): boolean {
	return (
		state?.status === "continuable" ||
		(state?.status === "ready" && state.checkpoint.state.continueFrom !== undefined)
	);
}

function assertSessionKey(key: AiSdkHarnessSessionLease["key"]): void {
	for (const [name, value] of Object.entries(key)) {
		if (value.trim().length === 0) {
			throw new TypeError(`AI SDK Harness session key ${name} must not be empty.`);
		}
	}
}

function positiveDuration(value: number | undefined, fallback: number, name: string): number {
	const resolved = value ?? fallback;
	if (!Number.isFinite(resolved) || resolved <= 0) {
		throw new RangeError(`${name} must be a positive finite number.`);
	}
	return resolved;
}

function forwardAbort(
	source: AbortSignal | undefined,
	target: AbortController,
	reasonFactory?: () => unknown,
): () => void {
	if (source === undefined) return () => undefined;
	const abort = () => target.abort(reasonFactory?.() ?? source.reason);
	if (source.aborted) {
		abort();
		return () => undefined;
	}
	source.addEventListener("abort", abort, { once: true });
	return () => source.removeEventListener("abort", abort);
}

function startLeaseRenewal(input: {
	readonly lease: AiSdkHarnessSessionLease;
	readonly ttlMs: number;
	readonly onError: (error: unknown) => void;
}): () => void {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const schedule = () => {
		timer = setTimeout(
			async () => {
				if (stopped) return;
				try {
					await input.lease.renew({ ttlMs: input.ttlMs });
					if (!stopped) schedule();
				} catch (error) {
					input.onError(error);
				}
			},
			Math.max(1, Math.floor(input.ttlMs / 2)),
		);
		timer.unref?.();
	};
	schedule();
	return () => {
		stopped = true;
		if (timer !== undefined) clearTimeout(timer);
	};
}

async function raceWithAbort<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) throw signal.reason;
	let abort = noop;
	const aborted = new Promise<never>((_resolve, reject) => {
		abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
	});
	try {
		return await Promise.race([Promise.resolve(operation), aborted]);
	} finally {
		signal.removeEventListener("abort", abort);
	}
}

function classifyAbort(signal: AbortSignal, error: unknown): AiSdkHarnessCompletionKind {
	const reason = signal.reason;
	if (reason instanceof AiSdkHarnessTimeoutError) return "timeout";
	if (reason instanceof AiSdkHarnessDisconnectedError) return "disconnect";
	return error instanceof AiSdkHarnessTimeoutError ? "timeout" : "error";
}

function normalizeAbortError(sessionId: string, signal: AbortSignal, error: unknown): unknown {
	if (!signal.aborted) return error;
	if (signal.reason instanceof Error) return signal.reason;
	return new AiSdkHarnessDisconnectedError(sessionId, signal.reason);
}

function remaining(deadline: number): number {
	return Math.max(1, deadline - Date.now());
}

function bounded<T>(promise: PromiseLike<T>, timeoutMs: number, operation: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(
				new AiSdkHarnessError(
					"FINALIZATION_FAILED",
					`Timed out while waiting for Harness ${operation}.`,
				),
			);
		}, timeoutMs);
		timer.unref?.();
		Promise.resolve(promise).then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

function aggregateFailures(primary: unknown, cleanup: unknown, message: string): AggregateError {
	return new AggregateError([primary, cleanup], message, { cause: primary });
}
