/** Single source of truth for IPC channel names. */
export const IPC = {
  scanNow: 'scan-now',
  setAutoRefresh: 'set-auto-refresh',
  killProcess: 'kill-process',
  killProcessElevated: 'kill-process-elevated',
  openAppLocation: 'open-app-location',
  openLocalEndpoint: 'open-local-endpoint',
  copyText: 'copy-text',
  exportData: 'export-data',
  getSettings: 'get-settings',
  setSettings: 'set-settings',
  getRecentEvents: 'get-recent-events',
  setPortBlocked: 'set-port-blocked',
  captureBaseline: 'capture-baseline',
  // main -> renderer pushes
  portsUpdated: 'ports-updated',
  scanError: 'scan-error',
  enrichmentUpdated: 'enrichment-updated',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
