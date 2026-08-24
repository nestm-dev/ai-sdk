"use client";

import type { ToolCallMessagePartProps, ToolCallMessagePartStatus } from "@assistant-ui/react";
import { Check, CircleAlert, CircleX, LoaderCircle, ShieldCheck, Wrench } from "lucide-react";
import { useState, type ElementType } from "react";

import { cn } from "@/lib/utils";

interface ToolVisualState {
	readonly Icon: ElementType;
	readonly statusLabel: string;
	readonly tone: "attention" | "failure" | "pending" | "success";
}

export function ChatTool({
	approval,
	argsText,
	isError,
	respondToApproval,
	result,
	status,
	toolName,
}: ToolCallMessagePartProps) {
	const [submitted, setSubmitted] = useState(false);
	const visual = toolVisualState(status, isError);
	const needsApproval = status.type === "requires-action" && approval?.approved === undefined;
	const error =
		status.type === "incomplete" && status.error !== undefined
			? limitedPayload(status.error)
			: isError
				? limitedPayload(result)
				: undefined;
	const output = isError ? undefined : limitedPayload(result);

	function respond(approved: boolean) {
		if (submitted) return;
		setSubmitted(true);
		respondToApproval({
			approved,
			...(approved ? {} : { reason: "Denied by the user." }),
		});
	}

	return (
		<details
			className={cn("chat-tool", `is-${visual.tone}`)}
			open={needsApproval || status.type === "incomplete" || isError === true}
		>
			<summary>
				<span className="chat-tool-icon">
					<visual.Icon
						aria-hidden="true"
						className={visual.tone === "pending" ? "animate-spin" : undefined}
					/>
				</span>
				<span className="chat-tool-name">{friendlyToolName(toolName)}</span>
				<span className="chat-tool-status">{visual.statusLabel}</span>
			</summary>
			<div className="chat-tool-body">
				{needsApproval ? (
					<div
						className="tool-approval"
						role="group"
						aria-label={`${friendlyToolName(toolName)} approval`}
					>
						<div>
							<ShieldCheck aria-hidden="true" />
							<p>This tool needs your approval before it can run.</p>
						</div>
						<div className="tool-approval-actions">
							<button disabled={submitted} type="button" onClick={() => respond(true)}>
								Approve
							</button>
							<button disabled={submitted} type="button" onClick={() => respond(false)}>
								Deny
							</button>
						</div>
					</div>
				) : null}
				{error ? (
					<p className="chat-tool-error" role="alert">
						{error}
					</p>
				) : null}
				{argsText ? <ToolPayload label="Input" value={argsText} /> : null}
				{output ? <ToolPayload label="Output" value={output} /> : null}
				{!argsText && !output && !error && !needsApproval ? (
					<p className="chat-tool-empty">
						<Wrench aria-hidden="true" /> No additional tool details.
					</p>
				) : null}
			</div>
		</details>
	);
}

function ToolPayload({ label, value }: { readonly label: string; readonly value: string }) {
	return (
		<div className="tool-payload">
			<p>{label}</p>
			<pre>{value.length > 8_000 ? `${value.slice(0, 8_000)}\n…` : value}</pre>
		</div>
	);
}

function toolVisualState(
	status: ToolCallMessagePartStatus,
	isError: boolean | undefined,
): ToolVisualState {
	if (status.type === "running") {
		return { Icon: LoaderCircle, statusLabel: "Working", tone: "pending" };
	}
	if (status.type === "requires-action") {
		return { Icon: CircleAlert, statusLabel: "Approval needed", tone: "attention" };
	}
	if (status.type === "incomplete" || isError) {
		const cancelled = status.type === "incomplete" && status.reason === "cancelled";
		return {
			Icon: cancelled ? CircleAlert : CircleX,
			statusLabel: cancelled ? "Cancelled" : "Failed",
			tone: "failure",
		};
	}
	return { Icon: Check, statusLabel: "Done", tone: "success" };
}

function friendlyToolName(toolName: string): string {
	const name = toolName
		.replace(/^tool-/u, "")
		.replaceAll(/[_-]+/gu, " ")
		.trim();
	return name ? name.replace(/^./u, (character) => character.toUpperCase()) : "Tool";
}

function limitedPayload(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	try {
		return typeof value === "string" ? value : JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}
