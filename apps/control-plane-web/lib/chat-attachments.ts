import type { AttachmentAdapter } from "@assistant-ui/react";

export const CHAT_ATTACHMENT_MAX_BYTES = 256 * 1024;
export const CHAT_ATTACHMENT_MAX_COUNT = 3;
export const CHAT_ATTACHMENT_TOTAL_BYTES = 256 * 1024;

export function createChatAttachmentAdapter(): AttachmentAdapter {
	const pendingBytes = new Map<string, number>();
	return {
		accept: "image/*,text/*,application/json,application/pdf",
		async add({ file }) {
			const aggregateBytes = [...pendingBytes.values()].reduce((total, size) => total + size, 0);
			if (
				file.size > CHAT_ATTACHMENT_MAX_BYTES ||
				pendingBytes.size >= CHAT_ATTACHMENT_MAX_COUNT ||
				aggregateBytes + file.size > CHAT_ATTACHMENT_TOTAL_BYTES
			) {
				throw new Error("Attach at most 3 files totaling 256 KiB.");
			}
			const id = crypto.randomUUID();
			pendingBytes.set(id, file.size);
			return {
				id,
				type: file.type.startsWith("image/") ? "image" : "file",
				name: file.name,
				contentType: file.type || "application/octet-stream",
				file,
				content: [],
				status: { type: "requires-action", reason: "composer-send" },
			};
		},
		async send(attachment) {
			try {
				return {
					...attachment,
					status: { type: "complete" },
					content: [
						{
							type: "file",
							mimeType: attachment.contentType || "application/octet-stream",
							filename: attachment.name,
							data: await fileDataUrl(attachment.file),
						},
					],
				};
			} finally {
				pendingBytes.delete(attachment.id);
			}
		},
		async remove(attachment) {
			pendingBytes.delete(attachment.id);
		},
	};
}

function fileDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener("load", () => {
			if (typeof reader.result === "string") resolve(reader.result);
			else reject(new Error("The attachment could not be read."));
		});
		reader.addEventListener("error", () => reject(new Error("The attachment could not be read.")));
		reader.readAsDataURL(file);
	});
}
