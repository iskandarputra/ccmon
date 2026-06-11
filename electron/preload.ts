/**
 * @file preload.ts
 * @brief Context-isolated preload exposing the typed ccmon API (window.ccmon) to the renderer.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { CcmonApi } from '../shared/ipc';
import type { AppSettings } from '../shared/types';

/** Subscribe helper — returns an unsubscribe function. */
const on =
  <T>(channel: string) =>
  (cb: (payload: T) => void) => {
    const handler = (_event: IpcRendererEvent, payload: T) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };

const api: CcmonApi = {
  getState: () => ipcRenderer.invoke('app:getState'),
  rescan: () => ipcRenderer.invoke('usage:rescan'),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  setSettings: (partial: Partial<AppSettings>) => ipcRenderer.invoke('settings:set', partial),
  refreshPricing: () => ipcRenderer.invoke('pricing:refresh'),
  refreshLimits: () => ipcRenderer.invoke('limits:refresh'),
  refreshCurrency: () => ipcRenderer.invoke('currency:refresh'),

  onSnapshot: on('usage:snapshot'),
  onEvents: on('usage:events'),
  onProgress: on('usage:progress'),
  onReset: on('usage:reset'),
  onSettings: on('settings:changed'),
  onPricingMeta: on('pricing:meta'),
  onLimits: on('limits:data'),
  onCurrency: on('currency:data'),

  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
};

contextBridge.exposeInMainWorld('ccmon', api);
