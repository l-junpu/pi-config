/**
 * plan-build-mode — simple mode toggle between planning and building.
 *
 * Every session starts in "plan" mode. Switch to "build" when ready.
 * Commands:
 *     /plan   switch to plan mode
 *     /build  switch to build mode
 * In Plan mode write/edit tools are blocked.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type PlanBuildMode = "plan" | "build";

function getModeLabel(mode: PlanBuildMode): string {
	return mode === "plan" ? "📋 Plan Mode" : "🔨 Build Mode";
}

function getModeStatus(mode: PlanBuildMode): string {
	return mode === "plan" ? "📋 Plan" : "🔨 Build";
}

function syncStatus(ctx: any, mode: PlanBuildMode): void {
	ctx.ui.setStatus("planBuildMode", getModeStatus(mode));
}

export default function (pi: ExtensionAPI) {
	let mode: PlanBuildMode = "plan";
	const blockedBash = new Set<string>();

	pi.on("session_start", async (_event, ctx) => {
		mode = "plan";
		blockedBash.clear();
		syncStatus(ctx, mode);
	});

	pi.on("tool_call", async (event, ctx) => {
		if (mode === "plan" && (event.toolName === "write" || event.toolName === "edit")) {
			ctx.ui.notify("Edits are not available in plan mode. Swap to /build for edits.", "warn");
			return { block: true, reason: "Write/edit tools are disabled in Plan mode. Run /build to enable edits.", terminate: true };
		}
		if (mode === "plan" && event.toolName === "bash") {
			const cmd = String(event.input?.command ?? "").trim();
			const isWrite = /[>]/ .test(cmd) || /\b(tee|dd|cp|mv|rm|chmod|mkdir|touch)\b/.test(cmd);
			if (isWrite) {
				const sig = cmd.slice(0, 200);
				if (!blockedBash.has(sig)) {
					ctx.ui.notify("Write operations are not available in plan mode. Swap to /build for edits.", "warn");
					blockedBash.add(sig);
				}
				return { block: true, reason: "Bash write commands are disabled in Plan mode. Run /build to enable.", terminate: true };
			}
		}
	});

	pi.registerCommand("plan", {
		description: "Switch to plan mode (planning phase)",
		handler: async (_args, ctx) => {
			if (mode === "plan") {
				ctx.ui.notify("Already in plan mode", "info");
				return;
			}
			mode = "plan";
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
			blockedBash.clear();
			syncStatus(ctx, mode);
			ctx.ui.notify("Switched to build mode", "info");
		},
	});

	pi.registerShortcut("alt+t", {
		description: "Toggle between plan and build mode",
		handler: async (ctx) => {
			mode = mode === "plan" ? "build" : "plan";
			if (mode === "build") blockedBash.clear();
			syncStatus(ctx, mode);
			ctx.ui.notify(`Switched to ${getModeLabel(mode)}`, "info");
		},
	});
}
