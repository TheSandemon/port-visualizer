# Changelog

## 0.4.0 — 2026-09-10

### Added
- Authenticode publisher shown on every port in every view, including when a binary is
  unsigned, untrusted, or its signature does not match.
- Inbound firewall disposition per listening port, with block and unblock controls that
  prompt for elevation.
- Timeline view (`4`) plotting lifecycle events per port over a selectable window.
- Owning-process parent chain on cards and process groups.
- Baseline capture with notifications when a listener appears that is not in the baseline.
- Saved filter presets in the toolbar.
- A "changes since you last looked" counter that fills while the window is unfocused.
- Publisher, signature status, firewall, parent chain, and command line in CSV export.

### Changed
- Firewall and publisher lookups resolve after a scan on their own IPC channel, so neither
  delays the socket list.

## 0.3.0 — 2026-08-27

### Added
- Open observation fields, source-attributed annotations, and rolling port telemetry.
- Persistent, versioned JSONL events for port opens, closes, and state changes.
- Live lifecycle signal, exposure metrics/filtering, and observation duration.
- Reloadable knowledge packs from built-in, user, and workspace directories.
- JSON Schema and contributor documentation for knowledge packs.
- Command-line credential redaction before persistence or renderer delivery.
- Per-port connection rate, restart count, state-change count, owner count, and collision signals.
- Watch controls with lifecycle, ownership, and exposure-change notifications.
- Copy-address, open-listener, reveal-folder, and process-kill controls on every applicable port.

### Changed
- Reframed the interface as a port-first live network instrument.
- Distinguished loopback, LAN, and all-interface bindings throughout the UI.
- Knowledge about AI and other fast-changing services is now data-driven and optional.
- Default sorting now surfaces the highest-memory port owners first.
- The telemetry header is compact and metric-first, without hero copy.

### Fixed
- IPv6 wildcard port-zero endpoints appearing as remote peers in netstat fallback scans.
- Kill actions appearing for protected system PIDs.
- Missing process names and memory caused by transient PIDs invalidating an otherwise valid
  PowerShell result; partial process metadata is now retained and cached.

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
