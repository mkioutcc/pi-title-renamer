declare const process: {
	cwd(): string;
	env: Record<string, string | undefined>;
};

declare module "node:fs" {
	interface RmOptions {
		recursive?: boolean;
		force?: boolean;
	}
	function existsSync(path: string): boolean;
	function readFileSync(path: string, encoding: string): string;
	function mkdtempSync(prefix: string): string;
	function mkdirSync(path: string, options?: { recursive?: boolean }): void;
	function writeFileSync(path: string, data: string): void;
	function rmSync(path: string, options?: RmOptions): void;
	const fs: {
		existsSync: typeof existsSync;
		readFileSync: typeof readFileSync;
		mkdtempSync: typeof mkdtempSync;
		mkdirSync: typeof mkdirSync;
		writeFileSync: typeof writeFileSync;
		rmSync: typeof rmSync;
	};
	export {
		existsSync,
		readFileSync,
		mkdtempSync,
		mkdirSync,
		writeFileSync,
		rmSync,
	};
	export default fs;
}

declare module "node:os" {
	function homedir(): string;
	function tmpdir(): string;
	const os: {
		homedir: typeof homedir;
		tmpdir: typeof tmpdir;
	};
	export { homedir, tmpdir };
	export default os;
}

declare module "node:path" {
	function join(...parts: string[]): string;
	function basename(filePath: string): string;
	const path: {
		join: typeof join;
		basename: typeof basename;
	};
	export { join, basename };
	export default path;
}

declare module "node:test" {
	function test(name: string, fn: () => void | Promise<void>): void;
	export { test };
}

declare module "node:assert/strict" {
	const assert: {
		equal(actual: unknown, expected: unknown, message?: string): void;
		deepEqual(actual: unknown, expected: unknown, message?: string): void;
		ok(value: unknown, message?: string): void;
		match(actual: string, expected: RegExp, message?: string): void;
		throws(fn: () => unknown, expected?: RegExp, message?: string): void;
	};
	export default assert;
}

declare module "@earendil-works/pi-ai" {
	export interface Model<TApi = any> {
		id: string;
		provider: string;
		api?: TApi;
		[key: string]: unknown;
	}

	export interface TextContent {
		type: "text";
		text: string;
	}

	export interface AssistantMessage {
		content: Array<TextContent | { type: string; [key: string]: unknown }>;
	}

	export function complete(
		model: Model<any>,
		context: unknown,
		options?: Record<string, unknown>,
	): Promise<AssistantMessage>;
}

declare module "@earendil-works/pi-coding-agent" {
	import type { Model } from "@earendil-works/pi-ai";

	export interface ExtensionUIContext {
		notify(message: string, type?: "info" | "warning" | "error"): void;
		setTitle(title: string): void;
	}

	export interface ExtensionContext {
		ui: ExtensionUIContext;
		hasUI: boolean;
		cwd: string;
		sessionManager: {
			getBranch(): unknown[];
			getEntries?(): unknown[];
			getSessionName?(): string | undefined;
		};
		modelRegistry: {
			find(provider: string, modelId: string): Model<any> | undefined;
			getApiKeyAndHeaders(
				model: Model<any>,
			): Promise<
				| { ok: true; apiKey?: string; headers?: Record<string, string> }
				| { ok: false; error: string }
			>;
		};
		model: Model<any> | undefined;
		signal: AbortSignal | undefined;
		isIdle(): boolean;
	}

	export interface ExtensionCommandContext extends ExtensionContext {
		waitForIdle(): Promise<void>;
	}

	export interface AgentEndEvent {
		type: "agent_end";
		messages: unknown[];
	}

	export interface InputEvent {
		type: "input";
		text: string;
		images?: unknown[];
		source: "interactive" | "rpc" | "extension";
		streamingBehavior?: "steer" | "followUp";
	}

	export type InputEventResult =
		| { action: "continue" }
		| { action: "transform"; text: string; images?: unknown[] }
		| { action: "handled" };

	export interface ExtensionAPI {
		on(
			event: "agent_end",
			handler: (
				event: AgentEndEvent,
				ctx: ExtensionContext,
			) => Promise<void> | void,
		): void;
		on(
			event: "input",
			handler: (
				event: InputEvent,
				ctx: ExtensionContext,
			) => Promise<InputEventResult | void> | InputEventResult | void,
		): void;
		registerCommand(
			name: string,
			options: {
				description?: string;
				handler: (
					args: string,
					ctx: ExtensionCommandContext,
				) => Promise<void> | void;
			},
		): void;
		appendEntry<T = unknown>(customType: string, data?: T): void;
		setSessionName(name: string): void;
		getSessionName(): string | undefined;
	}
}
