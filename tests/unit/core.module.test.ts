import { Injectable, Module, Scope } from "@nestjs/common";
import { ContextIdFactory } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import {
	customProvider,
	embed,
	embedMany,
	experimental_generateVideo,
	experimental_streamTranscribe,
	experimental_streamTranslate,
	generateImage,
	generateSpeech,
	generateText,
	registerTelemetry,
	rerank,
	streamText,
	tool,
	transcribe,
	uploadFile,
	uploadSkill,
} from "ai";
import type { ToolSet } from "ai";
import { MockLanguageModelV4, MockProviderV4 } from "ai/test";
import {
	MockEmbeddingModelV4,
	MockImageModelV4,
	MockRerankingModelV4,
	MockSpeechModelV4,
	MockTranscriptionModelV4,
	MockVideoModelV4,
} from "ai/test";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
	AiSdkModule,
	type AiSdkAgentInput,
	type AiSdkFiles,
	type AiSdkOptionsFactory,
	AiSdkService,
	type AiSdkSkills,
	type AiAgentFactory,
	type AiToolsetFactory,
	AiTool,
	AiToolset,
	getAiAgentToken,
	getAiToolsetToken,
	InjectAiLanguageModel,
} from "../../src/index.ts";

const fixtureFiles: AiSdkFiles = {
	specificationVersion: "v4",
	provider: "fixture",
	uploadFile: () => {
		throw new Error("not called");
	},
};

const fixtureSkills: AiSdkSkills = {
	specificationVersion: "v4",
	provider: "fixture",
	uploadSkill: () => {
		throw new Error("not called");
	},
};

const classConfiguredModel = new MockLanguageModelV4({ modelId: "class-configured" });
const existingConfiguredModel = new MockLanguageModelV4({ modelId: "existing-configured" });

@Injectable()
class ClassOptionsFactory implements AiSdkOptionsFactory {
	createAiSdkOptions() {
		return { defaults: { language: classConfiguredModel } } as const;
	}
}

@Injectable()
class ExistingOptionsFactory implements AiSdkOptionsFactory {
	createAiSdkOptions() {
		return { defaults: { language: existingConfiguredModel } } as const;
	}
}

@Module({ providers: [ExistingOptionsFactory], exports: [ExistingOptionsFactory] })
class ExistingOptionsModule {}

@Injectable()
class RequiresDefaultLanguageModel {
	constructor(@InjectAiLanguageModel() readonly model: unknown) {}
}

