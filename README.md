# QuickDeck

QuickDeck is a local-first, multi-pane plain-text workspace for fast, buffer-based writing — a desktop app for macOS and Windows, built with Tauri, React, and TypeScript. You write across several equal-width panes at once; the workspace autosaves to local JSON, and recovery snapshots are kept in local SQLite so nothing is lost. It suits anyone who wants a quick scratch space for drafting and reshuffling text — with word, character, and X/Twitter-weighted counts built in — and who wants it entirely on their own machine: no telemetry, no sync, no network.

## Features

- Multiple equal-width panes with vivid, auto-distinct header colors, editable titles, and keyboard reordering and focus
- Configurable-delay autosave, plus deduped SQLite recovery snapshots on copy, paste, cut, and close — with searchable, timestamped history
- Word, character, and X/Twitter-weighted character counts
- Zen mode that focuses a single pane, and an always-on-top toggle
- Dark theme, persistent zoom (50–500%), and configurable UI and editor fonts
- Fully keyboard-navigable menus and modals

## Requirements

- macOS or Windows
- To build and run from source: Node.js, npm, and a Rust toolchain with Cargo (QuickDeck is a Tauri app)

## Getting started

Double-click the launcher for your platform:

```text
scripts/run-dev.command   # macOS
scripts/run-dev.ps1       # Windows
```

It installs dependencies and starts the app. To run it by hand instead:

```sh
npm install
npm run tauri dev
```

## License

MIT © 2026 Yoshinao Inoguchi

## Contact

Yoshinao Inoguchi — nao7sep@gmail.com
