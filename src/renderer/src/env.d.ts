import type { ElectronApi } from '../../preload/index';

declare global {
  interface Window {
    electronAPI: ElectronApi;
  }
}

export {};
