export const UI_LANGUAGES = ["en", "zh-TW"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];
export const DEFAULT_UI_LANGUAGE: UiLanguage = "en";

export function isUiLanguage(value: unknown): value is UiLanguage {
	return (
		typeof value === "string" &&
		(UI_LANGUAGES as readonly string[]).includes(value)
	);
}

export type SectionId =
	| "general"
	| "apply"
	| "style"
	| "input"
	| "generation"
	| "fallback"
	| "manage";

export type SettingId =
	| "ui.language"
	| "enabled"
	| "auto"
	| "trigger"
	| "model"
	| "apply.terminalTitle"
	| "apply.sessionName"
	| "apply.overwriteSessionName"
	| "style.language"
	| "style.maxChars"
	| "style.includeProject"
	| "style.separator"
	| "input.includeFirstUserMessage"
	| "input.includeFirstAssistantMessage"
	| "input.includeCwd"
	| "input.includeModel"
	| "generation.timeoutMs"
	| "fallback.useProjectName"
	| "fallback.prefix";

interface SettingText {
	label: string;
	description: string;
}

export interface Messages {
	languageName: Record<UiLanguage, string>;
	commands: {
		renameTitle: string;
		settings: string;
	};
	notify: {
		sessionNameExists: string;
		sanitizeFailed: string;
		noFallback: string;
		generatedUnusable: string;
		generationFailed: (message: string) => string;
		autoInternalError: (message: string) => string;
		resetStateNote: string;
		resetDone: string;
		titleRenamed: (title: string) => string;
		noTitleApplied: string;
		inputFallbackFailed: (message: string) => string;
		commandFailed: (message: string) => string;
		settingsNeedUi: string;
		settingsFailed: (message: string) => string;
	};
	sanitize: {
		notString: string;
		invalidMaxChars: string;
		empty: string;
	};
	generator: {
		invalidModelSpec: (model: string) => string;
		noCurrentModel: string;
		modelNotFound: (model: string) => string;
		noApiKey: (model: string) => string;
		timedOut: (ms: number) => string;
		emptyResponse: string;
	};
	config: {
		invalidRoot: string;
		invalidValue: (key: string, fallback: string) => string;
		unsupportedTrigger: (value: string, fallback: string) => string;
		readFailed: (filePath: string, message: string) => string;
		writeParseFailed: (filePath: string) => string;
	};
	settings: {
		title: string;
		savingTo: (scope: string) => string;
		scope: { global: string; project: string };
		sections: Record<SectionId, string>;
		items: Record<SettingId, SettingText>;
		on: string;
		off: string;
		inheritModel: string;
		triggerFirstAgentEnd: string;
		titleLanguage: { en: string; zh: string };
		saveScope: SettingText;
		resetScope: SettingText;
		resetAction: (scope: string) => string;
		resetConfirm: string;
		resetDone: (scope: string) => string;
		saved: (scope: string) => string;
		overridden: string;
		readOnly: string;
		configWarnings: (count: number) => string;
		errorInteger: (min: number, max: number) => string;
		errorEmpty: string;
		errorModel: string;
		pickModelTitle: string;
		pickModelFilter: string;
		pickModelCustom: (value: string) => string;
		pickModelNoMatch: string;
		hints: {
			list: string;
			edit: string;
			pick: string;
			confirm: string;
		};
		dialogDone: string;
	};
}

