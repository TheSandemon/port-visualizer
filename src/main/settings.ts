import { app } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';
import { DEFAULT_SETTINGS, type AppSettings, type FilterPreset } from '../shared/types';

const PORT_KEY_PATTERN = /^(TCP|UDP):(?:[1-9]\d{0,4})$/;

function sanitizePortKeys(raw: unknown, limit: number): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((key): key is string => typeof key === 'string' && PORT_KEY_PATTERN.test(key))
    .slice(0, limit);
}

function sanitizePresets(raw: unknown): FilterPreset[] | null {
  if (!Array.isArray(raw)) return null;
  const text = (value: unknown, max: number): string =>
    typeof value === 'string' ? value.slice(0, max) : '';
  return raw
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({
      id: text(entry.id, 64),
      name: text(entry.name, 60),
      search: text(entry.search, 200),
      protocol: text(entry.protocol, 16),
      state: text(entry.state, 24),
      exposure: text(entry.exposure, 24),
      sort: text(entry.sort, 24),
    }))
    .filter((preset) => preset.id.length > 0 && preset.name.length > 0)
    .slice(0, 50);
}

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
  if (
    r.viewMode === 'cards' ||
    r.viewMode === 'table' ||
    r.viewMode === 'process' ||
    r.viewMode === 'timeline'
  )
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
  if (typeof r.enableKnowledgePacks === 'boolean')
    out.enableKnowledgePacks = r.enableKnowledgePacks;
  if (typeof r.notifyOffBaseline === 'boolean') out.notifyOffBaseline = r.notifyOffBaseline;
  if (
    typeof r.baselineCapturedAt === 'number' &&
    Number.isFinite(r.baselineCapturedAt) &&
    r.baselineCapturedAt >= 0
  )
    out.baselineCapturedAt = r.baselineCapturedAt;

  out.watchedPortKeys = sanitizePortKeys(r.watchedPortKeys, 500) ?? out.watchedPortKeys;
  out.baselinePortKeys = sanitizePortKeys(r.baselinePortKeys, 5000) ?? out.baselinePortKeys;
  out.filterPresets = sanitizePresets(r.filterPresets) ?? out.filterPresets;
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
