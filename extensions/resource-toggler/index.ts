/**
 * Resource Toggler
 *
 * Provides a /resources command with a tabbed TUI to enable/disable:
 * - Tools (via ExtensionAPI.setActiveTools)
 * - Skills/Extensions configured via explicit settings.skills / settings.extensions
 *   paths (non-destructive add/remove from the settings array)
 * - Skills/Extensions loaded from the two default directories (global
 *   ~/.pi/agent/{skills,extensions} and project <cwd>/.pi/{skills,extensions})
 *   by physically moving them into a sibling `.disabled/` folder and back.
 *
 * Package-sourced skills/extensions are always enabled and never shown as
 * toggleable — this tool does not manage them.
 */

import type { ExtensionAPI, ExtensionContext, SettingsManager, ToolInfo } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, DefaultResourceLoader, getAgentDir, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { Component, SettingItem, SettingsListTheme } from "@earendil-works/pi-tui";
import { parseKey, SettingsList } from "@earendil-works/pi-tui";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// --- Capture the live ResourceLoader instance (and its SettingsManager) ---
// DefaultResourceLoader is a singleton class shared with the running app via
// node's module cache, so patching its prototype lets us observe `this`.
let capturedLoader: DefaultResourceLoader | null = null;
const origGetSkills = DefaultResourceLoader.prototype.getSkills;
DefaultResourceLoader.prototype.getSkills = function (this: DefaultResourceLoader, ...args: unknown[]) {
	capturedLoader = this;
	return (origGetSkills as (...a: unknown[]) => ReturnType<typeof origGetSkills>).apply(this, args as []);
};
const origGetExtensions = DefaultResourceLoader.prototype.getExtensions;
DefaultResourceLoader.prototype.getExtensions = function (this: DefaultResourceLoader, ...args: unknown[]) {
	capturedLoader = this;
	return (origGetExtensions as (...a: unknown[]) => ReturnType<typeof origGetExtensions>).apply(this, args as []);
};

function getSettingsManager(): SettingsManager | null {
	if (!capturedLoader) return null;
	// `settingsManager` is TS-private but a plain runtime property.
	return (capturedLoader as unknown as { settingsManager: SettingsManager }).settingsManager ?? null;
}

function isUnder(child: string, parent: string): boolean {
	const c = resolve(child);
	const p = resolve(parent);
	return c === p || c.startsWith(p + sep);
}

const selfExtensionDir = dirname(fileURLToPath(import.meta.url));

// --- Root directories we manage (global + project, skills + extensions) ---
interface ManagedRoot {
	scopeLabel: string;
	liveDir: string;
	disabledDir: string;
}

function getManagedRoots(cwd: string, kind: "skills" | "extensions"): { global: ManagedRoot; project: ManagedRoot } {
	const globalLive = join(getAgentDir(), kind);
	const projectLive = join(cwd, CONFIG_DIR_NAME, kind);
	return {
		global: { scopeLabel: `Global (${globalLive})`, liveDir: globalLive, disabledDir: join(globalLive, ".disabled") },
		project: { scopeLabel: `Project (${projectLive})`, liveDir: projectLive, disabledDir: join(projectLive, ".disabled") },
	};
}

// --- Generic "resource unit" abstraction shared by skills and extensions ---
interface ResourceUnit {
	/** Absolute path to the file or folder that must move as a single unit. */
	unitPath: string;
	/** Display name. */
	name: string;
	/** Display description, if any. */
	description?: string;
	/** Whether this unit is currently in the live dir (enabled) or .disabled dir. */
	enabled: boolean;
}

function parseSkillFrontmatterName(skillMdPath: string): { name: string; description?: string } {
	try {
		const raw = readFileSync(skillMdPath, "utf-8");
		const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
		if (match) {
			const nameMatch = match[1].match(/^name:\s*(.+)$/m);
			const descMatch = match[1].match(/^description:\s*(.+)$/m);
			if (nameMatch) return { name: nameMatch[1].trim(), description: descMatch?.[1]?.trim() };
		}
	} catch {
		// fall through
	}
	return { name: basename(dirname(skillMdPath)) };
}

