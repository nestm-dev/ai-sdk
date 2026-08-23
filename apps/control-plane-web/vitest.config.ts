import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./", import.meta.url)),
			"@nestm/ai-sdk/observability/core": fileURLToPath(
				new URL("../../src/observability/core/index.ts", import.meta.url),
			),
		},
	},
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./tests/setup.ts"],
	},
});