describe("AiSdkModule core registration", () => {
	it("supports zero-config registration and exposes every exact upstream operation", async () => {
		const testingModule = await Test.createTestingModule({
			imports: [AiSdkModule.forRoot()],
		}).compile();
		const service = testingModule.get(AiSdkService);
		expect({
			generateText: service.generateText,
			streamText: service.streamText,
			embed: service.embed,
			embedMany: service.embedMany,
			generateImage: service.generateImage,
			rerank: service.rerank,
			generateSpeech: service.generateSpeech,
			transcribe: service.transcribe,
			uploadFile: service.uploadFile,
			uploadSkill: service.uploadSkill,
			experimental_generateVideo: service.experimental_generateVideo,
			experimental_streamTranscribe: service.experimental_streamTranscribe,
			experimental_streamTranslate: service.experimental_streamTranslate,
			registerTelemetry: service.registerTelemetry,
		}).toEqual({
			generateText,
			streamText,
			embed,
			embedMany,
			generateImage,
			rerank,
			generateSpeech,
			transcribe,
			uploadFile,
			uploadSkill,
			experimental_generateVideo,
			experimental_streamTranscribe,
			experimental_streamTranslate,
			registerTelemetry,
		});
		expect(() => service.languageModel()).toThrowError(
			expect.objectContaining({
				code: "MISSING_DEFAULT",
				name: "AiSdkConfigurationError",
			}),
		);
		await testingModule.close();
	});

	it("fails only when an unconfigured default token is actually injected", async () => {
		await expect(
			Test.createTestingModule({
				imports: [AiSdkModule.forRoot()],
				providers: [RequiresDefaultLanguageModel],
			}).compile(),
		).rejects.toMatchObject({ code: "MISSING_DEFAULT" });
	});

	it("resolves all registry modalities, files, skills, middleware, and a custom separator", async () => {
		const models = {
			language: new MockLanguageModelV4({ modelId: "language" }),
			embedding: new MockEmbeddingModelV4({ modelId: "embedding" }),
			image: new MockImageModelV4({ modelId: "image" }),
			transcription: new MockTranscriptionModelV4({ modelId: "transcription" }),
			speech: new MockSpeechModelV4({ modelId: "speech" }),
			reranking: new MockRerankingModelV4({ modelId: "reranking" }),
			video: new MockVideoModelV4({ modelId: "video" }),
		};
		const provider = customProvider({
			languageModels: { language: models.language },
			embeddingModels: { embedding: models.embedding },
			imageModels: { image: models.image },
			transcriptionModels: { transcription: models.transcription },
			speechModels: { speech: models.speech },
			rerankingModels: { reranking: models.reranking },
			videoModels: { video: models.video },
			files: fixtureFiles,
			skills: fixtureSkills,
		});
		const testingModule = await Test.createTestingModule({
			imports: [
				AiSdkModule.forRoot({
					providers: { fixture: provider },
					registryOptions: {
						separator: "/",
						languageModelMiddleware: {
							specificationVersion: "v4",
							overrideModelId: () => "middleware-language",
						},
					},
					defaults: {
						language: "fixture/language",
						embedding: "fixture/embedding",
						image: "fixture/image",
						transcription: "fixture/transcription",
						speech: "fixture/speech",
						reranking: "fixture/reranking",
						video: "fixture/video",
						files: "fixture",
						skills: "fixture",
					},
				}),
			],
		}).compile();
		const service = testingModule.get(AiSdkService);

		expect(service.languageModel().modelId).toBe("middleware-language");
		expect(service.languageModel("fixture/language").modelId).toBe("middleware-language");
		expect(service.embeddingModel()).toBe(models.embedding);
		expect(service.embeddingModel("fixture/embedding")).toBe(models.embedding);
		expect(service.imageModel()).toBe(models.image);
		expect(service.imageModel("fixture/image")).toBe(models.image);
		expect(service.transcriptionModel()).toBe(models.transcription);
		expect(service.transcriptionModel("fixture/transcription")).toBe(models.transcription);
		expect(service.speechModel()).toBe(models.speech);
		expect(service.speechModel("fixture/speech")).toBe(models.speech);
		expect(service.rerankingModel()).toBe(models.reranking);
		expect(service.rerankingModel("fixture/reranking")).toBe(models.reranking);
		expect(service.videoModel()).toBe(models.video);
		expect(service.videoModel("fixture/video")).toBe(models.video);
		expect(service.files()).toBe(fixtureFiles);
		expect(service.files("fixture")).toBe(fixtureFiles);
		expect(service.skills()).toBe(fixtureSkills);
		expect(service.skills("fixture")).toBe(fixtureSkills);
		await testingModule.close();
	});

	it("creates a native registry and resolves defaults eagerly", async () => {
		const languageModel = new MockLanguageModelV4({ modelId: "chat" });
		const provider = customProvider({ languageModels: { chat: languageModel } });
		const testingModule = await Test.createTestingModule({
			imports: [
				AiSdkModule.forRoot({
					providers: { local: provider },
					registryOptions: { separator: "/" },
					defaults: { language: "local/chat" },
				}),
			],
		}).compile();

		const service = testingModule.get(AiSdkService);
		expect(service.languageModel()).toBe(languageModel);
		expect(service.languageModel("local/chat")).toBe(languageModel);
		expect(() => service.languageModel("missing/chat")).toThrowError(
			expect.objectContaining({
				code: "INVALID_REFERENCE",
				cause: expect.any(Error),
			}),
		);
		await testingModule.close();
	});

	it("accepts a prebuilt registry through async configuration", async () => {
		const model = new MockLanguageModelV4({ modelId: "chat" });
		const provider = customProvider({ languageModels: { chat: model } });
		const registry = (await import("ai")).createProviderRegistry({ local: provider });
		const testingModule = await Test.createTestingModule({
			imports: [
				AiSdkModule.forRootAsync({
					useFactory: () => ({
						registry,
						defaults: { language: "local:chat" },
					}),
				}),
			],
		}).compile();

		expect(testingModule.get(AiSdkService).languageModel()).toBe(model);
		await testingModule.close();
	});

	it("supports async useClass and useExisting option factories", async () => {
		const testingModule = await Test.createTestingModule({
			imports: [
				AiSdkModule.forRootAsync({ useClass: ClassOptionsFactory, isGlobal: false }),
				AiSdkModule.forRootAsync({
					imports: [ExistingOptionsModule],
					useExisting: ExistingOptionsFactory,
					isGlobal: false,
				}),
			],
		}).compile();

		const services = testingModule.get<AiSdkService>(AiSdkService, { each: true });
		expect(services.map((service) => service.languageModel())).toEqual(
			expect.arrayContaining([classConfiguredModel, existingConfiguredModel]),
		);
		await testingModule.close();
	});

	it("wraps invalid defaults as package configuration errors", async () => {
		const provider = new MockProviderV4();
		await expect(
			Test.createTestingModule({
				imports: [
					AiSdkModule.forRoot({
						providers: { local: provider },
						defaults: { language: "missing:chat" },
					}),
				],
			}).compile(),
		).rejects.toMatchObject({
			code: "INVALID_DEFAULT",
			name: "AiSdkConfigurationError",
		});
	});

	it("does not replace errors from upstream operations", async () => {
		const failure = new Error("upstream failure");
		const model = new MockLanguageModelV4({
			doGenerate: async () => {
				throw failure;
			},
		});
		const testingModule = await Test.createTestingModule({
			imports: [AiSdkModule.forRoot()],
		}).compile();

		await expect(
			testingModule.get(AiSdkService).generateText({ model, prompt: "hello" }),
		).rejects.toBe(failure);
		await testingModule.close();
	});
});

