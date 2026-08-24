"use client";

import {
	ActionBarPrimitive,
	AttachmentPrimitive,
	ComposerPrimitive,
	ErrorPrimitive,
	getExternalStoreMessages,
	MessagePartPrimitive,
	MessagePrimitive,
	ThreadPrimitive,
	useAuiState,
	type FileMessagePartProps,
	type ImageMessagePartProps,
	type ReasoningMessagePartProps,
	type SourceMessagePartProps,
} from "@assistant-ui/react";
import {
	ArrowDown,
	ArrowUp,
	Bot,
	CircleAlert,
	Copy,
	File,
	ImageIcon,
	Link2,
	LoaderCircle,
	MessageSquarePlus,
	Paperclip,
	RefreshCw,
	RotateCcw,
	Square,
	X,
} from "lucide-react";
import { memo } from "react";
import { Streamdown } from "streamdown";

import { ChatModelSelector } from "@/components/chat-model-selector";
import { ChatTool } from "@/components/chat-tool";
import {
	CHAT_PROVIDER_LABELS,
	type ChatMessageMetadata,
	type ChatView,
	type PlaygroundUIMessage,
	type ProviderDescription,
} from "@/lib/chat-schema";

interface ChatThreadProps {
	readonly chat: ChatView;
	readonly creatingChat: boolean;
	readonly disabled: boolean;
	readonly error?: Error;
	readonly limitReached: boolean;
	readonly newChatError?: string;
	readonly onBeforeSend: () => void;
	readonly onClearError: () => void;
	readonly onCreateChat: () => Promise<void>;
	readonly onProviderChange: (provider: ChatView["provider"]) => void;
	readonly onRetry: () => Promise<void>;
	readonly onRetryProviders: () => void;
	readonly onStop: () => Promise<void>;
	readonly pendingApproval: boolean;
	readonly providers: readonly ProviderDescription[];
	readonly providersError?: string;
	readonly runActive: boolean;
	readonly stopping: boolean;
}

export function ChatThread({
	chat,
	creatingChat,
	disabled,
	error,
	limitReached,
	newChatError,
	onBeforeSend,
	onClearError,
	onCreateChat,
	onProviderChange,
	onRetry,
	onRetryProviders,
	onStop,
	pendingApproval,
	providers,
	providersError,
	runActive,
	stopping,
}: ChatThreadProps) {
	return (
		<div className="chat-workspace">
			<header className="chat-header">
				<div className="chat-header-title">
					<Bot aria-hidden="true" />
					<div>
						<h1>{chat.title}</h1>
						<p>
							{chat.activeRun?.status === "cancelled"
								? "Stopping agent in the background"
								: chat.activeRun
									? "Agent is working in the background"
									: "Saved conversation"}
						</p>
					</div>
				</div>
				<ChatModelSelector
					activeRun={chat.activeRun !== null}
					disabled={disabled}
					messageCount={chat.messages.length}
					onProviderChange={onProviderChange}
					onRetryProviders={onRetryProviders}
					provider={chat.provider}
					providers={providers}
					providersError={providersError}
				/>
			</header>

			<ThreadPrimitive.Root className="chat-thread-root">
				<ThreadPrimitive.Viewport turnAnchor="top" className="chat-thread-viewport">
					<div className="chat-thread-column">
						<ThreadPrimitive.Empty>
							<ChatWelcome provider={CHAT_PROVIDER_LABELS[chat.provider]} model={chat.model} />
						</ThreadPrimitive.Empty>
						<div className="chat-message-list">
							<ThreadPrimitive.Messages>
								{({ message }) =>
									message.role === "user" ? <UserMessage /> : <AssistantMessage />
								}
							</ThreadPrimitive.Messages>
						</div>

						<ThreadPrimitive.ViewportFooter className="chat-composer-dock">
							<ThreadPrimitive.ScrollToBottom asChild>
								<button
									className="scroll-to-bottom"
									type="button"
									aria-label="Scroll to latest message"
								>
									<ArrowDown aria-hidden="true" />
								</button>
							</ThreadPrimitive.ScrollToBottom>
							<ChatComposer
								creatingChat={creatingChat}
								disabled={disabled}
								error={error}
								limitReached={limitReached}
								newChatError={newChatError}
								onBeforeSend={onBeforeSend}
								onClearError={onClearError}
								onCreateChat={onCreateChat}
								onRetry={onRetry}
								onStop={onStop}
								pendingApproval={pendingApproval}
								runActive={runActive}
								stopping={stopping}
							/>
						</ThreadPrimitive.ViewportFooter>
					</div>
				</ThreadPrimitive.Viewport>
			</ThreadPrimitive.Root>
		</div>
	);
}

