import os from "node:os";
import {
	type ConfigFileSystem,
	type ConfigScope,
	getConfigValue,
	type LoadedConfig,
	loadConfig,
	resetConfigFile,
	writeConfigValue,
} from "./config.ts";
import {
	getMessages,
	type Messages,
	type SectionId,
	type SettingId,
	UI_LANGUAGES,
	type UiLanguage,
} from "./i18n.ts";

export type SettingControl =
	| { type: "toggle" }
	| { type: "choice"; values: readonly string[] }
	| { type: "text"; allowEmpty: boolean }
	| { type: "integer"; min: number; max: number }
	| { type: "model" }
	| { type: "fixed" };

export interface SettingDefinition {
	id: SettingId;
	section: SectionId;
	control: SettingControl;
}

const TITLE_LANGUAGE_VALUES = ["en", "zh-TW"] as const;

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
	{ id: "ui.language", section: "general", control: { type: "choice", values: UI_LANGUAGES } },
	{ id: "enabled", section: "general", control: { type: "toggle" } },
	{ id: "auto", section: "general", control: { type: "toggle" } },
	{ id: "trigger", section: "general", control: { type: "fixed" } },
	{ id: "model", section: "general", control: { type: "model" } },
	{ id: "apply.terminalTitle", section: "apply", control: { type: "toggle" } },
	{ id: "apply.sessionName", section: "apply", control: { type: "toggle" } },
	{ id: "apply.overwriteSessionName", section: "apply", control: { type: "toggle" } },
	{
		id: "style.language",
		section: "style",
		control: { type: "choice", values: TITLE_LANGUAGE_VALUES },
	},
	{ id: "style.maxChars", section: "style", control: { type: "integer", min: 4, max: 120 } },
	{ id: "style.includeProject", section: "style", control: { type: "toggle" } },
	{ id: "style.separator", section: "style", control: { type: "text", allowEmpty: true } },
	{ id: "input.includeFirstUserMessage", section: "input", control: { type: "toggle" } },
	{ id: "input.includeFirstAssistantMessage", section: "input", control: { type: "toggle" } },
	{ id: "input.includeCwd", section: "input", control: { type: "toggle" } },
	{ id: "input.includeModel", section: "input", control: { type: "toggle" } },
	{
		id: "generation.timeoutMs",
		section: "generation",
		control: { type: "integer", min: 1000, max: 120000 },
	},
	{ id: "fallback.useProjectName", section: "fallback", control: { type: "toggle" } },
	{ id: "fallback.prefix", section: "fallback", control: { type: "text", allowEmpty: true } },
];

export function findSetting(id: SettingId): SettingDefinition {
	const definition = SETTING_DEFINITIONS.find((item) => item.id === id);
	if (!definition) {
		throw new Error(`Unknown setting ${id}`);
	}
	return definition;
}

/** Groups "zh", "zh-TW", "zh_TW", "zh-Hant"... under one Chinese choice. */
function titleLanguageFamily(value: string): "en" | "zh" | "custom" {
	const normalized = value.trim().toLowerCase().replace(/_/g, "-");
	if (normalized === "en" || normalized.startsWith("en-") || normalized === "english") {
		return "en";
	}
	if (
		normalized === "zh" ||
		normalized.startsWith("zh-") ||
		normalized.includes("中文") ||
		normalized === "chinese"
	) {
		return "zh";
	}
	return "custom";
}

export function nextChoiceValue(definition: SettingDefinition, current: unknown): string {
	if (definition.control.type !== "choice") {
		throw new Error(`${definition.id} is not a choice setting`);
	}
	const values = definition.control.values;
	if (definition.id === "style.language") {
		const family = titleLanguageFamily(String(current ?? ""));
		return family === "en" ? "zh-TW" : "en";
	}
	const index = values.indexOf(String(current));
	return values[(index + 1) % values.length] ?? values[0] ?? "";
}

function showText(value: string): string {
	return value === "" || value.trim() !== value ? JSON.stringify(value) : value;
}

export function formatSettingValue(
	definition: SettingDefinition,
	value: unknown,
	messages: Messages,
): string {
	const text = messages.settings;
	switch (definition.control.type) {
		case "toggle":
			return value ? text.on : text.off;
		case "fixed":
			return text.triggerFirstAgentEnd;
		case "model":
			return value === "inherit" ? text.inheritModel : String(value);
		case "integer":
			return String(value);
		case "text":
			return showText(String(value ?? ""));
		case "choice": {
			if (definition.id === "ui.language") {
				return messages.languageName[value as UiLanguage] ?? String(value);
			}
			const raw = String(value ?? "");
			const family = titleLanguageFamily(raw);
			if (family === "en") return `${text.titleLanguage.en} (${raw})`;
			if (family === "zh") return `${text.titleLanguage.zh} (${raw})`;
			return raw;
		}
	}
}

