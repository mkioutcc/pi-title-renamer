import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import titleRenamer from "../extensions/title-renamer/index.ts";
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

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTitle(
	getTitle: () => string | undefined,
	expected: string,
): Promise<void> {
	const deadline = Date.now() + 250;
	while (Date.now() < deadline) {
		if (getTitle() === expected) {
			return;
		}
		await sleep(5);
	}
	assert.equal(getTitle(), expected);
}

async function withIsolatedHome(fn: () => Promise<void>): Promise<void> {
	const tempHome = fs.mkdtempSync(
		path.join(os.tmpdir(), "pi-title-renamer-home-"),
	);
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	try {
		await fn();
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = previousUserProfile;
		}
		fs.rmSync(tempHome, { recursive: true, force: true });
	}
}

function makePersistedTitleEntry(title: string): unknown {
	return {
		type: "custom",
		customType: STATE_CUSTOM_TYPE,
		data: makeTitleRenamerState({
			autoRenamed: false,
			title,
			model: "inherit",
			manual: true,
		}),
	};
}

function makeReapplyContext(
	entries: unknown[],
	onSetTitle: (value: string) => void,
): unknown {
	return {
		hasUI: true,
		cwd: "/tmp/pi-config",
		model: undefined,
		modelRegistry: {
			find() {
				return undefined;
			},
			async getApiKeyAndHeaders() {
				return { ok: false, error: "missing" };
			},
		},
		sessionManager: {
			getBranch() {
				return entries;
			},
		},
		signal: undefined,
		isIdle() {
			return true;
		},
		ui: {
			notify() {},
			setTitle(value: string) {
				onSetTitle(value);
			},
		},
	};
}

async function assertLifecycleEventReappliesPersistedTitle(
	eventName: string,
	event: unknown,
): Promise<void> {
	await withIsolatedHome(async () => {
		const entries: unknown[] = [makePersistedTitleEntry("手動標題")];
		let lifecycleHandler:
			| ((event: unknown, ctx: any) => Promise<void> | void)
			| undefined;
		let appendCount = 0;
		let title: string | undefined;

		const pi = {
			on(
				eventType: string,
				handler: (event: unknown, ctx: any) => Promise<void> | void,
			) {
				if (eventType === eventName) {
					lifecycleHandler = handler;
				}
			},
			registerCommand() {},
			appendEntry() {
				appendCount++;
			},
			getSessionName() {
				return undefined;
			},
			setSessionName() {},
		};

		titleRenamer(pi as any);
		if (!lifecycleHandler) {
			throw new Error(`${eventName} handler was not registered`);
		}

		await lifecycleHandler(
			event,
			makeReapplyContext(entries, (value) => {
				title = value;
			}),
		);
		assert.equal(title, undefined);
		await waitForTitle(() => title, "手動標題");
		assert.equal(appendCount, 0);
	});
}

test("agent_end applies fallback terminal title once when inherited model is unavailable", async () => {
	await withIsolatedHome(async () => {
		const entries: unknown[] = [
			makeMessage("user", "請幫我命名"),
			makeMessage("assistant", "已完成"),
		];
		let title: string | undefined;
		let appendCount = 0;
		let agentEndHandler:
			| ((event: unknown, ctx: any) => Promise<void> | void)
			| undefined;

		const pi = {
			on(
				event: string,
				handler: (event: unknown, ctx: any) => Promise<void> | void,
			) {
				if (event === "agent_end") {
					agentEndHandler = handler;
				}
			},
			registerCommand() {},
			appendEntry(customType: string, data: unknown) {
				appendCount++;
				entries.push({ type: "custom", customType, data });
			},
			getSessionName() {
				return undefined;
			},
			setSessionName() {},
		};

		titleRenamer(pi as any);
		if (!agentEndHandler) {
			throw new Error("agent_end handler was not registered");
		}
		const runAgentEnd = agentEndHandler;

		const ctx = {
			hasUI: true,
			cwd: "/tmp/pi-config",
			model: undefined,
			modelRegistry: {
				find() {
					return undefined;
				},
				async getApiKeyAndHeaders() {
					return { ok: false, error: "missing" };
				},
			},
			sessionManager: {
				getBranch() {
					return entries;
				},
			},
			signal: undefined,
			isIdle() {
				return true;
			},
			ui: {
				notify() {},
				setTitle(value: string) {
					title = value;
				},
			},
		};

		await runAgentEnd({}, ctx);
		assert.equal(title, "請幫我命名｜pi-config");
		assert.equal(appendCount, 1);

		title = undefined;
		await runAgentEnd({}, ctx);
		assert.equal(title, undefined);
		assert.equal(appendCount, 1);
	});
});

