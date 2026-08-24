import { z } from "zod";

const modelId = z
	.string()
	.trim()
	.min(1)
	.max(128)
	.regex(/^[A-Za-z0-9._:-]+$/u);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const dashboardOrigin = z
	.url()
	.refine(isLoopbackHttpOrigin, "must be a loopback HTTP origin")
	.transform((value) => new URL(value).origin);

const environmentSchema = z.object({
	OPENAI_API_KEY: z.string().trim().min(20),
	ANTHROPIC_API_KEY: z.string().trim().min(20),
	GOOGLE_GENERATIVE_AI_API_KEY: z.string().trim().min(20),
	OPENAI_MODEL: modelId.default("gpt-5-mini"),
	ANTHROPIC_MODEL: modelId.default("claude-haiku-4-5"),
	GOOGLE_MODEL: modelId.default("gemini-2.5-flash"),
	PORT: environmentInteger(3001, 1, 65_535),
	DASHBOARD_ORIGIN: dashboardOrigin.default("http://127.0.0.1:3000"),
	PROVIDER_TIMEOUT_MS: environmentInteger(45_000, 1_000, 120_000),
	MAX_OUTPUT_TOKENS: environmentInteger(160, 16, 1_024),
	CHAT_STATE_DIR: z.string().trim().min(1).max(1_024).default(".data"),
	CHAT_RUN_TIMEOUT_MS: environmentInteger(120_000, 5_000, 300_000),
	CHAT_REPLAY_MAX_BYTES: environmentInteger(4 * 1_024 * 1_024, 64 * 1_024, 16 * 1_024 * 1_024),
	CHAT_MAX_OUTPUT_TOKENS: environmentInteger(2_048, 64, 8_192),
});

export type PlaygroundEnvironment = z.infer<typeof environmentSchema>;

export function validateEnvironment(input: Record<string, unknown>): PlaygroundEnvironment {
	const parsed = environmentSchema.safeParse(input);
	if (parsed.success) return parsed.data;

	const fields = [
		...new Set(parsed.error.issues.map((issue) => String(issue.path.at(0) ?? "environment"))),
	].sort();
	throw new Error(`Invalid playground environment: ${fields.join(", ")}`);
}

function isLoopbackHttpOrigin(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			url.protocol === "http:" &&
			url.username === "" &&
			url.password === "" &&
			LOOPBACK_HOSTS.has(url.hostname) &&
			url.pathname === "/" &&
			url.search === "" &&
			url.hash === ""
		);
	} catch {
		return false;
	}
}

function environmentInteger(defaultValue: number, minimum: number, maximum: number) {
	return z
		.preprocess(
			(value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
			z.number().int().min(minimum).max(maximum),
		)
		.default(defaultValue);
}