const en: Messages = {
	languageName: { en: "English", "zh-TW": "繁體中文" },
	commands: {
		renameTitle: "Generate, set, inspect, or reset the Pi terminal title",
		settings: "Open Title Renamer settings",
	},
	notify: {
		sessionNameExists:
			"Session name already exists; turn on “Overwrite session name” to replace it during auto rename.",
		sanitizeFailed: "Title could not be sanitized.",
		noFallback:
			"No fallback title could be produced; leaving terminal title unchanged.",
		generatedUnusable: "Generated title was unusable; using fallback title.",
		generationFailed: (message) => `Title generation failed: ${message}`,
		autoInternalError: (message) =>
			`Title renamer skipped after an internal error: ${message}`,
		resetStateNote: "Automatic title rename state reset.",
		resetDone:
			"Title renamer auto state reset. The next eligible agent_end can rename again.",
		titleRenamed: (title) => `Title renamed: ${title}`,
		noTitleApplied: "No title was applied.",
		inputFallbackFailed: (message) =>
			`Title renamer input fallback failed: ${message}`,
		commandFailed: (message) => `Title renamer command failed: ${message}`,
		settingsNeedUi: "Title Renamer settings need an interactive Pi session.",
		settingsFailed: (message) => `Could not open settings: ${message}`,
	},
	sanitize: {
		notString: "Title is not a string.",
		invalidMaxChars: "maxChars must be a positive integer.",
		empty: "Title is empty after sanitization.",
	},
	generator: {
		invalidModelSpec: (model) =>
			`Invalid title-renamer model ${JSON.stringify(model)}; expected "inherit" or "provider/model-id".`,
		noCurrentModel:
			"No current Pi model is available for title-renamer model: inherit.",
		modelNotFound: (model) => `Title-renamer model not found: ${model}.`,
		noApiKey: (model) =>
			`No API key available for title-renamer model ${model}.`,
		timedOut: (ms) => `Title generation timed out after ${ms}ms.`,
		emptyResponse: "Title-renamer model returned an empty response.",
	},
	config: {
		invalidRoot: "Invalid title-renamer config root; using defaults.",
		invalidValue: (key, fallback) =>
			`Invalid title-renamer config ${key}; using default ${fallback}.`,
		unsupportedTrigger: (value, fallback) =>
			`Unsupported title-renamer config trigger ${value}; using default ${fallback}.`,
		readFailed: (filePath, message) =>
			`Could not read title-renamer config ${filePath}: ${message}`,
		writeParseFailed: (filePath) =>
			`${filePath} is not valid JSON. Fix or delete it before changing settings here.`,
	},
	settings: {
		title: "Title Renamer Settings",
		savingTo: (scope) => `Saving to: ${scope}`,
		scope: { global: "Global", project: "Project" },
		sections: {
			general: "General",
			apply: "Where to apply",
			style: "Title style",
			input: "Context sent to the model",
			generation: "Generation",
			fallback: "Fallback",
			manage: "Manage",
		},
		items: {
			"ui.language": {
				label: "Interface language",
				description:
					"Language for this settings screen and Title Renamer messages.",
			},
			enabled: {
				label: "Enabled",
				description:
					"Turn automatic renaming on or off. /rename-title keeps working either way.",
			},
			auto: {
				label: "Auto rename",
				description:
					"Rename automatically after the first reply. Turn off to rename only with /rename-title.",
			},
			trigger: {
				label: "When to rename",
				description:
					"Rename once, right after the first assistant reply finishes. This is the only option for now.",
			},
			model: {
				label: "Title model",
				description:
					"Model that writes the title. “Current model” uses whatever model this session is using.",
			},
			"apply.terminalTitle": {
				label: "Terminal tab title",
				description: "Show the title on the terminal window or tab.",
			},
			"apply.sessionName": {
				label: "Session name",
				description:
					"Also save the title as the Pi session name, so it is easy to find later.",
			},
			"apply.overwriteSessionName": {
				label: "Overwrite session name",
				description:
					"Let automatic renaming replace a session name that already exists. /rename-title <text> always replaces it.",
			},
			"style.language": {
				label: "Title language",
				description:
					"Language the model uses when writing the title. Other values can still be set in the JSON file.",
			},
			"style.maxChars": {
				label: "Max length",
				description: "Longest title allowed, in characters.",
			},
			"style.includeProject": {
				label: "Add project name",
				description:
					"End the title with the project folder name, like “Auth fix｜my-app”.",
			},
			"style.separator": {
				label: "Separator",
				description: "Text placed between the topic and the project name.",
			},
			"input.includeFirstUserMessage": {
				label: "First user message",
				description: "Send your first message to the model when writing the title.",
			},
			"input.includeFirstAssistantMessage": {
				label: "First assistant reply",
				description:
					"Send the first assistant reply to the model when writing the title.",
			},
			"input.includeCwd": {
				label: "Working folder",
				description: "Send the current folder path to the model.",
			},
			"input.includeModel": {
				label: "Active model name",
				description: "Send the name of the model in use to the model.",
			},
			"generation.timeoutMs": {
				label: "Timeout (ms)",
				description:
					"How long to wait for the model before using the fallback title. 1000 ms = 1 second.",
			},
			"fallback.useProjectName": {
				label: "Use project name",
				description:
					"Add the project name to the fallback title used when the model fails.",
			},
			"fallback.prefix": {
				label: "Prefix",
				description:
					"Text used when there is nothing better, for example “Pi｜my-app”.",
			},
		},
		on: "On",
		off: "Off",
		inheritModel: "Current model",
		triggerFirstAgentEnd: "After first reply",
		titleLanguage: { en: "English", zh: "Chinese" },
		saveScope: {
			label: "Save changes to",
			description:
				"Global applies everywhere. Project saves to .pi/title-renamer.json in this folder and overrides global values.",
		},
		resetScope: {
			label: "Reset to defaults",
			description:
				"Delete the config file for the selected save location. Values fall back to global config or defaults.",
		},
		resetAction: (scope) => `Reset ${scope.toLowerCase()} settings`,
		resetConfirm: "Press Enter again to confirm",
		resetDone: (scope) => `${scope} settings reset to defaults.`,
		saved: (scope) => `Saved to ${scope}.`,
		overridden:
			"Saved, but project config still overrides this value. Switch “Save changes to” to Project.",
		readOnly: "This setting has only one option right now.",
		configWarnings: (count) =>
			`${count} config problem${count === 1 ? "" : "s"} found. Run /rename-title --show-config for details.`,
		errorInteger: (min, max) => `Enter a whole number from ${min} to ${max}.`,
		errorEmpty: "This value cannot be empty.",
		errorModel: "Use provider/model-id, for example openai/gpt-4o-mini.",
		pickModelTitle: "Choose title model",
		pickModelFilter: "Type to filter or enter provider/model-id",
		pickModelCustom: (value) => `Use “${value}”`,
		pickModelNoMatch: "No matching models",
		hints: {
			list: "↑↓ move · Enter/Space change · Esc close",
			edit: "Enter save · Esc cancel",
			pick: "↑↓ move · Enter choose · Esc back",
			confirm: "Enter confirm · any other key cancels",
		},
		dialogDone: "Done",
	},
};