test("manual /rename-title does not allow automatic rename to run again", async () => {
	await withIsolatedHome(async () => {
		const entries: unknown[] = [
			makeMessage("user", "請幫我命名"),
			makeMessage("assistant", "已完成"),
		];
		const appliedTitles: string[] = [];
		let agentEndHandler:
			| ((event: unknown, ctx: any) => Promise<void> | void)
			| undefined;
		let commandHandler:
			| ((args: string, ctx: any) => Promise<void> | void)
			| undefined;

		const pi = {
			on(
				event: string,
				handler: (event: unknown, ctx: any) => Promise<void> | void,
			) {
				if (event === "agent_end") {
					agentEndHandler = handler;
				}
			},
			registerCommand(
				name: string,
				options: { handler: (args: string, ctx: any) => Promise<void> | void },
			) {
				if (name === "rename-title") {
					commandHandler = options.handler;
				}
			},
			appendEntry(customType: string, data: unknown) {
				entries.push({ type: "custom", customType, data });
			},
			getSessionName() {
				return undefined;
			},
			setSessionName() {},
		};

		titleRenamer(pi as any);
		if (!agentEndHandler || !commandHandler) {
			throw new Error("extension handlers were not registered");
		}
		const runAgentEnd = agentEndHandler;
		const runCommand = commandHandler;

		const ctx = {
			hasUI: true,
			cwd: "/tmp/pi-config",
			model: undefined,
			modelRegistry: {
				find() {
					return undefined;
				},
				async getApiKeyAndHeaders() {
					return { ok: false, error: "missing" };
				},
			},
			sessionManager: {
				getBranch() {
					return entries;
				},
			},
			signal: undefined,
			isIdle() {
				return true;
			},
			async waitForIdle() {},
			ui: {
				notify() {},
				setTitle(value: string) {
					appliedTitles.push(value);
				},
			},
		};

		await runAgentEnd({}, ctx);
		await runCommand("手動標題", ctx);
		await runAgentEnd({}, ctx);

		assert.deepEqual(appliedTitles, ["請幫我命名｜pi-config", "手動標題"]);
		assert.equal(
			entries.filter((entry: any) => entry.type === "custom").length,
			2,
		);
	});
});

test("manual /rename-title before first agent_end blocks automatic overwrite", async () => {
	await withIsolatedHome(async () => {
		const entries: unknown[] = [
			makeMessage("user", "請幫我命名"),
			makeMessage("assistant", "已完成"),
		];
		const appliedTitles: string[] = [];
		let agentEndHandler:
			| ((event: unknown, ctx: any) => Promise<void> | void)
			| undefined;
		let commandHandler:
			| ((args: string, ctx: any) => Promise<void> | void)
			| undefined;

		const pi = {
			on(
				event: string,
				handler: (event: unknown, ctx: any) => Promise<void> | void,
			) {
				if (event === "agent_end") {
					agentEndHandler = handler;
				}
			},
			registerCommand(
				name: string,
				options: { handler: (args: string, ctx: any) => Promise<void> | void },
			) {
				if (name === "rename-title") {
					commandHandler = options.handler;
				}
			},
			appendEntry(customType: string, data: unknown) {
				entries.push({ type: "custom", customType, data });
			},
			getSessionName() {
				return undefined;
			},
			setSessionName() {},
		};

		titleRenamer(pi as any);
		if (!agentEndHandler || !commandHandler) {
			throw new Error("extension handlers were not registered");
		}
		const runAgentEnd = agentEndHandler;
		const runCommand = commandHandler;

		const ctx = {
			hasUI: true,
			cwd: "/tmp/pi-config",
			model: undefined,
			modelRegistry: {
				find() {
					return undefined;
				},
				async getApiKeyAndHeaders() {
					return { ok: false, error: "missing" };
				},
			},
			sessionManager: {
				getBranch() {
					return entries;
				},
			},
			signal: undefined,
			isIdle() {
				return true;
			},
			async waitForIdle() {},
			ui: {
				notify() {},
				setTitle(value: string) {
					appliedTitles.push(value);
				},
			},
		};

		await runCommand("手動標題", ctx);
		await runAgentEnd({}, ctx);

		assert.deepEqual(appliedTitles, ["手動標題"]);
		assert.equal(
			entries.filter((entry: any) => entry.type === "custom").length,
			1,
		);
	});
});

