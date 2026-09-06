# Subagent Example

Delegate tasks to specialized subagents with isolated context windows.

## Features

- **Isolated context**: Each subagent runs in a separate `pi` process, with no extensions loaded by default (`--no-extensions`) — only its configured built-in `tools:` and (optionally) scoped skills
- **Streaming output**: See tool calls and progress as they happen
- **Parallel streaming**: All parallel tasks stream updates simultaneously
- **Markdown rendering**: Final output rendered with proper formatting (expanded view)
- **Usage tracking**: Shows turns, tokens, cost, and context usage per agent
- **Abort support**: Ctrl+C propagates to kill subagent processes
- **Live fleet widget**: A persistent panel above the editor (styled like the todo-list widget) shows every subagent run this process — running and finished, foreground and background
- **Fleet browser**: `/show-subagents` opens a popup with every run (past and present) and lets you preview a run's full context (task, tool calls, transcript, usage)
- **Model fallback**: If an agent's configured model isn't one you're actually authenticated for, the subagent automatically retries once using the main session's own model instead of failing outright
- **Session resume**: Every run is persisted to its own session file; pass `resume: "<run id>"` (from the fleet inspector's `[resumable]` tag) with a new `task` to continue a finished run's conversation with full prior context, instead of starting fresh — see [Session Resume](#session-resume)
- **Lifecycle events**: Emits `subagents:*` events on pi's shared event bus (`pi.events`) so other extensions can react to subagent activity — see [Events](#events) below
- **Per-agent skill scoping**: `skills:` frontmatter restricts an agent to specific named skills, disables skills entirely, or inherits normal discovery — see [Agent Definitions](#agent-definitions)

## Structure

```
subagent/
├── README.md            # This file
├── index.ts             # The extension (entry point)
├── agents.ts            # Agent discovery logic
├── agents/              # Sample agent definitions
│   ├── scout.md         # Fast recon, returns compressed context
│   ├── planner.md       # Creates implementation plans
│   └── reviewer.md      # Code review
└── prompts/             # Workflow presets (prompt templates)
    └── scout-and-plan.md    # scout -> planner (no implementation)
```

## Installation

From the repository root, symlink the files:

```bash
# Symlink the extension (must be in a subdirectory with index.ts)
mkdir -p ~/.pi/agent/extensions/subagent
ln -sf "$(pwd)/packages/coding-agent/examples/extensions/subagent/index.ts" ~/.pi/agent/extensions/subagent/index.ts
ln -sf "$(pwd)/packages/coding-agent/examples/extensions/subagent/agents.ts" ~/.pi/agent/extensions/subagent/agents.ts

# Symlink agents
mkdir -p ~/.pi/agent/agents
for f in packages/coding-agent/examples/extensions/subagent/agents/*.md; do
  ln -sf "$(pwd)/$f" ~/.pi/agent/agents/$(basename "$f")
done

# Symlink workflow prompts
mkdir -p ~/.pi/agent/prompts
for f in packages/coding-agent/examples/extensions/subagent/prompts/*.md; do
  ln -sf "$(pwd)/$f" ~/.pi/agent/prompts/$(basename "$f")
done
```

## Security Model

This tool executes a separate `pi` subprocess with a delegated system prompt and tool/model configuration.

**Project-local agents** (`.pi/agents/*.md`) are repo-controlled prompts that can instruct the model to read files, run bash commands, etc.

**Default behavior:** Only loads **user-level agents** from `~/.pi/agent/agents`.

To enable project-local agents, pass `agentScope: "both"` (or `"project"`). Only do this for repositories you trust.

When running interactively, the tool prompts for confirmation before running project-local agents in untrusted projects. Trusted projects skip the additional prompt. Set `confirmProjectAgents: false` to disable confirmation.

## Usage

### Single agent
```
Use scout to find all authentication code
```

### Parallel execution
```
Run 2 scouts in parallel: one to find models, one to find providers
```

### Chained workflow
```
Use a chain: first have scout find the read tool, then have planner suggest improvements
```

### Workflow prompts
```
/scout-and-plan refactor auth to support OAuth
```

## Tool Modes

| Mode | Parameter | Description |
|------|-----------|-------------|
| Single | `{ agent, task }` | One agent, one task |
| Parallel | `{ tasks: [...] }` | Multiple agents run concurrently (default max 8 tasks, 4 concurrent; configurable via `~/.pi/agent/pi-subagents.json`) |
| Chain | `{ chain: [...] }` | Sequential with `{previous}` placeholder |
| Resume | `{ resume: "<run id>", task }` | Continue a finished run (single, background, or a chain/parallel member) in its original session -- omit `agent`, it's inferred from the run being resumed |

## Output Display

**Collapsed view** (default):
- Status icon (✓/✗/⏳) and agent name
- Last 5-10 items (tool calls and text)
- Usage stats: `3 turns ↑input ↓output RcacheRead WcacheWrite $cost ctx:contextTokens model`

**Expanded view** (Ctrl+O):
- Full task text
- All tool calls with formatted arguments
- Final output rendered as Markdown
- Per-task usage (for chain/parallel)

**Parallel mode streaming**:
- Shows all tasks with live status (⏳ running, ✓ done, ✗ failed)
- Updates as each task makes progress
- Shows "2/3 done, 1 running" status
- Returns each completed task's final output to the parent model, capped at 50 KB per task
- Returns failure diagnostics from stderr/error messages when a child exits before producing output

**Tool call formatting** (mimics built-in tools):
- `$ command` for bash
- `read ~/path:1-10` for read
- `grep /pattern/ in ~/path` for grep
- etc.

## Agent Definitions

Agents are markdown files with YAML frontmatter:

```markdown
---
name: my-agent
description: What this agent does
tools: read, grep, find, ls
model: claude-haiku-4-5
skills: code-review, security-audit
---

System prompt for the agent goes here.
```

When `model` is omitted, the subagent inherits the dispatching session's active model and thinking level.

### Configuring skills for an agent

`skills:` scopes which of pi's discovered skills load into this agent's subprocess:

| Value | Effect |
|---|---|
| omitted (default) | Inherit — the subagent does its own normal skill discovery, same as running `pi` directly |
| `false` | No skills at all (`--no-skills`) |
| `scout, security-audit` (or `[scout, security-audit]`) | Only these named skills, resolved by name against the same locations pi itself scans. A name that doesn't resolve to a discovered skill is dropped silently |

This only *scopes* which of the child's already-discoverable skills load — it does not read skill content or work around pi's own skill discovery rules, and it doesn't invent a skill mechanism of its own. Skills themselves are a plain pi feature, independent of this extension.

**1. Create the skill.** A skill is a directory containing a `SKILL.md` with YAML frontmatter, placed in one of pi's normal skill locations:

- `~/.pi/agent/skills/<skill-name>/SKILL.md` — global, available to every project
- `.pi/skills/<skill-name>/SKILL.md` — project-local

```markdown
---
name: security-audit
description: Use this skill when reviewing code for injection, auth, or secrets-handling issues.
---

Instructions the agent should follow when this skill applies...
```

`name` is what you reference in an agent's `skills:` list; `description` is what the *model* reads to decide whether the skill matches the current task (see step 3).

**2. Reference it from an agent.** Add the skill's `name` to that agent's `skills:` frontmatter:

```markdown
---
name: my-agent
description: What this agent does
tools: read, grep, find, ls
skills: security-audit
---
```

Use a comma-separated list (or a YAML array) to allow more than one skill; omit `skills:` entirely to let the agent see every skill pi would normally discover.

**3. How it gets used at runtime.** pi lists every skill the subprocess can see as an `<available_skills>` block in the system prompt (name, description, file location) and instructs the model to `read` a skill's `SKILL.md` when the current task matches its `description`. Skills are not auto-executed — the model decides, from the description, whether to load one. A vague or overly broad `description` means the model may load it for tasks you didn't intend, or skip it for ones you did; write it the way you'd write a tool description.

**Locations (agents themselves, not skills):**
- `~/.pi/agent/agents/*.md` - User-level (always loaded)
- `.pi/agents/*.md` - Project-level (only with `agentScope: "project"` or `"both"`)

Project agents override user agents with the same name when `agentScope: "both"`.

## Sample Agents

| Agent | Purpose | Model | Tools |
|-------|---------|-------|-------|
| `scout` | Fast codebase recon | Haiku | read, grep, find, ls, bash |
| `planner` | Implementation plans | Sonnet | read, grep, find, ls |
| `reviewer` | Code review | Sonnet | read, grep, find, ls, bash |

## Fleet Inspector (`/show-subagents`)

Opens a popup with two panels side by side: agent list on the left, selected run's live context on the right. The focused panel's border lights up so it's clear which one your keys control. The context panel's header shows the run's model and its resolved `skills:` — either `inherited (default discovery)`, `none`, or the actual matched skill names — so you can confirm what a given run actually had access to.

| Key | Action |
|-----|--------|
| `←` / `→` | Switch focus between the agent list and the context panel |
| `↑` / `↓` (or `j`/`k`) | Select an agent (list focused) or scroll context (context focused) |
| `PgUp` / `PgDn` | Page-scroll the context panel |
| `x` | Toggle raw tool-call arguments |
| `D` | Stop a running background subagent |
| `s` | Ask the main agent to summarize a finished background run |
| `r` | Refresh |
| `Esc` | Close |

## Session Resume

Subagent runs used to be ephemeral (`--no-session`): once a run finished, its context was gone. Now every run — single, background, and each individual chain/parallel step — is persisted to its own `pi` session file, and can be continued later.

### Resuming a run

```
{ "resume": "run_1788675179886_dan6tg", "task": "What number did you note earlier?" }
```

- Omit `agent` — it's inferred from the run being resumed. Passing a different `agent` than the original run is rejected.
- The run being resumed must be finished, not currently running (steer it instead — not yet implemented, see [Events](#events)).
- Resume works **across pi session restarts**, not just within the process that spawned the run — see below.

### Where session files live

By default, subagent session files nest next to the *parent* session's own file:

```
~/.pi/agent/sessions/<project>/<parent-session-id>.jsonl              # your main session
~/.pi/agent/sessions/<project>/<parent-session-id>-subagents/
  ├─ run_xxx.jsonl
  └─ run_yyy.jsonl
```

An ephemeral parent (no persisted session — e.g. `--no-session`, or a one-shot `-p` run) has nothing to nest under, so subagent sessions fall back to the OS temp directory (`os.tmpdir()/pi-subagents-sessions/`) instead. This works identically on Windows, macOS, and Linux — `os.tmpdir()` and the nested path both resolve to OS-native locations automatically.

Override the location entirely via `~/.pi/agent/pi-subagents.json`:

```json
{ "sessionsDir": "~/.pi/agent/subagent-sessions" }
```

(A leading `~` is expanded to your home directory; absolute paths work too.)

Session files are **not automatically pruned** — nested files persist alongside their parent session indefinitely, and tmpdir fallback files persist until the OS clears its temp directory (typically on reboot). Delete old `*-subagents/` directories or tmpdir entries manually if disk usage matters to you.

### Surviving a restart

Alongside each successfully-finished run's session file, a sidecar manifest is written: `run_xxx.meta.json` (agent, mode, task, timestamps — no transcript). On `session_start`, this extension scans the session's `-subagents/` directory for manifests and rebuilds `allRuns` from them — full chat history included, parsed straight from each run's `.jsonl` — so `resume: "<run id>"` keeps working even after you restart pi against the same parent session.

- Only **successful** runs get a manifest. A failed or cancelled/aborted run has nothing pointing back to it after a restart — it's gone, not shown as resumable, not shown as broken.
- A run that was still `running` when the process was killed also gets no manifest (manifests are written on finalize, not on start) — no orphan/crash-recovery state is tracked.
- Rehydration respects the same 50-run cap as live tracking: if more than 50 manifests exist, only the 50 most recent (by start time) are loaded back.

## Events

The extension emits lifecycle events on pi's shared event bus (`pi.events`), so other extensions loaded in the same session can react to subagent activity without importing this one:

```ts
pi.events.on("subagents:completed", (data) => { ... });
```

| Channel | Emitted when | Payload |
|---|---|---|
| `subagents:ready` | Once per session, after `session_start` | `{}` |
| `subagents:created` | A run is tracked — covers single/parallel/chain steps and background dispatches alike | `{ id, agent, mode, task, isBackground }` |
| `subagents:started` | The subagent's `pi` subprocess actually begins running. Fires alongside `created` for single/parallel/chain (no queue); fires separately for background mode once a concurrency slot frees up | `{ id, agent, mode, task }` |
| `subagents:completed` | A run finishes successfully | `{ id, agent, mode, task, status, usage, durationMs, errorMessage }` |
| `subagents:failed` | A run finishes with a non-zero exit, an aborted subprocess, or an uncaught dispatch error | same shape as `completed`, with `errorMessage` set |

`mode` is one of `"single" | "parallel" | "chain" | "background"`. `usage` is the same `UsageStats` shape shown in the widget and fleet inspector (turns, tokens, cost, context usage).

Not yet implemented: `subagents:steered` and `subagents:compacted` — planned once mid-run steering lands (the resumable-session groundwork it depends on, including cross-restart resume, is already in place -- see [Session Resume](#session-resume)).

## Workflow Prompts

| Prompt | Flow |
|--------|------|
| `/scout-and-plan <query>` | scout → planner |

## Error Handling

- **Exit code != 0**: Tool returns error with stderr/output
- **stopReason "error"**: LLM error propagated with error message
- **stopReason "aborted"**: User abort (Ctrl+C) kills subprocess, throws error
- **Chain mode**: Stops at first failing step, reports which step failed

## Limitations

- Output truncated to last 10 items in collapsed view (expand to see all)
- Parallel model-visible output is capped at 50 KB per task; full results remain in tool details
- Agents discovered fresh on each invocation (allows editing mid-session)
- Parallel mode limited to 8 tasks, 4 concurrent by default (configurable via `maxParallelTasks` / `maxConcurrentSubagents` in `~/.pi/agent/pi-subagents.json`)
- `resume` across a restart only covers runs that finished **successfully** and were still within the last 50 by start time — failed/cancelled runs and anything evicted past the cap have no manifest and can't be rehydrated, even though the session file may still be on disk
- No mid-run steering yet — a currently running subagent can't be redirected, only stopped (background) or waited out (foreground)
- Subagent session files are never automatically deleted — see [Session Resume](#session-resume)
