import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../extensions/title-renamer/config.ts";
import { buildFallbackTitle } from "../extensions/title-renamer/generator.ts";
import {
	blocksAutoRename,
	getLatestResetIndex,
	getLatestTitleRenamerState,
	getLatestTitleToReapply,
	hasAutoRenamed,
	makeTitleRenamerState,
	STATE_CUSTOM_TYPE,
} from "../extensions/title-renamer/state.ts";

test("state detects latest automatic rename", () => {
	const state = makeTitleRenamerState({
		autoRenamed: true,
		title: "Pi｜project",
		model: "inherit",
		resolvedModel: "openai/gpt-test",
		manual: false,
		now: new Date("2026-06-02T00:00:00.000Z"),
	});
	const entries = [
		{ type: "custom", customType: STATE_CUSTOM_TYPE, data: state },
	];

	assert.equal(hasAutoRenamed(entries), true);
	assert.deepEqual(getLatestTitleRenamerState(entries), state);
});

test("reset state clears automatic rename detection without deleting history", () => {
	const entries = [
		{
			type: "custom",
			customType: STATE_CUSTOM_TYPE,
			data: makeTitleRenamerState({
				autoRenamed: true,
				title: "old",
				model: "inherit",
				manual: false,
			}),
		},
		{
			type: "custom",
			customType: STATE_CUSTOM_TYPE,
			data: makeTitleRenamerState({
				autoRenamed: false,
				model: "inherit",
				manual: true,
				reset: true,
			}),
		},
	];

	assert.equal(hasAutoRenamed(entries), false);
	assert.equal(getLatestResetIndex(entries), 1);
	assert.equal(getLatestTitleRenamerState(entries)?.reset, true);
});

test("manual rename state does not clear prior automatic rename detection", () => {
	const entries = [
		{
			type: "custom",
			customType: STATE_CUSTOM_TYPE,
			data: makeTitleRenamerState({
				autoRenamed: true,
				title: "auto",
				model: "inherit",
				manual: false,
			}),
		},
		{
			type: "custom",
			customType: STATE_CUSTOM_TYPE,
			data: makeTitleRenamerState({
				autoRenamed: false,
				title: "manual",
				model: "inherit",
				manual: true,
			}),
		},
	];

	assert.equal(hasAutoRenamed(entries), true);
	assert.equal(getLatestTitleRenamerState(entries)?.title, "manual");
});

test("manual title blocks future automatic rename until reset", () => {
	const entries = [
		{
			type: "custom",
			customType: STATE_CUSTOM_TYPE,
			data: makeTitleRenamerState({
				autoRenamed: false,
				title: "manual",
				model: "inherit",
				manual: true,
			}),
		},
	];

	assert.equal(blocksAutoRename(entries), true);
	entries.push({
		type: "custom",
		customType: STATE_CUSTOM_TYPE,
		data: makeTitleRenamerState({
			autoRenamed: false,
			model: "inherit",
			manual: true,
			reset: true,
		}),
	});
	assert.equal(blocksAutoRename(entries), false);
});

test("latest title to reapply survives reset state", () => {
	const entries = [
		{
			type: "custom",
			customType: STATE_CUSTOM_TYPE,
			data: makeTitleRenamerState({
				autoRenamed: false,
				title: "manual",
				model: "inherit",
				manual: true,
			}),
		},
		{
			type: "custom",
			customType: STATE_CUSTOM_TYPE,
			data: makeTitleRenamerState({
				autoRenamed: false,
				model: "inherit",
				manual: true,
				reset: true,
			}),
		},
	];

	assert.equal(getLatestTitleToReapply(entries), "manual");
});

test("buildFallbackTitle uses prefix, separator, and project name by default", () => {
	assert.equal(
		buildFallbackTitle(DEFAULT_CONFIG, "/tmp/pi-config"),
		"Pi｜pi-config",
	);
});

test("buildFallbackTitle falls back to prefix when project is disabled", () => {
	const config = {
		...DEFAULT_CONFIG,
		style: { ...DEFAULT_CONFIG.style, includeProject: false },
	};
	assert.equal(buildFallbackTitle(config, "/tmp/pi-config"), "Pi");
});
