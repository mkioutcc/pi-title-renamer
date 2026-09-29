import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	findSetting,
	nextChoiceValue,
	parseSettingInput,
	SETTING_DEFINITIONS,
	SettingsSession,
	type SettingsSessionOptions,
	type SettingsStatus,
} from "./settings.ts";

function availableModels(ctx: ExtensionContext): string[] {
	try {
		const models = ctx.modelRegistry.getAvailable?.() ?? [];
		return [...new Set(models.map((model) => `${model.provider}/${model.id}`))];
	} catch {
		return [];
	}
}

function notifyStatus(ctx: ExtensionContext, status: SettingsStatus | undefined): void {
	if (!status) return;
	ctx.ui.notify(status.text, status.tone === "success" ? "info" : status.tone);
}

/**
 * Opens the settings editor. Uses the full-screen panel in the terminal UI and
 * falls back to plain select/input dialogs for clients such as RPC.
 */
export async function openSettings(
	ctx: ExtensionContext,
	options: SettingsSessionOptions = {},
): Promise<void> {
	const session = new SettingsSession(ctx.cwd, options);
	if (!ctx.hasUI) {
		return;
	}

	if (ctx.mode === "tui" && ctx.ui.custom) {
		const { SettingsPanel } = await import("./settings-panel.ts");
		const models = availableModels(ctx);
		await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
			return new SettingsPanel({
				session,
				theme,
				keybindings,
				availableModels: models,
				host: {
					requestRender: () => tui.requestRender(),
					terminalRows: () => tui.terminal?.rows ?? 40,
				},
				onClose: () => done(undefined),
			});
		});
		return;
	}

	if (!ctx.ui.select || !ctx.ui.input) {
		ctx.ui.notify(session.messages.notify.settingsNeedUi, "warning");
		return;
	}
	await runDialogSettings(ctx, session);
}

async function runDialogSettings(
	ctx: ExtensionContext,
	session: SettingsSession,
): Promise<void> {
	const select = ctx.ui.select!;
	const input = ctx.ui.input!;

	while (true) {
		const text = session.messages.settings;
		const entries = SETTING_DEFINITIONS.filter(
			(definition) => definition.control.type !== "fixed",
		).map((definition) => ({
			id: definition.id as string,
			label: `${text.items[definition.id].label}: ${session.display(definition.id)}`,
		}));
		entries.push(
			{ id: "scope", label: `${text.saveScope.label}: ${session.scopeLabel()}` },
			{ id: "reset", label: `${text.resetScope.label} (${session.scopeLabel()})` },
			{ id: "done", label: text.dialogDone },
		);

		const picked = await select(
			`${text.title} · ${text.savingTo(session.scopeLabel())}`,
			entries.map((entry) => entry.label),
		);
		const entry = entries.find((item) => item.label === picked);
		if (!entry || entry.id === "done") {
			return;
		}
		if (entry.id === "scope") {
			session.toggleScope();
			continue;
		}
		if (entry.id === "reset") {
			const confirmed = await ctx.ui.confirm?.(text.resetScope.label, text.resetScope.description);
			if (confirmed ?? true) notifyStatus(ctx, session.reset());
			continue;
		}

		const definition = SETTING_DEFINITIONS.find((item) => item.id === entry.id);
		if (!definition) continue;
		const current = session.value(definition.id);
		const label = text.items[definition.id].label;

		switch (definition.control.type) {
			case "toggle":
				notifyStatus(ctx, session.change(definition.id, !current));
				break;
			case "choice":
				notifyStatus(ctx, session.change(definition.id, nextChoiceValue(definition, current)));
				break;
			case "model": {
				const models = ["inherit", ...availableModels(ctx)];
				const choice = await select(label, models.map((model) =>
					model === "inherit" ? `${text.inheritModel} (inherit)` : model,
				));
				if (!choice) break;
				const value = choice.endsWith("(inherit)") ? "inherit" : choice;
				notifyStatus(ctx, session.change(definition.id, value));
				break;
			}
			default: {
				// The dialog shows the current value as a placeholder; an empty answer keeps it.
				const raw = await input(label, String(current ?? ""));
				if (raw === undefined || raw === "") break;
				const parsed = parseSettingInput(findSetting(definition.id), raw, session.messages);
				notifyStatus(
					ctx,
					parsed.ok
						? session.change(definition.id, parsed.value)
						: { tone: "error", text: parsed.error },
				);
			}
		}
	}
}
