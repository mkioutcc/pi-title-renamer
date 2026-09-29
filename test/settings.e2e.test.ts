/**
 * End-to-end check of the settings feature, driven through the real extension
 * entry point, the real settings panel, and pi-tui's real keyboard handling.
 *
 * Every screen the test visits is written to test-artifacts/settings-e2e.txt,
 * so the run leaves a readable, reproducible record of what the user sees.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	KeybindingsManager,
	setKeybindings,
	TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";
import titleRenamer from "../extensions/title-renamer/index.ts";

const KEY = {
	up: "\x1b[A",
	down: "\x1b[B",
	enter: "\r",
	escape: "\x1b",
	space: " ",
	clearLine: "\x15",
} as const;

const ARTIFACT_PATH = path.join("test-artifacts", "settings-e2e.txt");
const SCREEN_WIDTH = 88;

const keybindings = new KeybindingsManager(TUI_KEYBINDINGS as any);
setKeybindings(keybindings);

const plainTheme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

interface Panel {
	render(width: number): string[];
	handleInput(data: string): void;
	focused: boolean;
}

interface Harness {
	root: string;
	home: string;
	cwd: string;
	globalPath: string;
	projectPath: string;
	commands: Map<string, (args: string, ctx: any) => Promise<void> | void>;
	handlers: Map<string, (event: unknown, ctx: any) => Promise<unknown> | unknown>;
	notifications: Array<{ message: string; type?: string }>;
	titles: string[];
	sessionNames: string[];
	entries: unknown[];
	panel?: Panel;
	makeCtx(mode: "tui" | "rpc", ui?: Record<string, unknown>): any;
}

function makeHarness(root: string): Harness {
	const home = path.join(root, "home");
	const cwd = path.join(root, "my-app");
	fs.mkdirSync(home, { recursive: true });
	fs.mkdirSync(cwd, { recursive: true });

	const harness: Harness = {
		root,
		home,
		cwd,
		globalPath: path.join(home, ".pi", "agent", "title-renamer.json"),
		projectPath: path.join(cwd, ".pi", "title-renamer.json"),
		commands: new Map(),
		handlers: new Map(),
		notifications: [],
		titles: [],
		sessionNames: [],
		entries: [],
		makeCtx(mode, ui = {}) {
			return {
				hasUI: true,
				mode,
				cwd,
				model: undefined,
				modelRegistry: {
					find() {
						return undefined;
					},
					getAvailable() {
						return [
							{ provider: "anthropic", id: "claude-haiku" },
							{ provider: "openai", id: "gpt-4o" },
							{ provider: "openai", id: "gpt-4o-mini" },
						];
					},
					async getApiKeyAndHeaders() {
						return { ok: false, error: "missing" };
					},
				},
				sessionManager: {
					getBranch() {
						return harness.entries;
					},
				},
				signal: undefined,
				isIdle() {
					return true;
				},
				async waitForIdle() {},
				ui: {
					notify(message: string, type?: string) {
						harness.notifications.push({ message, type });
					},
					setTitle(value: string) {
						harness.titles.push(value);
					},
					custom(factory: any) {
						return new Promise((resolve) => {
							const tui = {
								requestRender() {},
								terminal: { rows: 60 },
							};
							const panel = factory(tui, plainTheme, keybindings, resolve);
							panel.focused = true;
							harness.panel = panel;
						});
					},
					...ui,
				},
			};
		},
	};

	titleRenamer({
		on(event: string, handler: any) {
			harness.handlers.set(event, handler);
		},
		registerCommand(name: string, options: { handler: any }) {
			harness.commands.set(name, options.handler);
		},
		appendEntry(customType: string, data: unknown) {
			harness.entries.push({ type: "custom", customType, data });
		},
		getSessionName() {
			return harness.sessionNames.at(-1);
		},
		setSessionName(name: string) {
			harness.sessionNames.push(name);
		},
	} as any);

	return harness;
}

async function withIsolatedEnvironment(
	fn: (harness: Harness) => Promise<void>,
): Promise<void> {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-title-renamer-e2e-"));
	const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
	process.env.HOME = path.join(root, "home");
	process.env.USERPROFILE = path.join(root, "home");
	try {
		await fn(makeHarness(root));
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		fs.rmSync(root, { recursive: true, force: true });
	}
}

function readJson(filePath: string): any {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function message(role: string, text: string): unknown {
	return { type: "message", message: { role, content: [{ type: "text", text }] } };
}

async function waitFor<T>(get: () => T | undefined): Promise<T> {
	const deadline = Date.now() + 2000;
	while (Date.now() < deadline) {
		const value = get();
		if (value !== undefined) return value;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Timed out waiting for the settings panel to open");
}

class ScreenRecorder {
	private readonly sections: string[] = [];
	private readonly root: string;
	constructor(root: string) {
		this.root = root;
	}

	screen(panel: Panel): string {
		return panel
			.render(SCREEN_WIDTH)
			.join("\n")
			.replace(/\x1b_[^\x07]*\x07/g, "")
			.replace(/\x1b\[[0-9;]*m/g, "")
			.split(this.root)
			.join("<tmp>")
			.replace(/\\/g, "/")
			.replace(/[ \t]+$/gm, "");
	}

	capture(title: string, panel: Panel): string {
		const screen = this.screen(panel);
		this.sections.push(`## ${title}\n\n${screen}\n`);
		return screen;
	}

	note(title: string, body: string): void {
		this.sections.push(`## ${title}\n\n${body.split(this.root).join("<tmp>").replace(/\\/g, "/")}\n`);
	}

	write(): void {
		fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
		fs.writeFileSync(
			ARTIFACT_PATH,
			[
				"# Title Renamer settings E2E record",
				"",
				"Generated by `npm test` (test/settings.e2e.test.ts). Do not edit by hand.",
				`Screen width: ${SCREEN_WIDTH} columns. Colors are stripped.`,
				"",
				...this.sections,
			].join("\n"),
		);
	}
}

function press(panel: Panel, ...keys: string[]): void {
	for (const key of keys) panel.handleInput(key);
}

function type(panel: Panel, text: string): void {
	for (const char of text) panel.handleInput(char);
}

/** Moves the cursor down until the selected row shows `label`. */
function select(recorder: ScreenRecorder, panel: Panel, label: string): void {
	for (let attempt = 0; attempt < 40; attempt++) {
		const selected = recorder.screen(panel).split("\n").find((line) => line.includes("→ "));
		if (selected?.includes(`→ ${label}`)) return;
		press(panel, KEY.down);
	}
	throw new Error(`Could not select row "${label}"`);
}

