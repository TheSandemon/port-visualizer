# Changelog

## 1.0.0 — 2026-07-12

Initial release of the Port Visualizer dashboard.

### Features
- **Instant Port Scanning:** Queries active TCP/UDP ports via PowerShell (with automatic `netstat` fallback).
- **Multiple Layout Views:** Card grid, sortable table, and grouped-by-process view.
- **Service Labeling:** Resolves well-known ports to names (PostgreSQL, Vite, HTTP, etc.).
- **Live Diffing & History:** Flashes changes in real-time and logs events in the Session History panel.
- **Secure Process Control:** Safe termination with optional tree-kill and admin elevation (UAC) retry.
- **Tray & Notifications:** Runs in system tray with quick status and alerts for new listeners.
- **Data Export:** Support for CSV and JSON data exports.
- **Clean Design:** Light, dark, and system themes with full keyboard shortcuts.
