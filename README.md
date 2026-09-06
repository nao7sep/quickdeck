# QuickDeck

QuickDeck is a local-first, multi-pane plain-text workspace for fast, buffer-based writing — a desktop app for macOS and Windows, built with Tauri, React, and TypeScript. You write across several equal-width panes at once; the workspace autosaves to local JSON, and recovery snapshots are kept in local SQLite to help recover recent text after mistakes or restarts. It suits anyone who wants a quick scratch space for drafting and reshuffling text — with word, character, and X/Twitter-weighted counts built in — and who wants it entirely on their own machine: no telemetry, no sync, no network.

## Features

- Multiple equal-width panes with vivid, auto-distinct header colors, editable titles, and keyboard reordering and focus
- Configurable-delay autosave, plus deduped SQLite recovery snapshots on copy, paste, cut, and close — with searchable, timestamped history
- Word, character, and X/Twitter-weighted character counts
- Zen mode that focuses a single pane, and an always-on-top toggle
- Dark theme, persistent zoom (50–500%), and configurable UI and editor fonts
- Fully keyboard-navigable menus and modals

## Download

Prebuilt builds for **macOS (Apple Silicon)** and **Windows (x64)** are on the [Releases](https://github.com/nao7sep/quickdeck/releases/latest) page — a `.dmg` / `setup.exe` installer or a portable `.zip`. The builds are **unsigned**, so the OS warns the first time you open one:

- **macOS** — right-click the app and choose **Open** (or run `xattr -dr com.apple.quarantine /Applications/QuickDeck.app`).
- **Windows** — on the SmartScreen prompt, click **More info → Run anyway**.

## Requirements

- **macOS (Apple Silicon)** or **Windows (x64)** to run a prebuilt download.
- To build and run from source: Node.js, npm, and a Rust toolchain with Cargo (QuickDeck is a Tauri app).

## Run from source

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

[GNU GPL v3 or later](LICENSE) © 2026 Yoshinao Inoguchi

## Contact

Yoshinao Inoguchi — yoshinao@inoguchi.com — <https://inoguchi.com>
