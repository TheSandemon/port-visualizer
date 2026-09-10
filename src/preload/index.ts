import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type {
  AppSettings,
  EnrichmentUpdate,
  ExportRequest,
  KillResult,
  OkResult,
  PortEvent,
  PortsUpdate,
  Protocol,
} from '../shared/types';

export interface ElectronApi {
  scanNow(): Promise<{ success: boolean; update?: PortsUpdate; error?: string }>;
  killProcess(pid: number, tree: boolean): Promise<KillResult>;
  killProcessElevated(pid: number, tree: boolean): Promise<KillResult>;
  openAppLocation(path: string): Promise<OkResult>;
  openLocalEndpoint(id: string): Promise<OkResult>;
  copyText(text: string): Promise<OkResult>;
  exportData(request: ExportRequest): Promise<OkResult>;
  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  getRecentEvents(limit?: number): Promise<PortEvent[]>;
  setPortBlocked(protocol: Protocol, port: number, blocked: boolean): Promise<OkResult>;
  captureBaseline(): Promise<AppSettings>;
  onPortsUpdated(callback: (update: PortsUpdate) => void): () => void;
  onScanError(callback: (message: string) => void): () => void;
  onEnrichmentUpdated(callback: (update: EnrichmentUpdate) => void): () => void;
}

const api: ElectronApi = {
  scanNow: () => ipcRenderer.invoke(IPC.scanNow),
  killProcess: (pid, tree) => ipcRenderer.invoke(IPC.killProcess, pid, tree),
  killProcessElevated: (pid, tree) => ipcRenderer.invoke(IPC.killProcessElevated, pid, tree),
  openAppLocation: (path) => ipcRenderer.invoke(IPC.openAppLocation, path),
  openLocalEndpoint: (id) => ipcRenderer.invoke(IPC.openLocalEndpoint, id),
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text),
  exportData: (request) => ipcRenderer.invoke(IPC.exportData, request),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  getRecentEvents: (limit = 500) => ipcRenderer.invoke(IPC.getRecentEvents, limit),
  setPortBlocked: (protocol, port, blocked) =>
    ipcRenderer.invoke(IPC.setPortBlocked, protocol, port, blocked),
  captureBaseline: () => ipcRenderer.invoke(IPC.captureBaseline),
  onPortsUpdated: (callback) => {
    const listener = (_event: unknown, update: PortsUpdate) => callback(update);
    ipcRenderer.on(IPC.portsUpdated, listener);
    return () => ipcRenderer.removeListener(IPC.portsUpdated, listener);
  },
  onScanError: (callback) => {
    const listener = (_event: unknown, message: string) => callback(message);
    ipcRenderer.on(IPC.scanError, listener);
    return () => ipcRenderer.removeListener(IPC.scanError, listener);
  },
  onEnrichmentUpdated: (callback) => {
    const listener = (_event: unknown, update: EnrichmentUpdate) => callback(update);
    ipcRenderer.on(IPC.enrichmentUpdated, listener);
    return () => ipcRenderer.removeListener(IPC.enrichmentUpdated, listener);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
