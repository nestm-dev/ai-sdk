import { existsSync, readFileSync, readdirSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const expectedExports = [
	".",
	"./http",
	"./testing",
	"./harness",
	"./harness/testing",
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
]) {
	if (!existsSync(new URL(file, import.meta.url))) {
		throw new Error(`Missing build artifact: ${file.replace("../", "")}`);
	}
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
