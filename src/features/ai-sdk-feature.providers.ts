import type { DynamicModule, Provider, Type } from "@nestjs/common";
import { ToolLoopAgent } from "ai";
import type { Agent, ToolLoopAgentSettings, ToolSet } from "ai";
import { AiSdkConfigurationError } from "../ai-sdk.error.ts";
import { getAiAgentToken, getAiToolsetToken, normalizeAiFeatureName } from "../ai-sdk.tokens.ts";
import { getAiToolMetadata, getAiToolsetName } from "../decorators/ai-tool.decorator.ts";
import { createAiSdkFeatureMarker } from "./ai-sdk-feature-discovery.service.ts";
import type {
	AiAgentFactory,
	AiSdkFeatureOptions,
	AiSdkNamedAgentDefinition,
	AiSdkNamedToolsetDefinition,
	AiToolsetFactory,
} from "./ai-sdk-feature.types.ts";

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return typeof value === "object" && value !== null;
}

function isToolsetFactory(value: unknown): value is AiToolsetFactory {
	return isRecord(value) && typeof value.createAiToolset === "function";
}

function isAgentFactory(value: unknown): value is AiAgentFactory {
	return isRecord(value) && typeof value.createAiAgent === "function";
}

function isAgent(value: unknown): value is Agent {
	return (
		isRecord(value) &&
		value.version === "agent-v1" &&
		typeof value.generate === "function" &&
		typeof value.stream === "function"
	);
}

function normalizeToolset(value: unknown, name: string): ToolSet {
	if (!isRecord(value)) {
		throw new AiSdkConfigurationError(
			"INVALID_FEATURE",
			`AI SDK toolset "${name}" did not resolve to a ToolSet object.`,
		);
	}
	return value as ToolSet;
}

async function resolveToolsetSource(value: unknown, name: string): Promise<ToolSet> {
	const source = isToolsetFactory(value) ? await value.createAiToolset() : value;
	return normalizeToolset(source, name);
}

function normalizeAgent(value: unknown, name: string): Agent {
	if (isAgent(value)) return value;
	if (!isRecord(value) || !("model" in value)) {
		throw new AiSdkConfigurationError(
			"INVALID_FEATURE",
			`AI SDK agent "${name}" did not resolve to an Agent or ToolLoopAgent settings.`,
		);
	}
	try {
		return new ToolLoopAgent(
			value as ToolLoopAgentSettings<never, ToolSet, Record<string, unknown>>,
		);
	} catch (cause) {
		throw new AiSdkConfigurationError(
			"INVALID_FEATURE",
			`Unable to construct AI SDK agent "${name}" from its settings.`,
			{ cause },
		);
	}
}

async function resolveAgentSource(value: unknown, name: string): Promise<Agent> {
	const source = isAgentFactory(value) ? await value.createAiAgent() : value;
	return normalizeAgent(source, name);
}

function buildDecoratedToolset(instance: object, name: string): ToolSet {
	const result: Record<string, unknown> = {};
	for (const metadata of getAiToolMetadata(instance)) {
		const method: unknown = (instance as Record<string, unknown>)[metadata.propertyKey];
		if (typeof method !== "function") {
			throw new AiSdkConfigurationError(
				"INVALID_FEATURE",
				`@AiTool() member "${metadata.propertyKey}" on toolset "${name}" is not a method.`,
			);
		}
		result[metadata.propertyKey] = {
			...metadata.options,
			execute: method.bind(instance),
		};
	}
	if (Object.keys(result).length === 0) {
		throw new AiSdkConfigurationError(
			"INVALID_FEATURE",
			`@AiToolset("${name}") does not contain any @AiTool() methods.`,
		);
	}
	return result as ToolSet;
}

function featureMarkerProvider(kind: "agent" | "toolset", name: string): Provider {
	return {
		provide: Symbol(`@nestm/ai-sdk:${kind}-marker:${name}`),
		useValue: createAiSdkFeatureMarker(kind, name),
	};
}

function decoratedToolsetProviders(toolsetClass: Type<unknown>): Provider[] {
	const name = getAiToolsetName(toolsetClass);
	if (name === undefined) {
		throw new AiSdkConfigurationError(
			"INVALID_FEATURE",
			`AiSdkModule.forFeature received undecorated class "${toolsetClass.name}"; add @AiToolset(name).`,
		);
	}
	return [
		toolsetClass,
		{
			provide: getAiToolsetToken(name),
			inject: [toolsetClass],
			useFactory: (instance: object): ToolSet => buildDecoratedToolset(instance, name),
		},
		featureMarkerProvider("toolset", name),
	];
}

