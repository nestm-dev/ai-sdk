import { Test } from "@nestjs/testing";
import { AI_SDK_LANGUAGE_MODEL, getAiToolsetToken } from "../../src/ai-sdk.tokens.js";
import { AiSdkService } from "../../src/ai-sdk.service.js";
import {
	MockLanguageModelV4,
	createAiSdkTestingModule,
	overrideAiSdkLanguageModel,
	overrideAiSdkToolset,
} from "../../src/testing/index.js";
import { describe, expect, it } from "vitest";

describe("Nest testing overrides", () => {
	it("creates an isolated module with defaults for every modality", async () => {
		const module = await Test.createTestingModule({
			imports: [createAiSdkTestingModule()],
		}).compile();
		const service = module.get(AiSdkService);

		expect(service.languageModel()).toBeInstanceOf(MockLanguageModelV4);
		expect(service.embeddingModel().modelId).toBe("mock-model-id");
		expect(service.imageModel().modelId).toBe("mock-model-id");
		expect(service.transcriptionModel().modelId).toBe("mock-model-id");
		expect(service.speechModel().modelId).toBe("mock-model-id");
		expect(service.rerankingModel().modelId).toBe("mock-model-id");
		expect(service.videoModel().modelId).toBe("mock-model-id");
		expect(service.files().provider).toBe("mock-provider");
		expect(service.skills().provider).toBe("mock-provider");
		await module.close();
	});

	it("honors an override before resolving a missing provider default", async () => {
		const languageModel = new MockLanguageModelV4({ modelId: "chat" });
		const module = await Test.createTestingModule({
			imports: [
				createAiSdkTestingModule({
					providerName: "fixture",
					provider: { languageModels: { chat: languageModel } },
					defaults: { language: "fixture:chat" },
				}),
			],
		}).compile();

		expect(module.get(AiSdkService).languageModel()).toBe(languageModel);
		await module.close();
	});

	it("overrides a default model injection token", async () => {
		const initial = new MockLanguageModelV4({ modelId: "initial" });
		const replacement = new MockLanguageModelV4({ modelId: "replacement" });
		const builder = Test.createTestingModule({
			providers: [{ provide: AI_SDK_LANGUAGE_MODEL, useValue: initial }],
		});

		overrideAiSdkLanguageModel(builder, replacement);
		const module = await builder.compile();

		expect(module.get(AI_SDK_LANGUAGE_MODEL)).toBe(replacement);
		await module.close();
	});

	it("overrides a named toolset injection token", async () => {
		const token = getAiToolsetToken("support");
		const tools = {};
		const builder = Test.createTestingModule({
			providers: [{ provide: token, useValue: { old: true } }],
		});

		overrideAiSdkToolset(builder, "support", tools);
		const module = await builder.compile();

		expect(module.get(token)).toBe(tools);
		await module.close();
	});
});
