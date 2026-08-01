import {
	MockEmbeddingModelV4,
	MockImageModelV4,
	MockLanguageModelV4,
	MockRerankingModelV4,
	MockSpeechModelV4,
	MockTranscriptionModelV4,
	MockVideoModelV4,
	createMockAiProvider,
	createMockFilesApi,
	createMockSkillsApi,
} from "../../src/testing/index.js";
import { describe, expect, it } from "vitest";

describe("AI SDK testing helpers", () => {
	it("creates a provider with every V4 modality", () => {
		const provider = createMockAiProvider();

		expect(provider.languageModel("default")).toBeInstanceOf(MockLanguageModelV4);
		expect(provider.embeddingModel("default")).toBeInstanceOf(MockEmbeddingModelV4);
		expect(provider.imageModel("default")).toBeInstanceOf(MockImageModelV4);
		expect(provider.transcriptionModel("default")).toBeInstanceOf(MockTranscriptionModelV4);
		expect(provider.speechModel("default")).toBeInstanceOf(MockSpeechModelV4);
		expect(provider.rerankingModel("default")).toBeInstanceOf(MockRerankingModelV4);
		expect(provider.videoModel("default")).toBeInstanceOf(MockVideoModelV4);
		expect(provider.files().specificationVersion).toBe("v4");
		expect(provider.skills().specificationVersion).toBe("v4");
	});

	it("records file uploads and supplies deterministic defaults", async () => {
		const files = createMockFilesApi();
		const result = await files.uploadFile({
			data: { type: "text", text: "hello" },
			mediaType: "text/plain",
			filename: "hello.txt",
		});

		expect(files.uploadFileCalls).toHaveLength(1);
		expect(result).toMatchObject({
			providerReference: { "mock-provider": "file-1" },
			filename: "hello.txt",
			warnings: [],
		});
	});

	it("records skill uploads and supports custom results", async () => {
		const skills = createMockSkillsApi({
			uploadSkill: {
				providerReference: { custom: "skill-id" },
				name: "reviewer",
				warnings: [],
			},
		});
		const result = await skills.uploadSkill({
			files: [{ path: "SKILL.md", data: { type: "text", text: "Review code" } }],
		});

		expect(skills.uploadSkillCalls).toHaveLength(1);
		expect(result.name).toBe("reviewer");
	});

	it("accepts explicit model maps and upload interfaces", () => {
		const languageModel = new MockLanguageModelV4({ modelId: "chat" });
		const videoModel = new MockVideoModelV4({ modelId: "video" });
		const files = createMockFilesApi({ provider: "files" });
		const skills = createMockSkillsApi({ provider: "skills" });
		const provider = createMockAiProvider({
			languageModels: { chat: languageModel },
			videoModels: { video: videoModel },
			files,
			skills,
		});

		expect(provider.languageModel("chat")).toBe(languageModel);
		expect(provider.videoModel("video")).toBe(videoModel);
		expect(provider.files()).toBe(files);
		expect(provider.skills()).toBe(skills);
		expect(() => provider.videoModel("missing")).toThrow("No mock video model");
	});
});