test("/rename-title direct text sanitizes without appending project suffix or model lookup", async () => {
	await withIsolatedHome(async () => {
		let commandHandler:
			| ((args: string, ctx: any) => Promise<void> | void)
			| undefined;
		let title: string | undefined;
		let modelLookupCount = 0;

		const pi = {
			on() {},
			registerCommand(
				name: string,
				options: { handler: (args: string, ctx: any) => Promise<void> | void },
			) {
				if (name === "rename-title") {
					commandHandler = options.handler;
				}
			},
			appendEntry() {},
			getSessionName() {
				return undefined;
			},
			setSessionName() {},
		};

		titleRenamer(pi as any);
		if (!commandHandler) {
			throw new Error("rename-title command was not registered");
		}
		const runCommand = commandHandler;
		await runCommand('"手動標題"', {
			hasUI: true,
			cwd: "/tmp/pi-config",
			model: undefined,
			modelRegistry: {
				find() {
					modelLookupCount++;
					return undefined;
				},
				async getApiKeyAndHeaders() {
					modelLookupCount++;
					return { ok: false, error: "missing" };
				},
			},
			sessionManager: {
				getBranch() {
					return [];
				},
			},
			signal: undefined,
			isIdle() {
				return true;
			},
			async waitForIdle() {},
			ui: {
				notify() {},
				setTitle(value: string) {
					title = value;
				},
			},
		});

		assert.equal(title, "手動標題");
		assert.equal(modelLookupCount, 0);
	});
});

test("session_start reapplies persisted terminal title without changing session name", async () => {
	await withIsolatedHome(async () => {
		const entries: unknown[] = [makePersistedTitleEntry("手動標題")];
		let sessionStartHandler:
			| ((event: unknown, ctx: any) => Promise<void> | void)
			| undefined;
		let setSessionNameCount = 0;
		let title: string | undefined;

		const pi = {
			on(
				event: string,
				handler: (event: unknown, ctx: any) => Promise<void> | void,
			) {
				if (event === "session_start") {
					sessionStartHandler = handler;
				}
			},
			registerCommand() {},
			appendEntry() {},
			getSessionName() {
				return undefined;
			},
			setSessionName() {
				setSessionNameCount++;
			},
		};

		titleRenamer(pi as any);
		if (!sessionStartHandler) {
			throw new Error("session_start handler was not registered");
		}
		const runSessionStart = sessionStartHandler;

		await runSessionStart(
			{ type: "session_start", reason: "startup" },
			makeReapplyContext(entries, (value) => {
				title = value;
			}),
		);
		await waitForTitle(() => title, "手動標題");
		assert.equal(setSessionNameCount, 0);
	});
});

test("turn_end reapplies persisted terminal title", async () => {
	await assertLifecycleEventReappliesPersistedTitle("turn_end", {
		type: "turn_end",
		turnIndex: 0,
		message: undefined,
		toolResults: [],
	});
});

test("tool_execution_end reapplies persisted terminal title", async () => {
	await assertLifecycleEventReappliesPersistedTitle("tool_execution_end", {
		type: "tool_execution_end",
		toolCallId: "tool-1",
		toolName: "bash",
		result: undefined,
		isError: false,
	});
});

test("agent_end reapplies persisted title after auto rename is blocked", async () => {
	await assertLifecycleEventReappliesPersistedTitle("agent_end", {
		type: "agent_end",
		messages: [],
	});
});

test("reset waits for the next complete turn before automatic rename runs again", async () => {
	await withIsolatedHome(async () => {
		const entries: unknown[] = [
			makeMessage("user", "舊問題"),
			makeMessage("assistant", "舊回答"),
		];
		const appliedTitles: string[] = [];
		let agentEndHandler:
			| ((event: unknown, ctx: any) => Promise<void> | void)
			| undefined;
		let commandHandler:
			| ((args: string, ctx: any) => Promise<void> | void)
			| undefined;

		const pi = {
			on(
				event: string,
				handler: (event: unknown, ctx: any) => Promise<void> | void,
			) {
				if (event === "agent_end") {
					agentEndHandler = handler;
				}
			},
			registerCommand(
				name: string,
				options: { handler: (args: string, ctx: any) => Promise<void> | void },
			) {
				if (name === "rename-title") {
					commandHandler = options.handler;
				}
			},
			appendEntry(customType: string, data: unknown) {
				entries.push({ type: "custom", customType, data });
			},
			getSessionName() {
				return undefined;
			},
			setSessionName() {},
		};

		titleRenamer(pi as any);
		if (!agentEndHandler || !commandHandler) {
			throw new Error("extension handlers were not registered");
		}
		const runAgentEnd = agentEndHandler;
		const runCommand = commandHandler;

		const ctx = {
			hasUI: true,
			cwd: "/tmp/pi-config",
			model: undefined,
			modelRegistry: {
				find() {
					return undefined;
				},
				async getApiKeyAndHeaders() {
					return { ok: false, error: "missing" };
				},
			},
			sessionManager: {
				getBranch() {
					return entries;
				},
			},
			signal: undefined,
			isIdle() {
				return true;
			},
			async waitForIdle() {},
			ui: {
				notify() {},
				setTitle(value: string) {
					appliedTitles.push(value);
				},
			},
		};

		await runAgentEnd({}, ctx);
		await runCommand("--reset", ctx);
		await runAgentEnd({}, ctx);
		entries.push(makeMessage("user", "新問題"));
		await runAgentEnd({}, ctx);
		entries.push(makeMessage("assistant", "新回答"));
		await runAgentEnd({}, ctx);

		assert.deepEqual(appliedTitles, ["舊問題｜pi-config", "新問題｜pi-config"]);
		assert.equal(
			entries.filter((entry: any) => entry.type === "custom").length,
			3,
		);
	});
});

