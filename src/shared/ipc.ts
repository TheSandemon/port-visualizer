/** Single source of truth for IPC channel names. */
export const IPC = {
  scanNow: 'scan-now',
  setAutoRefresh: 'set-auto-refresh',
  killProcess: 'kill-process',
  killProcessElevated: 'kill-process-elevated',
  openAppLocation: 'open-app-location',
  copyText: 'copy-text',
  exportData: 'export-data',
  getSettings: 'get-settings',
  setSettings: 'set-settings',
  // main -> renderer pushes
  portsUpdated: 'ports-updated',
  scanError: 'scan-error',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
