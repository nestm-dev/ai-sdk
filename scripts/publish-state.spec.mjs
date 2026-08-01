import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import { resolvePrereleaseTag } from "./publish-state.mjs";

const workspaceRequire = createRequire(import.meta.url);
const changesetsRequire = createRequire(workspaceRequire.resolve("@changesets/cli/package.json"));
const assembleReleasePlan = changesetsRequire("@changesets/assemble-release-plan").default;
const { defaultConfig } = changesetsRequire("@changesets/config");

describe("resolvePrereleaseTag", () => {
	it("keeps the initial alpha changeset pending for the alpha.1 release PR", () => {
		const packageJson = JSON.parse(
			readFileSync(new URL("../package.json", import.meta.url), "utf8"),
		);
		const preState = JSON.parse(
			readFileSync(new URL("../.changeset/pre.json", import.meta.url), "utf8"),
		);
		const initialChangesetUrl = new URL("../.changeset/initial-ai-sdk-release.md", import.meta.url);

		expect(preState.initialVersions["@nestm/ai-sdk"]).toBe("0.1.0-alpha.0");

		if (existsSync(initialChangesetUrl)) {
			expect(packageJson.version).toBe("0.1.0-alpha.0");
			expect(preState.changesets).not.toContain("initial-ai-sdk-release");
		} else {
			// Once Changesets creates the version PR, the file is consumed and the
			// package advances. Keep that release PR's CI green as well.
			expect(packageJson.version).toMatch(/^0\.1\.0-alpha\.[1-9][0-9]*$/);
			expect(preState.changesets).toContain("initial-ai-sdk-release");
		}
	});

	it("assembles the pending initial changeset as alpha.1", () => {
		const packageName = "@nestm/ai-sdk";
		const plan = assembleReleasePlan(
			[
				{
					id: "initial-ai-sdk-release",
					summary: "Initial release",
					releases: [{ name: packageName, type: "minor" }],
				},
			],
			{
				root: {
					dir: "/virtual",
					packageJson: { name: "release-plan-fixture", private: true },
				},
				packages: [
					{
						dir: "/virtual/ai-sdk",
						packageJson: { name: packageName, version: "0.1.0-alpha.0" },
					},
				],
				tool: "pnpm",
			},
			defaultConfig,
			{
				mode: "pre",
				tag: "alpha",
				initialVersions: { [packageName]: "0.1.0-alpha.0" },
				changesets: [],
			},
		);

		expect(plan.releases).toEqual([
			expect.objectContaining({
				name: packageName,
				oldVersion: "0.1.0-alpha.0",
				newVersion: "0.1.0-alpha.1",
				changesets: ["initial-ai-sdk-release"],
			}),
		]);
	});

	it("uses the active Changesets prerelease tag", () => {
		expect(
			resolvePrereleaseTag("0.1.0-alpha.2", {
				mode: "pre",
				tag: "alpha",
			}),
		).toBe("alpha");
	});

	it("allows stable versions outside prerelease mode", () => {
		expect(resolvePrereleaseTag("1.0.0", undefined)).toBeUndefined();
	});

	it("rejects a prerelease without Changesets prerelease mode", () => {
		expect(() => resolvePrereleaseTag("0.1.0-alpha.2", undefined)).toThrow(
			"requires Changesets pre mode",
		);
	});

	it("rejects a mismatched prerelease tag", () => {
		expect(() =>
			resolvePrereleaseTag("0.1.0-beta.1", {
				mode: "pre",
				tag: "alpha",
			}),
		).toThrow("does not match Changesets tag alpha");
	});

	it("rejects a stable version in prerelease mode", () => {
		expect(() =>
			resolvePrereleaseTag("1.0.0", {
				mode: "pre",
				tag: "alpha",
			}),
		).toThrow("cannot publish in Changesets pre mode");
	});

	it("rejects invalid input", () => {
		expect(() => resolvePrereleaseTag(undefined, undefined)).toThrow(TypeError);
		expect(() =>
			resolvePrereleaseTag("0.1.0-alpha.0", {
				mode: "pre",
				tag: "",
			}),
		).toThrow("non-empty tag");
	});
});
