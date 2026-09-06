# pi-matrix-theme

Dark green "Matrix" theme with katakana-rain shimmer, swappable against `pi-omp-theme` at runtime.

## Usage

```
/matrix on    # apply the matrix theme, katakana working indicator, and matrix footer
/matrix off   # restore the previous theme and reload extensions so pi-omp-theme takes back over
/matrix       # toggle
```

## What it does

- **Theme**: `~/.pi/agent/themes/matrix.json` — dark green/black palette (`#00ff41` accent), used for all UI surfaces, syntax highlighting, diffs, and markdown. Includes `extras.userBoxBorderColor`/`assistantPrefixColor` read by `pi-omp-theme` if its core patches are enabled.
- **Working indicator**: while streaming, replaces the spinner with a sweeping band of random katakana characters (`katakana-shimmer.ts`).
- **In-progress tool shimmer**: if a tool call (edit/read/ls/grep/...) runs longer than ~300ms, a shimmering katakana + tool-name status appears in the footer via `setStatus`, so slow work is visually obvious without flickering on instant calls.
- **Matrix footer**: cwd, git branch, model, and context usage, with a small animated katakana burst on the left.
- **User message label**: a markdown transformer (independent of the on/off toggle) prepends a small `❯ YOU` heading to user messages, colored via the active theme's `mdHeading` token, so it's clear who sent a message under any theme.

Only one extension can own `setFooter`/`setWorkingIndicator`/`setEditorComponent` at a time. Turning matrix off calls `ctx.reload()` so `pi-omp-theme` re-registers its own footer/indicator/editor.
