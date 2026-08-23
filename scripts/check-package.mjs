import { existsSync, readFileSync, readdirSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const expectedExports = [
	".",
	"./http",
	"./testing",
	"./harness",
	"./harness/testing",
	"./observability",
	"./observability/core",
	"./observability/http",
	"./observability/testing",
	"./package.json",
];

for (const entry of expectedExports) {
	if (packageJson.exports?.[entry] === undefined) {
		throw new Error(`Missing package export: ${entry}`);
	}
}

for (const file of [
	"../dist/index.mjs",
	"../dist/index.d.mts",
	"../dist/http/index.mjs",
	"../dist/http/index.d.mts",
	"../dist/testing/index.mjs",
	"../dist/testing/index.d.mts",
	"../dist/harness/index.mjs",
	"../dist/harness/index.d.mts",
	"../dist/harness/testing/index.mjs",
	"../dist/harness/testing/index.d.mts",
	"../dist/observability/index.mjs",
	"../dist/observability/index.d.mts",
	"../dist/observability/core/index.mjs",
	"../dist/observability/core/index.d.mts",
	"../dist/observability/http/index.mjs",
	"../dist/observability/http/index.d.mts",
	"../dist/observability/testing/index.mjs",
	"../dist/observability/testing/index.d.mts",
]) {
	if (!existsSync(new URL(file, import.meta.url))) {
		throw new Error(`Missing build artifact: ${file.replace("../", "")}`);
	}
}

for (const privateExport of ["./dashboard", "./playground", "./observability/dashboard"]) {
	if (packageJson.exports?.[privateExport] !== undefined) {
		throw new Error(`Private workspace app must not become a package export: ${privateExport}`);
	}
}

if (packageJson.files.some((path) => path === "apps" || path.startsWith("apps/"))) {
	throw new Error("Private workspace apps must not be included in the published file list");
}

for (const privatePackagePath of [
	"../apps/control-plane-web/package.json",
	"../apps/multi-model-playground/package.json",
]) {
	const privatePackage = JSON.parse(
		readFileSync(new URL(privatePackagePath, import.meta.url), "utf8"),
	);
	if (privatePackage.private !== true) {
		throw new Error(`${privatePackagePath} must remain private`);
	}
}

for (const localEnvironmentPath of [
	"../apps/control-plane-web/.env.local",
	"../apps/multi-model-playground/.env.local",
]) {
	if (existsSync(new URL(localEnvironmentPath, import.meta.url))) {
		throw new Error(`Real local environment files must not be committed: ${localEnvironmentPath}`);
	}
}

for (const privateDependency of [
	"@ai-sdk/anthropic",
	"@ai-sdk/google",
	"@ai-sdk/openai",
	"@openai/sites-vite-plugin",
	"@tanstack/react-query",
	"next",
	"react",
	"react-dom",
]) {
	if (
		packageJson.dependencies?.[privateDependency] !== undefined ||
		packageJson.peerDependencies?.[privateDependency] !== undefined
	) {
		throw new Error(
			`Private app dependency leaked into the published package: ${privateDependency}`,
		);
	}
}

if (existsSync(new URL("../dist/apps", import.meta.url))) {
	throw new Error("Private workspace apps must not be emitted into dist");
}

const readArtifact = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const rootArtifacts = [
	...readLocalArtifactGraph("../dist/index.mjs"),
	...readLocalArtifactGraph("../dist/index.d.mts"),
];
if (rootArtifacts.some((source) => source.toLowerCase().includes("observability"))) {
	throw new Error("The root entry point must remain free of observability exports");
}

for (const extension of ["mjs", "d.mts"]) {
	const core = readArtifact(`../dist/observability/core/index.${extension}`);
	if (core.includes("@nestjs/")) {
		throw new Error("The observability core entry point must remain framework-neutral");
	}
	if (/from\s+["']ai(?:\/|["'])/.test(core)) {
		throw new Error("The observability core entry point must not load AI SDK");
	}

	const http = readArtifact(`../dist/observability/http/index.${extension}`);
	if (/from\s+["']ai(?:\/|["'])/.test(http)) {
		throw new Error("The observability HTTP entry point must not load AI SDK");
	}
	for (const platformPackage of [
		"@nestjs/platform-express",
		"@nestjs/platform-fastify",
		"express",
		"fastify",
	]) {
		if (http.includes(platformPackage)) {
			throw new Error(
				`Observability HTTP entry point must remain platform-neutral: ${platformPackage}`,
			);
		}
	}

	const testing = readArtifact(`../dist/observability/testing/index.${extension}`);
	if (/from\s+["']ai(?:\/|["'])/.test(testing)) {
		throw new Error("The observability testing entry point must not load AI SDK");
	}
}

function readLocalArtifactGraph(entryPath) {
	const pending = [new URL(entryPath, import.meta.url)];
	const visited = new Set();
	const sources = [];

	while (pending.length > 0) {
		const requestedArtifact = pending.pop();
		if (requestedArtifact === undefined) continue;
		let artifact = requestedArtifact;
		if (!existsSync(artifact) && artifact.pathname.endsWith(".mjs")) {
			const declarationArtifact = new URL(artifact);
			declarationArtifact.pathname = declarationArtifact.pathname.replace(/\.mjs$/u, ".d.mts");
			artifact = declarationArtifact;
		}
		if (visited.has(artifact.href)) continue;
		visited.add(artifact.href);

		const source = readFileSync(artifact, "utf8");
		sources.push(source);
		for (const match of source.matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/gu)) {
			const specifier = match[1];
			if (specifier !== undefined) pending.push(new URL(specifier, artifact));
		}
	}

	return sources;
}

const runtimeFiles = readdirSync(new URL("../dist", import.meta.url), {
	recursive: true,
	withFileTypes: true,
})
	.filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
	.map((entry) => readFileSync(`${entry.parentPath}/${entry.name}`, "utf8"));

if (!runtimeFiles.some((source) => source.includes("design:paramtypes"))) {
	throw new Error("Decorator metadata is missing from the build output");
}
