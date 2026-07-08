export type Protocol = 'TCP' | 'UDP';

export type ScanSource = 'powershell' | 'netstat';

export interface PortEntry {
  /** Stable identity: protocol|localAddress|localPort|pid|remote */
  id: string;
  protocol: Protocol;
  localAddress: string;
  localPort: number;
  remoteAddress: string | null;
  remotePort: number | null;
  state: string;
  pid: number;
  processName: string;
  processPath: string | null;
  memory: number;
  parentPid: number | null;
  commandLine: string | null;
  /** Well-known service label for the local port, e.g. "http", "postgres" */
  serviceLabel: string | null;
}

export interface ScanResult {
  ports: PortEntry[];
  timestamp: number;
  source: ScanSource;
}

export interface ScanDiff {
  addedIds: string[];
  removedIds: string[];
  /** ids present in both scans whose state changed */
  changedIds: string[];
  /** full entries that disappeared (for notifications/history) */
  removed: PortEntry[];
}

export interface PortsUpdate extends ScanResult {
  diff: ScanDiff;
}

export type ThemeSetting = 'system' | 'light' | 'dark';
export type ViewMode = 'cards' | 'table' | 'process';

export interface AppSettings {
  theme: ThemeSetting;
  viewMode: ViewMode;
  autoRefresh: boolean;
  refreshIntervalMs: number;
  notifyNewListeners: boolean;
  minimizeToTray: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  viewMode: 'cards',
  autoRefresh: false,
  refreshIntervalMs: 5000,
  notifyNewListeners: false,
  minimizeToTray: false,
};

export interface KillResult {
  success: boolean;
  error?: string;
  /** true when the failure looks like a permissions problem solvable via UAC */
  needsElevation?: boolean;
}

export interface OkResult {
  success: boolean;
  error?: string;
}

export interface ExportRequest {
  format: 'csv' | 'json';
  /** ids of the currently visible entries, in display order */
  ids: string[];
}
