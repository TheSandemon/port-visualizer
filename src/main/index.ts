import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  Notification,
  shell,
  Tray,
} from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';
import iconPath from '../../resources/icon.png?asset';
import { IPC } from '../shared/ipc';
import type { AppSettings, ExportRequest, PortEntry, PortsUpdate } from '../shared/types';
import { portsToCsv, portsToJson } from '../shared/export';
import { diffScans } from './diff';
import { killProcess, killProcessElevated } from './kill';
import { scanPorts } from './scanner';
import { getSettings, loadSettings, updateSettings } from './settings';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

// ---------------------------------------------------------------------------
// Scan controller: main process owns the scan loop and pushes updates.
// ---------------------------------------------------------------------------

let lastPorts: PortEntry[] = [];
let hasScannedOnce = false;
let scanInFlight: Promise<PortsUpdate> | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

/** Paths seen in the last scan — the only paths open-location will accept. */
const knownPaths = new Set<string>();

async function runScan(): Promise<PortsUpdate> {
  // Coalesce concurrent requests (button spam, timer overlap) into one scan.
  if (scanInFlight) return scanInFlight;

  scanInFlight = (async () => {
    try {
      const result = await scanPorts();
      const diff = diffScans(lastPorts, result.ports);
      lastPorts = result.ports;

      knownPaths.clear();
      for (const p of result.ports) {
        if (p.processPath) knownPaths.add(p.processPath);
      }

      const update: PortsUpdate = { ...result, diff };
      mainWindow?.webContents.send(IPC.portsUpdated, update);
      updateTrayTooltip();
      if (hasScannedOnce) notifyNewListeners(update);
      hasScannedOnce = true;
      return update;
    } finally {
      scanInFlight = null;
    }
  })();

  return scanInFlight;
}

function applyAutoRefresh(settings: AppSettings): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (settings.autoRefresh) {
    refreshTimer = setInterval(() => {
      runScan().catch((error) => {
        console.error('[Main] Auto-refresh scan failed:', error);
        mainWindow?.webContents.send(IPC.scanError, String(error?.message ?? error));
      });
    }, settings.refreshIntervalMs);
  }
}

function notifyNewListeners(update: PortsUpdate): void {
  if (!getSettings().notifyNewListeners || !Notification.isSupported()) return;

  const byId = new Map(update.ports.map((p) => [p.id, p]));
  const newListeners = update.diff.addedIds
    .map((id) => byId.get(id))
    .filter((p): p is PortEntry => !!p && p.state === 'LISTENING' && p.protocol === 'TCP');
  if (newListeners.length === 0) return;

  const first = newListeners[0];
  const title =
    newListeners.length === 1
      ? `Port ${first.localPort} started listening`
      : `${newListeners.length} new listening ports`;
  const body =
    newListeners.length === 1
      ? `${first.processName} (PID ${first.pid})${first.serviceLabel ? ` — ${first.serviceLabel}` : ''}`
      : newListeners.map((p) => `${p.localPort} (${p.processName})`).join(', ');

  new Notification({ title, body, icon: iconPath }).show();
}

// ---------------------------------------------------------------------------
// Window & tray
// ---------------------------------------------------------------------------

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    icon: iconPath,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16161f' : '#f5f5fa',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Lock down navigation: this app never leaves its own document.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.on('close', (event) => {
    if (!quitting && getSettings().minimizeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray(): void {
  tray = new Tray(iconPath);
  tray.setToolTip('Port Visualizer');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Port Visualizer', click: showWindow },
      {
        label: 'Scan now',
        click: () => void runScan().catch((e) => console.error('[Main] Tray scan failed:', e)),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('double-click', showWindow);
}

function updateTrayTooltip(): void {
  if (!tray) return;
  const listening = lastPorts.filter((p) => p.state === 'LISTENING').length;
  tray.setToolTip(`Port Visualizer — ${listening} listening ports`);
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc(): void {
  ipcMain.handle(IPC.scanNow, async () => {
    try {
      const update = await runScan();
      return { success: true, update };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Main] Scan failed:', message);
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC.killProcess, (_event, pid: unknown, tree: unknown) =>
    killProcess(pid, tree === true),
  );

  ipcMain.handle(IPC.killProcessElevated, (_event, pid: unknown, tree: unknown) =>
    killProcessElevated(pid, tree === true),
  );

  ipcMain.handle(IPC.openAppLocation, (_event, filePath: unknown) => {
    // Only paths observed in the most recent scan are allowed — the renderer
    // cannot use this channel to probe or open arbitrary locations.
    if (typeof filePath !== 'string' || !knownPaths.has(filePath)) {
      return { success: false, error: 'Unknown path' };
    }
    shell.showItemInFolder(filePath);
    return { success: true };
  });

  ipcMain.handle(IPC.copyText, (_event, text: unknown) => {
    if (typeof text !== 'string' || text.length > 10000) {
      return { success: false, error: 'Invalid text' };
    }
    clipboard.writeText(text);
    return { success: true };
  });

  ipcMain.handle(IPC.exportData, async (_event, request: ExportRequest) => {
    try {
      if (
        !request ||
        (request.format !== 'csv' && request.format !== 'json') ||
        !Array.isArray(request.ids)
      ) {
        return { success: false, error: 'Invalid export request' };
      }

      // Export from main-process data, honoring the renderer's visible order.
      const byId = new Map(lastPorts.map((p) => [p.id, p]));
      const rows = request.ids
        .filter((id): id is string => typeof id === 'string')
        .map((id) => byId.get(id))
        .filter((p): p is PortEntry => !!p);
      if (rows.length === 0) return { success: false, error: 'Nothing to export' };

      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      const result = await dialog.showSaveDialog(mainWindow!, {
        defaultPath: `ports-${stamp}.${request.format}`,
        filters:
          request.format === 'csv'
            ? [{ name: 'CSV', extensions: ['csv'] }]
            : [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' };

      const content = request.format === 'csv' ? portsToCsv(rows) : portsToJson(rows);
      await fs.writeFile(result.filePath, content, 'utf8');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Main] Export failed:', message);
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC.getSettings, () => getSettings());

  ipcMain.handle(IPC.setSettings, (_event, patch: unknown) => {
    const settings = updateSettings(patch);
    nativeTheme.themeSource = settings.theme;
    applyAutoRefresh(settings);
    return settings;
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
    const settings = await loadSettings();
    nativeTheme.themeSource = settings.theme;

    registerIpc();
    createWindow();
    createTray();
    applyAutoRefresh(settings);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason);
});
