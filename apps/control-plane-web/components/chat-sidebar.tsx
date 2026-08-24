"use client";

import Link from "next/link";
import { Activity, MessageSquarePlus, Plus, Radio, Trash2, X } from "lucide-react";

import { CHAT_PROVIDER_LABELS, type ChatSummary } from "@/lib/chat-schema";
import { cn } from "@/lib/utils";

export interface ChatSidebarProps {
	readonly activePath: string;
	readonly chats: readonly ChatSummary[];
	readonly creating: boolean;
	readonly deletingChatId?: string;
	readonly error?: string;
	readonly loading: boolean;
	readonly loadingMore: boolean;
	readonly mobileOpen: boolean;
	readonly onClose: () => void;
	readonly onCreate: () => void;
	readonly onDelete: (chatId: string) => void;
	readonly onLoadMore?: () => void;
}

export function ChatSidebar({
	activePath,
	chats,
	creating,
	deletingChatId,
	error,
	loading,
	loadingMore,
	mobileOpen,
	onClose,
	onCreate,
	onDelete,
	onLoadMore,
}: ChatSidebarProps) {
	return (
		<>
			<button
				aria-label="Close navigation"
				className={cn("app-sidebar-backdrop", mobileOpen && "is-open")}
				type="button"
				onClick={onClose}
			/>
			<aside className={cn("app-sidebar", mobileOpen && "is-open")} aria-label="Chat navigation">
				<div className="sidebar-brand">
					<Link href="/" className="sidebar-brand-link" onClick={onClose}>
						<span aria-hidden="true" className="brand-mark">
							N
						</span>
						<span>
							<strong>NestM</strong>
							<small>AI SDK lab</small>
						</span>
					</Link>
					<button
						className="sidebar-close"
						type="button"
						aria-label="Close sidebar"
						onClick={onClose}
					>
						<X aria-hidden="true" />
					</button>
				</div>

				<button className="new-chat-button" disabled={creating} type="button" onClick={onCreate}>
					{creating ? (
						<Radio aria-hidden="true" className="animate-pulse" />
					) : (
						<Plus aria-hidden="true" />
					)}
					{creating ? "Starting chat…" : "New chat"}
				</button>

				<nav className="sidebar-nav" aria-label="Workspace">
					<Link
						className={cn("sidebar-nav-link", activePath === "/observability" && "is-active")}
						href="/observability"
						onClick={onClose}
					>
						<Activity aria-hidden="true" />
						Observability
					</Link>
				</nav>

				<div className="sidebar-section-heading">
					<span>Chats</span>
					<span>{chats.length}</span>
				</div>
				<div className="chat-list-scroll">
					{loading ? <SidebarLoading /> : null}
					{!loading && error ? <p className="sidebar-error">{error}</p> : null}
					{!loading && !error && chats.length === 0 ? (
						<div className="sidebar-empty">
							<MessageSquarePlus aria-hidden="true" />
							<p>No conversations yet.</p>
						</div>
					) : null}
					<ul className="chat-list">
						{chats.map((chat) => {
							const active = activePath === `/c/${chat.id}`;
							return (
								<li className={cn("chat-list-item", active && "is-active")} key={chat.id}>
									<Link
										href={`/c/${chat.id}`}
										onClick={onClose}
										aria-current={active ? "page" : undefined}
									>
										<span className="chat-list-title">
											{chat.activeRun ? (
												<span className="run-dot" role="status" aria-label="Run active" />
											) : null}
											<span>{chat.title}</span>
										</span>
										<small>
											{CHAT_PROVIDER_LABELS[chat.provider]} · {chat.model}
										</small>
									</Link>
									<button
										aria-label={`Delete ${chat.title}`}
										className="delete-chat-button"
										disabled={chat.activeRun !== null || deletingChatId === chat.id}
										title={
											chat.activeRun
												? "Cancel the active run before deleting this chat"
												: "Delete chat"
										}
										type="button"
										onClick={() => onDelete(chat.id)}
									>
										<Trash2 aria-hidden="true" />
									</button>
								</li>
							);
						})}
					</ul>
					{onLoadMore ? (
						<button
							className="load-more-chats"
							disabled={loadingMore}
							type="button"
							onClick={onLoadMore}
						>
							{loadingMore ? "Loading…" : "Load older chats"}
						</button>
					) : null}
				</div>
				<p className="sidebar-footnote">Runs continue while you move between pages.</p>
			</aside>
		</>
	);
}

function SidebarLoading() {
	return (
		<div className="sidebar-loading" aria-label="Loading chats" aria-busy="true">
			<span />
			<span />
			<span />
		</div>
	);
}
