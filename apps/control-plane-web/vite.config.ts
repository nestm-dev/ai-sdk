import tailwindcss from "@tailwindcss/postcss";
import vinext from "vinext";
import { defineConfig } from "vite";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig({
	css: { postcss: { plugins: [tailwindcss()] } },
	// Vinext's SSR CJS transform cannot execute @vercel/oidc, which is reached
	// indirectly through the AI SDK gateway. Let Node load it natively instead.
	ssr: { external: ["@vercel/oidc"] },
	server: {
		host: "127.0.0.1",
		...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
	},
	plugins: [vinext()],
});
