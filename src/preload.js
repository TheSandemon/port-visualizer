const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  scanPorts: () => ipcRenderer.invoke('scan-ports'),
  killProcess: (pid) => ipcRenderer.invoke('kill-process', pid),
  openAppLocation: (filePath) => ipcRenderer.invoke('open-app-location', filePath)
});