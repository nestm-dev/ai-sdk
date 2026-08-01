import { customProvider, createProviderRegistry, Output, tool, ToolLoopAgent } from "ai";
import type { InferAgentUIMessage, ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import {
	type AiSdkNamedAgentDefinition,
	type AiSdkAgent,
	AiSdkService,
	type AiSdkToolLoopAgentSettings,
	AiTool,
	defineAiSdkConfig,
} from "../../src/index.ts";

const languageModel = new MockLanguageModelV4();
const provider = customProvider({ languageModels: { chat: languageModel } });
const registry = createProviderRegistry({ local: provider }, { separator: "/" });
const config = defineAiSdkConfig({
	registry,
	defaults: { language: "local/chat" },
});
void config;

defineAiSdkConfig({
	// @ts-expect-error invalid default prevents the prebuilt registry overload from matching
	registry,
	defaults: { language: "local:chat" },
});

defineAiSdkConfig({
	providers: { local: provider },
	registryOptions: { separator: "/" },
	defaults: { language: "local/chat" },
});

defineAiSdkConfig({
	providers: { local: provider },
	registryOptions: { separator: "/" },
	defaults: {
		// @ts-expect-error the provider-map default must use its configured separator
		language: "local:chat",
	},
});

defineAiSdkConfig({
	providers: { local: provider },
	defaults: {
		// @ts-expect-error defaults cannot name a provider absent from the provider map
		language: "missing:chat",
	},
});

declare const service: AiSdkService<typeof registry>;
service.languageModel("local/chat");
// @ts-expect-error the configured registry uses a slash separator
service.languageModel("local:chat");

const tools = {
	echo: tool({
		inputSchema: z.object({ value: z.string() }),
		execute: ({ value }) => ({ value }),
	}),
} satisfies ToolSet;
void tools;

const agent = new ToolLoopAgent({ model: languageModel, tools });
const agentDefinition: AiSdkNamedAgentDefinition = {
	name: "typed",
	useValue: agent,
};
void agentDefinition;

const structuredOutput = Output.object({
	schema: z.object({ answer: z.string() }),
});
const customAgentSettings = {
	model: languageModel,
	tools,
	output: structuredOutput,
	runtimeContext: { tenantId: "tenant" },
	callOptionsSchema: z.object({ tone: z.enum(["short", "long"]) }),
} satisfies AiSdkToolLoopAgentSettings<
	{ tone: "short" | "long" },
	typeof tools,
	{ tenantId: string },
	typeof structuredOutput
>;
const customAgent = new ToolLoopAgent(customAgentSettings);
const genericAgent: AiSdkAgent<
	{ tone: "short" | "long" },
	typeof tools,
	{ tenantId: string },
	typeof structuredOutput
> = customAgent;
const customAgentDefinition: AiSdkNamedAgentDefinition<typeof customAgent> = {
	name: "custom",
	useValue: customAgent,
};
const customSettingsDefinition: AiSdkNamedAgentDefinition<typeof customAgentSettings> = {
	name: "custom-settings",
	useValue: customAgentSettings,
};
const inlineSettingsDefinition: AiSdkNamedAgentDefinition = {
	name: "inline-settings",
	useValue: {
		model: languageModel,
		tools,
		output: structuredOutput,
		runtimeContext: { tenantId: "tenant" },
		callOptionsSchema: z.object({ tone: z.enum(["short", "long"]) }),
	},
};
const invalidAgentDefinition: AiSdkNamedAgentDefinition = {
	name: "invalid",
	// @ts-expect-error arbitrary objects are not agents or ToolLoopAgent settings
	useValue: { invalid: true },
};
type CustomAgentMessage = InferAgentUIMessage<typeof customAgent>;
declare const customAgentMessage: CustomAgentMessage;
void genericAgent;
void customAgentDefinition;
void customSettingsDefinition;
void inlineSettingsDefinition;
void invalidAgentDefinition;
void customAgentMessage;

class TypedToolset {
	@AiTool({
		inputSchema: z.object({ value: z.string() }),
		outputSchema: z.object({ length: z.number() }),
	})
	echo(input: { value: string }): { length: number } {
		return { length: input.value.length };
	}
}
void TypedToolset;

type Equal<LEFT, RIGHT> =
	(<TYPE>() => TYPE extends LEFT ? 1 : 2) extends <TYPE>() => TYPE extends RIGHT ? 1 : 2
		? true
		: false;
type Assert<TYPE extends true> = TYPE;
type AiSdkFacadeOperation =
	| "generateText"
	| "streamText"
	| "embed"
	| "embedMany"
	| "generateImage"
	| "rerank"
	| "generateSpeech"
	| "transcribe"
	| "uploadFile"
	| "uploadSkill"
	| "experimental_generateVideo"
	| "experimental_streamTranscribe"
	| "experimental_streamTranslate"
	| "registerTelemetry";
type ExactFacadeOperations = {
	[KEY in AiSdkFacadeOperation]: Equal<AiSdkService[KEY], (typeof import("ai"))[KEY]>;
};
type _FacadeOperationsAreExact = Assert<
	ExactFacadeOperations[AiSdkFacadeOperation] extends true ? true : false
>;
