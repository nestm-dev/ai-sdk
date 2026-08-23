import { createDemoSnapshot } from "@/lib/demo-snapshot";
import { localUpstreamEndpoint } from "@/lib/local-upstream";
import { aiObservabilitySnapshotSchema } from "@/lib/snapshot-schema";

export const dynamic = "force-dynamic";

const SNAPSHOT_PATH = "/ai-observability/v1/snapshot";
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export async function GET(request: Request): Promise<Response> {
	const configuredBaseUrl = process.env.AI_OBSERVABILITY_API_URL?.trim();
	if (!configuredBaseUrl) {
		return snapshotResponse(createDemoSnapshot(), "demo");
	}

	let endpoint: URL;
	try {
		endpoint = localUpstreamEndpoint(configuredBaseUrl, SNAPSHOT_PATH);
	} catch {
		return safeError("SOURCE_CONFIGURATION_INVALID", 503);
	}

	try {
		const bearerToken = process.env.AI_OBSERVABILITY_API_BEARER_TOKEN?.trim();
		const response = await fetch(endpoint, {
			cache: "no-store",
			headers: {
				accept: "application/json",
				...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
			},
			signal: AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
		});
		if (!response.ok) return safeError("SOURCE_UNAVAILABLE", 502);

		const parsed = aiObservabilitySnapshotSchema.safeParse(
			JSON.parse(await readBoundedBody(response)),
		);
		if (!parsed.success) return safeError("SOURCE_SCHEMA_INVALID", 502);
		return snapshotResponse(parsed.data, "live");
	} catch (error) {
		if (request.signal.aborted) throw error;
		return safeError(
			error instanceof SyntaxError || error instanceof InvalidSnapshotError
				? "SOURCE_SCHEMA_INVALID"
				: "SOURCE_UNAVAILABLE",
			502,
		);
	}
}

async function readBoundedBody(response: Response): Promise<string> {
	const declaredLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
		throw new InvalidSnapshotError();
	}
	const body = await response.text();
	if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
		throw new InvalidSnapshotError();
	}
	return body;
}

class InvalidSnapshotError extends Error {}

function snapshotResponse(snapshot: unknown, source: "demo" | "live"): Response {
	return Response.json(snapshot, {
		headers: {
			"cache-control": "no-store",
			"x-ai-observability-source": source,
		},
	});
}

function safeError(code: string, status: number): Response {
	return Response.json(
		{ code, message: "The observability snapshot is temporarily unavailable." },
		{ status, headers: { "cache-control": "no-store" } },
	);
}
