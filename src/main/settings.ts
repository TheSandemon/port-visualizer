import { app } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/types';

let cached: AppSettings | null = null;
let saveTimer: NodeJS.Timeout | null = null;

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

function sanitize(raw: unknown): AppSettings {
  const out: AppSettings = { ...DEFAULT_SETTINGS };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;

  if (r.theme === 'light' || r.theme === 'dark' || r.theme === 'system') out.theme = r.theme;
  if (r.viewMode === 'cards' || r.viewMode === 'table' || r.viewMode === 'process')
    out.viewMode = r.viewMode;
  if (typeof r.autoRefresh === 'boolean') out.autoRefresh = r.autoRefresh;
  if (
    typeof r.refreshIntervalMs === 'number' &&
    Number.isFinite(r.refreshIntervalMs) &&
    r.refreshIntervalMs >= 1000 &&
    r.refreshIntervalMs <= 300000
  )
    out.refreshIntervalMs = r.refreshIntervalMs;
  if (typeof r.notifyNewListeners === 'boolean') out.notifyNewListeners = r.notifyNewListeners;
  if (typeof r.minimizeToTray === 'boolean') out.minimizeToTray = r.minimizeToTray;
  return out;
}

export async function loadSettings(): Promise<AppSettings> {
  if (cached) return cached;
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    cached = sanitize(JSON.parse(raw));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') console.error('[Settings] Failed to load, using defaults:', error);
    cached = { ...DEFAULT_SETTINGS };
  }
  return cached;
}

export function getSettings(): AppSettings {
  return cached ?? { ...DEFAULT_SETTINGS };
}

export function updateSettings(patch: unknown): AppSettings {
  cached = sanitize({ ...getSettings(), ...(typeof patch === 'object' ? patch : {}) });

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void fs
      .writeFile(settingsPath(), JSON.stringify(cached, null, 2), 'utf8')
      .catch((error) => console.error('[Settings] Failed to save:', error));
  }, 250);

  return cached;
}
