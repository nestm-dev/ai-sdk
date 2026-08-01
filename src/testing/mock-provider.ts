import type { ProviderRegistryProvider } from "ai";
import {
	MockEmbeddingModelV4,
	MockImageModelV4,
	MockLanguageModelV4,
	MockProviderV4,
	MockRerankingModelV4,
	MockSpeechModelV4,
	MockTranscriptionModelV4,
	MockVideoModelV4,
} from "ai/test";

export type MockFilesApi = ReturnType<ProviderRegistryProvider["files"]>;
export type MockSkillsApi = ReturnType<ProviderRegistryProvider["skills"]>;
export type MockVideoModel = InstanceType<typeof MockVideoModelV4>;

export interface RecordingMockFilesApi extends MockFilesApi {
	readonly uploadFileCalls: Parameters<MockFilesApi["uploadFile"]>[0][];
}

export interface RecordingMockSkillsApi extends MockSkillsApi {
	readonly uploadSkillCalls: Parameters<MockSkillsApi["uploadSkill"]>[0][];
}

export type MockUploadFileResult = Awaited<ReturnType<MockFilesApi["uploadFile"]>>;
export type MockUploadSkillResult = Awaited<ReturnType<MockSkillsApi["uploadSkill"]>>;

export interface CreateMockFilesApiOptions {
	provider?: string;
	uploadFile?: MockFilesApi["uploadFile"] | MockUploadFileResult | readonly MockUploadFileResult[];
}

export interface CreateMockSkillsApiOptions {
	provider?: string;
	uploadSkill?:
		MockSkillsApi["uploadSkill"] | MockUploadSkillResult | readonly MockUploadSkillResult[];
}

type MockProviderV4Options = NonNullable<ConstructorParameters<typeof MockProviderV4>[0]>;

export interface CreateMockAiProviderOptions extends MockProviderV4Options {
	videoModels?: Record<string, MockVideoModel>;
	files?: MockFilesApi | CreateMockFilesApiOptions;
	skills?: MockSkillsApi | CreateMockSkillsApiOptions;
}

export type MockAiProviderV4 = InstanceType<typeof MockProviderV4> & {
	readonly transcriptionModel: NonNullable<
		InstanceType<typeof MockProviderV4>["transcriptionModel"]
	>;
	readonly speechModel: NonNullable<InstanceType<typeof MockProviderV4>["speechModel"]>;
	readonly rerankingModel: NonNullable<InstanceType<typeof MockProviderV4>["rerankingModel"]>;
	readonly videoModel: (modelId: string) => MockVideoModel;
	readonly files: () => MockFilesApi;
	readonly skills: () => MockSkillsApi;
};

function selectResult<Result>(
	value: ((...arguments_: never[]) => unknown) | Result | readonly Result[] | undefined,
	callIndex: number,
	fallback: Result,
): Result {
	if (value === undefined || typeof value === "function") {
		return fallback;
	}

	if (isResultSequence(value)) {
		return value[Math.min(callIndex, value.length - 1)] ?? fallback;
	}

	return value;
}

function isResultSequence<Result>(value: Result | readonly Result[]): value is readonly Result[] {
	return Array.isArray(value);
}

export function createMockFilesApi(options: CreateMockFilesApiOptions = {}): RecordingMockFilesApi {
	const provider = options.provider ?? "mock-provider";
	const uploadFileCalls: Parameters<MockFilesApi["uploadFile"]>[0][] = [];

	return {
		specificationVersion: "v4",
		provider,
		uploadFileCalls,
		async uploadFile(arguments_) {
			const callIndex = uploadFileCalls.push(arguments_) - 1;
			const fallback: MockUploadFileResult = {
				providerReference: { [provider]: `file-${callIndex + 1}` },
				mediaType: arguments_.mediaType,
				filename: arguments_.filename,
				warnings: [],
			};

			if (typeof options.uploadFile === "function") {
				return options.uploadFile(arguments_);
			}

			return selectResult(options.uploadFile, callIndex, fallback);
		},
	};
}

export function createMockSkillsApi(
	options: CreateMockSkillsApiOptions = {},
): RecordingMockSkillsApi {
	const provider = options.provider ?? "mock-provider";
	const uploadSkillCalls: Parameters<MockSkillsApi["uploadSkill"]>[0][] = [];

	return {
		specificationVersion: "v4",
		provider,
		uploadSkillCalls,
		async uploadSkill(arguments_) {
			const callIndex = uploadSkillCalls.push(arguments_) - 1;
			const fallback: MockUploadSkillResult = {
				providerReference: { [provider]: `skill-${callIndex + 1}` },
				displayTitle: arguments_.displayTitle,
				warnings: [],
			};

			if (typeof options.uploadSkill === "function") {
				return options.uploadSkill(arguments_);
			}

			return selectResult(options.uploadSkill, callIndex, fallback);
		},
	};
}

function isFilesApi(value: MockFilesApi | CreateMockFilesApiOptions): value is MockFilesApi {
	return "specificationVersion" in value && typeof value.uploadFile === "function";
}

function isSkillsApi(value: MockSkillsApi | CreateMockSkillsApiOptions): value is MockSkillsApi {
	return "specificationVersion" in value && typeof value.uploadSkill === "function";
}

/**
 * Creates one AI SDK V4 provider that covers every model and upload modality.
 * Every omitted model map receives a `default` mock so Nest configuration can
 * eagerly validate defaults without contacting a provider.
 */
export function createMockAiProvider(options: CreateMockAiProviderOptions = {}): MockAiProviderV4 {
	const {
		videoModels = { default: new MockVideoModelV4() },
		files: filesOption = {},
		skills: skillsOption = {},
		...providerOptions
	} = options;
	const baseProvider = new MockProviderV4({
		languageModels: providerOptions.languageModels ?? {
			default: new MockLanguageModelV4(),
		},
		embeddingModels: providerOptions.embeddingModels ?? {
			default: new MockEmbeddingModelV4(),
		},
		imageModels: providerOptions.imageModels ?? {
			default: new MockImageModelV4(),
		},
		transcriptionModels: providerOptions.transcriptionModels ?? {
			default: new MockTranscriptionModelV4(),
		},
		speechModels: providerOptions.speechModels ?? {
			default: new MockSpeechModelV4(),
		},
		rerankingModels: providerOptions.rerankingModels ?? {
			default: new MockRerankingModelV4(),
		},
	});
	const filesApi = isFilesApi(filesOption) ? filesOption : createMockFilesApi(filesOption);
	const skillsApi = isSkillsApi(skillsOption) ? skillsOption : createMockSkillsApi(skillsOption);
	const { transcriptionModel, speechModel, rerankingModel } = baseProvider;

	if (
		transcriptionModel === undefined ||
		speechModel === undefined ||
		rerankingModel === undefined
	) {
		throw new Error("AI SDK MockProviderV4 does not expose every configured modality");
	}

	return Object.assign(baseProvider, {
		transcriptionModel,
		speechModel,
		rerankingModel,
		videoModel(modelId: string): MockVideoModel {
			const model = videoModels[modelId];

			if (model === undefined) {
				throw new Error(`No mock video model registered for "${modelId}"`);
			}

			return model;
		},
		files: () => filesApi,
		skills: () => skillsApi,
	});
}
