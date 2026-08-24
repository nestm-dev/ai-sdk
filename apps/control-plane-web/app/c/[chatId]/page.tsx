import { ChatPage } from "@/components/chat-page";

export default async function ConversationPage({
	params,
}: {
	readonly params: Promise<{ chatId: string }>;
}) {
	const { chatId } = await params;
	return <ChatPage chatId={chatId} />;
}
