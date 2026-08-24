"use client";

import { RotateCcw } from "lucide-react";
import { useId } from "react";

import { CHAT_PROVIDER_LABELS, type ChatView, type ProviderDescription } from "@/lib/chat-schema";

export const MODEL_SELECTOR_LOCKED_MESSAGE = "Start a new chat to use another model.";

interface ChatModelSelectorProps {
	readonly activeRun: boolean;
	readonly disabled: boolean;
	readonly messageCount: number;
	readonly onProviderChange: (provider: ChatView["provider"]) => void;
	readonly onRetryProviders: () => void;
	readonly provider: ChatView["provider"];
	readonly providers: readonly ProviderDescription[];
	readonly providersError?: string;
}

export function ChatModelSelector({
	activeRun,
	disabled,
	messageCount,
	onProviderChange,
	onRetryProviders,
	provider,
	providers,
	providersError,
}: ChatModelSelectorProps) {
	const lockDescriptionId = useId();
	const modelLocked = messageCount > 0;

	return (
		<div className="model-control">
			<label
				className="model-select"
				title={modelLocked ? MODEL_SELECTOR_LOCKED_MESSAGE : undefined}
			>
				<span>Model</span>
				<select
					aria-describedby={modelLocked ? lockDescriptionId : undefined}
					aria-label="Model"
					disabled={disabled || activeRun || providersError !== undefined || modelLocked}
					title={modelLocked ? MODEL_SELECTOR_LOCKED_MESSAGE : undefined}
					value={provider}
					onChange={(event) => onProviderChange(event.target.value as ChatView["provider"])}
				>
					{providers.map((providerOption) => (
						<option key={providerOption.provider} value={providerOption.provider}>
							{CHAT_PROVIDER_LABELS[providerOption.provider]} · {providerOption.model}
						</option>
					))}
				</select>
			</label>
			{modelLocked ? (
				<p className="model-lock-message" id={lockDescriptionId}>
					{MODEL_SELECTOR_LOCKED_MESSAGE}
				</p>
			) : null}
			{providersError ? (
				<div className="model-catalog-error" role="alert" title={providersError}>
					<span>Models unavailable</span>
					<button type="button" onClick={onRetryProviders}>
						<RotateCcw aria-hidden="true" /> Retry
					</button>
				</div>
			) : null}
		</div>
	);
}
