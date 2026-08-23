import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const applications = [
	{
		name: "multi-model-playground",
		root: join(repositoryRoot, "apps/multi-model-playground"),
		sourceRoots: ["src"],
	},
	{
		name: "control-plane-web",
		root: join(repositoryRoot, "apps/control-plane-web"),
		sourceRoots: ["app", "components", "lib"],
	},
];

for (const application of applications) {
	const files = application.sourceRoots.flatMap((sourceRoot) =>
		collectTypeScriptFiles(join(application.root, sourceRoot)),
	);
	const fileSet = new Set(files);
	const graph = new Map(
		files.map((file) => [
			file,
			readModuleSpecifiers(file)
				.map((specifier) => resolveLocalImport(application.root, file, specifier))
				.filter((dependency) => dependency !== undefined && fileSet.has(dependency)),
		]),
	);

	assertAcyclic(application.name, application.root, graph);
	console.log(`Checked ${String(files.length)} ${application.name} source files: no cycles.`);
}

function collectTypeScriptFiles(directory) {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true })
		.flatMap((entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) return collectTypeScriptFiles(path);
			return entry.isFile() && (path.endsWith(".ts") || path.endsWith(".tsx")) ? [path] : [];
		})
		.toSorted((left, right) => left.localeCompare(right));
}

function readModuleSpecifiers(file) {
	const source = readFileSync(file, "utf8");
	const specifiers = [];
	const staticImport =
		/(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^;"']*?\s+from\s+)?["']([^"']+)["']/gu;
	const dynamicImport = /\bimport\(\s*["']([^"']+)["']\s*\)/gu;

	for (const pattern of [staticImport, dynamicImport]) {
		for (const match of source.matchAll(pattern)) {
			if (match[1] !== undefined) specifiers.push(match[1]);
		}
	}
	return specifiers;
}

function resolveLocalImport(applicationRoot, importer, specifier) {
	let basePath;
	if (specifier.startsWith("@/")) {
		basePath = join(applicationRoot, specifier.slice(2));
	} else if (specifier.startsWith(".")) {
		basePath = resolve(dirname(importer), specifier);
	} else {
		return undefined;
	}

	const candidates = extname(basePath)
		? [basePath]
		: [
				`${basePath}.ts`,
				`${basePath}.tsx`,
				join(basePath, "index.ts"),
				join(basePath, "index.tsx"),
			];
	const resolved = candidates.find(
		(candidate) => existsSync(candidate) && statSync(candidate).isFile(),
	);
	if (resolved === undefined) {
		throw new Error(
			`Cannot resolve local import ${JSON.stringify(specifier)} from ${relative(repositoryRoot, importer)}`,
		);
	}
	return resolved;
}

function assertAcyclic(name, applicationRoot, graph) {
	const state = new Map();
	const stack = [];

	for (const file of graph.keys()) visit(file);

	function visit(file) {
		const currentState = state.get(file);
		if (currentState === "complete") return;
		if (currentState === "visiting") {
			const cycleStart = stack.indexOf(file);
			const cycle = [...stack.slice(cycleStart), file]
				.map((entry) => relative(applicationRoot, entry))
				.join(" -> ");
			throw new Error(`Circular dependency in ${name}: ${cycle}`);
		}

		state.set(file, "visiting");
		stack.push(file);
		for (const dependency of graph.get(file) ?? []) visit(dependency);
		stack.pop();
		state.set(file, "complete");
	}
}
