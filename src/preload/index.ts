import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type {
  AppSettings,
  ExportRequest,
  KillResult,
  OkResult,
  PortsUpdate,
} from '../shared/types';

export interface ElectronApi {
  scanNow(): Promise<{ success: boolean; update?: PortsUpdate; error?: string }>;
  killProcess(pid: number, tree: boolean): Promise<KillResult>;
  killProcessElevated(pid: number, tree: boolean): Promise<KillResult>;
  openAppLocation(path: string): Promise<OkResult>;
  copyText(text: string): Promise<OkResult>;
  exportData(request: ExportRequest): Promise<OkResult>;
  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  onPortsUpdated(callback: (update: PortsUpdate) => void): () => void;
  onScanError(callback: (message: string) => void): () => void;
}

const api: ElectronApi = {
  scanNow: () => ipcRenderer.invoke(IPC.scanNow),
  killProcess: (pid, tree) => ipcRenderer.invoke(IPC.killProcess, pid, tree),
  killProcessElevated: (pid, tree) => ipcRenderer.invoke(IPC.killProcessElevated, pid, tree),
  openAppLocation: (path) => ipcRenderer.invoke(IPC.openAppLocation, path),
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text),
  exportData: (request) => ipcRenderer.invoke(IPC.exportData, request),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
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
};

contextBridge.exposeInMainWorld('electronAPI', api);
