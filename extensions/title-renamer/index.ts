import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { loadConfig, type TitleRenamerConfig } from "./config.ts";
import { getMessages, type Messages } from "./i18n.ts";
import {
	collectNamingContext,
	hasFirstTurn,
	type NamingContextOptions,
} from "./context.ts";
import {
	buildFallbackTitle,
	generateTitle,
	normalizeGeneratedTitle,
} from "./generator.ts";
import { sanitizeTitle } from "./sanitize.ts";
import {
	appendTitleRenamerState,
	blocksAutoRename,
	getLatestTitleToReapply,
	makeTitleRenamerState,
} from "./state.ts";

interface RenameResult {
	title?: string;
	warnings: string[];
	resolvedModel?: string;
	applied: boolean;
}

type RenameCommandContext = ExtensionContext &
	Partial<Pick<ExtensionCommandContext, "waitForIdle">>;
type RenameCommandSource = "command" | "input";

interface RenameCommandDedupe {
	active: Set<string>;
	recent?: {
		raw: string;
		source: RenameCommandSource;
		completedAt: number;
	};
}

const RENAME_COMMAND_NAME = "rename-title";
const SETTINGS_COMMAND_NAME = "title-renamer";
const RENAME_COMMAND_TEXT = `/${RENAME_COMMAND_NAME}`;
const COMMAND_DEDUPLICATION_MS = 500;
const TITLE_REAPPLY_DEBOUNCE_MS = 25;
const TITLE_REAPPLY_DELAYS_MS = [0, 50, 250, 1000, 3000] as const;
const RESET_AWARE_NAMING_CONTEXT: NamingContextOptions = {
	afterLatestReset: true,
};

function messagesFor(config: TitleRenamerConfig): Messages {
	return getMessages(config.ui.language);
}

/** Reads the interface language without letting a broken config stop the caller. */
function currentMessages(cwd: string): Messages {
	try {
		return messagesFor(loadConfig(cwd).config);
	} catch {
		return getMessages(undefined);
	}
}

function notifyWarnings(
	ctx: ExtensionContext,
	warnings: readonly string[],
): void {
	if (!ctx.hasUI) {
		return;
	}
	for (const warning of warnings) {
		ctx.ui.notify(warning, "warning");
	}
}

function notifyInfo(ctx: ExtensionContext, message: string): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, "info");
	}
}

function parseRawRenameCommand(text: string): { args: string } | undefined {
	const match = text.trim().match(/^\/rename-title(?:\s+([\s\S]*))?$/);
	if (!match) {
		return undefined;
	}
	return { args: match[1] ?? "" };
}

function formatRawRenameCommand(args: string): string {
	const trimmed = args.trim();
	return trimmed ? `${RENAME_COMMAND_TEXT} ${trimmed}` : RENAME_COMMAND_TEXT;
}

function isDuplicateRenameCommand(
	dedupe: RenameCommandDedupe,
	raw: string,
	source: RenameCommandSource,
): boolean {
	if (dedupe.active.has(raw)) {
		return true;
	}
	return !!(
		dedupe.recent &&
		dedupe.recent.raw === raw &&
		dedupe.recent.source !== source &&
		Date.now() - dedupe.recent.completedAt <= COMMAND_DEDUPLICATION_MS
	);
}

function scheduleTitleReapply(ctx: ExtensionContext, title: string): void {
	for (const delayMs of TITLE_REAPPLY_DELAYS_MS) {
		const timer = setTimeout(() => {
			try {
				if (ctx.hasUI) {
					ctx.ui.setTitle(title);
				}
			} catch {
				// Delayed reapply can race with session reload/replacement; ignore stale ctx errors.
			}
		}, delayMs);
		(timer as { unref?: () => void }).unref?.();
	}
}

function applyTitle(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	config: TitleRenamerConfig,
	title: string,
	manual: boolean,
	warnings: string[],
): boolean {
	let applied = false;
	if (config.apply.terminalTitle && ctx.hasUI) {
		ctx.ui.setTitle(title);
		scheduleTitleReapply(ctx, title);
		applied = true;
	}

	if (config.apply.sessionName) {
		const currentSessionName = pi.getSessionName();
		if (manual || config.apply.overwriteSessionName || !currentSessionName) {
			pi.setSessionName(title);
			applied = true;
		} else {
			warnings.push(messagesFor(config).notify.sessionNameExists);
		}
	}

	return applied;
}

