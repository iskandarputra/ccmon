/**
 * @file preload.ts
 * @brief Context-isolated preload exposing the typed ccmon API (window.ccmon) to the renderer.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { CcmonApi } from '../shared/ipc';
import type { AdvisorMessage, AppSettings, SetupOptions, TimeRange } from '../shared/types';

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
  setRange: (range: TimeRange) => ipcRenderer.invoke('usage:setRange', range),

  login: (projectDir: string) => ipcRenderer.invoke('auth:login', projectDir),
  submitLoginCode: (projectDir: string, code: string) =>
    ipcRenderer.invoke('auth:submitCode', projectDir, code),

  listRecentSessions: (projectDir: string, limit?: number) =>
    ipcRenderer.invoke('sessions:recent', projectDir, limit),

  dayBreakdown: (dateKey: string) => ipcRenderer.invoke('insights:dayBreakdown', dateKey),

  exportCsv: (kind) => ipcRenderer.invoke('export:csv', kind),

  askAdvisor: (question: string, history: AdvisorMessage[], dir?: string) =>
    ipcRenderer.invoke('advisor:ask', question, history, dir),

  detectShells: () => ipcRenderer.invoke('setup:detectShells'),
  previewSetup: (opts: SetupOptions) => ipcRenderer.invoke('setup:preview', opts),
  applySetup: (opts: SetupOptions) => ipcRenderer.invoke('setup:apply', opts),
  createAccount: (suffix: string) => ipcRenderer.invoke('setup:createAccount', suffix),

  onSnapshot: on('usage:snapshot'),
  onEvents: on('usage:events'),
  onProgress: on('usage:progress'),
  onReset: on('usage:reset'),
  onSettings: on('settings:changed'),
  onPricingMeta: on('pricing:meta'),
  onLimits: on('limits:data'),
  onCurrency: on('currency:data'),

  openUrl: (url: string) => ipcRenderer.send('app:openUrl', url),

  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
};

contextBridge.exposeInMainWorld('ccmon', api);
