import { compareRequestSchema, comparisonSchema, PROVIDER_IDS } from "@/lib/compare-schema";
import { mutationRequestViolation } from "@/lib/chat-proxy";
import { localUpstreamEndpoint } from "@/lib/local-upstream";

export const dynamic = "force-dynamic";

const COMPARE_PATH = "/playground/v1/compare";
const UPSTREAM_TIMEOUT_MS = 60_000;
const MAX_REQUEST_BYTES = 4 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
	const violation = mutationRequestViolation(request, { jsonBody: true });
	if (violation === "origin") return safeError("REQUEST_ORIGIN_FORBIDDEN", 403);
	if (violation === "content-type") return safeError("REQUEST_CONTENT_TYPE_UNSUPPORTED", 415);

	const configuredBaseUrl = process.env.AI_OBSERVABILITY_API_URL?.trim();
	if (!configuredBaseUrl) return safeError("PLAYGROUND_NOT_CONNECTED", 503);

	const parsedRequest = compareRequestSchema.safeParse(await readBoundedRequestJson(request));
	if (!parsedRequest.success) return safeError("REQUEST_INVALID", 400);

	let endpoint: URL;
	try {
		endpoint = localUpstreamEndpoint(configuredBaseUrl, COMPARE_PATH);
	} catch {
		return safeError("PLAYGROUND_CONFIGURATION_INVALID", 503);
	}

	try {
		const response = await fetch(endpoint, {
			method: "POST",
			cache: "no-store",
			headers: { accept: "application/json", "content-type": "application/json" },
			body: JSON.stringify(parsedRequest.data),
			signal: AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
		});
		if (!response.ok) {
			return safeError(
				response.status === 429 ? "COMPARISON_IN_PROGRESS" : "PLAYGROUND_UNAVAILABLE",
				response.status === 429 ? 429 : 502,
			);
		}

		const parsedResponse = comparisonSchema.safeParse(JSON.parse(await readBoundedBody(response)));
		const expectedProviders = parsedRequest.data.providers ?? PROVIDER_IDS;
		if (
			!parsedResponse.success ||
			!expectedProviders.every(
				(provider, index) => parsedResponse.data.results[index]?.provider === provider,
			)
		) {
			return safeError("PLAYGROUND_RESPONSE_INVALID", 502);
		}
		return Response.json(parsedResponse.data, {
			headers: { "cache-control": "no-store" },
		});
	} catch (error) {
		if (request.signal.aborted) throw error;
		return safeError(
			error instanceof SyntaxError || error instanceof InvalidComparisonError
				? "PLAYGROUND_RESPONSE_INVALID"
				: "PLAYGROUND_UNAVAILABLE",
			502,
		);
	}
}

async function readBoundedRequestJson(request: Request): Promise<unknown> {
	try {
		const declaredLength = Number(request.headers.get("content-length"));
		if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) return undefined;
		if (!request.body) return undefined;

		const reader = request.body.getReader();
		const chunks: Uint8Array[] = [];
		let totalBytes = 0;
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			totalBytes += chunk.value.byteLength;
			if (totalBytes > MAX_REQUEST_BYTES) {
				await reader.cancel();
				return undefined;
			}
			chunks.push(chunk.value);
		}

		const body = new Uint8Array(totalBytes);
		let offset = 0;
		for (const chunk of chunks) {
			body.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return JSON.parse(new TextDecoder().decode(body));
	} catch {
		return undefined;
	}
}

async function readBoundedBody(response: Response): Promise<string> {
	const declaredLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
		throw new InvalidComparisonError();
	}
	const body = await response.text();
	if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
		throw new InvalidComparisonError();
	}
	return body;
}

function safeError(code: string, status: number): Response {
	return Response.json(
		{ code, message: "The local model playground is temporarily unavailable." },
		{ status, headers: { "cache-control": "no-store" } },
	);
}

class InvalidComparisonError extends Error {}
