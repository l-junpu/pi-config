/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Supports three modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	getMarkdownTheme,
	type ModelRegistry,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	Key,
	matchesKey,
	Markdown,
	Spacer,
	Text,
	truncateToWidth,
	type TUI,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { type AgentConfig, type AgentScope, discoverAgents, resolveSkills } from "./agents.ts";

const DEFAULT_MAX_PARALLEL_TASKS = 8;
const DEFAULT_MAX_CONCURRENCY = 4;
const COLLAPSED_ITEM_COUNT = 10;
const PER_TASK_OUTPUT_CAP = 50 * 1024;

interface SubagentToolConfig {
	maxParallelTasks: number;
	maxConcurrentSubagents: number;
	/** Override for where subagent session files are written. Supports a leading "~". Unset uses the default (nested under the parent session's own directory, falling back to the OS tmpdir). */
	sessionsDir?: string;
}

/** Coerce a config value to a positive integer, falling back to `fallback` if invalid. */
function coercePositiveInt(value: unknown, fallback: number): number {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n) || n < 1) return fallback;
	return Math.floor(n);
}

/**
 * Read `pi-subagents.json` fresh on every call (mirrors agent discovery, which
 * also re-reads on each invocation to allow hot-editing mid-session). Missing
 * or malformed config must fall back to defaults rather than throw, since this
 * runs inline in a tool call.
 */
function loadSubagentToolConfig(): SubagentToolConfig {
	const configPath = path.join(getAgentDir(), "pi-subagents.json");
	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
	} catch {
		raw = {};
	}
	const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	return {
		maxParallelTasks: coercePositiveInt(obj.maxParallelTasks, DEFAULT_MAX_PARALLEL_TASKS),
		maxConcurrentSubagents: coercePositiveInt(obj.maxConcurrentSubagents, DEFAULT_MAX_CONCURRENCY),
		sessionsDir: typeof obj.sessionsDir === "string" && obj.sessionsDir.trim() ? obj.sessionsDir.trim() : undefined,
	};
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "find ") + themeFg("accent", pattern) + themeFg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	/** Human-readable summary of which skills this run's subprocess had available. */
	skills?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
	/** True if the agent's own model failed to produce any output and this result came from retrying with the main session's model instead. */
	usedFallbackModel?: boolean;
	/** Session file this run was persisted to, for later `resume`. Absent for parallel/chain steps, which aren't resumable. */
	sessionPath?: string;
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
}

function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

function isFailedResult(result: SingleResult): boolean {
	return result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
}

function getResultOutput(result: SingleResult): string {
	if (isFailedResult(result)) {
		return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
	}
	return getFinalOutput(result.messages) || "(no output)";
}

function truncateParallelOutput(output: string): string {
	const byteLength = Buffer.byteLength(output, "utf8");
	if (byteLength <= PER_TASK_OUTPUT_CAP) return output;

	let truncated = output.slice(0, PER_TASK_OUTPUT_CAP);
	while (Buffer.byteLength(truncated, "utf8") > PER_TASK_OUTPUT_CAP) {
		truncated = truncated.slice(0, -1);
	}
	return `${truncated}\n\n[Output truncated: ${byteLength - Buffer.byteLength(truncated, "utf8")} bytes omitted. Full output preserved in tool details.]`;
}

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, any> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await withFileMutationQueue(filePath, async () => {
		await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	});
	return { dir: tmpDir, filePath };
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

interface DispatchDefaults {
	model?: string;
	thinkingLevel?: ThinkingLevel;
	modelRegistry?: ModelRegistry;
}

/**
 * Agent frontmatter models are often bare ids (e.g. "claude-haiku-4-5") without
 * a "provider/" prefix. Search the *available* models (auth actually configured)
 * for a model with that exact id, and qualify it with whichever provider has it.
 *
 * getAll() would match against pi-ai's full static catalog, including providers
 * with no configured auth -- e.g. matching "claude-sonnet-4-5" under an
 * unauthenticated "anthropic" entry even when the session is set up for a
 * completely different provider. That produces a model string the child
 * process can't actually use, so it silently falls back to its own default
 * instead of the intended agent model. getAvailable() avoids that.
 *
 * If no available model has that id, fall back to the main session's own
 * model rather than guessing a "provider/agentModel" combination that doesn't exist.
 */
function resolveAgentModel(agentModel: string | undefined, dispatchDefaults: DispatchDefaults): string | undefined {
	if (!agentModel) return dispatchDefaults.model;
	if (agentModel.includes("/")) return agentModel;

	const found = dispatchDefaults.modelRegistry?.getAvailable().find((m) => m.id === agentModel);
	if (found) return `${found.provider}/${found.id}`;
	return dispatchDefaults.model ?? agentModel;
}

interface AccumulatedRun {
	messages: Message[];
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
}

/**
 * Shared by the live stdout-event stream (`processLine` below) and by rehydrating a
 * finished run's messages/usage straight from its session `.jsonl` file (see
 * `loadRunFromSessionFile`) -- both feed the same `Message` shape into the same fields.
 */
function accumulateMessage(target: AccumulatedRun, msg: Message): void {
	target.messages.push(msg);
	if (msg.role !== "assistant") return;
	target.usage.turns++;
	const usage = msg.usage;
	if (usage) {
		target.usage.input += usage.input || 0;
		target.usage.output += usage.output || 0;
		target.usage.cacheRead += usage.cacheRead || 0;
		target.usage.cacheWrite += usage.cacheWrite || 0;
		target.usage.cost += usage.cost?.total || 0;
		target.usage.contextTokens = usage.totalTokens || 0;
	}
	if (!target.model && msg.model) target.model = msg.model;
	if (msg.stopReason) target.stopReason = msg.stopReason;
	if (msg.errorMessage) target.errorMessage = msg.errorMessage;
}

/**
 * Parses a subagent's persisted session file back into the same shape a live run
 * builds incrementally, for rehydrating resumable runs across a pi process restart.
 * Returns undefined if the file is missing or unreadable -- callers should skip
 * that run rather than treat it as a fatal error.
 */
function loadRunFromSessionFile(sessionPath: string): AccumulatedRun | undefined {
	let raw: string;
	try {
		raw = fs.readFileSync(sessionPath, "utf-8");
	} catch {
		return undefined;
	}
	const result: AccumulatedRun = { messages: [], usage: emptyUsageStats() };
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		let entry: any;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (entry.type === "message" && entry.message) accumulateMessage(result, entry.message as Message);
	}
	return result;
}

