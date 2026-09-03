/**
 * plan-build-mode — simple mode toggle between planning and building.
 *
 * Every session starts in "plan" mode. Switch to "build" when ready.
 * Commands:
 *     /plan   switch to plan mode
 *     /build  switch to build mode
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

type PlanBuildMode = "plan" | "build";

const MODE_FILE = dirname(fileURLToPath(import.meta.url)) + "/mode.json";

function readMode(): PlanBuildMode {
	try {
		if (existsSync(MODE_FILE)) {
			const raw = JSON.parse(readFileSync(MODE_FILE, "utf-8")) as { mode?: string };
			if (raw.mode === "plan" || raw.mode === "build") return raw.mode;
		}
	} catch {
		/* corrupt file -> default */
	}
	return "plan";
}

function writeMode(mode: PlanBuildMode): void {
	try {
		writeFileSync(MODE_FILE, JSON.stringify({ mode }, null, 2), "utf-8");
	} catch {
		/* ignore */
	}
}

function getModeLabel(mode: PlanBuildMode): string {
	return mode === "plan" ? "📋 Plan Mode" : "🔨 Build Mode";
}

// Compact form for the status bar segment (see pi-omp-theme's statusLine.customItems).
function getModeStatus(mode: PlanBuildMode): string {
	return mode === "plan" ? "📋 Plan" : "🔨 Build";
}

function syncStatus(ctx: ExtensionContext, mode: PlanBuildMode): void {
	ctx.ui.setStatus("planBuildMode", getModeStatus(mode));
}

export default function (pi: ExtensionAPI) {
	let mode = readMode();

	// Every session starts in plan mode
	pi.on("session_start", async (_event, ctx) => {
		mode = "plan";
		writeMode("plan");
		syncStatus(ctx, mode);
	});

	pi.registerCommand("plan", {
		description: "Switch to plan mode (planning phase)",
		handler: async (_args, ctx) => {
			if (mode === "plan") {
				ctx.ui.notify("Already in plan mode", "info");
				return;
			}
			mode = "plan";
			writeMode(mode);
			syncStatus(ctx, mode);
			ctx.ui.notify("Switched to plan mode", "info");
		},
	});

	pi.registerCommand("build", {
		description: "Switch to build mode (implementation phase)",
		handler: async (_args, ctx) => {
			if (mode === "build") {
				ctx.ui.notify("Already in build mode", "info");
				return;
			}
			mode = "build";
			writeMode(mode);
			syncStatus(ctx, mode);
			ctx.ui.notify("Switched to build mode", "info");
		},
	});

	pi.registerShortcut("alt+t", {
		description: "Toggle between plan and build mode",
		handler: async (ctx) => {
			mode = mode === "plan" ? "build" : "plan";
			writeMode(mode);
			syncStatus(ctx, mode);
			ctx.ui.notify(`Switched to ${getModeLabel(mode)}`, "info");
		},
	});
}
