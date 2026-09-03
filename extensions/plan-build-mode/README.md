# Plan/Build Mode Toggle

A simple pi extension for toggling between planning and building modes.

## Features

- **Default to Plan Mode**: Every new session starts in plan mode
- **Persistent Mode**: Current mode is saved to `mode.json` and survives across API calls within a session
- **Commands**:
  - `/plan` - Switch to plan mode
  - `/build` - Switch to build mode
- **Keyboard Shortcut**:
  - `Alt+T` - Quick toggle between plan and build mode

## Usage

Once loaded by pi, use the commands above to switch between modes:

```
/plan            # Enter planning phase
/build           # Enter implementation phase

Alt+T            # Quick toggle via keyboard shortcut
```

The current mode is displayed in notifications and persisted in `mode.json`.

## Files

- `index.ts` - Main extension logic
- `mode.json` - Persistent mode storage
- `config.json` - Extension configuration
- `ui.json` - UI settings