function emptyUsageStats(): UsageStats {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

/** A single spawn-and-wait attempt against an explicit, already-resolved model. No fallback logic here -- that lives in runSingleAgent. */
async function runSingleAgentAttempt(
	defaultCwd: string,
	dispatchDefaults: DispatchDefaults,
	agent: AgentConfig,
	model: string | undefined,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
	sessionPath: string,
): Promise<SingleResult> {
	const agentName = agent.name;
	// Subagents get no extensions by default: they're isolated, single-purpose
	// dispatches that only need their configured built-in tools, not the parent
	// session's extension set. `--session <path>` (rather than `--no-session`)
	// persists the run to a file this extension controls, so a later call can
	// pass the same path back in to resume the conversation.
	const args: string[] = ["--mode", "json", "-p", "--session", sessionPath, "--no-extensions"];
	const inheritsDispatchConfig = !agent.model;
	if (model) args.push("--model", model);
	if (inheritsDispatchConfig && dispatchDefaults.thinkingLevel) {
		args.push("--thinking", dispatchDefaults.thinkingLevel);
	}
	if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));
	const resolvedSkills = resolveSkills(cwd ?? defaultCwd, agent.skills);
	args.push(...resolvedSkills.args);

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	const currentResult: SingleResult = {
		agent: agentName,
		agentSource: agent.source,
		task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		model,
		skills: resolvedSkills.display,
		step,
		sessionPath,
	};

	const emitUpdate = () => {
		if (onUpdate) {
			onUpdate({
				content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
				details: makeDetails([currentResult]),
			});
		}
	};

	try {
		if (agent.systemPrompt.trim()) {
			const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.push("--append-system-prompt", tmpPromptPath);
		}

		args.push(`Task: ${task}`);
		let wasAborted = false;

		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd: cwd ?? defaultCwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let buffer = "";

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: any;
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				if (event.type === "message_end" && event.message) {
					accumulateMessage(currentResult, event.message as Message);
					emitUpdate();
				}

				if (event.type === "tool_result_end" && event.message) {
					accumulateMessage(currentResult, event.message as Message);
					emitUpdate();
				}
			};

			proc.stdout.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (data) => {
				currentResult.stderr += data.toString();
			});

			proc.on("close", (code) => {
				if (buffer.trim()) processLine(buffer);
				resolve(code ?? 0);
			});

			proc.on("error", () => {
				resolve(1);
			});

			if (signal) {
				const killProc = () => {
					wasAborted = true;
					proc.kill("SIGTERM");
					setTimeout(() => {
						if (!proc.killed) proc.kill("SIGKILL");
					}, 5000);
				};
				if (signal.aborted) killProc();
				else signal.addEventListener("abort", killProc, { once: true });
			}
		});

		currentResult.exitCode = exitCode;
		if (wasAborted) throw new Error("Subagent was aborted");
		return currentResult;
	} finally {
		if (tmpPromptPath)
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				/* ignore */
			}
		if (tmpPromptDir)
			try {
				fs.rmdirSync(tmpPromptDir);
			} catch {
				/* ignore */
			}
	}
}

/**
 * Resolves the agent's model and runs it. If that attempt fails and the agent wasn't
 * already using the main session's own model, retry once forced onto the main
 * session's live model instead of giving up. A provider/auth failure doesn't
 * necessarily mean zero output -- it can surface as an assistant message with
 * stopReason "error" -- so any failure is enough to trigger the retry, not just
 * a message-less crash.
 */
async function runSingleAgent(
	defaultCwd: string,
	dispatchDefaults: DispatchDefaults,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
	sessionPath: string,
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName);

	if (!agent) {
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			step,
		};
	}

	const model = resolveAgentModel(agent.model, dispatchDefaults);
	const result = await runSingleAgentAttempt(
		defaultCwd, dispatchDefaults, agent, model, task, cwd, step, signal, onUpdate, makeDetails, sessionPath,
	);

	const canFallback = dispatchDefaults.model !== undefined && dispatchDefaults.model !== model;
	if (!isFailedResult(result) || !canFallback) return result;

	const fallbackResult = await runSingleAgentAttempt(
		defaultCwd, dispatchDefaults, agent, dispatchDefaults.model, task, cwd, step, signal, onUpdate, makeDetails, sessionPath,
	);
	fallbackResult.usedFallbackModel = true;
	fallbackResult.stderr = [result.stderr, fallbackResult.stderr].filter(Boolean).join("\n");
	return fallbackResult;
}

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
	default: "user",
});

const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	resume: Type.Optional(
		Type.String({
			description:
				"Single mode only. Run id of a previous single-mode run (foreground or background) to resume instead of " +
				"starting fresh -- continues its conversation with full prior context. Omit \"agent\" when resuming; the " +
				"original run's agent is reused. The referenced run must still be tracked this session (see the fleet " +
				"inspector's [resumable] tag) and not currently running.",
		}),
	),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of steps for sequential execution" })),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
	async: Type.Optional(
		Type.Boolean({
			description:
				"Single mode only. Run in the background instead of blocking: returns immediately with a run id. " +
				"On completion, the result is delivered quietly (no interruption) if the agent succeeded, or an " +
				"immediate notification is raised if it failed. Default: false.",
			default: false,
		}),
	),
});

interface BackgroundTask {
	id: string;
	agent: string;
	task: string;
	status: "running" | "done" | "failed";
	startedAt: number;
	endedAt?: number;
	controller: AbortController;
	summary?: string;
	reviewed?: boolean;
}

/** A single dispatched subagent run, foreground or background, kept for the lifetime of the process. */
interface RunRecord {
	id: string;
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	mode: "single" | "parallel" | "chain" | "background";
	status: "running" | "done" | "failed";
	startedAt: number;
	endedAt?: number;
	messages: Message[];
	usage: UsageStats;
	model?: string;
	skills?: string;
	stopReason?: string;
	errorMessage?: string;
	/** Session file this run is (or was) persisted to. Set for the lifetime of the process, so a later `resume` can hand the same path back to `pi --session`. */
	sessionPath: string;
}

const MAX_TRACKED_RUNS = 50;
const RUN_WIDGET_VISIBLE_COUNT = 6;

// Same pastel palette/animation as pi-todo-list's widget, so the two panels match.
const PASTEL_RAINBOW = [
	"\x1b[38;2;255;179;186m",
	"\x1b[38;2;255;223;186m",
	"\x1b[38;2;255;255;186m",
	"\x1b[38;2;186;255;201m",
	"\x1b[38;2;186;225;255m",
	"\x1b[38;2;218;186;255m",
];
const RESET_FG = "\x1b[39m";
function colorize(text: string, color: string): string {
	return `${color}${text}${RESET_FG}`;
}
const PULSE_INDICATOR = {
	frames: [
		colorize("\u00b7", PASTEL_RAINBOW[0]!),
		colorize("\u2022", PASTEL_RAINBOW[2]!),
		colorize("\u25cf", PASTEL_RAINBOW[4]!),
		colorize("\u2022", PASTEL_RAINBOW[5]!),
	],
	intervalMs: 120,
};
const DOT_INDICATOR = {
	frames: [colorize("\u25cf", PASTEL_RAINBOW[0]!)],
};

