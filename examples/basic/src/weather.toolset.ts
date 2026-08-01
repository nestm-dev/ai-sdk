import { Injectable } from "@nestjs/common";
import { AiTool, AiToolset } from "@nestm/ai-sdk";
import { z } from "zod";

const weatherInputSchema = z.object({
	city: z.string().min(1),
});

type WeatherInput = z.infer<typeof weatherInputSchema>;

@AiToolset("weather")
@Injectable()
export class WeatherToolset {
	@AiTool<WeatherInput, { city: string; summary: string }>({
		description: "Return the example forecast for a city.",
		inputSchema: weatherInputSchema,
	})
	lookup(input: WeatherInput): { city: string; summary: string } {
		return {
			city: input.city,
			summary: "Sunny, supplied by an in-process example tool.",
		};
	}
}
