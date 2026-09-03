# Pi Extensions

This folder contains 7 local extensions for Pi. Each extension adds functionality to the Pi coding agent.

---

## Extensions Overview

| Extension           | Type             | Description                                                                                    |
| ------------------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| **pi-handoff**      | Command          | Transfer context to a new focused session without lossy compaction                             |
| **pi-omp-theme**    | Theme/UI         | OMP-inspired visual theme with Titanium dark/light, custom status line, editor, tool rendering |
| **pi-questions**    | Tool             | Interactive questionnaire for clarifying requirements via single or multi-question pickers     |
| **pi-side-chat**    | Overlay/Command  | Fork conversation into a side chat while main agent keeps working                              |
| **plan-build-mode** | Command/Shortcut | Toggle between planning and building modes with persistent state                               |
| **resource-toggler** | Command/Overlay  | Tabbed TUI to enable/disable Tools, Skills, and Extensions                                      |
| **todo-list**       | Tool/Widget      | Todo management tool with live-updating panel above the editor                                 |

---

## pi-handoff

**Purpose**: Transfer context to a new focused session. Instead of compaction (which is lossy), handoff extracts what matters for your next task and creates a new session with a generated prompt.

### Commands

```
/handoff <goal for new thread>
```

### Usage Examples

```
/handoff now implement this for teams as well
/handoff execute phase one of the plan
/handoff check other places that need this fix
```

### How It Works

1. Gathers conversation context from current branch (handles compaction)
2. Sends conversation + your goal to the model to generate a structured handoff prompt
3. Shows the generated prompt in an editor for review/editing
4. Creates a new session with parent tracking, pre-filled with the edited prompt

### Output Format

The generated prompt contains exactly three sections:

- **Context** — Bullet list of decisions, approaches, key findings
- **Files** — Bullet list of file paths discussed/modified (in backticks)
- **Task** — Short actionable paragraph for what to do next

---

## pi-omp-theme

**Purpose**: OMP-inspired visual theme and TUI presentation extension. Combines Titanium dark/light themes with coordinated startup view, status line, editor, messages, and tool rendering.

### Key Features

- **Presets**: `claude`, `omp`, `default`, `minimal`, `compact`, `full`, `ascii`, `native`
- **Status line**: Model, effort, path, Git state, context usage, cost, time, session state
- **Editor styles**: native, compact, boxed, dock
- **Tool rendering**: Boxed commands, response, exit status, elapsed time
- **Themes**: Titanium dark/light with Nerd Font/Unicode/ASCII modes

### Configuration (settings.json)

```json
{
  "piOmpTheme": {
    "preset": "claude",
    "theme": { "autoApply": "titanium" },
    "compatibility": { "allowCorePatches": false }
  }
}
```

### Commands

| Command                                      | Purpose                                                 |
| -------------------------------------------- | ------------------------------------------------------- |
| `/pi-omp-theme`                              | Show active preset and surface state                    |
| `/pi-omp-theme on/off`                       | Toggle extension for current session                    |
| `/pi-omp-theme preset <name>`                | Apply a preset                                          |
| `/pi-omp-theme placement above/below/border` | Change status placement                                 |
| `/pi-omp-theme editor <style> [frame]`       | Change editor presentation                              |
| `/pi-omp-theme surface <name> on/off`        | Toggle a surface                                        |
| `/pi-omp-theme doctor`                       | Show capability, conflict, fallback, config diagnostics |

### Environment Variables

- `PI_OMP_THEME_DISABLED=1` — Disable extension
- `PI_OMP_THEME_NERD_FONTS=1|0` — Force Nerd Font glyphs
- `PI_OMP_THEME_EDITOR=native|compact|boxed|dock` — Override editor style
- `PI_OMP_THEME_STATUS=above|below|off` — Override status placement
- `PI_OMP_THEME_THEME=<name|off>` — Select/disable theme
- `PI_OMP_THEME_DEBUG=1` — Enable diagnostics

---

