# pi-resource-toggler

`/resources` — a popup to enable/disable tools, skills, and extensions without editing config files by hand.

## Quick Start

Run `/resources`. A popup opens with two panels: categories (Tools, Skills, Extensions) on the left, toggle list for the selected category on the right. The focused panel's border lights up.

| Key | Action |
|-----|--------|
| `←` / `→` | Switch focus between the categories panel and the items panel |
| `↑` / `↓` | Select a category (categories focused) or an item (items focused) |
| `Enter` / `Space` | Toggle the selected item |
| `Esc` | Close |

## What It Manages

- **Tools** — enabled/disabled via `pi.setActiveTools`, persisted for the session branch.
- **Skills / Extensions** — two kinds of entries:
  - Explicit paths from `settings.skills` / `settings.extensions` — toggling adds/removes the path from settings (non-destructive).
  - Files/folders in the default directories (`~/.pi/agent/{skills,extensions}` and `<project>/.pi/{skills,extensions}`) — toggling physically moves them into a sibling `.disabled/` folder and back.

Package-sourced skills/extensions are always enabled and not shown here.

Toggling a skill or extension marks the session for reload; you'll be prompted to reload once you close the popup.

## Limitations

- Requires TUI mode.
- Name collisions (same skill/extension name enabled and disabled at once) must be resolved manually on disk.
- The extension itself (and anything under its own directory) can't be disabled from within the popup.
