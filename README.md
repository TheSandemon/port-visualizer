# Port Visualizer

A Windows desktop dashboard for everything listening on your machine. See every open
TCP/UDP socket, which process owns it, kill it, or jump to its executable — without
touching `netstat` or Task Manager.

## Features

- **Fast structured scanning** — one PowerShell query (`Get-NetTCPConnection` /
  `Get-NetUDPEndpoint` + process info); falls back to `netstat -ano` parsing if blocked.
- **Three views** — cards, sortable table, or grouped by process. Switch with `1`/`2`/`3`.
- **Live diffing** — auto-refresh (2s–30s) highlights new and state-changed sockets, and
  a session history panel logs every port that opened or closed.
- **Well-known service labels** — 5432 shows `postgres`, 5173 shows `vite dev`, etc.
- **Kill with care** — confirmation modal, optional child-process tree kill, and a UAC
  elevation retry when Windows says access denied. System PIDs are refused outright.
- **Tray & notifications** — minimize to tray, listening-port count in the tooltip,
  optional notification when a new port starts listening.
- **Export** — current filtered view as CSV or JSON.
- **Light / dark / system theme**, keyboard shortcuts (`Ctrl+R` scan, `/` search).

## Development

```bash
npm install
npm run dev        # electron-vite with HMR
npm test           # vitest unit tests
npm run lint       # eslint
npm run typecheck  # strict TS, main + renderer
npm run build      # production bundles into out/
npm run dist       # NSIS installer + portable exe into release/
```

## Architecture

```
src/
  main/      Electron main process: window, tray, scan loop, IPC, taskkill
  preload/   Typed contextBridge API (sandboxed renderer, no node access)
  renderer/  Vanilla TS UI with keyed DOM reconciliation
  shared/    Types, IPC channel names, CSV export, well-known port map
tests/       Vitest unit tests for the pure modules (parser, diff, export…)
```

Security posture: the renderer runs sandboxed with context isolation; every IPC input is
validated in the main process (integer PIDs only, path allowlist from the last scan);
process kills go through `execFile` argument arrays, never a shell string.

Windows-only by design — the scanner speaks PowerShell and `taskkill`.

## Notes

- Process command lines and parent PIDs come from CIM (`Win32_Process`); entries owned
  by elevated processes may show fewer details unless the app itself runs elevated.
- Code signing and auto-update are intentionally not configured yet; the
  `electron-builder` config is ready to take a certificate and a publish target when
  the project lands on GitHub.
