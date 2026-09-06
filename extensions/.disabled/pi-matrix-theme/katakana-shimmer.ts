/**
 * Katakana rain shimmer helpers for the Matrix theme: a working indicator
 * that prints scrolling katakana with a classic shine sweep, plus a
 * text-shimmer utility reused for in-progress tool status.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";

const KATAKANA = "アカサタナハマヤラワイキシチニヒミリヰウクスツヌフムユルヱエケセテネヘメレヲエンォャュョッー0123456789".split("");

function randomKatakanaChar(): string {
	return KATAKANA[Math.floor(Math.random() * KATAKANA.length)] ?? "ｱ";
}

function classicIntensity(pos: number, index: number, bandHalfWidth: number): number {
	const dist = Math.abs(index - pos);
	if (dist >= bandHalfWidth) return 0;
	return 0.5 * (1 + Math.cos((Math.PI * dist) / bandHalfWidth));
}

type Tier = "dim" | "muted" | "success" | "accent";

function tierFor(intensity: number): Tier {
	if (intensity >= 0.7) return "accent";
	if (intensity >= 0.4) return "success";
	if (intensity >= 0.15) return "muted";
	return "dim";
}

/**
 * Builds working-indicator frames where the katakana string grows by one
 * character each frame up to maxLength, then shrinks back down to one,
 * looping. Characters closest to the growing edge are brightest.
 */
export function buildKatakanaIndicatorFrames(theme: Theme, maxLength = 14): string[] {
	const frames: string[] = [];
	const lengths: number[] = [];
	for (let n = 1; n <= maxLength; n++) lengths.push(n);
	for (let n = maxLength - 1; n >= 1; n--) lengths.push(n);

	for (const length of lengths) {
		let out = "";
		for (let i = 0; i < length; i++) {
			const distFromEdge = length - 1 - i;
			const tier = tierFor(1 - distFromEdge / Math.max(4, length));
			const ch = randomKatakanaChar();
			const colored = theme.fg(tier, ch);
			out += tier === "accent" ? theme.bold(colored) : colored;
		}
		frames.push(out);
	}
	return frames;
}

/** Colors a fixed label with a shine sweep driven by wall-clock time, for footer/status text. */
export function shimmerLabel(text: string, theme: Theme, time: number, speedCellsPerS = 22, bandHalfWidth = 4): string {
	const period = text.length + bandHalfWidth * 4;
	const pos = ((time / 1000) * speedCellsPerS) % period;
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const intensity = classicIntensity(pos, i, bandHalfWidth);
		const tier = tierFor(intensity);
		const colored = theme.fg(tier, text[i] ?? "");
		out += tier === "accent" ? theme.bold(colored) : colored;
	}
	return out;
}

/** A short rotating katakana burst used next to in-progress tool status text. */
export function katakanaBurst(theme: Theme, time: number, length = 5): string {
	const seed = Math.floor(time / 90);
	let out = "";
	for (let i = 0; i < length; i++) {
		const rand = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
		const idx = Math.floor((rand - Math.floor(rand)) * KATAKANA.length);
		out += KATAKANA[idx] ?? "ｱ";
	}
	return theme.fg("success", out);
}
