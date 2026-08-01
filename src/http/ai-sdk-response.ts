import {
	createAgentUIStreamResponse,
	createTextStreamResponse,
	createUIMessageStreamResponse,
} from "ai";
import type {
	Agent,
	InferAgentUIMessage,
	UIMessage,
	UIMessageChunk,
	UIMessageStreamOptions,
} from "ai";

const AI_SDK_HTTP_RESPONSE = Symbol("@nestm/ai-sdk/http-response");

type TextStreamResponseOptions = Omit<Parameters<typeof createTextStreamResponse>[0], "stream">;

type UIMessageStreamResponseOptions = Omit<
	Parameters<typeof createUIMessageStreamResponse>[0],
	"stream"
>;

type AgentStreamOptions<AGENT> = AGENT extends {
	stream(options: infer OPTIONS): PromiseLike<unknown>;
}
	? OPTIONS
	: never;

type AgentResponseExecutionKeys =
	| "abortSignal"
	| "timeout"
	| "experimental_sandbox"
	| "options"
	| "experimental_transform"
	| "onStepEnd"
	| "onStepFinish";

type AgentResponseExecutionOptions<AGENT> = Pick<
	AgentStreamOptions<AGENT>,
	Extract<keyof AgentStreamOptions<AGENT>, AgentResponseExecutionKeys>
>;

type UpstreamAgent<AGENT> =
	AGENT extends Agent<infer CALL_OPTIONS, infer TOOLS, infer RUNTIME_CONTEXT, infer OUTPUT>
		? Agent<CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT, OUTPUT>
		: never;

export type AiSdkAgentResponseOptions<
	AGENT,
	UI_MESSAGE extends UIMessage = InferAgentUIMessage<AGENT>,
> = {
	readonly agent: AGENT & UpstreamAgent<AGENT>;
	readonly uiMessages: readonly NoInfer<UI_MESSAGE>[];
} & AgentResponseExecutionOptions<AGENT> &
	UIMessageStreamResponseOptions &
	UIMessageStreamOptions<UI_MESSAGE>;

export interface AiSdkTextStreamSource {
	readonly textStream: ReadableStream<string>;
}

export interface AiSdkUIMessageStreamSource<UI_MESSAGE extends UIMessage = UIMessage> {
	toUIMessageStream(options?: UIMessageStreamOptions<UI_MESSAGE>): ReadableStream<UIMessageChunk>;
}

/**
 * An opaque HTTP result consumed by {@link AiSdkHttpInterceptor}.
 */
export class AiSdkHttpResponse {
	readonly [AI_SDK_HTTP_RESPONSE] = true;

	constructor(private readonly response: Response | PromiseLike<Response>) {}

	resolve(): Promise<Response> {
		return Promise.resolve(this.response);
	}
}

/**
 * Response factories for Nest controller handlers.
 *
 * The factories intentionally use the AI SDK's Fetch `Response` helpers. The
 * Nest interceptor only performs the final Fetch-to-Node response bridge.
 */
export class AiSdkResponse {
	private constructor() {}

	static from(response: Response | PromiseLike<Response>): AiSdkHttpResponse {
		return new AiSdkHttpResponse(response);
	}

	static text(
		stream: ReadableStream<string> | AiSdkTextStreamSource,
		init: TextStreamResponseOptions = {},
	): AiSdkHttpResponse {
		return AiSdkResponse.from(
			createTextStreamResponse({
				...init,
				stream: isReadableStream(stream) ? stream : stream.textStream,
			}),
		);
	}

	static ui<UI_MESSAGE extends UIMessage = UIMessage>(
		stream: ReadableStream<UIMessageChunk> | AiSdkUIMessageStreamSource<UI_MESSAGE>,
		options: UIMessageStreamResponseOptions & UIMessageStreamOptions<UI_MESSAGE> = {},
	): AiSdkHttpResponse {
		const uiStream = isReadableStream(stream) ? stream : stream.toUIMessageStream(options);

		return AiSdkResponse.from(
			createUIMessageStreamResponse({
				...options,
				stream: uiStream,
			}),
		);
	}

	static agent<AGENT, UI_MESSAGE extends UIMessage = InferAgentUIMessage<AGENT>>(
		options: AiSdkAgentResponseOptions<AGENT, UI_MESSAGE>,
	): AiSdkHttpResponse {
		return AiSdkResponse.from(invokeAgentResponseHelper(options));
	}
}

export function isAiSdkHttpResponse(value: unknown): value is AiSdkHttpResponse {
	return (
		typeof value === "object" &&
		value !== null &&
		AI_SDK_HTTP_RESPONSE in value &&
		value[AI_SDK_HTTP_RESPONSE] === true
	);
}

function isReadableStream<T>(value: ReadableStream<T> | object): value is ReadableStream<T> {
	return typeof (value as { getReader?: unknown }).getReader === "function";
}

function invokeAgentResponseHelper(options: unknown): Promise<Response> {
	const helper = createAgentUIStreamResponse as unknown as (
		responseOptions: unknown,
	) => Promise<Response>;
	return helper(options);
}