function ChatWelcome({ provider, model }: { readonly provider: string; readonly model: string }) {
	return (
		<div className="chat-welcome">
			<span className="chat-welcome-icon">
				<Bot aria-hidden="true" />
			</span>
			<h2>How can I help?</h2>
			<p>
				This conversation uses {provider} <span>{model}</span>. Try a tool request, ask for a
				reasoned answer, or move to Observability while it runs.
			</p>
		</div>
	);
}

function ChatComposer({
	creatingChat,
	disabled,
	error,
	limitReached,
	newChatError,
	onBeforeSend,
	onClearError,
	onCreateChat,
	onRetry,
	onStop,
	pendingApproval,
	runActive,
	stopping,
}: Omit<
	ChatThreadProps,
	"chat" | "onProviderChange" | "onRetryProviders" | "providers" | "providersError"
>) {
	const running = useAuiState((state) => state.thread.isRunning);
	const canStop = running || runActive;
	return (
		<div className="chat-composer-wrap">
			{limitReached ? (
				<div className="chat-limit-notice" role="status">
					<MessageSquarePlus aria-hidden="true" />
					<div>
						<strong>Conversation limit reached</strong>
						<p>This saved chat is full. Start a new chat to continue with the same model.</p>
						{newChatError ? <small>{newChatError}</small> : null}
					</div>
					<button
						disabled={creatingChat}
						type="button"
						onClick={() => void onCreateChat().catch(() => undefined)}
					>
						{creatingChat ? (
							<LoaderCircle aria-hidden="true" className="animate-spin" />
						) : (
							<MessageSquarePlus aria-hidden="true" />
						)}
						New chat
					</button>
				</div>
			) : null}
			{error ? (
				<div className="chat-stream-error" role="alert">
					<CircleAlert aria-hidden="true" />
					<div>
						<strong>Response interrupted</strong>
						<p>{error.message || "The response stopped before it completed."}</p>
					</div>
					<button
						disabled={running || stopping}
						type="button"
						onClick={() => void onRetry().catch(() => undefined)}
					>
						<RotateCcw aria-hidden="true" /> Retry
					</button>
					<button type="button" aria-label="Dismiss error" onClick={onClearError}>
						<X aria-hidden="true" />
					</button>
				</div>
			) : null}
			<ComposerPrimitive.Root className="chat-composer" onSubmit={onBeforeSend} aria-busy={canStop}>
				<ComposerPrimitive.Attachments>
					{({ attachment }) => (
						<AttachmentPrimitive.Root className="composer-attachment">
							{attachment.type === "image" ? (
								<ImageIcon aria-hidden="true" />
							) : (
								<File aria-hidden="true" />
							)}
							<span>{attachment.name}</span>
							<AttachmentPrimitive.Remove asChild>
								<button type="button" aria-label={`Remove ${attachment.name}`}>
									<X aria-hidden="true" />
								</button>
							</AttachmentPrimitive.Remove>
						</AttachmentPrimitive.Root>
					)}
				</ComposerPrimitive.Attachments>
				<ComposerPrimitive.Input
					aria-label="Message the AI agent"
					disabled={disabled}
					placeholder={
						pendingApproval ? "Approve or deny the pending tool first…" : "Message the AI agent…"
					}
					rows={2}
				/>
				<div className="chat-composer-actions">
					<ComposerPrimitive.AddAttachment asChild>
						<button className="chat-attachment-button" disabled={disabled} type="button">
							<Paperclip aria-hidden="true" />
							<span className="sr-only">Add image or file</span>
						</button>
					</ComposerPrimitive.AddAttachment>
					<span>Enter to send · Shift + Enter for a new line</span>
					{canStop ? (
						<button
							className="chat-stop-button"
							disabled={stopping}
							type="button"
							onClick={() => void onStop().catch(() => undefined)}
						>
							{stopping ? (
								<LoaderCircle aria-hidden="true" className="animate-spin" />
							) : (
								<Square aria-hidden="true" />
							)}
							<span className="sr-only">Stop generation</span>
						</button>
					) : null}
					<ComposerPrimitive.Send asChild>
						<button
							className="chat-send-button"
							disabled={disabled}
							type="submit"
							aria-label="Send message"
						>
							<ArrowUp aria-hidden="true" />
						</button>
					</ComposerPrimitive.Send>
				</div>
			</ComposerPrimitive.Root>
		</div>
	);
}

