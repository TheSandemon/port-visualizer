# Port Visualizer — Full Upgrade Plan

**State (2026-07-07, end of session): ALL PHASES IMPLEMENTED.**
Git repo initialized; baseline (v1.0 vanilla JS) on `main`, rebuild on branch `upgrade`.
Layout: `src/main` (index/scanner/netstat-parser/diff/kill/settings), `src/preload`,
`src/renderer` (vanilla TS, keyed reconciliation), `src/shared` (types/ipc/export/known-ports/port-id),
`tests/` (23 Vitest tests). Electron 43, electron-vite 5, strict TS, ESLint 10, Prettier.
Verified: tests, typecheck, lint, build all green; app launched and scanned successfully;
NSIS installer + portable built via `npm run dist`. CI at `.github/workflows/ci.yml`.
Remaining (deliberately deferred): code signing, electron-updater publish target (needs a
GitHub repo), Docker container detection (was optional), merge of `upgrade` into `main`.

Original pre-upgrade state, for reference: Electron 33, plain JS, ~840 LOC, no git/tests/TS.

---

## Phase 0 — Foundation (do first, everything else builds on it)

1. `git init` + `.gitignore` (node_modules, dist).
2. Migrate to **electron-vite + TypeScript**: `src/main/`, `src/preload/`, `src/renderer/` with shared
   `src/shared/types.ts` (PortEntry, ScanResult, IPC channel names as const).
3. Tooling: ESLint (typescript-eslint), Prettier, **Vitest** for unit tests.
4. Upgrade Electron 33 → current stable (37+), electron-builder to latest; add NSIS installer target
   alongside portable.
5. `npm run dev` (vite HMR), `test`, `lint`, `build` scripts. Optional GitHub Actions CI later.

## Phase 1 — Correctness & security fixes (bugs in current code)

- **main.js:38** — `mainWindow = null` assigns to a `const` → TypeError on window close. Fix.
- **kill-process handler** — the PID from the renderer is interpolated into a shell command string
  unvalidated; a compromised renderer could inject shell syntax. Validate
  `Number.isInteger(pid) && pid > 4`, block system PIDs (0, 4), and switch to `execFile` with an
  argument array (`taskkill`, `['/PID', String(pid), '/F']`) so no shell parsing occurs.
- **open-app-location** — validate the path exists and came from a real scan result (keep a
  main-process cache of last-scan paths; don't trust renderer-supplied strings).
- **Dedup bug** — `combineData` keys by `port-protocol`, silently dropping multiple sockets on the
  same port (different local addresses / multiple ESTABLISHED connections / IPv4 vs IPv6). Key by
  `addr:port-protocol-pid-remote` and let the UI group.
- **PowerShell StartTime** — `Get-Process ... StartTime` throws for elevated/system processes and can
  poison the JSON. Wrap per-property or drop StartTime from the query.
- BrowserWindow: add `sandbox: true`; deny `window.open`/navigation via
  `setWindowOpenHandler` + `will-navigate`.
- Unit-test `parseNetstat` against fixture output (IPv4, IPv6 `[::]:135`, UDP, garbage lines).

## Phase 2 — Scanner engine upgrade

- Replace the netstat + Get-Process double subprocess spawn with **one** PowerShell call joining
  `Get-NetTCPConnection` + `Get-NetUDPEndpoint` + process info → JSON. Faster, structured, no
  text parsing. Keep the netstat parser as fallback.
- Add per-process metadata: user name, CPU %, command line (via CIM `Win32_Process`), parent PID.
- **Well-known port labels** — bundle a small IANA map (80 http, 3000 dev server, 5432 postgres…).
- **Diff engine**: each scan compares to previous → emits added/removed/changed ports for UI
  highlights and notifications.
- Push-based updates: main process owns the scan loop, renderer subscribes to a `ports-updated`
  IPC event instead of pull-per-click.

## Phase 3 — UI/UX overhaul

- **Table view + card view toggle**; sortable columns; virtualized rendering for large result sets.
- Group-by-process mode (one row per process, expandable to its ports).
- New/closed port highlight animation on auto-refresh (uses Phase 2 diff) — no full re-render,
  keyed DOM updates so scroll position survives.
- Auto-refresh with selectable interval (2s/5s/10s/30s) — currently hardcoded 10s.
- Replace `confirm()` with a proper in-app modal for kill confirmation (native confirm blocks the
  renderer and looks off in Electron).
- Copy-to-clipboard on port/PID/address; keyboard shortcuts (Ctrl+R scan, `/` focus search).
- Filter chips + free-text search unified; persist filters/settings via `electron-store`.
- Light/dark theme following `nativeTheme`, with manual override.
- Footer stats: listening vs established counts, total processes.
- Accessibility pass: focus states, aria labels, contrast.

## Phase 4 — Power features

- **System tray**: minimize to tray, tray tooltip with listening-port count, quick-scan menu.
- **Notifications**: opt-in alert when a new port starts listening (dev server up / unexpected).
- **Elevation handling**: detect access-denied on kill and offer relaunch-as-admin or an elevated
  taskkill via UAC prompt.
- Kill process tree option (`taskkill /T`).
- Export current view as CSV/JSON.
- Port history timeline (session-only): when a port appeared/disappeared.
- Optional: Docker container detection (map ports owned by `com.docker.backend` to containers via
  `docker ps` when available).

## Phase 5 — Ship it

- electron-builder: NSIS installer + portable, app icon, code-signing placeholder config.
- Auto-update via electron-updater + GitHub Releases (once repo is on GitHub).
- README with screenshots; CHANGELOG.
- CI: lint + test + build on push (GitHub Actions, windows-latest).

---

**Suggested order:** 0 → 1 are prerequisites and low-risk. 2 unlocks 3/4. Each phase is independently
shippable. Phase 1 alone is worth doing immediately even if the rest is deferred (the kill-process
injection surface and the const-assignment crash are real defects).