test("E2E: configure every kind of setting from inside Pi, in English and Chinese", async () => {
	await withIsolatedEnvironment(async (harness) => {
		const recorder = new ScreenRecorder(harness.root);
		const ctx = harness.makeCtx("tui");
		const openCommand = harness.commands.get("title-renamer");
		assert.ok(openCommand, "/title-renamer command is registered");

		const closed = Promise.resolve(openCommand("", ctx));
		const panel = await waitFor(() => harness.panel);

		// 1. Opens in English with the documented defaults.
		let screen = recorder.capture("1. Open /title-renamer (default English)", panel);
		assert.match(screen, /Title Renamer Settings/);
		assert.match(screen, /Saving to: Global  ~[\/]\.pi[\/]agent[\/]title-renamer\.json/);
		assert.match(screen, /Session name\s+● On/);
		assert.match(screen, /Interface language\s+‹ English ›/);
		assert.equal(fs.existsSync(harness.globalPath), false, "opening alone writes nothing");

		// 2. Switch the interface to Chinese; the panel re-renders immediately.
		press(panel, KEY.enter);
		screen = recorder.capture("2. Interface language -> 繁體中文", panel);
		assert.match(screen, /Title Renamer 設定/);
		assert.match(screen, /介面語言\s+‹ 繁體中文 ›/);
		assert.match(screen, /✓ 已儲存到全域。/);
		assert.equal(readJson(harness.globalPath).ui.language, "zh-TW");

		// 3. Toggle a boolean.
		select(recorder, panel, "工作階段名稱");
		press(panel, KEY.space);
		screen = recorder.capture("3. Turn off session name", panel);
		assert.match(screen, /工作階段名稱\s+○ 關/);
		assert.equal(readJson(harness.globalPath).apply.sessionName, false);

		// 4. Numbers are validated before saving.
		select(recorder, panel, "最大長度");
		press(panel, KEY.enter, KEY.clearLine);
		type(panel, "abc");
		press(panel, KEY.enter);
		screen = recorder.capture("4a. Invalid max length is rejected", panel);
		assert.match(screen, /✗ 請輸入 4 到 120 之間的整數。/);
		assert.match(screen, /Enter 儲存 · Esc 取消/);
		assert.equal(readJson(harness.globalPath).style?.maxChars, undefined);
		press(panel, KEY.clearLine);
		type(panel, "30");
		press(panel, KEY.enter);
		screen = recorder.capture("4b. Valid max length is saved", panel);
		assert.match(screen, /最大長度\s+30/);
		assert.equal(readJson(harness.globalPath).style.maxChars, 30);

		// 5. Pick a model from the models Pi has available.
		select(recorder, panel, "標題模型");
		press(panel, KEY.enter);
		type(panel, "mini");
		screen = recorder.capture("5a. Model picker filtered by \"mini\"", panel);
		assert.match(screen, /選擇標題模型/);
		assert.match(screen, /→ openai\/gpt-4o-mini/);
		assert.doesNotMatch(screen, /anthropic\/claude-haiku/);
		press(panel, KEY.enter);
		screen = recorder.capture("5b. Model saved", panel);
		assert.match(screen, /標題模型\s+openai\/gpt-4o-mini/);
		assert.equal(readJson(harness.globalPath).model, "openai/gpt-4o-mini");

		// 6. Title language switches between English and Chinese.
		select(recorder, panel, "標題語言");
		press(panel, KEY.enter);
		screen = recorder.capture("6. Title language -> 中文", panel);
		assert.match(screen, /標題語言\s+‹ 中文 \(zh-TW\) ›/);
		assert.equal(readJson(harness.globalPath).style.language, "zh-TW");

		// 7. Save to the project scope instead of global.
		select(recorder, panel, "變更儲存到");
		press(panel, KEY.enter);
		select(recorder, panel, "分隔符號");
		press(panel, KEY.enter, KEY.clearLine);
		type(panel, " - ");
		press(panel, KEY.enter);
		screen = recorder.capture("7. Project scope: separator saved to .pi/title-renamer.json", panel);
		assert.match(screen, /儲存位置：此專案/);
		assert.match(screen, /分隔符號\s+" - "/);
		assert.deepEqual(readJson(harness.projectPath), { style: { separator: " - " } });
		assert.equal(readJson(harness.globalPath).style.separator, undefined);

		// 8. Reset the project scope, with a confirmation step.
		select(recorder, panel, "還原預設值");
		press(panel, KEY.enter);
		screen = recorder.capture("8a. Reset asks for confirmation", panel);
		assert.match(screen, /再按一次 Enter 確認/);
		assert.equal(fs.existsSync(harness.projectPath), true);
		press(panel, KEY.enter);
		screen = recorder.capture("8b. Project settings reset", panel);
		assert.match(screen, /✓ 已將此專案設定還原為預設值。/);
		assert.equal(fs.existsSync(harness.projectPath), false);
		assert.match(screen, /分隔符號\s+｜/);

		// 9. Esc closes the panel and resolves the command.
		press(panel, KEY.escape);
		await closed;

		recorder.note(
			"9. Global config file after the session",
			fs.readFileSync(harness.globalPath, "utf8"),
		);

		// 10. The saved settings drive the next automatic rename.
		harness.entries.push(message("user", "請幫我修正登入錯誤"), message("assistant", "好的"));
		await harness.handlers.get("agent_end")?.({ type: "agent_end", messages: [] }, ctx);
		assert.equal(harness.titles[0], "請幫我修正登入錯誤｜my-app");
		assert.deepEqual(harness.sessionNames, [], "session name stays untouched when turned off");
		assert.ok(
			harness.notifications.some(
				(n) => n.message === "標題產生失敗：找不到 title-renamer 模型：openai/gpt-4o-mini。",
			),
			"notifications follow the interface language",
		);
		recorder.note(
			"10. Next automatic rename uses the saved settings",
			[
				`Terminal title: ${harness.titles[0]}`,
				`Session names set: ${JSON.stringify(harness.sessionNames)}`,
				"Notifications:",
				...harness.notifications.map((n) => `  [${n.type}] ${n.message}`),
			].join("\n"),
		);

		recorder.write();
	});
});

