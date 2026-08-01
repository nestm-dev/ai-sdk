import type { Tool } from "ai";
import { AiSdkConfigurationError } from "../ai-sdk.error.ts";
import { normalizeAiFeatureName } from "../ai-sdk.tokens.ts";

const AI_TOOLSET_METADATA = Symbol("@nestm/ai-sdk:toolset-metadata");
const AI_TOOL_METADATA = Symbol("@nestm/ai-sdk:tool-metadata");

type FunctionTool<INPUT, OUTPUT, CONTEXT> =
	Tool<INPUT, OUTPUT, CONTEXT> extends infer CANDIDATE
		? CANDIDATE extends { type?: undefined | "function" }
			? CANDIDATE
			: never
		: never;

/**
 * Every current non-deprecated function-tool option. Execution is supplied by
 * the decorated method; deprecated `title` and per-tool approval are omitted.
 */
export type AiToolOptions<
	INPUT = unknown,
	OUTPUT = unknown,
	CONTEXT = Record<string, unknown>,
> = Omit<FunctionTool<INPUT, OUTPUT, CONTEXT>, "execute" | "needsApproval" | "title">;

export interface AiToolMetadata {
	readonly propertyKey: string;
	readonly options: Readonly<Record<PropertyKey, unknown>>;
}

export function AiToolset(name: string): ClassDecorator {
	const normalizedName = normalizeAiFeatureName(name);
	return (target) => {
		Reflect.defineMetadata(AI_TOOLSET_METADATA, normalizedName, target);
	};
}

export function AiTool<INPUT = unknown, OUTPUT = unknown, CONTEXT = Record<string, unknown>>(
	options: AiToolOptions<INPUT, OUTPUT, CONTEXT>,
): MethodDecorator {
	return (target, propertyKey, descriptor) => {
		if (typeof propertyKey !== "string" || typeof descriptor?.value !== "function") {
			throw new AiSdkConfigurationError(
				"INVALID_FEATURE",
				"@AiTool() can only decorate named instance methods.",
			);
		}
		const current = readOwnToolMetadata(target);
		const withoutOverriddenMethod = current.filter(
			(metadata) => metadata.propertyKey !== propertyKey,
		);
		const metadata: AiToolMetadata = {
			propertyKey,
			options: options as Readonly<Record<PropertyKey, unknown>>,
		};
		Reflect.defineMetadata(AI_TOOL_METADATA, [...withoutOverriddenMethod, metadata], target);
	};
}

function readOwnToolMetadata(target: object): readonly AiToolMetadata[] {
	const metadata: unknown = Reflect.getOwnMetadata(AI_TOOL_METADATA, target);
	return Array.isArray(metadata) ? (metadata as readonly AiToolMetadata[]) : [];
}

export function getAiToolsetName(target: object): string | undefined {
	const metadata: unknown = Reflect.getMetadata(AI_TOOLSET_METADATA, target);
	return typeof metadata === "string" ? metadata : undefined;
}

export function getAiToolMetadata(instance: object): readonly AiToolMetadata[] {
	const prototypes: object[] = [];
	let prototype = Object.getPrototypeOf(instance) as object | null;
	while (prototype !== null && prototype !== Object.prototype) {
		prototypes.unshift(prototype);
		prototype = Object.getPrototypeOf(prototype) as object | null;
	}

	const tools = new Map<string, AiToolMetadata>();
	for (const current of prototypes) {
		for (const metadata of readOwnToolMetadata(current)) {
			tools.set(metadata.propertyKey, metadata);
		}
	}
	return [...tools.values()];
}
