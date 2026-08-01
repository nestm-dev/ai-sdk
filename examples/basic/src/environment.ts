import { z } from "zod";

const environmentSchema = z.object({
	AI_GATEWAY_API_KEY: z.string().min(1),
	PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(configuration: Record<string, unknown>): Environment {
	return environmentSchema.parse(configuration);
}