let requestSequence = 0;

@Injectable({ scope: Scope.REQUEST })
@AiToolset("calculator")
class CalculatorTools {
	private readonly requestId = ++requestSequence;

	@AiTool({
		description: "Adds two numbers",
		inputSchema: z.object({ left: z.number(), right: z.number() }),
	})
	add(input: { left: number; right: number }): { requestId: number; total: number } {
		return { requestId: this.requestId, total: input.left + input.right };
	}
}

function executeTool(tools: ToolSet, name: string, input: unknown): unknown {
	const execute: unknown = tools[name]?.execute;
	if (typeof execute !== "function") throw new Error(`Missing execute for ${name}`);
	return Reflect.apply(execute, undefined, [input, { toolCallId: "test", messages: [] }]);
}

function createEchoTools(prefix: string): ToolSet {
	return {
		echo: tool({
			inputSchema: z.object({ value: z.string() }),
			execute: ({ value }) => `${prefix}:${value}`,
		}),
	};
}

function createFixtureAgent(id: string) {
	return {
		version: "agent-v1" as const,
		id,
		tools: {},
		generate: () => Promise.reject(new Error("not called")),
		stream: () => Promise.reject(new Error("not called")),
	};
}

const FEATURE_PREFIX = Symbol("feature-prefix");
const EXISTING_TOOLSET_FACTORY = Symbol("existing-toolset-factory");
const EXISTING_AGENT_FACTORY = Symbol("existing-agent-factory");

@Injectable()
class ClassToolsetFactory implements AiToolsetFactory {
	createAiToolset(): ToolSet {
		return createEchoTools("class");
	}
}

@Injectable()
class ClassAgentFactory implements AiAgentFactory {
	createAiAgent() {
		return createFixtureAgent("class-agent");
	}
}

const existingToolsetFactory: AiToolsetFactory = {
	createAiToolset: () => createEchoTools("existing"),
};
const existingAgentFactory: AiAgentFactory = {
	createAiAgent: () => createFixtureAgent("existing-agent"),
};