test("E2E: saving keeps hand-edited keys and never overwrites a broken file", async () => {
	await withIsolatedEnvironment(async (harness) => {
		fs.mkdirSync(path.dirname(harness.globalPath), { recursive: true });
		fs.writeFileSync(
			harness.globalPath,
			JSON.stringify({ style: { language: "zh_TW", separator: " / " }, custom: 1 }),
		);
		const recorder = new ScreenRecorder(harness.root);
		const closed = Promise.resolve(
			harness.commands.get("title-renamer")?.("", harness.makeCtx("tui")),
		);
		const panel = await waitFor(() => harness.panel);

		// A hand-written "zh_TW" is recognised as Chinese.
		assert.match(recorder.screen(panel), /Title language\s+‹ Chinese \(zh_TW\) ›/);

		select(recorder, panel, "Enabled");
		press(panel, KEY.enter);
		assert.deepEqual(readJson(harness.globalPath), {
			style: { language: "zh_TW", separator: " / " },
			custom: 1,
			enabled: false,
		});

		fs.writeFileSync(harness.globalPath, "{ not json");
		press(panel, KEY.enter);
		const screen = recorder.screen(panel);
		assert.match(screen, /✗ ~[\/]\.pi[\/]agent[\/]title-renamer\.json is not valid JSON\. Fix or delete it/);
		assert.equal(fs.readFileSync(harness.globalPath, "utf8"), "{ not json");

		press(panel, KEY.escape);
		await closed;
	});
});

