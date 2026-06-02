import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../extensions/title-renamer/config.ts";
import {
	collectNamingContext,
	hasFirstTurn,
} from "../extensions/title-renamer/context.ts";
import {
	makeTitleRenamerState,
	STATE_CUSTOM_TYPE,
} from "../extensions/title-renamer/state.ts";

function makeMessage(role: string, text: string): unknown {
	return {
		type: "message",
		message: {
			role,
			content: [{ type: "text", text }],
		},
	};
}

function makeResetEntry(): unknown {
	return {
		type: "custom",
		customType: STATE_CUSTOM_TYPE,
		data: makeTitleRenamerState({
			autoRenamed: false,
			model: "inherit",
			manual: true,
			reset: true,
		}),
	};
}

function makeContext(entries: unknown[]): unknown {
	return {
		cwd: "/tmp/pi-title-renamer",
		model: undefined,
		sessionManager: {
			getBranch() {
				return entries;
			},
		},
	};
}

test("reset-aware first turn detection waits for a complete turn after reset", () => {
	const entries = [
		makeMessage("user", "舊問題"),
		makeMessage("assistant", "舊回答"),
		makeResetEntry(),
	];
	const ctx = makeContext(entries);

	assert.equal(hasFirstTurn(ctx as any), true);
	assert.equal(hasFirstTurn(ctx as any, { afterLatestReset: true }), false);

	entries.push(makeMessage("user", "新問題"));
	assert.equal(hasFirstTurn(ctx as any, { afterLatestReset: true }), false);

	entries.push(makeMessage("assistant", "新回答"));
	assert.equal(hasFirstTurn(ctx as any, { afterLatestReset: true }), true);
});

test("reset-aware naming context uses the first complete turn after reset", () => {
	const entries = [
		makeMessage("user", "舊問題"),
		makeMessage("assistant", "舊回答"),
		makeResetEntry(),
		makeMessage("user", "新問題"),
		makeMessage("assistant", "新回答"),
	];
	const ctx = makeContext(entries);

	const defaultContext = collectNamingContext(ctx as any, DEFAULT_CONFIG);
	assert.equal(defaultContext.firstUserMessage, "舊問題");
	assert.equal(defaultContext.firstAssistantMessage, "舊回答");

	const resetAwareContext = collectNamingContext(ctx as any, DEFAULT_CONFIG, {
		afterLatestReset: true,
	});
	assert.equal(resetAwareContext.firstUserMessage, "新問題");
	assert.equal(resetAwareContext.firstAssistantMessage, "新回答");
});
