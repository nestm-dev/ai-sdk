import { createRequire } from "node:module";
import { AiSdkHarnessError } from "./ai-sdk-harness.errors.ts";

const SUPPORTED_AI_VERSION = "7.0.47";
const SUPPORTED_HARNESS_VERSION = "1.0.53";

export const AI_SDK_HARNESS_COMPATIBILITY = Object.freeze({
	ai: SUPPORTED_AI_VERSION,
	harness: SUPPORTED_HARNESS_VERSION,
});

interface PackageManifest {
	readonly version?: unknown;
	readonly dependencies?: unknown;
}

function packageManifest(name: string): PackageManifest {
	const require = createRequire(import.meta.url);
	const value: unknown = require(`${name}/package.json`);
	if (typeof value !== "object" || value === null) {
		throw new AiSdkHarnessError(
			"VERSION_MISMATCH",
			`Unable to inspect ${name}'s package manifest.`,
		);
	}
	return value;
}

function dependencyVersion(manifest: PackageManifest, name: string): string | undefined {
	const dependencies = manifest.dependencies;
	if (typeof dependencies !== "object" || dependencies === null || !(name in dependencies)) {
		return undefined;
	}
	const value = (dependencies as Record<string, unknown>)[name];
	return typeof value === "string" ? value : undefined;
}

export function assertAiSdkHarnessCompatibility(): void {
	const ai = packageManifest("ai");
	const harness = packageManifest("@ai-sdk/harness");
	const aiVersion = typeof ai.version === "string" ? ai.version : undefined;
	const harnessVersion = typeof harness.version === "string" ? harness.version : undefined;
	const harnessAiVersion = dependencyVersion(harness, "ai");

	if (
		aiVersion !== SUPPORTED_AI_VERSION ||
		harnessVersion !== SUPPORTED_HARNESS_VERSION ||
		harnessAiVersion !== SUPPORTED_AI_VERSION
	) {
		throw new AiSdkHarnessError(
			"VERSION_MISMATCH",
			`@nestm/ai-sdk/harness requires ai@${SUPPORTED_AI_VERSION} and @ai-sdk/harness@${SUPPORTED_HARNESS_VERSION}; received ai@${aiVersion ?? "unknown"}, @ai-sdk/harness@${harnessVersion ?? "unknown"}, and Harness expects ai@${harnessAiVersion ?? "unknown"}.`,
		);
	}
}
