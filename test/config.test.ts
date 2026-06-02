import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_CONFIG, loadConfig } from "../extensions/title-renamer/config.ts";
import { parseModelSpec } from "../extensions/title-renamer/generator.ts";

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pi-title-renamer-"));
}

test("loadConfig merges global and project config with nested project overrides", () => {
	const root = makeTempDir();
	try {
		const home = path.join(root, "home");
		const cwd = path.join(root, "project");
		fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
		fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });

		fs.writeFileSync(
			path.join(home, ".pi", "agent", "title-renamer.json"),
			JSON.stringify({
				model: "openrouter/anthropic/claude-sonnet",
				apply: { sessionName: true },
				style: { maxChars: 18, separator: " - " },
				input: { includeModel: true },
			}),
		);
		fs.writeFileSync(
			path.join(cwd, ".pi", "title-renamer.json"),
			JSON.stringify({
				apply: { overwriteSessionName: true },
				style: { language: "en" },
			}),
		);

		const loaded = loadConfig(cwd, { homeDir: home });
		assert.deepEqual(loaded.warnings, []);
		assert.equal(loaded.config.model, "openrouter/anthropic/claude-sonnet");
		assert.equal(loaded.config.apply.terminalTitle, DEFAULT_CONFIG.apply.terminalTitle);
		assert.equal(loaded.config.apply.sessionName, true);
		assert.equal(loaded.config.apply.overwriteSessionName, true);
		assert.equal(loaded.config.style.maxChars, 18);
		assert.equal(loaded.config.style.separator, " - ");
		assert.equal(loaded.config.style.language, "en");
		assert.equal(loaded.config.input.includeModel, true);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("parseModelSpec supports inherit", () => {
	assert.deepEqual(parseModelSpec("inherit"), { kind: "inherit" });
});

test("parseModelSpec splits provider at the first slash", () => {
	assert.deepEqual(parseModelSpec("openrouter/anthropic/claude-sonnet"), {
		kind: "explicit",
		provider: "openrouter",
		modelId: "anthropic/claude-sonnet",
	});
});

test("parseModelSpec rejects malformed explicit model", () => {
	assert.throws(() => parseModelSpec("openrouter"), /provider\/model-id/);
});
