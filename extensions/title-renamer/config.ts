import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	DEFAULT_UI_LANGUAGE,
	getMessages,
	isUiLanguage,
	type UiLanguage,
} from "./i18n.ts";

export interface TitleRenamerConfig {
	enabled: boolean;
	auto: boolean;
	trigger: "first-agent-end";
	model: string;
	ui: {
		language: UiLanguage;
	};
	apply: {
		terminalTitle: boolean;
		sessionName: boolean;
		overwriteSessionName: boolean;
	};
	style: {
		language: string;
		maxChars: number;
		includeProject: boolean;
		separator: string;
	};
	input: {
		includeFirstUserMessage: boolean;
		includeFirstAssistantMessage: boolean;
		includeCwd: boolean;
		includeModel: boolean;
	};
	generation: {
		timeoutMs: number;
	};
	fallback: {
		useProjectName: boolean;
		prefix: string;
	};
}

export type ConfigScope = "global" | "project";

export interface ConfigPaths {
	global: string;
	project: string;
}

export interface LoadedConfig {
	config: TitleRenamerConfig;
	warnings: string[];
	paths: ConfigPaths;
	/** Raw per-scope file contents (undefined when the file is missing or unreadable). */
	raw: Partial<Record<ConfigScope, unknown>>;
}

export interface ConfigFileSystem {
	readFile: (filePath: string) => string;
	exists: (filePath: string) => boolean;
	writeFile: (filePath: string, data: string) => void;
	mkdir: (dirPath: string) => void;
	remove: (filePath: string) => void;
}

export interface LoadConfigOptions {
	homeDir?: string;
	readFile?: (filePath: string) => string;
	exists?: (filePath: string) => boolean;
}

export const DEFAULT_CONFIG: TitleRenamerConfig = {
	enabled: true,
	auto: true,
	trigger: "first-agent-end",
	model: "inherit",
	ui: {
		language: DEFAULT_UI_LANGUAGE,
	},
	apply: {
		terminalTitle: true,
		sessionName: true,
		overwriteSessionName: false,
	},
	style: {
		language: "en",
		maxChars: 24,
		includeProject: true,
		separator: "｜",
	},
	input: {
		includeFirstUserMessage: true,
		includeFirstAssistantMessage: true,
		includeCwd: true,
		includeModel: false,
	},
	generation: {
		timeoutMs: 15000,
	},
	fallback: {
		useProjectName: true,
		prefix: "Pi",
	},
};

type ConfigWarning =
	| { kind: "invalidRoot" }
	| { kind: "invalidValue"; key: string; fallback: string }
	| { kind: "unsupportedTrigger"; value: string; fallback: string }
	| { kind: "readFailed"; filePath: string; message: string };

function formatWarning(warning: ConfigWarning, language: UiLanguage): string {
	const messages = getMessages(language).config;
	switch (warning.kind) {
		case "invalidRoot":
			return messages.invalidRoot;
		case "invalidValue":
			return messages.invalidValue(warning.key, warning.fallback);
		case "unsupportedTrigger":
			return messages.unsupportedTrigger(warning.value, warning.fallback);
		case "readFailed":
			return messages.readFailed(warning.filePath, warning.message);
	}
}

const cloneConfig = (config: TitleRenamerConfig): TitleRenamerConfig => ({
	...config,
	ui: { ...config.ui },
	apply: { ...config.apply },
	style: { ...config.style },
	input: { ...config.input },
	generation: { ...config.generation },
	fallback: { ...config.fallback },
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);

export function mergeConfig(
	base: TitleRenamerConfig,
	override: unknown,
): TitleRenamerConfig {
	if (!isPlainObject(override)) {
		return cloneConfig(base);
	}

	const merged = cloneConfig(base) as unknown as Record<string, unknown>;
	for (const [key, value] of Object.entries(override)) {
		const current = merged[key];
		if (isPlainObject(current) && isPlainObject(value)) {
			merged[key] = { ...current, ...value };
		} else {
			merged[key] = value;
		}
	}

	return merged as unknown as TitleRenamerConfig;
}

function validateBoolean(
	value: unknown,
	fallback: boolean,
	key: string,
	warnings: ConfigWarning[],
): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	warnings.push({ kind: "invalidValue", key, fallback: String(fallback) });
	return fallback;
}

function validateString(
	value: unknown,
	fallback: string,
	key: string,
	warnings: ConfigWarning[],
): string {
	if (typeof value === "string") {
		return value;
	}
	warnings.push({ kind: "invalidValue", key, fallback: JSON.stringify(fallback) });
	return fallback;
}

function validatePositiveInteger(
	value: unknown,
	fallback: number,
	key: string,
	warnings: ConfigWarning[],
): number {
	if (Number.isInteger(value) && typeof value === "number" && value > 0) {
		return value;
	}
	warnings.push({ kind: "invalidValue", key, fallback: String(fallback) });
	return fallback;
}

