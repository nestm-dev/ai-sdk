"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { chatQueryKeys, createChat, listChats } from "@/lib/chat-api";
import type { ChatList } from "@/lib/chat-schema";

export function RootChatRedirect() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const started = useRef(false);
	const [creationError, setCreationError] = useState<Error>();
	const query = useQuery({
		queryKey: chatQueryKeys.all,
		queryFn: ({ signal }) => listChats({ limit: 1, signal }),
	});

	useEffect(() => {
		if (!query.data || started.current) return;
		started.current = true;
		const recent = query.data.chats.at(0);
		if (recent) {
			router.replace(`/c/${recent.id}`);
			return;
		}
		void createChat("openai")
			.then((chat) => {
				queryClient.setQueryData<ChatList>(chatQueryKeys.all, {
					chats: [chat],
					nextCursor: null,
				});
				queryClient.setQueryData(chatQueryKeys.detail(chat.id), chat);
				router.replace(`/c/${chat.id}`);
			})
			.catch((error: unknown) => {
				started.current = false;
				setCreationError(
					error instanceof Error ? error : new Error("A chat could not be created."),
				);
			});
	}, [query.data, queryClient, router]);

	const error = creationError ?? (query.error instanceof Error ? query.error : undefined);
	if (error) {
		return (
			<main className="chat-route-state">
				<div role="alert" className="chat-state-card">
					<h1>Chat service unavailable</h1>
					<p>{error.message}</p>
					<button
						className="chat-secondary-button"
						type="button"
						onClick={() => {
							setCreationError(undefined);
							started.current = false;
							void query.refetch();
						}}
					>
						<RotateCcw aria-hidden="true" /> Retry
					</button>
				</div>
			</main>
		);
	}

	return (
		<main className="chat-route-state" aria-busy="true" aria-live="polite">
			<LoaderCircle aria-hidden="true" className="animate-spin" />
			<p>{query.data ? "Opening your latest chat…" : "Loading conversations…"}</p>
		</main>
	);
}