export type ParseResult =
	| { ok: true; value: string | number }
	| { ok: false; error: string };

export function parseSettingInput(
	definition: SettingDefinition,
	input: string,
	messages: Messages,
): ParseResult {
	const text = messages.settings;
	switch (definition.control.type) {
		case "integer": {
			const { min, max } = definition.control;
			const trimmed = input.trim();
			const value = Number(trimmed);
			if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(value) || value < min || value > max) {
				return { ok: false, error: text.errorInteger(min, max) };
			}
			return { ok: true, value };
		}
		case "text":
			if (!definition.control.allowEmpty && input.trim() === "") {
				return { ok: false, error: text.errorEmpty };
			}
			return { ok: true, value: input };
		case "model": {
			const trimmed = input.trim();
			if (trimmed === "inherit") {
				return { ok: true, value: trimmed };
			}
			const slash = trimmed.indexOf("/");
			if (slash <= 0 || slash === trimmed.length - 1 || /\s/.test(trimmed)) {
				return { ok: false, error: text.errorModel };
			}
			return { ok: true, value: trimmed };
		}
		default:
			return { ok: true, value: input };
	}
}

export interface SettingsStatus {
	tone: "success" | "warning" | "error";
	text: string;
}

export interface SettingsSessionOptions {
	homeDir?: string;
	fileSystem?: ConfigFileSystem;
}

/**
 * One editing session over the layered config files. Reads the merged config,
 * writes single values into the chosen scope, and reports whether the change
 * actually took effect.
 */
export class SettingsSession {
	loaded: LoadedConfig;
	scope: ConfigScope;
	private readonly cwd: string;
	private readonly options: SettingsSessionOptions;

	constructor(cwd: string, options: SettingsSessionOptions = {}) {
		this.cwd = cwd;
		this.options = options;
		this.loaded = this.load();
		this.scope = this.loaded.raw.project !== undefined ? "project" : "global";
	}

	private load(): LoadedConfig {
		return loadConfig(this.cwd, {
			homeDir: this.options.homeDir,
			readFile: this.options.fileSystem?.readFile,
			exists: this.options.fileSystem?.exists,
		});
	}

	get language(): UiLanguage {
		return this.loaded.config.ui.language;
	}

	get messages(): Messages {
		return getMessages(this.language);
	}

	get scopePath(): string {
		return this.loaded.paths[this.scope];
	}

	/** Scope path shortened ("~" for home, "." for the project) so it fits on screen. */
	displayPath(): string {
		const home = this.options.homeDir ?? os.homedir();
		const filePath = this.scopePath;
		if (this.scope === "project" && filePath.startsWith(this.cwd)) {
			return `.${filePath.slice(this.cwd.length)}`;
		}
		return home && filePath.startsWith(home)
			? `~${filePath.slice(home.length)}`
			: filePath;
	}

	scopeLabel(scope: ConfigScope = this.scope): string {
		return this.messages.settings.scope[scope];
	}

	value(id: SettingId): unknown {
		return getConfigValue(this.loaded.config, id);
	}

	display(id: SettingId): string {
		return formatSettingValue(findSetting(id), this.value(id), this.messages);
	}

	toggleScope(): void {
		this.scope = this.scope === "global" ? "project" : "global";
	}

	change(id: SettingId, value: unknown): SettingsStatus {
		try {
			writeConfigValue(this.scopePath, id, value, {
				fileSystem: this.options.fileSystem,
				language: this.language,
				displayPath: this.displayPath(),
			});
		} catch (error) {
			return {
				tone: "error",
				text: error instanceof Error ? error.message : String(error),
			};
		}
		this.loaded = this.load();
		const overriddenByProject =
			this.scope === "global" &&
			getConfigValue(this.loaded.raw.project, id) !== undefined;
		if (overriddenByProject) {
			return { tone: "warning", text: this.messages.settings.overridden };
		}
		return {
			tone: "success",
			text: this.messages.settings.saved(this.scopeLabel()),
		};
	}

	reset(): SettingsStatus {
		try {
			resetConfigFile(this.scopePath, { fileSystem: this.options.fileSystem });
		} catch (error) {
			return {
				tone: "error",
				text: error instanceof Error ? error.message : String(error),
			};
		}
		this.loaded = this.load();
		return {
			tone: "success",
			text: this.messages.settings.resetDone(this.scopeLabel()),
		};
	}
}
