# pi-side-chat

Fork the current conversation into a side chat while the main agent keeps working.

Ported from the reference implementation in `agent/external-references/pi-side-chat-main`, adapted to this environment's `@earendil-works/*` packages.

## Quick Start

Open side chat with `Alt+/` or `/side`. Ask a question and press `Enter`.

Press `Esc` to close it. Reopen with `Alt+/` to continue where you left off.

- **Toggle focus** — `Alt+/` switches between the side chat and main editor without closing the overlay.
- **Toggle mode** — `Ctrl+T` switches between read-only and edit mode.
- **Toggle fullscreen** — `Alt+Shift+M` expands the open side chat to the terminal bounds. Press it again to restore the compact overlay.
- **Start fresh** — `Alt+R` re-forks from the latest main context. `Alt+N` starts a blank conversation.

## Features

- **Forks the conversation** — starts with a copy of the current branch context and all extension-registered tools.
- **Persists across close/reopen** — closing preserves the conversation in memory; reopening restores it.
- **Read-only by default** — read/grep/find/ls tools only; toggle to edit mode (`Ctrl+T`) for bash/edit/write with overlap warnings.
- **`peek_main` tool** — lets the side agent read recent activity from the main session.
- **Independent model selection** — `/side-model` picks a model for the side chat only, separate from whatever the main window is using. Defaults to mirroring the main model until you choose one.

## Controls

| Key | Action |
|-----|--------|
| `Alt+/` | Open side chat / toggle focus |
| `Alt+Shift+M` | Toggle compact / fullscreen view |
| `Enter` | Send message |
| `Esc` | Interrupt streaming, or close when idle |
| `Alt+R` | Re-fork from latest main context |
| `Alt+N` | Start empty conversation |
| `Ctrl+T` | Toggle read-only / edit mode |
| `PgUp` / `Shift+↑` | Scroll up |
| `PgDn` / `Shift+↓` | Scroll down |

## Choosing a Model

By default the side chat mirrors whatever model the main window is currently using at the time you open it (`/side` or `Alt+/`). Run `/side-model` to pick a different model just for the side chat:

- Shows a list of all available models plus a "Use main session's model" option to reset.
- If a side chat is already open, the change applies immediately (hot-swapped, no need to re-fork).
- The selection persists for the rest of the pi session (in memory only — not saved to disk) and is used for every subsequent `/side` open/re-fork until you change it again or restart pi.
- The active model is shown in the overlay header, e.g. `[claude-opus-4-7]`.

## Configuration

Edit `config.json` next to the extension to change the shortcuts:

```json
{
  "shortcut": "alt+/",
  "fullscreenShortcut": "alt+shift+m"
}
```

## How It Works

Clones the current session context and creates a separate `Agent` instance (from `@earendil-works/pi-agent-core`) seeded with all extension-registered tools, rendered in a `ctx.ui.custom()` TUI overlay. Compact and fullscreen modes resize the same component/agent in place via `onDisplayModeChange`. Closing the overlay saves the conversation in memory (`lastMessages`); reopening restores it unless `Alt+R`/`Alt+N` is used.

Main-agent tool execution (`write`/`edit`/`bash`) is tracked via `FileActivityTracker` to maintain a set of written file paths. In edit mode, write-capable tools are wrapped (`tool-wrapper.ts`) to warn before touching those paths.

## Files

- `index.ts` — extension entry point, overlay lifecycle, shortcuts/commands
- `side-chat-overlay.ts` — the `SideChatOverlay` TUI component and side `Agent`
- `side-chat-messages.ts` — message rendering/scrolling for the overlay
- `side-chat-layout.ts` — compact/fullscreen overlay sizing
- `fork-surgery.ts` — trims mid-execution tool calls when forking
- `tool-wrapper.ts` — write-path extraction and overlap-warning wrapping
- `file-activity-tracker.ts` — tracks files written by the main agent

## Limitations

- One side chat at a time
- Won't open on top of another visible overlay
- Does not merge messages back into the main thread
- Bash overlap detection is heuristic
- `peek_main` is on-demand, not live