/** Scan a directory (live or .disabled) for skill units without going through the real loader. */
function scanSkillUnits(dir: string, enabled: boolean): ResourceUnit[] {
	if (!existsSync(dir)) return [];
	const units: ResourceUnit[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === ".disabled" || entry.name.startsWith(".")) continue;
		const entryPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			const skillMd = join(entryPath, "SKILL.md");
			if (existsSync(skillMd)) {
				const { name, description } = parseSkillFrontmatterName(skillMd);
				units.push({ unitPath: entryPath, name, description, enabled });
			}
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			const { description } = parseSkillFrontmatterName(entryPath);
			units.push({ unitPath: entryPath, name: entry.name.replace(/\.md$/, ""), description, enabled });
		}
	}
	return units;
}

function isExtensionFile(name: string): boolean {
	return name.endsWith(".ts") || name.endsWith(".js");
}

/** Scan a directory (live or .disabled) for extension units without going through the real loader. */
function scanExtensionUnits(dir: string, enabled: boolean): ResourceUnit[] {
	if (!existsSync(dir)) return [];
	const units: ResourceUnit[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === ".disabled" || entry.name.startsWith(".")) continue;
		const entryPath = join(dir, entry.name);
		if (entry.isFile() && isExtensionFile(entry.name)) {
			units.push({ unitPath: entryPath, name: entry.name, enabled });
		} else if (entry.isDirectory()) {
			const hasIndex = existsSync(join(entryPath, "index.ts")) || existsSync(join(entryPath, "index.js"));
			const hasPackageJson = existsSync(join(entryPath, "package.json"));
			if (hasIndex || hasPackageJson) {
				units.push({ unitPath: entryPath, name: entry.name, enabled });
			}
		}
	}
	return units;
}

interface ResourceRow {
	id: string;
	label: string;
	description?: string;
	unitPath: string;
	disabledDir: string;
	liveDir: string;
	enabled: boolean;
	collision: boolean;
	locked: boolean; // resource-toggler itself, or unmovable
}

function buildRowsForRoot(root: ManagedRoot, liveUnits: ResourceUnit[], disabledUnits: ResourceUnit[]): ResourceRow[] {
	const byName = new Map<string, ResourceUnit[]>();
	for (const u of [...liveUnits, ...disabledUnits]) {
		const list = byName.get(u.name) ?? [];
		list.push(u);
		byName.set(u.name, list);
	}
	const rows: ResourceRow[] = [];
	const sortedNames = [...byName.keys()].sort((a, b) => a.localeCompare(b));
	for (const name of sortedNames) {
		const units = byName.get(name)!;
		const collision = units.length > 1;
		for (const u of units) {
			const locked = isUnder(u.unitPath, selfExtensionDir);
			rows.push({
				id: u.unitPath,
				label: name,
				description: collision ? `⚠ name collision (${u.enabled ? "enabled" : "disabled"} copy) — resolve manually on disk` : u.description,
				unitPath: u.unitPath,
				disabledDir: root.disabledDir,
				liveDir: root.liveDir,
				enabled: u.enabled,
				collision,
				locked,
			});
		}
	}
	return rows;
}