@Module({
	providers: [
		{ provide: FEATURE_PREFIX, useValue: "factory" },
		{ provide: EXISTING_TOOLSET_FACTORY, useValue: existingToolsetFactory },
		{ provide: EXISTING_AGENT_FACTORY, useValue: existingAgentFactory },
	],
	exports: [FEATURE_PREFIX, EXISTING_TOOLSET_FACTORY, EXISTING_AGENT_FACTORY],
})
class FeatureSourcesModule {}

describe("AiSdkModule features", () => {
	it("rejects invalid named agent values before Nest bootstrap", () => {
		expect(() =>
			AiSdkModule.forFeature({
				agents: [
					{
						name: "invalid",
						useValue: {} as unknown as AiSdkAgentInput,
					},
				],
			}),
		).toThrowError(expect.objectContaining({ code: "INVALID_FEATURE" }));
	});

	it("builds decorated toolsets with bound, request-scoped methods", async () => {
		const testingModule = await Test.createTestingModule({
			imports: [AiSdkModule.forRoot(), AiSdkModule.forFeature({ toolsets: [CalculatorTools] })],
		}).compile();

		const first = await testingModule.resolve<ToolSet>(
			getAiToolsetToken("calculator"),
			ContextIdFactory.create(),
		);
		const second = await testingModule.resolve<ToolSet>(
			getAiToolsetToken("calculator"),
			ContextIdFactory.create(),
		);
		const firstResult = await executeTool(first, "add", { left: 2, right: 3 });
		const secondResult = await executeTool(second, "add", { left: 2, right: 3 });

		expect(firstResult).toMatchObject({ total: 5 });
		expect(secondResult).toMatchObject({ total: 5 });
		expect(firstResult).not.toEqual(secondResult);
		await testingModule.close();
	});

	it("registers direct toolsets and agents under named tokens", async () => {
		const directTools = {
			echo: tool({
				inputSchema: z.object({ value: z.string() }),
				execute: ({ value }) => value,
			}),
		} satisfies ToolSet;
		const agent = {
			version: "agent-v1" as const,
			id: "fixture",
			tools: {},
			generate: () => Promise.reject(new Error("not called")),
			stream: () => Promise.reject(new Error("not called")),
		};
		const testingModule = await Test.createTestingModule({
			imports: [
				AiSdkModule.forRoot(),
				AiSdkModule.forFeature({
					toolsets: [{ name: "direct", useValue: directTools }],
					agents: [{ name: "fixture", useValue: agent }],
				}),
			],
		}).compile();

		expect(testingModule.get(getAiToolsetToken("direct"))).toBe(directTools);
		expect(testingModule.get(getAiAgentToken("fixture"))).toBe(agent);
		await testingModule.close();
	});

	it("supports factory, class, and existing feature definitions", async () => {
		const factoryAgent = createFixtureAgent("factory-agent");
		const testingModule = await Test.createTestingModule({
			imports: [
				AiSdkModule.forRoot(),
				AiSdkModule.forFeatureAsync({
					imports: [FeatureSourcesModule],
					toolsets: [
						{
							name: "factory-tools",
							inject: [FEATURE_PREFIX],
							useFactory: (prefix: string) => createEchoTools(prefix),
						},
						{ name: "class-tools", useClass: ClassToolsetFactory },
						{ name: "existing-tools", useExisting: EXISTING_TOOLSET_FACTORY },
					],
					agents: [
						{
							name: "factory-agent",
							inject: [FEATURE_PREFIX],
							useFactory: () => factoryAgent,
						},
						{ name: "class-agent", useClass: ClassAgentFactory },
						{ name: "existing-agent", useExisting: EXISTING_AGENT_FACTORY },
					],
				}),
			],
		}).compile();

		expect(
			await executeTool(testingModule.get(getAiToolsetToken("factory-tools")), "echo", {
				value: "ok",
			}),
		).toBe("factory:ok");
		expect(
			await executeTool(testingModule.get(getAiToolsetToken("class-tools")), "echo", {
				value: "ok",
			}),
		).toBe("class:ok");
		expect(
			await executeTool(testingModule.get(getAiToolsetToken("existing-tools")), "echo", {
				value: "ok",
			}),
		).toBe("existing:ok");
		expect(testingModule.get(getAiAgentToken("factory-agent"))).toBe(factoryAgent);
		expect(testingModule.get(getAiAgentToken("class-agent"))).toMatchObject({
			id: "class-agent",
		});
		expect(testingModule.get(getAiAgentToken("existing-agent"))).toMatchObject({
			id: "existing-agent",
		});
		await testingModule.close();
	});

	it("forwards request scope and durable flags for named factories", async () => {
		let toolsetSequence = 0;
		let agentSequence = 0;
		const feature = AiSdkModule.forFeatureAsync({
			toolsets: [
				{
					name: "request-tools",
					scope: Scope.REQUEST,
					durable: true,
					useFactory: () => createEchoTools(`request-${++toolsetSequence}`),
				},
			],
			agents: [
				{
					name: "request-agent",
					scope: Scope.REQUEST,
					durable: true,
					useFactory: () => createFixtureAgent(`request-${++agentSequence}`),
				},
			],
		});
		expect(feature.providers).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					provide: getAiToolsetToken("request-tools"),
					scope: Scope.REQUEST,
					durable: true,
				}),
				expect.objectContaining({
					provide: getAiAgentToken("request-agent"),
					scope: Scope.REQUEST,
					durable: true,
				}),
			]),
		);

		const testingModule = await Test.createTestingModule({
			imports: [AiSdkModule.forRoot(), feature],
		}).compile();
		const firstContext = ContextIdFactory.create();
		const secondContext = ContextIdFactory.create();
		const firstTools = await testingModule.resolve<ToolSet>(
			getAiToolsetToken("request-tools"),
			firstContext,
		);
		const secondTools = await testingModule.resolve<ToolSet>(
			getAiToolsetToken("request-tools"),
			secondContext,
		);
		const firstAgent = await testingModule.resolve<ReturnType<typeof createFixtureAgent>>(
			getAiAgentToken("request-agent"),
			firstContext,
		);
		const secondAgent = await testingModule.resolve<ReturnType<typeof createFixtureAgent>>(
			getAiAgentToken("request-agent"),
			secondContext,
		);

		expect(await executeTool(firstTools, "echo", { value: "ok" })).toBe("request-1:ok");
		expect(await executeTool(secondTools, "echo", { value: "ok" })).toBe("request-2:ok");
		expect(firstAgent.id).toBe("request-1");
		expect(secondAgent.id).toBe("request-2");
		await testingModule.close();
	});

	it("rejects duplicate names without process-global state", async () => {
		const tools = {} satisfies ToolSet;
		expect(() =>
			AiSdkModule.forFeature({
				toolsets: [
					{ name: "duplicate", useValue: tools },
					{ name: "duplicate", useValue: tools },
				],
			}),
		).toThrowError(expect.objectContaining({ code: "DUPLICATE_FEATURE" }));

		const duplicateApp = await Test.createTestingModule({
			imports: [
				AiSdkModule.forRoot(),
				AiSdkModule.forFeature({
					toolsets: [{ name: "cross-module", useValue: tools }],
				}),
				AiSdkModule.forFeature({
					toolsets: [{ name: "cross-module", useValue: tools }],
				}),
			],
		}).compile();
		let duplicateError: unknown;
		try {
			await duplicateApp.init();
		} catch (error) {
			duplicateError = error;
		}
		expect(duplicateError).toMatchObject({ code: "DUPLICATE_FEATURE" });
		await duplicateApp.close().catch(() => undefined);

		@Module({
			imports: [
				AiSdkModule.forRoot(),
				AiSdkModule.forFeature({
					toolsets: [{ name: "isolated", useValue: tools }],
				}),
			],
		})
		class IsolatedApp {}
		const first = await Test.createTestingModule({ imports: [IsolatedApp] }).compile();
		const second = await Test.createTestingModule({ imports: [IsolatedApp] }).compile();
		await Promise.all([first.init(), second.init()]);
		await Promise.all([first.close(), second.close()]);
	});
});