function UserMessage() {
	return (
		<MessagePrimitive.Root className="chat-message is-user">
			<div className="user-message-bubble">
				<MessagePrimitive.Attachments>
					{({ attachment }) => (
						<div className="user-attachment">
							{attachment.type === "image" ? (
								<ImageIcon aria-hidden="true" />
							) : (
								<File aria-hidden="true" />
							)}
							<span>{attachment.name}</span>
						</div>
					)}
				</MessagePrimitive.Attachments>
				<MessagePrimitive.Parts>
					{({ part }) =>
						part.type === "text" ? <p className="whitespace-pre-wrap">{part.text}</p> : null
					}
				</MessagePrimitive.Parts>
			</div>
		</MessagePrimitive.Root>
	);
}

function AssistantMessage() {
	return (
		<MessagePrimitive.Root className="chat-message is-assistant">
			<div className="assistant-avatar" aria-hidden="true">
				<Bot />
			</div>
			<div className="assistant-message-content">
				<MessagePrimitive.Parts>
					{({ part }) => {
						switch (part.type) {
							case "text":
								return <TextPart active={part.status.type === "running"} text={part.text} />;
							case "reasoning":
								return <ReasoningPart {...part} />;
							case "tool-call":
								return part.toolUI ?? <ChatTool {...part} />;
							case "source":
								return <SourcePart {...part} />;
							case "file":
								return <FilePart {...part} />;
							case "image":
								return <ImagePart {...part} />;
							case "data":
								return part.dataRendererUI;
							default:
								return null;
						}
					}}
				</MessagePrimitive.Parts>
				<MessagePrimitive.Error>
					<ErrorPrimitive.Root className="message-error">
						<ErrorPrimitive.Message />
					</ErrorPrimitive.Root>
				</MessagePrimitive.Error>
				<div className="message-footer">
					<MessageMetadataFooter />
					<ActionBarPrimitive.Root className="message-actions" hideWhenRunning>
						<ActionBarPrimitive.Copy copiedDuration={1_500} aria-label="Copy response">
							<Copy aria-hidden="true" />
						</ActionBarPrimitive.Copy>
						<ActionBarPrimitive.Reload aria-label="Regenerate response">
							<RefreshCw aria-hidden="true" />
						</ActionBarPrimitive.Reload>
					</ActionBarPrimitive.Root>
				</div>
			</div>
		</MessagePrimitive.Root>
	);
}

function TextPart({ active, text }: { readonly active: boolean; readonly text: string }) {
	return (
		<>
			{text ? <MarkdownResponse active={active}>{text}</MarkdownResponse> : null}
			<MessagePartPrimitive.InProgress>
				<span className="message-indicator" role="status">
					<LoaderCircle aria-hidden="true" className="animate-spin" />
					{text ? "Generating…" : "Waiting for model…"}
				</span>
			</MessagePartPrimitive.InProgress>
		</>
	);
}

