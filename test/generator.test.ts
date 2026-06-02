import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../extensions/title-renamer/config.ts";
import { normalizeGeneratedTitle } from "../extensions/title-renamer/generator.ts";

test("normalizeGeneratedTitle moves project name to suffix", () => {
	assert.equal(
		normalizeGeneratedTitle("pi-title-renamer｜自動標題", DEFAULT_CONFIG, {
			projectName: "pi-title-renamer",
		}),
		"自動標題｜pi-title-renamer",
	);
});

test("normalizeGeneratedTitle keeps existing project suffix", () => {
	assert.equal(
		normalizeGeneratedTitle("自動標題｜pi-title-renamer", DEFAULT_CONFIG, {
			projectName: "pi-title-renamer",
		}),
		"自動標題｜pi-title-renamer",
	);
});

test("normalizeGeneratedTitle appends project suffix within max length", () => {
	const config = {
		...DEFAULT_CONFIG,
		style: { ...DEFAULT_CONFIG.style, maxChars: 12 },
	};
	const title = normalizeGeneratedTitle("很長很長很長主題", config, {
		projectName: "project",
	});

	assert.equal(Array.from(title).length <= config.style.maxChars, true);
	assert.equal(title.endsWith("｜project"), true);
});