function namedToolsetProviders(definition: AiSdkNamedToolsetDefinition<ToolSet>): Provider[] {
	const name = normalizeAiFeatureName(definition.name);
	const token = getAiToolsetToken(name);
	if ("useValue" in definition) {
		return [
			{ provide: token, useValue: normalizeToolset(definition.useValue, name) },
			featureMarkerProvider("toolset", name),
		];
	}
	if ("useFactory" in definition) {
		const factory = definition.useFactory as (...dependencies: unknown[]) => unknown;
		return [
			{
				provide: token,
				inject: definition.inject ?? [],
				scope: definition.scope,
				durable: definition.durable,
				useFactory: async (...dependencies: unknown[]) =>
					resolveToolsetSource(await factory(...dependencies), name),
			},
			featureMarkerProvider("toolset", name),
		];
	}

	const sourceToken = Symbol(`@nestm/ai-sdk:toolset-source:${name}`);
	const sourceProvider: Provider =
		"useClass" in definition
			? { provide: sourceToken, useClass: definition.useClass }
			: { provide: sourceToken, useExisting: definition.useExisting };
	return [
		sourceProvider,
		{
			provide: token,
			inject: [sourceToken],
			useFactory: (source: unknown) => resolveToolsetSource(source, name),
		},
		featureMarkerProvider("toolset", name),
	];
}

function namedAgentProviders(definition: AiSdkNamedAgentDefinition): Provider[] {
	const name = normalizeAiFeatureName(definition.name);
	const token = getAiAgentToken(name);
	if ("useValue" in definition) {
		return [
			{ provide: token, useValue: normalizeAgent(definition.useValue, name) },
			featureMarkerProvider("agent", name),
		];
	}
	if ("useFactory" in definition) {
		const factory = definition.useFactory as (...dependencies: unknown[]) => unknown;
		return [
			{
				provide: token,
				inject: definition.inject ?? [],
				scope: definition.scope,
				durable: definition.durable,
				useFactory: async (...dependencies: unknown[]) =>
					resolveAgentSource(await factory(...dependencies), name),
			},
			featureMarkerProvider("agent", name),
		];
	}

	const sourceToken = Symbol(`@nestm/ai-sdk:agent-source:${name}`);
	const sourceProvider: Provider =
		"useClass" in definition
			? { provide: sourceToken, useClass: definition.useClass }
			: { provide: sourceToken, useExisting: definition.useExisting };
	return [
		sourceProvider,
		{
			provide: token,
			inject: [sourceToken],
			useFactory: (source: unknown) => resolveAgentSource(source, name),
		},
		featureMarkerProvider("agent", name),
	];
}

function isClass(value: unknown): value is Type<unknown> {
	return typeof value === "function";
}

function assertUniqueNames(toolsetNames: readonly string[], agentNames: readonly string[]): void {
	for (const [kind, names] of [
		["toolset", toolsetNames],
		["agent", agentNames],
	] as const) {
		const seen = new Set<string>();
		for (const name of names) {
			if (seen.has(name)) {
				throw new AiSdkConfigurationError(
					"DUPLICATE_FEATURE",
					`Duplicate AI SDK ${kind} name "${name}".`,
				);
			}
			seen.add(name);
		}
	}
}

export function createAiSdkFeatureModule(
	featureModule: Type<unknown>,
	options: AiSdkFeatureOptions,
): DynamicModule {
	const toolsets = options.toolsets ?? [];
	const agents = options.agents ?? [];
	const toolsetNames = toolsets.map((definition) =>
		isClass(definition)
			? (getAiToolsetName(definition) ?? definition.name)
			: normalizeAiFeatureName(definition.name),
	);
	const agentNames = agents.map((definition) => normalizeAiFeatureName(definition.name));
	assertUniqueNames(toolsetNames, agentNames);

	const providers = [
		...toolsets.flatMap((definition) =>
			isClass(definition)
				? decoratedToolsetProviders(definition)
				: namedToolsetProviders(definition),
		),
		...agents.flatMap(namedAgentProviders),
	];
	return {
		module: featureModule,
		imports: options.imports ?? [],
		providers,
		exports: [...toolsetNames.map(getAiToolsetToken), ...agentNames.map(getAiAgentToken)],
	};
}