function MessageMetadataFooter() {
	const message = useAuiState((state) => state.message);
	const rawMessages = getExternalStoreMessages<PlaygroundUIMessage>(message);
	const metadata = rawMessages.at(-1)?.metadata as ChatMessageMetadata | undefined;
	const running = message.status?.type === "running";
	const values = metadataValues(metadata, running);

	if (values.length === 0) return null;
	return (
		<ul className="message-metadata" aria-label="Response metadata">
			{values.map(({ label, value }) => (
				<li key={label} title={label}>
					<span>{label}</span> {value}
				</li>
			))}
		</ul>
	);
}

function metadataValues(
	metadata: ChatMessageMetadata | undefined,
	running: boolean,
): Array<{ label: string; value: string }> {
	if (!metadata) return running ? [{ label: "Status", value: "Streaming" }] : [];
	const values: Array<{ label: string; value: string }> = [];
	if (metadata.provider) {
		values.push({
			label: "Provider",
			value: `${CHAT_PROVIDER_LABELS[metadata.provider]}${metadata.model ? ` · ${metadata.model}` : ""}`,
		});
	} else if (metadata.model) {
		values.push({ label: "Model", value: metadata.model });
	}
	if (metadata.durationMs !== undefined) {
		values.push({ label: "Duration", value: formatDuration(metadata.durationMs) });
	}
	if (metadata.totalTokens !== undefined) {
		values.push({ label: "Tokens", value: metadata.totalTokens.toLocaleString() });
	}
	if (metadata.stepCount !== undefined) {
		values.push({ label: "Steps", value: metadata.stepCount.toLocaleString() });
	}
	if (metadata.finishReason) {
		values.push({ label: "Finish", value: metadata.finishReason });
	} else if (running) {
		values.push({ label: "Status", value: "Streaming" });
	}
	return values;
}

function formatDuration(durationMs: number): string {
	if (durationMs < 1_000) return `${durationMs} ms`;
	return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}

const MarkdownResponse = memo(function MarkdownResponse({
	active,
	children,
}: {
	readonly active: boolean;
	readonly children: string;
}) {
	return (
		<Streamdown
			animated={false}
			className="message-markdown"
			controls={{
				code: { copy: true, download: true },
				table: { copy: true, download: true, fullscreen: true },
			}}
			linkSafety={{ enabled: true }}
			mode={active ? "streaming" : "static"}
			parseIncompleteMarkdown={active}
			skipHtml
		>
			{children}
		</Streamdown>
	);
});

function ReasoningPart({ status, text }: ReasoningMessagePartProps) {
	return (
		<details className="reasoning-part" open={status.type === "running"}>
			<summary>{status.type === "running" ? "Thinking…" : "Reasoning"}</summary>
			<MarkdownResponse active={status.type === "running"}>{text}</MarkdownResponse>
		</details>
	);
}

function SourcePart(part: SourceMessagePartProps) {
	const href = part.sourceType === "url" ? safeExternalUrl(part.url) : undefined;
	return (
		<div className="message-attachment">
			<Link2 aria-hidden="true" />
			{href ? (
				<a href={href} rel="noreferrer noopener" target="_blank">
					{part.title ?? href}
				</a>
			) : (
				<span>{part.title ?? "Source"}</span>
			)}
		</div>
	);
}

function FilePart(part: FileMessagePartProps) {
	const href = safeFileUrl(part.data);
	return (
		<div className="message-attachment">
			<File aria-hidden="true" />
			{href ? (
				<a href={href} rel="noreferrer noopener" target="_blank">
					{part.filename ?? "Generated file"}
				</a>
			) : (
				<span>{part.filename ?? "Generated file"}</span>
			)}
			<small>{part.mimeType}</small>
		</div>
	);
}

function ImagePart(part: ImageMessagePartProps) {
	return (
		<figure className="message-image">
			{/* Runtime images may be data/blob URLs and cannot use framework optimization. */}
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img alt={part.filename ?? "Generated image"} src={part.image} />
			{part.filename ? (
				<figcaption>
					<ImageIcon aria-hidden="true" /> {part.filename}
				</figcaption>
			) : null}
		</figure>
	);
}

function safeExternalUrl(value: string): string | undefined {
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

function safeFileUrl(value: string): string | undefined {
	if (value.startsWith("data:") || value.startsWith("blob:")) return value;
	return safeExternalUrl(value);
}