function moveUnit(unitPath: string, targetDir: string): { ok: true; newPath: string } | { ok: false; error: string } {
	try {
		mkdirSync(targetDir, { recursive: true });
		const target = join(targetDir, basename(unitPath));
		if (existsSync(target)) {
			return { ok: false, error: `Target already exists: ${target}` };
		}
		renameSync(unitPath, target);
		return { ok: true, newPath: target };
	} catch (err) {
		const code = (err as NodeJS.ErrnoException)?.code;
		if (code === "EXDEV") {
			return { ok: false, error: "Cannot move across filesystems (EXDEV); disabled dir must be on the same drive." };
		}
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}

// --- Tools tab state ---
interface ToolsState {
	enabledTools: string[];
}

export default function resourceTogglerExtension(pi: ExtensionAPI) {
	let enabledTools: Set<string> = new Set();
	let allTools: ToolInfo[] = [];

	function persistToolsState() {
		pi.appendEntry<ToolsState>("resource-toggler-tools-config", {
			enabledTools: Array.from(enabledTools),
		});
	}

	function applyTools() {
		pi.setActiveTools(Array.from(enabledTools));
	}

	function restoreToolsFromBranch(ctx: ExtensionContext) {
		allTools = pi.getAllTools();
		const branchEntries = ctx.sessionManager.getBranch();
		let savedTools: string[] | undefined;
		for (const entry of branchEntries) {
			if (entry.type === "custom" && entry.customType === "resource-toggler-tools-config") {
				const data = entry.data as ToolsState | undefined;
				if (data?.enabledTools) savedTools = data.enabledTools;
			}
		}
		if (savedTools) {
			const allToolNames = allTools.map((t) => t.name);
			enabledTools = new Set(savedTools.filter((t) => allToolNames.includes(t)));
			applyTools();
		} else {
			enabledTools = new Set(pi.getActiveTools());
		}
	}

	function buildToolItems(): SettingItem[] {
		return allTools.map((tool) => ({
			id: tool.name,
			label: tool.name,
			currentValue: enabledTools.has(tool.name) ? "enabled" : "disabled",
			values: ["enabled", "disabled"],
		}));
	}

	// --- Explicit settings.skills / settings.extensions paths (non-destructive) ---
	function buildExplicitSkillItems(): SettingItem[] {
		const settingsManager = getSettingsManager();
		if (!capturedLoader || !settingsManager) return [];
		const explicitPaths = settingsManager.getSkillPaths();
		const loadedSkills = capturedLoader.getSkills().skills;
		return explicitPaths.map((p) => {
			const names = loadedSkills.filter((s) => isUnder(s.filePath, p) || isUnder(s.baseDir, p)).map((s) => s.name);
			return {
				id: `explicit-skill:${p}`,
				label: p,
				description: names.length ? `Skills: ${names.join(", ")}` : "(no skills found at this path)",
				currentValue: "enabled",
				values: ["enabled", "disabled"],
			};
		});
	}

	function buildExplicitExtensionItems(): SettingItem[] {
		const settingsManager = getSettingsManager();
		if (!capturedLoader || !settingsManager) return [];
		const explicitPaths = settingsManager.getExtensionPaths();
		const loadedExtensions = capturedLoader.getExtensions().extensions;
		return explicitPaths.map((p) => {
			const matches = loadedExtensions.filter((e) => isUnder(e.path, p) || isUnder(e.resolvedPath, p));
			return {
				id: `explicit-ext:${p}`,
				label: p,
				description: matches.length ? `Loaded: ${matches.length} extension(s)` : "(nothing loaded from this path)",
				currentValue: "enabled",
				values: ["enabled", "disabled"],
			};
		});
	}

	function toggleExplicitSkillPath(path: string, newValue: string) {
		const settingsManager = getSettingsManager();
		if (!settingsManager) return;
		const explicit = settingsManager.getSkillPaths();
		settingsManager.setSkillPaths(
			newValue === "disabled" ? explicit.filter((x) => x !== path) : explicit.includes(path) ? explicit : [...explicit, path],
		);
	}

	function toggleExplicitExtensionPath(path: string, newValue: string) {
		const settingsManager = getSettingsManager();
		if (!settingsManager) return;
		const explicit = settingsManager.getExtensionPaths();
		settingsManager.setExtensionPaths(
			newValue === "disabled" ? explicit.filter((x) => x !== path) : explicit.includes(path) ? explicit : [...explicit, path],
		);
	}

	// --- Default-directory items (destructive move toggle) ---
	function buildDefaultDirRows(
		ctx: ExtensionContext,
		kind: "skills" | "extensions",
	): { global: ResourceRow[]; project: ResourceRow[]; roots: { global: ManagedRoot; project: ManagedRoot } } {
		const roots = getManagedRoots(ctx.cwd, kind);
		const scan = kind === "skills" ? scanSkillUnits : scanExtensionUnits;
		const globalLive = scan(roots.global.liveDir, true);
		const globalDisabled = scan(roots.global.disabledDir, false);
		const projectLive = scan(roots.project.liveDir, true);
		const projectDisabled = scan(roots.project.disabledDir, false);
		return {
			global: buildRowsForRoot(roots.global, globalLive, globalDisabled),
			project: buildRowsForRoot(roots.project, projectLive, projectDisabled),
			roots,
		};
	}

	function rowsToItems(rows: ResourceRow[], prefix: string, header: string): SettingItem[] {
		if (rows.length === 0) return [];
		const items: SettingItem[] = [{ id: `header:${prefix}:${header}`, label: `── ${header} ──`, currentValue: "" }];
		for (const row of rows) {
			items.push({
				id: `${prefix}:${row.unitPath}`,
				label: row.locked ? `${row.label} (required)` : row.label,
				description: row.description,
				currentValue: row.locked ? "always on" : row.collision ? "collision" : row.enabled ? "enabled" : "disabled",
				values: row.locked || row.collision ? undefined : ["enabled", "disabled"],
			});
		}
		return items;
	}

	function buildSkillItems(ctx: ExtensionContext): SettingItem[] {
		const explicit = buildExplicitSkillItems();
		const { global, project, roots } = buildDefaultDirRows(ctx, "skills");
		return [
			...(explicit.length ? [{ id: "header:explicit-skills", label: "── Explicit settings.skills paths ──", currentValue: "" }, ...explicit] : []),
			...rowsToItems(global, "skill", roots.global.scopeLabel),
			...rowsToItems(project, "skill", roots.project.scopeLabel),
		];
	}

	function buildExtensionItems(ctx: ExtensionContext): SettingItem[] {
		const explicit = buildExplicitExtensionItems();
		const { global, project, roots } = buildDefaultDirRows(ctx, "extensions");
		return [
			...(explicit.length ? [{ id: "header:explicit-extensions", label: "── Explicit settings.extensions paths ──", currentValue: "" }, ...explicit] : []),
			...rowsToItems(global, "ext", roots.global.scopeLabel),
			...rowsToItems(project, "ext", roots.project.scopeLabel),
		];
	}

	function handleSkillToggle(ctx: ExtensionContext, id: string, newValue: string): { ok: boolean; error?: string; newId?: string } {
		if (id.startsWith("explicit-skill:")) {
			toggleExplicitSkillPath(id.slice("explicit-skill:".length), newValue);
			return { ok: true, newId: id };
		}
		if (id.startsWith("skill:")) {
			const unitPath = id.slice("skill:".length);
			const { global, project } = buildDefaultDirRows(ctx, "skills");
			const row = [...global, ...project].find((r) => r.unitPath === unitPath);
			if (!row || row.locked || row.collision) return { ok: false, error: "This item cannot be toggled." };
			const targetDir = newValue === "disabled" ? row.disabledDir : row.liveDir;
			const result = moveUnit(unitPath, targetDir);
			return result.ok ? { ok: true, newId: `skill:${result.newPath}` } : { ok: false, error: result.error };
		}
		return { ok: false };
	}

	function handleExtensionToggle(ctx: ExtensionContext, id: string, newValue: string): { ok: boolean; error?: string; newId?: string } {
		if (id.startsWith("explicit-ext:")) {
			toggleExplicitExtensionPath(id.slice("explicit-ext:".length), newValue);
			return { ok: true, newId: id };
		}
		if (id.startsWith("ext:")) {
			const unitPath = id.slice("ext:".length);
			const { global, project } = buildDefaultDirRows(ctx, "extensions");
			const row = [...global, ...project].find((r) => r.unitPath === unitPath);
			if (!row || row.locked || row.collision) return { ok: false, error: "This item cannot be toggled." };
			const targetDir = newValue === "disabled" ? row.disabledDir : row.liveDir;
			const result = moveUnit(unitPath, targetDir);
			return result.ok ? { ok: true, newId: `ext:${result.newPath}` } : { ok: false, error: result.error };
		}
		return { ok: false };
	}

	const TABS = ["Tools", "Skills", "Extensions"] as const;

	async function openResourcesDialog(ctx: ExtensionContext) {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("/resources requires TUI mode", "error");
			return;
		}

		allTools = pi.getAllTools();
		let needsReload = false;
		let activeTab = 0;

		await ctx.ui.custom((tui, theme, _kb, done) => {
			const baseTheme = getSettingsListTheme();
			const statusColors: Record<string, "success" | "error" | "warning"> = {
				enabled: "success",
				"always on": "success",
				disabled: "error",
				collision: "warning",
			};
			const theme_: SettingsListTheme = {
				...baseTheme,
				value: (text, selected) => {
					const color = statusColors[text];
					return color ? theme.fg(color, text) : baseTheme.value(text, selected);
				},
			};
			const lists: SettingsList[] = [];
			const itemsByTab: SettingItem[][] = [];
			const currentIdByTab: (string | undefined)[] = [];

			function isSelectable(item: SettingItem) {
				return !item.id.startsWith("header:");
			}
			function selectDefault(tabIndex: number, list: SettingsList, items: SettingItem[]) {
				const first = items.find(isSelectable);
				if (first) {
					list.selectItem(first.id);
					currentIdByTab[tabIndex] = first.id;
				}
			}

			function makeToolsList(): SettingsList {
				const items = buildToolItems();
				itemsByTab[0] = items;
				const list = new SettingsList(items, 12, theme_, (id, newValue) => {
					if (newValue === "enabled") enabledTools.add(id);
					else enabledTools.delete(id);
					applyTools();
					persistToolsState();
					lists[0].updateValue(id, newValue);
				}, () => done(undefined));
				if (currentIdByTab[0] === undefined) selectDefault(0, list, items);
				return list;
			}
			function makeSkillsList(): SettingsList {
				const items = buildSkillItems(ctx);
				itemsByTab[1] = items;
				const list = new SettingsList(items, 14, theme_, (id, newValue) => {
					if (id.startsWith("header:")) return;
					const result = handleSkillToggle(ctx, id, newValue);
					if (!result.ok) {
						ctx.ui.notify(result.error ?? "Could not toggle this item.", "error");
					} else {
						needsReload = true;
					}
					lists[1] = makeSkillsList();
					if (result.newId) {
						lists[1].selectItem(result.newId);
						currentIdByTab[1] = result.newId;
					}
				}, () => done(undefined));
				selectDefault(1, list, items);
				return list;
			}
			function makeExtensionsList(): SettingsList {
				const items = buildExtensionItems(ctx);
				itemsByTab[2] = items;
				const list = new SettingsList(items, 14, theme_, (id, newValue) => {
					if (id.startsWith("header:")) return;
					const result = handleExtensionToggle(ctx, id, newValue);
					if (!result.ok) {
						ctx.ui.notify(result.error ?? "Could not toggle this item.", "error");
					} else {
						needsReload = true;
					}
					lists[2] = makeExtensionsList();
					if (result.newId) {
						lists[2].selectItem(result.newId);
						currentIdByTab[2] = result.newId;
					}
				}, () => done(undefined));
				selectDefault(2, list, items);
				return list;
			}

			lists.push(makeToolsList(), makeSkillsList(), makeExtensionsList());

			function moveSelection(direction: 1 | -1) {
				const items = itemsByTab[activeTab];
				const selectable = items.filter(isSelectable);
				if (selectable.length === 0) return;
				const currentId = currentIdByTab[activeTab];
				const idx = selectable.findIndex((i) => i.id === currentId);
				const nextIdx = idx === -1 ? 0 : (idx + direction + selectable.length) % selectable.length;
				const nextId = selectable[nextIdx].id;
				lists[activeTab].selectItem(nextId);
				currentIdByTab[activeTab] = nextId;
			}

			const component: Component = {
				render(width: number) {
					const tabLine = TABS.map((label, i) =>
						i === activeTab ? theme.fg("accent", theme.bold(`[${label}]`)) : theme.fg("dim", ` ${label} `),
					).join("  ");
					const hint = theme.fg("dim", "←/→: switch section  Enter/Space: toggle  Esc: close");
					return [theme.fg("accent", theme.bold("Resource Configuration")), tabLine, hint, "", ...lists[activeTab].render(width)];
				},
				invalidate() {
					for (const l of lists) l.invalidate();
				},
				handleInput(data: string) {
					const key = parseKey(data);
					if (key === "right") {
						activeTab = (activeTab + 1) % TABS.length;
					} else if (key === "left") {
						activeTab = (activeTab - 1 + TABS.length) % TABS.length;
					} else if (key === "down") {
						moveSelection(1);
					} else if (key === "up") {
						moveSelection(-1);
					} else {
						lists[activeTab].handleInput?.(data);
					}
					tui.requestRender();
				},
			};
			return component;
		});

		if (needsReload) {
			ctx.ui.notify("Reloading to apply skill/extension changes…", "info");
			await ctx.reload();
		}
	}

	pi.registerCommand("resources", {
		description: "Toggle tools, skills, and extensions",
		handler: (_args, ctx) => openResourcesDialog(ctx),
	});

	pi.on("session_start", async (_event, ctx) => {
		restoreToolsFromBranch(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		restoreToolsFromBranch(ctx);
	});
}
