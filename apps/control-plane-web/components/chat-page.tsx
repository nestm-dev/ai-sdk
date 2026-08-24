"use client";

import { useChat } from "@ai-sdk/react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { ChatThread } from "@/components/chat-thread";
import { createChatAttachmentAdapter } from "@/lib/chat-attachments";
import {
	cancelChatRun,
	chatQueryKeys,
	createChat,
	getChat,
	listChatProviders,
	updateChat,
} from "@/lib/chat-api";
import { promoteLatestChat } from "@/lib/chat-cache";
import {
	errorOriginAfterFinish,
	hasPendingToolApproval,
	hasSuccessfulAssistantCompletion,
	retryFromAuthoritativeChat,
	type ChatErrorOrigin,
} from "@/lib/chat-message-state";
import {
	MAX_CHAT_INPUT_MESSAGES,
	type ChatList,
	type ChatView,
	type PlaygroundUIMessage,
} from "@/lib/chat-schema";
import {
	discoveredChatRunAction,
	useDetachChatStreamOnUnmount,
	useInitialChatRunId,
} from "@/lib/chat-stream-lifecycle";
import { createPlaygroundChatTransport } from "@/lib/chat-transport";

export function ChatPage({ chatId }: { readonly chatId: string }) {
	const query = useQuery({
		queryKey: chatQueryKeys.detail(chatId),
		queryFn: ({ signal }) => getChat(chatId, signal),
		refetchInterval: (state) => (state.state.data?.activeRun ? 1_500 : false),
	});

	if (!query.data && query.isPending) return <ChatLoadingState />;
	if (!query.data) {
		const message =
			query.error instanceof Error ? query.error.message : "This chat could not be loaded.";
		return <ChatErrorState message={message} onRetry={() => void query.refetch()} />;
	}

	// A keyed runtime is required: useChat's resume effect does not rerun merely
	// because its id changes while the component instance is preserved.
	return <ChatConversation key={query.data.id} chat={query.data} />;
}