## pi-questions

**Purpose**: Unified tool for asking single or multiple questions via interactive pickers. Use instead of guessing when requirements are ambiguous.

### Tool: `questionnaire`

### Parameters

```typescript
{
  questions: [
    {
      id: "string",           // unique identifier
      label: "string",        // short label for tab bar (optional, defaults to Q1, Q2...)
      prompt: "string",       // full question text
      options: [
        { value: "string", label: "string", description?: "string" }
      ],
      allowOther: boolean     // default: true (allows free-form input)
    }
  ]
}
```

### Usage

- **Single question**: Shows simple option list with ↑↓ navigation
- **Multiple questions**: Shows tab bar navigation between questions + Submit tab

### Controls

| Key       | Action                                     |
| --------- | ------------------------------------------ |
| ↑/↓       | Navigate options                           |
| Enter     | Select option / Submit (when all answered) |
| Tab / ←/→ | Switch tabs (multi-question)               |
| Esc       | Cancel                                     |

### Example

```json
{
  "questions": [
    {
      "id": "scope",
      "label": "Scope",
      "prompt": "What should this PR cover?",
      "options": [
        { "value": "bugfix", "label": "Bug fix only" },
        { "value": "feature", "label": "New feature" },
        { "value": "refactor", "label": "Refactoring" }
      ]
    },
    {
      "id": "priority",
      "label": "Priority",
      "prompt": "How urgent is this?",
      "options": [
        { "value": "high", "label": "High - needs immediate attention" },
        { "value": "medium", "label": "Medium - next sprint" },
        { "value": "low", "label": "Low - when time permits" }
      ],
      "allowOther": false
    }
  ]
}
```

---

## pi-side-chat

**Purpose**: Fork the current conversation into a side chat while the main agent keeps working.

### Shortcuts

| Key                | Action                                  |
| ------------------ | --------------------------------------- |
| `Alt+/`            | Open side chat / toggle focus           |
| `Alt+Shift+M`      | Toggle compact / fullscreen view        |
| `Enter`            | Send message                            |
| `Esc`              | Interrupt streaming, or close when idle |
| `Alt+R`            | Re-fork from latest main context        |
| `Alt+N`            | Start empty conversation                |
| `Ctrl+T`           | Toggle read-only / edit mode            |
| `PgUp` / `Shift+↑` | Scroll up                               |
| `PgDn` / `Shift+↓` | Scroll down                             |

### Commands

```
/side              # Open side chat (fork conversation)
/side-model        # Choose a model for side chat (independent of main)
```

### Features

- **Forks conversation** — starts with copy of current branch context + all extension tools
- **Persists across close/reopen** — closing preserves conversation in memory
- **Read-only by default** — read/grep/find/ls only; toggle to edit mode (`Ctrl+T`) for write tools with overlap warnings
- **`peek_main` tool** — lets side agent read recent activity from main session
- **Independent model selection** — `/side-model` picks model for side chat only

### Configuration (config.json)

```json
{
  "shortcut": "alt+/",
  "fullscreenShortcut": "alt+shift+m"
}
```

### Limitations

- One side chat at a time
- Won't open on top of another visible overlay
- Does not merge messages back into main thread
- Bash overlap detection is heuristic
- `peek_main` is on-demand, not live

---

## plan-build-mode

**Purpose**: Simple mode toggle between planning and building phases. Every session starts in plan mode.

### Commands

```
/plan      # Switch to plan mode (planning phase)
/build     # Switch to build mode (implementation phase)
```

### Shortcut

| Key     | Action                                   |
| ------- | ---------------------------------------- |
| `Alt+T` | Quick toggle between plan and build mode |

### Behavior

- **Plan mode** (default): For planning, designing, researching
- **Build mode**: For implementation, coding, testing
- Mode persists to `mode.json` and survives across API calls within a session
- Status bar shows current mode (📋 Plan / 🔨 Build)
- Notification shown on every switch

---

## resource-toggler