export default function (pi: ExtensionAPI) {
	// Session-scoped state for background (async: true) single-mode dispatches.
	let sessionCtx: ExtensionContext | undefined;
	let sessionBusy = false;
	// Guards post-completion side effects: session_shutdown fires on process exit
	// (including print-mode one-shot runs), after which pi/ctx are stale and
	// throw if touched. A background subagent finishing after that point must
	// skip appendEntry/sendMessage/notify entirely, not just log the crash.
	let sessionAlive = true;
	const backgroundTasks = new Map<string, BackgroundTask>();

	/**
	 * Directory for subagent session files. Defaults to a sibling folder next to the
	 * *parent* session's own file -- e.g. a persisted parent at
	 * `~/.pi/agent/sessions/<cwd>/<parent-session>.jsonl` gets its subagents nested at
	 * `~/.pi/agent/sessions/<cwd>/<parent-session>-subagents/<run-id>.jsonl` -- so they're
	 * easy to find and get cleaned up alongside the parent. An ephemeral parent (no
	 * persisted session file, e.g. `--no-session` or a one-shot `-p` run) has nothing to
	 * nest under, so this falls back to the OS tmpdir instead. `sessionsDir` in
	 * `pi-subagents.json` overrides either default with an explicit absolute path.
	 */
	function subagentSessionsDir(): string {
		const configured = loadSubagentToolConfig().sessionsDir;
		const dir = configured
			? configured.replace(/^~(?=$|[/\\])/, os.homedir())
			: (() => {
					const parentFile = sessionCtx?.sessionManager.getSessionFile();
					if (parentFile) return `${parentFile.slice(0, -path.extname(parentFile).length)}-subagents`;
					return path.join(os.tmpdir(), "pi-subagents-sessions");
				})();
		fs.mkdirSync(dir, { recursive: true });
		return dir;
	}

	function newSubagentSessionPath(runId: string): string {
		return path.join(subagentSessionsDir(), `${runId}.jsonl`);
	}

	/**
	 * Lifecycle events on pi's shared event bus (`subagents:*`), so other
	 * extensions can react to subagent activity without importing this one.
	 * Mirrors tintinweb/pi-subagents' channel naming; safe to share the prefix
	 * since this is the only extension in this environment using it.
	 */
	function emitSubagentEvent(channel: string, data: unknown): void {
		pi.events.emit(`subagents:${channel}`, data);
	}

	// Unified history of every subagent run dispatched this process (foreground
	// single/parallel/chain members and background runs alike), newest last.
	// Backs both the persistent above-editor widget and the /subagents browser.
	const allRuns = new Map<string, RunRecord>();
	// Set while the fleet inspector (/subagents) is open, so run-state changes live-refresh it too.
	let fleetInspectorRefresh: (() => void) | undefined;
	const emptyUsage = (): UsageStats => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 });

	/**
	 * `resumeSessionPath` carries a prior run's session file into this one (see the
	 * `resume` tool param) so the two share the same conversation history; omitted for
	 * a fresh run, which gets its own new session file.
	 */
	function trackRun(mode: RunRecord["mode"], agent: string, task: string, id?: string, resumeSessionPath?: string): string {
		const runId = id ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		allRuns.set(runId, {
			id: runId,
			agent,
			agentSource: "unknown",
			task,
			mode,
			status: "running",
			startedAt: Date.now(),
			messages: [],
			usage: emptyUsage(),
			sessionPath: resumeSessionPath ?? newSubagentSessionPath(runId),
		});
		// Evict oldest finished runs once the cap is hit, keeping any still running.
		if (allRuns.size > MAX_TRACKED_RUNS) {
			for (const [key, run] of allRuns) {
				if (allRuns.size <= MAX_TRACKED_RUNS) break;
				if (run.status !== "running") allRuns.delete(key);
			}
		}
		emitSubagentEvent("created", { id: runId, agent, mode, task, isBackground: mode === "background" });
		// Foreground modes (single/parallel/chain) have no queue -- the subprocess
		// spawns immediately, so "started" fires alongside "created". Background mode's
		// own queue (acquireBackgroundSlot) emits "started" separately once a slot frees up.
		if (mode !== "background") {
			emitSubagentEvent("started", { id: runId, agent, mode, task });
		}
		syncSubagentWidget();
		return runId;
	}

	function updateRunFromResult(runId: string, result: SingleResult): void {
		const run = allRuns.get(runId);
		if (!run) return;
		run.agentSource = result.agentSource;
		run.messages = result.messages;
		run.usage = result.usage;
		run.model = result.model;
		run.skills = result.skills;
		run.stopReason = result.stopReason;
		run.errorMessage = result.errorMessage;
		syncSubagentWidget();
	}

	/**
	 * Cross-restart resume relies on this: a run only becomes rehydratable after it
	 * finishes successfully. Failed/cancelled runs never get a manifest, so they're
	 * simply gone (not resumable, not shown as broken) once this process exits.
	 */
	function writeRunManifest(run: RunRecord): void {
		try {
			const manifestPath = run.sessionPath.replace(/\.jsonl$/, ".meta.json");
			fs.writeFileSync(
				manifestPath,
				JSON.stringify({
					id: run.id,
					agent: run.agent,
					agentSource: run.agentSource,
					task: run.task,
					mode: run.mode,
					skills: run.skills,
					startedAt: run.startedAt,
					endedAt: run.endedAt,
				}),
				"utf-8",
			);
		} catch {
			/* best-effort persistence -- resume within this process still works either way */
		}
	}

	/**
	 * On `session_start`, repopulate `allRuns` from any manifests left by a prior pi
	 * process against the same parent session, so `resume` keeps working across restarts.
	 */
	function rehydrateRunsFromDisk(): void {
		const dir = subagentSessionsDir();
		let files: string[];
		try {
			files = fs.readdirSync(dir);
		} catch {
			return;
		}
		const manifests: Array<{ path: string; data: any }> = [];
		for (const file of files) {
			if (!file.endsWith(".meta.json")) continue;
			try {
				const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
				if (data && typeof data.id === "string") manifests.push({ path: path.join(dir, file), data });
			} catch {
				/* skip corrupt/partial manifest */
			}
		}
		manifests.sort((a, b) => (b.data.startedAt ?? 0) - (a.data.startedAt ?? 0));
		for (const { data } of manifests.slice(0, MAX_TRACKED_RUNS)) {
			if (allRuns.has(data.id)) continue;
			const sessionPath = path.join(dir, `${data.id}.jsonl`);
			const parsed = loadRunFromSessionFile(sessionPath);
			if (!parsed) continue;
			allRuns.set(data.id, {
				id: data.id,
				agent: data.agent,
				agentSource: data.agentSource ?? "unknown",
				task: data.task,
				mode: data.mode,
				status: "done",
				startedAt: data.startedAt,
				endedAt: data.endedAt,
				messages: parsed.messages,
				usage: parsed.usage,
				model: parsed.model,
				skills: data.skills,
				stopReason: parsed.stopReason,
				errorMessage: parsed.errorMessage,
				sessionPath,
			});
		}
		syncSubagentWidget();
	}

	function finalizeRun(runId: string, result: SingleResult): void {
		const run = allRuns.get(runId);
		if (!run) return;
		updateRunFromResult(runId, result);
		const failed = isFailedResult(result);
		run.status = failed ? "failed" : "done";
		run.endedAt = Date.now();
		if (!failed) writeRunManifest(run);
		emitSubagentEvent(failed ? "failed" : "completed", {
			id: run.id,
			agent: run.agent,
			mode: run.mode,
			task: run.task,
			status: run.status,
			usage: run.usage,
			durationMs: run.endedAt - run.startedAt,
			errorMessage: run.errorMessage,
		});
		syncSubagentWidget();
	}

	// Lightweight semaphore so background dispatches queue behind the same
	// maxConcurrentSubagents cap used by foreground parallel mode. Not a single
	// unified pool with in-flight parallel-mode batches (those use their own
	// per-call worker pool) -- a known simplification, not a hard guarantee.
	let activeBackgroundSlots = 0;
	const backgroundQueue: Array<() => void> = [];
	function acquireBackgroundSlot(maxSlots: number): Promise<void> {
		if (activeBackgroundSlots < maxSlots) {
			activeBackgroundSlots++;
			return Promise.resolve();
		}
		return new Promise((resolve) => backgroundQueue.push(resolve));
	}
	function releaseBackgroundSlot() {
		activeBackgroundSlots--;
		const next = backgroundQueue.shift();
		if (next) {
			activeBackgroundSlots++;
			next();
		}
	}

	// Guards against re-emitting `subagents:ready` on a second bound session_start
	// within the same activation (e.g. session resume/switch).
	let subagentsReadyEmitted = false;
	pi.on("session_start", async (_event, ctx) => {
		sessionCtx = ctx;
		rehydrateRunsFromDisk();
		if (!subagentsReadyEmitted) {
			subagentsReadyEmitted = true;
			emitSubagentEvent("ready", {});
		}
	});
	pi.on("agent_start", async () => {
		sessionBusy = true;
	});
	pi.on("agent_settled", async () => {
		sessionBusy = false;
	});
	pi.on("session_shutdown", async () => {
		sessionAlive = false;
		for (const t of backgroundTasks.values()) {
			if (t.status === "running") t.controller.abort();
		}
	});

	function formatElapsedShort(ms: number): string {
		const s = Math.round(ms / 1000);
		if (s < 60) return `${s}s`;
		const m = Math.round(s / 60);
		return `${m}m`;
	}

	function runStatusIcon(status: RunRecord["status"], frame: number): string {
		if (status === "done") return DOT_INDICATOR.frames[0]!;
		if (status === "failed") return "\x1b[2m\u2717\x1b[22m";
		return PULSE_INDICATOR.frames[frame % PULSE_INDICATOR.frames.length]!;
	}

	// Persistent above-editor widget mirroring pi-todo-list's look: a small
	// header plus one line per run, pulsing while running. Shows both past and
	// present runs from this process (foreground and background); the full
	// history with context preview lives behind /subagents.
	let widgetTui: TUI | undefined;
	let widgetInvalidate: (() => void) | undefined;

	function createSubagentWidget(tui: TUI, theme: any) {
		let frame = 0;
		let animationTimer: ReturnType<typeof setInterval> | undefined;
		let cachedWidth: number | undefined;
		let cachedLines: string[] | undefined;

		function invalidate(): void {
			cachedWidth = undefined;
			cachedLines = undefined;
		}

		function startAnimation(): void {
			if (animationTimer) return;
			animationTimer = setInterval(() => {
				frame++;
				invalidate();
				tui.requestRender();
			}, PULSE_INDICATOR.intervalMs ?? 120);
		}

		function stopAnimation(): void {
			if (animationTimer) {
				clearInterval(animationTimer);
				animationTimer = undefined;
			}
		}

		widgetTui = tui;
		widgetInvalidate = invalidate;

		return {
			render(width: number): string[] {
				const runs = Array.from(allRuns.values());
				if (runs.some((r) => r.status === "running")) startAnimation();
				else stopAnimation();

				if (cachedLines && cachedWidth === width) return cachedLines;

				const running = runs.filter((r) => r.status === "running").length;
				const lines: string[] = [];
				const header =
					`${theme.fg("accent", "Subagents")} ${theme.fg("muted", `${running} running, ${runs.length} total`)}` +
					 theme.fg("dim", "  (/show-subagents to browse)");
				lines.push(truncateToWidth(header, width));

				// Most recently started first, running runs pinned above finished ones.
				const sorted = [...runs].sort((a, b) => {
					if ((a.status === "running") !== (b.status === "running")) return a.status === "running" ? -1 : 1;
					return b.startedAt - a.startedAt;
				});
				const visible = sorted.slice(0, RUN_WIDGET_VISIBLE_COUNT);
				for (const run of visible) {
					const icon = runStatusIcon(run.status, frame);
					const elapsed = formatElapsedShort((run.endedAt ?? Date.now()) - run.startedAt);
					const preview = run.task.length > 40 ? `${run.task.slice(0, 40)}...` : run.task;
					const name = run.status === "done" ? theme.fg("dim", run.agent) : theme.fg("text", run.agent);
					lines.push(
						truncateToWidth(
							`  ${icon} ${name} ${theme.fg("dim", preview)} ${theme.fg("dim", `[${elapsed}]`)}`,
							width,
						),
					);
				}
				if (sorted.length > visible.length) {
					lines.push(truncateToWidth(`  ${theme.fg("muted", `... ${sorted.length - visible.length} more`)}`, width));
				}

				cachedWidth = width;
				cachedLines = lines;
				return lines;
			},
			invalidate,
			dispose(): void {
				stopAnimation();
				if (widgetInvalidate === invalidate) {
					widgetTui = undefined;
					widgetInvalidate = undefined;
				}
			},
		};
	}

	/** Show/hide/refresh the persistent above-editor widget (and the fleet inspector, if open) to reflect current run state. */
	function syncSubagentWidget() {
		fleetInspectorRefresh?.();
		if (!sessionAlive || !sessionCtx?.hasUI) return;
		if (allRuns.size === 0) {
			if (widgetTui) sessionCtx.ui.setWidget("pi-subagents", undefined);
			return;
		}
		if (!widgetTui) {
			sessionCtx.ui.setWidget("pi-subagents", (tui, theme) => createSubagentWidget(tui, theme), {
				placement: "aboveEditor",
			});
		} else {
			widgetInvalidate?.();
			widgetTui.requestRender();
		}
	}

	/** Fire-and-forget dispatch for `async: true` single-mode calls. Returns an immediate ack. */
	function dispatchBackgroundAgent(
		defaultCwd: string,
		dispatchDefaults: DispatchDefaults,
		agents: AgentConfig[],
		agentName: string,
		taskText: string,
		cwd: string | undefined,
		makeDetails: (mode: "single") => (results: SingleResult[]) => SubagentDetails,
		resumeSessionPath?: string,
	): AgentToolResult<SubagentDetails> {
		const taskId = `bg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const controller = new AbortController();
		backgroundTasks.set(taskId, { id: taskId, agent: agentName, task: taskText, status: "running", startedAt: Date.now(), controller });
		trackRun("background", agentName, taskText, taskId, resumeSessionPath);
		const sessionPath = allRuns.get(taskId)!.sessionPath;
		syncSubagentWidget();
		if (sessionAlive) {
			try {
				pi.appendEntry("pi-subagents-background-started", { id: taskId, agent: agentName, task: taskText });
			} catch {
				/* session may have torn down between the check and the call */
			}
		}

		const toolConfig = loadSubagentToolConfig();
		acquireBackgroundSlot(toolConfig.maxConcurrentSubagents)
			.then(() => {
				emitSubagentEvent("started", { id: taskId, agent: agentName, mode: "background", task: taskText });
				return runSingleAgent(
					defaultCwd,
					dispatchDefaults,
					agents,
					agentName,
					taskText,
					cwd,
					undefined,
					controller.signal,
					undefined,
					makeDetails("single"),
					sessionPath,
				);
			})
			.then((result) => {
				releaseBackgroundSlot();
				const task = backgroundTasks.get(taskId);
				const failed = isFailedResult(result);
				const summary = getResultOutput(result);
				if (task) {
					task.status = failed ? "failed" : "done";
					task.endedAt = Date.now();
					task.summary = summary;
				}
				finalizeRun(taskId, result);
				if (!sessionAlive) return;
				try {
					pi.appendEntry("pi-subagents-background-done", { id: taskId, agent: agentName, task: taskText, failed, summary });
					const content = `Background subagent "${agentName}" (${taskId}) ${failed ? "failed" : "finished"}.\n\nTask: ${taskText}\n\nResult:\n${summary}`;
					pi.sendMessage(
						{ customType: "pi-subagents-background", content, display: true },
						{ deliverAs: sessionBusy ? "steer" : "nextTurn" },
					);
					if (failed && sessionCtx?.hasUI) {
						sessionCtx.ui.notify(`Background subagent "${agentName}" failed`, "error");
					}
				} catch {
					/* session torn down between the check and the call; drop silently */
				}
			})
			.catch((err) => {
				releaseBackgroundSlot();
				const task = backgroundTasks.get(taskId);
				const message = err instanceof Error ? err.message : String(err);
				if (task) {
					task.status = "failed";
					task.endedAt = Date.now();
					task.summary = message;
				}
				const run = allRuns.get(taskId);
				if (run) {
					run.status = "failed";
					run.endedAt = Date.now();
					run.errorMessage = message;
					emitSubagentEvent("failed", {
						id: run.id,
						agent: run.agent,
						mode: run.mode,
						task: run.task,
						status: run.status,
						usage: run.usage,
						durationMs: run.endedAt - run.startedAt,
						errorMessage: run.errorMessage,
					});
				}
				syncSubagentWidget();
				if (!sessionAlive) return;
				try {
					pi.appendEntry("pi-subagents-background-done", { id: taskId, agent: agentName, task: taskText, failed: true, summary: message });
					if (sessionCtx?.hasUI) {
						sessionCtx.ui.notify(`Background subagent "${agentName}" crashed: ${message}`, "error");
					}
				} catch {
					/* session torn down between the check and the call; drop silently */
				}
			});

		return {
			content: [
				{
					type: "text",
					text: `Started background subagent "${agentName}" (id: ${taskId}). It is running independently. On success, the result is delivered quietly without interrupting you; on failure, you'll be notified immediately.`,
				},
			],
			details: makeDetails("single")([]),
		};
	}

	function formatElapsed(ms: number): string {
		const s = Math.round(ms / 1000);
		if (s < 60) return `${s}s`;
		const m = Math.round(s / 60);
		return `${m}m`;
	}

	/** Sorted for the fleet inspector: running runs first (newest first), then finished runs (newest first). */
	function getSortedRuns(): RunRecord[] {
		return Array.from(allRuns.values()).sort((a, b) => {
			if ((a.status === "running") !== (b.status === "running")) return a.status === "running" ? -1 : 1;
			return b.startedAt - a.startedAt;
		});
	}

	/**
	 * Subagent Fleet Inspector: a keyboard-driven, list + transcript popup modeled on
	 * nicobailon/pi-subagents' `/subagents-fleet` inspector (github.com/nicobailon/pi-subagents,
	 * docs/observability.md "The fleet inspector") — a run list on top, a live transcript of the
	 * selected run below, and single-key actions instead of nested select/confirm dialogs.
	 */
	async function openFleetInspector(ctx: ExtensionContext): Promise<void> {
		if (ctx.mode !== "tui") {
			const runs = getSortedRuns();
			if (runs.length === 0) {
				ctx.ui.notify("No subagents dispatched yet.", "info");
				return;
			}
			const lines = runs.map((r) => {
				const elapsed = formatElapsed((r.endedAt ?? Date.now()) - r.startedAt);
				return `[${r.status}] ${r.agent} (${r.mode}, ${elapsed}) — ${r.task}`;
			});
			ctx.ui.notify(lines.join("\n"), "info");
			return;
		}

		await ctx.ui.custom<void>((tui, theme, _kb, done) => {
			let selectedIndex = 0;
			let listScroll = 0;
			let transcriptScroll = 0;
			let showToolArgs = false;
			let focus: "list" | "transcript" = "list";
			let cachedWidth: number | undefined;
			let cachedLines: string[] | undefined;

			function refresh(): void {
				cachedWidth = undefined;
				cachedLines = undefined;
				tui.requestRender();
			}
			fleetInspectorRefresh = refresh;

			function close(): void {
				if (fleetInspectorRefresh === refresh) fleetInspectorRefresh = undefined;
				done();
			}

			function selectedRun(runs: RunRecord[]): RunRecord | undefined {
				return runs[Math.min(selectedIndex, runs.length - 1)];
			}

			function handleInput(data: string): void {
				if (matchesKey(data, Key.escape)) {
					close();
					return;
				}
				const runs = getSortedRuns();
				if (runs.length === 0) {
					if (data === "r") refresh();
					return;
				}
				if (matchesKey(data, Key.left)) {
					focus = "list";
					refresh();
					return;
				}
				if (matchesKey(data, Key.right)) {
					focus = "transcript";
					refresh();
					return;
				}
				if (matchesKey(data, Key.up) || data === "k") {
					if (focus === "list") {
						selectedIndex = Math.max(0, selectedIndex - 1);
						transcriptScroll = 0;
					} else {
						transcriptScroll = Math.max(0, transcriptScroll - 1);
					}
					refresh();
					return;
				}
				if (matchesKey(data, Key.down) || data === "j") {
					if (focus === "list") {
						selectedIndex = Math.min(runs.length - 1, selectedIndex + 1);
						transcriptScroll = 0;
					} else {
						transcriptScroll += 1;
					}
					refresh();
					return;
				}
				if (data === "x" || matchesKey(data, Key.ctrl("o"))) {
					showToolArgs = !showToolArgs;
					refresh();
					return;
				}
				if (data === "K") {
					transcriptScroll = Math.max(0, transcriptScroll - 1);
					refresh();
					return;
				}
				if (data === "J") {
					transcriptScroll += 1;
					refresh();
					return;
				}
				if (matchesKey(data, Key.pageUp)) {
					transcriptScroll = Math.max(0, transcriptScroll - 10);
					refresh();
					return;
				}
				if (matchesKey(data, Key.pageDown)) {
					transcriptScroll += 10;
					refresh();
					return;
				}
				if (data === "r") {
					refresh();
					return;
				}
				if (data === "D") {
					const run = selectedRun(runs);
					const bg = run && backgroundTasks.get(run.id);
					if (bg && bg.status === "running") {
						bg.controller.abort();
						ctx.ui.notify(`Stopping "${bg.agent}"\u2026`, "info");
					} else {
						ctx.ui.notify("Only a running background run can be stopped.", "info");
					}
					return;
				}
				if (data === "s") {
					const run = selectedRun(runs);
					const bg = run && backgroundTasks.get(run.id);
					if (bg && bg.status !== "running") {
						bg.reviewed = true;
						const content = `Background subagent "${bg.agent}" raw output (task: ${bg.task}):\n\n${bg.summary ?? "(no output)"}\n\nPlease summarize this for me in the context of our conversation.`;
						pi.sendMessage(
							{ customType: "pi-subagents-background-summary-request", content, display: true },
							{ deliverAs: sessionBusy ? "steer" : "nextTurn", triggerTurn: true },
						);
						ctx.ui.notify("Requested a summary from the main agent.", "info");
					} else {
						ctx.ui.notify("Summaries are only available for finished background runs.", "info");
					}
					return;
				}
			}

			function renderListColumn(runs: RunRecord[], colWidth: number, maxRows: number): string[] {
				const needsCount = runs.length > maxRows;
				const visibleCount = needsCount ? maxRows - 1 : maxRows;
				if (selectedIndex < listScroll) listScroll = selectedIndex;
				if (selectedIndex >= listScroll + visibleCount) listScroll = selectedIndex - visibleCount + 1;
				listScroll = Math.max(0, Math.min(listScroll, Math.max(0, runs.length - visibleCount)));
				const visible = runs.slice(listScroll, listScroll + visibleCount);

				const lines: string[] = [];
				for (let i = 0; i < visible.length; i++) {
					const run = visible[i];
					const idx = listScroll + i;
					const icon = run.status === "running" ? theme.fg("warning", "⏳") : run.status === "failed" ? theme.fg("error", "✗") : theme.fg("success", "✓");
					const elapsed = formatElapsed((run.endedAt ?? Date.now()) - run.startedAt);
					const bg = backgroundTasks.get(run.id);
					const unread = bg && bg.status !== "running" && !bg.reviewed ? theme.fg("accent", " • new") : "";
					const isActive = idx === selectedIndex;
					const agentName = isActive ? theme.fg("accent", run.agent) : run.agent;
					const resumable = run.status !== "running" ? theme.fg("muted", " [resumable]") : "";
					const label = `${agentName} ${theme.fg("muted", `[${run.mode}]`)} ${theme.fg("dim", `[${elapsed}]`)}${unread}${resumable}`;
					const prefix = focus === "list" && isActive ? theme.fg("accent", "> ") : "  ";
					lines.push(truncateToWidth(`${prefix}${icon} ${label}`, colWidth, "...", true));
				}
				for (let i = visible.length; i < visibleCount; i++) lines.push(truncateToWidth("", colWidth, "", true));
				if (needsCount) {
					lines.push(truncateToWidth(theme.fg("dim", `  (${listScroll + 1}-${listScroll + visible.length} of ${runs.length})`), colWidth, "...", true));
				}
				return lines;
			}

			function renderTranscriptColumn(run: RunRecord, colWidth: number, maxRows: number): string[] {
				const body: string[] = [];
				const header =
					`${theme.fg("accent", theme.bold(run.agent))} ${theme.fg("muted", `(${run.agentSource}, ${run.mode})`)} — ` +
					(run.status === "running" ? theme.fg("warning", "running") : run.status === "failed" ? theme.fg("error", "failed") : theme.fg("success", "done"));
				body.push(...wrapTextWithAnsi(header, colWidth));
				body.push(...wrapTextWithAnsi(theme.fg("dim", `id: ${run.id}${run.status !== "running" ? " (resumable via resume param)" : ""}`), colWidth));
				if (run.model) body.push(...wrapTextWithAnsi(theme.fg("dim", `model: ${run.model}`), colWidth));
				if (run.skills) body.push(...wrapTextWithAnsi(theme.fg("dim", `skills: ${run.skills}`), colWidth));
				const usage = formatUsageStats(run.usage, undefined);
				if (usage) body.push(...wrapTextWithAnsi(theme.fg("dim", `usage: ${usage}`), colWidth));
				body.push(...wrapTextWithAnsi(theme.fg("muted", "task: ") + theme.fg("text", run.task), colWidth));
				body.push("");

				const items = getDisplayItems(run.messages);
				if (items.length === 0) {
					body.push(theme.fg("dim", run.status === "running" ? "(waiting for activity\u2026)" : "(no activity)"));
				} else {
					for (const item of items) {
						if (item.type === "toolCall") {
							const argsText = showToolArgs ? JSON.stringify(item.args) : formatToolCall(item.name, item.args, theme.fg.bind(theme));
							body.push(...wrapTextWithAnsi(theme.fg("muted", "→ ") + argsText, colWidth));
						} else {
							body.push(...wrapTextWithAnsi(theme.fg("toolOutput", item.text), colWidth));
						}
					}
				}
				if (run.errorMessage) body.push(...wrapTextWithAnsi(theme.fg("error", `error: ${run.errorMessage}`), colWidth));

				const maxScroll = Math.max(0, body.length - maxRows);
				if (transcriptScroll > maxScroll) transcriptScroll = maxScroll;
				const visible = body.slice(transcriptScroll, transcriptScroll + maxRows);
				const lines = visible.map((l) => truncateToWidth(l, colWidth, "...", true));
				for (let i = visible.length; i < maxRows; i++) lines.push(truncateToWidth("", colWidth, "", true));
				return lines;
			}

			/** A single independently-bordered panel. Border color reflects whether this panel currently has keyboard focus. */
			function box(title: string, contentLines: string[], colWidth: number, focused: boolean): string[] {
				const borderColor = focused ? "border" : "borderMuted";
				const outerWidth = colWidth + 4;
				const titlePart = `${theme.fg(borderColor, "┌─ ")}${focused ? theme.bold(theme.fg("accent", title)) : theme.fg("dim", title)}${theme.fg(borderColor, " ")}`;
				const titleFill = Math.max(0, outerWidth - visibleWidth(titlePart) - 1);
				const lines: string[] = [titlePart + theme.fg(borderColor, "─".repeat(titleFill) + "┐")];
				for (const line of contentLines) {
					lines.push(theme.fg(borderColor, "│ ") + truncateToWidth(line, colWidth, "...", true) + theme.fg(borderColor, " │"));
				}
				lines.push(theme.fg(borderColor, "└" + "─".repeat(outerWidth - 2) + "┘"));
				return lines;
			}

			function render(width: number): string[] {
				if (cachedLines && cachedWidth === width) return cachedLines;

				const runs = getSortedRuns();
				const innerWidth = Math.max(1, width - 4); // interior of the outer "│ " ... " │"
				const gap = 2;
				// Fixed width -- just enough for icon + agent name + mode + elapsed -- rather than
				// a percentage of the popup, so it doesn't grow or shrink across terminal resizes.
				const LIST_COLUMN_WIDTH = 26;
				const listWidth = Math.max(10, Math.min(LIST_COLUMN_WIDTH, innerWidth - gap - 18));
				const transcriptWidth = Math.max(10, innerWidth - (listWidth + 4) - gap - 4);
				const rows = Math.floor(tui.terminal.rows * 0.5);
				const chromeLines = 5; // outer top/bottom + hint line + panel top/bottom borders
				const bodyRows = Math.max(4, rows - chromeLines);

				const running = runs.filter((r) => r.status === "running").length;
				const inner: string[] = [];

				const listCol =
					runs.length === 0
						? [truncateToWidth(theme.fg("dim", "No subagents yet"), listWidth, "...", true), ...new Array(bodyRows - 1).fill(truncateToWidth("", listWidth, "", true))]
						: renderListColumn(runs, listWidth, bodyRows);
				const transcriptCol =
					runs.length === 0
						? [
								truncateToWidth(theme.fg("dim", "Runs (single, parallel, chain, background) will appear here as soon as one starts."), transcriptWidth, "...", true),
								...new Array(bodyRows - 1).fill(truncateToWidth("", transcriptWidth, "", true)),
							]
						: renderTranscriptColumn(selectedRun(runs)!, transcriptWidth, bodyRows);

				const listBox = box("Agents", listCol, listWidth, focus === "list");
				const transcriptBox = box("Context", transcriptCol, transcriptWidth, focus === "transcript");
				const gapStr = " ".repeat(gap);
				for (let i = 0; i < listBox.length; i++) inner.push(`${listBox[i]}${gapStr}${transcriptBox[i]}`);

				const hints =
					runs.length === 0
						? "Esc close"
						: focus === "list"
							? "↑↓/jk select · → view context · x tool args · D stop · s summarize · r refresh · Esc close"
							: "↑↓/jk scroll · ← select agent · x tool args · PgUp/PgDn page · D stop · s summarize · r refresh · Esc close";
				inner.push(theme.fg("dim", hints));

				// Outer border wraps both panels so the whole thing reads clearly as one popup.
				const titlePart = `${theme.fg("border", "┌─ ")}${theme.bold("Subagent Fleet")}${theme.fg("border", " ─ ")}${theme.fg("muted", `${running} running, ${runs.length} total`)}${theme.fg("border", " ")}`;
				const titleFill = Math.max(0, width - visibleWidth(titlePart) - 1);
				const lines: string[] = [titlePart + theme.fg("border", "─".repeat(titleFill) + "┐")];
				for (const line of inner) {
					lines.push(theme.fg("border", "│ ") + truncateToWidth(line, innerWidth, "...", true) + theme.fg("border", " │"));
				}
				lines.push(theme.fg("border", "└" + "─".repeat(width - 2) + "┘"));

				const rendered = lines.map((l) => (visibleWidth(l) > width ? truncateToWidth(l, width) : l));
				cachedWidth = width;
				cachedLines = rendered;
				return rendered;
			}

			return {
				render,
				invalidate(): void {
					cachedWidth = undefined;
					cachedLines = undefined;
				},
				handleInput,
				dispose(): void {
					if (fleetInspectorRefresh === refresh) fleetInspectorRefresh = undefined;
				},
			};
		}, {
			overlay: true,
			overlayOptions: {
				width: "60%",
				maxHeight: "50%",
				anchor: "top-center",
				margin: { top: 1, left: 2, right: 2 },
			},
		});
	}

	pi.registerCommand("show-subagents", {
		description: "Browse all subagents (past and present) and preview their context",
		handler: async (_args, ctx) => {
			await openFleetInspector(ctx);
		},
	});

	// Snapshot of user-scope agent names at registration time, surfaced in the tool description so the
	// model picks from real agents instead of guessing a name (discovery still re-runs per call for hot-editing).
	const knownUserAgents = discoverAgents(process.cwd(), "user").agents;
	const knownAgentNames = knownUserAgents.map((a) => a.name).join(", ") || "none configured";

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
			`Default agent scope is "user" (from ${path.join(getAgentDir(), "agents")}).`,
			`To enable project-local agents in ${CONFIG_DIR_NAME}/agents, set agentScope: "both" (or "project").`,
			`Available agents (user scope): ${knownAgentNames}. Only use an agent name from this list (or from project agents when agentScope is "both"/"project") — never invent one.`,
		].join(" "),
		promptGuidelines: [
			`Only pass "agent" values that exist: ${knownAgentNames}. Do not guess or invent an agent name.`,
			"If unsure which agents are available, call the tool with an invalid agent once to read the error's agent list, or check ~/.pi/agent/agents.",
		],
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const agentScope: AgentScope = params.agentScope ?? "user";
			const dispatchDefaults: DispatchDefaults = {
				model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
				thinkingLevel: ctx.thinkingLevel,
				modelRegistry: ctx.modelRegistry,
			};
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const agents = discovery.agents;
			const confirmProjectAgents = params.confirmProjectAgents ?? true;

			const makeErrorResult = (text: string) => ({
				content: [{ type: "text" as const, text }],
				details: { mode: "single" as const, agentScope, projectAgentsDir: discovery.projectAgentsDir, results: [] },
				isError: true,
			});
			let resumeRun: RunRecord | undefined;
			if (params.resume) {
				resumeRun = allRuns.get(params.resume);
				if (!resumeRun) return makeErrorResult(`Unknown run id to resume: "${params.resume}".`);
				if (resumeRun.status === "running") return makeErrorResult(`Run "${params.resume}" is still running -- steer it instead of resuming.`);
				if (params.agent && params.agent !== resumeRun.agent) {
					return makeErrorResult(`Run "${params.resume}" was dispatched to "${resumeRun.agent}"; omit "agent" or match it when resuming.`);
				}
			}
			const singleAgentName = resumeRun?.agent ?? params.agent;

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(singleAgentName && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

			const makeDetails =
				(mode: "single" | "parallel" | "chain") =>
				(results: SingleResult[]): SubagentDetails => ({
					mode,
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
					results,
				});

			if (modeCount !== 1) {
				const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`,
						},
					],
					details: makeDetails("single")([]),
				};
			}

			if (
				(agentScope === "project" || agentScope === "both") &&
				confirmProjectAgents &&
				ctx.hasUI &&
				!ctx.isProjectTrusted()
			) {
				const requestedAgentNames = new Set<string>();
				if (params.chain) for (const step of params.chain) requestedAgentNames.add(step.agent);
				if (params.tasks) for (const t of params.tasks) requestedAgentNames.add(t.agent);
				if (singleAgentName) requestedAgentNames.add(singleAgentName);

				const projectAgentsRequested = Array.from(requestedAgentNames)
					.map((name) => agents.find((a) => a.name === name))
					.filter((a): a is AgentConfig => a?.source === "project");

				if (projectAgentsRequested.length > 0) {
					const names = projectAgentsRequested.map((a) => a.name).join(", ");
					const dir = discovery.projectAgentsDir ?? "(unknown)";
					const ok = await ctx.ui.confirm(
						"Run project-local agents?",
						`Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!ok)
						return {
							content: [{ type: "text", text: "Canceled: project-local agents not approved." }],
							details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
						};
				}
			}

			if (params.chain && params.chain.length > 0) {
				const results: SingleResult[] = [];
				let previousOutput = "";

				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i];
					const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);
					const runId = trackRun("chain", step.agent, taskWithContext);
					const sessionPath = allRuns.get(runId)!.sessionPath;

					// Create update callback that includes all previous results
					const chainUpdate: OnUpdateCallback = (partial) => {
						// Combine completed results with current streaming result
						const currentResult = partial.details?.results[0];
						if (currentResult) {
							updateRunFromResult(runId, currentResult);
							const allResults = [...results, currentResult];
							onUpdate?.({
								content: partial.content,
								details: makeDetails("chain")(allResults),
							});
						}
					};

					const result = await runSingleAgent(
						ctx.cwd,
						dispatchDefaults,
						agents,
						step.agent,
						taskWithContext,
						step.cwd,
						i + 1,
						signal,
						chainUpdate,
						makeDetails("chain"),
						sessionPath,
					);
					finalizeRun(runId, result);
					results.push(result);

					const isError = isFailedResult(result);
					if (isError) {
						const errorMsg = getResultOutput(result);
						return {
							content: [{ type: "text", text: `Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg}` }],
							details: makeDetails("chain")(results),
							isError: true,
						};
					}
					previousOutput = getFinalOutput(result.messages);
				}
				return {
					content: [{ type: "text", text: getFinalOutput(results[results.length - 1].messages) || "(no output)" }],
					details: makeDetails("chain")(results),
				};
			}

			if (params.tasks && params.tasks.length > 0) {
				const toolConfig = loadSubagentToolConfig();
				if (params.tasks.length > toolConfig.maxParallelTasks)
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${params.tasks.length}). Max is ${toolConfig.maxParallelTasks}.`,
							},
						],
						details: makeDetails("parallel")([]),
					};

				// Track all results for streaming updates
				const allResults: SingleResult[] = new Array(params.tasks.length);

				// Initialize placeholder results
				for (let i = 0; i < params.tasks.length; i++) {
					allResults[i] = {
						agent: params.tasks[i].agent,
						agentSource: "unknown",
						task: params.tasks[i].task,
						exitCode: -1, // -1 = still running
						messages: [],
						stderr: "",
						usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
					};
				}

				const emitParallelUpdate = () => {
					if (onUpdate) {
						const running = allResults.filter((r) => r.exitCode === -1).length;
						const done = allResults.filter((r) => r.exitCode !== -1).length;
						onUpdate({
							content: [
								{ type: "text", text: `Parallel: ${done}/${allResults.length} done, ${running} running...` },
							],
							details: makeDetails("parallel")([...allResults]),
						});
					}
				};

				const results = await mapWithConcurrencyLimit(params.tasks, toolConfig.maxConcurrentSubagents, async (t, index) => {
					const runId = trackRun("parallel", t.agent, t.task);
					const sessionPath = allRuns.get(runId)!.sessionPath;
					const result = await runSingleAgent(
						ctx.cwd,
						dispatchDefaults,
						agents,
						t.agent,
						t.task,
						t.cwd,
						undefined,
						signal,
						// Per-task update callback
						(partial) => {
							if (partial.details?.results[0]) {
								allResults[index] = partial.details.results[0];
								updateRunFromResult(runId, allResults[index]);
								emitParallelUpdate();
							}
						},
						makeDetails("parallel"),
						sessionPath,
					);
					finalizeRun(runId, result);
					allResults[index] = result;
					emitParallelUpdate();
					return result;
				});

				const successCount = results.filter((r) => !isFailedResult(r)).length;
				const summaries = results.map((r) => {
					const output = truncateParallelOutput(getResultOutput(r));
					const status = isFailedResult(r)
						? `failed${r.stopReason && r.stopReason !== "end" ? ` (${r.stopReason})` : ""}`
						: "completed";
					return `### [${r.agent}] ${status}\n\n${output}`;
				});
				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`,
						},
					],
					details: makeDetails("parallel")(results),
				};
			}

			if (singleAgentName && params.task && params.async) {
				return dispatchBackgroundAgent(
					ctx.cwd, dispatchDefaults, agents, singleAgentName, params.task, params.cwd, makeDetails, resumeRun?.sessionPath,
				);
			}

			if (singleAgentName && params.task) {
				const runId = trackRun("single", singleAgentName, params.task, undefined, resumeRun?.sessionPath);
				const sessionPath = allRuns.get(runId)!.sessionPath;
				const trackedOnUpdate: OnUpdateCallback = (partial) => {
					const r = partial.details?.results[0];
					if (r) updateRunFromResult(runId, r);
					onUpdate?.(partial);
				};
				const result = await runSingleAgent(
					ctx.cwd,
					dispatchDefaults,
					agents,
					singleAgentName,
					params.task,
					params.cwd,
					undefined,
					signal,
					trackedOnUpdate,
					makeDetails("single"),
					sessionPath,
				);
				finalizeRun(runId, result);
				const isError = isFailedResult(result);
				if (isError) {
					const errorMsg = getResultOutput(result);
					return {
						content: [{ type: "text", text: `Agent ${result.stopReason || "failed"}: ${errorMsg}` }],
						details: makeDetails("single")([result]),
						isError: true,
					};
				}
				return {
					content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
					details: makeDetails("single")([result]),
				};
			}

			const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
			return {
				content: [{ type: "text", text: `Invalid parameters. Available agents: ${available}` }],
				details: makeDetails("single")([]),
			};
		},

		renderCall(args, theme, _context) {
			const scope: AgentScope = args.agentScope ?? "user";
			if (args.chain && args.chain.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `chain (${args.chain.length} steps)`) +
					theme.fg("muted", ` [${scope}]`);
				for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
					const step = args.chain[i];
					// Clean up {previous} placeholder for display
					const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
					const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
					text +=
						"\n  " +
						theme.fg("muted", `${i + 1}.`) +
						" " +
						theme.fg("accent", step.agent) +
						theme.fg("dim", ` ${preview}`);
				}
				if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			if (args.tasks && args.tasks.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
					theme.fg("muted", ` [${scope}]`);
				for (const t of args.tasks.slice(0, 3)) {
					const preview = t.task.length > 40 ? `${t.task.slice(0, 40)}...` : t.task;
					text += `\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			const agentName = args.agent || (args.resume ? "resume" : "...");
			const preview = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : "...";
			let text =
				theme.fg("toolTitle", theme.bold("subagent ")) +
				theme.fg("accent", agentName) +
				theme.fg("muted", ` [${scope}]`) +
				(args.resume ? theme.fg("muted", ` ↻${args.resume}`) : "");
			text += `\n  ${theme.fg("dim", preview)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as SubagentDetails | undefined;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const mdTheme = getMarkdownTheme();

			const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
				const toShow = limit ? items.slice(-limit) : items;
				const skipped = limit && items.length > limit ? items.length - limit : 0;
				let text = "";
				if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
				for (const item of toShow) {
					if (item.type === "text") {
						const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
						text += `${theme.fg("toolOutput", preview)}\n`;
					} else {
						text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
					}
				}
				return text.trimEnd();
			};

			if (details.mode === "single" && details.results.length === 1) {
				const r = details.results[0];
				const isError = isFailedResult(r);
				const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
				const displayItems = getDisplayItems(r.messages);
				const finalOutput = getFinalOutput(r.messages);

				if (expanded) {
					const container = new Container();
					let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
					if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
					container.addChild(new Text(header, 0, 0));
					if (isError && r.errorMessage)
						container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
					container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
					if (displayItems.length === 0 && !finalOutput) {
						container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
					} else {
						for (const item of displayItems) {
							if (item.type === "toolCall")
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
						}
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}
					}
					const usageStr = formatUsageStats(r.usage, r.model);
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
					}
					return container;
				}

				let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
				if (isError && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
				if (isError && r.errorMessage) text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
				else if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
				else {
					text += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
					if (displayItems.length > COLLAPSED_ITEM_COUNT) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				}
				const usageStr = formatUsageStats(r.usage, r.model);
				if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
				return new Text(text, 0, 0);
			}

			const aggregateUsage = (results: SingleResult[]) => {
				const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
				for (const r of results) {
					total.input += r.usage.input;
					total.output += r.usage.output;
					total.cacheRead += r.usage.cacheRead;
					total.cacheWrite += r.usage.cacheWrite;
					total.cost += r.usage.cost;
					total.turns += r.usage.turns;
				}
				return total;
			};

			if (details.mode === "chain") {
				const successCount = details.results.filter((r) => r.exitCode === 0).length;
				const icon = successCount === details.results.length ? theme.fg("success", "✓") : theme.fg("error", "✗");

				if (expanded) {
					const container = new Container();
					container.addChild(
						new Text(
							icon +
								" " +
								theme.fg("toolTitle", theme.bold("chain ")) +
								theme.fg("accent", `${successCount}/${details.results.length} steps`),
							0,
							0,
						),
					);

					for (const r of details.results) {
						const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								`${theme.fg("muted", `─── Step ${r.step}: `) + theme.fg("accent", r.agent)} ${rIcon}`,
								0,
								0,
							),
						);
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const stepUsage = formatUsageStats(r.usage, r.model);
						if (stepUsage) container.addChild(new Text(theme.fg("dim", stepUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
					}
					return container;
				}

				// Collapsed view
				let text =
					icon +
					" " +
					theme.fg("toolTitle", theme.bold("chain ")) +
					theme.fg("accent", `${successCount}/${details.results.length} steps`);
				for (const r of details.results) {
					const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
					const displayItems = getDisplayItems(r.messages);
					text += `\n\n${theme.fg("muted", `─── Step ${r.step}: `)}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				const usageStr = formatUsageStats(aggregateUsage(details.results));
				if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			if (details.mode === "parallel") {
				const running = details.results.filter((r) => r.exitCode === -1).length;
				const successCount = details.results.filter((r) => r.exitCode !== -1 && !isFailedResult(r)).length;
				const failCount = details.results.filter((r) => r.exitCode !== -1 && isFailedResult(r)).length;
				const isRunning = running > 0;
				const icon = isRunning
					? theme.fg("warning", "⏳")
					: failCount > 0
						? theme.fg("warning", "◐")
						: theme.fg("success", "✓");
				const status = isRunning
					? `${successCount + failCount}/${details.results.length} done, ${running} running`
					: `${successCount}/${details.results.length} tasks`;

				if (expanded && !isRunning) {
					const container = new Container();
					container.addChild(
						new Text(
							`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
							0,
							0,
						),
					);

					for (const r of details.results) {
						const rIcon = isFailedResult(r) ? theme.fg("error", "✗") : theme.fg("success", "✓");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(`${theme.fg("muted", "─── ") + theme.fg("accent", r.agent)} ${rIcon}`, 0, 0),
						);
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const taskUsage = formatUsageStats(r.usage, r.model);
						if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
					}
					return container;
				}

				// Collapsed view (or still running)
				let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
				for (const r of details.results) {
					const rIcon =
						r.exitCode === -1
							? theme.fg("warning", "⏳")
							: isFailedResult(r)
								? theme.fg("error", "✗")
								: theme.fg("success", "✓");
					const displayItems = getDisplayItems(r.messages);
					text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0)
						text += `\n${theme.fg("muted", r.exitCode === -1 ? "(running...)" : "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				if (!isRunning) {
					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				}
				if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
		},
	});
}