test("input fallback handles raw /rename-title direct text", async () => {
	await withIsolatedHome(async () => {
		let inputHandler:
			| ((event: any, ctx: any) => Promise<unknown> | unknown)
			| undefined;
		let title: string | undefined;
		let modelLookupCount = 0;

		const pi = {
			on(
				event: string,
				handler: (event: any, ctx: any) => Promise<unknown> | unknown,
			) {
				if (event === "input") {
					inputHandler = handler;
				}
			},
			registerCommand() {},
			appendEntry() {},
			getSessionName() {
				return undefined;
			},
			setSessionName() {},
		};

		titleRenamer(pi as any);
		if (!inputHandler) {
			throw new Error("input handler was not registered");
		}
		const runInput = inputHandler;
		const result = await runInput(
			{
				type: "input",
				text: "/rename-title 手動測試標題",
				source: "interactive",
			},
			{
				hasUI: true,
				cwd: "/tmp/pi-config",
				model: undefined,
				modelRegistry: {
					find() {
						modelLookupCount++;
						return undefined;
					},
					async getApiKeyAndHeaders() {
						modelLookupCount++;
						return { ok: false, error: "missing" };
					},
				},
				sessionManager: {
					getBranch() {
						return [];
					},
				},
				signal: undefined,
				isIdle() {
					return true;
				},
				ui: {
					notify() {},
					setTitle(value: string) {
						title = value;
					},
				},
			},
		);

		assert.deepEqual(result, { action: "handled" });
		assert.equal(title, "手動測試標題");
		assert.equal(modelLookupCount, 0);
	});
});

test("input fallback does not repeat a command handled by slash dispatch", async () => {
	await withIsolatedHome(async () => {
		let inputHandler:
			| ((event: any, ctx: any) => Promise<unknown> | unknown)
			| undefined;
		let commandHandler:
			| ((args: string, ctx: any) => Promise<void> | void)
			| undefined;
		const appliedTitles: string[] = [];
		let appendCount = 0;

		const pi = {
			on(
				event: string,
				handler: (event: any, ctx: any) => Promise<unknown> | unknown,
			) {
				if (event === "input") {
					inputHandler = handler;
				}
			},
			registerCommand(
				name: string,
				options: { handler: (args: string, ctx: any) => Promise<void> | void },
			) {
				if (name === "rename-title") {
					commandHandler = options.handler;
				}
			},
			appendEntry() {
				appendCount++;
			},
			getSessionName() {
				return undefined;
			},
			setSessionName() {},
		};

		titleRenamer(pi as any);
		if (!inputHandler || !commandHandler) {
			throw new Error("extension handlers were not registered");
		}
		const runInput = inputHandler;
		const runCommand = commandHandler;

		const ctx = {
			hasUI: true,
			cwd: "/tmp/pi-config",
			model: undefined,
			modelRegistry: {
				find() {
					return undefined;
				},
				async getApiKeyAndHeaders() {
					return { ok: false, error: "missing" };
				},
			},
			sessionManager: {
				getBranch() {
					return [];
				},
			},
			signal: undefined,
			isIdle() {
				return true;
			},
			async waitForIdle() {},
			ui: {
				notify() {},
				setTitle(value: string) {
					appliedTitles.push(value);
				},
			},
		};

		await runCommand("手動測試標題", ctx);
		const result = await runInput(
			{
				type: "input",
				text: "/rename-title 手動測試標題",
				source: "interactive",
			},
			ctx,
		);

		assert.deepEqual(result, { action: "handled" });
		assert.deepEqual(appliedTitles, ["手動測試標題"]);
		assert.equal(appendCount, 1);
	});
});