function validateUiLanguage(
	value: unknown,
	warnings: ConfigWarning[],
): UiLanguage {
	if (isUiLanguage(value)) {
		return value;
	}
	warnings.push({
		kind: "invalidValue",
		key: "ui.language",
		fallback: JSON.stringify(DEFAULT_CONFIG.ui.language),
	});
	return DEFAULT_CONFIG.ui.language;
}

function validateConfigStructured(input: unknown): {
	config: TitleRenamerConfig;
	warnings: ConfigWarning[];
} {
	const warnings: ConfigWarning[] = [];
	const raw = isPlainObject(input) ? input : {};
	if (!isPlainObject(input)) {
		warnings.push({ kind: "invalidRoot" });
	}

	const rawUi = isPlainObject(raw.ui) ? raw.ui : {};
	const rawApply = isPlainObject(raw.apply) ? raw.apply : {};
	const rawStyle = isPlainObject(raw.style) ? raw.style : {};
	const rawInput = isPlainObject(raw.input) ? raw.input : {};
	const rawGeneration = isPlainObject(raw.generation) ? raw.generation : {};
	const rawFallback = isPlainObject(raw.fallback) ? raw.fallback : {};

	const triggerValue = validateString(
		raw.trigger,
		DEFAULT_CONFIG.trigger,
		"trigger",
		warnings,
	);
	const trigger: TitleRenamerConfig["trigger"] =
		triggerValue === "first-agent-end" ? triggerValue : DEFAULT_CONFIG.trigger;
	if (triggerValue !== "first-agent-end") {
		warnings.push({
			kind: "unsupportedTrigger",
			value: JSON.stringify(triggerValue),
			fallback: DEFAULT_CONFIG.trigger,
		});
	}

	return {
		config: {
			enabled: validateBoolean(
				raw.enabled,
				DEFAULT_CONFIG.enabled,
				"enabled",
				warnings,
			),
			auto: validateBoolean(raw.auto, DEFAULT_CONFIG.auto, "auto", warnings),
			trigger,
			model:
				validateString(
					raw.model,
					DEFAULT_CONFIG.model,
					"model",
					warnings,
				).trim() || DEFAULT_CONFIG.model,
			ui: {
				language: validateUiLanguage(rawUi.language, warnings),
			},
			apply: {
				terminalTitle: validateBoolean(
					rawApply.terminalTitle,
					DEFAULT_CONFIG.apply.terminalTitle,
					"apply.terminalTitle",
					warnings,
				),
				sessionName: validateBoolean(
					rawApply.sessionName,
					DEFAULT_CONFIG.apply.sessionName,
					"apply.sessionName",
					warnings,
				),
				overwriteSessionName: validateBoolean(
					rawApply.overwriteSessionName,
					DEFAULT_CONFIG.apply.overwriteSessionName,
					"apply.overwriteSessionName",
					warnings,
				),
			},
			style: {
				language: validateString(
					rawStyle.language,
					DEFAULT_CONFIG.style.language,
					"style.language",
					warnings,
				),
				maxChars: validatePositiveInteger(
					rawStyle.maxChars,
					DEFAULT_CONFIG.style.maxChars,
					"style.maxChars",
					warnings,
				),
				includeProject: validateBoolean(
					rawStyle.includeProject,
					DEFAULT_CONFIG.style.includeProject,
					"style.includeProject",
					warnings,
				),
				separator: validateString(
					rawStyle.separator,
					DEFAULT_CONFIG.style.separator,
					"style.separator",
					warnings,
				),
			},
			input: {
				includeFirstUserMessage: validateBoolean(
					rawInput.includeFirstUserMessage,
					DEFAULT_CONFIG.input.includeFirstUserMessage,
					"input.includeFirstUserMessage",
					warnings,
				),
				includeFirstAssistantMessage: validateBoolean(
					rawInput.includeFirstAssistantMessage,
					DEFAULT_CONFIG.input.includeFirstAssistantMessage,
					"input.includeFirstAssistantMessage",
					warnings,
				),
				includeCwd: validateBoolean(
					rawInput.includeCwd,
					DEFAULT_CONFIG.input.includeCwd,
					"input.includeCwd",
					warnings,
				),
				includeModel: validateBoolean(
					rawInput.includeModel,
					DEFAULT_CONFIG.input.includeModel,
					"input.includeModel",
					warnings,
				),
			},
			generation: {
				timeoutMs: validatePositiveInteger(
					rawGeneration.timeoutMs,
					DEFAULT_CONFIG.generation.timeoutMs,
					"generation.timeoutMs",
					warnings,
				),
			},
			fallback: {
				useProjectName: validateBoolean(
					rawFallback.useProjectName,
					DEFAULT_CONFIG.fallback.useProjectName,
					"fallback.useProjectName",
					warnings,
				),
				prefix: validateString(
					rawFallback.prefix,
					DEFAULT_CONFIG.fallback.prefix,
					"fallback.prefix",
					warnings,
				),
			},
		},
		warnings,
	};
}

