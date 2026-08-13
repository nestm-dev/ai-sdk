import {
	createAgentUIStreamResponse,
	createTextStreamResponse,
	createUIMessageStreamResponse,
	consumeStream,
} from "ai";
import type {
	Agent,
	GenerateTextOnStepEndCallback,
	GenerateTextOnStepFinishCallback,
	InferAgentUIMessage,
	InferUIMessageChunk,
	Output,
	ToolSet,
	UIMessage,
	UIMessageStreamOptions,
} from "ai";
import { combineAbortSignals } from "../ai-sdk.abort.js";

const AI_SDK_HTTP_RESPONSE = Symbol("@nestm/ai-sdk/http-response");

export interface AiSdkHttpResponseContext {
	/** Signal aborted by the HTTP adapter when the client disconnects. */
	readonly abortSignal?: AbortSignal;
}

type AiSdkHttpResponseResolver = (
	context: AiSdkHttpResponseContext,
) => Response | PromiseLike<Response>;

type TextStreamResponseOptions = Omit<Parameters<typeof createTextStreamResponse>[0], "stream">;

type UIMessageStreamResponseOptions = Omit<
	Parameters<typeof createUIMessageStreamResponse>[0],
	"stream"
>;

type UIMessageSourceResponseOptions<UI_MESSAGE extends UIMessage> = UIMessageStreamResponseOptions &
	UIMessageStreamOptions<UI_MESSAGE>;

type UpstreamAgentResponseOptions<
	CALL_OPTIONS,
	TOOLS extends ToolSet,
	RUNTIME_CONTEXT extends Record<string, unknown>,
	OUTPUT extends Output.Output,
	MESSAGE_METADATA,
> = Parameters<
	typeof createAgentUIStreamResponse<CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT, OUTPUT, MESSAGE_METADATA>
>[0];

type AgentCallOptions<
	CALL_OPTIONS,
	TOOLS extends ToolSet,
	RUNTIME_CONTEXT extends Record<string, unknown>,
	OUTPUT extends Output.Output,
> = Pick<Parameters<Agent<CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT, OUTPUT>["stream"]>[0], "options">;

export type AiSdkAgentResponseOptions<
	CALL_OPTIONS = never,
	TOOLS extends ToolSet = {},
	RUNTIME_CONTEXT extends Record<string, unknown> = Record<string, unknown>,
	OUTPUT extends Output.Output = never,
	MESSAGE_METADATA = unknown,
> = {
	readonly agent: Agent<CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT, OUTPUT>;
	readonly uiMessages: InferAgentUIMessage<
		Agent<CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT, OUTPUT>,
		MESSAGE_METADATA
	>[];
} & Omit<
	UpstreamAgentResponseOptions<CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT, OUTPUT, MESSAGE_METADATA>,
	"agent" | "onStepEnd" | "onStepFinish" | "options" | "uiMessages"
> &
	AgentCallOptions<CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT, OUTPUT> & {
		onStepEnd?: GenerateTextOnStepEndCallback<TOOLS, RUNTIME_CONTEXT>;
		/** @deprecated Use `onStepEnd` instead. */
		onStepFinish?: GenerateTextOnStepFinishCallback<TOOLS, RUNTIME_CONTEXT>;
	};

export interface AiSdkTextStreamSource {
	readonly textStream: ReadableStream<string>;
}

export interface AiSdkUIMessageStreamSource<UI_MESSAGE extends UIMessage = UIMessage> {
	toUIMessageStream(
		options?: UIMessageStreamOptions<UI_MESSAGE>,
	): ReadableStream<InferUIMessageChunk<UI_MESSAGE>>;
}

/**
 * An opaque HTTP result consumed by {@link AiSdkHttpInterceptor}.
 */
export class AiSdkHttpResponse {
	readonly [AI_SDK_HTTP_RESPONSE] = true;
	private resolvedResponse: Promise<Response> | undefined;

	constructor(
		private readonly response: Response | PromiseLike<Response> | AiSdkHttpResponseResolver,
	) {}

	resolve(context: AiSdkHttpResponseContext = {}): Promise<Response> {
		this.resolvedResponse ??= Promise.resolve(
			typeof this.response === "function" ? this.response(context) : this.response,
		);
		return this.resolvedResponse;
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
		stream: ReadableStream<InferUIMessageChunk<UI_MESSAGE>>,
		options?: UIMessageStreamResponseOptions,
	): AiSdkHttpResponse;
	static ui<UI_MESSAGE extends UIMessage = UIMessage>(
		stream: AiSdkUIMessageStreamSource<UI_MESSAGE>,
		options?: UIMessageSourceResponseOptions<UI_MESSAGE>,
	): AiSdkHttpResponse;
	static ui<UI_MESSAGE extends UIMessage = UIMessage>(
		stream:
			ReadableStream<InferUIMessageChunk<UI_MESSAGE>> | AiSdkUIMessageStreamSource<UI_MESSAGE>,
		options: UIMessageSourceResponseOptions<UI_MESSAGE> = {},
	): AiSdkHttpResponse {
		const uiStream = isReadableStream(stream) ? stream : stream.toUIMessageStream(options);

		return AiSdkResponse.from(
			createUIMessageStreamResponse({
				...options,
				stream: uiStream,
			}),
		);
	}

	static agent<
		CALL_OPTIONS = never,
		TOOLS extends ToolSet = {},
		RUNTIME_CONTEXT extends Record<string, unknown> = Record<string, unknown>,
		OUTPUT extends Output.Output = never,
		MESSAGE_METADATA = unknown,
	>(
		options: AiSdkAgentResponseOptions<
			CALL_OPTIONS,
			TOOLS,
			RUNTIME_CONTEXT,
			OUTPUT,
			MESSAGE_METADATA
		>,
	): AiSdkHttpResponse {
		return new AiSdkHttpResponse((context) => {
			const abortSignal = combineAbortSignals(options.abortSignal, context.abortSignal);
			const { onStepEnd, onStepFinish, ...responseOptions } = options;
			return createAgentUIStreamResponse<
				CALL_OPTIONS,
				TOOLS,
				RUNTIME_CONTEXT,
				OUTPUT,
				MESSAGE_METADATA
			>({
				...responseOptions,
				abortSignal,
				// AI SDK's agent response helper currently widens this callback's
				// runtime context to its base record. The agent still emits the
				// concrete runtime context accepted by the public wrapper type.
				onStepEnd:
					onStepEnd === undefined && onStepFinish === undefined
						? undefined
						: (event) =>
								(onStepEnd ?? onStepFinish)?.({
									...event,
									runtimeContext: event.runtimeContext as RUNTIME_CONTEXT,
								}),
				consumeSseStream:
					options.consumeSseStream ?? (abortSignal === undefined ? undefined : consumeStream),
			});
		});
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
	return "getReader" in value && typeof value.getReader === "function";
}
