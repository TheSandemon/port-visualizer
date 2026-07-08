# Changelog

## 2.0.0 — 2026-07-07

Complete rebuild. See `UPGRADE_PLAN.md` for the full phase breakdown.

### Added
- Table view, process-grouped view, and view switching (`1`/`2`/`3`).
- Scan diff engine: new/changed sockets flash, session history panel logs opens/closes.
- Well-known service labels (postgres, vite dev, rdp, …).
- Kill modal with child-tree kill option and UAC elevation retry on access denied.
- System tray with listening-port tooltip, minimize-to-tray, quick scan.
- Optional notifications when a new port starts listening.
- CSV/JSON export of the filtered view.
- Light/dark/system theme, keyboard shortcuts, persisted settings.
- Configurable auto-refresh interval (2s/5s/10s/30s), scan loop owned by main process.
- Unit tests (Vitest), ESLint, Prettier, strict TypeScript, CI workflow.

### Changed
- Migrated to electron-vite + TypeScript; Electron 33 → 43.
- Scanner rebuilt around a single structured PowerShell query with netstat fallback.
- Renderer now fully sandboxed; all IPC inputs validated in the main process.

### Fixed
- Crash on window close (assignment to `const`).
- Shell-injection surface in the kill-process handler (now `execFile` + integer PID
  validation; system PIDs 0/4 refused).
- Open-location accepting arbitrary renderer-supplied paths (now allowlisted).
- Sockets on the same port (IPv4+IPv6, multiple connections) silently collapsing into
  one entry.
- `Get-Process` StartTime query poisoning scans that include elevated processes.

## 1.0.0 — 2026-03-16

Initial vanilla JS version: netstat scan, card grid, kill, open location.