export function validateConfig(input: unknown): {
	config: TitleRenamerConfig;
	warnings: string[];
} {
	const validated = validateConfigStructured(input);
	return {
		config: validated.config,
		warnings: validated.warnings.map((warning) =>
			formatWarning(warning, validated.config.ui.language),
		),
	};
}

function readConfigFile(
	filePath: string,
	options: Pick<ConfigFileSystem, "readFile" | "exists">,
): { value?: unknown; warning?: ConfigWarning } {
	if (!options.exists(filePath)) {
		return {};
	}

	try {
		return { value: JSON.parse(options.readFile(filePath)) };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { warning: { kind: "readFailed", filePath, message } };
	}
}

export function getConfigPaths(
	cwd = process.cwd(),
	homeDir = os.homedir(),
): ConfigPaths {
	return {
		global: path.join(homeDir, ".pi", "agent", "title-renamer.json"),
		project: path.join(cwd, ".pi", "title-renamer.json"),
	};
}

const nodeFileSystem: ConfigFileSystem = {
	readFile: (filePath) => fs.readFileSync(filePath, "utf8"),
	exists: (filePath) => fs.existsSync(filePath),
	writeFile: (filePath, data) => fs.writeFileSync(filePath, data),
	mkdir: (dirPath) => fs.mkdirSync(dirPath, { recursive: true }),
	remove: (filePath) => fs.rmSync(filePath, { force: true }),
};

export function loadConfig(
	cwd = process.cwd(),
	options: LoadConfigOptions = {},
): LoadedConfig {
	const paths = getConfigPaths(cwd, options.homeDir ?? os.homedir());
	const fsOptions = {
		readFile: options.readFile ?? nodeFileSystem.readFile,
		exists: options.exists ?? nodeFileSystem.exists,
	};

	const warnings: ConfigWarning[] = [];
	const globalConfig = readConfigFile(paths.global, fsOptions);
	const projectConfig = readConfigFile(paths.project, fsOptions);
	for (const file of [globalConfig, projectConfig]) {
		if (file.warning) {
			warnings.push(file.warning);
		}
	}

	let merged = cloneConfig(DEFAULT_CONFIG);
	if (globalConfig.value !== undefined) {
		merged = mergeConfig(merged, globalConfig.value);
	}
	if (projectConfig.value !== undefined) {
		merged = mergeConfig(merged, projectConfig.value);
	}

	const validated = validateConfigStructured(merged);
	warnings.push(...validated.warnings);

	return {
		config: validated.config,
		warnings: warnings.map((warning) =>
			formatWarning(warning, validated.config.ui.language),
		),
		paths,
		raw: { global: globalConfig.value, project: projectConfig.value },
	};
}

/** Returns the value stored at a dotted key path, or undefined when absent. */
export function getConfigValue(source: unknown, keyPath: string): unknown {
	let current: unknown = source;
	for (const part of keyPath.split(".")) {
		if (!isPlainObject(current)) {
			return undefined;
		}
		current = current[part];
	}
	return current;
}

function withConfigValue(
	source: Record<string, unknown>,
	keyPath: string,
	value: unknown,
): Record<string, unknown> {
	const [head, ...rest] = keyPath.split(".");
	if (!head) {
		return source;
	}
	if (rest.length === 0) {
		return { ...source, [head]: value };
	}
	const child = isPlainObject(source[head]) ? source[head] : {};
	return { ...source, [head]: withConfigValue(child, rest.join("."), value) };
}

/**
 * Writes one setting into a config file while keeping every other key the user
 * already had. Refuses to touch a file that is not valid JSON so hand edits are
 * never silently discarded.
 */
export function writeConfigValue(
	filePath: string,
	keyPath: string,
	value: unknown,
	options: {
		fileSystem?: ConfigFileSystem;
		language?: UiLanguage;
		/** Shorter path used in error messages. */
		displayPath?: string;
	} = {},
): void {
	const fileSystem = options.fileSystem ?? nodeFileSystem;
	let current: Record<string, unknown> = {};
	if (fileSystem.exists(filePath)) {
		let parsed: unknown;
		try {
			const text = fileSystem.readFile(filePath);
			parsed = text.trim() ? JSON.parse(text) : {};
		} catch {
			throw new Error(
				getMessages(options.language).config.writeParseFailed(
					options.displayPath ?? filePath,
				),
			);
		}
		if (!isPlainObject(parsed)) {
			throw new Error(
				getMessages(options.language).config.writeParseFailed(
					options.displayPath ?? filePath,
				),
			);
		}
		current = parsed;
	}

	const next = withConfigValue(current, keyPath, value);
	fileSystem.mkdir(path.dirname(filePath));
	fileSystem.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`);
}

/** Deletes a scope's config file so its values fall back to the next layer. */
export function resetConfigFile(
	filePath: string,
	options: { fileSystem?: ConfigFileSystem } = {},
): void {
	const fileSystem = options.fileSystem ?? nodeFileSystem;
	if (fileSystem.exists(filePath)) {
		fileSystem.remove(filePath);
	}
}
