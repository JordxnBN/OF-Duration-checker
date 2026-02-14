# Worklog (Local-Only Desktop App)

Worklog is a personal desktop app for writing daily updates and generating weekly summaries.

## Stack

- Electron + React + Vite + TypeScript
- SQLite (`better-sqlite3`) in Electron main process
- Data path: `%AppData%` app userData folder (`worklog.sqlite`)

## Features (v1)

- `Today` view with `Done / Blocked / Next`
- Debounced auto-save with `Ctrl+S` force-save
- `History` search + edit any saved day
- `Weekly Summary` (Monday start) with copy-to-clipboard
- `Settings` for light/dark theme and data-folder access
- `Ctrl+K` quick switch command palette

## Commands

```bash
npm install
npm run dev
```

```bash
npm run test
npm run build
npm run package
```

## Notes for Windows

`better-sqlite3` usually installs with prebuilt binaries. If your install fails on native build steps, install Visual Studio 2022 Build Tools with the `Desktop development with C++` workload, then run `npm install` again.

Installed app path (NSIS, per-user default):

- `%LOCALAPPDATA%\Programs\Worklog\Worklog.exe`
