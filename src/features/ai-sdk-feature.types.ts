import type { FactoryProvider, InjectionToken, ModuleMetadata, Type } from "@nestjs/common";
import type { Agent, LanguageModel, Output, ToolLoopAgentSettings, ToolSet } from "ai";

export type AiSdkAgent<
	CALL_OPTIONS = never,
	TOOLS extends ToolSet = ToolSet,
	RUNTIME_CONTEXT extends Record<string, unknown> = Record<string, unknown>,
	OUTPUT extends Output.Output = never,
> = Agent<CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT, OUTPUT>;

export type AiSdkToolLoopAgentSettings<
	CALL_OPTIONS = never,
	TOOLS extends ToolSet = ToolSet,
	RUNTIME_CONTEXT extends Record<string, unknown> = Record<string, unknown>,
	OUTPUT extends Output.Output = never,
> = ToolLoopAgentSettings<CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT, OUTPUT>;

export type AiSdkAgentSource<
	CALL_OPTIONS = never,
	TOOLS extends ToolSet = ToolSet,
	RUNTIME_CONTEXT extends Record<string, unknown> = Record<string, unknown>,
	OUTPUT extends Output.Output = never,
> =
	| AiSdkAgent<CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT, OUTPUT>
	| AiSdkToolLoopAgentSettings<CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT, OUTPUT>;

/** Structural constraint accepting every upstream `Agent` generic instantiation. */
export interface AiSdkAgentContract {
	readonly version: "agent-v1";
	generate: (...arguments_: never[]) => PromiseLike<unknown>;
	stream: (...arguments_: never[]) => PromiseLike<unknown>;
}

/** Every valid named-agent source while preserving its concrete inferred type. */
export type AiSdkAgentInput =
	AiSdkAgentContract | ({ model: LanguageModel } & Record<string, unknown>);

export interface AiToolsetFactory<TOOLSET extends ToolSet = ToolSet> {
	createAiToolset(): TOOLSET | PromiseLike<TOOLSET>;
}

export interface AiAgentFactory<SOURCE extends AiSdkAgentInput = AiSdkAgentInput> {
	createAiAgent(): SOURCE | PromiseLike<SOURCE>;
}

interface NamedFeatureDefinition {
	name: string;
}

export interface AiToolsetValueDefinition<
	TOOLSET extends ToolSet = ToolSet,
> extends NamedFeatureDefinition {
	useValue: TOOLSET;
}

export interface AiToolsetFactoryDefinition<
	TOOLSET extends ToolSet = ToolSet,
> extends NamedFeatureDefinition {
	useFactory: (...dependencies: never[]) => TOOLSET | PromiseLike<TOOLSET>;
	inject?: FactoryProvider["inject"];
	scope?: FactoryProvider["scope"];
	durable?: FactoryProvider["durable"];
}

export interface AiToolsetClassDefinition<
	TOOLSET extends ToolSet = ToolSet,
> extends NamedFeatureDefinition {
	useClass: Type<AiToolsetFactory<TOOLSET>>;
}

export interface AiToolsetExistingDefinition<
	TOOLSET extends ToolSet = ToolSet,
> extends NamedFeatureDefinition {
	useExisting: InjectionToken<AiToolsetFactory<TOOLSET> | TOOLSET>;
}

export type AiSdkNamedToolsetDefinition<TOOLSET extends ToolSet = ToolSet> =
	| AiToolsetValueDefinition<TOOLSET>
	| AiToolsetFactoryDefinition<TOOLSET>
	| AiToolsetClassDefinition<TOOLSET>
	| AiToolsetExistingDefinition<TOOLSET>;

export interface AiAgentValueDefinition<
	SOURCE extends AiSdkAgentInput = AiSdkAgentInput,
> extends NamedFeatureDefinition {
	useValue: SOURCE;
}

export interface AiAgentFactoryDefinition<
	SOURCE extends AiSdkAgentInput = AiSdkAgentInput,
> extends NamedFeatureDefinition {
	useFactory: (...dependencies: never[]) => SOURCE | PromiseLike<SOURCE>;
	inject?: FactoryProvider["inject"];
	scope?: FactoryProvider["scope"];
	durable?: FactoryProvider["durable"];
}

export interface AiAgentClassDefinition<
	SOURCE extends AiSdkAgentInput = AiSdkAgentInput,
> extends NamedFeatureDefinition {
	/** The class may itself implement `Agent`, or expose `createAiAgent()`. */
	useClass: Type<AiAgentFactory<SOURCE> | SOURCE>;
}

export interface AiAgentExistingDefinition<
	SOURCE extends AiSdkAgentInput = AiSdkAgentInput,
> extends NamedFeatureDefinition {
	useExisting: InjectionToken<AiAgentFactory<SOURCE> | SOURCE>;
}

export type AiSdkNamedAgentDefinition<SOURCE extends AiSdkAgentInput = AiSdkAgentInput> =
	| AiAgentValueDefinition<SOURCE>
	| AiAgentFactoryDefinition<SOURCE>
	| AiAgentClassDefinition<SOURCE>
	| AiAgentExistingDefinition<SOURCE>;

export interface AiSdkFeatureOptions {
	imports?: ModuleMetadata["imports"];
	toolsets?: readonly (Type<unknown> | AiSdkNamedToolsetDefinition<ToolSet>)[];
	agents?: readonly AiSdkNamedAgentDefinition[];
}

/** Async feature definitions use Nest `inject` arrays on individual factories. */
export type AiSdkFeatureAsyncOptions = AiSdkFeatureOptions;
