import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tag = process.env.AI_SDK_HARNESS_CANARY_TAG ?? "latest";
const packageNames = [
	"ai",
	"@ai-sdk/harness",
	"@ai-sdk/harness-claude-code",
	"@ai-sdk/harness-codex",
	"@ai-sdk/sandbox-vercel",
	"@ai-sdk/workflow-harness",
];
const directory = await mkdtemp(join(tmpdir(), "nestm-ai-sdk-harness-canary-"));

try {
	await writeFile(
		join(directory, "package.json"),
		JSON.stringify({ private: true, type: "module" }, undefined, 2),
	);
	await run("pnpm", [
		"add",
		"--ignore-workspace",
		"--dir",
		directory,
		...packageNames.map((name) => `${name}@${tag}`),
	]);

	const manifests = new Map(
		await Promise.all(packageNames.map(async (name) => [name, await manifest(directory, name)])),
	);
	const ai = requiredManifest(manifests, "ai");
	const harness = requiredManifest(manifests, "@ai-sdk/harness");
	assertDependency(harness, "ai", ai.version);
	for (const name of packageNames.slice(2)) {
		assertDependency(requiredManifest(manifests, name), "@ai-sdk/harness", harness.version);
	}

	await writeFile(
		join(directory, "fixture.mjs"),
		`import { HarnessAgent } from "@ai-sdk/harness/agent";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import { createCodex } from "@ai-sdk/harness-codex";
import { createVercelSandbox } from "@ai-sdk/sandbox-vercel";
import "@ai-sdk/workflow-harness";

const sandbox = createVercelSandbox({ runtime: "node24", ports: [43123] });
const claude = new HarnessAgent({ harness: createClaudeCode(), sandbox });
const codex = new HarnessAgent({ harness: createCodex(), sandbox, permissionMode: "allow-all" });
if (claude.harnessId !== "claude-code" || codex.harnessId !== "codex") {
  throw new Error("Candidate adapters did not preserve their Harness identifiers.");
}
`,
	);
	await run(process.execPath, [join(directory, "fixture.mjs")]);
	process.stdout.write(
		`Harness candidate train is internally aligned: ai@${ai.version}, harness@${harness.version}.\n`,
	);
} finally {
	await rm(directory, { recursive: true, force: true });
}

async function manifest(baseDirectory, name) {
	const path = join(baseDirectory, "node_modules", ...name.split("/"), "package.json");
	return JSON.parse(await readFile(path, "utf8"));
}

function requiredManifest(manifests, name) {
	const value = manifests.get(name);
	if (value === undefined) throw new Error(`Missing installed manifest for ${name}.`);
	return value;
}

function assertDependency(packageManifest, dependency, expected) {
	const actual = packageManifest.dependencies?.[dependency];
	if (actual !== expected) {
		throw new Error(
			`${packageManifest.name}@${packageManifest.version} requires ${dependency}@${actual ?? "missing"}; installed candidate is ${expected}.`,
		);
	}
}

function run(command, arguments_) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, arguments_, { stdio: "inherit" });
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(
				new Error(
					`${command} exited with ${code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`}.`,
				),
			);
		});
	});
}
