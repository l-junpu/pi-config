/**
 * Keyword Shimmer - reusable template for shimmering keywords in the editor
 *
 * Ports pi-omp-theme's "Working..." shimmer technique (shared/shimmer.ts +
 * features/working-indicator) to arbitrary keyword patterns: colors are
 * resolved through theme.fg() (terminal-safe) and swept across matched text
 * with a classic left-to-right shine band.
 *
 * Usage from another extension:
 *
 *   import { installKeywordShimmer } from "../pi-rainbow-keywords/keyword-shimmer.ts";
 *
 *   export default function (pi: ExtensionAPI) {
 *     installKeywordShimmer(pi, {
 *       pattern: /todo/gi,
 *       palette: { low: "dim", mid: "warning", high: "accent", bold: true },
 *     });
 *   }
 *
 * Note: only one extension can call ctx.ui.setEditorComponent per session --
 * the last one registered wins. If you need multiple shimmering patterns,
 * pass a combined pattern (e.g. /todo|subagents?/gi) to a single call, or
 * compose editor classes yourself with createShimmerEditorClass.
 */

import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BOLD_OPEN = "\x1b[1m";
const BOLD_CLOSE = "\x1b[22m";

export type ShimmerTier = "low" | "mid" | "high";

/** Theme color names (e.g. "dim", "muted", "accent", "warning", "error", "success") to cycle through as the shine sweeps across a match. */
export interface ShimmerPalette {
	low: string;
	mid: string;
	high: string;
	/** Bold the brightest (peak-shine) tier. Default: true. */
	bold?: boolean;
}

export const DEFAULT_PALETTE: ShimmerPalette = { low: "dim", mid: "muted", high: "accent", bold: true };

export interface ShimmerTiming {
	/** How fast the shine band sweeps, in terminal cells per second. Default: 30. */
	speedCellsPerS?: number;
	/** Extra idle cells before/after the word so the shine visibly enters/exits. Default: 10. */
	padding?: number;
	/** Half-width of the bright band, in cells. Default: 6. */
	bandHalfWidth?: number;
	/** Render tick interval in ms. Default: ~33ms (30fps). */
	frameIntervalMs?: number;
}

const DEFAULT_TIMING: Required<ShimmerTiming> = {
	speedCellsPerS: 30,
	padding: 10,
	bandHalfWidth: 6,
	frameIntervalMs: Math.round(1000 / 30),
};

const TIER_HIGH = 0.65;
const TIER_MID = 0.22;

function classicIntensity(time: number, index: number, length: number, timing: Required<ShimmerTiming>): number {
	const period = length + timing.padding * 2;
	const pos = ((time / 1000) * timing.speedCellsPerS) % period;
	const dist = Math.abs(index + timing.padding - pos);
	if (dist >= timing.bandHalfWidth) return 0;
	return 0.5 * (1 + Math.cos((Math.PI * dist) / timing.bandHalfWidth));
}

function tierFor(intensity: number): ShimmerTier {
	if (intensity >= TIER_HIGH) return "high";
	if (intensity >= TIER_MID) return "mid";
	return "low";
}

export interface Themed {
	fg: (color: string, text: string) => string;
}

/** Paints a single match with a shine sweep, run-length-encoding same-tier stretches so theme.fg() is called once per run. */
export function shimmerText(
	text: string,
	theme: Themed,
	time: number,
	palette: ShimmerPalette = DEFAULT_PALETTE,
	timing: ShimmerTiming = {},
): string {
	const resolvedTiming = { ...DEFAULT_TIMING, ...timing };
	const tierColor: Record<ShimmerTier, string> = { low: palette.low, mid: palette.mid, high: palette.high };
	const bold = palette.bold ?? true;

	let out = "";
	let runTier: ShimmerTier | undefined;
	let runStart = 0;
	for (let i = 0; i <= text.length; i++) {
		const tier = i < text.length ? tierFor(classicIntensity(time, i, text.length, resolvedTiming)) : undefined;
		if (tier !== runTier) {
			if (runTier !== undefined && i > runStart) {
				const chunk = text.slice(runStart, i);
				const colored = theme.fg(tierColor[runTier], chunk);
				out += bold && runTier === "high" ? `${BOLD_OPEN}${colored}${BOLD_CLOSE}` : colored;
			}
			runTier = tier;
			runStart = i;
		}
	}
	return out;
}

export interface KeywordShimmerOptions {
	/** Regex to match keywords against. Must have the "g" flag. */
	pattern: RegExp;
	/** Colors to cycle through as the shine sweeps. Default: DEFAULT_PALETTE. */
	palette?: ShimmerPalette;
	timing?: ShimmerTiming;
}

/** Builds a CustomEditor subclass that shimmers text matching `pattern`. `appTheme` must be the full themed API (e.g. ctx.ui.theme), not the editor's own limited EditorTheme. */
export function createShimmerEditorClass(options: KeywordShimmerOptions, appTheme: Themed) {
	const { pattern, palette = DEFAULT_PALETTE, timing = {} } = options;
	const frameIntervalMs = timing.frameIntervalMs ?? DEFAULT_TIMING.frameIntervalMs;

	return class ShimmerEditor extends CustomEditor {
		private animationTimer?: ReturnType<typeof setInterval>;

		private hasMatch(): boolean {
			pattern.lastIndex = 0;
			return pattern.test(this.getText());
		}

		private startAnimation(): void {
			if (this.animationTimer) return;
			this.animationTimer = setInterval(() => {
				this.tui.requestRender();
			}, frameIntervalMs);
		}

		private stopAnimation(): void {
			if (this.animationTimer) {
				clearInterval(this.animationTimer);
				this.animationTimer = undefined;
			}
		}

		handleInput(data: string): void {
			super.handleInput(data);
			if (this.hasMatch()) this.startAnimation();
			else this.stopAnimation();
		}

		render(width: number): string[] {
			const time = Date.now();
			return super
				.render(width)
				.map((line) => line.replace(pattern, (m) => shimmerText(m, appTheme, time, palette, timing)));
		}
	};
}

/** Wires a shimmering keyword pattern into the editor on session_start. Convenience wrapper around createShimmerEditorClass for the common case. */
export function installKeywordShimmer(pi: ExtensionAPI, options: KeywordShimmerOptions): void {
	pi.on("session_start", (_event, ctx) => {
		const ShimmerEditor = createShimmerEditorClass(options, ctx.ui.theme);
		ctx.ui.setEditorComponent((tui, theme, kb) => new ShimmerEditor(tui, theme, kb));
	});
}
