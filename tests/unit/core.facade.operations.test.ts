import { AiSdkService } from "../../src/index.ts";
import { createMockFilesApi, createMockSkillsApi } from "../../src/testing/mock-provider.ts";
import {
	Experimental_MockSpeechTranslationModelV4,
	MockEmbeddingModelV4,
	MockImageModelV4,
	MockLanguageModelV4,
	MockRerankingModelV4,
	MockSpeechModelV4,
	MockTranscriptionModelV4,
	MockVideoModelV4,
	simulateReadableStream,
} from "ai/test";
import { describe, expect, it } from "vitest";

type AwaitedReturn<FUNCTION extends (...arguments_: never[]) => unknown> = Awaited<
	ReturnType<FUNCTION>
>;

const languageUsage = {
	inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function audioInput(): ReadableStream<Uint8Array> {
	return simulateReadableStream({ chunks: [new Uint8Array([1, 2, 3])] });
}

describe("AiSdkService operation façade", () => {
	const service = new AiSdkService(undefined, {});

	it("executes generateText and streamText with V4 models", async () => {
		const generateResult = {
			content: [{ type: "text" as const, text: "generated" }],
			finishReason: { unified: "stop", raw: undefined },
			usage: languageUsage,
			warnings: [],
		} satisfies AwaitedReturn<MockLanguageModelV4["doGenerate"]>;
		type StreamResult = AwaitedReturn<MockLanguageModelV4["doStream"]>;
		type StreamPart = StreamResult["stream"] extends ReadableStream<infer PART> ? PART : never;
		const streamParts: StreamPart[] = [
			{ type: "stream-start", warnings: [] },
			{ type: "text-start", id: "text" },
			{ type: "text-delta", id: "text", delta: "streamed" },
			{ type: "text-end", id: "text" },
			{
				type: "finish",
				finishReason: { unified: "stop", raw: undefined },
				usage: languageUsage,
			},
		];
		const model = new MockLanguageModelV4({
			doGenerate: generateResult,
			doStream: { stream: simulateReadableStream({ chunks: streamParts }) },
		});

		const generated = await service.generateText({ model, prompt: "hello" });
		const streamed = service.streamText({ model, prompt: "hello" });

		expect(generated.text).toBe("generated");
		expect(await streamed.text).toBe("streamed");
	});

	it("executes embed, embedMany, and rerank with V4 models", async () => {
		const embeddingModel = new MockEmbeddingModelV4({
			maxEmbeddingsPerCall: 10,
			doEmbed: async ({ values }) => ({
				embeddings: values.map((_, index) => [index, index + 1]),
				usage: { tokens: values.length },
				warnings: [],
			}),
		});
		const rerankingModel = new MockRerankingModelV4({
			doRerank: async () => ({
				ranking: [
					{ index: 1, relevanceScore: 0.9 },
					{ index: 0, relevanceScore: 0.5 },
				],
				warnings: [],
			}),
		});

		const single = await service.embed({ model: embeddingModel, value: "one" });
		const many = await service.embedMany({
			model: embeddingModel,
			values: ["one", "two"],
		});
		const ranked = await service.rerank({
			model: rerankingModel,
			documents: ["first", "second"],
			query: "best",
		});

		expect(single.embedding).toEqual([0, 1]);
		expect(many.embeddings).toEqual([
			[0, 1],
			[1, 2],
		]);
		expect(ranked.rerankedDocuments).toEqual(["second", "first"]);
	});

	it("executes image, speech, transcription, and video generation with V4 models", async () => {
		const now = new Date("2026-01-01T00:00:00.000Z");
		const imageModel = new MockImageModelV4({
			doGenerate: async () => ({
				images: [new Uint8Array([1, 2])],
				warnings: [],
				response: { timestamp: now, modelId: "image", headers: undefined },
			}),
		});
		const speechModel = new MockSpeechModelV4({
			doGenerate: async () => ({
				audio: new Uint8Array([3, 4]),
				warnings: [],
				response: { timestamp: now, modelId: "speech" },
			}),
		});
		const transcriptionModel = new MockTranscriptionModelV4({
			doGenerate: async () => ({
				text: "transcribed",
				segments: [{ text: "transcribed", startSecond: 0, endSecond: 1 }],
				language: "en",
				durationInSeconds: 1,
				warnings: [],
				response: { timestamp: now, modelId: "transcription" },
			}),
		});
		const videoModel = new MockVideoModelV4({
			doGenerate: async () => ({
				videos: [{ type: "binary", data: new Uint8Array([5, 6]), mediaType: "video/mp4" }],
				warnings: [],
				response: { timestamp: now, modelId: "video", headers: undefined },
			}),
		});

		const image = await service.generateImage({ model: imageModel, prompt: "image" });
		const speech = await service.generateSpeech({ model: speechModel, text: "speech" });
		const transcription = await service.transcribe({
			model: transcriptionModel,
			audio: new Uint8Array([7]),
		});
		const video = await service.experimental_generateVideo({
			model: videoModel,
			prompt: "video",
		});

		expect(image.images).toHaveLength(1);
		expect(speech.audio.uint8Array).toEqual(new Uint8Array([3, 4]));
		expect(transcription.text).toBe("transcribed");
		expect(video.videos).toHaveLength(1);
	});

	it("executes streaming transcription/translation and file/skill uploads", async () => {
		type TranscriptionStreamResult = AwaitedReturn<
			NonNullable<MockTranscriptionModelV4["doStream"]>
		>;
		type TranscriptionPart =
			TranscriptionStreamResult["stream"] extends ReadableStream<infer PART> ? PART : never;
		const transcriptionParts: TranscriptionPart[] = [
			{ type: "stream-start", warnings: [] },
			{ type: "transcript-delta", delta: "live" },
			{
				type: "finish",
				text: "live transcript",
				segments: [{ text: "live transcript", startSecond: 0, endSecond: 1 }],
				language: "en",
				durationInSeconds: 1,
			},
		];
		const transcriptionModel = new MockTranscriptionModelV4({
			doStream: async () => ({
				stream: simulateReadableStream({ chunks: transcriptionParts }),
			}),
		});

		type TranslationResult = AwaitedReturn<Experimental_MockSpeechTranslationModelV4["doStream"]>;
		type TranslationPart =
			TranslationResult["stream"] extends ReadableStream<infer PART> ? PART : never;
		const translationParts: TranslationPart[] = [
			{ type: "stream-start", warnings: [] },
			{ type: "output-text-delta", delta: "hola" },
			{
				type: "finish",
				sourceText: "hello",
				outputText: "hola",
				durationInSeconds: 1,
			},
		];
		const translationModel = new Experimental_MockSpeechTranslationModelV4({
			doStream: async () => ({
				stream: simulateReadableStream({ chunks: translationParts }),
			}),
		});
		const files = createMockFilesApi();
		const skills = createMockSkillsApi();

		const transcription = service.experimental_streamTranscribe({
			model: transcriptionModel,
			audio: audioInput(),
			inputAudioFormat: { type: "audio/pcm", rate: 16_000 },
		});
		const translation = service.experimental_streamTranslate({
			model: translationModel,
			audio: audioInput(),
			inputAudioFormat: { type: "audio/pcm", rate: 16_000 },
			targetLanguage: "es",
		});
		const uploadedFile = await service.uploadFile({
			api: files,
			data: "file contents",
			filename: "file.txt",
		});
		const uploadedSkill = await service.uploadSkill({
			api: skills,
			files: [{ path: "SKILL.md", data: "skill contents" }],
		});

		expect(await transcription.text).toBe("live transcript");
		expect(await translation.translationText).toBe("hola");
		expect(uploadedFile.providerReference).toHaveProperty("mock-provider");
		expect(uploadedSkill.providerReference).toHaveProperty("mock-provider");
	});
});