const zhTW: Messages = {
	languageName: { en: "English", "zh-TW": "繁體中文" },
	commands: {
		renameTitle: "產生、設定、查看或重設 Pi 終端機標題",
		settings: "開啟 Title Renamer 設定",
	},
	notify: {
		sessionNameExists:
			"已經有工作階段名稱；如要在自動命名時取代，請開啟「覆寫工作階段名稱」。",
		sanitizeFailed: "標題無法整理成可用的格式。",
		noFallback: "無法產生備用標題，終端機標題維持不變。",
		generatedUnusable: "產生的標題無法使用，改用備用標題。",
		generationFailed: (message) => `標題產生失敗：${message}`,
		autoInternalError: (message) => `Title Renamer 發生內部錯誤，已略過：${message}`,
		resetStateNote: "已重設自動命名狀態。",
		resetDone: "已重設自動命名狀態。下一次完整對話後會再自動命名。",
		titleRenamed: (title) => `標題已更新：${title}`,
		noTitleApplied: "沒有套用任何標題。",
		inputFallbackFailed: (message) => `Title Renamer 指令處理失敗：${message}`,
		commandFailed: (message) => `Title Renamer 指令失敗：${message}`,
		settingsNeedUi: "Title Renamer 設定需要在互動式 Pi 中開啟。",
		settingsFailed: (message) => `無法開啟設定：${message}`,
	},
	sanitize: {
		notString: "標題不是文字。",
		invalidMaxChars: "maxChars 必須是正整數。",
		empty: "整理後的標題是空的。",
	},
	generator: {
		invalidModelSpec: (model) =>
			`title-renamer 模型 ${JSON.stringify(model)} 格式錯誤；請使用 "inherit" 或 "provider/model-id"。`,
		noCurrentModel: "目前沒有可用的 Pi 模型（model: inherit）。",
		modelNotFound: (model) => `找不到 title-renamer 模型：${model}。`,
		noApiKey: (model) => `title-renamer 模型 ${model} 沒有可用的 API 金鑰。`,
		timedOut: (ms) => `標題產生逾時（${ms} 毫秒）。`,
		emptyResponse: "title-renamer 模型沒有回傳內容。",
	},
	config: {
		invalidRoot: "title-renamer 設定檔格式錯誤，改用預設值。",
		invalidValue: (key, fallback) =>
			`title-renamer 設定 ${key} 的值無效，改用預設值 ${fallback}。`,
		unsupportedTrigger: (value, fallback) =>
			`不支援的 title-renamer 觸發時機 ${value}，改用預設值 ${fallback}。`,
		readFailed: (filePath, message) =>
			`無法讀取 title-renamer 設定檔 ${filePath}：${message}`,
		writeParseFailed: (filePath) =>
			`${filePath} 不是有效的 JSON。請先修正或刪除，再在這裡變更設定。`,
	},
	settings: {
		title: "Title Renamer 設定",
		savingTo: (scope) => `儲存位置：${scope}`,
		scope: { global: "全域", project: "此專案" },
		sections: {
			general: "一般",
			apply: "套用位置",
			style: "標題樣式",
			input: "提供給模型的內容",
			generation: "產生",
			fallback: "備用標題",
			manage: "管理",
		},
		items: {
			"ui.language": {
				label: "介面語言",
				description: "此設定畫面與 Title Renamer 訊息使用的語言。",
			},
			enabled: {
				label: "啟用",
				description: "開啟或關閉自動命名。無論如何，/rename-title 都能使用。",
			},
			auto: {
				label: "自動命名",
				description: "在第一次回覆後自動命名。關閉後只能用 /rename-title 手動命名。",
			},
			trigger: {
				label: "命名時機",
				description: "在第一則助理回覆完成後命名一次。目前只有這個選項。",
			},
			model: {
				label: "標題模型",
				description: "用來產生標題的模型。「目前模型」會使用這個工作階段正在用的模型。",
			},
			"apply.terminalTitle": {
				label: "終端機分頁標題",
				description: "把標題顯示在終端機視窗或分頁上。",
			},
			"apply.sessionName": {
				label: "工作階段名稱",
				description: "同時把標題存成 Pi 工作階段名稱，之後比較好找。",
			},
			"apply.overwriteSessionName": {
				label: "覆寫工作階段名稱",
				description:
					"允許自動命名取代已經存在的工作階段名稱。/rename-title <文字> 一律會取代。",
			},
			"style.language": {
				label: "標題語言",
				description: "模型撰寫標題時使用的語言。其他語言仍可在 JSON 設定檔中指定。",
			},
			"style.maxChars": {
				label: "最大長度",
				description: "標題最多可以有幾個字。",
			},
			"style.includeProject": {
				label: "加上專案名稱",
				description: "在標題最後加上專案資料夾名稱，例如「修正登入｜my-app」。",
			},
			"style.separator": {
				label: "分隔符號",
				description: "主題與專案名稱之間的文字。",
			},
			"input.includeFirstUserMessage": {
				label: "第一則使用者訊息",
				description: "產生標題時，提供你的第一則訊息給模型。",
			},
			"input.includeFirstAssistantMessage": {
				label: "第一則助理回覆",
				description: "產生標題時，提供第一則助理回覆給模型。",
			},
			"input.includeCwd": {
				label: "工作資料夾",
				description: "提供目前資料夾路徑給模型。",
			},
			"input.includeModel": {
				label: "目前模型名稱",
				description: "提供正在使用的模型名稱給模型。",
			},
			"generation.timeoutMs": {
				label: "逾時（毫秒）",
				description: "等待模型多久後改用備用標題。1000 毫秒 = 1 秒。",
			},
			"fallback.useProjectName": {
				label: "使用專案名稱",
				description: "模型失敗時，在備用標題中加上專案名稱。",
			},
			"fallback.prefix": {
				label: "前綴文字",
				description: "沒有其他可用內容時使用的文字，例如「Pi｜my-app」。",
			},
		},
		on: "開",
		off: "關",
		inheritModel: "目前模型",
		triggerFirstAgentEnd: "第一次回覆後",
		titleLanguage: { en: "英文", zh: "中文" },
		saveScope: {
			label: "變更儲存到",
			description:
				"全域會套用到所有地方。此專案會存到這裡的 .pi/title-renamer.json，並優先於全域設定。",
		},
		resetScope: {
			label: "還原預設值",
			description: "刪除目前儲存位置的設定檔。數值會改回全域設定或預設值。",
		},
		resetAction: (scope) => `還原${scope}設定`,
		resetConfirm: "再按一次 Enter 確認",
		resetDone: (scope) => `已將${scope}設定還原為預設值。`,
		saved: (scope) => `已儲存到${scope}。`,
		overridden: "已儲存，但此專案的設定仍會覆蓋這個值。請把「變更儲存到」切換為此專案。",
		readOnly: "這個設定目前只有一個選項。",
		configWarnings: (count) =>
			`設定檔有 ${count} 個問題。執行 /rename-title --show-config 查看詳情。`,
		errorInteger: (min, max) => `請輸入 ${min} 到 ${max} 之間的整數。`,
		errorEmpty: "這個值不能是空的。",
		errorModel: "請使用 provider/model-id 格式，例如 openai/gpt-4o-mini。",
		pickModelTitle: "選擇標題模型",
		pickModelFilter: "輸入文字篩選，或直接輸入 provider/model-id",
		pickModelCustom: (value) => `使用「${value}」`,
		pickModelNoMatch: "沒有符合的模型",
		hints: {
			list: "↑↓ 移動 · Enter/空白鍵 變更 · Esc 關閉",
			edit: "Enter 儲存 · Esc 取消",
			pick: "↑↓ 移動 · Enter 選擇 · Esc 返回",
			confirm: "Enter 確認 · 按其他鍵取消",
		},
		dialogDone: "完成",
	},
};

const MESSAGES: Record<UiLanguage, Messages> = { en, "zh-TW": zhTW };

export function getMessages(language: UiLanguage | undefined): Messages {
	return MESSAGES[language ?? DEFAULT_UI_LANGUAGE] ?? en;
}
