export type Protocol = 'TCP' | 'UDP';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type Exposure = 'loopback' | 'lan' | 'all-interfaces';

/** Optional interpretation of an observation. OS facts never live here. */
export interface Annotation {
  namespace: string;
  values: Record<string, JsonValue>;
  source: string;
  confidence?: number;
}

/** Rolling measurements derived from repeated observations of the same socket. */
export interface PortTelemetry {
  firstSeenAt: number;
  lastSeenAt: number;
  observedScans: number;
  localConnectionCount: number;
  remotePeerCount: number;
  endpointOpenCount: number;
  stateChangeCount: number;
  ownerCount: number;
  hasCollision: boolean;
  connectionRatePerMinute: number;
}

export type ScanSource = 'powershell' | 'netstat';

/**
 * Authenticode result for the owning executable. `status` distinguishes a
 * missing signature from one that exists but does not verify — both render,
 * so a port never appears without a publisher line.
 */
export type SignatureStatus = 'valid' | 'untrusted' | 'tampered' | 'unsigned' | 'unavailable';

export interface ProcessSignature {
  /** Common name from the signing certificate subject, when one is present. */
  publisher: string | null;
  status: SignatureStatus;
  checkedAt: number;
}

export type FirewallDisposition = 'blocked' | 'allowed' | 'no-rule' | 'unavailable';

export interface FirewallStatus {
  /** Block wins over allow, mirroring Windows Firewall evaluation order. */
  disposition: FirewallDisposition;
  ruleNames: string[];
  checkedAt: number;
}

export interface ProcessAncestor {
  pid: number;
  name: string;
}

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
  /** Stable, scanner-derived network scope. */
  exposure: Exposure;
  /** Open extension surface for collectors and enrichers. */
  attributes: Record<string, JsonValue>;
  /** Source-attributed interpretations supplied by knowledge packs or plugins. */
  annotations: Annotation[];
  telemetry?: PortTelemetry;
  /** Absent until the background Authenticode pass has reached this path. */
  signature?: ProcessSignature | null;
  /** Absent until the background firewall pass has reached this port. */
  firewall?: FirewallStatus | null;
  /** Owning process chain, nearest parent first. */
  ancestors?: ProcessAncestor[];
}

export type PortEventType =
  | 'port.opened'
  | 'port.closed'
  | 'port.changed'
  | 'port.owner-changed'
  | 'port.exposure-changed';

export interface PortEvent {
  schemaVersion: 1;
  sequence: number;
  timestamp: number;
  type: PortEventType;
  observationId: string;
  port: PortEntry;
  payload: Record<string, JsonValue>;
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
  events: PortEvent[];
  knowledgePacks: KnowledgePackSummary[];
}

export interface KnowledgePackSummary {
  id: string;
  name: string;
  version: number;
  ruleCount: number;
  origin: 'built-in' | 'user' | 'workspace';
}

export type ThemeSetting = 'system' | 'light' | 'dark';
export type ViewMode = 'cards' | 'table' | 'process' | 'timeline';

/** A named capture of the toolbar controls. */
export interface FilterPreset {
  id: string;
  name: string;
  search: string;
  protocol: string;
  state: string;
  exposure: string;
  sort: string;
}

export interface AppSettings {
  theme: ThemeSetting;
  viewMode: ViewMode;
  autoRefresh: boolean;
  refreshIntervalMs: number;
  notifyNewListeners: boolean;
  minimizeToTray: boolean;
  enableKnowledgePacks: boolean;
  watchedPortKeys: string[];
  filterPresets: FilterPreset[];
  /** `PROTO:port` keys accepted as normal for this machine. */
  baselinePortKeys: string[];
  baselineCapturedAt: number;
  notifyOffBaseline: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  viewMode: 'cards',
  autoRefresh: false,
  refreshIntervalMs: 5000,
  notifyNewListeners: false,
  minimizeToTray: false,
  enableKnowledgePacks: true,
  watchedPortKeys: [],
  filterPresets: [],
  baselinePortKeys: [],
  baselineCapturedAt: 0,
  notifyOffBaseline: false,
};

/**
 * Slow lookups resolved after a scan returns. Delivered on their own channel so
 * a signature or firewall query never delays the socket list.
 */
export interface EnrichmentUpdate {
  /** Keyed by executable path. */
  signatures: Record<string, ProcessSignature>;
  /** Keyed by `PROTO:port`. */
  firewall: Record<string, FirewallStatus>;
}

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
