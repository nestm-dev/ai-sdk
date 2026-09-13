import { InvalidToolInputError, type ModelMessage, type StepResult, type ToolSet } from "ai";

const MAX_ISSUES = 8;
const MAX_DIAGNOSTIC_BYTES = 2048;
const encoder = new TextEncoder();
const issueCodes = new Set([
	"invalid_type",
	"too_big",
	"too_small",
	"invalid_value",
	"invalid_format",
	"unrecognized_keys",
	"invalid_union",
	"not_multiple_of",
	"custom",
]);
const expectedTypes = new Set([
	"string",
	"number",
	"boolean",
	"object",
	"array",
	"null",
	"undefined",
]);

interface InputDiagnostic {
	readonly toolName: string;
	readonly text: string;
}

/**
 * One instance per execution. Records native validation failures without retaining
 * rejected inputs/errors, and replaces only their model-facing error results.
 * Does not execute, repair, prune, or change the original assistant tool call.
 */
export function createAiSdkToolInputDiagnostics() {
	const failures = new Map<string, InputDiagnostic>();
	return {
		recordStep(this: void, step: Pick<StepResult<ToolSet>, "toolCalls">): void {
			for (const call of step.toolCalls) {
				if (call.invalid === true && InvalidToolInputError.isInstance(call.error)) {
					failures.set(call.toolCallId, {
						toolName: call.toolName,
						text: formatDiagnostic(call.error),
					});
				}
			}
		},
		prepareMessages(this: void, messages: ModelMessage[]): ModelMessage[] {
			return messages.map((message) => {
				if (message.role !== "tool") return message;
				return {
					...message,
					content: message.content.map((part) => {
						if (part.type !== "tool-result") return part;
						const failure = failures.get(part.toolCallId);
						if (
							failure?.toolName !== part.toolName ||
							(part.output.type !== "error-text" && part.output.type !== "error-json")
						)
							return part;
						return { ...part, output: { type: "error-text" as const, value: failure.text } };
					}),
				};
			});
		},
		clear(this: void): void {
			failures.clear();
		},
	};
}

function formatDiagnostic(error: InvalidToolInputError): string {
	const issues = findIssues(error.cause)
		.slice(0, MAX_ISSUES)
		.map((issue) => {
			const path = Array.isArray(issue.path)
				? issue.path.slice(0, 8).map((segment: unknown) => {
						if (typeof segment === "number" && Number.isSafeInteger(segment)) return segment;
						if (typeof segment === "string")
							return segment.slice(0, 64).replace(/[\uD800-\uDBFF]$/u, "");
						return "?";
					})
				: [];
			const code =
				typeof issue.code === "string" && issueCodes.has(issue.code) ? issue.code : "constraint";
			return {
				path,
				code,
				...(typeof issue.expected === "string" && expectedTypes.has(issue.expected)
					? { expected: issue.expected }
					: {}),
				...(typeof issue.maximum === "number" && Number.isFinite(issue.maximum)
					? { maximum: issue.maximum }
					: {}),
				...(typeof issue.minimum === "number" && Number.isFinite(issue.minimum)
					? { minimum: issue.minimum }
					: {}),
			};
		});
	const diagnostic = {
		code: "INVALID_TOOL_INPUT",
		applied: false,
		issues,
		guidance:
			"The tool was not executed. Correct the listed argument paths using the tool schema and field descriptions. Observe per-call and aggregate limits. Retain existing work; do not repeat the unchanged rejected input.",
	};
	let text = JSON.stringify(diagnostic);
	while (encoder.encode(text).byteLength > MAX_DIAGNOSTIC_BYTES && issues.length > 0) {
		issues.pop();
		text = JSON.stringify(diagnostic);
	}
	return text;
}

function findIssues(cause: unknown): Record<string, unknown>[] {
	for (let depth = 0; depth < 4 && isRecord(cause); depth++) {
		if (Array.isArray(cause.issues)) return cause.issues.filter(isRecord);
		cause = cause.cause;
	}
	return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
