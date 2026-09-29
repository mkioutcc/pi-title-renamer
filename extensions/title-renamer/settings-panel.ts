import type {
	KeybindingsManager,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	Input,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { SectionId } from "./i18n.ts";
import {
	parseSettingInput,
	type SettingDefinition,
	SETTING_DEFINITIONS,
	type SettingsSession,
	type SettingsStatus,
	nextChoiceValue,
} from "./settings.ts";

type Row =
	| { kind: "header"; section: SectionId }
	| { kind: "setting"; definition: SettingDefinition }
	| { kind: "scope" }
	| { kind: "reset" };

type Mode = "list" | "edit" | "pick" | "confirmReset";

export interface SettingsPanelHost {
	requestRender(): void;
	terminalRows(): number;
}

export interface SettingsPanelOptions {
	session: SettingsSession;
	theme: Pick<Theme, "fg" | "bold">;
	keybindings: Pick<KeybindingsManager, "matches">;
	host: SettingsPanelHost;
	/** Models offered by the model picker, as "provider/model-id". */
	availableModels: readonly string[];
	onClose: () => void;
}

const MAX_LABEL_WIDTH = 30;
const PICKER_VISIBLE = 8;
/**
 * Lines kept free for everything except the scrolling list: borders, header,
 * scroll indicator, a two-line description, one status line, hints, and Pi's
 * own footer below the panel.
 */
const CHROME_LINES = 15;

function buildRows(): Row[] {
	const rows: Row[] = [];
	let section: SectionId | undefined;
	for (const definition of SETTING_DEFINITIONS) {
		if (definition.section !== section) {
			section = definition.section;
			rows.push({ kind: "header", section });
		}
		rows.push({ kind: "setting", definition });
	}
	rows.push({ kind: "header", section: "manage" });
	rows.push({ kind: "scope" }, { kind: "reset" });
	return rows;
}

const isSelectable = (row: Row | undefined): boolean =>
	!!row && row.kind !== "header";

/** Input.setValue keeps the cursor where it was; typing the value leaves it at the end. */
function fillInput(input: Input, value: string): void {
	input.setValue("");
	for (const char of value) {
		input.handleInput(char);
	}
}

/**
 * Full-screen settings editor for Title Renamer. Every change is written to
 * disk immediately, so closing the panel never loses work.
 */
export class SettingsPanel implements Component, Focusable {
	private readonly session: SettingsSession;
	private readonly theme: SettingsPanelOptions["theme"];
	private readonly keybindings: SettingsPanelOptions["keybindings"];
	private readonly host: SettingsPanelHost;
	private readonly availableModels: readonly string[];
	private readonly onClose: () => void;
	private readonly rows = buildRows();
	private selected: number;
	private scrollTop = 0;
	private mode: Mode = "list";
	private status: SettingsStatus | undefined;
	private readonly editor = new Input({ prompt: "" });
	private readonly filter = new Input({ prompt: "› " });
	private pickerIndex = 0;
	private pickerScroll = 0;
	private _focused = false;

	constructor(options: SettingsPanelOptions) {
		this.session = options.session;
		this.theme = options.theme;
		this.keybindings = options.keybindings;
		this.host = options.host;
		this.availableModels = options.availableModels;
		this.onClose = options.onClose;
		this.selected = this.rows.findIndex(isSelectable);
		this.editor.onSubmit = (value) => this.commitEdit(value);
		this.editor.onEscape = () => this.leaveMode();
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.editor.focused = value && this.mode === "edit";
		this.filter.focused = value && this.mode === "pick";
	}

	invalidate(): void {
		this.editor.invalidate();
		this.filter.invalidate();
	}

	// ── Input ────────────────────────────────────────────────────────────

	handleInput(data: string): void {
		switch (this.mode) {
			case "edit":
				this.editor.handleInput(data);
				break;
			case "pick":
				this.handlePickerInput(data);
				break;
			case "confirmReset":
				if (this.keybindings.matches(data, "tui.select.confirm")) {
					this.status = this.session.reset();
				} else {
					this.status = undefined;
				}
				this.setMode("list");
				break;
			default:
				this.handleListInput(data);
		}
		this.host.requestRender();
	}

	private handleListInput(data: string): void {
		const kb = this.keybindings;
		if (kb.matches(data, "tui.select.up")) {
			this.move(-1);
		} else if (kb.matches(data, "tui.select.down")) {
			this.move(1);
		} else if (kb.matches(data, "tui.select.pageUp")) {
			this.move(-5);
		} else if (kb.matches(data, "tui.select.pageDown")) {
			this.move(5);
		} else if (kb.matches(data, "tui.select.confirm") || data === " ") {
			this.activate();
		} else if (kb.matches(data, "tui.select.cancel")) {
			this.onClose();
		}
	}

	private move(delta: number): void {
		const step = delta < 0 ? -1 : 1;
		let remaining = Math.abs(delta);
		let index = this.selected;
		while (remaining > 0) {
			let next = index + step;
			while (next >= 0 && next < this.rows.length && !isSelectable(this.rows[next])) {
				next += step;
			}
			if (next < 0 || next >= this.rows.length) {
				// Wrap around only on single steps, like Pi's own lists.
				if (Math.abs(delta) === 1) {
					next = step > 0 ? this.rows.findIndex(isSelectable) : this.lastSelectable();
				} else {
					break;
				}
			}
			index = next;
			remaining--;
		}
		if (index !== this.selected) {
			this.selected = index;
			this.status = undefined;
		}
	}

	private lastSelectable(): number {
		for (let index = this.rows.length - 1; index >= 0; index--) {
			if (isSelectable(this.rows[index])) return index;
		}
		return 0;
	}

	private activate(): void {
		const row = this.rows[this.selected];
		if (!row) return;
		if (row.kind === "scope") {
			this.session.toggleScope();
			this.status = undefined;
			return;
		}
		if (row.kind === "reset") {
			this.setMode("confirmReset");
			return;
		}
		if (row.kind !== "setting") return;

		const { definition } = row;
		const current = this.session.value(definition.id);
		switch (definition.control.type) {
			case "toggle":
				this.status = this.session.change(definition.id, !current);
				break;
			case "choice":
				this.status = this.session.change(
					definition.id,
					nextChoiceValue(definition, current),
				);
				break;
			case "fixed":
				this.status = {
					tone: "warning",
					text: this.session.messages.settings.readOnly,
				};
				break;
			case "model":
				fillInput(this.filter, "");
				this.pickerIndex = Math.max(0, this.pickerOptions().indexOf(String(current)));
				this.pickerScroll = 0;
				this.status = undefined;
				this.setMode("pick");
				break;
			default:
				fillInput(this.editor, String(current ?? ""));
				this.status = undefined;
				this.setMode("edit");
		}
	}

	private commitEdit(value: string): void {
		const row = this.rows[this.selected];
		if (row?.kind !== "setting") return;
		const parsed = parseSettingInput(row.definition, value, this.session.messages);
		if (!parsed.ok) {
			this.status = { tone: "error", text: parsed.error };
			this.host.requestRender();
			return;
		}
		this.status = this.session.change(row.definition.id, parsed.value);
		this.setMode("list");
		this.host.requestRender();
	}

	private leaveMode(): void {
		this.status = undefined;
		this.setMode("list");
		this.host.requestRender();
	}

	private setMode(mode: Mode): void {
		this.mode = mode;
		this.focused = this._focused;
	}

	// ── Model picker ─────────────────────────────────────────────────────

	private pickerOptions(): string[] {
		const query = this.filter.getValue().trim();
		const all = ["inherit", ...this.availableModels.filter((model) => model !== "inherit")];
		const lowered = query.toLowerCase();
		const matches = query
			? all.filter((model) => model.toLowerCase().includes(lowered))
			: all;
		const definition = this.currentDefinition();
		if (
			query &&
			definition &&
			!matches.includes(query) &&
			parseSettingInput(definition, query, this.session.messages).ok
		) {
			matches.push(query);
		}
		return matches;
	}

	private currentDefinition(): SettingDefinition | undefined {
		const row = this.rows[this.selected];
		return row?.kind === "setting" ? row.definition : undefined;
	}

	private handlePickerInput(data: string): void {
		const kb = this.keybindings;
		const options = this.pickerOptions();
		if (kb.matches(data, "tui.select.up")) {
			if (options.length) this.pickerIndex = (this.pickerIndex - 1 + options.length) % options.length;
		} else if (kb.matches(data, "tui.select.down")) {
			if (options.length) this.pickerIndex = (this.pickerIndex + 1) % options.length;
		} else if (kb.matches(data, "tui.select.cancel")) {
			this.leaveMode();
		} else if (kb.matches(data, "tui.select.confirm")) {
			const choice = options[this.pickerIndex];
			const definition = this.currentDefinition();
			if (choice && definition) {
				this.status = this.session.change(definition.id, choice);
				this.setMode("list");
			} else if (this.filter.getValue().trim()) {
				this.status = { tone: "error", text: this.session.messages.settings.errorModel };
			}
		} else {
			this.filter.handleInput(data);
			this.pickerIndex = 0;
			this.pickerScroll = 0;
		}
	}

	// ── Rendering ────────────────────────────────────────────────────────

	render(width: number): string[] {
		const { theme } = this;
		const text = this.session.messages.settings;
		const inner = Math.max(10, width - 2);
		const lines: string[] = [];
		const pad = (line: string) => truncateToWidth(` ${line}`, width);

		lines.push(theme.fg("borderAccent", "─".repeat(width)));
		lines.push(pad(theme.fg("accent", theme.bold(text.title))));
		lines.push(
			pad(
				theme.fg("muted", text.savingTo(this.session.scopeLabel())) +
					theme.fg("dim", `  ${this.session.displayPath()}`),
			),
		);
		const warningCount = this.session.loaded.warnings.length;
		if (warningCount > 0) {
			lines.push(pad(theme.fg("warning", `⚠ ${text.configWarnings(warningCount)}`)));
		}
		lines.push("");

		if (this.mode === "pick") {
			lines.push(...this.renderPicker(width));
		} else {
			lines.push(...this.renderList(width, warningCount > 0 ? 1 : 0));
		}

		lines.push("");
		const description = this.selectedDescription();
		if (description && this.mode !== "pick") {
			for (const line of wrapTextWithAnsi(description, inner - 1)) {
				lines.push(pad(theme.fg("dim", line)));
			}
		}
		if (this.status) {
			const color =
				this.status.tone === "success"
					? "success"
					: this.status.tone === "warning"
						? "warning"
						: "error";
			const icon = this.status.tone === "success" ? "✓" : this.status.tone === "warning" ? "⚠" : "✗";
			for (const line of wrapTextWithAnsi(`${icon} ${this.status.text}`, inner - 1)) {
				lines.push(pad(theme.fg(color, line)));
			}
		}
		lines.push("");
		const hint =
			this.mode === "edit"
				? text.hints.edit
				: this.mode === "pick"
					? text.hints.pick
					: this.mode === "confirmReset"
						? text.hints.confirm
						: text.hints.list;
		lines.push(pad(theme.fg("dim", hint)));
		lines.push(theme.fg("borderAccent", "─".repeat(width)));
		return lines.map((line) => truncateToWidth(line, width));
	}

	private selectedDescription(): string | undefined {
		const row = this.rows[this.selected];
		const text = this.session.messages.settings;
		if (row?.kind === "setting") return text.items[row.definition.id].description;
		if (row?.kind === "scope") return text.saveScope.description;
		if (row?.kind === "reset") return text.resetScope.description;
		return undefined;
	}

	private rowLabel(row: Row): string {
		const text = this.session.messages.settings;
		switch (row.kind) {
			case "setting":
				return text.items[row.definition.id].label;
			case "scope":
				return text.saveScope.label;
			case "reset":
				return text.resetScope.label;
			case "header":
				return text.sections[row.section];
		}
	}

	private visibleListLines(extraChrome: number): number {
		const rows = this.host.terminalRows();
		const available = rows - CHROME_LINES - extraChrome;
		return Math.max(6, Math.min(this.rows.length, available));
	}

	private renderList(width: number, extraChrome: number): string[] {
		const { theme } = this;
		const maxVisible = this.visibleListLines(extraChrome);

		// Keep the selected row visible, and show its section header when it is
		// the first row of a section.
		const anchor = isSelectable(this.rows[this.selected - 1]) ? this.selected : this.selected - 1;
		if (anchor < this.scrollTop) this.scrollTop = Math.max(0, anchor);
		if (this.selected >= this.scrollTop + maxVisible) this.scrollTop = this.selected - maxVisible + 1;
		this.scrollTop = Math.min(this.scrollTop, Math.max(0, this.rows.length - maxVisible));

		const labelWidth = Math.min(
			MAX_LABEL_WIDTH,
			Math.max(...this.rows.filter(isSelectable).map((row) => visibleWidth(this.rowLabel(row)))),
		);
		const valueColumn = 2 + labelWidth + 2;
		const valueWidth = Math.max(8, width - valueColumn - 2);

		const lines: string[] = [];
		const end = Math.min(this.rows.length, this.scrollTop + maxVisible);
		for (let index = this.scrollTop; index < end; index++) {
			const row = this.rows[index];
			if (!row) continue;
			if (row.kind === "header") {
				lines.push(truncateToWidth(` ${theme.fg("muted", theme.bold(this.rowLabel(row)))}`, width));
				continue;
			}
			const selected = index === this.selected;
			const cursor = selected ? theme.fg("accent", "→ ") : "  ";
			const rawLabel = truncateToWidth(this.rowLabel(row), labelWidth, "…");
			const paddedLabel = rawLabel + " ".repeat(Math.max(0, labelWidth - visibleWidth(rawLabel)));
			const label = selected ? theme.fg("accent", paddedLabel) : theme.fg("text", paddedLabel);

			let value: string;
			if (selected && this.mode === "edit") {
				value = this.editor.render(valueWidth)[0] ?? "";
			} else {
				value = this.renderValue(row, selected, valueWidth);
			}
			lines.push(truncateToWidth(` ${cursor}${label}  ${value}`, width));
		}

		if (this.scrollTop > 0 || end < this.rows.length) {
			const position = this.rows.slice(0, this.selected + 1).filter(isSelectable).length;
			const total = this.rows.filter(isSelectable).length;
			const arrows = `${this.scrollTop > 0 ? "↑" : " "}${end < this.rows.length ? "↓" : " "}`;
			lines.push(theme.fg("dim", `   ${arrows} ${position}/${total}`));
		}
		return lines;
	}

	private renderValue(row: Row, selected: boolean, maxWidth: number): string {
		const { theme } = this;
		const text = this.session.messages.settings;
		let display: string;
		let color: Parameters<Theme["fg"]>[0] = "muted";

		if (row.kind === "scope") {
			const global = this.session.scopeLabel("global");
			const project = this.session.scopeLabel("project");
			const active = (label: string, on: boolean) =>
				on ? theme.fg(selected ? "accent" : "text", theme.bold(`● ${label}`)) : theme.fg("dim", `○ ${label}`);
			return truncateToWidth(
				`${active(global, this.session.scope === "global")}   ${active(project, this.session.scope === "project")}`,
				maxWidth,
				"…",
			);
		}
		if (row.kind === "reset") {
			if (this.mode === "confirmReset" && selected) {
				return theme.fg("warning", theme.bold(text.resetConfirm));
			}
			const label = text.resetAction(this.session.scopeLabel());
			const clippedLabel = truncateToWidth(label, maxWidth, "…");
			return selected ? theme.fg("warning", clippedLabel) : theme.fg("muted", clippedLabel);
		} else if (row.kind === "setting") {
			const { definition } = row;
			const value = this.session.value(definition.id);
			display = this.session.display(definition.id);
			if (definition.control.type === "toggle") {
				color = value ? "success" : "dim";
				display = `${value ? "●" : "○"} ${display}`;
			} else if (definition.control.type === "fixed") {
				color = "dim";
			}
			if (definition.control.type === "choice") {
				display = `‹ ${display} ›`;
			}
		} else {
			return "";
		}

		const clipped = truncateToWidth(display, maxWidth, "…");
		return selected && color !== "dim" ? theme.fg("accent", clipped) : theme.fg(color, clipped);
	}

	private renderPicker(width: number): string[] {
		const { theme } = this;
		const text = this.session.messages.settings;
		const options = this.pickerOptions();
		const current = String(this.session.value("model"));
		const lines: string[] = [];

		lines.push(truncateToWidth(` ${theme.fg("accent", theme.bold(text.pickModelTitle))}`, width));
		lines.push(truncateToWidth(` ${theme.fg("dim", text.pickModelFilter)}`, width));
		lines.push(` ${this.filter.render(Math.max(10, width - 2))[0] ?? ""}`);
		lines.push("");

		if (options.length === 0) {
			lines.push(truncateToWidth(`   ${theme.fg("dim", text.pickModelNoMatch)}`, width));
			return lines;
		}

		this.pickerIndex = Math.min(this.pickerIndex, options.length - 1);
		if (this.pickerIndex < this.pickerScroll) this.pickerScroll = this.pickerIndex;
		if (this.pickerIndex >= this.pickerScroll + PICKER_VISIBLE) {
			this.pickerScroll = this.pickerIndex - PICKER_VISIBLE + 1;
		}
		const query = this.filter.getValue().trim();
		const end = Math.min(options.length, this.pickerScroll + PICKER_VISIBLE);
		for (let index = this.pickerScroll; index < end; index++) {
			const option = options[index] ?? "";
			const selected = index === this.pickerIndex;
			const isCustom = option === query && !this.availableModels.includes(option) && option !== "inherit";
			const label =
				option === "inherit"
					? `${text.inheritModel} (inherit)`
					: isCustom
						? text.pickModelCustom(option)
						: option;
			const mark = option === current ? theme.fg("success", " ✓") : "";
			const cursor = selected ? theme.fg("accent", "→ ") : "  ";
			const body = selected ? theme.fg("accent", label) : theme.fg("text", label);
			lines.push(truncateToWidth(`  ${cursor}${body}${mark}`, width));
		}
		if (options.length > PICKER_VISIBLE) {
			lines.push(theme.fg("dim", `     ${this.pickerIndex + 1}/${options.length}`));
		}
		return lines;
	}
}
