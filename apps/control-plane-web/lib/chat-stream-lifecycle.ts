import { useEffect, useRef, useState } from "react";

type StopChatStream = () => Promise<void>;

type ChatRunClientStatus = "error" | "ready" | "streaming" | "submitted";

export type DiscoveredChatRunAction = "record-local" | "resume" | "wait";

export function discoveredChatRunAction({
	activeRunId,
	clientStatus,
	generationRequested,
	initialRunId,
	lastResumeRunId,
	locallyConsumedRunIds,
}: Readonly<{
	activeRunId: string | undefined;
	clientStatus: ChatRunClientStatus;
	generationRequested: boolean;
	initialRunId: string | undefined;
	lastResumeRunId: string | undefined;
	locallyConsumedRunIds: ReadonlySet<string>;
}>): DiscoveredChatRunAction {
	if (activeRunId === undefined || activeRunId === initialRunId) return "wait";
	if (generationRequested || clientStatus === "submitted" || clientStatus === "streaming") {
		return "record-local";
	}
	if (lastResumeRunId === activeRunId) return "wait";
	if (locallyConsumedRunIds.has(activeRunId) && clientStatus !== "error") return "wait";
	return "resume";
}

/**
 * Detach the browser's HTTP subscriber when its chat route unmounts.
 * The backend owns a separate consumer, so this never cancels the durable run.
 */
export function useDetachChatStreamOnUnmount(stop: StopChatStream): void {
	const stopRef = useRef(stop);
	useEffect(() => {
		stopRef.current = stop;
	}, [stop]);
	useEffect(
		() => () => {
			void stopRef.current();
		},
		[],
	);
}

/** Freeze the authoritative run that useChat should reconnect to on this keyed mount. */
export function useInitialChatRunId(activeRunId: string | undefined): string | undefined {
	const [initialRunId] = useState(activeRunId);
	return initialRunId;
}
