/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, loadSkills, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";

/** true = inherit the child's normal skill discovery; false = no skills; string[] = only those named skills. */
export type AgentSkillsConfig = true | false | string[];

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	/** Defaults to `true` (inherit) when omitted -- see `resolveSkills`. */
	skills?: AgentSkillsConfig;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

/**
 * Raw agent frontmatter. Values are `unknown` because `parseFrontmatter` runs a
 * real YAML parser, so any scalar or collection can appear here.
 *
 * A type alias rather than an interface: `parseFrontmatter` constrains its
 * parameter to `Record<string, unknown>`, and only an alias picks up the
 * implicit index signature that satisfies it.
 */
type AgentFrontmatter = {
	name?: unknown;
	description?: unknown;
	tools?: unknown;
	model?: unknown;
	skills?: unknown;
};

/**
 * Normalize a frontmatter `tools` value to a list of tool names.
 *
 * Both spellings are valid YAML and both are in use:
 *
 *     tools: read, bash        # string
 *     tools: [read, bash]      # array
 *
 * so accept either. Anything else (a number, a map, a nested list) yields no
 * tools rather than throwing: this runs inside agent discovery, where a single
 * bad file must not take down every other agent in the same directory.
 */
function parseToolList(value: unknown): string[] | undefined {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	const tools = raw
		.filter((t): t is string => typeof t === "string")
		.map((t) => t.trim())
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

/**
 * Normalize a frontmatter `skills` value.
 *
 *     skills: true             # inherit the child's normal discovery (default)
 *     skills: false            # no skills at all
 *     skills: scout, review    # only these named skills (string)
 *     skills: [scout, review]  # only these named skills (array)
 *
 * A malformed value (a number, a map) falls back to `undefined`, which
 * `resolveSkills` treats the same as `true` -- an agent file typo here
 * should degrade to normal discovery, not silently strip every skill.
 */
function parseSkillsConfig(value: unknown): AgentSkillsConfig | undefined {
	if (value === true || value === false) return value;
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	const names = raw
		.filter((s): s is string => typeof s === "string")
		.map((s) => s.trim())
		.filter(Boolean);
	return names.length > 0 ? names : undefined;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);

		if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") {
			continue;
		}

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: parseToolList(frontmatter.tools),
			model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
			skills: parseSkillsConfig(frontmatter.skills),
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

	const agentMap = new Map<string, AgentConfig>();

	if (scope === "both") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	} else if (scope === "user") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
	} else {
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export interface ResolvedSkills {
	/** CLI flags to append to the subagent's `pi` invocation. */
	args: string[];
	/** Human-readable summary for display (fleet inspector, widget). */
	display: string;
}

/**
 * Turn an agent's `skills` config into CLI flags for the subagent's `pi`
 * subprocess, plus a display summary for the fleet inspector. `--skill
 * <path>` / `--no-skills` are pi's own flags -- this extension does not read
 * or inject skill content itself, it only scopes which of the child's
 * normally-discovered skills actually load.
 *
 * - `undefined` / `true`: no flags -- child does its own normal discovery.
 * - `false`: `--no-skills`.
 * - `string[]`: resolve each name against the same locations pi itself
 *   scans (`.pi/skills`, `~/.pi/agent/skills`, etc. via `loadSkills`), then
 *   `--no-skills` plus one `--skill <dir>` per match -- so unlisted skills
 *   the child would otherwise have found are excluded, not merely unlisted.
 *   A name that resolves to nothing is dropped silently: a typo in
 *   `skills:` should shrink the set, not crash the agent.
 */
export function resolveSkills(cwd: string, skills: AgentSkillsConfig | undefined): ResolvedSkills {
	if (skills === undefined || skills === true) return { args: [], display: "inherited (default discovery)" };
	if (skills === false) return { args: ["--no-skills"], display: "none" };

	const wanted = new Set(skills.map((s) => s.toLowerCase()));
	const { skills: discovered } = loadSkills({ cwd, agentDir: getAgentDir(), skillPaths: [], includeDefaults: true });
	const matched = discovered.filter((s) => wanted.has(s.name.toLowerCase()));

	const args = ["--no-skills"];
	for (const skill of matched) args.push("--skill", skill.baseDir);
	const display = matched.length > 0 ? matched.map((s) => s.name).join(", ") : "none (no configured skills resolved)";
	return { args, display };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}
