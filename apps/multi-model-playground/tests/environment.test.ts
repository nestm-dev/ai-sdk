import { describe, expect, it } from "vitest";

import { validateEnvironment } from "../src/config/environment.ts";

const validEnvironment = {
	OPENAI_API_KEY: "openai-key-with-enough-characters",
	ANTHROPIC_API_KEY: "anthropic-key-with-enough-characters",
	GOOGLE_GENERATIVE_AI_API_KEY: "google-key-with-enough-characters",
};

describe("playground environment", () => {
	it("validates secrets and applies bounded local defaults", () => {
		const environment = validateEnvironment(validEnvironment);

		expect(environment).toMatchObject({
			OPENAI_MODEL: "gpt-5-mini",
			ANTHROPIC_MODEL: "claude-haiku-4-5",
			GOOGLE_MODEL: "gemini-2.5-flash",
			PORT: 3001,
			DASHBOARD_ORIGIN: "http://127.0.0.1:3000",
			PROVIDER_TIMEOUT_MS: 45_000,
			MAX_OUTPUT_TOKENS: 160,
		});
	});

	it("coerces bounded numeric settings", () => {
		const environment = validateEnvironment({
			...validEnvironment,
			PORT: "3101",
			PROVIDER_TIMEOUT_MS: "12000",
			MAX_OUTPUT_TOKENS: "64",
		});

		expect(environment.PORT).toBe(3101);
		expect(environment.PROVIDER_TIMEOUT_MS).toBe(12_000);
		expect(environment.MAX_OUTPUT_TOKENS).toBe(64);
	});

	it("reports only invalid field names, never secret values", () => {
		const secretSentinel = "must-never-appear-in-errors";

		expect(() =>
			validateEnvironment({
				...validEnvironment,
				OPENAI_API_KEY: secretSentinel,
				PORT: "not-a-number",
			}),
		).toThrow("PORT");
		try {
			validateEnvironment({ ...validEnvironment, OPENAI_API_KEY: "short", PORT: "bad" });
		} catch (error: unknown) {
			expect(String(error)).not.toContain("short");
			expect(String(error)).not.toContain(secretSentinel);
		}
	});

	it("rejects non-loopback dashboard origins", () => {
		expect(() =>
			validateEnvironment({
				...validEnvironment,
				DASHBOARD_ORIGIN: "https://dashboard.example.test",
			}),
		).toThrow("DASHBOARD_ORIGIN");
	});
});