**Purpose**: Tabbed TUI for managing which Tools, Skills, and Extensions are active, without hand-editing `settings.json` or session state.

### Commands

```
/resources   # Open the Tools / Skills / Extensions tabs
```

### Controls

| Key         | Action                          |
| ----------- | -------------------------------- |
| ←/→         | Switch between Tools/Skills/Extensions tabs |
| ↑/↓         | Move selection (skips section headers, wraps around) |
| Enter/Space | Toggle enabled/disabled          |
| Esc         | Save and close                   |

### Tabs

- **Tools** — enable/disable any registered tool via `ExtensionAPI.setActiveTools()`. Persists per session branch and restores on session start/tree navigation.
- **Skills** / **Extensions** — three sections each:
  - *Explicit settings paths* — toggling adds/removes the path from `settings.skills` / `settings.extensions` (non-destructive).
  - *Global* (`~/.pi/agent/{skills,extensions}`) and *Project* (`.pi/{skills,extensions}`) — toggling physically moves the item into (or out of) a sibling `.disabled/` folder, so default-directory items can be disabled individually.
  - Package-sourced skills/extensions are always enabled and not shown as toggleable.

### Behavior Notes

- Toggling a Skill/Extension triggers `ctx.reload()` to apply the change; the dialog simply closes rather than reopening automatically.
- Items with a naming collision (same name found both enabled and disabled in the same root) are shown in a distinct color, labeled `collision`, and locked from toggling until resolved manually on disk.
- The `resource-toggler` extension itself is always shown as "always on (required)" so it can't disable itself.
- Enabled/disabled/collision states are color-coded (green/red/yellow) for readability.

---

## todo-list

**Purpose**: Todo management for multi-step tasks. Registers a `todo` tool for the LLM and shows a persistent live-updating panel above the editor whenever the list is non-empty.

### Tool: `todo`

### Actions

| Action      | Parameters          | Description                                           |
| ----------- | ------------------- | ----------------------------------------------------- |
| `list`      | —                   | Show all todos                                        |
| `add`       | `text`              | Append a new todo                                     |
| `insert`    | `text`, `position?` | Insert at position (0-based, omit to append)          |
| `edit`      | `id`, `text`        | Update todo text                                      |
| `remove`    | `id`                | Delete a todo                                         |
| `setStatus` | `id`, `status`      | Set status: `pending` \| `in_progress` \| `completed` |
| `clear`     | —                   | Clear all todos                                       |

### Enforcement Rules (enforced by tool)

1. **Sequential order**: An item can only start (`in_progress`) once every earlier item is `completed`
2. **Single in_progress**: Only one item can be `in_progress` at a time (starting another demotes the previous to `pending`)
3. **Use edit/insert/remove** to reorganize instead of skipping ahead

### Guidelines (for LLM)

- Use for any task taking more than one step
- Break task into concrete items with `add` before starting work
- Mark one `in_progress` at a time; set to `completed` immediately when done
- Call `list` before ending turn; keep working if items remain pending/in_progress
- Only skip for trivial single-step requests

### UI

- **Live panel**: Appears above editor automatically when todos exist
- **Animated indicators**: Pulses while `in_progress`, settles to dot when `completed`
- **Shows**: `✓` completed, `▶` in_progress, `○` pending with todo ID and text

---

## Loading Extensions

These extensions are loaded automatically from `~/.pi/agent/extensions/` when Pi starts.

To verify they're loaded:

```
/extensions  # or check pi list
```

To reload after changes:

```
/extensions reload
```

---

## Development

Each extension is a single `index.ts` file (except pi-omp-theme and pi-side-chat which have multiple modules). They use the Pi Extension API (`@earendil-works/pi-coding-agent`) and TUI components (`@earendil-works/pi-tui`).

### Extension Structure

```
extension-name/
├── index.ts          # Main entry point (required)
├── *.ts              # Additional modules (optional)
├── config.json       # Extension config (optional)
└── README.md         # Documentation (optional)
```