test("E2E: default config names the session too", async () => {
	await withIsolatedEnvironment(async (harness) => {
		harness.entries.push(message("user", "Fix login bug"), message("assistant", "Done"));
		await harness.handlers.get("agent_end")?.(
			{ type: "agent_end", messages: [] },
			harness.makeCtx("tui"),
		);
		assert.equal(harness.titles[0], "Fix login bug｜my-app");
		assert.deepEqual(harness.sessionNames, ["Fix login bug｜my-app"]);
		assert.ok(
			harness.notifications.some((n) => n.message.startsWith("Title generation failed:")),
			"English is the default interface language",
		);
	});
});

test("E2E: /rename-title --settings works in RPC mode through plain dialogs", async () => {
	await withIsolatedEnvironment(async (harness) => {
		const answers = ["Enabled:", "Timeout (ms):", "Done"];
		const prompts: string[] = [];
		const ctx = harness.makeCtx("rpc", {
			custom: undefined,
			async select(title: string, options: string[]) {
				prompts.push(title);
				const prefix = answers.shift();
				return options.find((option) => option.startsWith(prefix ?? "\0"));
			},
			async input(title: string) {
				prompts.push(title);
				return "20000";
			},
		});

		await harness.commands.get("rename-title")?.("--settings", ctx);

		assert.deepEqual(readJson(harness.globalPath), {
			enabled: false,
			generation: { timeoutMs: 20000 },
		});
		assert.deepEqual(prompts, [
			"Title Renamer Settings · Saving to: Global",
			"Title Renamer Settings · Saving to: Global",
			"Timeout (ms)",
			"Title Renamer Settings · Saving to: Global",
		]);
	});
});
