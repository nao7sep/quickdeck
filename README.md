# QuickDeck

QuickDeck is a local-first multi-pane plain text workspace for fast buffer-based writing.

It is built with Tauri, React, and TypeScript. Current workspace state is autosaved to local JSON, and recovery snapshots are stored in local SQLite.

## Features

- Multiple equal-width text panes
- Editable pane titles
- Drag-and-drop pane reordering
- Empty-only single-pane deletion
- At least one pane always remains
- Configurable autosave delay
- Local SQLite snapshots on copy, paste, cut, and app close
- Snapshot search
- Configurable editor font family and size
- Word, character, and X/Twitter weighted character counts
- Always-on-top and opacity controls through shortcuts
- Settings, shortcuts, and about modals

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

QuickDeck uses Vite dev port `1421` to avoid colliding with other local apps.

## Scripts

macOS:

```sh
scripts/run.command
scripts/update-packages.command
```

Windows PowerShell:

```powershell
scripts/run.ps1
scripts/update-packages.ps1
```

The run scripts install dependencies, stop stale QuickDeck listeners on port `1421`, and launch Tauri development mode.

The update scripts install and update npm packages, update Cargo dependencies within declared constraints, clean build outputs, and build the desktop app.

## Build

Frontend build:

```sh
npm run build
```

Desktop build:

```sh
npm run tauri build
```

## Local Data

QuickDeck stores data locally in the app data directory shown in the About modal.

The data files are:

- `config.json`
- `session.json`
- `snapshots.sqlite3`

QuickDeck does not include telemetry, remote sync, or network persistence.
