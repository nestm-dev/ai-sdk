"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Menu } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { ChatSidebar } from "@/components/chat-sidebar";
import { chatQueryKeys, createChat, deleteChat, listChats } from "@/lib/chat-api";
import type { ChatList, ChatSummary } from "@/lib/chat-schema";

export function ChatShell({ children }: { readonly children: React.ReactNode }) {
	const pathname = usePathname();
	const router = useRouter();
	const queryClient = useQueryClient();
	const [mobileOpen, setMobileOpen] = useState(false);
	const chatsQuery = useInfiniteQuery({
		queryKey: chatQueryKeys.sidebar,
		queryFn: ({ pageParam, signal }) => listChats({ cursor: pageParam, limit: 50, signal }),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		refetchInterval: 2_000,
	});
	const chats = mergeChats(chatsQuery.data?.pages.flatMap((page) => page.chats) ?? []);
	const createMutation = useMutation({
		mutationFn: () => createChat("openai"),
		onSuccess: (chat) => {
			queryClient.setQueryData(chatQueryKeys.detail(chat.id), chat);
			queryClient.setQueryData<ChatList>(chatQueryKeys.all, {
				chats: [chat],
				nextCursor: null,
			});
			void queryClient.invalidateQueries({ queryKey: chatQueryKeys.all });
			setMobileOpen(false);
			router.push(`/c/${chat.id}`);
		},
	});
	const deleteMutation = useMutation({
		mutationFn: deleteChat,
		onSuccess: (_, chatId) => {
			// The root query contains only the newest chat. Removing it forces `/`
			// to fetch authoritative ordering instead of opening stale data.
			queryClient.removeQueries({ exact: true, queryKey: chatQueryKeys.all });
			queryClient.removeQueries({ queryKey: chatQueryKeys.detail(chatId) });
			void queryClient.invalidateQueries({ queryKey: chatQueryKeys.sidebar });
			if (pathname === `/c/${chatId}`) router.replace("/");
		},
	});
	const error =
		createMutation.error instanceof Error
			? createMutation.error.message
			: deleteMutation.error instanceof Error
				? deleteMutation.error.message
				: chatsQuery.error instanceof Error
					? chatsQuery.error.message
					: undefined;

	return (
		<div className="app-shell">
			<ChatSidebar
				activePath={pathname}
				chats={chats}
				creating={createMutation.isPending}
				deletingChatId={deleteMutation.isPending ? deleteMutation.variables : undefined}
				error={error}
				loading={chatsQuery.isPending}
				loadingMore={chatsQuery.isFetchingNextPage}
				mobileOpen={mobileOpen}
				onClose={() => setMobileOpen(false)}
				onCreate={() => createMutation.mutate()}
				onDelete={(chatId) => deleteMutation.mutate(chatId)}
				onLoadMore={
					chatsQuery.hasNextPage
						? () => void chatsQuery.fetchNextPage().catch(() => undefined)
						: undefined
				}
			/>
			<div className="app-content">
				<button
					className="mobile-menu-button"
					type="button"
					aria-label="Open navigation"
					onClick={() => setMobileOpen(true)}
				>
					<Menu aria-hidden="true" />
				</button>
				{children}
			</div>
		</div>
	);
}

function mergeChats(chats: readonly ChatSummary[]): readonly ChatSummary[] {
	return [...new Map(chats.map((chat) => [chat.id, chat])).values()];
}
