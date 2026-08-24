import { describe, expect, it } from "vitest";
import type { PendingAttachment } from "@assistant-ui/react";

import {
	CHAT_ATTACHMENT_MAX_COUNT,
	CHAT_ATTACHMENT_TOTAL_BYTES,
	createChatAttachmentAdapter,
} from "@/lib/chat-attachments";

describe("chat attachment bounds", () => {
	it("rejects files whose aggregate size exceeds the chat history budget", async () => {
		const adapter = createChatAttachmentAdapter();
		const first = (await adapter.add({
			file: sizedFile("first.txt", CHAT_ATTACHMENT_TOTAL_BYTES / 2),
		})) as PendingAttachment;
		await adapter.add({ file: sizedFile("second.txt", CHAT_ATTACHMENT_TOTAL_BYTES / 2) });

		await expect(adapter.add({ file: sizedFile("overflow.txt", 1) })).rejects.toThrow(
			"totaling 256 KiB",
		);
		await adapter.remove(first);
		await expect(adapter.add({ file: sizedFile("replacement.txt", 1) })).resolves.toBeDefined();
	});

	it("caps the number of pending attachments", async () => {
		const adapter = createChatAttachmentAdapter();
		for (let index = 0; index < CHAT_ATTACHMENT_MAX_COUNT; index += 1) {
			await adapter.add({ file: sizedFile(`${index}.txt`, 1) });
		}

		await expect(adapter.add({ file: sizedFile("too-many.txt", 1) })).rejects.toThrow(
			"at most 3 files",
		);
	});
});

function sizedFile(name: string, bytes: number): File {
	return new File([new Uint8Array(bytes)], name, { type: "text/plain" });
}