function sanitizeCandidate(
	candidate: string | undefined,
	config: TitleRenamerConfig,
	warnings: string[],
): string | undefined {
	if (!candidate) {
		return undefined;
	}
	const sanitized = sanitizeTitle(candidate, {
		maxChars: config.style.maxChars,
	});
	if (sanitized.ok) {
		return sanitized.title;
	}
	const text = messagesFor(config);
	warnings.push(
		sanitized.code
			? text.sanitize[sanitized.code]
			: text.notify.sanitizeFailed,
	);
	return undefined;
}

function fallbackTitle(
	config: TitleRenamerConfig,
	ctx: ExtensionContext,
	warnings: string[],
	namingContext = collectNamingContext(ctx, config),
): string | undefined {
	const fallback = sanitizeCandidate(
		buildFallbackTitle(config, ctx.cwd, namingContext),
		config,
		warnings,
	);
	if (!fallback) {
		warnings.push(messagesFor(config).notify.noFallback);
	}
	return fallback;
}

async function renameFromModel(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	config: TitleRenamerConfig,
	manual: boolean,
	namingContextOptions?: NamingContextOptions,
): Promise<RenameResult> {
	const warnings: string[] = [];
	let resolvedModel: string | undefined;
	let title: string | undefined;
	const namingContext = collectNamingContext(ctx, config, namingContextOptions);

	try {
		const generated = await generateTitle(ctx, config, namingContext);
		resolvedModel = generated.resolvedModel;
		const sanitizedTitle = sanitizeCandidate(generated.text, config, warnings);
		title = sanitizedTitle
			? normalizeGeneratedTitle(sanitizedTitle, config, namingContext)
			: undefined;
		if (!title) {
			warnings.push(messagesFor(config).notify.generatedUnusable);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		warnings.push(messagesFor(config).notify.generationFailed(message));
	}

	if (!title) {
		title = fallbackTitle(config, ctx, warnings, namingContext);
	}

	const applied = title
		? applyTitle(pi, ctx, config, title, manual, warnings)
		: false;
	return { title, warnings, resolvedModel, applied };
}

function renameFromText(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	config: TitleRenamerConfig,
	text: string,
): RenameResult {
	const warnings: string[] = [];
	const title = sanitizeCandidate(text, config, warnings);
	if (!title) {
		return { warnings, applied: false };
	}
	const applied = applyTitle(pi, ctx, config, title, true, warnings);
	return { title, warnings, applied };
}

function recordResult(
	pi: ExtensionAPI,
	config: TitleRenamerConfig,
	result: RenameResult,
	manual: boolean,
	autoRenamed: boolean,
): void {
	appendTitleRenamerState(
		pi,
		makeTitleRenamerState({
			autoRenamed,
			title: result.title,
			model: config.model,
			resolvedModel: result.resolvedModel,
			manual,
			warnings: result.warnings,
		}),
	);
}

async function handleAutoRename(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): Promise<void> {
	const loaded = loadConfig(ctx.cwd);
	const config = loaded.config;
	const warnings = [...loaded.warnings];
	if (!config.enabled || !config.auto || config.trigger !== "first-agent-end") {
		return;
	}
	if (
		blocksAutoRename(
			ctx.sessionManager.getBranch() as Parameters<typeof blocksAutoRename>[0],
		)
	) {
		return;
	}
	if (!hasFirstTurn(ctx, RESET_AWARE_NAMING_CONTEXT)) {
		return;
	}

	const result = await renameFromModel(
		pi,
		ctx,
		config,
		false,
		RESET_AWARE_NAMING_CONTEXT,
	);
	warnings.push(...result.warnings);
	notifyWarnings(ctx, warnings);
	recordResult(pi, config, { ...result, warnings }, false, true);
}

async function handleCommand(
	pi: ExtensionAPI,
	args: string,
	ctx: RenameCommandContext,
): Promise<void> {
	await ctx.waitForIdle?.();
	const loaded = loadConfig(ctx.cwd);
	const config = loaded.config;
	const trimmed = args.trim();
	const text = messagesFor(config);

	if (trimmed === "--settings") {
		await openSettingsWithErrors(ctx);
		return;
	}

	if (trimmed === "--show-config") {
		notifyWarnings(ctx, loaded.warnings);
		notifyInfo(
			ctx,
			JSON.stringify(
				{ config, paths: loaded.paths, warnings: loaded.warnings },
				null,
				2,
			),
		);
		return;
	}

	if (trimmed === "--reset") {
		appendTitleRenamerState(
			pi,
			makeTitleRenamerState({
				autoRenamed: false,
				model: config.model,
				manual: true,
				reset: true,
				warnings: [text.notify.resetStateNote],
			}),
		);
		notifyInfo(ctx, text.notify.resetDone);
		return;
	}

	const result = trimmed
		? renameFromText(pi, ctx, config, trimmed)
		: await renameFromModel(pi, ctx, config, true);
	const warnings = [...loaded.warnings, ...result.warnings];
	notifyWarnings(ctx, warnings);
	recordResult(pi, config, { ...result, warnings }, true, false);
	if (result.title && result.applied) {
		notifyInfo(ctx, text.notify.titleRenamed(result.title));
	} else if (!result.title) {
		notifyWarnings(ctx, [text.notify.noTitleApplied]);
	}
}

async function openSettingsWithErrors(ctx: ExtensionContext): Promise<void> {
	try {
		const { openSettings } = await import("./settings-command.ts");
		await openSettings(ctx);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (ctx.hasUI) {
			ctx.ui.notify(
				currentMessages(ctx.cwd).notify.settingsFailed(message),
				"warning",
			);
		}
	}
}

async function runRenameCommand(
	pi: ExtensionAPI,
	args: string,
	ctx: RenameCommandContext,
	dedupe: RenameCommandDedupe,
	source: RenameCommandSource,
): Promise<void> {
	const raw = formatRawRenameCommand(args);
	if (isDuplicateRenameCommand(dedupe, raw, source)) {
		return;
	}

	dedupe.active.add(raw);
	try {
		await handleCommand(pi, args, ctx);
	} finally {
		dedupe.active.delete(raw);
		dedupe.recent = { raw, source, completedAt: Date.now() };
	}
}

type ReapplyTimer = ReturnType<typeof setTimeout> & { unref?: () => void };

function clearReapplyTimer(timer: ReapplyTimer | undefined): void {
	if (timer) {
		clearTimeout(timer);
	}
}

function reapplyPersistedTitle(ctx: ExtensionContext): void {
	try {
		const config = loadConfig(ctx.cwd).config;
		if (!config.apply.terminalTitle || !ctx.hasUI) {
			return;
		}
		const title = getLatestTitleToReapply(
			ctx.sessionManager.getBranch() as Parameters<
				typeof getLatestTitleToReapply
			>[0],
		);
		if (title) {
			scheduleTitleReapply(ctx, title);
		}
	} catch {
		// Reapply can race with reload/session replacement; stale contexts are ignored.
	}
}

export default function titleRenamer(pi: ExtensionAPI): void {
	const commandDedupe: RenameCommandDedupe = { active: new Set() };
	let pendingReapply: ReapplyTimer | undefined;

	const schedulePersistedTitleReapply = (ctx: ExtensionContext): void => {
		clearReapplyTimer(pendingReapply);
		pendingReapply = setTimeout(() => {
			pendingReapply = undefined;
			reapplyPersistedTitle(ctx);
		}, TITLE_REAPPLY_DEBOUNCE_MS) as ReapplyTimer;
		pendingReapply.unref?.();
	};

	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		schedulePersistedTitleReapply(ctx);
	});

	pi.on("turn_end", (_event, ctx: ExtensionContext) => {
		schedulePersistedTitleReapply(ctx);
	});

	pi.on("tool_execution_end", (_event, ctx: ExtensionContext) => {
		schedulePersistedTitleReapply(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		try {
			await handleAutoRename(pi, ctx);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (ctx.hasUI) {
				ctx.ui.notify(
					currentMessages(ctx.cwd).notify.autoInternalError(message),
					"warning",
				);
			}
		} finally {
			schedulePersistedTitleReapply(ctx);
		}
	});

	pi.on("session_shutdown", () => {
		clearReapplyTimer(pendingReapply);
		pendingReapply = undefined;
	});

	pi.on("input", async (event, ctx) => {
		const parsed = parseRawRenameCommand(event.text);
		if (!parsed) {
			return { action: "continue" };
		}

		try {
			await runRenameCommand(pi, parsed.args, ctx, commandDedupe, "input");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (ctx.hasUI) {
				ctx.ui.notify(
					currentMessages(ctx.cwd).notify.inputFallbackFailed(message),
					"warning",
				);
			}
		}
		return { action: "handled" };
	});

	const startupText = currentMessages(process.cwd());

	pi.registerCommand(RENAME_COMMAND_NAME, {
		description: startupText.commands.renameTitle,
		handler: async (args, ctx) => {
			try {
				await runRenameCommand(pi, args, ctx, commandDedupe, "command");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (ctx.hasUI) {
					ctx.ui.notify(
						currentMessages(ctx.cwd).notify.commandFailed(message),
						"warning",
					);
				}
			}
		},
	});

	pi.registerCommand(SETTINGS_COMMAND_NAME, {
		description: startupText.commands.settings,
		handler: async (_args, ctx) => {
			await openSettingsWithErrors(ctx);
		},
	});
}
