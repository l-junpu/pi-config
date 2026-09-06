/**
 * pi-matrix-theme - a dark green "Matrix" theme with katakana shimmer.
 *
 * Swappable with pi-omp-theme's UI at runtime via /matrix on|off:
 *  - on: applies the "matrix" theme, a growing/shrinking katakana working
 *        indicator, a matrix-styled footer, and a shimmering "in progress"
 *        status for tool calls that take longer than a blink.
 *  - off: restores the previous theme and reloads extensions so
 *         pi-omp-theme's footer/indicator/editor take back over.
 *
 * Independent of the toggle: a markdown transformer labels user messages
 * with a small heading colored via the active theme's mdHeading token, so
 * it's always visually clear who sent a message.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { buildKatakanaIndicatorFrames, katakanaBurst, shimmerLabel } from "./katakana-shimmer.ts";

const TOOL_SHIMMER_DELAY_MS = 300;
const TOOL_SHIMMER_INTERVAL_MS = 90;
const INDICATOR_INTERVAL_MS = 90;
const STATUS_KEY = "matrixTheme";

function formatCwd(cwd: string): string {
	const home = process.env.HOME;
	return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

function formatContext(ctx: ExtensionContext): string {
	const usage = ctx.getContextUsage();
	const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
	if (!contextWindow || !usage || usage.percent === null) return "ctx ?";
	return `${Math.round(usage.percent)}% / ${(contextWindow / 1000).toFixed(0)}k`;
}

export default function (pi: ExtensionAPI) {
	let enabled = false;
	let previousTheme: string | undefined;

	let runningTools = 0;
	let lastToolName = "";
	let toolShimmerDelay: ReturnType<typeof setTimeout> | undefined;
	let toolShimmerInterval: ReturnType<typeof setInterval> | undefined;

	const stopToolShimmer = (ctx: ExtensionContext) => {
		if (toolShimmerDelay) {
			clearTimeout(toolShimmerDelay);
			toolShimmerDelay = undefined;
		}
		if (toolShimmerInterval) {
			clearInterval(toolShimmerInterval);
			toolShimmerInterval = undefined;
		}
		ctx.ui.setStatus(STATUS_KEY, undefined);
	};

	const startToolShimmer = (ctx: ExtensionContext) => {
		if (toolShimmerInterval) return;
		toolShimmerInterval = setInterval(() => {
			const theme = ctx.ui.theme;
			const label = `${katakanaBurst(theme, Date.now())} ${shimmerLabel(`${lastToolName || "working"}...`, theme, Date.now())}`;
			ctx.ui.setStatus(STATUS_KEY, label);
		}, TOOL_SHIMMER_INTERVAL_MS);
	};

	pi.on("tool_execution_start", (event, ctx) => {
		lastToolName = event.toolName;
		runningTools++;
		if (!enabled || runningTools !== 1) return;
		toolShimmerDelay = setTimeout(() => startToolShimmer(ctx), TOOL_SHIMMER_DELAY_MS);
	});

	pi.on("tool_execution_end", (_event, ctx) => {
		runningTools = Math.max(0, runningTools - 1);
		if (enabled && runningTools === 0) stopToolShimmer(ctx);
	});

	const applyMatrixUi = (ctx: ExtensionContext) => {
		ctx.ui.setWorkingIndicator({
			frames: buildKatakanaIndicatorFrames(ctx.ui.theme),
			intervalMs: INDICATOR_INTERVAL_MS,
		});

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					const branch = footerData.getGitBranch();
					const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no model";
					const left = `${theme.fg("accent", "◈")} ${theme.fg("dim", formatCwd(ctx.cwd))}${branch ? theme.fg("muted", ` (${branch})`) : ""}`;
					const right = theme.fg("muted", `${model} · ctx ${formatContext(ctx)}`);
					const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
					return [truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width)];
				},
			};
		});
	};

	pi.registerMarkdownTransformer((markdown, context) => {
		if (context.messageType !== "user") return markdown;
		return `##### ❯ YOU\n\n${markdown}`;
	});

	pi.registerCommand("matrix", {
		description: "Toggle the Matrix theme (dark green, katakana shimmer): /matrix on|off",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			const next = arg === "on" || arg === "off" ? arg === "on" : !enabled;

			if (next === enabled) {
				ctx.ui.notify(`Matrix theme already ${enabled ? "engaged" : "disengaged"}`, "info");
				return;
			}

			if (next) {
				previousTheme = ctx.ui.theme.name;
				const result = ctx.ui.setTheme("matrix");
				if (!result.success) {
					ctx.ui.notify(`Could not apply matrix theme: ${result.error ?? "unknown error"}`, "error");
					return;
				}
				enabled = true;
				applyMatrixUi(ctx);
				ctx.ui.notify("Wake up, Neo... matrix theme engaged.", "info");
			} else {
				enabled = false;
				stopToolShimmer(ctx);
				ctx.ui.setWorkingIndicator(undefined);
				ctx.ui.setFooter(undefined);
				if (previousTheme) ctx.ui.setTheme(previousTheme);
				await ctx.reload();
				ctx.ui.notify("Matrix theme disengaged.", "info");
			}
		},
	});

	pi.on("session_shutdown", (_event, ctx) => {
		stopToolShimmer(ctx);
	});
}
