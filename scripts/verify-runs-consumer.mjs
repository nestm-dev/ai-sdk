import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = await mkdtemp(join(tmpdir(), "ai-runs-consumer-"));
try {
	const { version } = JSON.parse(await readFile("package.json", "utf8"));
	execFileSync("pnpm", ["pack", "--pack-destination", directory], { stdio: "inherit" });
	await writeFile(
		join(directory, "package.json"),
		JSON.stringify({
			private: true,
			type: "module",
			dependencies: { "@nestm/ai-sdk": `file:./nestm-ai-sdk-${version}.tgz`, typescript: "7.0.2" },
		}),
	);
	execFileSync("pnpm", ["install", "--ignore-workspace", "--ignore-scripts"], {
		cwd: directory,
		stdio: "inherit",
	});
	await writeFile(
		join(directory, "consumer.ts"),
		`
 import { AiSdkRunStreamRegistry, type AiSdkRunReplay } from "@nestm/ai-sdk/runs";
 type Event = { count: number; done?: boolean };
 const registry = new AiSdkRunStreamRegistry<Event, { label: string }>({ createReplay: (): AiSdkRunReplay<Event> => {
   let latest: Event | undefined;
   return { append(event) { latest = event; }, createCursor() { let seen: Event | undefined; return () => { const events = latest && seen !== latest ? [latest] : []; seen = latest; return { events, done: latest?.done ?? false }; }; } };
 } });
 const reservation = registry.reserve("counter"); let executions = 0;
 registry.launch(reservation, async () => ({ metadata: { label: "Counter" }, events: (async function* () { executions++; yield { count: 2, done: true }; })() }));
 for (let i = 0; i < 2; i++) {
   const stream = await registry.subscribe("counter", new AbortController().signal);
   if (stream?.metadata.label !== "Counter") throw new Error("Metadata missing");
   const result: Event[] = []; for await (const event of stream.events) result.push(event);
   if (result.at(-1)?.count !== 2) throw new Error("Replay missing");
 }
 if (executions !== 1) throw new Error("Duplicate execution");
 await registry.shutdown();
 `,
	);
	execFileSync(
		"pnpm",
		[
			"exec",
			"tsc",
			"--strict",
			"--skipLibCheck",
			"--target",
			"ES2022",
			"--module",
			"NodeNext",
			"consumer.ts",
		],
		{ cwd: directory, stdio: "inherit" },
	);
	execFileSync(process.execPath, ["consumer.js"], { cwd: directory, stdio: "inherit" });
	const root = await readFile("dist/index.mjs", "utf8");
	assert.doesNotMatch(root, /AiSdkRunStreamRegistry/);
	const runs = await readFile("dist/runs/index.mjs", "utf8");
	assert.doesNotMatch(runs, /from ["'](?:@nestjs|@ai-sdk|ai["'])/);
	const harness = execFileSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			'try { import.meta.resolve("@ai-sdk/harness"); process.exit(1); } catch { console.log("absent"); }',
		],
		{ cwd: directory, encoding: "utf8" },
	);
	assert.match(harness, /absent/);
	console.log("Packed run-stream consumer uses typed projection without Harness or product types.");
} finally {
	await rm(directory, { recursive: true, force: true });
}
