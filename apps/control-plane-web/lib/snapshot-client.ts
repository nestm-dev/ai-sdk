import type { AiObservabilitySnapshotV1 } from "@nestm/ai-sdk/observability/core";

import { parseAiObservabilitySnapshot } from "@/lib/snapshot-schema";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface DashboardCapture {
	readonly snapshot: AiObservabilitySnapshotV1;
	readonly source: "demo" | "live";
	readonly receivedAt: number;
}

export interface AiObservabilityDashboardDataSource {
	snapshot(signal?: AbortSignal): Promise<DashboardCapture>;
}

export class SnapshotClientError extends Error {
	constructor(readonly code: "unavailable" | "invalid" | "stale") {
		super(
			code === "invalid"
				? "The source returned an unsupported observability snapshot."
				: code === "stale"
					? "The source returned an older process snapshot."
					: "The observability source is temporarily unavailable.",
		);
		this.name = "SnapshotClientError";
	}
}

export class HttpAiObservabilityDashboardDataSource implements AiObservabilityDashboardDataSource {
	#lastAccepted: AiObservabilitySnapshotV1 | undefined;

	constructor(private readonly endpoint = "/api/snapshot") {}

	async snapshot(signal?: AbortSignal): Promise<DashboardCapture> {
		let response: Response;
		try {
			response = await fetch(this.endpoint, {
				cache: "no-store",
				headers: { accept: "application/json" },
				signal,
			});
		} catch (error) {
			if (isAbortError(error)) throw error;
			throw new SnapshotClientError("unavailable");
		}

		if (!response.ok) throw new SnapshotClientError("unavailable");

		const body = await readBoundedBody(response);
		let snapshot: AiObservabilitySnapshotV1;
		try {
			snapshot = parseAiObservabilitySnapshot(JSON.parse(body));
		} catch {
			throw new SnapshotClientError("invalid");
		}

		if (
			this.#lastAccepted?.startedAt === snapshot.startedAt &&
			snapshot.revision < this.#lastAccepted.revision
		) {
			throw new SnapshotClientError("stale");
		}
		this.#lastAccepted = snapshot;

		return {
			snapshot,
			source: response.headers.get("x-ai-observability-source") === "live" ? "live" : "demo",
			receivedAt: Date.now(),
		};
	}
}

async function readBoundedBody(response: Response): Promise<string> {
	const declaredLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
		throw new SnapshotClientError("invalid");
	}
	const body = await response.text();
	if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
		throw new SnapshotClientError("invalid");
	}
	return body;
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

export const dashboardDataSource = new HttpAiObservabilityDashboardDataSource();
