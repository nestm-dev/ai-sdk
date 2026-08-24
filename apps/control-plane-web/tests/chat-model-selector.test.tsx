import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatModelSelector, MODEL_SELECTOR_LOCKED_MESSAGE } from "@/components/chat-model-selector";
import type { ProviderDescription } from "@/lib/chat-schema";

const PROVIDERS: readonly ProviderDescription[] = [
	{ provider: "openai", model: "gpt-5-mini" },
	{ provider: "anthropic", model: "claude-haiku-4-5" },
	{ provider: "google", model: "gemini-2.5-flash" },
];

describe("chat model selector", () => {
	it("allows model selection before the conversation starts", () => {
		const onProviderChange = vi.fn();
		render(<ChatModelSelector {...defaultProps()} onProviderChange={onProviderChange} />);

		const selector = screen.getByRole("combobox", { name: "Model" });
		expect(selector).toBeEnabled();
		expect(selector).not.toHaveAttribute("aria-describedby");

		fireEvent.change(selector, { target: { value: "anthropic" } });
		expect(onProviderChange).toHaveBeenCalledWith("anthropic");
	});

	it("locks model selection after the first message with an accessible explanation", () => {
		render(<ChatModelSelector {...defaultProps()} messageCount={1} />);

		const selector = screen.getByRole("combobox", { name: "Model" });
		expect(selector).toBeDisabled();
		expect(selector).toHaveAttribute("title", MODEL_SELECTOR_LOCKED_MESSAGE);
		expect(selector).toHaveAccessibleDescription(MODEL_SELECTOR_LOCKED_MESSAGE);
		expect(screen.getByText(MODEL_SELECTOR_LOCKED_MESSAGE)).toBeVisible();
	});

	it("preserves active-run and provider-catalog disabling and retry behavior", () => {
		const onRetryProviders = vi.fn();
		const { rerender } = render(
			<ChatModelSelector {...defaultProps()} activeRun onRetryProviders={onRetryProviders} />,
		);

		expect(screen.getByRole("combobox", { name: "Model" })).toBeDisabled();
		expect(screen.queryByText(MODEL_SELECTOR_LOCKED_MESSAGE)).not.toBeInTheDocument();

		rerender(
			<ChatModelSelector
				{...defaultProps()}
				onRetryProviders={onRetryProviders}
				providersError="Provider catalog unavailable"
			/>,
		);
		expect(screen.getByRole("combobox", { name: "Model" })).toBeDisabled();
		expect(screen.getByRole("alert")).toHaveAttribute("title", "Provider catalog unavailable");

		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(onRetryProviders).toHaveBeenCalledOnce();
	});
});

function defaultProps() {
	return {
		activeRun: false,
		disabled: false,
		messageCount: 0,
		onProviderChange: vi.fn(),
		onRetryProviders: vi.fn(),
		provider: "openai" as const,
		providers: PROVIDERS,
	};
}
