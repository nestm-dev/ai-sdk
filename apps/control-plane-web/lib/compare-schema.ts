import { z } from "zod";

export const PROVIDER_IDS = ["openai", "anthropic", "google"] as const;
export const providerIdSchema = z.enum(PROVIDER_IDS);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const compareRequestSchema = z
	.object({
		prompt: z.string().trim().min(1).max(1_000),
		providers: z.array(providerIdSchema).min(1).max(3).optional(),
	})
	.strict()
	.superRefine((value, context) => {
		if (value.providers && new Set(value.providers).size !== value.providers.length) {
			context.addIssue({
				code: "custom",
				path: ["providers"],
				message: "Providers must be unique.",
			});
		}
	});

const safeCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const descriptionSchema = z
	.object({
		provider: providerIdSchema,
		model: z.string().min(1).max(128),
	})
	.strict();

const successSchema = descriptionSchema.extend({
	status: z.literal("success"),
	text: z.string().max(32_768),
	finishReason: z.string().min(1).max(64),
	latencyMs: safeCount,
	usage: z
		.object({
			inputTokens: safeCount.nullable(),
			outputTokens: safeCount.nullable(),
			totalTokens: safeCount.nullable(),
		})
		.strict(),
});

const failureSchema = descriptionSchema.extend({
	status: z.literal("error"),
	code: z.enum([
		"unauthorized",
		"rate_limited",
		"timeout_or_cancelled",
		"request_rejected",
		"provider_unavailable",
		"generation_failed",
	]),
	retryable: z.boolean(),
	latencyMs: safeCount,
});

export const comparisonSchema = z
	.object({
		runId: z.uuid(),
		startedAt: z.string().datetime({ offset: true }),
		results: z
			.array(z.discriminatedUnion("status", [successSchema, failureSchema]))
			.min(1)
			.max(3),
		summary: z.object({ requested: safeCount, succeeded: safeCount, failed: safeCount }).strict(),
	})
	.strict()
	.superRefine((comparison, context) => {
		const succeeded = comparison.results.filter((result) => result.status === "success").length;
		const providers = comparison.results.map((result) => result.provider);
		if (
			comparison.summary.requested !== comparison.results.length ||
			comparison.summary.succeeded !== succeeded ||
			comparison.summary.failed !== comparison.results.length - succeeded
		) {
			context.addIssue({
				code: "custom",
				path: ["summary"],
				message: "Summary does not match results.",
			});
		}
		if (new Set(providers).size !== providers.length) {
			context.addIssue({
				code: "custom",
				path: ["results"],
				message: "Result providers must be unique.",
			});
		}
	});

export type Comparison = z.infer<typeof comparisonSchema>;
