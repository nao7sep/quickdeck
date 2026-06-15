# QuickDeck

QuickDeck is a local-first multi-pane plain text workspace for fast buffer-based writing.

It is built with Tauri, React, and TypeScript. Current workspace state is autosaved to local JSON, and recovery snapshots are stored in local SQLite.

## Features

- Multiple equal-width text panes with vivid, auto-distinct header colors
- Editable pane titles
- Pane reordering and focus via keyboard shortcuts (Cmd/Ctrl+Arrow, Cmd/Ctrl+Shift+Arrow)
- Empty-only single-pane deletion
- At least one pane always remains
- Configurable autosave delay
- Local SQLite snapshots on copy, paste, cut, and app close (whitespace-trimmed and deduped per pane)
- Snapshot search with local-time timestamps
- Configurable editor font family and size
- Zoom (50%–500%) via the menu or keyboard shortcuts; level is persisted
- Word, character, and X/Twitter weighted character counts
- Dark theme toggle through settings, the status-bar Light/Dark button, or shortcut (off by default)
- Zen mode that hides all but the active pane, with a status-bar pane switcher (a one-tab-stop tablist navigated with the arrow keys); toggle through settings or shortcut
- Always-on-top toggle through settings or shortcut
- Status bar showing save state, recent snapshot activity, a Light/Dark toggle, and clickable Zen and Topmost badges; pane and snapshot counts in normal mode, pane switcher in zen mode
- A keyboard-navigable app menu (arrows, Home/End, type-ahead, Enter to activate, Escape to close)
- Settings, shortcuts, snapshot search, and about modals (all closable with Escape or outside click)

## Requirements

- Node.js
- npm
- Rust toolchain with Cargo

## Development

Install dependencies:

```sh
npm install
```

Run the desktop app in development mode:

```sh
npm run tauri dev
```

QuickDeck uses Vite dev port `1621` to avoid colliding with other local apps.

## Scripts

Each launcher is a `scripts/<name>.command` (macOS) / `scripts/<name>.ps1` (Windows PowerShell) pair:

- **run-dev** — installs dependencies, frees Vite's dev port `1621` by stopping any process currently listening on it, and launches Tauri development mode.
- **run-built** — launches the existing built binary without rebuilding.
- **rebuild** — builds fresh (`tauri build --debug`), then launches.

## Build

Frontend build:

```sh
npm run build
```

Desktop build:

```sh
npm run tauri build
```

## Tests

Frontend unit tests (Vitest):

```sh
npm run typecheck   # type-check the app and the test files
npm test            # run the suite
```

`npm run typecheck` checks both the app (`tsconfig.json`) and the test files (`tsconfig.test.json`) — the tests stay out of the shipped build but are still type-checked, since Vitest runs them without type-checking.

Rust backend tests (snapshot storage layer):

```sh
cd src-tauri && cargo test
```

## Local Data

QuickDeck stores data locally in `~/.quickdeck`.

The data files are:

- `config.json`
- `session.json`
- `snapshots.sqlite3` (plus `snapshots.sqlite3-wal` and `snapshots.sqlite3-shm` while the app is running, due to SQLite WAL mode)
- `logs/` — one append-only session log per launch, named `yyyymmdd-hhmmss-utc.log`

If `config.json` or `session.json` fails to load at startup, QuickDeck halts on an error screen rather than starting from default state. No saves run in this state, so the affected file is never overwritten before you can repair it.

## Logs

Each launch writes one fresh session log to `~/.quickdeck/logs/`, named by its UTC start time (e.g. `20260610-030818-utc.log`). Every line is a single JSON object — a `time`/`level`/`message` envelope plus event-specific fields. Logs are kept indefinitely (never rotated or auto-deleted); they are small and are exactly what's needed to reconstruct a past session when debugging.

Levels are `info`, `warn`, and `error` (always recorded) plus `debug`, which is developer-only: it is emitted from a development build or when `QUICKDECK_DEBUG=1` is set, and is off in release builds. Field names such as `password`, `token`, and `apiKey` are redacted before a line is written (on the console fallback too). If the log file cannot be opened or written, QuickDeck falls back to the console and keeps running.

QuickDeck does not include telemetry, remote sync, or network persistence.