function ChatConversation({ chat: persistedChat }: { readonly chat: ChatView }) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [stopping, setStopping] = useState(false);
	const syncedRevision = useRef(persistedChat.updatedAt);
	const generationRequested = useRef(false);
	const chatErrorOrigin = useRef<ChatErrorOrigin | undefined>(undefined);
	const locallyConsumedRunIds = useRef(new Set<string>());
	const lateResumeRunId = useRef<string | undefined>(undefined);
	const initialResumeRunId = useInitialChatRunId(persistedChat.activeRun?.id);
	const transport = useMemo(
		() => createPlaygroundChatTransport(persistedChat.id),
		[persistedChat.id],
	);
	const attachmentAdapter = useMemo(() => createChatAttachmentAdapter(), []);
	const providersQuery = useQuery({
		queryKey: chatQueryKeys.providers,
		queryFn: ({ signal }) => listChatProviders(signal),
		staleTime: 60_000,
	});
	const providerMutation = useMutation({
		mutationFn: (provider: ChatView["provider"]) => updateChat(persistedChat.id, { provider }),
		onSuccess: (chat) => {
			queryClient.setQueryData(chatQueryKeys.detail(chat.id), chat);
			queryClient.setQueryData<ChatList>(chatQueryKeys.all, (current) =>
				promoteLatestChat(current, chat),
			);
			void queryClient.invalidateQueries({ queryKey: chatQueryKeys.sidebar });
		},
	});
	const createMutation = useMutation({
		mutationFn: () => createChat(persistedChat.provider),
		onSuccess: (createdChat) => {
			queryClient.setQueryData(chatQueryKeys.detail(createdChat.id), createdChat);
			queryClient.setQueryData<ChatList>(chatQueryKeys.all, {
				chats: [createdChat],
				nextCursor: null,
			});
			void queryClient.invalidateQueries({ queryKey: chatQueryKeys.all });
			router.push(`/c/${createdChat.id}`);
		},
	});
	const chat = useChat<PlaygroundUIMessage>({
		id: persistedChat.id,
		messages: [...persistedChat.messages],
		resume: initialResumeRunId !== undefined,
		throttle: 50,
		transport,
		sendAutomaticallyWhen: (options) => {
			const shouldSend = lastAssistantMessageIsCompleteWithApprovalResponses(options);
			if (shouldSend) generationRequested.current = true;
			return shouldSend;
		},
		onFinish: ({ isError }) => {
			generationRequested.current = false;
			chatErrorOrigin.current = errorOriginAfterFinish(chatErrorOrigin.current, isError);
			void refreshChatQueries(queryClient, persistedChat.id);
		},
		onError: () => {
			chatErrorOrigin.current = generationRequested.current ? "generation" : "resume";
			generationRequested.current = false;
			void refreshChatQueries(queryClient, persistedChat.id);
		},
	});
	useDetachChatStreamOnUnmount(chat.stop);
	const { clearError, resumeStream, setMessages, status } = chat;
	useEffect(() => {
		const activeRunId = persistedChat.activeRun?.id;
		const action = discoveredChatRunAction({
			activeRunId,
			clientStatus: status,
			generationRequested: generationRequested.current,
			initialRunId: initialResumeRunId,
			lastResumeRunId: lateResumeRunId.current,
			locallyConsumedRunIds: locallyConsumedRunIds.current,
		});
		if (action === "record-local" && activeRunId !== undefined) {
			locallyConsumedRunIds.current.add(activeRunId);
			return;
		}
		if (action !== "resume" || activeRunId === undefined) return;
		lateResumeRunId.current = activeRunId;
		void resumeStream();
	}, [initialResumeRunId, persistedChat.activeRun, resumeStream, status]);
	useEffect(() => {
		queryClient.setQueryData<ChatList>(chatQueryKeys.all, (current) =>
			promoteLatestChat(current, persistedChat),
		);
	}, [persistedChat, queryClient]);
	useEffect(() => {
		if (
			(status !== "ready" && status !== "error") ||
			persistedChat.activeRun !== null ||
			syncedRevision.current === persistedChat.updatedAt
		) {
			return;
		}
		syncedRevision.current = persistedChat.updatedAt;
		setMessages([...persistedChat.messages]);
		if (status === "error" && hasSuccessfulAssistantCompletion(persistedChat.messages)) {
			clearError();
		}
	}, [
		clearError,
		persistedChat.activeRun,
		persistedChat.messages,
		persistedChat.updatedAt,
		setMessages,
		status,
	]);
	const trackedChat: typeof chat = {
		...chat,
		regenerate: (...args) => {
			generationRequested.current = true;
			return chat.regenerate(...args);
		},
		sendMessage: (...args) => {
			generationRequested.current = true;
			return chat.sendMessage(...args);
		},
	};
	const runtime = useAISDKRuntime<PlaygroundUIMessage>(trackedChat, {
		adapters: { attachments: attachmentAdapter },
		cancelPendingToolCallsOnSend: false,
		joinStrategy: "none",
	});
	const busy = status === "submitted" || status === "streaming";
	const displayedChat =
		queryClient.getQueryData<ChatView>(chatQueryKeys.detail(persistedChat.id)) ?? persistedChat;
	const providers = providersQuery.data ?? [
		{ provider: displayedChat.provider, model: displayedChat.model },
	];
	const limitReached = displayedChat.messages.length >= MAX_CHAT_INPUT_MESSAGES;
	const pendingApproval = hasPendingToolApproval(chat.messages);
	const visibleError =
		providerMutation.error instanceof Error ? providerMutation.error : chat.error;

	async function stopRun(): Promise<void> {
		if (stopping) return;
		setStopping(true);
		try {
			// Confirm server state and cancel its current producer before closing the
			// local subscriber. Navigation never calls this function.
			const liveChat = await getChat(persistedChat.id);
			if (liveChat.activeRun) {
				await cancelChatRun(persistedChat.id, liveChat.activeRun.id);
			}
			await chat.stop();
			await refreshChatQueries(queryClient, persistedChat.id);
		} finally {
			setStopping(false);
		}
	}

	function beforeSend() {
		generationRequested.current = true;
		chat.clearError();
		providerMutation.reset();
		void queryClient.invalidateQueries({ queryKey: chatQueryKeys.all });
		window.setTimeout(() => {
			void refreshChatQueries(queryClient, persistedChat.id);
		}, 250);
	}

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ChatThread
				chat={displayedChat}
				creatingChat={createMutation.isPending}
				disabled={
					limitReached ||
					pendingApproval ||
					busy ||
					stopping ||
					persistedChat.activeRun !== null ||
					providerMutation.isPending
				}
				error={visibleError}
				limitReached={limitReached}
				newChatError={
					createMutation.error instanceof Error ? createMutation.error.message : undefined
				}
				onBeforeSend={beforeSend}
				onClearError={() => {
					chat.clearError();
					providerMutation.reset();
				}}
				onProviderChange={(provider) => providerMutation.mutate(provider)}
				onRetryProviders={() => void providersQuery.refetch()}
				onCreateChat={async () => {
					await createMutation.mutateAsync();
				}}
				onRetry={async () => {
					if (providerMutation.error && providerMutation.variables) {
						await providerMutation.mutateAsync(providerMutation.variables);
						return;
					}
					const liveChat = await getChat(persistedChat.id);
					queryClient.setQueryData(chatQueryKeys.detail(liveChat.id), liveChat);
					generationRequested.current = false;
					syncedRevision.current = liveChat.updatedAt;
					const action = await retryFromAuthoritativeChat({
						chat: liveChat,
						clientMessages: chat.messages,
						errorOrigin: chatErrorOrigin.current,
						clearError: chat.clearError,
						setMessages: chat.setMessages,
						resumeStream: chat.resumeStream,
						regenerate: async () => {
							generationRequested.current = true;
							await chat.regenerate();
						},
					});
					if (action !== "regenerate") chatErrorOrigin.current = undefined;
					if (action === "resume") {
						await refreshChatQueries(queryClient, persistedChat.id);
					}
				}}
				onStop={stopRun}
				pendingApproval={pendingApproval}
				providers={providers}
				providersError={
					providersQuery.error instanceof Error ? providersQuery.error.message : undefined
				}
				runActive={persistedChat.activeRun?.status === "running"}
				stopping={stopping}
			/>
		</AssistantRuntimeProvider>
	);
}

async function refreshChatQueries(
	queryClient: ReturnType<typeof useQueryClient>,
	chatId: string,
): Promise<void> {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: chatQueryKeys.all }),
		queryClient.invalidateQueries({ queryKey: chatQueryKeys.detail(chatId) }),
	]);
}

function ChatLoadingState() {
	return (
		<main className="chat-route-state" aria-busy="true" aria-live="polite">
			<LoaderCircle aria-hidden="true" className="animate-spin" />
			<p>Loading conversation…</p>
		</main>
	);
}

function ChatErrorState({
	message,
	onRetry,
}: {
	readonly message: string;
	readonly onRetry: () => void;
}) {
	return (
		<main className="chat-route-state">
			<div role="alert" className="chat-state-card">
				<h1>Conversation unavailable</h1>
				<p>{message}</p>
				<button className="chat-secondary-button" type="button" onClick={onRetry}>
					<RotateCcw aria-hidden="true" /> Retry
				</button>
			</div>
		</main>
	);
}
