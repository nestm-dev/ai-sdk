"use client";

import { Eraser, LoaderCircle, Play, TriangleAlert } from "lucide-react";
import { useState, type FormEvent } from "react";

import { comparisonSchema, type Comparison, type ProviderId } from "@/lib/compare-schema";
import { formatCount, formatDuration } from "@/lib/view-model";

const PROVIDERS: readonly { readonly id: ProviderId; readonly label: string }[] = [
	{ id: "openai", label: "OpenAI" },
	{ id: "anthropic", label: "Anthropic" },
	{ id: "google", label: "Gemini" },
];
const DEFAULT_PROMPT = "In one sentence, explain why content-free AI telemetry matters.";
type FailureCode = Extract<Comparison["results"][number], { status: "error" }>["code"];

export function ModelPlayground({ onCompleted }: { readonly onCompleted: () => void }) {
	const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
	const [providers, setProviders] = useState<readonly ProviderId[]>(
		PROVIDERS.map((provider) => provider.id),
	);
	const [comparison, setComparison] = useState<Comparison>();
	const [error, setError] = useState<string>();
	const [running, setRunning] = useState(false);

	async function run(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (running || providers.length === 0 || prompt.trim() === "") return;
		setRunning(true);
		setError(undefined);
		try {
			const response = await fetch("/api/compare", {
				method: "POST",
				cache: "no-store",
				headers: { accept: "application/json", "content-type": "application/json" },
				body: JSON.stringify({ prompt: prompt.trim(), providers }),
			});
			if (!response.ok) throw new Error("unavailable");
			const parsed = comparisonSchema.safeParse(await response.json());
			if (!parsed.success) throw new Error("invalid");
			setComparison(parsed.data);
			onCompleted();
		} catch {
			setError(
				"The local playground could not complete this comparison. Check its process and provider credentials.",
			);
		} finally {
			setRunning(false);
		}
	}

	function toggleProvider(provider: ProviderId) {
		setProviders((current) =>
			current.includes(provider)
				? current.filter((candidate) => candidate !== provider)
				: PROVIDERS.map((candidate) => candidate.id).filter(
						(candidate) => candidate === provider || current.includes(candidate),
					),
		);
	}

	return (
		<section className="playground-panel" aria-labelledby="playground-heading">
			<div className="playground-copy">
				<p className="eyebrow">Local model lab</p>
				<h2 id="playground-heading">Compare providers, then inspect the telemetry</h2>
				<p>
					Responses live only in this browser state. Prompts and outputs are never added to the
					observability snapshot.
				</p>
			</div>
			<form className="playground-form" onSubmit={(event) => void run(event)}>
				<label htmlFor="comparison-prompt">Prompt</label>
				<textarea
					id="comparison-prompt"
					maxLength={1_000}
					rows={3}
					value={prompt}
					onChange={(event) => setPrompt(event.target.value)}
				/>
				<fieldset>
					<legend>Providers</legend>
					<div className="provider-toggles">
						{PROVIDERS.map((provider) => (
							<label key={provider.id}>
								<input
									checked={providers.includes(provider.id)}
									type="checkbox"
									onChange={() => toggleProvider(provider.id)}
								/>
								<span>{provider.label}</span>
							</label>
						))}
					</div>
				</fieldset>
				<button
					className="run-button"
					disabled={running || providers.length === 0 || prompt.trim() === ""}
					type="submit"
				>
					{running ? (
						<LoaderCircle aria-hidden="true" className="animate-spin" />
					) : (
						<Play aria-hidden="true" />
					)}
					{running ? "Comparing…" : `Run ${formatCount(providers.length)} models`}
				</button>
			</form>

			{error ? (
				<div className="playground-error" role="alert">
					<TriangleAlert aria-hidden="true" />
					{error}
				</div>
			) : null}

			{comparison ? (
				<div className="playground-results" aria-live="polite">
					<div className="results-heading">
						<p>
							{formatCount(comparison.summary.succeeded)} succeeded ·{" "}
							{formatCount(comparison.summary.failed)} failed
						</p>
						<button type="button" onClick={() => setComparison(undefined)}>
							<Eraser aria-hidden="true" /> Clear responses
						</button>
					</div>
					<div className="result-grid">
						{comparison.results.map((result) => (
							<article key={result.provider} className={`result-card ${result.status}`}>
								<div className="result-meta">
									<strong>{providerLabel(result.provider)}</strong>
									<span>{result.model}</span>
								</div>
								{result.status === "success" ? (
									<>
										<p className="result-text">{result.text}</p>
										<p className="result-foot">
											{formatDuration(result.latencyMs)} ·{" "}
											{result.usage.totalTokens === null
												? "tokens not reported"
												: `${formatCount(result.usage.totalTokens)} tokens`}
										</p>
									</>
								) : (
									<>
										<p className="result-text is-error">{failureLabel(result.code)}</p>
										<p className="result-foot">
											{formatDuration(result.latencyMs)} ·{" "}
											{result.retryable ? "retryable" : "check configuration"}
										</p>
									</>
								)}
							</article>
						))}
					</div>
				</div>
			) : null}
		</section>
	);
}

function providerLabel(provider: ProviderId): string {
	return PROVIDERS.find((candidate) => candidate.id === provider)?.label ?? provider;
}

function failureLabel(code: FailureCode): string {
	switch (code) {
		case "unauthorized":
			return "Credential rejected by provider.";
		case "rate_limited":
			return "Provider rate limit reached.";
		case "timeout_or_cancelled":
			return "Provider request timed out.";
		case "request_rejected":
			return "Provider rejected this request or model.";
		case "provider_unavailable":
			return "Provider is temporarily unavailable.";
		case "generation_failed":
			return "Generation failed safely.";
	}
}
